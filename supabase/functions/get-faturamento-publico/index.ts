import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { hojeYMD, mesCorrente, semanaCorrente } from './semana.ts';

// get-faturamento-publico
// Endpoint PÚBLICO (sem JWT) para o Painel da TV, que roda sem login.
// NÃO expõe a tabela: exige um token secreto na query (?k=...) que precisa
// bater com o secret PAINEL_TV_TOKEN; só então lê faturamento_cache via
// service_role e devolve o JSON. Sem token correto -> 403.
// Deploy: supabase functions deploy get-faturamento-publico --no-verify-jwt

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  // Painel ao vivo: nunca cachear — a TV precisa do estado mais recente a cada poll.
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// Comparação de tokens em tempo ~constante (evita timing trivial).
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const expected = Deno.env.get('PAINEL_TV_TOKEN');
  if (!expected) return json({ error: 'PAINEL_TV_TOKEN não configurado.' }, 500);

  // Token pode vir na query (?k=) ou no header x-painel-token.
  const url = new URL(req.url);
  const token = url.searchParams.get('k') || req.headers.get('x-painel-token') || '';
  if (!token || !safeEqual(token, expected)) {
    return json({ error: 'não autorizado' }, 403);
  }

  try {
    const supaUrl = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supaUrl || !key) return json({ error: 'ambiente Supabase indisponível' }, 500);

    const db = createClient(supaUrl, key);
    const { data, error } = await db
      .from('faturamento_cache')
      .select('total, ctes, total_hoje, faturamento_autorizado, valor_travado, pendencias, status, atualizado_em, sucesso_em')
      .eq('id', 1)
      .maybeSingle();

    if (error || !data) return json({ error: 'sem dados' }, 502);

    // --- A semana do gráfico ---
    // ISOLADA DO RESTO, DE PROPÓSITO. Em 25/09/2026 esta leitura derrubou o
    // painel inteiro: a função foi publicada antes de a tabela existir, o erro
    // subiu e a TV ficou em "Carregando…" — sem gráfico E sem o número do mês.
    // O número do mês é o que a parede existe para mostrar; ele não pode depender
    // do gráfico. Daqui para frente, qualquer falha aqui OMITE o campo `semana`
    // e o painel renderiza como antes, sem gráfico e sem erro.
    //
    // Série vazia também omite: sete barras zeradas não informam nada e só
    // ocupariam a tela.
    //
    // Uma consulta só, na janela de 7 dias. O que não veio do banco é dia futuro
    // (ou dia sem CTe) e entra com valor 0 — a barra existe, vazia, para a semana
    // ter sempre 7 colunas. O dia de HOJE vem parcial, por definição.
    let semana: Array<{ dia: string; valor: number; ctes: number; hoje: boolean; futuro: boolean }> | undefined;
    try {
      const dias = semanaCorrente();
      const hoje = hojeYMD();
      const { data: serie, error: erroSerie } = await db
        .from('faturamento_diario')
        .select('dia, valor, ctes')
        .gte('dia', dias[0])
        .lte('dia', dias[6]);
      if (erroSerie) throw new Error(erroSerie.message);
      if (serie && serie.length) {
        const porDia = new Map(serie.map(r => [String(r.dia).slice(0, 10), r]));
        semana = dias.map(dia => {
          const r = porDia.get(dia);
          return {
            dia,                                       // 'YYYY-MM-DD' (BRT)
            valor: r ? Number(r.valor) : 0,
            ctes: r ? Number(r.ctes) : 0,
            hoje: dia === hoje,
            futuro: dia > hoje,                        // comparação de texto: 'YYYY-MM-DD' ordena igual à data
          };
        });
      }
    } catch (e) {
      // Nunca propaga: o painel sem gráfico é muito melhor que painel nenhum.
      console.warn('semana indisponível (painel segue sem gráfico):', (e as Error).message);
    }

    // --- Ajuste manual do mês (NFS emitidas fora do TMS) ---
    // ISOLADO, pela mesma razão da semana: em 25/09 a TV ficou em "Carregando…"
    // porque uma leitura secundária derrubou a resposta inteira. O número do mês
    // é o que a parede existe para mostrar — se esta tabela sumir, estiver vazia
    // ou der erro, o painel mostra o TMS puro e ninguém fica sem número.
    //
    // Mês sem linha é o caso NORMAL: todo mês começa assim, e vira zero.
    let ajuste = 0;
    try {
      const { data: aj, error: erroAjuste } = await db
        .from('faturamento_ajuste_manual')
        .select('valor')
        .eq('mes', mesCorrente())
        .maybeSingle();
      if (erroAjuste) throw new Error(erroAjuste.message);
      const v = Number(aj?.valor);
      if (Number.isFinite(v)) ajuste = v;
    } catch (e) {
      console.warn('ajuste manual indisponível (painel segue com o TMS puro):', (e as Error).message);
    }

    const num = (v: unknown) => (v !== null && v !== undefined ? Number(v) : null);
    // O total que a TV mostra JÁ VEM SOMADO: um número só na parede, sem
    // composição. O gráfico da semana NÃO leva o ajuste — ele é só CTe do TMS,
    // e distribuir um total mensal pelos dias seria inventar data de emissão.
    const totalTms = num(data.total);
    const totalComAjuste = totalTms != null ? totalTms + ajuste : totalTms;
    return json({
      total: totalComAjuste,
      // Quem precisa da composição (Dashboard) lê as duas partes; a TV usa só o total.
      totalTms,
      ajusteManual: ajuste,
      ctes: data.ctes ?? null,
      totalHoje: num(data.total_hoje),
      // Dois números do painel: faturamento autorizado e valor travado (pendências).
      faturamentoAutorizado: num(data.faturamento_autorizado),
      valorTravado: num(data.valor_travado),
      pendencias: Array.isArray(data.pendencias) ? data.pendencias : [],
      status: data.status,
      atualizadoEm: data.atualizado_em,   // última tentativa (ok ou erro)
      sucessoEm: data.sucesso_em ?? null,  // última coleta BEM-SUCEDIDA (staleness)
      // Domingo -> sábado da semana corrente (BRT), sempre 7 itens. O servidor
      // decide qual é o domingo: a TV não tem como saber se o relógio dela está
      // no fuso certo, e um painel de parede fica ligado meses sem ninguém olhar.
      // AUSENTE quando a série falhou ou está vazia — o painel trata como
      // "sem gráfico" e desenha o resto normalmente.
      ...(semana ? { semana } : {}),
    });
  } catch (e) {
    return json({ error: 'falha ao ler faturamento', detalhe: (e as Error).message }, 502);
  }
});
