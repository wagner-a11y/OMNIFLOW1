import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { conferirPorta, HEADER_TOKEN } from "../_shared/porta.ts";

// ============================================================================
// dominio-veiculo-ler — SÓ LEITURA do dicionário de tradução do CRLV.
//
// Existe por causa da tela de cadastro por link, que roda sem sessão: a RLS de
// public.dominio_veiculo libera SELECT para `authenticated`, então sem login a
// leitura volta 401 e a tradução do CRLV fica sem dicionário — a tela abriria
// e não conseguiria traduzir marca nem categoria.
//
// A alternativa seria dar SELECT para `anon`, o que publicaria a tabela para
// qualquer um com a anon key (que é pública). Aqui a leitura fica atrás da
// MESMA porta do resto do cadastro: usuário logado ou token do link.
//
// Função separada da dominio-veiculo-sync de propósito: aquela ESCREVE e chama
// o Bsoft. Quem só precisa ler o dicionário não deve carregar junto a
// capacidade de sincronizar.
//
// Deploy: supabase functions deploy dominio-veiculo-ler
// ============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": `authorization, x-client-info, apikey, content-type, x-supabase-client-platform, ${HEADER_TOKEN}`,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const porta = conferirPorta(req);
  if (!porta.ok) return json({ error: porta.erro }, porta.status);

  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !key) return json({ error: "ambiente Supabase indisponível" }, 500);

  // service_role para atravessar a RLS. Devolve SÓ as cinco colunas do
  // dicionário — nada de `select *`, que passaria a vazar qualquer coluna
  // acrescentada à tabela depois, sem ninguém reparar.
  const db = createClient(url, key);
  const { data, error } = await db
    .from("dominio_veiculo")
    .select("tipo, codigo, nome, categoria_ref, nome_interno");

  if (error) return json({ error: "não consegui ler o dicionário de veículos" }, 502);
  return json({ dominio: data ?? [] });
});
