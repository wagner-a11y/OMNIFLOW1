
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

/**
 * Returns the full matrix of standard ICMS rules (27x27 = 729 rules)
 */
export const getStandardIcmsRules = (): Record<string, number> => {
    const ufs = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
    const southSoutheastExceptES = ['RS', 'SC', 'PR', 'SP', 'RJ', 'MG'];
    const northNortheastCenterWestES = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'PA', 'PB', 'PE', 'PI', 'RN', 'RO', 'RR', 'SE', 'TO'];

    const rules: Record<string, number> = {};

    ufs.forEach(origin => {
        ufs.forEach(dest => {
            const key = `${origin}-${dest}`;
            if (origin === dest) {
                rules[key] = INTERNAL_ICMS_RATES[origin] || 12;
            } else if (southSoutheastExceptES.includes(origin) && northNortheastCenterWestES.includes(dest)) {
                rules[key] = 7;
            } else {
                rules[key] = 12;
            }
        });
    });

    return rules;
};

export const getIcmsRate = (originUF: string, destinationUF: string, customRates: Record<string, number> = {}): number => {
    if (!originUF || !destinationUF) return 12;

    // 1. Check for custom override (User's manual adjustment)
    const key = `${originUF}-${destinationUF}`;
    if (customRates[key] !== undefined) {
        return customRates[key];
    }

    // 2. Intra-state (Same state)
    if (originUF === destinationUF) {
        return INTERNAL_ICMS_RATES[originUF] || 12;
    }

    // 3. Interstate (Different states)
    const southSoutheastExceptES = ['RS', 'SC', 'PR', 'SP', 'RJ', 'MG'];
    const northNortheastCenterWestES = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'PA', 'PB', 'PE', 'PI', 'RN', 'RO', 'RR', 'SE', 'TO'];

    if (southSoutheastExceptES.includes(originUF) && northNortheastCenterWestES.includes(destinationUF)) {
        return 7;
    }

    return 12; // Standard for Other -> Any, or S/SE -> S/SE
};
