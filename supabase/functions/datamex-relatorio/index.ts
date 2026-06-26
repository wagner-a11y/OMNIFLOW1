import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// datamex-relatorio
// Busca o total de faturamento do mês corrente no TMS Bsoft/NSTech (e-login),
// que não expõe API pública. O acesso replica a sessão autenticada do usuário
// (cookie guardado no secret DATAMEX_SESSION_COOKIE) e faz scraping do HTML.
// Operação READ-ONLY: apenas lê o relatório de conhecimentos.
//
// O relatório vem em DOIS passos:
//   1) POST carrega_relatorio2.php  -> devolve um frameset; dele extraímos a URL
//      do frame "relatorio" (monta_relatorio.php?identificadorUnico=...).
//   2) GET monta_relatorio.php?...  -> HTML real do relatório (Latin-1), com o
//      rodapé "TOTAL ... <valor>" e "Total de Conhecimentos: <n>".
// Se a sessão expirar, o TMS devolve a tela de login -> respondemos 401.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const BASE = 'https://mgwtransportes.e-login.net/versoes/versao5.0/relatorios/';
const POST_URL = BASE + 'carrega_relatorio2.php';

// Parâmetros fixos: faturamento, empresa 2, mês corrente (mc), saída HTML.
const REPORT_PARAMS: Record<string, string> = {
  dados_empresa: '2',
  dados_periodo_emissao: 'mc',
  dados_statusConhecimento: 'N',
  dados_anulacao: 'N',
  dados_anulado: 'N',
  dados_situacaoSefaz: 'T',
  dados_averbado: 'A',
  dados_gerouCce: 'A',
  dados_gerouReciboFrete: 'A',
  dados_manifesto: 'A',
  dados_tipo_transporte: 'A',
  dados_compPedidoFiltro: 'C',
  dados_dataCriacao: 'manual',
  dados_radio_cliente: 'P',
  dados_tipo_cliente: 'A',
  dados_radio_remetente: 'P',
  dados_tipo_remetente: 'A',
  dados_radio_destinatario: 'P',
  dados_tipo_destinatario: 'A',
  dados_radio_consignatario: 'P',
  dados_tipo_consignatario: 'A',
  dados_radio_redespacho: 'P',
  dados_tipo_redespacho: 'A',
  dados_statusFaturamento: 'A',
  dados_tipoNota: 'A',
  dados_possui_gnre_dare_dua: 'A',
  dados_filtroPorCargasPerigosas: 'N',
  dados_cargaPerigosa: 'A',
  dados_ocorrencia: 'N',
  dados_campoTotalizadorMesEmMes: 'tp',
  dados_formato: 'html',
  rotina: 'trans_rel_conhecimento_formulario',
  dados_id: 'transp_rel_modelo_padraoDetalhado',
  nome_interno: '2979',
};

// O e-login responde em ISO-8859-1; fetch.text() assumiria UTF-8 e corromperia
// os bytes acentuados. Lemos os bytes e decodificamos como latin-1.
async function readLatin1(res: Response): Promise<string> {
  const buf = await res.arrayBuffer();
  return new TextDecoder('iso-8859-1').decode(buf);
}

// "1.502.836,27" -> 1502836.27  (formato BR: ponto = milhar, vírgula = decimal)
const brToNumber = (s: string): number => Number(s.replace(/\./g, '').replace(',', '.'));

