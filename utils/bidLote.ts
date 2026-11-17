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
 *
 * AJUSTES DE CUSTO (ICMS opcional, adicional sobre o piso, seguro, abertura):
 * tudo entra por parâmetros que o motor JÁ recebe — `icmsPercent`,
 * `baseFreight`, `goodsValue`, `insurancePercent`. O motor não muda. Os
 * parâmetros novos do bid são opcionais e o default de cada um é o
 * comportamento anterior: ICMS incluso, adicional 0, seguro não definido.
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
 * Colunas que o bid LÊ quando existem, mas cuja falta não é problema: não
 * entram no `COLUNAS_BID` porque lá toda coluna ausente vira aviso amarelo de
 * "coluna não encontrada", e planilha sem valor de NF é o caso comum.
 */
export const COLUNAS_BID_OPCIONAIS: Record<string, string[]> = {
    valorMercadoria: [
        'Valor Mercadoria', 'Valor da Mercadoria', 'Valor de Mercadoria', 'Valor NF', 'Valor da NF',
        'Valor Nota', 'Valor Nota Fiscal', 'Valor da Nota Fiscal', 'Valor Carga', 'Valor da Carga',
    ],
    tabelaCompra: ['Tabela de Compra', 'Tabela Compra', 'Valor Compra', 'Valor de Compra', 'Frete Compra'],
};

/**
 * Número de célula de planilha: aceita número nativo e texto em formato
 * brasileiro ("R$ 1.234,56"). Vazio ou ilegível = null, nunca zero — zero de
 * valor de mercadoria zeraria o seguro sem ninguém ver.
 */
export const lerNumeroPlanilha = (v: unknown): number | null => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    let t = String(v ?? '').replace(/R\$/gi, '').replace(/\s/g, '');
    if (!t) return null;
    if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(t);
    return Number.isFinite(n) ? n : null;
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
    /** Valor da mercadoria / NF, quando a planilha tem a coluna. null = célula vazia. */
    valorMercadoria?: number | null;
    /** Tabela de compra própria da linha (R$), quando a planilha tem a coluna. */
    tabelaCompra?: number | null;
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
    /** Custo direto: custo motorista + pedágio. Sem adicional, = piso ANTT + pedágio. */
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

    // ---- Abertura de custos ----
    /** Adicional sobre o piso aplicado (%): o próprio da linha ou o padrão da rodada. */
    adicionalPisoPct: number | null;
    /** true = a linha tem adicional próprio, não segue o padrão da rodada. */
    adicionalProprio: boolean;
    /** Piso × adicional% (R$). Não incide sobre pedágio. */
    adicionalPisoRS: number | null;
    /** O que se paga ao terceiro: piso com adicional, ou a tabela de compra se maior. */
    custoMotorista: number | null;
    /** Valor de mercadoria usado no seguro: o da linha ou o padrão da rodada. */
    valorMercadoriaEfetivo: number | null;
    /** Ad valorem cobrado (%). 0 em DDR e em seguro não definido. */
    seguroPct: number | null;
    /** Ad valorem COBRADO do cliente (R$) — entra no preço, regra da calculadora. */
    seguroRS: number | null;
    /** Custo real do seguro (R$): valor da mercadoria × taxa da apólice. */
    seguroCustoRS: number | null;
    comissaoPct: number | null;
    federaisPct: number | null;
    /** Motor rodado com ICMS zerado na formação do preço. */
    freteSemIcms: number | null;
    /** Motor rodado com a alíquota da rota. */
    freteComIcms: number | null;
    /** Frete com ICMS se a rodada é com ICMS incluso; senão, frete sem ICMS. */
    precoOfertado: number | null;
    /** ICMS que está DENTRO do preço ofertado (0 quando o ICMS vai por fora). */
    icmsNoPrecoRS: number | null;
    /** Frete sem ICMS / custo direto (formato 1,20). */
    markup: number | null;
}

