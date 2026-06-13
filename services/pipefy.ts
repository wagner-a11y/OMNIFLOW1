import { supabase } from './supabase';

// Cria o card de operação no Pipefy (server-side, lê o secret). Surface do erro real do corpo
// da Edge Function (invoke devolve só "non-2xx status code"). dryRun=true valida o mapeamento
// sem criar card. NÃO toca no Ramper.
export interface PipefyCardPayload {
    rota: string;
    receita: number;
    freteTerceiro: number;
    valorCarga: number;
    peso?: number;
    veiculo?: string;
    mercadoria?: string;
    implemento?: string;
    dataColeta?: string;
    dataEntrega?: string;
    localColeta?: string;
    localEntrega?: string;
    observacoes?: string;
    referencia?: string;
    outrasNecessidades?: string;
    titulo?: string;
    dryRun?: boolean;
}

export const createPipefyCard = async (
    payload: PipefyCardPayload
): Promise<{ ok?: boolean; cardId?: string; cardUrl?: string; title?: string; dryRun?: boolean; fields_attributes?: any[]; error?: string }> => {
    try {
        const { data, error } = await supabase.functions.invoke('pipefy-create-card', { body: payload });
        if (error) {
            let msg = error.message;
            try { const b = await (error as any).context?.json?.(); if (b?.error) msg = b.error; } catch { /* noop */ }
            return { error: msg };
        }
        if (data?.error) return { error: data.error };
        return data;
    } catch (e: any) {
        return { error: e?.message || 'Falha ao criar card no Pipefy.' };
    }
};
