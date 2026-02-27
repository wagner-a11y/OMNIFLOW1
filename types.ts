
export enum VehicleType {
    Fiorino = "Fiorino - Utilitário",
    Van = "Van - Utilitário",
    HR_VUC = "HR/VUC - Utilitário",
    Toco = "Toco",
    Truck = "Truck",
    CarretaSimples = "Carreta Simples",
    CarretaLS = "Carreta LS",
    Carreta4Eixo = "Carreta 4º Eixo",
    Vanderleia = "Vanderleia",
    Rodotrem = "Rodotrem",
    Prancha = "Prancha - Preço livre"
}

export type Disponibilidade = "Imediato" | "Conforme programação";
export type QuoteStatus = "pending" | "respondida" | "aprovada" | "em_operacao" | "won" | "lost" | "spot_simulated";
export type LostReason = "preco_alto" | "prazo_entrega" | "concorrencia" | "disponibilidade" | "outros" | "";

export const LOST_REASONS: Record<string, string> = {
    "preco_alto": "Preço muito alto",
    "prazo_entrega": "Prazo de entrega",
    "concorrencia": "Concorrência",
    "disponibilidade": "Indisponibilidade de veículo",
    "outros": "Outros"
};
export type UserRole = "master" | "operador";

export interface User {
    id: string;
    name: string;
    username: string;
    password?: string;
    role: UserRole;
}

export interface ANTTCoefficients {
    fixed: number;
    variable: number;
    factor: number;
    calcMode: 'KM' | 'ANTT' | 'KM_ROUND_TRIP' | 'FREE';
}

export interface Customer {
    id: string;
    name: string;
    logoUrl?: string;
}

export interface FederalTaxes {
    pis: number;
    cofins: number;
    csll: number;
    irpj: number;
    insurancePolicyRate: number;
    goals?: Record<string, number>; // Format: "YYYY-MM": value
    spotStats?: { simulated: number; converted: number };
    icmsRates?: Record<string, number>; // Format: "ORIGIN-DESTINATION": rate (e.g., "ES-RJ": 12)
}

export interface ExtraCostItem {
    id: string;
    label: string;
    value: number;
}

export interface FreightCalculation {
    id: string;
    proposalNumber: string;
    clientReference?: string;
    origin: string;
    destination: string;
    distanceKm: number;
    vehicleType: VehicleType;
    merchandiseType: string;
    weight: number;
    customerId: string;
    suggestedFreight: number;
    baseFreight: number;
    tolls: number;
    extraCosts: number;
    extraCostsDescription?: string;
    otherCosts?: ExtraCostItem[];
    goodsValue: number;
    insurancePercent: number;
    adValorem: number;
    profitMargin: number;
    icmsPercent: number;
    pisPercent: number;
    cofinsPercent: number;
    csllPercent: number;
    irpjPercent: number;
    totalFreight: number;
    createdAt: number;
    disponibilidade: Disponibilidade;
    status: QuoteStatus;
    realProfit?: number;
    realMarginPercent?: number;
    isEdited?: boolean;
    updatedBy?: string;
    updatedByName?: string;
    updatedAt?: string;
    lostReason?: LostReason;
    lostObs?: string;
    lostFileUrl?: string;
    // Operation Pipeline Fields
    coletaDate?: string;
    entregaDate?: string;
    clienteNomeOperacao?: string;
    referenciaClienteOperacao?: string;
    solicitante?: string;
    coletaEndereco?: string;
    entregaEndereco?: string;
    pesoCargaOperacao?: number;
    veiculoTipoOperacao?: string;
    carroceriaTipoOperacao?: string;
    materialTipo?: string;
    nossoFrete?: number;
    freteTerceiro?: number;
    valorCarga?: number;
    outrasNecessidades?: string;
    observacoesGerais?: string;
    pipelineStage?: string;
    motoristaNome?: string;
    motoristaCPF?: string;
    motoristaTelefone?: string;
    placaCavalo?: string;
    placaCarreta1?: string;
    placaCarreta2?: string;
    motoristaDocUrl?: string;
    placaCavaloDocUrl?: string;
    placaCarreta1DocUrl?: string;
    placaCarreta2DocUrl?: string;

    // Advanced GR Fields
    motoristaRG?: string;
    motoristaCnhRegistro?: string;
    motoristaCnhProtocolo?: string;
    motoristaCnhSeguranca?: string;

    placaCavaloRenavam?: string;
    placaCavaloChassi?: string;
    placaCavaloCor?: string;
    placaCavaloAnoFab?: string;
    placaCavaloAnoMod?: string;
    placaCavaloMarca?: string;
    placaCavaloModelo?: string;

    placaCarreta1Renavam?: string;
    placaCarreta1Chassi?: string;
    placaCarreta1Cor?: string;
    placaCarreta1AnoFab?: string;
    placaCarreta1AnoMod?: string;
    placaCarreta1Marca?: string;
    placaCarreta1Modelo?: string;

    placaCarreta2Renavam?: string;
    placaCarreta2Chassi?: string;
    placaCarreta2Cor?: string;
    placaCarreta2AnoFab?: string;
    placaCarreta2AnoMod?: string;
    placaCarreta2Marca?: string;
    placaCarreta2Modelo?: string;
}