/** Como o seguro entra na rodada. */
export type SeguroModo = 'nao_definido' | 'ddr' | 'ad_valorem';

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
    // ---- Ajustes de custo. Todos opcionais; o default é o comportamento anterior ----
    /** false = preço ofertado SEM ICMS (ICMS por fora). Default true. */
    icmsIncluso?: boolean;
    /** Adicional sobre o piso ANTT (%) das linhas sem valor próprio. Default 0. */
    adicionalPisoPadraoPct?: number;
    /** Adicional próprio por linha: linhaExcel -> %. Ausente = segue o padrão. */
    adicionalPorLinha?: Record<number, number>;
    /** Default 'nao_definido' (sem custo de seguro, como era). */
    seguroModo?: SeguroModo;
    /** Ad valorem (%), usado só em 'ad_valorem'. */
    seguroPct?: number;
    /** Valor de mercadoria das linhas que não trazem o seu. */
    valorMercadoriaPadrao?: number | null;
    /** Valor de mercadoria editado na tela: linhaExcel -> R$. Vence o da planilha. */
    valorMercadoriaPorLinha?: Record<number, number>;
}

/** Acima disto o adicional gera aviso amarelo (não bloqueia). */
export const ADICIONAL_PISO_AVISO_PCT = 50;

export interface ValidacaoAdicional {
    ok: boolean;
    erro: string | null;
    aviso: string | null;
}

/**
 * Valida um adicional sobre o piso. Negativo é BLOQUEADO: o custo motorista
 * nunca fica abaixo do piso ANTT. Acima de 50% é só aviso.
 */
export const validarAdicionalPiso = (v: number): ValidacaoAdicional => {
    if (!Number.isFinite(v)) return { ok: false, erro: 'Adicional inválido', aviso: null };
    if (v < 0) return { ok: false, erro: 'Adicional negativo é bloqueado: o custo motorista nunca fica abaixo do piso ANTT', aviso: null };
    if (v > ADICIONAL_PISO_AVISO_PCT) return { ok: true, erro: null, aviso: `Adicional acima de ${ADICIONAL_PISO_AVISO_PCT}% — confira` };
    return { ok: true, erro: null, aviso: null };
};

/**
 * Grava o adicional próprio em várias linhas de uma vez ("aplicar às
 * selecionadas", ou a edição de uma célula). `valor` null devolve as linhas ao
 * padrão da rodada. Valor inválido não altera nada e devolve o erro.
 */
export const aplicarAdicionalLinhas = (
    atual: Record<number, number>,
    linhasExcel: number[],
    valor: number | null,
): { mapa: Record<number, number>; erro: string | null } => {
    if (valor != null) {
        const v = validarAdicionalPiso(valor);
        if (!v.ok) return { mapa: atual, erro: v.erro };
    }
    const mapa = { ...atual };
    for (const n of linhasExcel) {
        if (valor == null) delete mapa[n];
        else mapa[n] = valor;
    }
    return { mapa, erro: null };
};

/**
 * O adicional só vale para veículo de tabela ANTT. Veículo sem modo no
 * cadastro segue a mesma regra do preparo, que só barra modo DIFERENTE de ANTT.
 */
export const adicionalEditavel = (l: LinhaBid, p: ParametrosBid): boolean => {
    const modo = l.veiculo ? p.modoPorVeiculo[l.veiculo] : undefined;
    return l.status === 'ok' && l.pisoAntt != null && (!modo || modo === 'ANTT');
};

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
            // Só aparecem quando a planilha tem a coluna: sem ela a linha fica
            // exatamente como era.
            ...(mapa.valorMercadoria ? { valorMercadoria: lerNumeroPlanilha(l[mapa.valorMercadoria]) } : {}),
            ...(mapa.tabelaCompra ? { tabelaCompra: lerNumeroPlanilha(l[mapa.tabelaCompra]) } : {}),
        };
    });

