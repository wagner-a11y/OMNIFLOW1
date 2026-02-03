
import { VehicleType, Customer, ANTTCoefficients } from './types';

export const VEHICLE_CONFIGS: Record<string, ANTTCoefficients & { factor?: number; axles?: number }> = {
    [VehicleType.Fiorino]: { fixed: 400, variable: 1.2, factor: 0.8, axles: 2 },
    [VehicleType.Van]: { fixed: 500, variable: 1.5, factor: 1.0, axles: 2 },
    [VehicleType.HR]: { fixed: 600, variable: 1.8, factor: 1.2, axles: 2 },
    [VehicleType.TresQuartos]: { fixed: 800, variable: 2.2, factor: 1.5, axles: 2 },
    [VehicleType.Toco]: { fixed: 1000, variable: 2.8, factor: 2.0, axles: 2 },
    [VehicleType.Truck]: { fixed: 1200, variable: 3.5, factor: 2.5, axles: 3 },
    [VehicleType.Bitruck]: { fixed: 1500, variable: 4.2, factor: 3.0, axles: 4 },
    [VehicleType.Carreta5Eixos]: { fixed: 2500, variable: 6.5, factor: 4.5, axles: 5 },
    [VehicleType.CarretaLS]: { fixed: 3000, variable: 7.5, factor: 5.5, axles: 6 },
    [VehicleType.Rodotrem]: { fixed: 5000, variable: 12.0, factor: 8.5, axles: 9 }
};

export const INITIAL_CUSTOMERS: Customer[] = [
    { id: '1', name: 'LOGISTICA TESTE' },
    { id: '2', name: 'TRANSPORTES WAGNER' }
];
