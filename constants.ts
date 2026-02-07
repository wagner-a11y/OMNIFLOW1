
import { VehicleType, Customer, ANTTCoefficients } from './types';

export const VEHICLE_CONFIGS: Record<string, ANTTCoefficients & { factor: number; axles?: number; capacity?: number; consumption?: number }> = {
    [VehicleType.Fiorino]: { fixed: 0, variable: 0, factor: 3.50, axles: 2, capacity: 650, consumption: 12, calcMode: 'KM' },
    [VehicleType.Van]: { fixed: 0, variable: 0, factor: 4.80, axles: 2, capacity: 1500, consumption: 9, calcMode: 'KM' },
    [VehicleType.HR]: { fixed: 0, variable: 0, factor: 5.50, axles: 2, capacity: 1800, consumption: 8, calcMode: 'KM' },
    [VehicleType.TresQuartos]: { fixed: 1200, variable: 2.80, factor: 0, axles: 2, capacity: 4000, consumption: 6, calcMode: 'ANTT' },
    [VehicleType.Toco]: { fixed: 1500, variable: 3.50, factor: 0, axles: 2, capacity: 6000, consumption: 5, calcMode: 'ANTT' },
    [VehicleType.Truck]: { fixed: 1800, variable: 4.20, factor: 0, axles: 3, capacity: 12000, consumption: 3.8, calcMode: 'ANTT' },
    [VehicleType.Bitruck]: { fixed: 2200, variable: 4.80, factor: 0, axles: 4, capacity: 22000, consumption: 3.2, calcMode: 'ANTT' },
    [VehicleType.Carreta5Eixos]: { fixed: 2800, variable: 6.50, factor: 0, axles: 5, capacity: 33000, consumption: 2.5, calcMode: 'ANTT' },
    [VehicleType.CarretaLS]: { fixed: 3200, variable: 7.20, factor: 0, axles: 6, capacity: 35000, consumption: 2.2, calcMode: 'ANTT' },
    [VehicleType.Rodotrem]: { fixed: 4500, variable: 9.80, factor: 0, axles: 9, capacity: 50000, consumption: 1.8, calcMode: 'ANTT' }
};

export const INITIAL_CUSTOMERS: Customer[] = [
    { id: '1', name: 'LOGISTICA TESTE' },
    { id: '2', name: 'TRANSPORTES WAGNER' }
];
