
import { supabase } from './supabase';

export const estimateDistance = async (origin: string, destination: string, vehicleType: string, axles?: number) => {
    try {
        const { data, error } = await supabase.functions.invoke('calculate-route', {
            body: { origin, destination, vehicleType, axles: axles || 6 },
        });

        if (error) {
            console.error('Edge Function error:', error);
            return { km: 0, originNormalized: origin, destinationNormalized: destination, estimatedTolls: 0 };
        }

        console.log(`Route calculated via: ${data.source}`);
        return data;
    } catch (error) {
        console.error('Route estimation error:', error);
        return { km: 0, originNormalized: origin, destinationNormalized: destination, estimatedTolls: 0 };
    }
};
