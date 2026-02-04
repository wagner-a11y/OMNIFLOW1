
export enum VehicleType {
    Fiorino = "Fiorino",
    Van = "Van",
    HR = "HR",
    TresQuartos = "3/4",
    Toco = "Toco",
    Truck = "Truck",
    Bitruck = "Bitruck",
    Carreta5Eixos = "Carreta 5 eixos",
    CarretaLS = "Carreta LS",
    CarretaVanderleia = "Carreta Vanderleia",
    Carreta4Eixo = "Carreta 4º Eixo",
    Rodotrem = "Rodotrem",
    Prancha = "Prancha",
    Rodoaereo = "Rodoaéreo"
}

export type Disponibilidade = "Imediato" | "Conforme programação";
export type QuoteStatus = "pending" | "won" | "lost";
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
}
