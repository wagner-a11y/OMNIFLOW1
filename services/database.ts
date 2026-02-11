
import { supabase } from './supabase';
import { FreightCalculation, Customer, FederalTaxes, User, ANTTCoefficients } from '../types';

// =================== USERS ===================
export const getUsers = async (): Promise<User[]> => {
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .order('created_at', { ascending: true });

    if (error) {
        console.error('Error fetching users:', error);
        return [];
    }
    return data || [];
};

export const createUser = async (user: User): Promise<User | null> => {
    const { data, error } = await supabase
        .from('users')
        .insert([user])
        .select()
        .single();

    if (error) {
        console.error('Error creating user:', error);
        return null;
    }
    return data;
};

export const deleteUser = async (id: string): Promise<boolean> => {
    const { error } = await supabase
        .from('users')
        .delete()
        .eq('id', id);

    if (error) {
        console.error('Error deleting user:', error);
        return false;
    }
    return true;
};

// =================== CUSTOMERS ===================
export const getCustomers = async (): Promise<Customer[]> => {
    const { data, error } = await supabase
        .from('customers')
        .select('*')
        .order('created_at', { ascending: true });

    if (error) {
        console.error('Error fetching customers:', error);
        return [];
    }
    return (data || []).map((item: any) => ({
        id: item.id,
        name: item.name,
        logoUrl: item.logo_url
    }));
};

export const createCustomer = async (customer: Customer): Promise<Customer | null> => {
    const dbPayload = {
        id: customer.id,
        name: customer.name,
        logo_url: customer.logoUrl
    };
    const { data, error } = await supabase
        .from('customers')
        .insert([dbPayload])
        .select()
        .single();

    if (error) {
        console.error('Error creating customer:', error);
        return null;
    }
    return data ? { id: data.id, name: data.name, logoUrl: data.logo_url } : null;
};

export const updateCustomer = async (customer: Customer): Promise<boolean> => {
    const dbPayload = {
        name: customer.name,
        logo_url: customer.logoUrl
    };
    const { error } = await supabase
        .from('customers')
        .update(dbPayload)
        .eq('id', customer.id);

    if (error) {
        console.error('Error updating customer:', error);
        return false;
    }
    return true;
};

export const deleteCustomer = async (id: string): Promise<boolean> => {
    const { error } = await supabase
        .from('customers')
        .delete()
        .eq('id', id);

    if (error) {
        console.error('Error deleting customer:', error);
        return false;
    }
    return true;
};

// =================== VEHICLE CONFIGS ===================
export const getVehicleConfigs = async (): Promise<Record<string, ANTTCoefficients & { factor?: number; axles?: number }>> => {
    const { data, error } = await supabase
        .from('vehicle_configs')
        .select('*');

    if (error) {
        console.error('Error fetching vehicle configs:', error);
        return {};
    }

    const configs: Record<string, ANTTCoefficients & { factor?: number; axles?: number }> = {};
    data?.forEach((config: any) => {
        configs[config.vehicle_type] = {
            fixed: Number(config.fixed),
            variable: Number(config.variable),
            axles: config.axles,
            factor: config.factor ? Number(config.factor) : 0,
            calcMode: config.calc_mode || 'ANTT'
        };
    });

    return configs;
};

export const upsertVehicleConfig = async (
    vehicleType: string,
    config: ANTTCoefficients & { factor?: number; axles?: number }
): Promise<boolean> => {
    const { error } = await supabase
        .from('vehicle_configs')
        .upsert([{
            vehicle_type: vehicleType,
            fixed: config.fixed,
            variable: config.variable,
            axles: config.axles || 2,
            factor: config.factor,
            updated_at: new Date().toISOString()
        }]);

    if (error) {
        console.error('Error upserting vehicle config:', error);
        return false;
    }
    return true;
};

export const deleteVehicleConfig = async (vehicleType: string): Promise<boolean> => {
    const { error } = await supabase
        .from('vehicle_configs')
        .delete()
        .eq('vehicle_type', vehicleType);

    if (error) {
        console.error('Error deleting vehicle config:', error);
        return false;
    }
    return true;
};

// =================== SYSTEM CONFIG ===================
export const getSystemConfig = async (): Promise<FederalTaxes | null> => {
    const { data, error } = await supabase
        .from('system_config')
        .select('*')
        .eq('id', 'default')
        .single();

    if (error) {
        console.error('Error fetching system config:', error);
        return null;
    }

    return {
        pis: Number(data.pis),
        cofins: Number(data.cofins),
        csll: Number(data.csll),
        irpj: Number(data.irpj),
        insurancePolicyRate: Number(data.insurance_policy_rate)
    };
};

export const updateSystemConfig = async (config: FederalTaxes): Promise<boolean> => {
    const { error } = await supabase
        .from('system_config')
        .update({
            pis: config.pis,
            cofins: config.cofins,
            csll: config.csll,
            irpj: config.irpj,
            insurance_policy_rate: config.insurancePolicyRate,
            updated_at: new Date().toISOString()
        })
        .eq('id', 'default');

    if (error) {
        console.error('Error updating system config:', error);
        return false;
    }
    return true;
};

