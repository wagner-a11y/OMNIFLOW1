/**
 * BID EM LOTE — Fase 1: o motor rodando linha a linha.
 *
 * Não reimplementa cálculo. Orquestra os módulos que já existem:
 *   utils/motorPreco.ts     -> preço, impostos, margem bruta
 *   utils/custosOcultos.ts  -> antecipação, comissão, margem líquida
 *   utils/icms.ts           -> alíquota por UF da rota
 * e a rota (km, pedágio, piso ANTT) vem do MESMO ponto de entrada do Qualp que
 * a cotação individual usa (`estimateDistance`), injetado como dependência.
 *
 * Injetar o consultor de rota, em vez de importar o serviço, é o que permite
 * testar dedup, concorrência e tratamento de falha SEM gastar cota paga.
 *
 * Fase 1 não persiste nada: vive na tela e sai em Excel.
 */

import { calcularPreco, type ParametrosTributarios } from './motorPreco';
import { calcularCustosOcultos } from './custosOcultos';
import { getIcmsRate, getUF } from './icms';

// ---------------------------------------------------------------------------
// Planilha
// ---------------------------------------------------------------------------

/**
 * Dicionário de colunas do bid. Próprio, para não encostar em COLUNAS_OTM —
 * mexer no dicionário do Fast faria o Fast reclamar de coluna que ele nunca
 * usou. O `abrirPlanilhaOtm` aceita este mapa pelo segundo parâmetro.
 */
export const COLUNAS_BID: Record<string, string[]> = {
    origem: ['Origem', 'Cidade Origem', 'Cidade de Origem', 'Municipio Origem', 'Município Origem'],
    destino: ['Destino', 'Cidade Destino', 'Cidade de Destino', 'Municipio Destino', 'Município Destino'],
    veiculo: ['Veiculo', 'Veículo', 'Tipo Veiculo', 'Tipo de Veículo', 'Tipo de Veiculo', 'Equipamento'],
};

/**
 * TETO DURO DE ROTAS DISTINTAS POR LOTE.
 *
 * A cota do Qualp é paga e limitada. Acima disto o lote é BLOQUEADO antes de
 * qualquer consulta e o operador divide a planilha. É teto de rotas DISTINTAS
 * (pós-dedup), não de linhas: uma planilha de 500 linhas com 80 rotas passa.
 */
export const TETO_ROTAS_DISTINTAS = 100;

/**
 * Normaliza nome de veículo para comparação: sem acento, sem caixa, sem
 * pontuação, espaços colapsados. "Carreta  LS" e "carreta-ls" viram o mesmo.
 */
