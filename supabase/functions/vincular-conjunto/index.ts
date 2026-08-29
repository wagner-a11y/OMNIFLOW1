import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { conferirPorta, HEADER_TOKEN } from "../_shared/porta.ts";

// ============================================================================
// vincular-conjunto — Fase 3C.
//
// Amarra veículos já cadastrados a um motorista. NÃO cria objeto "conjunto":
// o Datamex trata isso como vinculação, e os veículos são identificados por
// PLACA, não por id.
//
//   {consultarCpf}  -> GET  os vínculos atuais do motorista (204 = nenhum)
//   {vincular:{…}}  -> POST /transporte/v1/conjuntoVeiculos
//
// removerVinculacoes: SEMPRE enviado explicitamente, e o default aqui é "N".
// A doc diz que campo vazio equivale a "N", mas o exemplo da collection vem
// com "S" — quem copiasse o exemplo apagaria em silêncio todos os vínculos
// anteriores do motorista. Mandar "N" na mão é uma afirmação nossa, não uma
// aposta no default alheio. "S" só passa quando quem chama pede de propósito.
//
// Só POST, nunca PUT.
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

async function chamar(caminho: string, init?: { method?: string; body?: unknown }) {
  const res = await fetch(`${baseRest()}${caminho}`, {
    method: init?.method || "GET",
    headers: {
      Authorization: "Basic " + btoa(`${BSOFT_API_USER}:${BSOFT_API_PASS}`),
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
  });
  const texto = await res.text();
  let corpo: unknown = null;
  try { corpo = JSON.parse(texto); } catch { /* não-JSON */ }
  return { status: res.status, corpo, texto };
}

function mensagemDoBsoft(corpo: unknown, texto: string, status: number): string {
  const limpar = (s: string) => s.replace(/\?[^\s"']+/g, "?[...]").trim();
  if (corpo && typeof corpo === "object") {
    const o = corpo as Record<string, unknown>;
    for (const k of ["message", "mensagem", "error", "erro", "detail"]) {
      const v = o[k];
      if (typeof v === "string" && v.trim()) return limpar(v);
    }
  }
  return texto.trim() ? limpar(texto).slice(0, 400) : `Bsoft respondeu HTTP ${status}`;
}

/** Placa como a API quer: 8 caracteres com hífen na 4ª posição. */
function normalizarPlaca(bruta: string): string | null {
  const p = String(bruta ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (p.length !== 7) return null;
  if (!/^[A-Z]{3}[0-9]{4}$/.test(p) && !/^[A-Z]{3}[0-9][A-Z][0-9]{2}$/.test(p)) return null;
  return `${p.slice(0, 3)}-${p.slice(3)}`;
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

  let p: Record<string, any> = {};
  try { p = await req.json(); } catch { /* sem corpo */ }

  try {
    // ---- Leitura: o que este motorista já tem vinculado ----
    if (p.consultarCpf) {
      const cpf = soDigitos(p.consultarCpf);
      if (cpf.length !== 11) return json({ error: "CPF precisa ter 11 dígitos." }, 400);

      const r = await chamar(`/transporte/v1/conjuntoVeiculos?cpf=${encodeURIComponent(cpf)}`);
      // 204 = motorista sem nenhum vínculo. Não é erro.
      if (r.status === 204) return json({ vinculos: [] });
      if (r.status >= 400) return json({ error: mensagemDoBsoft(r.corpo, r.texto, r.status) }, 400);

      const lista = Array.isArray(r.corpo) ? r.corpo as Record<string, unknown>[] : [];
      return json({
        vinculos: lista.map((v) => ({
          id: String(v.id ?? ""),
          // O nome vem com espaço sobrando no fim; limpamos aqui.
          motorista: String(v.motorista ?? "").trim(),
          veiculo: String(v.veiculo ?? "").trim(),
        })),
      });
    }

    // ---- Escrita: vincula ----
    const v = (p.vincular ?? {}) as Record<string, any>;
    const motoristaId = String(v.motoristaId ?? "").trim();
    if (!motoristaId) return json({ error: "A vinculação exige o motorista." }, 400);

    const principal = normalizarPlaca(v.veiculo);
    if (!principal) return json({ error: "Placa do veículo de tração inválida." }, 400);

    // Cada implemento só entra se a placa for válida; posição vazia é omitida.
    const corpo: Record<string, unknown> = {
      motoristaId,
      veiculo: principal,
      // NUNCA omitido, NUNCA "S" por descuido: só vem "S" quando quem chama
      // pediu de propósito, depois de o operador confirmar na tela.
      removerVinculacoes: v.removerVinculacoes === "S" ? "S" : "N",
    };
    for (const [campo, valor] of [
      ["central", v.central], ["carreta", v.carreta], ["quartoVeiculo", v.quartoVeiculo],
    ] as Array<[string, string]>) {
      if (!valor) continue;
      const placa = normalizarPlaca(valor);
      if (!placa) return json({ error: `Placa inválida no implemento (${campo}).` }, 400);
      corpo[campo] = placa;
    }

    const r = await chamar("/transporte/v1/conjuntoVeiculos", { method: "POST", body: corpo });
    if (r.status >= 400) {
      return json({ error: mensagemDoBsoft(r.corpo, r.texto, r.status), status: r.status }, 400);
    }
    const o = (r.corpo ?? {}) as Record<string, unknown>;
    return json({
      ok: true,
      codVinculo: String(o.id ?? o.codConjunto ?? o.codigo ?? ""),
      removeuOutras: corpo.removerVinculacoes === "S",
    });
  } catch (e) {
    console.error("vincular-conjunto:", (e as Error).message);
    return json({ error: (e as Error).message || "Erro inesperado na vinculação." }, 500);
  }
});
