// Laboratório Qualp — cliente da Edge Function qualp-teste. ISOLADO e só leitura.
// Não é usado pela calculadora; serve só à telinha de teste (oculta, master).
import { supabase } from './supabase';

export interface QualpPraca { nome: string; uf: string | null; valor: number | null; }
export interface QualpResultado {
    ok: boolean;
    error?: string;
    status?: number;
    elapsedMs?: number;
    distanciaKm?: number | null;
    pedagioTotal?: number | null;
    pracas?: QualpPraca[];
    pisoAntt?: unknown;
    resolucaoAntt?: unknown;
    consumo?: unknown;
    raw?: unknown;
    corpo?: unknown;
    hint?: string;
}

export async function consultarQualp(params: { origem: string; destino: string; eixos: number; fuel?: boolean; categoria?: string }): Promise<QualpResultado> {
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