/** Abertura de custos de uma linha que não fechou preço. */
const ABERTURA_VAZIA = {
    adicionalPisoPct: null, adicionalProprio: false, adicionalPisoRS: null, custoMotorista: null,
    valorMercadoriaEfetivo: null, seguroPct: null, seguroRS: null, seguroCustoRS: null,
    comissaoPct: null, federaisPct: null, freteSemIcms: null, freteComIcms: null,
    precoOfertado: null, icmsNoPrecoRS: null, markup: null,
} as const;

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
        ...ABERTURA_VAZIA,
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
     * Consultas que o lote vai GASTAR: rotas distintas pós-dedup que ainda não
     * estão em cache. É este o número da confirmação — não o total de linhas,
     * nem o total de rotas quando parte delas já foi consultada.
     */
    rotasDistintas: number;
    /** Rotas distintas que já estão em cache e não serão consultadas de novo. */
    rotasJaConhecidas: number;
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
export const planejarLote = (
    brutas: LinhaBidBruta[],
    p: ParametrosBid,
    rotasEmCache: Record<string, RotaDoLote> = {},
): PlanoLote => {
    const linhas = brutas.map(b => prepararLinha(b, p));
    const comRota = linhas.filter(l => l.chaveQualp);
    const distintas = new Set(comRota.map(l => l.chaveQualp!));
    // O que vai ser GASTO é só o que ainda não está em cache. Depois de um
    // de-para, a maior parte do lote já foi consultada — cobrar de novo pelo
    // total faria a confirmação pedir autorização para um gasto que não existe.
    const novas = [...distintas].filter(k => !rotasEmCache[k]);
    return {
        linhas,
        linhasComRota: comRota.length,
        rotasDistintas: novas.length,
        rotasJaConhecidas: distintas.size - novas.length,
        economiaPrevista: comRota.length - distintas.size,
        pendentes: linhas.filter(l => l.status === 'pendencia').length,
        urbanas: linhas.filter(l => l.status === 'urbano').length,
        teto: TETO_ROTAS_DISTINTAS,
        acimaDoTeto: novas.length > TETO_ROTAS_DISTINTAS,
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
            ...ABERTURA_VAZIA,
        };
    }

    // ADICIONAL SOBRE O PISO: incide só no piso, nunca no pedágio. Negativo
    // não passa (o setter já barra; o Math.max é a segunda trava). Com
    // adicional 0, piso × 1 é o próprio piso — bit a bit o número de antes.
    const adicionalLinha = p.adicionalPorLinha?.[linha.linhaExcel];
    const adicionalProprio = adicionalLinha != null;
    const adicionalPisoPct = Math.max(0, adicionalLinha ?? p.adicionalPisoPadraoPct ?? 0);
    const pisoComAdicional = rota.pisoAntt * (1 + adicionalPisoPct / 100);
    // Tabela de compra própria da linha: paga-se o MAIOR dos dois.
    const tabelaCompra = linha.tabelaCompra ?? null;
    const custoMotorista = tabelaCompra != null ? Math.max(pisoComAdicional, tabelaCompra) : pisoComAdicional;

    // Custo direto: custo motorista + pedágio.
    const custoBase = custoMotorista + rota.pedagioCheio;

    // ICMS pela UF da rota, com os overrides do master. Sem UF reconhecida o
    // getIcmsRate cai no seu próprio padrão (12%) — mesma regra da calculadora.
    const icmsPercent = getIcmsRate(linha.ufOrigem, linha.ufDestino, p.icmsRates || {}, false);

    // SEGURO: a regra é a do motor (goodsValue × insurancePercent no preço,
    // goodsValue × taxa da apólice no custo). DDR e não definido = sem seguro,
    // que é exatamente o que o bid fazia antes (goodsValue 0).
    const seguroModo = p.seguroModo ?? 'nao_definido';
    const valorMercadoriaEfetivo = p.valorMercadoriaPorLinha?.[linha.linhaExcel]
        ?? linha.valorMercadoria ?? p.valorMercadoriaPadrao ?? null;
    const adValorem = seguroModo === 'ad_valorem';
    const seguroPct = adValorem ? (p.seguroPct ?? 0) : 0;

    const entrada = {
        baseFreight: custoMotorista,    // o que se paga ao terceiro
        tolls: rota.pedagioCheio,
        extraCosts: 0,
        otherCosts: [],
        goodsValue: adValorem ? (valorMercadoriaEfetivo ?? 0) : 0,
        insurancePercent: seguroPct,
        profitMargin: p.profitMargin,
        fedTaxes: p.fedTaxes,
        modoTabelado: false,
        valorFinalTabelado: 0,
    };
    // O motor roda DUAS vezes: com a alíquota da rota e com ICMS zerado na
    // formação do preço. A rodada escolhe qual é o preço ofertado; a margem e
    // todos os custos seguem a mesma escolha.
    const comIcms = calcularPreco({ ...entrada, icmsPercent });
    const semIcms = calcularPreco({ ...entrada, icmsPercent: 0 });
    const icmsIncluso = p.icmsIncluso ?? true;
    const preco = icmsIncluso ? comIcms : semIcms;

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
    if (adValorem && valorMercadoriaEfetivo == null) {
        alertas.push('Seguro ad valorem sem valor de mercadoria: seguro zerado nesta linha');
    }
    if (adicionalPisoPct > ADICIONAL_PISO_AVISO_PCT) {
        alertas.push(`Adicional sobre o piso de ${adicionalPisoPct}% (acima de ${ADICIONAL_PISO_AVISO_PCT}%)`);
    }
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
        // Alíquota e ICMS ficam sempre visíveis, mesmo com o ICMS por fora:
        // é o valor que o embarcador vai ter de recolher.
        icmsRS: comIcms.icmsAmount,
        federaisRS: preco.fedTaxesAmount,
        taxaAntecipacao,
        precoSugerido: preco.finalFreight,
        margemBrutaRS: preco.realProfitAmount,
        margemBrutaPercent: preco.realMarginPercent,
        custoAntecipacao: ocultos.custoAntecipacao,
        custoComissao: ocultos.custoComissao,
        margemLiquidaRS: ocultos.lucroLiquido,
        margemLiquidaPercent: ocultos.margemLiquidaPercent,
        adicionalPisoPct,
        adicionalProprio,
        adicionalPisoRS: pisoComAdicional - rota.pisoAntt,
        custoMotorista,
        valorMercadoriaEfetivo,
        seguroPct,
        seguroRS: preco.adValoremSelling,
        seguroCustoRS: preco.adValoremCost,
        comissaoPct: ocultos.comissaoPercent,
        federaisPct: p.fedTaxes.pis + p.fedTaxes.cofins + p.fedTaxes.csll + p.fedTaxes.irpj,
        freteSemIcms: semIcms.finalFreight,
        freteComIcms: comIcms.finalFreight,
        precoOfertado: preco.finalFreight,
        icmsNoPrecoRS: preco.icmsAmount,
        markup: custoBase > 0 ? semIcms.finalFreight / custoBase : null,
    };
};

