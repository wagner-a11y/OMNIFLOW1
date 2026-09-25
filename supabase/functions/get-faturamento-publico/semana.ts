// A SEMANA CORRENTE EM AMERICA/SAO_PAULO. Puro (sem I/O), como o classificador:
// é aqui que o fuso pode dar errado, então é aqui que o teste unitário alcança.
//
// Nada nesta função usa new Date().getDay() nem converte instante para data: a
// Edge Function roda em UTC. Entre 21h e 23h59 de sábado (BRT) o UTC já é
// domingo — o cálculo ingênuo trocaria a semana três horas antes da hora, e o
// gráfico mudaria de janela na frente de todo mundo no meio do sábado.
//
// O caminho é: (1) pegar o RÓTULO do dia em BRT via Intl; (2) fazer aritmética
// de calendário sobre o rótulo com Date.UTC, que é contagem de dias e não
// conversão de fuso. Entra rótulo, sai rótulo.

export const TZ = 'America/Sao_Paulo';

/** Hoje em BRT como 'YYYY-MM-DD'. */
export const hojeYMD = (agora: Date = new Date()): string =>
    new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
        .format(agora);

/** Dia da semana em BRT: 0 = domingo ... 6 = sábado. */
export const dowBRT = (agora: Date = new Date()): number => {
    const nome = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(agora);
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(nome);
};

/**
 * Soma n dias a um rótulo 'YYYY-MM-DD' e devolve outro rótulo.
 * Date.UTC aqui vira mês e ano sozinho (é calendário), sem tocar em fuso.
 */
export const addDias = (ymd: string, n: number): string => {
    const [y, m, d] = ymd.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d));
    t.setUTCDate(t.getUTCDate() + n);
    return t.toISOString().slice(0, 10);
};

/** Os 7 rótulos da semana corrente, domingo -> sábado, em BRT. */
export const semanaCorrente = (agora: Date = new Date()): string[] => {
    const domingo = addDias(hojeYMD(agora), -dowBRT(agora));
    return Array.from({ length: 7 }, (_, i) => addDias(domingo, i));
};
