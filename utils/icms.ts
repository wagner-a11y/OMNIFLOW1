
export const INTERNAL_ICMS_RATES: Record<string, number> = {
    'AC': 19, 'AL': 19, 'AM': 20, 'AP': 18, 'BA': 20.5, 'CE': 20, 'DF': 18, 'ES': 12, 'GO': 19,
    'MA': 23, 'MT': 17, 'MS': 17, 'MG': 18, 'PA': 19, 'PB': 20, 'PE': 20.5, 'PI': 22.5, 'PR': 12,
    'RJ': 20, 'RN': 20, 'RS': 12, 'RO': 19.5, 'RR': 20, 'SC': 12, 'SP': 18, 'SE': 18, 'TO': 20
};

export const getUF = (cityStr: string): string | null => {
    if (!cityStr) return null;
    const ufs = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
    const normalized = cityStr.toUpperCase();
    const matches = normalized.match(/\b([A-Z]{2})\b/g);
    if (matches) {
        const found = matches.filter(m => ufs.includes(m));
        return found.length > 0 ? found[found.length - 1] : null;
    }
    return null;
};

// Grupos de estado da regra de ICMS por rota.
export const SUL = ['PR', 'SC', 'RS'];
export const SUDESTE = ['SP', 'RJ', 'MG', 'ES'];
export const SUL_SUDESTE = [...SUL, ...SUDESTE];
// Isenção intra-estadual: mesmo estado isento (origem === destino).
export const SAME_STATE_EXEMPT = ['PE', 'PR', 'MG'];
// Alíquotas específicas de mesmo estado (origem === destino). Os isentos acima têm prioridade;
// estados não listados aqui usam 12%.
export const SAME_STATE_RATES: Record<string, number> = { SC: 17, RJ: 22 };

/**
 * Regra de ICMS por rota, aplicada NESTA ORDEM DE PRIORIDADE (a primeira que casar define a alíquota):
 *   1. Mesmo estado (origem === destino): PE/PR/MG isento (0%); SC 17%; RJ 22%; demais 12%.
 *   2. Isenção MG: origem MG E pagador de MG → 0% (qualquer destino).
 *   (config) Override manual por rota do master (aba ICMS) vence a regra regional, nunca as regras acima.
 *   3. Destino ES numa rota Sul/Sudeste: 7%.
 *   4. Sul/Sudeste → Sul/Sudeste: 12%.
 *   5. Sul/Sudeste → restante do país: 7%.
 *   6. Origem fora de Sul/Sudeste → qualquer destino: 12%.
 *
 * @param payerIsMG true quando a origem é MG e o pagador também é de MG (alimenta a regra 2).
 */
export const getIcmsRate = (
    originUF: string,
    destinationUF: string,
    customRates: Record<string, number> = {},
    payerIsMG: boolean = false
): number => {
    if (!originUF || !destinationUF) return 12;

    // 1. Mesmo estado (origem === destino): isenção p/ PE/PR/MG, SC 17%, RJ 22%, demais 12%.
    //    Resolve todos os casos intra-estaduais aqui (inclusive ES→ES = 12%), antes das regras regionais.
    if (originUF === destinationUF) {
        if (SAME_STATE_EXEMPT.includes(originUF)) return 0;
        return SAME_STATE_RATES[originUF] ?? 12;
    }

    // 2. Isenção de MG: origem MG + pagador de MG, qualquer destino.
    if (originUF === 'MG' && payerIsMG) return 0;

    // Override manual por rota (aba ICMS): vence a regra regional, mas nunca as regras acima.
    const key = `${originUF}-${destinationUF}`;
    if (customRates[key] !== undefined) return customRates[key];

    // 3. Destino ES numa rota entre Sul e Sudeste.
    if (destinationUF === 'ES' && SUL_SUDESTE.includes(originUF)) return 7;

    // 4. Sul/Sudeste → Sul/Sudeste.
    if (SUL_SUDESTE.includes(originUF) && SUL_SUDESTE.includes(destinationUF)) return 12;

    // 5. Sul/Sudeste → restante do país.
    if (SUL_SUDESTE.includes(originUF)) return 7;

    // 6. Origem fora de Sul/Sudeste → qualquer destino.
    return 12;
};

/**
 * Matriz completa das regras padrão (27x27 = 729 pares) usada na aba ICMS ("Restaurar Padrão").
 * Gera a partir de getIcmsRate (payerIsMG=false, sem overrides) para manter matriz e cálculo
 * automático sempre coerentes. A isenção de MG por pagador (regra 2) é dinâmica e não cabe na matriz.
 */
export const getStandardIcmsRules = (): Record<string, number> => {
    const ufs = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
    const rules: Record<string, number> = {};
    ufs.forEach(origin => {
        ufs.forEach(dest => {
            rules[`${origin}-${dest}`] = getIcmsRate(origin, dest, {}, false);
        });
    });
    return rules;
};
