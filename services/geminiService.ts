// Triggering fresh deploy to verify KM sync
import { supabase } from './supabase';

export const estimateDistance = async (origin: string, destination: string, vehicleType: string, axles?: number) => {
    console.log('Fetching distance for:', { origin, destination, vehicleType, axles });
    try {
        const { data, error } = await supabase.functions.invoke('calculate-route', {
            body: { origin, destination, vehicleType, axles: axles || 6 },
        });

        if (error) {
            console.error('Supabase Edge Function Invoke Error:', error);
            // If the error object has details/message, we use them
            return {
                km: 0,
                originNormalized: origin,
                destinationNormalized: destination,
                estimatedTolls: 0,
                error: error.message || 'Erro na comunicação com a Edge Function'
            };
        }

        if (data?.error) {
            console.warn('Edge Function returned internal error:', data.error);
            return {
                km: 0,
                originNormalized: origin,
                destinationNormalized: destination,
                estimatedTolls: 0,
                error: data.error,
                details: data.details
            };
        }

        console.log(`Route result:`, data);
        return data;
    } catch (error: any) {
        console.error('EstimateDistance catch block:', error);
        return { km: 0, originNormalized: origin, destinationNormalized: destination, estimatedTolls: 0, error: error.message };
    }
};

export const extractDataFromDoc = async (fileBase64: string, fileType: string) => {
    console.log('Extracting data from doc with Gemini...');
    try {
        const { data, error } = await supabase.functions.invoke('process-document', {
            body: { fileBase64, fileType },
        });

        if (error) {
            console.error('Supabase Edge Function Invoke Error (OCR):', error);
            return { error: error.message };
        }

        return data;
    } catch (error: any) {
        console.error('extractDataFromDoc catch block:', error);
        return { error: error.message };
    }
};

