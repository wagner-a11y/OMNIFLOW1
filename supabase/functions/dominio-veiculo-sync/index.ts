import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// ============================================================================
// dominio-veiculo-sync — Fase 1 do Cadastro Automático de Motorista/Veículo.
//
// Puxa as três tabelas de domínio de veículos da API REST do Bsoft/Datamex
// (marca, categoria, grupo) e espelha em public.dominio_veiculo, para servir de
// dicionário de tradução: nome lido de um documento -> código interno do Bsoft.
//
// READ-ONLY do lado do Bsoft: só faz GET. Escreve apenas na tabela nova, com
// service_role (que bypassa a RLS — a tabela não tem policy de escrita).
//
// Dois modos:
//   {}              -> sincroniza e devolve as contagens
//   {"probe": true} -> NÃO grava. Só busca e devolve UM item cru de cada
//                      endpoint, para conferir o formato antes de confiar nele.
//
// Só o formato de `marca` é conhecido ({id, marca, categoria}); categoria e
// grupo são lidos defensivamente, aceitando as chaves prováveis.
// ============================================================================

const BSOFT_API_URL = Deno.env.get("BSOFT_API_URL") || "";
const BSOFT_API_USER = Deno.env.get("BSOFT_API_USER") || "";
const BSOFT_API_PASS = Deno.env.get("BSOFT_API_PASS") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/**
 * Base REST de serviços do Bsoft.
 *
 * ATENÇÃO: BSOFT_API_URL NÃO é essa base — aponta para outro serviço
 * (scripts/?cmd=ambiente.consultasSQL...) e traz TOKEN na query string. Por isso
 * aproveitamos só a ORIGEM (host) dele e montamos o path aqui; concatenar sobre
 * a URL inteira produziria lixo e carregaria o token junto.
 * Base resultante: https://<host>/services/index.php
 *
 * O valor derivado nunca é logado nem devolvido na resposta.
 */
function baseDeServicos(url: string): string {
  const limpa = (url || "").trim();
  if (!limpa) return "";
  try {
    return `${new URL(limpa).origin}/services/index.php`;
  } catch {
    return "";
  }
}

const ENDPOINTS = {
  marca: "/transporte/v1/marcaVeiculos",
  categoria: "/transporte/v1/categoriasVeiculos",
  grupo: "/transporte/v1/gruposVeiculos",
} as const;

type Tipo = keyof typeof ENDPOINTS;

