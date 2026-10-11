/**
 * MOTOR DE PREÇO — a equação única da cotação.
 *
 * Extraído do `useMemo calcData` do App.tsx por MOVIMENTAÇÃO PURA: as contas
 * abaixo são as mesmas linhas, na mesma ordem, com os mesmos parênteses. O que
 * mudou é só a fronteira — as 11 variáveis que antes vinham do closure do
 * componente agora entram como parâmetro, e o parsing das máscaras ficou na
 * casca do App.tsx.
 *
 * É função pura e síncrona: serve a cotação individual e, pelo mesmo caminho,
 * qualquer uso em lote. Fonte da verdade ÚNICA — qualquer tela que precise de
 * preço, imposto ou margem chama aqui, nunca reimplementa.
 *
 * ENTRADAS JÁ EM `number`. Quem tem string mascarada ("R$ 1.234,56", "0,2")
 * converte ANTES de chamar. Isso é deliberado: o motor não conhece máscara de
 * input, e o lote não paga o pedágio de formatar número para desformatar.
 */

import type { ExtraCostItem } from '../types';

/**
 * Os parâmetros tributários que o motor consome. Estrutural de propósito: o
 * `FederalTaxes` inteiro do sistema se encaixa aqui, e o lote pode montar só
 * estes cinco campos sem arrastar metas, ICMS por rota e custos ocultos.
 */
export interface ParametrosTributarios {
    /** Taxa da apólice (%) — ad valorem de CUSTO, diferente do cobrado do cliente. */
    insurancePolicyRate: number;
    pis: number;
    cofins: number;
    csll: number;
    irpj: number;
}

export interface EntradaPreco {
    /** Preço base / poder de compra: o que se paga ao terceiro. Ignorado no modo Tabelado. */
    baseFreight: number;
    tolls: number;
    extraCosts: number;
    otherCosts: ExtraCostItem[];
    goodsValue: number;
    /** Ad valorem COBRADO do cliente (%). */
    insurancePercent: number;
    /** Margem pretendida (%). */
    profitMargin: number;
    icmsPercent: number;
    fedTaxes: ParametrosTributarios;
    /** true = preço dado e motorista derivado (frete tabelado/contrato). */
    modoTabelado: boolean;
    /** Valor final digitado. Só usado quando modoTabelado = true. */
    valorFinalTabelado: number;
}

export interface ResultadoPreco {
    directCosts: number;
    realDirectCosts: number;
    priceAfterMargin: number;
    /** O valor cotado ao cliente. */
    finalFreight: number;
    icmsAmount: number;
    fedTaxesAmount: number;
    adValoremSelling: number;
    adValoremCost: number;
    /** Margem bruta em R$. */
    realProfitAmount: number;
    /** Margem bruta em %. */
    realMarginPercent: number;
    /** Motorista derivado no modo Tabelado (informativo no modo Calcular). */
    motoristaTabelado: number;
    /** Valor pago ao terceiro já unificado entre os dois modos. */
    bfEfetivo: number;
}

export const calcularPreco = (e: EntradaPreco): ResultadoPreco => {
    const gv = e.goodsValue;
    const ip = e.insurancePercent;
    const pm = e.profitMargin;
    const icmsP = e.icmsPercent;
    const t = e.tolls;
    const bf = e.baseFreight;
    const ec = e.extraCosts;
    const fedTaxes = e.fedTaxes;
    const otherCosts = e.otherCosts;
    const modoTabelado = e.modoTabelado;

    const adValoremSelling = gv * (ip / 100);
    const adValoremCost = gv * (fedTaxes.insurancePolicyRate / 100);
    const totalFedTaxPercent = (fedTaxes.pis + fedTaxes.cofins + fedTaxes.csll + fedTaxes.irpj);
    const icmsDivisor = (1 - (icmsP / 100));
    const marginDivisor = (1 - (pm / 100));

    const totalOtherCosts = otherCosts.reduce((acc, curr) => acc + curr.value, 0);
    const totalEc = ec + totalOtherCosts;

    // ---- MODO TABELADO: a MESMA equação, resolvida para a outra ponta ----
    // Ida (Calcular):  final = (motorista + t + ec + adV) / [(1-margem)(1-ICMS)]
    // Volta (Tabelado): motorista = final × (1-ICMS) × (1-margem) − t − ec − adV
    // Os divisores da ida viram multiplicadores. Não é conta paralela: é a
    // mesma equação isolando o outro termo, então o mesmo frete dá o mesmo
    // número nos dois modos (ida e volta fecham em R$ 0,00).
    // Os federais NÃO entram aqui porque não entram no gross-up da ida —
    // eles aparecem na margem REAL, calculada logo abaixo, igual no Calcular.
    const valorFinalDigitado = e.valorFinalTabelado;
    const priceWithMarginTab = valorFinalDigitado * icmsDivisor;
    const motoristaTabelado = (priceWithMarginTab * marginDivisor) - t - totalEc - adValoremSelling;

    // No tabelado o preço é dado e o motorista é derivado; no Calcular é o
    // contrário. Daqui para baixo a conta de impostos/lucro é a MESMA nos dois.
    const bfEfetivo = modoTabelado ? motoristaTabelado : bf;
    const directCostsSelling = bfEfetivo + t + totalEc + adValoremSelling;
    const priceWithMargin = modoTabelado
        ? priceWithMarginTab
        : (marginDivisor > 0 ? directCostsSelling / marginDivisor : directCostsSelling);
    const finalFreight = modoTabelado
        ? valorFinalDigitado
        : (icmsDivisor > 0 ? priceWithMargin / icmsDivisor : priceWithMargin);
    const icmsAmount = finalFreight * (icmsP / 100);
    const fedTaxesAmount = finalFreight * (totalFedTaxPercent / 100);
    const realDirectCosts = bfEfetivo + t + totalEc + adValoremCost;
    const realProfitAmount = finalFreight - icmsAmount - fedTaxesAmount - realDirectCosts;
    const realMarginPercent = finalFreight > 0 ? (realProfitAmount / finalFreight) * 100 : 0;
    // bfEfetivo sai no retorno para os Custos Ocultos: é o valor pago ao
    // terceiro já unificado (modo Calcular e Tabelado), que é a base da
    // antecipação. Só EXPÕE o que já era calculado acima — nenhuma conta muda.
    return { directCosts: directCostsSelling, realDirectCosts, priceAfterMargin: priceWithMargin, finalFreight, icmsAmount, fedTaxesAmount, adValoremSelling, adValoremCost, realProfitAmount, realMarginPercent, motoristaTabelado, bfEfetivo };
};
