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

    // ---- Resultado (null quando a linha não fechou) ----
    km: number | null;
    pedagio: number | null;
    pisoAntt: number | null;
    /** Base de custo da Fase 1: piso ANTT + pedágio cheio. */
    custoBase: number | null;
    icmsPercent: number | null;
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
    /** Eixos por tipo de veículo (do vehicleConfigs). */
    eixosPorVeiculo: Record<string, number | undefined>;
    /** Modo de cálculo por veículo. Fase 1 atende só 'ANTT'. */
    modoPorVeiculo: Record<string, string | undefined>;
    // ---- Custos ocultos, escolhidos para o bid inteiro ----
    /** Prazo de pagamento em dias. '' = não informado (antecipação zero). */
    prazoDias: string;
    /** Comissão (%) como string; '' = cai no padrão das Configurações. */
    comissaoPercent: string;
    taxasAntecipacao?: Record<string, number>;
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
        return {
            linhaExcel: i + 2,   // +1 do cabeçalho, +1 porque planilha começa em 1
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
    const veiculoDaLinha = bruta.veiculoPlanilha !== '';
    const veiculo = veiculoDaLinha ? bruta.veiculoPlanilha : p.veiculoPadrao;

    if (!bruta.origem) pendencias.push('Origem em branco');
    if (!bruta.destino) pendencias.push('Destino em branco');
    if (!veiculo) pendencias.push('Sem veículo na linha e sem veículo padrão escolhido');

    const eixos = veiculo ? (p.eixosPorVeiculo[veiculo] ?? null) : null;
    if (veiculo && eixos == null) pendencias.push(`Veículo "${veiculo}" não está cadastrado (sem eixos)`);

    // Fase 1 precifica sobre o piso ANTT. Veículo de tarifa por KM ou preço
    // livre não tem piso, e usar o piso de outro veículo daria número errado —
    // que é pior que linha em branco.
    const modo = veiculo ? p.modoPorVeiculo[veiculo] : undefined;
    if (veiculo && eixos != null && modo && modo !== 'ANTT') {
        pendencias.push(`Veículo "${veiculo}" não usa tabela ANTT (modo ${modo}) — fora do escopo da Fase 1`);
    }

    return {
        ...bruta,
        veiculo, veiculoDaLinha, eixos,
        status: pendencias.length ? 'pendencia' : 'ok',
        pendencias, alertas: [],
        chaveQualp: pendencias.length || eixos == null ? null : chaveRota(bruta.origem, bruta.destino, eixos, p.cargoType),
        fonteRota: 'nao-consultada',
        km: null, pedagio: null, pisoAntt: null, custoBase: null, icmsPercent: null,
        precoSugerido: null, margemBrutaRS: null, margemBrutaPercent: null,
        custoAntecipacao: null, custoComissao: null,
        margemLiquidaRS: null, margemLiquidaPercent: null,
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
export const calcularLinhaBid = (linha: LinhaBid, rota: RotaDoLote, p: ParametrosBid): LinhaBid => {
    if (rota.pisoAntt == null) {
        return {
            ...linha, status: 'pendencia',
            km: rota.km, pedagio: rota.pedagioCheio,
            pendencias: [...linha.pendencias, 'Qualp respondeu sem piso ANTT para esta combinação'],
        };
    }

    // Base de custo da Fase 1: piso ANTT (o que se paga ao terceiro) + pedágio.
    const custoBase = rota.pisoAntt + rota.pedagioCheio;

    // ICMS pela UF da rota, com os overrides do master. Sem UF reconhecida o
    // getIcmsRate cai no seu próprio padrão (12%) — mesma regra da calculadora.
    const ufOrigem = getUF(linha.origem) || '';
    const ufDestino = getUF(linha.destino) || '';
    const icmsPercent = getIcmsRate(ufOrigem, ufDestino, p.icmsRates || {}, false);

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

    const ocultos = calcularCustosOcultos({
        receita: preco.finalFreight,
        custoTerceiro: preco.bfEfetivo,
        margemBrutaRS: preco.realProfitAmount,
        prazoDias: p.prazoDias,
        comissaoPercent: p.comissaoPercent,
        taxasAntecipacao: p.taxasAntecipacao,
        comissaoPadrao: p.comissaoPadrao,
    });

    // Compliance: preço abaixo do piso ANTT nunca pode sair.
    const alertas = [...linha.alertas];
    if (preco.finalFreight < rota.pisoAntt) {
        alertas.push(`Preço sugerido (R$ ${preco.finalFreight.toFixed(2)}) ABAIXO do piso ANTT (R$ ${rota.pisoAntt.toFixed(2)})`);
    }
    if (preco.bfEfetivo < rota.pisoAntt) {
        alertas.push(`Valor ao terceiro (R$ ${preco.bfEfetivo.toFixed(2)}) ABAIXO do piso ANTT (R$ ${rota.pisoAntt.toFixed(2)})`);
    }

    return {
        ...linha,
        status: 'ok',
        alertas,
        km: rota.km,
        pedagio: rota.pedagioCheio,
        pisoAntt: rota.pisoAntt,
        custoBase,
        icmsPercent,
        precoSugerido: preco.finalFreight,
        margemBrutaRS: preco.realProfitAmount,
        margemBrutaPercent: preco.realMarginPercent,
        custoAntecipacao: ocultos.custoAntecipacao,
        custoComissao: ocultos.custoComissao,
        margemLiquidaRS: ocultos.lucroLiquido,
        margemLiquidaPercent: ocultos.margemLiquidaPercent,
    };
};

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
    const preparadas = brutas.map(b => prepararLinha(b, p));
    const concorrencia = Math.max(1, deps.concorrencia ?? 3);

    const cache = new Map<string, Promise<RespostaRota>>();
    let consultasQualp = 0;
    let concluidas = 0;

    const resolver = async (linha: LinhaBid): Promise<LinhaBid> => {
        // Pendência de planilha: não consulta nada.
        if (linha.status === 'pendencia' || !linha.chaveQualp || linha.eixos == null) return linha;

        // Frete urbano: detectado ANTES de chamar, igual à Edge Function faz.
        // Não gasta consulta para uma resposta que já conhecemos.
        if (mesmoMunicipio(linha.origem, linha.destino)) {
            return { ...linha, status: 'urbano', pendencias: [...linha.pendencias, 'Frete urbano (origem = destino): não cotado automaticamente'] };
        }

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
                pendencias: [...linha.pendencias, r.mensagem],
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
        'Preço sugerido': l.precoSugerido ?? '',
        'Margem bruta R$': l.margemBrutaRS ?? '',
        'Margem bruta %': l.margemBrutaPercent ?? '',
        'Antecipação R$': l.custoAntecipacao ?? '',
        'Comissão R$': l.custoComissao ?? '',
        'Margem líquida R$': l.margemLiquidaRS ?? '',
        'Margem líquida %': l.margemLiquidaPercent ?? '',
        // Procedencia da rota: serve pra conferir consumo do Qualp contra a fatura.
        'Rota': { qualp: 'Consultada no Qualp', cache: 'Reusada (dedup)', 'nao-consultada': 'Não consultada' }[l.fonteRota],
        'Status': rotuloStatus(l),
        'Observações': [...l.pendencias, ...l.alertas].join(' | '),
    }));
