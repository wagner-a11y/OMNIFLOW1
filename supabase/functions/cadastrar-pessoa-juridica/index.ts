import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// ============================================================================
// cadastrar-pessoa-juridica — Fase 3B.
//
// Cria a empresa proprietária quando ela ainda não existe no Datamex. Caso
// menos comum: o normal é a PJ já estar lá e o fluxo só vincular.
//
// Campos obrigatórios pela doc: cnpj, razaoSocial, nomeFantasia, grupos.
// RNTRC e tipoTransportadora viram obrigatórios por entrar em
// `proprietariosVeiculos`. O RNTRC é o único que não vem do CRLV, por isso a
// tela pede em destaque.
//
// ATENÇÃO — a doc de Pessoas Jurídicas NÃO menciona tipoTransportadora, mas a
// API o EXIGE de empresa proprietária ("Atributo obrigatório
// [tipoTransportadora] não especificado"). A doc está incompleta, como já
// estava no tipoEquipamento do veículo. Medido em 26/08/2026.
//
// PJ continua bem mais simples que PF: não tem matriculaINSS nem
// dependentesIRRF, que são de pessoa natural.
//
// ANTI-DUPLICAÇÃO: procura pelo CNPJ antes de criar. Se já existir, devolve o
// código existente em vez de criar outra — e NÃO altera o cadastro dela, pela
// mesma razão de sempre: o PUT do Bsoft apaga grupos em silêncio.
//
// Só POST, nunca PUT.
// ============================================================================

const BSOFT_API_URL = Deno.env.get("BSOFT_API_URL") || "";
const BSOFT_API_USER = Deno.env.get("BSOFT_API_USER") || "";
const BSOFT_API_PASS = Deno.env.get("BSOFT_API_PASS") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform",
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

const auth = () => "Basic " + btoa(`${BSOFT_API_USER}:${BSOFT_API_PASS}`);
const soDigitos = (s: unknown) => String(s ?? "").replace(/\D/g, "");

async function chamar(caminho: string, init?: { method?: string; body?: unknown }) {
  const res = await fetch(`${baseRest()}${caminho}`, {
    method: init?.method || "GET",
    headers: {
      Authorization: auth(),
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

/** Enquadramentos aceitos pela API. Vazio é válido: o campo é opcional. */
const ENQUADRAMENTOS = ["s", "g", "r", "p", "m"];

/**
 * CONFIG AJUSTÁVEL — tipo de transportadora da PJ.
 *
 * A tela do Datamex oferece três opções (ETC, CTC, Equiparado) e empresa
 * proprietária de veículo é ETC. Pessoa física proprietária usa "T" (TAC), que
 * é o único valor documentado — a doc de Pessoas Jurídicas não menciona o campo,
 * mas a API o EXIGE quando a empresa entra em `proprietariosVeiculos`.
 *
 * Só o padrão é usado hoje. Os outros ficam mapeados para o dia em que aparecer
 * uma cooperativa ou uma equiparada.
 */
const TIPO_TRANSPORTADORA = {
  ETC: "E",          // Empresa de Transporte Rodoviário de Cargas — o caso da frota
  CTC: "C",          // Cooperativa — NÃO confirmado contra a API
  EQUIPARADO: "Q",   // Equiparado — NÃO confirmado contra a API
} as const;

/** Empresa proprietária de veículo é ETC. */
const TIPO_TRANSPORTADORA_PADRAO = TIPO_TRANSPORTADORA.ETC;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!BSOFT_API_USER || !BSOFT_API_PASS) {
    return json({ error: "Credencial do Bsoft não configurada." }, 500);
  }

  let p: Record<string, any> = {};
  try { p = await req.json(); } catch { /* sem corpo */ }

  const cnpj = soDigitos(p.cnpj);
  if (cnpj.length !== 14) return json({ error: "CNPJ precisa ter 14 dígitos." }, 400);
  if (!String(p.razaoSocial ?? "").trim()) return json({ error: "Razão social é obrigatória." }, 400);
  if (!String(p.nomeFantasia ?? "").trim()) return json({ error: "Nome fantasia é obrigatório." }, 400);
  // Entra em proprietariosVeiculos, então a API exige o RNTRC. Barramos aqui
  // para o operador ver a razão em português em vez do erro cru.
  if (!String(p.rntrc ?? "").trim()) {
    return json({ error: "O RNTRC é obrigatório para empresa proprietária de veículo." }, 400);
  }
  const enquadramento = String(p.enquadramento ?? "").trim().toLowerCase();
  if (enquadramento && !ENQUADRAMENTOS.includes(enquadramento)) {
    return json({ error: "Enquadramento inválido. Use s, g, r, p ou m." }, 400);
  }

  try {
    // 1. Já existe? Devolve o código e não mexe no cadastro.
    const busca = await chamar(`/pessoas/v1/pessoas/juridicas/${encodeURIComponent(cnpj)}`);
    if (busca.status !== 404 && busca.status < 400) {
      const lista = Array.isArray(busca.corpo)
        ? busca.corpo as Record<string, unknown>[]
        : (busca.corpo && typeof busca.corpo === "object" ? [busca.corpo as Record<string, unknown>] : []);
      const achada = lista.find((x) => soDigitos(x.cnpj) === cnpj);
      if (achada) {
        return json({
          codPessoa: String(achada.id ?? ""),
          jaExistia: true,
          razaoSocial: String(achada.razaoSocial ?? ""),
          aviso: "Essa empresa já existia no Datamex — usei o cadastro dela e não alterei nada. " +
                 "Se ela ainda não estiver no grupo de proprietários de veículos, marque isso no Datamex.",
        });
      }
    }

    // 2. Cria. Molde conforme a doc de Pessoas Jurídicas.
    const grupos = Array.isArray(p.grupos) && p.grupos.length
      ? (p.grupos as string[])
      : ["proprietariosVeiculos"];
    const ehProprietaria = grupos.some((g) => String(g) === "proprietariosVeiculos");

    const novo: Record<string, unknown> = {
      cnpj,
      razaoSocial: String(p.razaoSocial).trim(),
      nomeFantasia: String(p.nomeFantasia).trim(),
      grupos,
      RNTRC: String(p.rntrc).trim(),
    };
    // Só entra para quem é proprietária de veículo. PJ que é apenas cliente ou
    // fornecedor não é transportadora e não deve ser classificada como uma.
    if (ehProprietaria) {
      novo.tipoTransportadora = p.tipoTransportadora || TIPO_TRANSPORTADORA_PADRAO;
    }
    if (enquadramento) novo.enquadramento = enquadramento;
    if (p.celular) novo.celular = p.celular;
    if (p.email) novo.email = p.email;

    const criada = await chamar("/pessoas/v1/pessoas/juridicas", { method: "POST", body: novo });
    if (criada.status >= 400) {
      return json({
        error: mensagemDoBsoft(criada.corpo, criada.texto, criada.status),
        status: criada.status,
      }, 400);
    }

    const o = (criada.corpo ?? {}) as Record<string, unknown>;
    const codPessoa = String(o.codPessoa ?? o.codigo ?? o.id ?? "");
    if (!codPessoa) {
      return json({ error: "O Datamex aceitou o cadastro mas não devolveu o código da empresa." }, 502);
    }
    return json({ codPessoa, jaExistia: false, razaoSocial: novo.razaoSocial });
  } catch (e) {
    console.error("cadastrar-pessoa-juridica:", (e as Error).message);
    return json({ error: (e as Error).message || "Erro inesperado no cadastro da empresa." }, 500);
  }
});
