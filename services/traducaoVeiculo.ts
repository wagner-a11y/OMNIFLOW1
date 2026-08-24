import { supabase } from './supabase';

// ============================================================================
// Tradução CRLV -> códigos do Bsoft (Fase 3A).
//
// O CRLV fala em texto ("M.BENZ/ATEGO 2426", "SEMI-REBOQUE", "BRANCA") e o
// Bsoft quer código. Aqui fica a ponte, e ela é DETERMINÍSTICA de propósito:
// a lista de destino é fechada (202 marcas, 19 categorias) e o operador confere
// tudo na tela. Um match reproduzível, que erra sempre igual e dá para auditar,
// vale mais aqui do que um palpite que muda a cada chamada.
//
// Toda escolha vem acompanhada das ALTERNATIVAS, porque o dicionário é dado
// real e bagunçado: existem "M.BENZ", "MERCEDES BENZ" e "MERCEDEZ BENZ" (com
// erro de digitação) convivendo, e duas "VOLKSWAGEN" distintas em TRUCK. Sem a
// lista ao lado, o operador não teria como corrigir uma escolha errada.
// ============================================================================

export interface LinhaDominio {
    tipo: string;
    codigo: string;
    nome: string;
    categoria_ref: string | null;
    nome_interno: string | null;
}

export type Dominio = LinhaDominio[];

/** O que a IA devolve ao ler um CRLV. */
export interface DadosCRLV {
    tipo_documento?: string;
    placa: string;
    renavam: string;
    chassi: string;
    cor: string;
    ano_fabricacao: string;
    ano_modelo: string;
    marca_texto: string;
    modelo: string;
    especie_texto: string;
    tipo_veiculo_inferido: string;
    carroceria_texto: string;
    /** Campo LOCAL do CRLV: município + UF de registro, ex.: "VITORIA ES". */
    local_texto: string;
    tara: string;
    capacidade_carga: string;
    eixos: string;
}

export const CRLV_VAZIO: DadosCRLV = {
    placa: '', renavam: '', chassi: '', cor: '', ano_fabricacao: '', ano_modelo: '',
    marca_texto: '', modelo: '', especie_texto: '', tipo_veiculo_inferido: '',
    carroceria_texto: '', local_texto: '', tara: '', capacidade_carga: '', eixos: '',
};

/** Uma escolha da tradução: o que foi decidido e o que mais havia. */
export interface Escolha {
    codigo: string;
    rotulo: string;
    /** Como se chegou nesse valor — aparece na tela para o operador julgar. */
    origem: 'documento' | 'inferido' | 'padrao' | 'nao_resolvido';
    alternativas: Array<{ codigo: string; rotulo: string }>;
}

const semEscolha = (alternativas: Array<{ codigo: string; rotulo: string }> = []): Escolha =>
    ({ codigo: '', rotulo: '', origem: 'nao_resolvido', alternativas });