// Detecta a tela de login (sessão expirada) — mesmo quando vem com HTTP 200.
const looksLikeLogin = (html: string): boolean =>
  /type=["']?password|name=["']?senha|esqueci.*senha|realizar.*login|usu[aá]rio e senha/i.test(html);

// Converte o HTML do relatório em texto plano para o scraping do rodapé.
const toText = (html: string): string =>
  html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ');

const FETCH_HEADERS = (cookie: string) => ({
  'Cookie': cookie,
  'User-Agent': 'Mozilla/5.0 (compatible; OmniFlow/1.0)',
  'Accept': 'text/html,application/xhtml+xml,*/*',
});

// Grava o resultado no cache lido pelo painel (linha única id=1).
// Sucesso: atualiza total/ctes e zera o erro. Erro: marca status/erro SEM
// sobrescrever o último total bom — o painel mantém o valor anterior e sinaliza.
async function writeCache(fields: { total?: number; ctes?: number | null; status: 'ok' | 'erro'; erro?: string | null }) {
  try {
    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) return;
    const db = createClient(url, key);
    const patch: Record<string, unknown> = { status: fields.status, atualizado_em: new Date().toISOString() };
    if (fields.status === 'ok') {
      patch.total = fields.total;
      patch.ctes = fields.ctes ?? null;
      patch.erro = null;
    } else {
      patch.erro = fields.erro ?? 'erro';
    }
    await db.from('faturamento_cache').update(patch).eq('id', 1);
  } catch (e) {
    console.warn('writeCache falhou:', (e as Error).message);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const cookie = Deno.env.get('DATAMEX_SESSION_COOKIE');
  if (!cookie) return json({ error: 'DATAMEX_SESSION_COOKIE não configurado no Supabase.' }, 500);

  try {
    // --- Passo 1: dispara o relatório, recebe o frameset ---
    const frameRes = await fetch(POST_URL, {
      method: 'POST',
      headers: { ...FETCH_HEADERS(cookie), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(REPORT_PARAMS).toString(),
    });
    const frameHtml = await readLatin1(frameRes);

    const relMatch = frameHtml.match(/monta_relatorio\.php\?[^"'\\ >]+/i);
    if (!relMatch) {
      if (looksLikeLogin(frameHtml)) { await writeCache({ status: 'erro', erro: 'Sessão expirada' }); return json({ error: 'Sessão expirada' }, 401); }
      await writeCache({ status: 'erro', erro: 'Frame do relatório não encontrado' });
      return json({ error: 'Não foi possível localizar o relatório (frame não encontrado).', amostra: toText(frameHtml).slice(0, 400) }, 502);
    }

    // --- Passo 2: busca o HTML real do relatório dentro do frame ---
    const reportRes = await fetch(BASE + relMatch[0], { method: 'GET', headers: FETCH_HEADERS(cookie) });
    const reportHtml = await readLatin1(reportRes);

    if (looksLikeLogin(reportHtml)) { await writeCache({ status: 'erro', erro: 'Sessão expirada' }); return json({ error: 'Sessão expirada' }, 401); }

    const text = toText(reportHtml);

    // Quantidade de CTes: "Total de Conhecimentos: 1545"
    const ctesMatch = text.match(/Total de Conhecimentos:\s*([\d.]+)/i);
    const ctes = ctesMatch ? Number(ctesMatch[1].replace(/\./g, '')) : null;

    // Total do frete: último valor monetário (exatamente 2 casas) ANTES do
    // rótulo "Total de Conhecimentos". O lookahead (?!\d) descarta as colunas de
    // peso, que têm 4 casas decimais (ex.: 2.849.172,1910).
    const moneyRe = /\d{1,3}(?:\.\d{3})*,\d{2}(?!\d)/g;
    const cut = text.toLowerCase().indexOf('total de conhecimentos');
    const before = cut !== -1 ? text.slice(0, cut) : text;
    const nums = before.match(moneyRe);
    const total = nums && nums.length ? brToNumber(nums[nums.length - 1]) : null;

    if (total === null) {
      await writeCache({ status: 'erro', erro: 'Total não encontrado no relatório' });
      return json({ error: 'Total não encontrado no relatório.', amostra: text.slice(-400) }, 502);
    }

    await writeCache({ status: 'ok', total, ctes });
    return json({ total, ctes, fonte: 'relatorio_html', periodo: 'mes_corrente', geradoEm: new Date().toISOString() });
  } catch (e) {
    await writeCache({ status: 'erro', erro: (e as Error).message });
    return json({ error: 'Falha ao acessar o relatório do TMS.', detalhe: (e as Error).message }, 502);
  }
});