// =================== FREIGHT CALCULATIONS ===================
export const getFreightCalculations = async (): Promise<FreightCalculation[]> => {
    const { data, error } = await supabase
        .from('freight_calculations')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500);

    if (error) {
        console.error('Error fetching freight calculations:', error);
        return [];
    }

    return (data || []).map((item: any) => ({
        id: item.id,
        proposalNumber: item.proposal_number,
        clientReference: item.client_reference,
        origin: item.origin,
        destination: item.destination,
        distanceKm: Number(item.distance_km),
        vehicleType: item.vehicle_type,
        merchandiseType: item.merchandise_type || '',
        weight: Number(item.weight),
        customerId: item.customer_id,
        suggestedFreight: item.suggested_freight ? Number(item.suggested_freight) : 0,
        baseFreight: Number(item.base_freight),
        tolls: Number(item.tolls),
        extraCosts: Number(item.extra_costs),
        extraCostsDescription: item.extra_costs_description,
        goodsValue: Number(item.goods_value),
        insurancePercent: Number(item.insurance_percent),
        adValorem: Number(item.ad_valorem),
        profitMargin: Number(item.profit_margin),
        icmsPercent: Number(item.icms_percent),
        pisPercent: Number(item.pis_percent),
        cofinsPercent: Number(item.cofins_percent),
        csllPercent: Number(item.csll_percent),
        irpjPercent: Number(item.irpj_percent),
        totalFreight: Number(item.total_freight),
        createdAt: Number(item.created_at),
        disponibilidade: item.disponibilidade,
        status: item.status,
        realProfit: item.real_profit ? Number(item.real_profit) : undefined,
        realMarginPercent: item.real_margin_percent ? Number(item.real_margin_percent) : undefined,
        isEdited: item.is_edited,
        updatedBy: item.updated_by,
        updatedByName: item.updated_by_name,
        updatedAt: item.updated_at
    }));
};

export const createFreightCalculation = async (calc: FreightCalculation): Promise<FreightCalculation | null> => {
    const dbRecord = {
        id: calc.id,
        proposal_number: calc.proposalNumber,
        client_reference: calc.clientReference || null,
        origin: calc.origin,
        destination: calc.destination,
        distance_km: calc.distanceKm,
        vehicle_type: calc.vehicleType,
        merchandise_type: calc.merchandiseType || null,
        weight: calc.weight,
        customer_id: calc.customerId || null,
        suggested_freight: calc.suggestedFreight || 0,
        base_freight: calc.baseFreight || 0,
        tolls: calc.tolls || 0,
        extra_costs: calc.extraCosts || 0,
        extra_costs_description: calc.extraCostsDescription || null,
        goods_value: calc.goodsValue || 0,
        insurance_percent: calc.insurancePercent || 0,
        ad_valorem: calc.adValorem || 0,
        profit_margin: calc.profitMargin || 0,
        icms_percent: calc.icmsPercent || 0,
        pis_percent: calc.pisPercent || 0,
        cofins_percent: calc.cofinsPercent || 0,
        csll_percent: calc.csllPercent || 0,
        irpj_percent: calc.irpjPercent || 0,
        total_freight: calc.totalFreight || 0,
        created_at: calc.createdAt,
        disponibilidade: calc.disponibilidade,
        status: calc.status,
        real_profit: calc.realProfit || 0,
        real_margin_percent: calc.realMarginPercent || 0,
        updated_by: calc.updatedBy || null,
        updated_by_name: calc.updatedByName || null
    };

    const { error } = await supabase
        .from('freight_calculations')
        .insert([dbRecord]);

    if (error) {
        console.error('CRITICAL: Error creating freight calculation in Supabase!', error);
        console.error('Payload attempted:', dbRecord);
        return null;
    }
    console.log('Successfully saved to Supabase:', calc.proposalNumber);
    return calc;
};

export const updateFreightCalculation = async (calc: FreightCalculation): Promise<boolean> => {
    const dbRecord = {
        proposal_number: calc.proposalNumber,
        client_reference: calc.clientReference || null,
        origin: calc.origin,
        destination: calc.destination,
        distance_km: calc.distanceKm,
        vehicle_type: calc.vehicleType,
        merchandise_type: calc.merchandiseType || null,
        weight: calc.weight,
        customer_id: calc.customerId || null,
        suggested_freight: calc.suggestedFreight || 0,
        base_freight: calc.baseFreight || 0,
        tolls: calc.tolls || 0,
        extra_costs: calc.extraCosts || 0,
        extra_costs_description: calc.extraCostsDescription || null,
        goods_value: calc.goodsValue || 0,
        insurance_percent: calc.insurancePercent || 0,
        ad_valorem: calc.adValorem || 0,
        profit_margin: calc.profitMargin || 0,
        icms_percent: calc.icmsPercent || 0,
        pis_percent: calc.pisPercent || 0,
        cofins_percent: calc.cofinsPercent || 0,
        csll_percent: calc.csllPercent || 0,
        irpj_percent: calc.irpjPercent || 0,
        total_freight: calc.totalFreight || 0,
        disponibilidade: calc.disponibilidade,
        status: calc.status,
        updated_at: new Date().toISOString(),
        real_profit: calc.realProfit || 0,
        real_margin_percent: calc.realMarginPercent || 0,
        is_edited: true,
        updated_by: calc.updatedBy || null,
        updated_by_name: calc.updatedByName || null
    };

    const { error } = await supabase
        .from('freight_calculations')
        .update(dbRecord)
        .eq('id', calc.id);

    if (error) {
        console.error('Error updating freight calculation:', error);
        return false;
    }
    return true;
};

export const deleteFreightCalculation = async (id: string): Promise<boolean> => {
    const { error } = await supabase
        .from('freight_calculations')
        .delete()
        .eq('id', id);

    if (error) {
        console.error('Error deleting freight calculation:', error);
        return false;
    }
    return true;
};
