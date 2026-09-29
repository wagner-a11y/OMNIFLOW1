import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  corpoEmTexto, header, arquivosDaMensagem, recebidoEm,
  base64UrlParaBase64, type GmailMessage, type Arquivo,
} from "./gmailPayload.ts";

// gmail-intake — ETAPA 1a, MODO SECO.
//
// Lê e-mails da caixa de cotações, manda corpo + prints + anexos ao Gemini numa
// chamada só, e grava O QUE FOI ENTENDIDO em gmail_intake_log.
//
// >>> NÃO CRIA COTAÇÃO. <<< Nenhuma linha escreve em freight_calculations, de
// propósito: a extração precisa ser julgada em e-mail real antes de qualquer
// coisa entrar no funil que o time usa. A criação é a etapa 1b, e depende do
// interruptor `ativo` em gmail_intake_config, hoje false.
//
// SEGREDOS: GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN e
// GEMINI_API_KEY vivem nos secrets. Nenhum deles aparece em log — nem em erro:
// as mensagens de falha dizem o que houve, nunca o valor.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

/**
 * Access token a partir do refresh token. Vale ~1h e NUNCA é gravado: vive só
 * nesta invocação, em memória.
 */
async function accessToken(): Promise<string> {
  const id = Deno.env.get('GMAIL_CLIENT_ID');
  const secret = Deno.env.get('GMAIL_CLIENT_SECRET');
  const refresh = Deno.env.get('GMAIL_REFRESH_TOKEN');
  if (!id || !secret || !refresh) throw new Error('Credenciais do Gmail ausentes nos secrets.');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refresh, grant_type: 'refresh_token' }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.access_token) {
    // Só o código e o campo `error` do Google — nada de token nem de secret.
    throw new Error(`Não consegui renovar o acesso ao Gmail (HTTP ${res.status}: ${d.error || 'sem detalhe'}).`);
  }
  return d.access_token as string;
}

const gapi = async (tk: string, caminho: string) => {
  const r = await fetch(`${GMAIL}${caminho}`, { headers: { Authorization: `Bearer ${tk}` } });
  if (!r.ok) throw new Error(`Gmail API ${caminho.split('?')[0]} respondeu ${r.status}`);
  return r.json();
};

/** O conteúdo de um anexo que não veio embutido no payload. */
async function corpoDoAnexo(tk: string, msgId: string, a: Arquivo): Promise<string | null> {
  if (a.data) return a.data;
  if (!a.attachmentId) return null;
  try {
    const d = await gapi(tk, `/messages/${msgId}/attachments/${a.attachmentId}`);
    return d?.data || null;
  } catch {
    return null;   // anexo ilegível não derruba o e-mail inteiro
  }
}

/**
 * O prompt. Pede JSON e SÓ JSON, e inclui os campos que o funil usa — cliente,
 * veículo e prazo entraram agora, além dos que o parse-request já extraía.
 *
 * `confianca` é autodeclarada: é o modelo dizendo o quanto se sente seguro.
 * Não é probabilidade calculada, e está no log com esse nome para ninguém
 * confundir depois.
 */
const PROMPT = `Você é um assistente de cotação de frete rodoviário brasileiro.

Vou te dar um E-MAIL recebido por uma transportadora: o texto do corpo e, quando
houver, imagens coladas no corpo e arquivos anexos (planilha, PDF, print). O
pedido de frete costuma estar NA IMAGEM ou NO ANEXO, e o corpo só diz "segue em
anexo" — então leia TUDO e combine as informações.

Extraia os dados no formato JSON, sem nenhum texto fora do JSON:

{
  "ehCotacao": true se isto é um pedido/solicitação de cotação de frete; false se
               é outra coisa (propaganda, cobrança, conversa, resposta sem dados),
  "cliente": "empresa ou pessoa que está pedindo o frete, senão null",
  "solicitante": "nome de quem assinou/enviou o pedido, senão null",
  "origem": "cidade e UF de coleta, senão null",
  "destino": "cidade e UF de entrega, senão null",
  "tipoCarga": "granel sólido | granel líquido | frigorificada | carga geral | neogranel | perigosa | conteinerizada | null",
  "veiculo": "tipo de veículo pedido (ex: Carreta, Truck, Fiorino, Van, 3/4, Toco), senão null",
  "peso": número em kg, senão null,
  "valorMercadoria": número em reais, senão null,
  "prazoColeta": "data/hora de coleta no formato AAAA-MM-DD ou AAAA-MM-DDTHH:mm se houver, senão null",
  "disponibilidade": "imediato | agendado | null",
  "observacoes": "o que for relevante e não coube acima, senão null",
  "confianca": número de 0 a 1 dizendo o quanto você confia nesta extração,
  "ondeEstavaODado": "corpo | imagem | anexo | misto | nenhum"
}

Regras:
- NÃO invente. Campo sem informação clara é null.
- Datas relativas ("amanhã", "segunda"): resolva se o e-mail tiver data, senão null.
- Valor em reais: só o número, sem "R$" nem pontuação de milhar.
- Se não for pedido de frete, devolva ehCotacao false e os demais null.`;

