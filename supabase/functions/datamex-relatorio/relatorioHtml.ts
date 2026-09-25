// Parsing do relatório HTML do TMS. PURO (sem I/O), como o classificador.ts:
// é a leitura linha a linha do relatório, e é o que o teste unitário cobre.
//
// O relatório traz UMA LINHA POR CTe, com a Emissão (DD/MM/AAAA) na primeira
// célula e vários valores monetários; o "Total" do CTe é o último valor de 2
// casas da linha. Era daqui que saía só o "faturado hoje"; agora sai o mês
// inteiro dia a dia, na mesma passada e sem request novo ao TMS.

// "1.502.836,27" -> 1502836.27  (formato BR: ponto = milhar, vírgula = decimal)
export const brToNumber = (s: string): number => Number(s.replace(/\./g, '').replace(',', '.'));

export const MONEY_CELL = /^\d{1,3}(?:\.\d{3})*,\d{2}$/;   // valor 2 casas (descarta peso 4 casas)
export const DATE_CELL = /^\d{2}\/\d{2}\/\d{4}$/;           // DD/MM/YYYY
export const INT_CELL = /^\d{1,7}$/;                        // inteiro puro (candidato a CTRC/nº do conhecimento)

// CTRC (nº do conhecimento) da linha: primeira célula inteira pura depois da data.
// Anulações têm série própria de numeração baixa (ex.: 20-25) — CTRC < 1000 não é
// faturamento. Retorna null se não achar (aí, por segurança, NÃO descartamos a linha).
export const ctrcDaLinha = (cells: string[]): number | null => {
    for (let i = 1; i < Math.min(cells.length, 5); i++) {
        if (INT_CELL.test(cells[i])) return Number(cells[i]);
    }
    return null;
};

/**
 * "18/09/2026" -> "2026-09-18".
 *
 * REARRANJO DE TEXTO, de propósito: sem Date, sem fuso. A célula do relatório já
 * está no fuso da operação (BRT); transformá-la em instante e formatar de volta
 * é que criaria o deslocamento — esta função roda em UTC.
 */
export const brToYMD = (ddmmyyyy: string): string => {
    const [d, m, y] = ddmmyyyy.split('/');
    return `${y}-${m}-${d}`;
};

/** As células de uma <tr>, já sem tags e com espaço normalizado. */
const celulas = (trInner: string): string[] =>
    [...trInner.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
        .map(c => c[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim());

export interface DiaFaturado { valor: number; ctes: number }

/**
 * Soma o "Total" de cada CTe agrupando pela data de Emissão.
 *
 * Devolve 'YYYY-MM-DD' -> { valor, ctes } de TODOS os dias que o relatório
 * trouxer (ele é do mês corrente). Uma passada só; o "faturado hoje" passa a ser
 * uma consulta a este mapa em vez de uma segunda varredura do mesmo HTML.
 *
 * Os filtros são os que já existiam: linha com 20+ células e data na primeira
 * (é linha de CTe, não cabeçalho nem rodapé), e CTRC < 1000 fora, que é a série
 * de anulação e não é faturamento.
 */
export function somaPorDia(html: string): Record<string, DiaFaturado> {
    const porDia: Record<string, DiaFaturado> = {};
    for (const tr of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
        const cells = celulas(tr[1]);
        if (cells.length < 20 || !DATE_CELL.test(cells[0])) continue;
        const ctrc = ctrcDaLinha(cells);
        if (ctrc !== null && ctrc < 1000) continue;
        const monies = cells.filter(x => MONEY_CELL.test(x));
        if (!monies.length) continue;
        const ymd = brToYMD(cells[0]);
        const acc = porDia[ymd] ?? { valor: 0, ctes: 0 };
        acc.valor += brToNumber(monies[monies.length - 1]);
        acc.ctes++;
        porDia[ymd] = acc;
    }
    // Arredonda no fim: somar centavos em float e arredondar uma vez só evita o
    // 0,01 de diferença que apareceria comparando com o total do rodapé.
    for (const d of Object.keys(porDia)) {
        porDia[d].valor = Math.round((porDia[d].valor + Number.EPSILON) * 100) / 100;
    }
    return porDia;
}