export const normalizarVeiculo = (s: string): string =>
    (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Como o rótulo da planilha foi ligado a um veículo do cadastro. */
export type ComoResolveu =
    | 'exato'       // o nome bate com o cadastro
    | 'normalizado' // bateu ignorando acento/caixa/espaço
    | 'prefixo'     // único veículo do cadastro que começa com o rótulo ("Carreta" -> "Carreta Simples")
    | 'depara'      // o operador ligou à mão
    | 'padrao'      // a linha não trazia veículo
    | 'ambiguo'     // vários candidatos: NÃO chuta, pede de-para
    | 'desconhecido';

export interface ResolucaoVeiculo {
    veiculo: string;        // '' quando não resolveu
    como: ComoResolveu;
    /** Candidatos do cadastro, quando ambíguo ou desconhecido. */
    candidatos: string[];
}

/**
 * Liga o rótulo da planilha a um veículo do cadastro, tolerando as diferenças
 * que não mudam o significado.
 *
 * O match por PREFIXO só vale quando há um candidato único: "Carreta" com
 * "Carreta Simples" no cadastro resolve, mas "Carreta" com "Carreta Simples" E
 * "Carreta LS" fica AMBÍGUO e vira de-para. Escolher um dos dois no escuro
 * precificaria o veículo errado, que é pior que pedir a ligação.
 */
export const resolverVeiculo = (
    rotuloPlanilha: string,
    veiculosCadastro: string[],
    dePara: Record<string, string> = {},
    veiculoPadrao = '',
): ResolucaoVeiculo => {
    const rotulo = (rotuloPlanilha || '').trim();
    if (!rotulo) {
        return veiculoPadrao
            ? { veiculo: veiculoPadrao, como: 'padrao', candidatos: [] }
            : { veiculo: '', como: 'desconhecido', candidatos: [] };
    }

    // De-para do operador vence tudo: é decisão humana explícita.
    const manual = dePara[rotulo] ?? dePara[normalizarVeiculo(rotulo)];
    if (manual && veiculosCadastro.includes(manual)) {
        return { veiculo: manual, como: 'depara', candidatos: [] };
    }

    if (veiculosCadastro.includes(rotulo)) {
        return { veiculo: rotulo, como: 'exato', candidatos: [] };
    }

    const alvo = normalizarVeiculo(rotulo);
    const iguais = veiculosCadastro.filter(v => normalizarVeiculo(v) === alvo);
    if (iguais.length === 1) return { veiculo: iguais[0], como: 'normalizado', candidatos: [] };
    if (iguais.length > 1) return { veiculo: '', como: 'ambiguo', candidatos: iguais };

    // Prefixo: o rótulo é o começo do nome cadastrado.
    const porPrefixo = veiculosCadastro.filter(v => {
        const n = normalizarVeiculo(v);
        return n.startsWith(alvo + ' ') || n === alvo;
    });
    if (porPrefixo.length === 1) return { veiculo: porPrefixo[0], como: 'prefixo', candidatos: [] };
    if (porPrefixo.length > 1) return { veiculo: '', como: 'ambiguo', candidatos: porPrefixo };

    return { veiculo: '', como: 'desconhecido', candidatos: [] };
};

/**
 * Taxa de antecipação proporcional ao prazo.
 *
 *   taxa% = juros ao mês × (prazo em dias / 30)
 *
 * Ex.: 1,5% a.m. em 45 dias = 2,25%. Mês comercial de 30 dias, que é a
 * convenção do mercado de antecipação.
 */
export const taxaAntecipacaoProporcional = (jurosMensal: number, prazoDias: number): number =>
    (Number(jurosMensal) || 0) * ((Number(prazoDias) || 0) / 30);

/** Status de processamento da linha. Nenhum deles derruba o lote. */
export type StatusLinhaBid =
    | 'ok'        // rota consultada e preço calculado
    | 'pendencia' // falta dado na planilha (origem/destino/veículo) ou configuração
    | 'urbano'    // origem = destino: o Qualp não é consultado
    | 'falha';    // o Qualp não respondeu para esta rota

export interface LinhaBidBruta {
    /** Linha no arquivo, contando o cabeçalho (1-based, como o Excel mostra). */
    linhaExcel: number;
    origem: string;
    destino: string;
    /** Exatamente o que veio na coluna. '' = célula vazia. */
    veiculoPlanilha: string;
}

export interface LinhaBid extends LinhaBidBruta {
    /** Veículo efetivo: o da linha ou o padrão escolhido para o bid. */
    veiculo: string;
    /** false = a linha não trazia veículo e caiu no padrão do bid. */
    veiculoDaLinha: boolean;
    eixos: number | null;
    status: StatusLinhaBid;
    /** Como o veículo foi ligado ao cadastro (ver resolverVeiculo). */
    comoResolveuVeiculo: ComoResolveu;
    /** Candidatos do cadastro quando o veículo ficou ambíguo. */
    candidatosVeiculo: string[];
    /**
     * Pendências que vêm da PLANILHA (imutáveis depois do preparo). O recálculo
     * vivo reconstrói `pendencias` a partir desta base — sem isso, recalcular
     * dez vezes empilharia dez cópias da mesma mensagem.
     */
    pendenciasBase: string[];
    /** Por que a linha não produziu preço. Vazio quando status = 'ok'. */
    pendencias: string[];
    /** Avisos que NÃO impedem o preço (ex.: compliance de piso). */
    alertas: string[];
    /** Chave de dedup da consulta ao Qualp. null = nem chegou a consultar. */
    chaveQualp: string | null;
    /**
     * De onde veio a rota desta linha:
     *   'qualp'          -> esta linha gastou uma consulta
     *   'cache'          -> reusou a consulta de uma linha anterior (dedup)
     *   'nao-consultada' -> pendência de planilha ou frete urbano
     * Três estados, não um booleano: "não consultou" e "reusou" são coisas
     * diferentes, e tratá-las como a mesma fazia o frete urbano ser contado
     * como consulta poupada pelo dedup — inflando o número que justifica o
     * próprio dedup.
     */
    fonteRota: 'qualp' | 'cache' | 'nao-consultada';

    /**
     * DADOS FIXOS DA ROTA, em cache. É o que permite o motor vivo: trocar
     * margem, juros, prazo, carga ou ICMS recalcula a tabela inteira sobre
     * ISTO, sem reconsultar o Qualp. null = a linha nunca teve rota.
     */
    rota: RotaDoLote | null;
    /** UFs extraídas de origem/destino — fixas, vêm do texto da planilha. */
    ufOrigem: string;
    ufDestino: string;

    // ---- Resultado (null quando a linha não fechou) ----
    km: number | null;
    pedagio: number | null;
    pisoAntt: number | null;
    /** Base de custo da Fase 1: piso ANTT + pedágio cheio. */
    custoBase: number | null;
    icmsPercent: number | null;
    icmsRS: number | null;
    federaisRS: number | null;
    /** Taxa de antecipação aplicada (%), = juros × prazo/30. */
    taxaAntecipacao: number | null;
    precoSugerido: number | null;
    margemBrutaRS: number | null;
    margemBrutaPercent: number | null;
    custoAntecipacao: number | null;
    custoComissao: number | null;
    margemLiquidaRS: number | null;
    margemLiquidaPercent: number | null;
}

export interface ParametrosBid {
    /** Margem pretendida (%) aplicada a todas as linhas. */
    profitMargin: number;
    fedTaxes: ParametrosTributarios;
    /** Overrides de ICMS por rota ("SP-RJ": 12), da aba de Configurações. */
    icmsRates?: Record<string, number>;
    /** Tipo de carga da Tabela A, igual à calculadora. */
    cargoType: string;
    /** Veículo usado quando a linha não traz um. '' = sem padrão escolhido. */
    veiculoPadrao: string;
    /** Nomes exatos dos veículos do cadastro, para o match tolerante. */
    veiculosCadastro: string[];
    /** De-para do operador: rótulo da planilha -> veículo do cadastro. */
    deParaVeiculo?: Record<string, string>;
    /** Eixos por tipo de veículo (do vehicleConfigs). */
    eixosPorVeiculo: Record<string, number | undefined>;
    /** Modo de cálculo por veículo. Fase 1 atende só 'ANTT'. */
    modoPorVeiculo: Record<string, string | undefined>;
    // ---- Custos ocultos, escolhidos para o bid inteiro ----
    /** Juros de antecipação (% ao mês). */
    jurosMensal: number;
    /** Prazo de pagamento em dias. A taxa sai de juros × prazo/30. */
    prazoDias: number;
    /** Comissão (%) como string; '' = cai no padrão das Configurações. */
    comissaoPercent: string;
    comissaoPadrao?: number;
}

/**
 * Chave de dedup: a MESMA combinação que a Edge Function recebe. Rota repetida
 * na planilha consulta o Qualp uma vez só.
 */
export const chaveRota = (origem: string, destino: string, eixos: number, carga: string): string =>
    [origem.trim().toLowerCase(), destino.trim().toLowerCase(), eixos, carga.trim().toLowerCase()].join('|');

/** Origem e destino no mesmo município? Mesma normalização da Edge Function. */
const mesmoMunicipio = (a: string, b: string): boolean => {
    const norm = (s: string) => (s || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const na = norm(a);
    return !!na && na === norm(b);
};

/**
 * Monta as linhas cruas a partir do que o `abrirPlanilhaOtm` devolveu.
 * Separado da leitura do arquivo de propósito: assim o parsing é testável sem
 * montar um .xlsx.
 */
export const montarLinhasBid = (
    bruto: Record<string, unknown>[],
    mapa: Record<string, string>,
): LinhaBidBruta[] =>
    bruto.map((l, i) => {
        const ler = (campo: string) => {
            const col = mapa[campo];
            return col ? String(l[col] ?? '').trim() : '';
        };
        // O número da linha vem do __rowNum__ do SheetJS, não da posição no
        // array. O sheet_to_json DESCARTA linhas totalmente vazias, então
        // `i + 2` desloca tudo que vem depois de um buraco na planilha: com uma
        // linha vazia na 3, a linha 4 era reportada como 3 e o operador ia
        // conferir a linha errada no Excel. Conferido na prática.
        const rowNum = (l as { __rowNum__?: number }).__rowNum__;
        return {
            linhaExcel: typeof rowNum === 'number' ? rowNum + 1 : i + 2,
            origem: ler('origem'),
            destino: ler('destino'),
            veiculoPlanilha: ler('veiculo'),
        };
    });

/**
 * Resolve veículo, eixos e as pendências de PLANILHA de uma linha — tudo o que
 * dá para saber antes de falar com o Qualp.
 */
export const prepararLinha = (bruta: LinhaBidBruta, p: ParametrosBid): LinhaBid => {
    const pendencias: string[] = [];

    // Veículo: match tolerante contra o cadastro. Antes era comparação exata de
    // texto, e "Carreta" na planilha com "Carreta Simples" no cadastro virava
    // pendência mesmo sendo o mesmo veículo.
    const res = resolverVeiculo(bruta.veiculoPlanilha, p.veiculosCadastro, p.deParaVeiculo, p.veiculoPadrao);
    const veiculo = res.veiculo;
    const veiculoDaLinha = bruta.veiculoPlanilha !== '' && res.como !== 'padrao';

    if (!bruta.origem) pendencias.push('Origem em branco');
    if (!bruta.destino) pendencias.push('Destino em branco');
    if (!veiculo) {
        if (res.como === 'ambiguo') {
            pendencias.push(`Veículo "${bruta.veiculoPlanilha}" é ambíguo (${res.candidatos.join(' ou ')}) — ligue no de-para`);
        } else if (bruta.veiculoPlanilha) {
            pendencias.push(`Veículo "${bruta.veiculoPlanilha}" não está no cadastro — ligue no de-para`);
        } else {
            pendencias.push('Sem veículo na linha e sem veículo padrão escolhido');
        }
    }

    const eixos = veiculo ? (p.eixosPorVeiculo[veiculo] ?? null) : null;
    if (veiculo && eixos == null) pendencias.push(`Veículo "${veiculo}" está sem eixos no cadastro`);

    // Fase 1 precifica sobre o piso ANTT. Veículo de tarifa por KM ou preço
    // livre não tem piso, e usar o piso de outro veículo daria número errado —
    // que é pior que linha em branco.
    const modo = veiculo ? p.modoPorVeiculo[veiculo] : undefined;
    if (veiculo && eixos != null && modo && modo !== 'ANTT') {
        pendencias.push(`Veículo "${veiculo}" não usa tabela ANTT (modo ${modo}) — fora do escopo da Fase 1`);
    }

    // Frete urbano é decidido AQUI, não no orquestrador: ele é conhecível sem o
    // Qualp, e a confirmação de custo precisa saber, antes de consultar, que
    // esta linha não vai gastar consulta. Mesma guarda da Edge Function.
    const urbano = !pendencias.length && mesmoMunicipio(bruta.origem, bruta.destino);
    if (urbano) pendencias.push('Frete urbano (origem = destino): não cotado automaticamente');

    const semRota = pendencias.length > 0 || eixos == null;
    return {
        ...bruta,
        veiculo, veiculoDaLinha, eixos,
        comoResolveuVeiculo: res.como, candidatosVeiculo: res.candidatos,
        status: urbano ? 'urbano' : (pendencias.length ? 'pendencia' : 'ok'),
        pendenciasBase: [...pendencias], pendencias, alertas: [],
        chaveQualp: semRota ? null : chaveRota(bruta.origem, bruta.destino, eixos!, p.cargoType),
        fonteRota: 'nao-consultada',
        rota: null,
        ufOrigem: getUF(bruta.origem) || '',
        ufDestino: getUF(bruta.destino) || '',
        km: null, pedagio: null, pisoAntt: null, custoBase: null,
        icmsPercent: null, icmsRS: null, federaisRS: null, taxaAntecipacao: null,
        precoSugerido: null, margemBrutaRS: null, margemBrutaPercent: null,
        custoAntecipacao: null, custoComissao: null,
        margemLiquidaRS: null, margemLiquidaPercent: null,
    };
};

/**
 * Plano do lote: quanto ele VAI custar em consultas, calculado sem consultar
 * nada. É o número que a confirmação mostra ao operador.
 */
export interface PlanoLote {
    /** Linhas já preparadas (veículo, eixos, pendências, urbano resolvidos). */
    linhas: LinhaBid[];
    /** Linhas que precisam de rota (nem pendência, nem urbana). */
    linhasComRota: number;
    /**
     * Consultas que o lote vai gastar: rotas DISTINTAS pós-dedup. É este o
     * número da confirmação — não o total de linhas.
     */
    rotasDistintas: number;
    /** Consultas que o dedup vai poupar (linhasComRota − rotasDistintas). */
    economiaPrevista: number;
    pendentes: number;
    urbanas: number;
    teto: number;
    /** true = o lote é bloqueado e NADA é consultado. */
    acimaDoTeto: boolean;
}

/**
 * Conta o custo do lote ANTES de falar com o Qualp.
 *
 * Roda o mesmo `prepararLinha` e a mesma `chaveRota` que a execução usa, então
 * o número mostrado na confirmação é o número que vai ser gasto — não uma
 * estimativa paralela que pode divergir.
 */
export const planejarLote = (brutas: LinhaBidBruta[], p: ParametrosBid): PlanoLote => {
    const linhas = brutas.map(b => prepararLinha(b, p));
    const comRota = linhas.filter(l => l.chaveQualp);
    const distintas = new Set(comRota.map(l => l.chaveQualp!));
    return {
        linhas,
        linhasComRota: comRota.length,
        rotasDistintas: distintas.size,
        economiaPrevista: comRota.length - distintas.size,
        pendentes: linhas.filter(l => l.status === 'pendencia').length,
        urbanas: linhas.filter(l => l.status === 'urbano').length,
        teto: TETO_ROTAS_DISTINTAS,
        acimaDoTeto: distintas.size > TETO_ROTAS_DISTINTAS,
    };
};

/** O que o motor precisa da rota. Subconjunto do que o Qualp devolve. */
export interface RotaDoLote {
    km: number;
    pedagioCheio: number;
    pisoAntt: number | null;
}

/**
 * Calcula UMA linha já com a rota em mão. Função pura — é aqui que o motor
 * de preço e os custos ocultos entram, sem nenhuma conta nova.
 */
/**
 * Calcula UMA linha a partir da rota em cache. Função pura — é aqui que o motor
 * de preço e os custos ocultos entram, sem nenhuma conta nova.
 *
 * IDEMPOTENTE de propósito: reconstrói `pendencias` a partir de `pendenciasBase`
 * e monta `alertas` do zero. É isso que permite chamá-la de novo a cada mudança
 * de parâmetro sem empilhar mensagens repetidas.
 */
export const calcularLinhaBid = (linha: LinhaBid, rota: RotaDoLote, p: ParametrosBid): LinhaBid => {
    const base = {
        ...linha,
        rota,
        km: rota.km,
        pedagio: rota.pedagioCheio,
        pendencias: [...linha.pendenciasBase],
        alertas: [] as string[],
    };

    if (rota.pisoAntt == null) {
        return {
            ...base, status: 'pendencia',
            pendencias: [...base.pendencias, 'Qualp respondeu sem piso ANTT para esta combinação'],
            pisoAntt: null, custoBase: null, icmsPercent: null, icmsRS: null, federaisRS: null,
            taxaAntecipacao: null, precoSugerido: null, margemBrutaRS: null, margemBrutaPercent: null,
            custoAntecipacao: null, custoComissao: null, margemLiquidaRS: null, margemLiquidaPercent: null,
        };
    }

    // Base de custo da Fase 1: piso ANTT (o que se paga ao terceiro) + pedágio.
    const custoBase = rota.pisoAntt + rota.pedagioCheio;

    // ICMS pela UF da rota, com os overrides do master. Sem UF reconhecida o
    // getIcmsRate cai no seu próprio padrão (12%) — mesma regra da calculadora.
    const icmsPercent = getIcmsRate(linha.ufOrigem, linha.ufDestino, p.icmsRates || {}, false);

    const preco = calcularPreco({
        baseFreight: rota.pisoAntt,     // o que se paga ao terceiro
        tolls: rota.pedagioCheio,
        extraCosts: 0,
        otherCosts: [],
        goodsValue: 0,                  // a planilha do bid não traz valor de carga
        insurancePercent: 0,
        profitMargin: p.profitMargin,
        icmsPercent,
        fedTaxes: p.fedTaxes,
        modoTabelado: false,
        valorFinalTabelado: 0,
    });

    // Antecipação do bid: juros ao mês × prazo/30, sobre o valor PAGO ao
    // terceiro. A comissão segue sobre a receita.
    const taxaAntecipacao = taxaAntecipacaoProporcional(p.jurosMensal, p.prazoDias);
    const ocultos = calcularCustosOcultos({
        receita: preco.finalFreight,
        custoTerceiro: preco.bfEfetivo,
        margemBrutaRS: preco.realProfitAmount,
        prazoDias: String(p.prazoDias),
        comissaoPercent: p.comissaoPercent,
        taxaAntecipacaoDireta: taxaAntecipacao,
        comissaoPadrao: p.comissaoPadrao,
    });

    // Compliance: preço abaixo do piso ANTT nunca pode sair.
    const alertas: string[] = [];
    if (preco.finalFreight < rota.pisoAntt) {
        alertas.push(`Preço sugerido (R$ ${preco.finalFreight.toFixed(2)}) ABAIXO do piso ANTT (R$ ${rota.pisoAntt.toFixed(2)})`);
    }
    if (preco.bfEfetivo < rota.pisoAntt) {
        alertas.push(`Valor ao terceiro (R$ ${preco.bfEfetivo.toFixed(2)}) ABAIXO do piso ANTT (R$ ${rota.pisoAntt.toFixed(2)})`);
    }

    return {
        ...base,
        status: 'ok',
        alertas,
        pisoAntt: rota.pisoAntt,
        custoBase,
        icmsPercent,
        icmsRS: preco.icmsAmount,
        federaisRS: preco.fedTaxesAmount,
        taxaAntecipacao,
        precoSugerido: preco.finalFreight,
        margemBrutaRS: preco.realProfitAmount,
        margemBrutaPercent: preco.realMarginPercent,
        custoAntecipacao: ocultos.custoAntecipacao,
        custoComissao: ocultos.custoComissao,
        margemLiquidaRS: ocultos.lucroLiquido,
        margemLiquidaPercent: ocultos.margemLiquidaPercent,
    };
};

/**
 * MOTOR VIVO: recalcula o lote inteiro sobre a rota já em cache.
 *
 * NÃO CONSULTA NADA. Mexeu em margem, juros, prazo, comissão, tipo de carga ou
 * override de ICMS em cima, muda embaixo na hora — e sem gastar um centavo de
 * cota. Os dados fixos da rota (km, pedágio, piso, UFs) vêm da consulta
 * original, guardados em `linha.rota`.
 *
 * Linha sem rota em cache (pendência, urbana, falha) passa intacta: não há o
 * que recalcular, e inventar número aqui seria pior que deixar a pendência.
 */
export const recalcularLote = (linhas: LinhaBid[], p: ParametrosBid): LinhaBid[] =>
    linhas.map(l => (l.rota ? calcularLinhaBid(l, l.rota, p) : l));

// ---------------------------------------------------------------------------
// Orquestração: dedup + concorrência limitada
// ---------------------------------------------------------------------------

/** Resultado do Qualp como o lote precisa dele. */
export type RespostaRota =
    | { ok: true; rota: RotaDoLote }
    | { ok: false; urbano?: boolean; mensagem: string };

export interface DepsLote {
    /** O consultor de rota. Em produção é um wrapper de `estimateDistance`. */
    consultarRota: (origem: string, destino: string, veiculo: string, eixos: number, carga: string) => Promise<RespostaRota>;
    /** Quantas consultas simultâneas. Baixo de propósito: a cota é paga. */
    concorrencia?: number;
    /** Chamado a cada linha concluída, para a tela mostrar progresso. */
    onProgresso?: (concluidas: number, total: number) => void;
}

export interface ResultadoLote {
    linhas: LinhaBid[];
    /** O plano que foi usado — o custo previsto, para conferir contra o gasto. */
    plano: PlanoLote;
    /** Preenchido quando o teto bloqueou: nenhuma consulta foi feita. */
    bloqueado?: { motivo: string; rotasDistintas: number; teto: number };
    /** Quantas chamadas o Qualp realmente recebeu. */
    consultasQualp: number;
    /** Quantas rotas distintas existiam. Igual a consultasQualp quando o dedup funciona. */
    rotasDistintas: number;
    /** Consultas poupadas pelo dedup. */
    economizadas: number;
}

/**
 * Roda o lote inteiro. Nenhuma linha derruba as outras: pendência, frete
 * urbano e falha do Qualp viram STATUS da linha.
 *
 * Dedup por promessa compartilhada: duas linhas com a mesma rota aguardam a
 * MESMA consulta, mesmo disparadas ao mesmo tempo. Cache por string de chave
 * sozinho não garantiria isso — as duas veriam o cache vazio e consultariam.
 */
export const processarLoteBid = async (
    brutas: LinhaBidBruta[],
    p: ParametrosBid,
    deps: DepsLote,
): Promise<ResultadoLote> => {
    const plano = planejarLote(brutas, p);

    // TETO DURO. Checado aqui, e não só na tela: a trava não pode depender de
    // quem chama. Acima do teto NADA é consultado.
    if (plano.acimaDoTeto) {
        return {
            linhas: plano.linhas,
            plano,
            consultasQualp: 0,
            rotasDistintas: plano.rotasDistintas,
            economizadas: 0,
            bloqueado: {
                motivo: `O lote tem ${plano.rotasDistintas} rotas distintas, acima do teto de ${plano.teto}. Divida a planilha — nenhuma consulta foi feita.`,
                rotasDistintas: plano.rotasDistintas,
                teto: plano.teto,
            },
        };
    }

    const preparadas = plano.linhas;
    const concorrencia = Math.max(1, deps.concorrencia ?? 3);

    const cache = new Map<string, Promise<RespostaRota>>();
    let consultasQualp = 0;
    let concluidas = 0;

    const resolver = async (linha: LinhaBid): Promise<LinhaBid> => {
        // Sem chave = pendência de planilha ou frete urbano, os dois resolvidos
        // no preparo. Nenhum dos dois consulta nada.
        if (!linha.chaveQualp || linha.eixos == null) return linha;

        const chave = linha.chaveQualp;
        let promessa = cache.get(chave);
        const primeira = !promessa;
        if (!promessa) {
            consultasQualp++;
            promessa = deps.consultarRota(linha.origem, linha.destino, linha.veiculo, linha.eixos, p.cargoType);
            cache.set(chave, promessa);
        }

        const r = await promessa;
        const comFonte: LinhaBid = { ...linha, fonteRota: primeira ? 'qualp' : 'cache' };

        if (!r.ok) {
            return {
                ...comFonte,
                status: r.urbano ? 'urbano' : 'falha',
                pendencias: [...linha.pendenciasBase, r.mensagem],
            };
        }
        return calcularLinhaBid(comFonte, r.rota, p);
    };

    // Pool de workers: no máximo `concorrencia` consultas em voo. Nunca dispara
    // a planilha inteira de uma vez — a cota do Qualp é paga e limitada.
    const saida: LinhaBid[] = new Array(preparadas.length);
    let proxima = 0;
    const worker = async () => {
        for (;;) {
            const i = proxima++;
            if (i >= preparadas.length) return;
            saida[i] = await resolver(preparadas[i]);
            concluidas++;
            deps.onProgresso?.(concluidas, preparadas.length);
        }
    };
    await Promise.all(Array.from({ length: Math.min(concorrencia, preparadas.length || 1) }, worker));

    return {
        linhas: saida,
        plano,
        consultasQualp,
        rotasDistintas: cache.size,
        // Só quem reusou a consulta de outra linha. Frete urbano e pendência
        // não entram: eles não pouparam consulta, nunca precisaram de uma.
        economizadas: saida.filter(l => l.fonteRota === 'cache').length,
    };
};

// ---------------------------------------------------------------------------
// Resumo
// ---------------------------------------------------------------------------

export interface ResumoBid {
    total: number;
    ok: number;
    pendencia: number;
    urbano: number;
    falha: number;
    comAlerta: number;
    /** Média simples da margem líquida % das linhas que fecharam. */
    margemLiquidaMedia: number;
    totalPrecoSugerido: number;
    totalCustoBase: number;
}

export const resumirBid = (linhas: LinhaBid[]): ResumoBid => {
    const ok = linhas.filter(l => l.status === 'ok');
    const somaMargem = ok.reduce((a, l) => a + (l.margemLiquidaPercent ?? 0), 0);
    return {
        total: linhas.length,
        ok: ok.length,
        pendencia: linhas.filter(l => l.status === 'pendencia').length,
        urbano: linhas.filter(l => l.status === 'urbano').length,
        falha: linhas.filter(l => l.status === 'falha').length,
        comAlerta: linhas.filter(l => l.alertas.length > 0).length,
        margemLiquidaMedia: ok.length ? somaMargem / ok.length : 0,
        totalPrecoSugerido: ok.reduce((a, l) => a + (l.precoSugerido ?? 0), 0),
        totalCustoBase: ok.reduce((a, l) => a + (l.custoBase ?? 0), 0),
    };
};

/** Rótulo curto de status, usado na tela e no Excel. */
export const rotuloStatus = (l: LinhaBid): string => {
    if (l.status === 'ok') return l.alertas.length ? 'OK (com alerta)' : 'OK';
    if (l.status === 'urbano') return 'Frete urbano';
    if (l.status === 'falha') return 'Falha no Qualp';
    return 'Pendência';
};

/** Linhas prontas para o `XLSX.utils.json_to_sheet`. */
export const linhasParaExcel = (linhas: LinhaBid[]): Record<string, unknown>[] =>
    linhas.map(l => ({
        'Linha': l.linhaExcel,
        'Origem': l.origem,
        'Destino': l.destino,
        'Veículo': l.veiculo,
        'Veículo da planilha': l.veiculoDaLinha ? 'Sim' : 'Não (padrão do bid)',
        'Eixos': l.eixos ?? '',
        'KM': l.km ?? '',
        'Pedágio': l.pedagio ?? '',
        'Piso ANTT': l.pisoAntt ?? '',
        'Custo base (piso + pedágio)': l.custoBase ?? '',
        'ICMS %': l.icmsPercent ?? '',
        'ICMS R$': l.icmsRS ?? '',
        'Federais R$': l.federaisRS ?? '',
        'UF origem': l.ufOrigem,
        'UF destino': l.ufDestino,
        'Preço sugerido': l.precoSugerido ?? '',
        'Margem bruta R$': l.margemBrutaRS ?? '',
        'Margem bruta %': l.margemBrutaPercent ?? '',
        'Taxa antecipação %': l.taxaAntecipacao ?? '',
        'Antecipação R$': l.custoAntecipacao ?? '',
        'Comissão R$': l.custoComissao ?? '',
        'Margem líquida R$': l.margemLiquidaRS ?? '',
        'Margem líquida %': l.margemLiquidaPercent ?? '',
        // Procedencia da rota: serve pra conferir consumo do Qualp contra a fatura.
        'Rota': { qualp: 'Consultada no Qualp', cache: 'Reusada (dedup)', 'nao-consultada': 'Não consultada' }[l.fonteRota],
        'Status': rotuloStatus(l),
        'Observações': [...l.pendencias, ...l.alertas].join(' | '),
    }));
