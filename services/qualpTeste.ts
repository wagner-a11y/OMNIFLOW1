// Laboratório Qualp — cliente da Edge Function qualp-teste. ISOLADO e só leitura.
// Não é usado pela calculadora; serve só à telinha de teste (oculta, master).
import { supabase } from './supabase';

export interface QualpPraca { nome: string; uf: string | null; valor: number | null; rodovia?: string | null; km?: string | null; concessionaria?: string | null; tarifaTag?: number | null; }
export interface QualpResultado {
    ok: boolean;
    error?: string;
    status?: number;
    elapsedMs?: number;
    distanciaKm?: number | null;
    pedagioTotal?: number | null;
    pedagioTag?: number | null;
    pracas?: QualpPraca[];
    pisoAntt?: unknown;
    resolucaoAntt?: unknown;
    consumo?: unknown;
    raw?: unknown;
    corpo?: unknown;
    hint?: string;
}

export async function consultarQualp(params: { origem: string; destino: string; eixos: number; fuel?: boolean; categoria?: string; freightLoad?: string; antt?: boolean }): Promise<QualpResultado> {
    try {
        const { data, error } = await supabase.functions.invoke('qualp-teste', { body: params });
        if (error) {
            // supabase.functions.invoke só devolve "non-2xx status code"; o corpo real vem em data.
            return { ok: false, error: (data as any)?.error || error.message };
        }
        return data as QualpResultado;
    } catch (e) {
        return { ok: false, error: (e as Error).message };
    }
}

// Coluna "calculadora atual": o que o app dá HOJE pra mesma rota (calculate-route/Google, escalado
// por eixo). Só leitura, não altera nada. Usado no laboratório pra comparar lado a lado com o Qualp.
export interface CalcAtual { km: number | null; pedagio: number | null; error?: string; }
export async function calcularAtual(origem: string, destino: string, eixos: number): Promise<CalcAtual> {
    try {
        const { data, error } = await supabase.functions.invoke('calculate-route', {
            body: { origin: origem, destination: destino, vehicleType: 'Truck', axles: eixos || 6 },
        });
        if (error) return { km: null, pedagio: null, error: error.message };
        if ((data as any)?.error) return { km: null, pedagio: null, error: (data as any).error };
        return { km: (data as any)?.km ?? null, pedagio: (data as any)?.estimatedTolls ?? null };
    } catch (e) {
        return { km: null, pedagio: null, error: (e as Error).message };
    }
}
