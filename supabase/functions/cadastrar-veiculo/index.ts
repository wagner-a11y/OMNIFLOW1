import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// ============================================================================
// cadastrar-veiculo — Fase 3A do Cadastro Automático.
//
// Cria UM veículo na API REST do Bsoft a partir do que o operador CONFERIU na
// tela. O molde replica fielmente o POST que gravou o codVeiculo 4354 em
// 23/08/2026 — o primeiro que a API aceitou depois de três recusas, e cada uma
// delas virou uma validação aqui:
//   HTTP 400  "Atributo [placa] com conteúdo inválido"      -> placa exige hífen
//   HTTP 400  "[tipoEquipamento] não especificado"          -> campo obrigatório
//   HTTP 422  "'Capacidade M³' deve ser maior que zero"     -> capM3 > 0
//
// As três são barradas AQUI, antes da chamada, para o operador receber uma
// mensagem em português em vez de um erro cru do Bsoft.
//
// NUNCA usa PUT. Só POST, só criação — a regra vem do cadastro de pessoa, onde
// o PUT apaga grupos em silêncio.
//
// SEGURANÇA: BSOFT_API_URL não é a base REST (aponta para a consulta SQL e traz
// token na query string). A base é montada a partir da ORIGEM dele. Nem URL,
// nem credencial, nem corpo cru do Bsoft saem em log.
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

/** Base REST montada a partir da ORIGEM do secret — nunca da URL inteira. */
function baseRest(): string {
  try {
    return `${new URL(BSOFT_API_URL.trim()).origin}/services/index.php`;
  } catch {
    return "https://mgwtransportes.e-login.net/services/index.php";
  }
}

const basic = () => "Basic " + btoa(`${BSOFT_API_USER}:${BSOFT_API_PASS}`);

