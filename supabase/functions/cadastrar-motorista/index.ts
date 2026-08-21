import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// ============================================================================
// cadastrar-motorista — Fase 2 do Cadastro Automático.
//
// Cria (ou reaproveita) a pessoa física do motorista na API REST do Bsoft, a
// partir dos dados já CONFERIDOS pelo operador na tela. Opcionalmente anexa a
// CNH ao cadastro.
//
// ANTI-DUPLICAÇÃO: antes de criar, procura pelo CPF. Se a pessoa já existe, NÃO
// cria de novo — devolve o codPessoa existente com jaExistia=true e garante que
// ela esteja no grupo 'motoristas'.
//
// SEGURANÇA: BSOFT_API_URL NÃO é a base REST (aponta para a consulta SQL e traz
// token na query string). Aqui a base é montada por conta própria. Nem a URL,
// nem credencial, nem corpo de resposta do Bsoft saem em log ou na resposta —
// só a mensagem de erro que o Bsoft devolve em JSON (que diz qual campo faltou).
// ============================================================================

const BSOFT_API_URL = Deno.env.get("BSOFT_API_URL") || "";
const BSOFT_API_USER = Deno.env.get("BSOFT_API_USER") || "";
const BSOFT_API_PASS = Deno.env.get("BSOFT_API_PASS") || "";
const DATAMEX_USUARIO = Deno.env.get("DATAMEX_USUARIO") || "";
const DATAMEX_SENHA = Deno.env.get("DATAMEX_SENHA") || "";

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

/** Pares de credencial candidatos, em ordem de preferência. */
function credenciais(): Array<{ nome: string; user: string; pass: string }> {
  const lista: Array<{ nome: string; user: string; pass: string }> = [];
  if (BSOFT_API_USER && BSOFT_API_PASS) lista.push({ nome: "BSOFT_API_USER/PASS", user: BSOFT_API_USER, pass: BSOFT_API_PASS });
  if (DATAMEX_USUARIO && DATAMEX_SENHA) lista.push({ nome: "DATAMEX_USUARIO/SENHA", user: DATAMEX_USUARIO, pass: DATAMEX_SENHA });
  return lista;
}

const basic = (user: string, pass: string) => "Basic " + btoa(`${user}:${pass}`);

