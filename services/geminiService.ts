// Triggering fresh deploy to verify KM sync
import { supabase } from './supabase';

export interface PracaPedagio {
    nome: string; uf: string | null; rodovia: string | null; km: string | null;
    concessionaria: string | null; tarifa: number | null; tarifaTag: number | null;
}

export interface RotaSimples {
    km: number;
    originNormalized: string;
    destinationNormalized: string;
    estimatedTolls: number;       // tarifa CHEIA — é esta que entra no preço
    tollsWithTag: number;         // tarifa com tag — só snapshot, não entra no preço
    pracas: PracaPedagio[];
    pisoAntt: number | null;      // null = sem piso p/ a combinação; nunca zero
    resolucaoAntt: { nome: string; data: string | null; url: string | null } | null;
    confirmarPisoManualmente: boolean;
    idTransacao: string | null;
    latenciaMs: number;
    error?: undefined;
}

export interface FalhaRota {
    error: string;
    mensagem: string;
    bloqueante: true;
}

/**
 * Rota SIMPLES — fonte única: distância, pedágio e piso ANTT saem todos de uma
 * chamada à Edge Function qualp-rota (Qualp /rotas/v4). O Google saiu daqui.
 *
 * Falha é BLOQUEANTE e não tem fallback: sem resposta do Qualp não existe
 * número confiável, e cotação com número estimado é pior que cotação travada.
 * A rota MULTI-PARADA (estimateMultiRoute) segue no Google até a Fase 2.
 */
export const estimateDistance = async (
    origin: string,
    destination: string,
    vehicleType: string,
    axles?: number,
    cargoType?: string,
): Promise<RotaSimples | FalhaRota> => {
    console.log('--- CALCULATOR: estimateDistance (qualp-rota) ---', { origin, destination, vehicleType, axles, cargoType });
    try {
        const { data, error } = await supabase.functions.invoke('qualp-rota', {
            body: {
                origem: origin,
                destino: destination,
                eixos: axles || 6,
                tipoCarga: cargoType || 'Carga geral',
            },
        });

        // invoke só expõe "non-2xx status code"; a qualp-rota responde 200 com
        // ok:false justamente pra o motivo real chegar até aqui.
        if (error) {
            console.error('--- CALCULATOR ERROR: invoke(qualp-rota) ---', error);
            return {
                error: 'QUALP_INVOCACAO',
                mensagem: 'Não foi possível falar com a integração do Qualp. A cotação não pode ser fechada sem pedágio e piso confiáveis.',
                bloqueante: true,
            };
        }

        if (!data?.ok) {
            console.warn('--- CALCULATOR: qualp-rota bloqueou ---', data?.error);
            return {
                error: data?.error || 'QUALP_SEM_RESPOSTA',
                mensagem: data?.mensagem || 'O Qualp não respondeu. A cotação não pode ser fechada com número estimado.',
                bloqueante: true,
            };
        }

        return {
            km: data.distanciaKm,
            originNormalized: data.origemNormalizada || origin,
            destinationNormalized: data.destinoNormalizada || destination,
            estimatedTolls: data.pedagio?.cheio ?? 0,
            tollsWithTag: data.pedagio?.comTag ?? 0,
            pracas: Array.isArray(data.pedagio?.pracas) ? data.pedagio.pracas : [],
            pisoAntt: data.pisoAntt ?? null,
            resolucaoAntt: data.resolucaoAntt ?? null,
            confirmarPisoManualmente: !!data.confirmarPisoManualmente,
            idTransacao: data.idTransacao ?? null,
            latenciaMs: data.latenciaMs ?? 0,
        };
    } catch (error: any) {
        console.error('--- CALCULATOR CRITICAL ERROR: catch block ---', error);
        return {
            error: 'QUALP_REDE',
            mensagem: `Falha de rede ao consultar o Qualp: ${error.message}. A cotação não pode ser fechada.`,
            bloqueante: true,
        };
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

