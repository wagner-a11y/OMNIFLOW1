import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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

    const num = (v: unknown) => (v !== null && v !== undefined ? Number(v) : null);
    return json({
      total: num(data.total),
      ctes: data.ctes ?? null,
      totalHoje: num(data.total_hoje),
      // Dois números do painel: faturamento autorizado e valor travado (pendências).
      faturamentoAutorizado: num(data.faturamento_autorizado),
      valorTravado: num(data.valor_travado),
      pendencias: Array.isArray(data.pendencias) ? data.pendencias : [],
      status: data.status,
      atualizadoEm: data.atualizado_em,   // última tentativa (ok ou erro)
      sucessoEm: data.sucesso_em ?? null,  // última coleta BEM-SUCEDIDA (staleness)
    });
  } catch (e) {
    return json({ error: 'falha ao ler faturamento', detalhe: (e as Error).message }, 502);
  }
});
