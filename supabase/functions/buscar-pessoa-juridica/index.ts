import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { conferirPorta, HEADER_TOKEN } from "../_shared/porta.ts";

// ============================================================================
// buscar-pessoa-juridica — Fase 3B.
//
// SÓ LEITURA. Procura a empresa pelo CNPJ para o cadastro de veículo vincular
// como proprietário. É uma função separada da que grava de propósito: quem só
// consulta não deve carregar a capacidade de escrever.
//
// O Bsoft busca por CAMINHO com os dígitos puros — comprovado por probe em
// 23/08/2026: máscara devolve 404 e query string devolve 400. Mesma regra que
// já valia para pessoa física.
//
// ATENÇÃO: o GET de pessoa jurídica NÃO devolve `grupos`. Não há como saber
// daqui se a empresa está em `proprietariosVeiculos` — quem recusa é o POST do
// veículo, e a mensagem dele é repassada ao operador.
//
// SEGURANÇA: BSOFT_API_URL não é a base REST (traz token na query string). A
// base sai da ORIGEM dele. Nem URL, nem credencial saem em log ou resposta.
// ============================================================================

const BSOFT_API_URL = Deno.env.get("BSOFT_API_URL") || "";
const BSOFT_API_USER = Deno.env.get("BSOFT_API_USER") || "";
const BSOFT_API_PASS = Deno.env.get("BSOFT_API_PASS") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": `authorization, x-client-info, apikey, content-type, x-supabase-client-platform, ${HEADER_TOKEN}`,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function baseRest(): string {
  try {
    return `${new URL(BSOFT_API_URL.trim()).origin}/services/index.php`;
  } catch {
    return "https://mgwtransportes.e-login.net/services/index.php";
  }
}

const soDigitos = (s: unknown) => String(s ?? "").replace(/\D/g, "");

function mensagemDoBsoft(corpo: unknown, status: number): string {
  if (corpo && typeof corpo === "object") {
    const o = corpo as Record<string, unknown>;
    for (const k of ["message", "mensagem", "error", "erro", "detail"]) {
      const v = o[k];
      if (typeof v === "string" && v.trim()) return v.replace(/\?[^\s"']+/g, "?[...]").trim();
    }
  }
  return `Bsoft respondeu HTTP ${status}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Porta de entrada: usuário logado ou token do link de cadastro externo.
  // A anon key sozinha NÃO passa — ela é pública (vai no bundle) e nunca foi
  // credencial. Ver supabase/functions/_shared/porta.ts.
  const porta = conferirPorta(req);
  if (!porta.ok) return json({ error: porta.erro }, porta.status);
  if (!BSOFT_API_USER || !BSOFT_API_PASS) {
    return json({ error: "Credencial do Bsoft não configurada." }, 500);
  }

  let corpoReq: Record<string, unknown> = {};
  try { corpoReq = await req.json(); } catch { /* sem corpo */ }

  const cnpj = soDigitos(corpoReq.cnpj);
  if (cnpj.length !== 14) return json({ error: "CNPJ precisa ter 14 dígitos." }, 400);

  try {
    const res = await fetch(`${baseRest()}/pessoas/v1/pessoas/juridicas/${encodeURIComponent(cnpj)}`, {
      headers: {
        Authorization: "Basic " + btoa(`${BSOFT_API_USER}:${BSOFT_API_PASS}`),
        Accept: "application/json",
      },
    });
    const texto = await res.text();
    let corpo: unknown = null;
    try { corpo = JSON.parse(texto); } catch { /* não-JSON */ }

    // 404 = não existe, e é resposta legítima: leva ao mini-cadastro na tela.
    if (res.status === 404) return json({ existe: false });
    if (res.status === 401 || res.status === 403) {
      return json({ error: "Falha de auth na API Bsoft ao consultar empresas." }, 401);
    }
    if (res.status >= 400) return json({ error: mensagemDoBsoft(corpo, res.status) }, 400);

    const lista = Array.isArray(corpo)
      ? corpo as Record<string, unknown>[]
      : (corpo && typeof corpo === "object" ? [corpo as Record<string, unknown>] : []);
    const achada = lista.find((x) => soDigitos(x.cnpj) === cnpj);
    if (!achada) return json({ existe: false });

    return json({
      existe: true,
      codPessoa: String(achada.id ?? achada.codPessoa ?? ""),
      cnpj: String(achada.cnpj ?? ""),
      razaoSocial: String(achada.razaoSocial ?? ""),
      nomeFantasia: String(achada.nomeFantasia ?? ""),
    });
  } catch (e) {
    console.error("buscar-pessoa-juridica:", (e as Error).message);
    return json({ error: (e as Error).message || "Erro inesperado na consulta." }, 500);
  }
});
