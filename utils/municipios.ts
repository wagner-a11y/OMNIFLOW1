// ============================================================================
// Lista de municípios do IBGE — busca e resolução de texto.
//
// A base (data/municipios-ibge.json) é a lista oficial da API de Localidades do
// IBGE: 5.571 municípios, campos nome/UF/código, SEM coordenada. Carregada sob
// demanda (import dinâmico -> chunk separado), fica em memória e nunca faz
// chamada externa em runtime. Nenhuma consulta do Qualp é gasta aqui.
//
// Formato canônico único, de exibição e de envio: "Cidade, UF".
// É esse texto que vai para o `locations` do Qualp — validado 12/12 numa
// amostra que incluiu homônimos (Viana ES/MA, Bonito MS/PA), apóstrofo,
// hífen e acento.
// ============================================================================

export interface Municipio {
  nome: string;
  uf: string;
  codigo: number;
  /** Texto canônico "Cidade, UF" — o que aparece na tela e o que vai pro Qualp. */
  rotulo: string;
  /** Chave de busca sem acento/pontuação: "sao paulo sp". */
  chave: string;
  /** Só o nome, normalizado: "sao paulo". */
  chaveNome: string;
}

/** Sem acento, sem caixa, sem pontuação — "São Paulo/SP" e "sao paulo - sp" viram a mesma coisa. */
export const normalizar = (s: string): string =>
  (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

let cache: Municipio[] | null = null;
let carregando: Promise<Municipio[]> | null = null;

/** Carrega a base uma vez. Chamadas concorrentes compartilham a mesma promise. */
export function carregarMunicipios(): Promise<Municipio[]> {
  if (cache) return Promise.resolve(cache);
  if (!carregando) {
    carregando = import("../data/municipios-ibge.json")
      .then((mod) => {
        const bruto = ((mod as { default?: unknown }).default ?? mod) as [string, string, number][];
        cache = bruto.map(([nome, uf, codigo]) => ({
          nome,
          uf,
          codigo,
          rotulo: `${nome}, ${uf}`,
          chave: normalizar(`${nome} ${uf}`),
          chaveNome: normalizar(nome),
        }));
        return cache;
      })
      .catch((err) => {
        carregando = null; // permite nova tentativa
        throw err;
      });
  }
  return carregando;
}

/**
 * Busca tolerante: ignora acento e caixa e casa por TRECHO do nome.
 * "flori" acha Florianópolis; "sao paulo" acha São Paulo; "viana" traz ES e MA.
 *
 * Ordem: nome começa com o termo, depois nome contém, depois nome+UF contém.
 * Dentro de cada faixa, alfabética — homônimos saem juntos, separados pela UF.
 */
export function buscarMunicipios(lista: Municipio[], termo: string, limite = 50): Municipio[] {
  const t = normalizar(termo);
  if (!t) return [];

  const achados: Array<{ m: Municipio; peso: number }> = [];
  for (const m of lista) {
    let peso: number;
    if (m.chaveNome.startsWith(t)) peso = 0;
    else if (m.chaveNome.includes(t)) peso = 1;
    else if (m.chave.includes(t)) peso = 2;
    else continue;
    achados.push({ m, peso });
  }

  achados.sort((a, b) =>
    a.peso !== b.peso ? a.peso - b.peso : a.m.nome.localeCompare(b.m.nome, "pt-BR") || a.m.uf.localeCompare(b.m.uf),
  );
  return achados.slice(0, limite).map((x) => x.m);
}

/**
 * Resolve um texto livre para UM município, só quando não há dúvida.
 *
 * Serve para promover o que já está gravado — cotação antiga tem "SÃO PAULO / SP",
 * "blumenau-sc", "itajai / sc", e todos esses normalizam para a mesma chave do
 * município. Texto ambíguo ("viana", sem UF) ou que não é município ("otiriba",
 * "glória - vila velha, es") devolve null de propósito: aí o operador precisa
 * escolher na lista.
 */
export function resolverMunicipio(lista: Municipio[], texto: string): Municipio | null {
  const t = normalizar(texto);
  if (!t || !lista.length) return null;

  const exatos = lista.filter((m) => m.chave === t);
  if (exatos.length === 1) return exatos[0];
  if (exatos.length > 1) return null; // não deveria acontecer (nome+UF é único)

  // Só o nome, sem UF: aceita apenas se existir um único município com esse nome
  // no país. "viana" tem dois (ES e MA) -> null, o operador desempata.
  const porNome = lista.filter((m) => m.chaveNome === t);
  return porNome.length === 1 ? porNome[0] : null;
}
