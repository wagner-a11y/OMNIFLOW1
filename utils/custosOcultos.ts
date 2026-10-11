/**
 * Custos Ocultos e Margem Real.
 *
 * REGRA DE OURO: antecipação e comissão são CUSTO. Saem da margem e NÃO entram
 * no preço do cliente. Este módulo é deliberadamente separado da engine de
 * preço (o `calcData` do App) e só sabe LER o resultado dela — não existe
 * caminho de volta, então nenhum número daqui pode escorrer pro valor cotado.
 *
 *   Antecipação = receita total a receber do cliente × taxa% do prazo
 *   Comissão    = receita total a receber do cliente × comissão%
 *   Líquida     = margem bruta − antecipação − comissão
 *
 * Campo vazio = custo zero. Sem prazo e sem comissão, a margem líquida é
 * numericamente a própria margem bruta.
 */

export interface CustosOcultosEntrada {
    /** Valor total a receber do cliente (calcData.finalFreight). */
    receita: number;
    /** Margem bruta em R$ (calcData.realProfitAmount). */
    margemBrutaRS: number;
    /** Prazo de pagamento em dias, como vem do select. '' = não informado; '0' = à vista. */
    prazoDias: string;
    /** Comissão desta cotação, como vem do input. '' = cai no padrão das Configurações. */
    comissaoPercent: string;
    /** Tabela configurável: chave = prazo em dias, valor = taxa %. */
    taxasAntecipacao?: Record<string, number>;
    /** Comissão padrão das Configurações (%). */
    comissaoPadrao?: number;
}

export interface CustosOcultosResultado {
    /** Prazo escolhido, ou null quando não informado. */
    prazoDias: number | null;
    taxaAntecipacao: number;
    custoAntecipacao: number;
    comissaoPercent: number;
    custoComissao: number;
    lucroLiquido: number;
    margemLiquidaPercent: number;
    /** true quando pelo menos um dos dois custos é maior que zero. */
    temCusto: boolean;
}

export const calcularCustosOcultos = (e: CustosOcultosEntrada): CustosOcultosResultado => {
    const receita = Number(e.receita) || 0;
    const margemBrutaRS = Number(e.margemBrutaRS) || 0;

    // Prazo: '' = não informado. A taxa vem da tabela configurável; prazo fora
    // da tabela (ou tabela vazia) vale 0 — nunca chuta taxa.
    const prazoDias = e.prazoDias !== '' && e.prazoDias != null
        ? (parseInt(e.prazoDias, 10) || 0)
        : null;
    const taxaAntecipacao = prazoDias !== null
        ? (e.taxasAntecipacao?.[String(prazoDias)] ?? 0)
        : 0;
    const custoAntecipacao = receita * (taxaAntecipacao / 100);

    // Comissão: campo vazio cai no padrão das Configurações (que nasce em 0).
    const comissaoPercent = e.comissaoPercent !== '' && e.comissaoPercent != null
        ? (parseFloat(String(e.comissaoPercent).replace(',', '.')) || 0)
        : (e.comissaoPadrao ?? 0);
    const custoComissao = receita * (comissaoPercent / 100);

    const lucroLiquido = margemBrutaRS - custoAntecipacao - custoComissao;
    const margemLiquidaPercent = receita > 0 ? (lucroLiquido / receita) * 100 : 0;

    return {
        prazoDias, taxaAntecipacao, custoAntecipacao,
        comissaoPercent, custoComissao,
        lucroLiquido, margemLiquidaPercent,
        temCusto: custoAntecipacao > 0 || custoComissao > 0,
    };
};
