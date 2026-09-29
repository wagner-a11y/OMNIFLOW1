// Numeração das cotações. PURO, para o teste alcançar — as duas séries
// convivem no mesmo campo e a regra de quem conta o quê é fácil de quebrar.
//
// DUAS SÉRIES, DOIS CONTADORES, um por ano:
//   CT-AAAA-####   calculadora (digitação) e Suzano
//   EM-AAAA-####   entrada por e-mail (gmail-intake)
//
// Elas NÃO se misturam de propósito. A série do e-mail tende a crescer muito
// mais rápido, e um contador só faria a numeração manual saltar centenas de
// números sem ninguém entender por quê.

export const PREFIXO_MANUAL = 'CT';
export const PREFIXO_EMAIL = 'EM';

/**
 * Maior sequencial de uma série, dentre os números existentes.
 *
 * Ancorado no prefixo E no ano: o contador reinicia a cada ano, então
 * "CT-2025-0900" não empurra o primeiro número de 2026.
 */
export function maiorSequencial(numeros: Array<string | null | undefined>, prefixo: string, ano: number): number {
    const re = new RegExp(`^${prefixo}-${ano}-(\\d+)$`);
    return (numeros || []).reduce<number>((mx, n) => {
        const m = re.exec((n || '').trim());
        const v = m ? parseInt(m[1], 10) : 0;
        return v > mx ? v : mx;
    }, 0);
}

/** Próximo número de uma série. */
export function proximoNumero(numeros: Array<string | null | undefined>, prefixo: string, ano: number): string {
    return `${prefixo}-${ano}-${(maiorSequencial(numeros, prefixo, ano) + 1).toString().padStart(4, '0')}`;
}

/** A cotação nasceu de e-mail? Lê pelo número, sem depender de outra coluna. */
export const ehNumeroDeEmail = (n?: string | null): boolean => /^EM-\d{4}-\d+$/.test((n || '').trim());