async function extrair(tk: string, msg: GmailMessage): Promise<{ dados: any; partes: number }> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) throw new Error('GEMINI_API_KEY ausente nos secrets.');

  const corpo = corpoEmTexto(msg);
  const { arquivos, ignorados } = arquivosDaMensagem(msg);

  const cabecalho = [
    `De: ${header(msg, 'From')}`,
    `Assunto: ${header(msg, 'Subject')}`,
    `Recebido em: ${recebidoEm(msg) || '(desconhecido)'}`,
    ignorados ? `(${ignorados} anexo(s) fora dos tipos que consigo ler, ignorados)` : '',
  ].filter(Boolean).join('\n');

  // UMA chamada com N partes: o modelo cruza corpo, print e planilha de uma vez.
  // Em chamadas separadas ele não veria a contradição entre eles, e sobraria
  // para o código uma regra de desempate que ninguém quer escrever.
  const parts: unknown[] = [{ text: `${PROMPT}\n\n--- E-MAIL ---\n${cabecalho}\n\n${corpo || '(corpo vazio)'}` }];
  for (const a of arquivos) {
    const data = await corpoDoAnexo(tk, String(msg.id), a);
    if (!data) continue;
    parts.push({ text: `--- ANEXO: ${a.nome} (${a.mimeType}) ---` });
    parts.push({ inline_data: { mime_type: a.mimeType, data: base64UrlParaBase64(data) } });
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { response_mime_type: 'application/json' } }),
    },
  );
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gemini respondeu ${res.status}: ${out?.error?.message || 'sem detalhe'}`);
  const texto = out?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!texto) throw new Error('Gemini devolveu resposta vazia.');
  return { dados: JSON.parse(texto), partes: parts.length };
}

/** Número da série do e-mail, EM-AAAA-####. Contador PRÓPRIO, por ano. */
async function proximoNumeroEmail(db: any, ano: number): Promise<string> {
  // `like 'EM-<ano>-%'` é o que mantém as séries independentes: o contador do
  // e-mail nunca olha CT-, e o da calculadora (nextProposalNumber, ancorado no
  // prefixo) nunca olha EM-. Sem isso, o volume do robô empurraria a numeração
  // manual centenas de números para frente.
  const { data } = await db
    .from('freight_calculations')
    .select('proposal_number')
    .like('proposal_number', `EM-${ano}-%`)
    .order('proposal_number', { ascending: false })
    .limit(1);
  const ultimo = data?.[0]?.proposal_number as string | undefined;
  const m = /^EM-\d{4}-(\d+)$/.exec((ultimo || '').trim());
  const n = m ? parseInt(m[1], 10) : 0;
  return `EM-${ano}-${String(n + 1).padStart(4, '0')}`;
}

/** Ano corrente em America/Sao_Paulo — o contador é por ano civil daqui. */
const anoBRT = (): number =>
  Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric' }).format(new Date()));

const numero = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Cria a cotação a partir do que o Gemini extraiu. ETAPA 1b.
 *
 * Só roda com `ativo = true`. Nasce em "Cotações" (pending) e SEM DONO
 * (created_by nulo): ninguém reivindicou esse lead ainda, e atribuir a alguém
 * no automático seria inventar responsável.
 *
 * Baixa confiança NÃO impede o card: lead perdido é pior que lead para
 * conferir. A confiança vai gravada e o funil marca o card com "confira".
 */
async function criarCotacao(db: any, msgId: string, dados: any, confianca: number | null) {
  const ano = anoBRT();
  const agora = Date.now();
  const linha = {
    id: `${agora}${Math.floor(Math.random() * 1000)}`,
    proposal_number: await proximoNumeroEmail(db, ano),
    status: 'pending',
    origem_entrada: 'email',
    gmail_message_id: msgId,
    gmail_confianca: confianca,
    // O que o e-mail disse. Campo sem informação fica vazio de propósito: quem
    // abrir o card vê o buraco em vez de um palpite.
    origin: dados?.origem || '',
    destination: dados?.destino || '',
    vehicle_type: dados?.veiculo || '',
    merchandise_type: dados?.tipoCarga || null,
    cliente_nome_operacao: dados?.cliente || null,
    solicitante: dados?.solicitante || null,
    coleta_date: dados?.prazoColeta || null,
    observacoes_gerais: dados?.observacoes || null,
    disponibilidade: dados?.disponibilidade === 'imediato' ? 'Imediato' : 'Conforme programação',
    weight: numero(dados?.peso) ?? 0,
    goods_value: numero(dados?.valorMercadoria) ?? 0,
    // Nada de preço: a cotação ainda vai ser calculada por gente. Zerar é
    // diferente de inventar — e é o que o resto do sistema espera em numérico.
    distance_km: 0, base_freight: 0, tolls: 0, extra_costs: 0,
    insurance_percent: 0, profit_margin: 0, icms_percent: 0,
    pis_percent: 0, cofins_percent: 0, csll_percent: 0, irpj_percent: 0,
    suggested_freight: 0, total_freight: 0,
    created_at: agora,
    // created_by fica NULO: card sem dono, para alguém pegar.
  };
  const { error } = await db.from('freight_calculations').insert([linha]);
  if (error) {
    // 23505 = violação de índice único. O índice parcial em gmail_message_id é a
    // trava final contra o mesmo e-mail virar duas cotações; se bateu nele, o
    // card já existe e não há nada a fazer.
    if (String(error.code) === '23505') return { criada: false, motivo: 'ja existia' };
    throw new Error(`insert da cotação falhou: ${error.message}`);
  }
  return { criada: true, numero: linha.proposal_number };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return json({ error: 'ambiente Supabase indisponível' }, 500);
  // service_role porque não há usuário logado: o cron não tem sessão, e a RLS
  // das tabelas de log não dá escrita a ninguém.
  const db = createClient(url, key);

  const body = await req.json().catch(() => ({}));
  const backfill = body?.backfill === true;
  const limitePedido = Number(body?.limite);

  try {
    const { data: cfg } = await db.from('gmail_intake_config').select('cutoff, ativo, teto_rodada').eq('id', 1).maybeSingle();
    // FAIL-CLOSED: sem configuração, não roda. Um cutoff ausente significaria
    // "sem limite", que é exatamente o cenário de varrer 2.900 e-mails.
    if (!cfg) return json({ error: 'gmail_intake_config não encontrada — rode a migration antes.' }, 412);

    const teto = Math.max(1, Math.min(50, limitePedido || cfg.teto_rodada || 10));
    const tk = await accessToken();

    // DUAS BUSCAS DIFERENTES, e a diferença importa:
    //
    // backfill: os N mais recentes, SEM filtro de data — é a amostra para julgar
    //   a extração. Só é seguro porque estamos em modo seco: nada vira cotação.
    // incremental: só o que chegou depois do cutoff. É o modo do cron, e é ele
    //   que impede o histórico de entrar quando a 1b for ligada.
    const cutoffSeg = cfg.cutoff ? Math.floor(new Date(cfg.cutoff).getTime() / 1000) : null;
    const q = backfill ? '' : (cutoffSeg ? `&q=${encodeURIComponent(`after:${cutoffSeg}`)}` : '');
    if (!backfill && !cutoffSeg) return json({ error: 'cutoff ausente: recusando varrer a caixa inteira.' }, 412);

    // JANELA e TETO são coisas diferentes, e confundi-los estourou a primeira
    // execução: 30 e-mails com anexo, cada um com sua chamada ao Gemini, passam
    // do tempo máximo da Edge Function (503 aos 151s).
    //   janela = quantas mensagens a LISTA traz (barato: só ids);
    //   teto   = quantas são PROCESSADAS nesta rodada (caro: anexo + Gemini).
    // Com a janela maior que o teto, rodadas sucessivas avançam pelos pendentes
    // em vez de reencontrar sempre os mesmos mais recentes.
    const janela = backfill ? Math.max(teto, Math.min(100, Number(body?.janela) || 30)) : teto;
    const lista = await gapi(tk, `/messages?maxResults=${janela}${q}`);
    const ids: string[] = (lista?.messages || []).map((m: any) => m.id).filter(Boolean);
    if (!ids.length) return json({ ok: true, modo: backfill ? 'backfill' : 'incremental', lidos: 0, novos: 0 });

    // Terceira trava: o que já está no log não é reprocessado (nem relido no
    // Gemini, que custa). A PK da tabela é a rede final contra duplicata.
    const { data: jaVistos } = await db.from('gmail_intake_log').select('message_id').in('message_id', ids);
    const vistos = new Set((jaVistos || []).map((r: any) => r.message_id));
    // .slice(teto): o resto fica para a próxima rodada. É o que mantém cada
    // execução dentro do tempo e, de quebra, é a trava de volume.
    const pendentes = ids.filter(id => !vistos.has(id)).slice(0, teto);

    const cutoffISO = cfg.cutoff ? new Date(cfg.cutoff).toISOString() : null;
    let gravados = 0, comErro = 0, criadas = 0;
    for (const id of pendentes) {
      let linha: Record<string, unknown> = { message_id: id };
      try {
        const msg = await gapi(tk, `/messages/${id}?format=full`) as GmailMessage;
        linha = {
          message_id: id,
          thread_id: msg.threadId || null,
          remetente: header(msg, 'From') || null,
          assunto: header(msg, 'Subject') || null,
          recebido_em: recebidoEm(msg),
        };
        const { dados, partes } = await extrair(tk, msg);
        const c = Number(dados?.confianca);
        const confianca = Number.isFinite(c) ? Math.max(0, Math.min(1, c)) : null;
        linha.json_extraido = dados;
        linha.confianca = confianca;
        linha.partes = partes;

        // ---- ETAPA 1b: a cotação ----
        // Três condições, todas necessárias: o interruptor ligado, o modelo ter
        // reconhecido um pedido de frete, e o e-mail ser posterior ao cutoff.
        // O cutoff aqui é a trava que impede os ~2.900 históricos de virarem
        // card mesmo se alguém rodar um backfill com o interruptor ligado.
        const recebido = recebidoEm(msg);
        const dentroDoCutoff = !cutoffISO || !recebido || recebido >= cutoffISO;
        if (cfg.ativo === true && dados?.ehCotacao === true && dentroDoCutoff) {
          const r = await criarCotacao(db, id, dados, confianca);
          linha.cotacao_criada = r.criada;
          linha.cotacao_numero = r.criada ? r.numero : null;
          if (r.criada) criadas++;
        } else {
          linha.cotacao_criada = false;
        }
      } catch (e) {
        // E-mail que falhou fica registrado COM o motivo: saber que quebrou é
        // parte do que se está avaliando nesta etapa.
        linha.erro = (e as Error).message;
        comErro++;
      }
      const { error } = await db.from('gmail_intake_log').upsert([linha], { onConflict: 'message_id' });
      if (error) console.warn('falha ao gravar no log:', error.message);
      else gravados++;
    }

    return json({
      ok: true,
      modo: backfill ? 'backfill' : 'incremental',
      modoSeco: cfg.ativo !== true,
      cotacoesCriadas: criadas,
      naJanela: ids.length,
      jaNoLog: ids.length - (ids.length - vistos.size) === 0 ? vistos.size : vistos.size,
      processadosAgora: pendentes.length,
      faltamNaJanela: Math.max(0, ids.length - vistos.size - pendentes.length),
      gravados, comErro,
      ativo: cfg.ativo === true,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }
});
