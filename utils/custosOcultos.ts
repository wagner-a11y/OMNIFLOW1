/**
 * Custos Ocultos e Margem Real.
 *
 * REGRA DE OURO: antecipação e comissão são CUSTO. Saem da margem e NÃO entram
 * no preço do cliente. Este módulo é deliberadamente separado da engine de
 * preço (o `calcData` do App) e só sabe LER o resultado dela — não existe
 * caminho de volta, então nenhum número daqui pode escorrer pro valor cotado.
 *
 *   Antecipação = valor pago ao terceiro × taxa% do prazo
 *   Comissão    = receita total a receber do cliente × comissão%
 *   Líquida     = margem bruta − antecipação − comissão
 *
 * As DUAS bases são diferentes de propósito: a antecipação é o custo de
 * adiantar o dinheiro que sai pro terceiro, então incide sobre o que se PAGA;
 * a comissão é sobre a VENDA. A % da margem líquida segue sendo medida sobre a
 * receita, como a margem bruta.
 *
 * Campo vazio = custo zero. Sem prazo e sem comissão, a margem líquida é
 * numericamente a própria margem bruta.
 */

export interface CustosOcultosEntrada {
    /** Valor total a receber do cliente (calcData.finalFreight). Base da COMISSÃO. */
    receita: number;
    /**
     * Valor pago ao terceiro, já unificado entre o modo Calcular e o Tabelado
     * (calcData.bfEfetivo). Base da ANTECIPAÇÃO.
     */
    custoTerceiro: number;
    /** Margem bruta em R$ (calcData.realProfitAmount). */
    margemBrutaRS: number;
    /** Prazo de pagamento em dias, como vem do select. '' = não informado; '0' = à vista. */
    prazoDias: string;
    /** Comissão desta cotação, como vem do input. '' = cai no padrão das Configurações. */
    comissaoPercent: string;
    /** Tabela configurável: chave = prazo em dias, valor = taxa %. */
    taxasAntecipacao?: Record<string, number>;
    /**
     * Taxa de antecipação (%) já resolvida por quem chama, ignorando a tabela.
     * Usada pelo Bid em Lote, que deriva a taxa de juros ao mês × prazo/30 em
     * vez de consultar linhas fixas de prazo. `undefined` = usa a tabela (é o
     * caminho da cotação individual, que não muda).
     */
    taxaAntecipacaoDireta?: number;
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
    const custoTerceiro = Number(e.custoTerceiro) || 0;
    const margemBrutaRS = Number(e.margemBrutaRS) || 0;

    // Prazo: '' = não informado. A taxa vem da tabela configurável; prazo fora
    // da tabela (ou tabela vazia) vale 0 — nunca chuta taxa.
    const prazoDias = e.prazoDias !== '' && e.prazoDias != null
        ? (parseInt(e.prazoDias, 10) || 0)
        : null;
    // Taxa direta vence a tabela quando informada. Não é "mais um jeito de
    // calcular": é a MESMA taxa, resolvida fora por quem tem a regra (o bid usa
    // juros ao mês × prazo/30; a cotação usa a linha da tabela de prazo).
    const taxaAntecipacao = e.taxaAntecipacaoDireta != null
        ? e.taxaAntecipacaoDireta
        : (prazoDias !== null ? (e.taxasAntecipacao?.[String(prazoDias)] ?? 0) : 0);
    // Incide sobre o CUSTO (o que sai pro terceiro), não sobre a venda.
    const custoAntecipacao = custoTerceiro * (taxaAntecipacao / 100);

    // Comissão: campo vazio cai no padrão das Configurações (que nasce em 0).
    const comissaoPercent = e.comissaoPercent !== '' && e.comissaoPercent != null
        ? (parseFloat(String(e.comissaoPercent).replace(',', '.')) || 0)
        : (e.comissaoPadrao ?? 0);
    // Incide sobre a VENDA (receita total da cotação).
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