async function chamar(caminho: string, init?: { method?: string; body?: unknown }) {
  const res = await fetch(`${baseRest()}${caminho}`, {
    method: init?.method || "GET",
    headers: {
      Authorization: basic(),
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

/**
 * Mensagem do Bsoft sem a URL que ele costuma ecoar (a URL pode carregar token).
 * Por precaução, qualquer query string é removida antes de devolver.
 */
function mensagemDoBsoft(corpo: unknown, texto: string, status: number): string {
  const limpar = (s: string) => s.replace(/\?[^\s"']+/g, "?[...]").trim();
  if (corpo && typeof corpo === "object") {
    const o = corpo as Record<string, unknown>;
    for (const k of ["message", "mensagem", "error", "erro", "detail", "descricao"]) {
      const v = o[k];
      if (typeof v === "string" && v.trim()) return limpar(v);
    }
  }
  return texto.trim() ? limpar(texto).slice(0, 400) : `Bsoft respondeu HTTP ${status}`;
}

const soAlfaNum = (s: unknown) => String(s ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();

/**
 * Placa no formato que a API aceita: 8 caracteres com hífen na 4ª posição.
 * Serve os dois padrões em circulação — o antigo (AAA-0000) e o Mercosul
 * (AAA-0A00). Devolve null quando não é nenhum dos dois, e aí não há POST.
 */
export function normalizarPlaca(bruta: string): string | null {
  const p = soAlfaNum(bruta);
  if (p.length !== 7) return null;
  const antiga = /^[A-Z]{3}[0-9]{4}$/;
  const mercosul = /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/;
  if (!antiga.test(p) && !mercosul.test(p)) return null;
  return `${p.slice(0, 3)}-${p.slice(3)}`;
}

/** Lista da frota, usada só para a anti-duplicação. */
function comoLista(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  if (payload && typeof payload === "object") {
    const o = payload as Record<string, unknown>;
    for (const k of ["data", "items", "result", "results", "dados", "registros", "rows"]) {
      if (Array.isArray(o[k])) return o[k] as Record<string, unknown>[];
    }
  }
  return [];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!BSOFT_API_USER || !BSOFT_API_PASS) {
    return json({ error: "Credencial do Bsoft não configurada." }, 500);
  }

  let p: Record<string, any> = {};
  try { p = await req.json(); } catch { /* sem corpo */ }

  try {
    // ---- 1. Placa: formato antes de tudo, é o que a API recusa primeiro ----
    const placa = normalizarPlaca(p.placa);
    if (!placa) {
      return json({
        error: "Placa inválida. Use o padrão antigo (ABC-1234) ou Mercosul (ABC-1D23).",
      }, 400);
    }

    // ---- 2. capM3 > 0 (a API devolve 422 quando é zero) ----
    const capM3 = Number(String(p.capM3 ?? "").replace(",", "."));
    if (!capM3 || capM3 <= 0) {
      return json({
        error: "A capacidade em m³ deve ser maior que zero — o Datamex recusa o cadastro com zero.",
      }, 400);
    }

    // ---- 3. Proprietário: existe e está no grupo de proprietários? ----
    const proprietarioId = String(p.proprietarioId ?? "").trim();
    if (!proprietarioId) return json({ error: "Selecione o proprietário do veículo." }, 400);

    const pessoa = await chamar(`/pessoas/v1/pessoas/fisicas/${encodeURIComponent(proprietarioId)}`);
    if (pessoa.status === 404 || !pessoa.corpo) {
      return json({ error: `Não achei a pessoa ${proprietarioId} no Datamex.` }, 400);
    }
    if (pessoa.status >= 400) {
      return json({ error: mensagemDoBsoft(pessoa.corpo, pessoa.texto, pessoa.status) }, 400);
    }

    // ---- 4. Anti-duplicação: placa E chassi, antes de qualquer escrita ----
    const chassi = String(p.chassi ?? "").trim().toUpperCase();
    const frota = await chamar("/transporte/v1/veiculos");
    if (frota.status >= 400) {
      return json({ error: "Não consegui consultar a frota para checar duplicidade. Nada foi gravado." }, 502);
    }
    const veiculos = comoLista(frota.corpo);
    const mesmaPlaca = veiculos.find((v) => soAlfaNum(v.placa) === soAlfaNum(placa));
    if (mesmaPlaca) {
      return json({
        jaExistia: true,
        codVeiculo: String(mesmaPlaca.id ?? ""),
        error: `A placa ${placa} já está cadastrada no Datamex (veículo ${mesmaPlaca.id}). Não criei outro.`,
      }, 409);
    }
    if (chassi) {
      const mesmoChassi = veiculos.find((v) => String(v.chassi ?? "").toUpperCase() === chassi);
      if (mesmoChassi) {
        return json({
          jaExistia: true,
          codVeiculo: String(mesmoChassi.id ?? ""),
          error: `Esse chassi já está no veículo ${mesmoChassi.id} (placa ${mesmoChassi.placa}). Não criei outro.`,
        }, 409);
      }
    }

    // ---- 5. Cria. Molde idêntico ao que gravou o 4354. ----
    const corpo: Record<string, unknown> = {
      descricao: p.descricao || `${p.marcaNome ?? ""} ${p.modelo ?? ""}`.trim() || placa,
      placa,
      chassi,
      renavam: String(p.renavam ?? "").replace(/\D/g, ""),
      anoModelo: String(p.anoModelo ?? ""),
      anoFabricacao: String(p.anoFabricacao ?? ""),
      cor: p.cor ?? "",
      estado: p.estado ?? "",
      cidade: String(p.cidade ?? ""),
      categoriaVeiculo: String(p.categoriaVeiculo ?? ""),
      marcaVeiculo: String(p.marcaVeiculo ?? ""),
      // Texto livre, e não o código de dicionário da marca. Sem ele o veículo
      // entra sem modelo e o CT-e não emite.
      modeloVeiculo: String(p.modelo ?? ""),
      grupoVeiculo: String(p.grupoVeiculo ?? ""),
      // Fixo em "0" — sem classificação, que é o mesmo que a tela oficial do
      // Datamex grava. A API EXIGE o campo (400 sem ele), mas não existe
      // endpoint que liste os tipos, então não há o que escolher. Quando a
      // lista aparecer, é só trocar aqui.
      tipoEquipamento: "0",
      tara: String(p.tara ?? ""),
      capM3: String(capM3),
      capacidadeCarga: String(p.capacidadeCarga ?? ""),
      quantidadeEixos: String(p.quantidadeEixos ?? ""),
      tipoRodado: String(p.tipoRodado ?? ""),
      tipoCarroceria: String(p.tipoCarroceria ?? ""),
      proprietarioId,
    };

    const criado = await chamar("/transporte/v1/veiculos", { method: "POST", body: corpo });
    if (criado.status >= 400) {
      // A mensagem do Bsoft diz qual campo ele recusou — é o que o operador precisa.
      return json({
        error: mensagemDoBsoft(criado.corpo, criado.texto, criado.status),
        status: criado.status,
      }, 400);
    }

    const codVeiculo = criado.corpo && typeof criado.corpo === "object"
      ? String((criado.corpo as Record<string, unknown>).codVeiculo ?? "")
      : "";
    if (!codVeiculo) {
      return json({ error: "O Datamex aceitou o cadastro mas não devolveu o código do veículo." }, 502);
    }
    return json({ codVeiculo, placa });
  } catch (e) {
    console.error("cadastrar-veiculo:", (e as Error).message);
    return json({ error: (e as Error).message || "Erro inesperado no cadastro do veículo." }, 500);
  }
});