/** Primeiro valor não-vazio entre as chaves candidatas. */
function pega(obj: Record<string, unknown>, chaves: string[]): string | null {
  for (const k of chaves) {
    // Case-insensitive: o Bsoft mistura "Descricao"/"descricao" entre endpoints.
    const achada = Object.keys(obj).find((o) => o.toLowerCase() === k.toLowerCase());
    if (!achada) continue;
    const v = obj[achada];
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}

/** A resposta pode vir como array puro ou embrulhada — acha a lista. */
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

async function buscar(base: string, tipo: Tipo): Promise<
  { ok: true; lista: Record<string, unknown>[] }
  | { ok: false; status: number; erro: string; contentType?: string }
> {
  const auth = "Basic " + btoa(`${BSOFT_API_USER}:${BSOFT_API_PASS}`);
  const url = `${base}${ENDPOINTS[tipo]}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: auth, Accept: "application/json" },
  });
  const texto = await res.text();

  // SEGURANÇA: nada do corpo da resposta é propagado. O Bsoft ecoa a URL
  // recebida nas mensagens de erro, e a URL carrega o token do secret — foi
  // assim que um token vazou num diagnóstico em 21/08/2026. Só o content-type
  // (que não carrega dado) sai daqui.
  const contentType = res.headers.get("content-type") || "(sem content-type)";

  if (res.status === 401 || res.status === 403) {
    return { ok: false, status: res.status, erro: "Falha de auth na API Bsoft", contentType };
  }
  if (!res.ok) {
    return { ok: false, status: res.status, erro: `Bsoft respondeu HTTP ${res.status}`, contentType };
  }
  try {
    const lista = comoLista(JSON.parse(texto));
    // Só a contagem e as chaves — nunca valores, nunca URL.
    console.log(`[${tipo}] itens=${lista.length} chaves=${JSON.stringify(Object.keys(lista[0] ?? {}))}`);
    return { ok: true, lista };
  } catch {
    return { ok: false, status: res.status, erro: `Resposta de ${tipo} não é JSON`, contentType };
  }
}

/**
 * Converte um item cru na linha de dominio_veiculo, pelo formato REAL de cada
 * endpoint (confirmado por probe em 21/08/2026):
 *   marca     {id, marca, categoria}
 *   categoria {id, categoria, nome_interno}
 *   grupo     {id, grupo, tipo_frota, ativo, empresa:{id, descricao, cnpj}}
 *
 * As chaves alternativas continuam na busca como rede de segurança, caso o Bsoft
 * mude o formato — mas a chave real vem primeiro.
 * Devolve null quando falta código ou nome (item inaproveitável).
 */
function paraLinha(tipo: Tipo, item: Record<string, unknown>) {
  const codigo = pega(item, ["id", "codigo", "cod"]);
  if (!codigo) return null;

  let nome: string | null = null;
  let categoria_ref: string | null = null;
  let nome_interno: string | null = null;
  let empresa_id: string | null = null;

  if (tipo === "marca") {
    nome = pega(item, ["marca", "nome", "descricao"]);
    categoria_ref = pega(item, ["categoria"]);
  } else if (tipo === "categoria") {
    nome = pega(item, ["categoria", "nome", "descricao"]);
    nome_interno = pega(item, ["nome_interno"]);
  } else {
    nome = pega(item, ["grupo", "nome", "descricao"]);
    const emp = item["empresa"];
    if (emp && typeof emp === "object") {
      empresa_id = pega(emp as Record<string, unknown>, ["id", "codigo"]);
    }
  }
  if (!nome) return null;

  return { tipo, codigo, nome, categoria_ref, nome_interno, empresa_id, atualizado_em: new Date().toISOString() };
}

/**
 * Grupo inativo não entra no dicionário: `ativo` vem como "S"/"N" no Bsoft.
 * Só filtra grupo — marca e categoria não trazem esse campo.
 */
function grupoAtivo(item: Record<string, unknown>): boolean {
  const a = pega(item, ["ativo"]);
  return a === null || a.toUpperCase() === "S";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (!BSOFT_API_URL || !BSOFT_API_USER || !BSOFT_API_PASS) {
    return json({ error: "Secrets do Bsoft ausentes (BSOFT_API_URL/USER/PASS)." }, 500);
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ error: "Ambiente sem SUPABASE_URL/SERVICE_ROLE_KEY." }, 500);
  }

  let probe = false;
  try {
    const corpo = await req.json();
    probe = !!corpo?.probe;
  } catch { /* sem corpo = sync normal */ }

  const base = baseDeServicos(BSOFT_API_URL);
  const tipos: Tipo[] = ["marca", "categoria", "grupo"];

  try {
    // ---- Busca os três antes de gravar qualquer coisa ----
    const brutos: Record<string, Record<string, unknown>[]> = {};
    for (const tipo of tipos) {
      const r = await buscar(base, tipo);
      if (!r.ok) {
        return json({
          error: r.erro, tipo, status: r.status,
          endpoint: ENDPOINTS[tipo],   // só o path; a base NUNCA é ecoada (carrega token)
          contentType: r.contentType,
        }, r.status === 401 || r.status === 403 ? 401 : 502);
      }
      brutos[tipo] = r.lista;
    }

    // ---- Modo probe: devolve o formato e NÃO grava ----
    if (probe) {
      return json({
        probe: true,
        gravou: false,
        // A base NÃO é devolvida: BSOFT_API_URL traz token em query string.
        formatos: tipos.map((t) => ({
          tipo: t,
          endpoint: ENDPOINTS[t],
          itens: brutos[t].length,
          chaves: brutos[t][0] ? Object.keys(brutos[t][0]) : [],   // só as chaves, nunca os valores
        })),
      });
    }

    // ---- Sync: converte, descarta o que não tem código/nome, faz upsert ----
    const contagens: Record<string, number> = {};
    const descartados: Record<string, number> = {};
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    for (const tipo of tipos) {
      // Grupo inativo é descartado antes de virar linha.
      const elegiveis = tipo === "grupo" ? brutos[tipo].filter(grupoAtivo) : brutos[tipo];
      const linhas = elegiveis.map((i) => paraLinha(tipo, i)).filter((l): l is NonNullable<typeof l> => l !== null);
      descartados[tipo] = brutos[tipo].length - linhas.length;

      if (linhas.length) {
        const { error } = await sb
          .from("dominio_veiculo")
          .upsert(linhas, { onConflict: "tipo,codigo" });
        if (error) return json({ error: `Falha ao gravar ${tipo}: ${error.message}` }, 500);
      }
      contagens[tipo] = linhas.length;
    }

    return json({
      marcas: contagens.marca,
      categorias: contagens.categoria,
      grupos: contagens.grupo,
      descartados,   // itens sem código ou sem nome, se houver
      atualizado: new Date().toISOString(),
    });
  } catch (e) {
    // Nunca ecoa credencial: só a mensagem do erro.
    console.error("dominio-veiculo-sync:", e);
    return json({ error: (e as Error).message || "Erro inesperado no sync." }, 500);
  }
});