/**
 * Extrai o cache de rotas das linhas atuais: chave de dedup -> dados fixos.
 * É o que permite re-preparar o lote (de-para de veículo, por exemplo) sem
 * jogar fora o que o Qualp já respondeu.
 */
export const extrairCacheDeRotas = (linhas: LinhaBid[]): Record<string, RotaDoLote> => {
    const cache: Record<string, RotaDoLote> = {};
    for (const l of linhas) if (l.chaveQualp && l.rota) cache[l.chaveQualp] = l.rota;
    return cache;
};

export interface ReaplicacaoLote {
    linhas: LinhaBid[];
    /** Chaves de rota que ainda NÃO estão em cache: o que custaria consultar. */
    rotasNovas: string[];
}

/**
 * RE-APLICA os parâmetros ao lote inteiro, do preparo em diante, reusando as
 * rotas já consultadas. Puro: não consulta nada.
 *
 * Existe porque `recalcularLote` não bastava. Ele só refazia a CONTA sobre
 * `linha.rota`, e linha sem rota passava intacta — então mexer no de-para de
 * veículo não resolvia nada: a linha ambígua nunca tinha sido consultada (era
 * pendência, sem chave de Qualp), e a resolução do veículo ficava congelada no
 * preparo original. O de-para "parecia" preenchido e a linha seguia ambígua.
 *
 * Aqui o `prepararLinha` roda DE NOVO com os parâmetros novos, então o veículo
 * é re-resolvido; a rota volta do cache quando a chave já é conhecida. Linha que
 * passou a resolver mas ainda não tem rota entra em `rotasNovas` — é consulta
 * nova, custa cota, e por isso passa pela confirmação em vez de disparar só
 * porque alguém mexeu num dropdown.
 */
