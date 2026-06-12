// Triggering fresh deploy to verify KM sync
import { supabase } from './supabase';

export const estimateDistance = async (origin: string, destination: string, vehicleType: string, axles?: number) => {
    console.log('--- CALCULATOR: estimateDistance started ---', { origin, destination, vehicleType, axles });
    try {
        const { data, error } = await supabase.functions.invoke('calculate-route', {
            body: { origin, destination, vehicleType, axles: axles || 6 },
        });

        if (error) {
            console.error('--- CALCULATOR ERROR: Supabase Function Invoke (calculate-route) ---', error);
            return {
                km: 0,
                originNormalized: origin,
                destinationNormalized: destination,
                estimatedTolls: 0,
                error: error.message || 'Erro na comunicação com a Edge Function'
            };
        }

        console.log('--- CALCULATOR RESULT ---', data);

        if (data?.error) {
            console.warn('--- CALCULATOR WARNING: Function returned internal error ---', data.error);
            return {
                km: 0,
                originNormalized: origin,
                destinationNormalized: destination,
                estimatedTolls: 0,
                error: data.error,
                details: data.details
            };
        }

        return data;
    } catch (error: any) {
        console.error('--- CALCULATOR CRITICAL ERROR: catch block ---', error);
        return { km: 0, originNormalized: origin, destinationNormalized: destination, estimatedTolls: 0, error: error.message };
    }
};

// Rota multi-parada: coleta + lista de destinos. Retorna distância total, pedágio,
// ordem otimizada dos intermediários e polyline. (Edge function calculate-route, modo multi.)
export const estimateMultiRoute = async (origin: string, destinations: string[], vehicleType: string, axles?: number, optimize = false) => {
    try {
        const { data, error } = await supabase.functions.invoke('calculate-route', {
            body: { origin, destinations, vehicleType, axles: axles || 6, optimize },
        });
        if (error) return { error: error.message };
        if (data?.error) return { error: data.error };
        return data;
    } catch (error: any) {
        return { error: error.message };
    }
};

export const extractDataFromDoc = async (fileBase64: string, fileType: string) => {
    console.log('--- OCR: extractDataFromDoc started ---', { fileType });
    try {
        const { data, error } = await supabase.functions.invoke('process-document', {
            body: { fileBase64, fileType },
        });

        if (error) {
            console.error('--- OCR ERROR: Supabase Function Invoke (process-document) ---', error);
            return { error: error.message };
        }

        console.log('--- OCR SUCCESS ---', data);

        if (data?.error) {
            console.error('--- OCR FAILED (Gemini internal) ---', data.error);
            return { error: data.error };
        }

        return data;
    } catch (error: any) {
        console.error('--- OCR CRITICAL ERROR: catch block ---', error);
        return { error: error.message };
    }
};

// Compila o texto do relatório (IA só escreve, a partir dos números prontos). A função
// sempre devolve texto (fallback no servidor); aqui só repassamos. Erro de rede -> { error }.
export const compileReportText = async (summary: any): Promise<{ text?: string; source?: string; error?: string }> => {
    try {
        const { data, error } = await supabase.functions.invoke('compile-report-text', { body: { summary } });
        if (error) return { error: error.message };
        return data;
    } catch (e: any) {
        return { error: e?.message || 'Falha ao compilar texto.' };
    }
};

// Leitura inteligente de solicitação de frete (texto colado ou arquivo) via Gemini.
// Retorna { origem, destino, tipoCarga, peso, valorMercadoria, disponibilidade, solicitante, observacoes } ou { error }.
export const parseRequest = async (params: { content?: string; fileBase64?: string; fileType?: string }) => {
    console.log('--- IMPORT: parseRequest started ---', { hasFile: !!params.fileBase64, hasText: !!params.content });
    // Mensagem amigável para erros conhecidos do upstream (ex.: cota do Gemini).
    const friendly = (raw: string): string => {
        const m = raw || '';
        if (/RESOURCE_EXHAUSTED|429|quota/i.test(m)) return 'Cota excedida por hoje, daqui pra frente é só no manual. Amanhã tem mais!';
        if (/API_KEY_INVALID|API key/i.test(m)) return 'Chave do Gemini inválida/expirada. Avise o administrador.';
        return m;
    };
    try {
        const { data, error } = await supabase.functions.invoke('parse-request', { body: params });
        if (error) {
            // supabase.functions.invoke só devolve "non-2xx status code"; lê o erro real do corpo.
            let msg = error.message;
            try { const b = await (error as any).context?.json?.(); if (b?.error) msg = b.error; } catch { /* noop */ }
            console.error('--- IMPORT ERROR (parse-request) ---', msg);
            return { error: friendly(msg) };
        }
        if (data?.error) {
            console.error('--- IMPORT FAILED (Gemini internal) ---', data.error);
            return { error: friendly(data.error) };
        }
        return data;
    } catch (error: any) {
        console.error('--- IMPORT CRITICAL ERROR: catch block ---', error);
        return { error: friendly(error.message) };
    }
};

