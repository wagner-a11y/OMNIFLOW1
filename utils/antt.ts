// Tabela A — Pisos Mínimos de Frete (ANTT / Resolução nº 6.084/2026)
// Coeficientes por número de eixos. Índice das colunas: [2, 3, 4, 5, 6, 7, 9] eixos.
// Piso mínimo = (distância em km × CCD) + CC
//
// CCD = Coeficiente de Custo de Deslocamento (por km)
// CC  = Coeficiente de Custo de Carga e Descarga (fixo)
//
// PROCEDÊNCIA: estes coeficientes NÃO foram transcritos do texto da resolução.
// Foram EXTRAÍDOS da API do Qualp em 11/08/2026, resolvendo o sistema linear de
// cada célula a partir de duas rotas de distância bem distinta:
//   São Paulo → Rio de Janeiro (437 km) e Porto Alegre → Fortaleza (4.245 km)
//   CCD = (piso₂ − piso₁) / (km₂ − km₁)      CC = piso₁ − km₁ × CCD
// Provados numa TERCEIRA distância independente (São Paulo → Salvador, 1.984 km):
// as 84 células reproduzem o piso do Qualp com desvio máximo de R$ 0,01, que é o
// arredondamento do CCD em 4 casas. Uma transcrição anterior, feita do texto,
// divergia em 71 das 78 células com valor — por isso a derivação.
//
// ATENÇÃO ao km: o Qualp calcula o piso sobre a distância ARREDONDADA ao inteiro
// (4.244,669 km → 4.245), não sobre a fracionária. Quem comparar piso local com
// piso do Qualp precisa usar o mesmo inteiro, senão a diferença aparece no CCD.
//
// Célula sem valor na resolução (null) NÃO é zero: computeANTTFloor devolve null
// e a tela mostra "—". Combinação carga/eixo que a ANTT não tarifa não tem piso,
// e piso zero liberaria cotação abaixo do mínimo legal.

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

// Único tipo em que a fonte do piso (Qualp) diverge da Tabela A local: com
// axis=5 o Qualp devolve o coeficiente de 4 eixos, ~8% abaixo. Decisão: aceitar
// o Qualp e pedir conferência manual só aqui — o operador já pode sobrescrever
// o preço base. Nenhum outro tipo tem cerca de sanidade.
export const CARGA_CONFERIR_PISO: ANTTCargoType = 'Carga granel pressurizada';

interface CargoCoefficients {
    ccd: (number | null)[]; // por coluna de eixos (ANTT_AXLE_COLUMNS)
    cc: (number | null)[];
}

export const ANTT_TABLE_A: Record<ANTTCargoType, CargoCoefficients> = {
    'Granel sólido': {
        ccd: [4.0144, 5.1355, 5.8118, 6.6983, 7.3841, 8.0516, 9.2231],
        cc: [460.59, 552.24, 597.00, 664.83, 680.01, 820.34, 908.90],
    },
    'Granel líquido': {
        ccd: [4.0884, 5.2311, 5.9661, 6.8661, 7.5572, 8.1900, 9.3822],
        cc: [471.98, 569.57, 621.53, 693.09, 709.72, 840.50, 934.76],
    },
    'Frigorificada ou aquecida': {
        ccd: [4.7095, 6.0159, 6.8646, 7.8666, 8.6661, 9.5884, 10.8870],
        cc: [520.07, 623.27, 686.63, 757.97, 772.36, 982.76, 1067.06],
    },
    'Conteinerizada': {
        // 2 eixos não é tarifado nesta categoria.
        ccd: [null, 5.1082, 5.7396, 6.6345, 7.3186, 8.0492, 9.1399],
        cc: [null, 544.75, 577.16, 647.29, 662.01, 819.69, 886.05],
    },
    'Carga geral': {
        ccd: [3.9826, 5.0977, 5.7822, 6.6718, 7.3547, 8.0927, 9.2027],
        cc: [451.84, 541.85, 588.86, 657.56, 671.93, 831.66, 903.32],
    },
    'Neogranel': {
        // De 5 eixos em diante a 6.084 iguala Neogranel a Carga geral — a
        // derivação reproduziu os mesmos coeficientes, célula a célula.
        ccd: [3.6023, 5.0962, 5.8094, 6.6718, 7.3547, 8.0927, 9.2027],
        cc: [451.85, 541.44, 596.35, 657.56, 671.93, 831.66, 903.32],
    },
    'Perigosa (granel sólido)': {
        ccd: [4.7845, 5.9154, 6.6285, 7.5150, 8.2008, 8.8866, 10.0660],
        cc: [608.79, 703.16, 753.03, 820.86, 836.04, 981.38, 1072.15],
    },
    'Perigosa (granel líquido)': {
        ccd: [4.8710, 6.0236, 6.7628, 7.6628, 8.3539, 9.0049, 10.2051],
        cc: [632.58, 732.90, 789.96, 861.51, 878.15, 1013.95, 1110.41],
    },
    'Perigosa (frigorificada ou aquecida)': {
        ccd: [5.3176, 6.6369, 7.5020, 8.5039, 9.3034, 10.2495, 11.5584],
        cc: [630.88, 737.64, 807.63, 878.97, 893.36, 1110.28, 1197.43],
    },
    'Perigosa (conteinerizada)': {
        // 2 eixos não é tarifado nesta categoria.
        ccd: [null, 5.4926, 6.1608, 7.0556, 7.7398, 8.4886, 9.5873],
        cc: [null, 645.45, 682.95, 753.10, 767.81, 930.51, 999.06],
    },
    'Perigosa (carga geral)': {
        ccd: [4.3571, 5.4821, 6.2033, 7.0930, 7.7758, 8.5321, 9.6501],
        cc: [549.81, 642.55, 694.66, 763.36, 777.72, 942.48, 1016.33],
    },
    'Carga granel pressurizada': {
        // Só 5, 6 e 9 eixos são tarifados na 6.084. A tabela anterior
        // (SUROC 4/2026) trazia 4, 5 e 9 — o 4 saiu e o 6 entrou.
        ccd: [null, null, null, 7.0364, 7.7652, null, 9.7444],
        cc: [null, null, null, 757.81, 784.82, null, 1052.26],
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