export const reaplicarLote = (
    brutas: LinhaBidBruta[],
    p: ParametrosBid,
    rotasEmCache: Record<string, RotaDoLote> = {},
): ReaplicacaoLote => {
    const novas = new Set<string>();
    const linhas = brutas.map(b => {
        const linha = prepararLinha(b, p);
        if (!linha.chaveQualp) return linha;                 // pendência ou urbana
        const rota = rotasEmCache[linha.chaveQualp];
        if (rota) return { ...calcularLinhaBid(linha, rota, p), fonteRota: 'cache' as const };
        novas.add(linha.chaveQualp);
        return {
            ...linha,
            status: 'pendencia' as const,
            pendencias: [...linha.pendenciasBase, 'Rota ainda não consultada — confirme a consulta ao Qualp'],
        };
    });
    return { linhas, rotasNovas: [...novas] };
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
    /**
     * Rotas já conhecidas (chave -> dados fixos). Entram no cache do lote antes
     * de começar, então re-rodar o lote depois de um de-para consulta SÓ o que
     * é novo. Sem isto, resolver uma ambiguidade pagaria o lote inteiro de novo.
     */
    rotasEmCache?: Record<string, RotaDoLote>;
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
    const rotasEmCache = deps.rotasEmCache || {};
    const plano = planejarLote(brutas, p, rotasEmCache);

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
    // Semeia o cache com o que já é conhecido: estas chaves não geram consulta.
    for (const [chave, rota] of Object.entries(rotasEmCache)) {
        cache.set(chave, Promise.resolve({ ok: true, rota }));
    }
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

// ---------------------------------------------------------------------------
// Abertura de custos: UMA definição de colunas para a tela e para o Excel
// ---------------------------------------------------------------------------

export type FormatoColuna = 'texto' | 'brl' | 'pct' | 'km' | 'inteiro' | 'markup';

export interface ColunaAbertura {
    id: string;
    titulo: string;
    formato: FormatoColuna;
    /** Item 1–16 da abertura de custos. */
    grupo: number;
    /** Visível sem "Abrir custos". O Excel sai sempre com todas. */
    sempreVisivel: boolean;
    /** Entra somada na linha de totais (colunas em R$). */
    soma: boolean;
    valor: (l: LinhaBid) => number | string | null;
}

const col = (
    grupo: number, id: string, titulo: string, formato: FormatoColuna,
    valor: (l: LinhaBid) => number | string | null,
    sempreVisivel = false,
): ColunaAbertura => ({ id, titulo, formato, grupo, sempreVisivel, soma: formato === 'brl', valor });

/**
 * A ordem é a da abertura de custos (1 a 16). Sempre visíveis: rota (1), custo
 * motorista (4), pedágio (5), o bloco de ICMS e fretes (11, 13, 14), markup
 * (12), preço ofertado (15) e margem líquida (16).
 */
export const COLUNAS_ABERTURA: ColunaAbertura[] = [
    col(1, 'origem', 'Origem', 'texto', l => l.origem, true),
    col(1, 'ufOrigem', 'UF origem', 'texto', l => l.ufOrigem, true),
    col(1, 'destino', 'Destino', 'texto', l => l.destino, true),
    col(1, 'ufDestino', 'UF destino', 'texto', l => l.ufDestino, true),
    col(1, 'km', 'Km', 'km', l => l.km, true),
    col(1, 'veiculo', 'Veículo', 'texto', l => l.veiculo, true),
    col(1, 'eixos', 'Eixos', 'inteiro', l => l.eixos, true),
    col(2, 'pisoAntt', 'Piso ANTT R$', 'brl', l => l.pisoAntt),
    col(3, 'adicionalPisoPct', 'Adicional piso %', 'pct', l => l.adicionalPisoPct),
    col(3, 'adicionalPisoRS', 'Adicional piso R$', 'brl', l => l.adicionalPisoRS),
    col(4, 'custoMotorista', 'Custo motorista R$', 'brl', l => l.custoMotorista, true),
    col(5, 'pedagio', 'Pedágio R$', 'brl', l => l.pedagio, true),
    col(6, 'custoDireto', 'Custo direto R$', 'brl', l => l.custoBase),
    col(7, 'seguroPct', 'Seguro %', 'pct', l => l.seguroPct),
    col(7, 'valorMercadoria', 'Valor mercadoria R$', 'brl', l => l.valorMercadoriaEfetivo),
    col(7, 'seguroRS', 'Seguro cobrado R$', 'brl', l => l.seguroRS),
    col(7, 'seguroCustoRS', 'Seguro custo apólice R$', 'brl', l => l.seguroCustoRS),
    col(8, 'custoFinanceiroPct', 'Custo financeiro %', 'pct', l => l.taxaAntecipacao),
    col(8, 'custoFinanceiroRS', 'Custo financeiro R$', 'brl', l => l.custoAntecipacao),
    col(9, 'comissaoPct', 'Comissão %', 'pct', l => l.comissaoPct),
    col(9, 'comissaoRS', 'Comissão R$', 'brl', l => l.custoComissao),
    col(10, 'federaisPct', 'Impostos federais %', 'pct', l => l.federaisPct),
    col(10, 'federaisRS', 'Impostos federais R$', 'brl', l => l.federaisRS),
    col(11, 'icmsPct', 'Alíquota ICMS %', 'pct', l => l.icmsPercent, true),
    col(11, 'icmsRS', 'ICMS R$', 'brl', l => l.icmsRS, true),
    col(12, 'markup', 'Markup', 'markup', l => l.markup, true),
    col(13, 'freteSemIcms', 'Frete sem ICMS R$', 'brl', l => l.freteSemIcms, true),
    col(14, 'freteComIcms', 'Frete com ICMS R$', 'brl', l => l.freteComIcms, true),
    col(15, 'precoOfertado', 'Preço ofertado R$', 'brl', l => l.precoOfertado, true),
    col(16, 'margemLiquidaRS', 'Margem líquida R$', 'brl', l => l.margemLiquidaRS, true),
    col(16, 'margemLiquidaPct', 'Margem líquida %', 'pct', l => l.margemLiquidaPercent, true),
];

/**
 * Linha de totais: soma das colunas em R$ das linhas que fecharam preço;
 * markup e margem PONDERADOS (razão das somas, não média das razões).
 */
export const totaisAbertura = (linhas: LinhaBid[]): Record<string, number | null> => {
    const ok = linhas.filter(l => l.status === 'ok');
    const soma = (f: (l: LinhaBid) => number | null) => ok.reduce((a, l) => a + (f(l) ?? 0), 0);
    const tot: Record<string, number | null> = {};
    for (const c of COLUNAS_ABERTURA) {
        if (c.soma) tot[c.id] = soma(l => { const v = c.valor(l); return typeof v === 'number' ? v : null; });
    }
    const custoDireto = soma(l => l.custoBase);
    const ofertado = soma(l => l.precoOfertado);
    tot.markup = custoDireto > 0 ? soma(l => l.freteSemIcms) / custoDireto : null;
    tot.margemLiquidaPct = ofertado > 0 ? (soma(l => l.margemLiquidaRS) / ofertado) * 100 : null;
    return tot;
};

const ROTULO_SEGURO: Record<SeguroModo, string> = {
    nao_definido: 'Não definido (sem custo de seguro)',
    ddr: 'DDR (seguro do embarcador)',
    ad_valorem: 'Ad valorem',
};

/** Norma do piso ANTT vigente, mostrada no cabeçalho do Excel. */
export const NORMA_PISO_ANTT = 'Resolução ANTT nº 6.084/2026 (Tabela A, piso via Qualp)';

/** Os parâmetros da rodada, como saem no topo do Excel. */
export const parametrosRodadaExcel = (p: ParametrosBid, dataCalculo: Date): [string, string][] => {
    const n = (v: number, casas = 2) => v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
    const seguroModo = p.seguroModo ?? 'nao_definido';
    return [
        ['ICMS', (p.icmsIncluso ?? true) ? 'Incluso no preço' : 'NÃO incluso (ICMS por fora ou por conta do embarcador)'],
        ['Adicional padrão sobre o piso', `${n(p.adicionalPisoPadraoPct ?? 0)}%`],
        ['Seguro', seguroModo === 'ad_valorem' ? `${ROTULO_SEGURO[seguroModo]} ${n(p.seguroPct ?? 0, 3)}%` : ROTULO_SEGURO[seguroModo]],
        ['Valor de mercadoria padrão', p.valorMercadoriaPadrao != null ? `R$ ${n(p.valorMercadoriaPadrao)}` : '—'],
        ['Prazo de pagamento', `${p.prazoDias} dias (juros ${n(p.jurosMensal)}% a.m. → ${n(taxaAntecipacaoProporcional(p.jurosMensal, p.prazoDias))}%)`],
        ['Margem pretendida', `${n(p.profitMargin)}%`],
        ['Portaria ANTT vigente', NORMA_PISO_ANTT],
        ['Data do cálculo', dataCalculo.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })],
    ];
};

