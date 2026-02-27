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