/** Chamada ao Bsoft. Devolve status e corpo JSON quando houver. Nunca ecoa a URL. */
async function chamar(
  cred: { user: string; pass: string },
  caminho: string,
  init?: { method?: string; body?: unknown },
): Promise<{ status: number; corpo: unknown; texto: string }> {
  const res = await fetch(`${baseRest()}${caminho}`, {
    method: init?.method || "GET",
    headers: {
      Authorization: basic(cred.user, cred.pass),
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
  });
  const texto = await res.text();
  let corpo: unknown = null;
  try { corpo = JSON.parse(texto); } catch { /* não-JSON: fica null */ }
  return { status: res.status, corpo, texto };
}

/** Mensagem de erro do Bsoft, sem vazar a URL que ele costuma ecoar. */
function mensagemDoBsoft(corpo: unknown, status: number): string {
  if (corpo && typeof corpo === "object") {
    const o = corpo as Record<string, unknown>;
    for (const k of ["message", "mensagem", "error", "erro", "detail", "descricao"]) {
      const v = o[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    // Alguns endpoints devolvem {erros:[{campo,mensagem}]}
    const arr = (o.erros ?? o.errors) as unknown;
    if (Array.isArray(arr) && arr.length) {
      return arr.map((e) => {
        if (e && typeof e === "object") {
          const eo = e as Record<string, unknown>;
          return [eo.campo, eo.mensagem ?? eo.message].filter(Boolean).join(": ");
        }
        return String(e);
      }).join(" | ");
    }
  }
  return `Bsoft respondeu HTTP ${status}`;
}

/** Só dígitos — o Bsoft rejeita CPF pontuado em alguns endpoints. */
const soDigitos = (s: unknown) => String(s ?? "").replace(/\D/g, "");

/** Extrai o código da pessoa de formatos variados de resposta. */
function codDaPessoa(obj: unknown): string | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  for (const k of ["codPessoa", "codigoPessoa", "codigo", "id"]) {
    const v = o[k];
    if (v !== null && v !== undefined && String(v).trim()) return String(v).trim();
  }
  return null;
}

/** Acha a lista dentro de um payload que pode vir embrulhado. */
function comoLista(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  if (payload && typeof payload === "object") {
    const o = payload as Record<string, unknown>;
    for (const k of ["data", "items", "result", "results", "dados", "registros", "pessoas", "rows"]) {
      if (Array.isArray(o[k])) return o[k] as Record<string, unknown>[];
    }
  }
  return [];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const creds = credenciais();
  if (!creds.length) return json({ error: "Nenhuma credencial do Bsoft configurada." }, 500);

  let corpoReq: Record<string, unknown> = {};
  try { corpoReq = await req.json(); } catch { /* sem corpo */ }

  // ---- Modo probe: descobre QUAL par de credencial autentica. Não grava. ----
  if (corpoReq?.probe) {
    const resultados = [];
    for (const c of creds) {
      try {
        const r = await chamar(c, "/pessoas/v1/pessoas/fisicas?limit=1");
        resultados.push({
          credencial: c.nome,            // só o NOME do secret, nunca o valor
          status: r.status,
          autenticou: r.status !== 401 && r.status !== 403,
          pareceJson: r.corpo !== null,
        });
      } catch (e) {
        resultados.push({ credencial: c.nome, status: 0, autenticou: false, erro: (e as Error).message });
      }
    }
    return json({ probe: true, gravou: false, endpoint: "/pessoas/v1/pessoas/fisicas", resultados });
  }

  // ---- Cadastro real ----
  const p = corpoReq as Record<string, any>;
  const cpf = soDigitos(p.cpf);
  if (!cpf) return json({ error: "CPF é obrigatório." }, 400);
  if (!p.nome) return json({ error: "Nome é obrigatório." }, 400);

  // Usa o primeiro par que autenticar — decidido em runtime, sem hardcode.
  let cred = creds[0];
  for (const c of creds) {
    const t = await chamar(c, "/pessoas/v1/pessoas/fisicas?limit=1");
    if (t.status !== 401 && t.status !== 403) { cred = c; break; }
  }

  try {
    // 1) Já existe alguém com este CPF?
    const busca = await chamar(cred, `/pessoas/v1/pessoas/fisicas?cpf=${encodeURIComponent(cpf)}`);
    if (busca.status === 401 || busca.status === 403) {
      return json({ error: "Falha de auth na API Bsoft ao consultar pessoas." }, 401);
    }
    const achados = comoLista(busca.corpo).filter((x) => soDigitos(x.cpf) === cpf);
    const existente = achados.length ? codDaPessoa(achados[0]) : null;

    let codPessoa = existente;
    let jaExistia = false;

    if (existente) {
      jaExistia = true;
      // Garante o grupo 'motoristas' sem sobrescrever os grupos que já tem.
      const atual = achados[0];
      const grupos = Array.isArray(atual.grupos) ? (atual.grupos as unknown[]).map(String) : [];
      const temMotorista = grupos.some((g) => g.toLowerCase().includes("motorista"));
      if (!temMotorista) {
        const put = await chamar(cred, `/pessoas/v1/pessoas/fisicas/${encodeURIComponent(existente)}`, {
          method: "PUT",
          body: { grupos: [...grupos, "motoristas"] },
        });
        if (put.status >= 400) {
          return json({
            codPessoa: existente, jaExistia: true, anexado: false,
            aviso: `Pessoa já existia, mas não consegui adicionar ao grupo motoristas: ${mensagemDoBsoft(put.corpo, put.status)}`,
          });
        }
      }
    } else {
      // 2) Cria a pessoa física. Nomes conforme a API do Bsoft.
      const novo: Record<string, unknown> = {
        cpf,
        nome: p.nome,
        sobrenome: p.sobrenome ?? "",
        sexo: p.sexo ?? null,
        dtNascimento: p.data_nascimento ?? null,
        grupos: ["motoristas"],
        cnh: {
          numero: p.registro_cnh ?? null,
          seguro: p.codigo_seguranca ?? null,
          protocolo: p.protocolo ?? null,
          categoria: p.categoria ?? null,
          dtValidade: p.data_validade ?? null,
          dtExpedicao: p.data_expedicao ?? null,
          dtPrimeiraExpedicao: p.data_primeira_habilitacao ?? null,
          dtValidadeExameToxicologico: p.data_validade_toxicologico ?? null,
          orgaoExpedidor: p.orgao_expedidor_cnh ?? null,
        },
      };
      if (p.rg) novo.rg = p.rg;
      if (p.orgao_expedidor_rg) novo.orgaoExpedidorRg = p.orgao_expedidor_rg;

      const criado = await chamar(cred, "/pessoas/v1/pessoas/fisicas", { method: "POST", body: novo });
      if (criado.status >= 400) {
        // A mensagem do Bsoft diz qual campo faltou — é o que o operador precisa ver.
        return json({ error: mensagemDoBsoft(criado.corpo, criado.status), status: criado.status }, 400);
      }
      codPessoa = codDaPessoa(criado.corpo);
      if (!codPessoa) {
        return json({ error: "Bsoft aceitou o cadastro mas não devolveu o código da pessoa." }, 502);
      }
    }

    // 3) Anexa a CNH, se veio. Falha aqui não desfaz o cadastro.
    let anexado = false;
    let avisoAnexo: string | undefined;
    if (p.arquivoBase64 && codPessoa) {
      const ext = String(p.arquivoExtensao || "jpg").replace(/^\./, "").toLowerCase();
      const anexo = await chamar(cred, `/pessoas/v1/pessoas/${encodeURIComponent(codPessoa)}/arquivos`, {
        method: "POST",
        body: { tipo: "I", descricao: "CNH", extensao: ext, arquivo: p.arquivoBase64 },
      });
      if (anexo.status >= 400) avisoAnexo = `Cadastro OK, mas o anexo falhou: ${mensagemDoBsoft(anexo.corpo, anexo.status)}`;
      else anexado = true;
    }

    return json({ codPessoa, jaExistia, anexado, ...(avisoAnexo ? { aviso: avisoAnexo } : {}) });
  } catch (e) {
    console.error("cadastrar-motorista:", (e as Error).message);
    return json({ error: (e as Error).message || "Erro inesperado no cadastro." }, 500);
  }
});
