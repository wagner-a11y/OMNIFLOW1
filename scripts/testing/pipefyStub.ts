/**
 * Stub do services/pipefy: registra o payload em vez de criar card de verdade.
 *
 * É o que permite provar o que CHEGA no card sem falar com o Pipefy. As
 * chamadas ficam em `globalThis.__PIPEFY_CALLS__`.
 */
export const createPipefyCard = async (payload: any) => {
    const g = globalThis as any;
    (g.__PIPEFY_CALLS__ ??= []).push(payload);
    return { ok: true, cardId: 'card-stub-1', cardUrl: 'https://app.pipefy.com/open-cards/card-stub-1' };
};
export const searchPipefyRecords = async () => [];
export const getPipefyBoard = async () => null;