/** Colunas de controle que o Excel leva além da abertura. */
const ROTULO_ROTA: Record<LinhaBid['fonteRota'], string> = {
    qualp: 'Consultada no Qualp', cache: 'Reusada (dedup)', 'nao-consultada': 'Não consultada',
};

/**
 * A planilha inteira como matriz (`XLSX.utils.aoa_to_sheet`): bloco de
 * parâmetros da rodada, linha em branco, cabeçalho e as linhas com TODAS as
 * colunas da abertura, na mesma ordem da tela, e a linha de totais.
 */
export const montarPlanilhaBid = (linhas: LinhaBid[], p: ParametrosBid, dataCalculo: Date): (string | number)[][] => {
    const vazio = (v: number | string | null) => (v == null ? '' : v);
    const tot = totaisAbertura(linhas);
    return [
        ['Parâmetros da rodada'],
        ...parametrosRodadaExcel(p, dataCalculo),
        [],
        ['Linha', ...COLUNAS_ABERTURA.map(c => c.titulo), 'Adicional próprio', 'Status', 'Rota', 'Observações'],
        ...linhas.map(l => [
            l.linhaExcel,
            ...COLUNAS_ABERTURA.map(c => vazio(c.valor(l))),
            l.adicionalProprio ? 'Sim' : '',
            rotuloStatus(l),
            ROTULO_ROTA[l.fonteRota],
            [...l.pendencias, ...l.alertas].join(' | '),
        ]),
        ['Total', ...COLUNAS_ABERTURA.map(c => vazio(tot[c.id] ?? null)), '', '', '', ''],
    ];
};

/** Linhas como objetos (título -> valor), na ordem da abertura. */
export const linhasParaExcel = (linhas: LinhaBid[]): Record<string, unknown>[] =>
    linhas.map(l => ({
        'Linha': l.linhaExcel,
        ...Object.fromEntries(COLUNAS_ABERTURA.map(c => [c.titulo, c.valor(l) ?? ''])),
        'Adicional próprio': l.adicionalProprio ? 'Sim' : '',
        'Status': rotuloStatus(l),
        // Procedencia da rota: serve pra conferir consumo do Qualp contra a fatura.
        'Rota': ROTULO_ROTA[l.fonteRota],
        'Observações': [...l.pendencias, ...l.alertas].join(' | '),
    }));
