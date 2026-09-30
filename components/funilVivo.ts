/**
 * Regras de recorte do FUNIL DE FATURAMENTO.
 *
 * Separado do CRMBoard para poder ser testado sem React: o que está aqui decide
 * quais cards aparecem e quanto vale o Realizado do mês — e a segunda conta não
 * pode mudar de valor por causa da primeira.
 */

/** Só os campos que o recorte olha. Evita arrastar o tipo inteiro para o teste. */
export interface CotacaoDoFunil {
    status: string;
    createdAt: number;
    totalFreight?: number;
}

/**
 * Colunas de negócio EM ABERTO: ignoram o mês de referência.
 *
 * Negócio em aberto não tem mês — quem está em Negociação no dia 30 continua em
 * Negociação no dia 1º. Antes, o board filtrava tudo por mês de criação e esses
 * cards sumiam na virada (seguiam no banco, só saíam da tela), e o comercial
 * começava o mês com um funil falsamente vazio.
 *
 * Faturado e Perdida ficam de FORA de propósito: são desfecho, têm mês, e é
 * delas que sai o número do mês.
 */
export const COLUNAS_ABERTAS = ['pending', 'respondida', 'aprovada', 'carregando'];

/**
 * Status que somam no Realizado do mês.
 *
 * `em_operacao` segue na soma por causa de cotação antiga que possa tê-lo
 * gravado — tirá-lo faria o realizado do mês passado encolher sozinho.
 */
export const STATUS_DO_REALIZADO = ['aprovada', 'carregando', 'won', 'em_operacao'];

/** A cotação foi criada dentro do mês de referência? (ano e mês 1..12) */
export const doMes = (q: CotacaoDoFunil, ano: number, mes: number): boolean => {
    const d = new Date(q.createdAt);
    return d.getFullYear() === ano && d.getMonth() === mes - 1;
};

/**
 * O card aparece na coluna `coluna`, no mês de referência?
 *
 * Coluna aberta mostra o pipeline inteiro; coluna de desfecho, só o mês.
 */
export const apareceNaColuna = (q: CotacaoDoFunil, coluna: string, ano: number, mes: number): boolean =>
    COLUNAS_ABERTAS.includes(coluna) || doMes(q, ano, mes);

/**
 * Realizado do mês. Lê a base MENSAL direto, nunca as colunas: as colunas
 * abertas carregam todos os meses e inflariam o número.
 */
export const somarRealizado = (quotes: CotacaoDoFunil[], ano: number, mes: number): number =>
    quotes
        .filter(q => doMes(q, ano, mes) && STATUS_DO_REALIZADO.includes(q.status))
        .reduce((acc, q) => acc + (q.totalFreight || 0), 0);
