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
            // Show feedback or alert for debugging on user side
            return { km: 0, originNormalized: origin, destinationNormalized: destination, estimatedTolls: 0, error: error.message };
        }

        console.log(`Route result:`, data);
        return data;
    } catch (error: any) {
        console.error('EstimateDistance catch block:', error);
        return { km: 0, originNormalized: origin, destinationNormalized: destination, estimatedTolls: 0, error: error.message };
    }
};
