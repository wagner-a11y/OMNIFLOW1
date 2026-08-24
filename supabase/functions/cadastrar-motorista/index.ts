import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// ============================================================================
// cadastrar-motorista — Fase 2 do Cadastro Automático.
//
// Cria (ou reaproveita) a pessoa física do motorista na API REST do Bsoft, a
// partir dos dados já CONFERIDOS pelo operador na tela. Depois grava o ENDEREÇO
// (sub-recurso da pessoa) e anexa a CNH.
//
// ORDEM: 1) cria/acha a pessoa  2) grava o endereço  3) anexa a CNH.
// O endereço precisa do codPessoa na URL, por isso vem depois. Falha no endereço
// ou no anexo NÃO desfaz a pessoa criada — vira aviso, e o operador completa no
// Datamex em vez de tentar de novo e duplicar.
//
// ANTI-DUPLICAÇÃO: antes de criar, procura pelo CPF. Se a pessoa já existe, NÃO
// cria de novo — devolve o codPessoa existente com jaExistia=true, sem alterar
// o cadastro dela (ver a nota sobre `grupos` no trecho do jaExistia).
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
  for (const k of ["codPessoa", "codEndereco", "codigoEndereco", "codigoPessoa", "codigo", "id"]) {
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

  // ---- Consulta por CPF (só leitura, não grava) ----
  // Usada pelo cadastro de VEÍCULO para escolher o proprietário. Devolve só o
  // código e o nome — o suficiente para o operador confirmar que é a pessoa
  // certa, sem despejar o cadastro inteiro na tela.
  if (corpoReq?.consultarCpf) {
    const alvo = soDigitos(corpoReq.consultarCpf);
    if (alvo.length !== 11) return json({ error: "CPF precisa ter 11 dígitos." }, 400);

    let credC = creds[0];
    for (const c of creds) {
      const t = await chamar(c, "/pessoas/v1/pessoas/fisicas?limit=1");
      if (t.status !== 401 && t.status !== 403) { credC = c; break; }
    }
    const r = await chamar(credC, `/pessoas/v1/pessoas/fisicas/${encodeURIComponent(alvo)}`);
    if (r.status === 404) return json({ existe: false });
    if (r.status >= 400) return json({ error: mensagemDoBsoft(r.corpo, r.status) }, 400);

    const lista = comoLista(r.corpo).length
      ? comoLista(r.corpo)
      : (r.corpo && typeof r.corpo === "object" ? [r.corpo as Record<string, unknown>] : []);
    const achada = lista.filter((x) => soDigitos(x.cpf) === alvo)[0];
    if (!achada) return json({ existe: false });

    return json({
      existe: true,
      codPessoa: codDaPessoa(achada),
      nome: [achada.nome, achada.sobrenome].filter(Boolean).join(" ").trim(),
    });
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
    // O Bsoft busca por CAMINHO (/fisicas/{cpf}), não por query string: todas as
    // variantes de filtro (?cpf=, ?filtro=, ?busca=, ?documento=) devolvem 400.
    // Era por isso que a anti-duplicação não achava ninguém e o POST apanhava de
    // "Já existe um registro com CPF" — comprovado por probe em 21/08/2026.
    const busca = await chamar(cred, `/pessoas/v1/pessoas/fisicas/${encodeURIComponent(cpf)}`);
    if (busca.status === 401 || busca.status === 403) {
      return json({ error: "Falha de auth na API Bsoft ao consultar pessoas." }, 401);
    }
    // 404 = não existe, e é resposta legítima aqui (não é erro).
    const candidatos = busca.status === 404
      ? []
      : (comoLista(busca.corpo).length ? comoLista(busca.corpo)
         : (busca.corpo && typeof busca.corpo === "object" ? [busca.corpo as Record<string, unknown>] : []));
    const achados = candidatos.filter((x) => soDigitos(x.cpf) === cpf);
    const existente = achados.length ? codDaPessoa(achados[0]) : null;

    let codPessoa = existente;
    let jaExistia = false;
    let avisoGrupo = "";

    if (existente) {
      jaExistia = true;
      // NÃO mexemos no cadastro de quem já existe. Motivo, medido na API:
      // o GET de pessoa física devolve 23 campos e NENHUM deles é `grupos` —
      // grupos é campo só de escrita (aceito no POST, nunca lido de volta).
      // Como não dá para saber em que grupos a pessoa já está, um PUT com
      // grupos:["motoristas"] arriscaria APAGAR os outros grupos dela
      // (cliente, fornecedor...) sem que ninguém percebesse. Entre correr esse
      // risco num cadastro real e pedir um clique ao operador, pedimos o clique.
      avisoGrupo = "Essa pessoa já tinha cadastro no Datamex, então não criei outra nem " +
                   "alterei o que existe. Se ela ainda não estiver no grupo de motoristas, " +
                   "marque isso no Datamex.";
      if (p.proprietario) {
        avisoGrupo += " Como você marcou que ela é proprietária do veículo, marque também o " +
                      "grupo 'Proprietários Veículos' manualmente no Datamex.";
      }
    } else {
      // 2) Cria a pessoa física. Nomes conforme a API do Bsoft.
      const novo: Record<string, unknown> = {
        cpf,
        nome: p.nome,
        sobrenome: p.sobrenome ?? "",
        sexo: p.sexo ?? null,
        dtNascimento: p.data_nascimento ?? null,
        // O RNTRC é registro do TRANSPORTADOR, não do condutor: só quem também é
        // dono do veículo entra no grupo de proprietários e tem RNTRC.
        grupos: p.proprietario ? ["motoristas", "proprietariosVeiculos"] : ["motoristas"],
        // Campos fiscais que o Bsoft exige na pessoa física. Os padrões vêm da
        // tela (o operador pode trocar); aqui só há rede de segurança.
        //
        // ATENÇÃO AOS NOMES: a API ACEITA campo com nome errado e responde 200
        // sem gravar nada — foi assim que nacionalidade, naturalidade e RG se
        // perderam silenciosamente na primeira versão. Os nomes abaixo são os do
        // exemplo oficial da doc de Pessoas Físicas; não "corrigir" por intuição.
        estadoCivil: p.estado_civil || "S",
        nacionalidade: p.nacionalidade || "Brasil",
        naturalidade: p.naturalidade || null,
        naturalidadeUF: p.uf_naturalidade || null,   // NÃO é "ufNaturalidade"
        numeroRG: p.rg || null,                      // NÃO é "rg"
        orgaoExpedidorRG: p.orgao_expedidor_rg || null,   // RG maiúsculo
        ufEmissaoRG: p.uf_rg || null,
        mae: p.nome_mae || null,
        pai: p.nome_pai || null,
        // Celular é obrigatório e vai com máscara: "(00) 00000-0000".
        celular: p.celular || null,
        // O TMS tem "Ignorar Validação" para o INSS de quem não tem matrícula.
        // Mandamos o valor zerado; se a API recusar, o erro dela diz o que quer.
        matriculaINSS: p.matricula_inss || "0.000.000.000-0",
        // RNTRC não está na CNH: é digitado pelo operador, sem valor automático.
        // Motorista que só dirige não tem RNTRC — nesses casos o campo nem é
        // enviado, em vez de ir vazio.
        ...(p.proprietario && p.rntrc ? { RNTRC: p.rntrc } : {}),
        // Campos que a API só cobra de quem entra no grupo de proprietários. O
        // condutor puro passa sem eles (provado no cadastro 11229), então não
        // são enviados nesse caso — não é só economia, é não classificar como
        // transportador quem só dirige.
        ...(p.proprietario ? {
          dependentesIRRF: Number(p.dependentes_irrf ?? 0) || 0,
          // "T" = TAC, transportador autônomo de carga: é o que se aplica a
          // motorista-proprietário pessoa física.
          tipoTransportadora: p.tipo_transportadora || "T",
        } : {}),
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
      // A data de emissão do RG normalmente não está na CNH. Só mandamos quando
      // o operador digitou: mandar vazio já rendeu "[emissaoRG] com conteúdo
      // inválido" num teste anterior.
      if (p.data_emissao_rg) novo.emissaoRG = p.data_emissao_rg;

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

    // 3) Endereço — sub-recurso da pessoa: o código vai na URL, não no corpo.
    let codEndereco: string | null = null;
    let avisoEndereco: string | undefined;
    const end = p.endereco as Record<string, any> | undefined;

    if (end?.cep && codPessoa) {
      if (jaExistia) {
        // Não regravamos endereço de quem já tinha cadastro: não temos como
        // saber se o que está lá é o mesmo, e um POST criaria um endereço a mais.
        avisoEndereco = "Não gravei o endereço porque a pessoa já existia — confira o que está no Datamex.";
      } else {
        const corpoEnd: Record<string, unknown> = {
          // O Bsoft exige o CEP COM hífen: "00000-000".
          cep: String(end.cep),
          logradouro: end.logradouro ?? "",
          numero: end.numero ?? "",
          bairro: end.bairro ?? "",
          // cidade é o código IBGE de 7 dígitos, não o nome.
          cidade: String(end.cidade ?? ""),
          estado: end.estado ?? "",
          // Fixos de pessoa física — não aparecem na tela, não são decisão do operador.
          tipoEndereco: "N",
          inscricaoMunicipal: "ISENTO",
          inscricaoEstadual: "ISENTO",
          inscricaoEstadualNaoContribuinte: "S",
          cobrancaPreferencial: "S",
          enderecoPreferencial: "S",
        };
        if (end.complemento) corpoEnd.complemento = end.complemento;

        const criadoEnd = await chamar(cred, `/pessoas/v1/pessoas/${encodeURIComponent(codPessoa)}/enderecos`, {
          method: "POST",
          body: corpoEnd,
        });
        if (criadoEnd.status >= 400) {
          avisoEndereco = `A pessoa foi criada, mas o endereço não entrou: ${mensagemDoBsoft(criadoEnd.corpo, criadoEnd.status)}`;
        } else {
          // O POST de endereço responde 201 com um ARRAY de um item, diferente
          // do POST de pessoa, que responde um objeto. Desembrulha antes de ler.
          const item = Array.isArray(criadoEnd.corpo) ? criadoEnd.corpo[0] : criadoEnd.corpo;
          codEndereco = codDaPessoa(item);
        }
      }
    }

    // 4) Anexa a CNH, se veio. Falha aqui não desfaz o cadastro.
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

    const aviso = [avisoGrupo, avisoEndereco, avisoAnexo].filter(Boolean).join(" ");
    return json({ codPessoa, codEndereco, jaExistia, anexado, ...(aviso ? { aviso } : {}) });
  } catch (e) {
    console.error("cadastrar-motorista:", (e as Error).message);
    return json({ error: (e as Error).message || "Erro inesperado no cadastro." }, 500);
  }
});
