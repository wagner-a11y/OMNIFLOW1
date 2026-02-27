
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
        insurancePolicyRate: Number(data.insurance_policy_rate),
        goals: data.goals || {},
        spotStats: data.spot_stats || { simulated: 0, converted: 0 },
        icmsRates: data.icms_rates || {}
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
            goals: config.goals || {},
            spot_stats: config.spotStats || { simulated: 0, converted: 0 },
            icms_rates: config.icmsRates || {},
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
        updatedAt: item.updated_at,
        lostReason: item.lost_reason,
        lostObs: item.lost_obs,
        lostFileUrl: item.lost_file_url,
        otherCosts: item.other_costs || [],
        coletaDate: item.coleta_date,
        entregaDate: item.entrega_date,
        clienteNomeOperacao: item.cliente_nome_operacao,
        referenciaClienteOperacao: item.referencia_cliente_operacao,
        solicitante: item.solicitante,
        coletaEndereco: item.coleta_endereco,
        entregaEndereco: item.entrega_endereco,
        pesoCargaOperacao: item.peso_carga_operacao ? Number(item.peso_carga_operacao) : undefined,
        veiculoTipoOperacao: item.veiculo_tipo_operacao,
        carroceriaTipoOperacao: item.carroceria_tipo_operacao,
        materialTipo: item.material_tipo,
        nossoFrete: item.nosso_frete ? Number(item.nosso_frete) : undefined,
        freteTerceiro: item.frete_terceiro ? Number(item.frete_terceiro) : undefined,
        valorCarga: item.valor_carga ? Number(item.valor_carga) : undefined,
        outrasNecessidades: item.outras_necessidades,
        observacoesGerais: item.observacoes_gerais,
        pipelineStage: item.pipeline_stage,
        motoristaNome: item.motorista_nome,
        motoristaCPF: item.motorista_cpf,
        motoristaTelefone: item.motorista_telefone,
        placaCavalo: item.placa_cavalo,
        placaCarreta1: item.placa_carreta_1,
        placaCarreta2: item.placa_carreta_2,
        motoristaDocUrl: item.motorista_doc_url,
        placaCavaloDocUrl: item.placa_cavalo_doc_url,
        placaCarreta1DocUrl: item.placa_carreta_1_doc_url,
        placaCarreta2DocUrl: item.placa_carreta_2_doc_url
    }));
};

