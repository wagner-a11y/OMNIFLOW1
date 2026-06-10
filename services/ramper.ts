import { supabase } from './supabase';

// Cria um card (oportunidade) no Ramper Pipeline via Edge Function. O token nunca trafega no frontend.
export const createRamperCard = async (payload: {
    title: string;
    value?: number;
    organizationName?: string;
    personName?: string;
    stageId?: string | number;
    stageName?: string;
}) => {
    try {
        const { data, error } = await supabase.functions.invoke('create-ramper-card', { body: payload });
        if (error) return { error: error.message };
        if (data?.error) return { error: data.error };
        return data;
    } catch (error: any) {
        return { error: error?.message || 'Erro ao chamar a integração Ramper.' };
    }
};
