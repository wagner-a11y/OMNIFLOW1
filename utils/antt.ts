// Tabela A — Pisos Mínimos de Frete (ANTT / Portaria SUROC nº 4/2026)
// Coeficientes por número de eixos. Índice das colunas: [2, 3, 4, 5, 6, 7, 9] eixos.
// Piso mínimo = (distância em km × CCD) + CC
//
// CCD = Coeficiente de Custo de Deslocamento (por km)
// CC  = Coeficiente de Custo de Carga e Descarga (fixo)

import { VehicleType } from '../types';

// Ordem das colunas de eixos usada em todos os vetores abaixo.
export const ANTT_AXLE_COLUMNS = [2, 3, 4, 5, 6, 7, 9] as const;

// Tipos de carga da Tabela A (na ordem oficial).
export const ANTT_CARGO_TYPES = [
    'Granel sólido',
    'Granel líquido',
    'Frigorificada ou aquecida',
    'Conteinerizada',
    'Carga geral',
    'Neogranel',
    'Perigosa (granel sólido)',
    'Perigosa (granel líquido)',
    'Perigosa (frigorificada ou aquecida)',
    'Perigosa (conteinerizada)',
    'Perigosa (carga geral)',
    'Carga granel pressurizada',
] as const;

export type ANTTCargoType = typeof ANTT_CARGO_TYPES[number];

interface CargoCoefficients {
    ccd: (number | null)[]; // por coluna de eixos (ANTT_AXLE_COLUMNS)
    cc: (number | null)[];
}

export const ANTT_TABLE_A: Record<ANTTCargoType, CargoCoefficients> = {
    'Granel sólido': {
        ccd: [4.0338, 5.1660, 5.8464, 6.7381, 7.4408, 8.0855, 9.2662],
        cc: [444.84, 533.36, 576.59, 642.10, 656.76, 792.30, 877.83],
    },
    'Granel líquido': {
        ccd: [4.1052, 5.2583, 5.9955, 6.9002, 7.6080, 8.2192, 9.4199],
        cc: [455.84, 550.10, 600.27, 669.38, 685.45, 811.76, 902.80],
    },
    'Frigorificada ou aquecida': {
        ccd: [4.7442, 6.0679, 6.9216, 7.9337, 8.7563, 9.6471, 10.9629],
        cc: [502.29, 601.96, 663.16, 732.07, 745.94, 949.16, 1030.58],
    },
    'Conteinerizada': {
        ccd: [null, 5.1397, 5.7767, 6.6765, 7.3776, 8.0832, 9.1859],
        cc: [null, 526.13, 557.42, 625.16, 639.38, 791.67, 855.76],
    },
    'Carga geral': {
        ccd: [4.0031, 5.1295, 5.8178, 6.7126, 7.4124, 8.1252, 9.2466],
        cc: [436.39, 523.33, 568.72, 635.08, 648.95, 803.22, 872.44],
    },
    'Neogranel': {
        ccd: [3.6028, 5.1281, 5.8441, 6.7126, 7.4124, 8.1252, 9.2466],
        cc: [436.39, 522.93, 575.96, 635.08, 648.95, 803.22, 872.44],
    },
    'Perigosa (granel sólido)': {
        ccd: [4.7775, 5.9193, 6.6352, 7.5269, 8.2296, 8.8919, 10.0803],
        cc: [587.98, 679.12, 727.28, 792.80, 807.45, 947.84, 1035.49],
    },
    'Perigosa (granel líquido)': {
        ccd: [4.8611, 6.0237, 6.7649, 7.6697, 8.3775, 9.0063, 10.2147],
        cc: [610.96, 707.85, 762.95, 832.06, 848.13, 979.29, 1072.44],
    },
    'Perigosa (frigorificada ou aquecida)': {
        ccd: [5.3315, 6.6676, 7.5371, 8.5492, 9.3718, 10.2855, 11.6113],
        cc: [609.31, 712.41, 780.02, 848.93, 862.80, 1072.32, 1156.49],
    },
    'Perigosa (conteinerizada)': {
        ccd: [null, 5.5109, 6.1835, 7.0832, 7.7843, 8.5076, 9.6180],
        cc: [null, 623.38, 659.60, 727.35, 741.56, 898.70, 964.90],
    },
    'Perigosa (carga geral)': {
        ccd: [4.3647, 5.5008, 6.2246, 7.1193, 7.8191, 8.5496, 9.6787],
        cc: [531.01, 620.58, 670.91, 737.27, 751.14, 910.26, 981.58],
    },
    'Carga granel pressurizada': {
        ccd: [null, null, 7.0646, 7.8089, null, null, 9.7697],
        cc: [null, null, 731.90, 757.99, null, null, 1016.29],
    },
};

// Veículos sem tabela ANTT — devem exibir "—" no piso e ocultar o seletor de carga.
// (Não são removidos do sistema; apenas ignoram o piso mínimo.)
export const NO_ANTT_VEHICLES = new Set<string>([
    VehicleType.Fiorino,
    VehicleType.Van,
    VehicleType.HR_VUC, // categoria 3/4
    VehicleType.Prancha,
]);

export const vehicleHasANTT = (vehicleType: string): boolean => !NO_ANTT_VEHICLES.has(vehicleType);

/**
 * Calcula o piso mínimo ANTT (Tabela A) para um tipo de carga, número de eixos e distância.
 * Retorna null quando não há coeficiente aplicável (eixos fora da tabela, combinação
 * carga/eixo inexistente, ou dados insuficientes).
 */
export const computeANTTFloor = (
    cargoType: string,
    axles: number | undefined | null,
    km: number
): number | null => {
    if (axles == null) return null;
    const colIndex = ANTT_AXLE_COLUMNS.indexOf(axles as typeof ANTT_AXLE_COLUMNS[number]);
    if (colIndex === -1) return null;

    const coeffs = ANTT_TABLE_A[cargoType as ANTTCargoType];
    if (!coeffs) return null;

    const ccd = coeffs.ccd[colIndex];
    const cc = coeffs.cc[colIndex];
    if (ccd == null || cc == null) return null;

    return km * ccd + cc;
};