export const createFreightCalculation = async (calc: FreightCalculation): Promise<{ success: boolean; data?: FreightCalculation; error?: string }> => {
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
        updated_by: calc.updatedBy || null,
        updated_by_name: calc.updatedByName || null,
        lost_reason: calc.lostReason || null,
        lost_obs: calc.lostObs || null,
        lost_file_url: calc.lostFileUrl || null,
        real_profit: calc.realProfit || 0,
        real_margin_percent: calc.realMarginPercent || 0,
        other_costs: calc.otherCosts || [],
        coleta_date: calc.coletaDate || null,
        entrega_date: calc.entregaDate || null,
        cliente_nome_operacao: calc.clienteNomeOperacao || null,
        referencia_cliente_operacao: calc.referenciaClienteOperacao || null,
        solicitante: calc.solicitante || null,
        coleta_endereco: calc.coletaEndereco || null,
        entrega_endereco: calc.entregaEndereco || null,
        peso_carga_operacao: calc.pesoCargaOperacao || null,
        veiculo_tipo_operacao: calc.veiculoTipoOperacao || null,
        carroceria_tipo_operacao: calc.carroceriaTipoOperacao || null,
        material_tipo: calc.materialTipo || null,
        nosso_frete: calc.nossoFrete || null,
        frete_terceiro: calc.freteTerceiro || null,
        valor_carga: calc.valorCarga || null,
        outras_necessidades: calc.outrasNecessidades || null,
        motorista_rg: calc.motoristaRG || null,
        motorista_cnh_registro: calc.motoristaCnhRegistro || null,
        motorista_cnh_protocolo: calc.motoristaCnhProtocolo || null,
        motorista_cnh_seguranca: calc.motoristaCnhSeguranca || null,
        placa_cavalo_renavam: calc.placaCavaloRenavam || null,
        placa_cavalo_chassi: calc.placaCavaloChassi || null,
        placa_cavalo_cor: calc.placaCavaloCor || null,
        placa_cavalo_ano_fab: calc.placaCavaloAnoFab || null,
        placa_cavalo_ano_mod: calc.placaCavaloAnoMod || null,
        placa_cavalo_marca: calc.placaCavaloMarca || null,
        placa_cavalo_modelo: calc.placaCavaloModelo || null,
        placa_carreta_1_renavam: calc.placaCarreta1Renavam || null,
        placa_carreta_1_chassi: calc.placaCarreta1Chassi || null,
        placa_carreta_1_cor: calc.placaCarreta1Cor || null,
        placa_carreta_1_ano_fab: calc.placaCarreta1AnoFab || null,
        placa_carreta_1_ano_mod: calc.placaCarreta1AnoMod || null,
        placa_carreta_1_marca: calc.placaCarreta1Marca || null,
        placa_carreta_1_modelo: calc.placaCarreta1Modelo || null,
        placa_carreta_2_renavam: calc.placaCarreta2Renavam || null,
        placa_carreta_2_chassi: calc.placaCarreta2Chassi || null,
        placa_carreta_2_cor: calc.placaCarreta2Cor || null,
        placa_carreta_2_ano_fab: calc.placaCarreta2AnoFab || null,
        placa_carreta_2_ano_mod: calc.placaCarreta2AnoMod || null,
        placa_carreta_2_marca: calc.placaCarreta2Marca || null,
        placa_carreta_2_modelo: calc.placaCarreta2Modelo || null,
        observacoes_gerais: calc.observacoesGerais || null,
        pipeline_stage: calc.pipelineStage || 'Nova carga',
        motorista_nome: calc.motoristaNome || null,
        motorista_cpf: calc.motoristaCPF || null,
        motorista_telefone: calc.motoristaTelefone || null,
        placa_cavalo: calc.placaCavalo || null,
        placa_carreta_1: calc.placaCarreta1 || null,
        placa_carreta_2: calc.placaCarreta2 || null,
        motorista_doc_url: calc.motoristaDocUrl || null,
        placa_cavalo_doc_url: calc.placaCavaloDocUrl || null,
        placa_carreta_1_doc_url: calc.placaCarreta1DocUrl || null,
        placa_carreta_2_doc_url: calc.placaCarreta2DocUrl || null
    };

    const { error } = await supabase
        .from('freight_calculations')
        .insert([dbRecord]);

    if (error) {
        console.error('CRITICAL: Error in createFreightCalculation:', error);
        return { success: false, error: error.message };
    }
    return { success: true, data: calc };
};