/** Sem acento, sem caixa, sem pontuação: "M.BENZ" e "m benz" viram "M BENZ". */
export const normalizar = (s: string): string =>
    (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

/**
 * Apelidos que aparecem no CRLV e não batem com o nome no dicionário.
 * Cada entrada resolve um caso REAL de divergência de escrita, não hipótese.
 */
const APELIDOS: Array<{ de: RegExp; para: string }> = [
    { de: /\bM\s?BENZ\b|\bMERCEDES\b|\bMERCEDEZ\b|\bMB\b/, para: 'MERCEDES BENZ' },
    { de: /\bVW\b|\bVOLKS\b/, para: 'VOLKSWAGEN' },
    { de: /\bGM\b|\bCHEVROLET\b/, para: 'CHEVROLET' },
    { de: /\bIVECO\b/, para: 'IVECO' },
    { de: /\bSCANIA\b/, para: 'SCANIA' },
    { de: /\bVOLVO\b/, para: 'VOLVO' },
    { de: /\bFORD\b/, para: 'FORD' },
    { de: /\bDAF\b/, para: 'DAF' },
    { de: /\bMAN\b/, para: 'MAN' },
    { de: /\bRANDON\b/, para: 'RANDON' },
    { de: /\bGUERRA\b/, para: 'GUERRA' },
    { de: /\bLIBRELATO\b/, para: 'LIBRELATO' },
    { de: /\bFACCHINI\b/, para: 'FACCHINI' },
    { de: /\bNOMA\b/, para: 'NOMA' },
    { de: /\bRODOFORT\b/, para: 'RODOFORT' },
];

/**
 * O CRLV escreve "MARCA/MODELO" numa linha só ("M.BENZ/ATEGO 2426"). A marca é
 * o que vem ANTES da barra; o resto é modelo e só atrapalharia o casamento.
 */
export function marcaDoTexto(marcaTexto: string): string {
    const antesDaBarra = (marcaTexto || '').split('/')[0];
    const n = normalizar(antesDaBarra);
    for (const { de, para } of APELIDOS) if (de.test(n)) return para;
    return n;
}

/** Categoria a partir do tipo que a IA inferiu, via `nome_interno` do dicionário. */
export function acharCategoria(dominio: Dominio, tipoInferido: string): Escolha {
    const categorias = dominio.filter(d => d.tipo === 'categoria');
    const todas = categorias.map(c => ({ codigo: c.codigo, rotulo: c.nome }));
    const alvo = normalizar(tipoInferido);
    if (!alvo || alvo === 'OUTRO') return semEscolha(todas);

    // 1) O nome_interno é a ponte desenhada para isso: 'cavalo', 'carreta',
    //    'truck', 'semireboque', 'veiculoLivre'.
    let achadas = categorias.filter(c => normalizar(c.nome_interno || '') === alvo);
    // 2) Sem isso, o próprio nome da categoria ("TOCO", "VUC") pode bater.
    if (!achadas.length) achadas = categorias.filter(c => normalizar(c.nome) === alvo);

    // Ambíguo é pior que vazio: 'truck' casa com 7 categorias diferentes. Nesse
    // caso preferimos a categoria de nome idêntico ao tipo, e só ela.
    if (achadas.length > 1) {
        const exata = achadas.find(c => normalizar(c.nome) === alvo);
        if (exata) achadas = [exata];
    }
    if (achadas.length !== 1) return semEscolha(todas);
    return { codigo: achadas[0].codigo, rotulo: achadas[0].nome, origem: 'inferido', alternativas: todas };
}

/**
 * Marca dentro da categoria escolhida. O dicionário guarda `categoria_ref` como
 * o NOME da categoria ("CAVALO"), não o id — por isso o filtro é por nome.
 */
export function acharMarca(dominio: Dominio, marcaTexto: string, categoriaNome: string): Escolha {
    const daCategoria = dominio.filter(
        d => d.tipo === 'marca' && normalizar(d.categoria_ref || '') === normalizar(categoriaNome),
    );
    const lista = daCategoria.map(m => ({ codigo: m.codigo, rotulo: m.nome }));
    const alvo = marcaDoTexto(marcaTexto);
    if (!alvo || !daCategoria.length) return semEscolha(lista);

    const pontua = (nome: string): number => {
        const n = normalizar(nome);
        const nApelidado = APELIDOS.find(a => a.de.test(n))?.para ?? n;
        if (n === alvo || nApelidado === alvo) return 3;   // igual, ou igual depois do apelido
        if (n.startsWith(alvo) || alvo.startsWith(n)) return 2;
        if (n.includes(alvo) || alvo.includes(n)) return 1;
        return 0;
    };

    const pontuadas = daCategoria
        .map(m => ({ m, p: pontua(m.nome) }))
        .filter(x => x.p > 0)
        .sort((a, b) => b.p - a.p);

    if (!pontuadas.length) return semEscolha(lista);
    return {
        codigo: pontuadas[0].m.codigo,
        rotulo: pontuadas[0].m.nome,
        origem: 'documento',
        alternativas: lista,
    };
}

/** Casamento simples por nome dentro de um tipo do dicionário (cor, carroceria). */
function acharPorNome(dominio: Dominio, tipo: string, texto: string): Escolha {
    const doTipo = dominio.filter(d => d.tipo === tipo);
    const lista = doTipo.map(d => ({ codigo: d.codigo, rotulo: d.nome }));
    const alvo = normalizar(texto);
    if (!alvo) return semEscolha(lista);

    // "BRANCA" no documento, "Branco" no dicionário: compara pelo radical, que
    // é o que sobra quando se ignora a flexão de gênero.
    const radical = (s: string) => normalizar(s).replace(/[AO]S?$/, '');
    const achada = doTipo.find(d => normalizar(d.nome) === alvo)
        ?? doTipo.find(d => radical(d.nome) === radical(alvo))
        ?? doTipo.find(d => normalizar(d.nome).includes(alvo) || alvo.includes(normalizar(d.nome)));

    if (!achada) return semEscolha(lista);
    return { codigo: achada.codigo, rotulo: achada.nome, origem: 'documento', alternativas: lista };
}

/** Rodado deduzido do tipo de veículo. Semi-reboque usa "00" (Nao aplicavel). */
const RODADO_POR_TIPO: Record<string, string> = {
    cavalo: '03',    // Cavalo Mecanico
    truck: '01',
    toco: '02',
    vuc: '05',       // Utilitario
    carreta: '00',   // Semi-reboque não tem rodado próprio: 'Nao aplicavel'
};

/** capM3 padrão, definido pelo Wagner. Carroceria manda mais que o tipo. */
export function capM3Padrao(carroceriaRotulo: string, tipoInferido: string): string {
    const c = normalizar(carroceriaRotulo);
    if (c.includes('BAU') || c.includes('FECHADA')) return '100';
    if (c.includes('GRANELEIRA')) return '0';
    if (normalizar(tipoInferido) === 'CAVALO') return '0';
    if (normalizar(tipoInferido) === 'TRUCK') return '55';
    return '';   // o operador preenche
}

export interface Traducao {
    categoria: Escolha;
    marca: Escolha;
    cor: Escolha;
    carroceria: Escolha;
    rodado: Escolha;
    capM3: string;
    /** O que a tradução não conseguiu resolver sozinha — vai em destaque na tela. */
    pendencias: string[];
}

/** Traduz o CRLV lido para os códigos do Bsoft. Não grava nada. */
export function traduzirCrlv(dominio: Dominio, crlv: DadosCRLV): Traducao {
    const categoria = acharCategoria(dominio, crlv.tipo_veiculo_inferido);
    const marca = categoria.codigo
        ? acharMarca(dominio, crlv.marca_texto, categoria.rotulo)
        : semEscolha([]);   // sem categoria não dá para filtrar marca
    const cor = acharPorNome(dominio, 'cor', crlv.cor);
    const carroceria = acharPorNome(dominio, 'tipoCarroceria', crlv.carroceria_texto);

    const rodados = dominio.filter(d => d.tipo === 'tipoRodado')
        .map(d => ({ codigo: d.codigo, rotulo: d.nome }));
    const codRodado = RODADO_POR_TIPO[normalizar(crlv.tipo_veiculo_inferido).toLowerCase()];
    const rodado: Escolha = codRodado
        ? { codigo: codRodado, rotulo: rodados.find(r => r.codigo === codRodado)?.rotulo ?? '', origem: 'inferido', alternativas: rodados }
        : semEscolha(rodados);

    const pendencias: string[] = [];
    if (!categoria.codigo) pendencias.push('categoria');
    if (!marca.codigo) pendencias.push('marca');
    if (!cor.codigo) pendencias.push('cor');
    if (!carroceria.codigo) pendencias.push('carroceria');
    if (!rodado.codigo) pendencias.push('rodado');
    if (!crlv.tara) pendencias.push('tara');
    if (!crlv.capacidade_carga) pendencias.push('capacidade de carga');

    return {
        categoria, marca, cor, carroceria, rodado,
        capM3: capM3Padrao(carroceria.rotulo, crlv.tipo_veiculo_inferido),
        pendencias,
    };
}

/** Carrega o dicionário inteiro. A RLS já libera SELECT para authenticated. */
export async function carregarDominio(): Promise<Dominio> {
    const { data, error } = await supabase
        .from('dominio_veiculo')
        .select('tipo, codigo, nome, categoria_ref, nome_interno');
    if (error) throw new Error(`Não consegui carregar o dicionário de veículos: ${error.message}`);
    return (data ?? []) as Dominio;
}
