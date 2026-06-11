import { supabase } from './supabase';

// Cria um card (oportunidade) no Ramper Pipeline via Edge Function. O token nunca trafega no frontend.
export const createRamperCard = async (payload: {
    title: string;
    value?: number;
    basePrice?: number;
    organizationName?: string;
    personName?: string;
    stageId?: string | number;
    stageName?: string;
}) => {
    try {
        const { data, error } = await supabase.functions.invoke('create-ramper-card', { body: payload });
        if (error) {
            // supabase.functions.invoke devolve só "non-2xx status code"; lê o erro real do corpo.
            let msg = error.message;
            try { const b = await (error as any).context?.json?.(); if (b?.error) msg = b.error; } catch { /* noop */ }
            return { error: msg };
        }
        if (data?.error) return { error: data.error };
        return data;
    } catch (error: any) {
        return { error: error?.message || 'Erro ao chamar a integração Ramper.' };
    }
};