export const updateFreightCalculation = async (calc: FreightCalculation): Promise<{ success: boolean; error?: string }> => {
    // Sanitize numeric fields to prevent NaN or invalid types
    const sanitize = (val: any) => {
        if (val === undefined || val === null) return null;
        const n = Number(val);
        return isNaN(n) ? null : n;
    };

    const dbRecord = {
        id: calc.id,
        proposal_number: calc.proposalNumber,
        client_reference: calc.clientReference || null,
        origin: calc.origin,
        destination: calc.destination,
        distance_km: sanitize(calc.distanceKm) || 0,
        vehicle_type: calc.vehicleType,
        merchandise_type: calc.merchandiseType || null,
        weight: sanitize(calc.weight) || 0,
        customer_id: calc.customerId || null,
        suggested_freight: sanitize(calc.suggestedFreight) || 0,
        base_freight: sanitize(calc.baseFreight) || 0,
        tolls: sanitize(calc.tolls) || 0,
        extra_costs: sanitize(calc.extraCosts) || 0,
        extra_costs_description: calc.extraCostsDescription || null,
        goods_value: sanitize(calc.goodsValue) || 0,
        insurance_percent: sanitize(calc.insurancePercent) || 0,
        ad_valorem: sanitize(calc.adValorem) || 0,
        profit_margin: sanitize(calc.profitMargin) || 0,
        icms_percent: sanitize(calc.icmsPercent) || 0,
        pis_percent: sanitize(calc.pisPercent) || 0,
        cofins_percent: sanitize(calc.cofinsPercent) || 0,
        csll_percent: sanitize(calc.csllPercent) || 0,
        irpj_percent: sanitize(calc.irpjPercent) || 0,
        total_freight: sanitize(calc.totalFreight) || 0,
        disponibilidade: calc.disponibilidade,
        status: calc.status,
        updated_at: new Date().toISOString(),
        updated_by: calc.updatedBy || null,
        updated_by_name: calc.updatedByName || null,
        lost_reason: calc.lostReason || null,
        lost_obs: calc.lostObs || null,
        lost_file_url: calc.lostFileUrl || null,
        real_profit: sanitize(calc.realProfit) || 0,
        real_margin_percent: sanitize(calc.realMarginPercent) || 0,
        other_costs: calc.otherCosts || [],
        coleta_date: calc.coletaDate || null,
        entrega_date: calc.entregaDate || null,
        cliente_nome_operacao: calc.clienteNomeOperacao || null,
        referencia_cliente_operacao: calc.referenciaClienteOperacao || null,
        solicitante: calc.solicitante || null,
        coleta_endereco: calc.coletaEndereco || null,
        entrega_endereco: calc.entregaEndereco || null,
        peso_carga_operacao: sanitize(calc.pesoCargaOperacao),
        veiculo_tipo_operacao: calc.veiculoTipoOperacao || null,
        carroceria_tipo_operacao: calc.carroceriaTipoOperacao || null,
        material_tipo: calc.materialTipo || null,
        nosso_frete: sanitize(calc.nossoFrete),
        frete_terceiro: sanitize(calc.freteTerceiro),
        valor_carga: sanitize(calc.valorCarga),
        outras_necessidades: calc.outrasNecessidades || null,
        motorista_rg: calc.motoristaRG || null,
        motorista_cnh_registro: calc.motoristaCnhRegistro || null,
        motorista_cnh_protocolo: calc.motoristaCnhProtocolo || null,
        motorista_cnh_seguranca: calc.motoristaCnhSeguranca || null,
        placa_cavalo_renavam: calc.placaCavaloRenavam || null,
        placa_cavalo_chassi: calc.placaCavaloChassi || null,
        placa_cavalo_cor: calc.placaCavaloCor || null,
        placa_cavalo_ano_fab: calc.placaCavaloAnoFab || null,
        placa_cavalo_ano_mod: calc.placaCavaloAnoMod || null,
        placa_cavalo_marca: calc.placaCavaloMarca || null,
        placa_cavalo_modelo: calc.placaCavaloModelo || null,
        placa_carreta_1_renavam: calc.placaCarreta1Renavam || null,
        placa_carreta_1_chassi: calc.placaCarreta1Chassi || null,
        placa_carreta_1_cor: calc.placaCarreta1Cor || null,
        placa_carreta_1_ano_fab: calc.placaCarreta1AnoFab || null,
        placa_carreta_1_ano_mod: calc.placaCarreta1AnoMod || null,
        placa_carreta_1_marca: calc.placaCarreta1Marca || null,
        placa_carreta_1_modelo: calc.placaCarreta1Modelo || null,
        placa_carreta_2_renavam: calc.placaCarreta2Renavam || null,
        placa_carreta_2_chassi: calc.placaCarreta2Chassi || null,
        placa_carreta_2_cor: calc.placaCarreta2Cor || null,
        placa_carreta_2_ano_fab: calc.placaCarreta2AnoFab || null,
        placa_carreta_2_ano_mod: calc.placaCarreta2AnoMod || null,
        placa_carreta_2_marca: calc.placaCarreta2Marca || null,
        placa_carreta_2_modelo: calc.placaCarreta2Modelo || null,
        observacoes_gerais: calc.observacoesGerais || null,
        pipeline_stage: calc.pipelineStage || 'Nova carga',
        motorista_nome: calc.motoristaNome || null,
        motorista_cpf: calc.motoristaCPF || null,
        motorista_telefone: calc.motoristaTelefone || null,
        placa_cavalo: calc.placaCavalo || null,
        placa_carreta_1: calc.placaCarreta1 || null,
        placa_carreta_2: calc.placaCarreta2 || null,
        motorista_doc_url: calc.motoristaDocUrl || null,
        placa_cavalo_doc_url: calc.placaCavaloDocUrl || null,
        placa_carreta_1_doc_url: calc.placaCarreta1DocUrl || null,
        placa_carreta_2_doc_url: calc.placaCarreta2DocUrl || null
    };

    const { error } = await supabase
        .from('freight_calculations')
        .upsert([dbRecord]);

    if (error) {
        console.error('CRITICAL: Error updating/upserting freight calculation:', error);
        console.error('Payload attempted:', dbRecord);
        return { success: false, error: error.message };
    }
    return { success: true };
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
