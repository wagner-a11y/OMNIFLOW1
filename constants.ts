
import { VehicleType, Customer, ANTTCoefficients } from './types';

export const VEHICLE_CONFIGS: Record<string, ANTTCoefficients & { factor: number; axles?: number; capacity?: number; consumption?: number }> = {
    [VehicleType.Fiorino]: { fixed: 0, variable: 0, factor: 2.50, axles: 2, capacity: 650, consumption: 12, calcMode: 'KM_ROUND_TRIP' },
    [VehicleType.Van]: { fixed: 0, variable: 0, factor: 3.50, axles: 2, capacity: 1500, consumption: 9, calcMode: 'KM_ROUND_TRIP' },
    [VehicleType.HR_VUC]: { fixed: 0, variable: 0, factor: 4.20, axles: 2, capacity: 1800, consumption: 8, calcMode: 'KM_ROUND_TRIP' },
    // Custo Fixo (fixed = CC) e Custo Var/km (variable = CCD) alinhados à Tabela A da ANTT
    // (Portaria SUROC nº 4/2026), tipo de carga "Carga geral" — padrão.
    [VehicleType.Toco]: { fixed: 436.39, variable: 4.0031, factor: 0, axles: 2, capacity: 6000, consumption: 5, calcMode: 'ANTT' },
    [VehicleType.Truck]: { fixed: 523.33, variable: 5.1295, factor: 0, axles: 3, capacity: 12000, consumption: 4, calcMode: 'ANTT' },
    [VehicleType.Bitruck]: { fixed: 568.72, variable: 5.8178, factor: 0, axles: 4, capacity: 16000, consumption: 3.2, calcMode: 'ANTT' },
    [VehicleType.CarretaSimples]: { fixed: 635.08, variable: 6.7126, factor: 0, axles: 5, capacity: 25000, consumption: 2.8, calcMode: 'ANTT' },
    [VehicleType.CarretaLS]: { fixed: 648.95, variable: 7.4124, factor: 0, axles: 6, capacity: 32000, consumption: 2.2, calcMode: 'ANTT' },
    [VehicleType.Carreta4Eixo]: { fixed: 803.22, variable: 8.1252, factor: 0, axles: 7, capacity: 38000, consumption: 2.0, calcMode: 'ANTT' },
    [VehicleType.Vanderleia]: { fixed: 648.95, variable: 7.4124, factor: 0, axles: 6, capacity: 34000, consumption: 2.1, calcMode: 'ANTT' },
    [VehicleType.Rodotrem]: { fixed: 872.44, variable: 9.2466, factor: 0, axles: 9, capacity: 50000, consumption: 1.6, calcMode: 'ANTT' },
    [VehicleType.Prancha]: { fixed: 0, variable: 0, factor: 0, axles: 6, capacity: 40000, consumption: 1.5, calcMode: 'FREE' }
};

export const INITIAL_CUSTOMERS: Customer[] = [
    { id: '1', name: 'LOGISTICA TESTE' },
    { id: '2', name: 'TRANSPORTES WAGNER' }
];
