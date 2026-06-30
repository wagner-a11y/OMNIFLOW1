
import { supabase } from './supabase';
import { FreightCalculation, Customer, FederalTaxes, User, ANTTCoefficients } from '../types';

// =================== PROFILES (Supabase Auth) ===================
// Perfil único do usuário autenticado (papel + nome), lido após o login via Auth.
export const getProfile = async (id: string): Promise<{ id: string; name: string; email: string; role: string; active: boolean; must_change_password: boolean } | null> => {
    const { data, error } = await supabase
        .from('profiles')
        .select('id,name,email,role,active,must_change_password')
        .eq('id', id)
        .single();
    if (error) {
        console.error('Error fetching profile:', error);
        return null;
    }
    return data as any;
};

// Lista de perfis para a tela de gestão de usuários (master).
export const getProfiles = async (): Promise<User[]> => {
    const { data, error } = await supabase
        .from('profiles')
        .select('id,name,email,role,active,must_change_password')
        .order('created_at', { ascending: true });
    if (error) {
        console.error('Error fetching profiles:', error);
        return [];
    }
    return (data || []).map((p: any) => ({
        id: p.id, name: p.name, username: p.email, role: p.role,
        active: p.active !== false, mustChangePassword: !!p.must_change_password,
    }));
};

// Invoca a Edge Function de gestão de usuários e SURFA o erro real do corpo da função
// (supabase.functions.invoke devolve só "non-2xx status code" no erro — lemos o JSON do contexto).
const invokeUserFn = async (body: any, fallbackMsg: string) => {
    try {
        const { data, error } = await supabase.functions.invoke('create-user', { body });
        if (error) {
            let msg = error.message;
            try { const b = await (error as any).context?.json?.(); if (b?.error) msg = b.error; } catch { /* noop */ }
            return { error: msg };
        }
        if (data?.error) return { error: data.error };
        return data;
    } catch (e: any) {
        return { error: e?.message || fallbackMsg };
    }
};

// Cria usuário (já confirmado; senha temporária forte gerada no servidor). Só master.
// Retorna { tempPassword } pro master repassar por fora. Sem e-mail.
export const createUserAccount = (payload: { email: string; name: string; role: string }) =>
    invokeUserFn({ action: 'create', ...payload }, 'Erro ao criar usuário.');

// Remove usuário (Auth + perfil). Só master. (mantido; UI usa desativar)
export const deleteUserAccount = (userId: string) =>
    invokeUserFn({ action: 'delete', userId }, 'Erro ao remover usuário.');

// Redefine a senha (gera nova temporária forte + confirma e-mail + obriga troca). Só master.
export const resetUserPassword = (userId: string) =>
    invokeUserFn({ action: 'reset', userId }, 'Erro ao redefinir senha.');

// Ativa/desativa usuário (bane no Auth + reflete em profiles.active). Sem apagar. Só master.
export const setUserActive = (userId: string, active: boolean) =>
    invokeUserFn({ action: 'setActive', userId, active }, 'Erro ao alterar status do usuário.');

// Conclui a troca de senha do 1º acesso: limpa a flag must_change_password do próprio usuário.
export const finishPasswordChange = () =>
    invokeUserFn({ action: 'finishPasswordChange' }, 'Erro ao concluir troca de senha.');

// =================== USERS (LEGADO — removido do login na Etapa A) ===================
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
        logoUrl: item.logo_url,
        pipefyClientId: item.pipefy_client_id || undefined
    }));
};

export const createCustomer = async (customer: Customer): Promise<Customer | null> => {
    const dbPayload = {
        id: customer.id,
        name: customer.name,
        logo_url: customer.logoUrl,
        pipefy_client_id: customer.pipefyClientId || null
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
    return data ? { id: data.id, name: data.name, logoUrl: data.logo_url, pipefyClientId: data.pipefy_client_id || undefined } : null;
};

export const updateCustomer = async (customer: Customer): Promise<boolean> => {
    const dbPayload = {
        name: customer.name,
        logo_url: customer.logoUrl,
        pipefy_client_id: customer.pipefyClientId || null
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
        marginThreshold: data.margin_threshold != null ? Number(data.margin_threshold) : 15,
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
            margin_threshold: config.marginThreshold ?? 15,
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
// Mapeia uma linha do banco (snake_case) para o modelo da aplicação (camelCase).
// Extraído para ser reutilizado tanto pelo Histórico (ativas) quanto pela Lixeira.
const mapFreightRow = (item: any): FreightCalculation => ({
        id: item.id,
        proposalNumber: item.proposal_number,
        clientReference: item.client_reference,
        origin: item.origin,
        destination: item.destination,
        destinations: Array.isArray(item.destinations) ? item.destinations : [],
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
        elaborationSeconds: item.elaboration_seconds ? Number(item.elaboration_seconds) : undefined,
        isEdited: item.is_edited,
        createdBy: item.created_by,
        createdByName: item.created_by_name,
        updatedBy: item.updated_by,
        updatedByName: item.updated_by_name,
        updatedAt: item.updated_at,
        lostReason: item.lost_reason,
        lostObs: item.lost_obs,
        lostFileUrl: item.lost_file_url,
        otherCosts: item.other_costs || [],
        coletaDate: item.coleta_date,
        entregaDate: item.entrega_date,
        dataFechamento: item.data_fechamento || undefined,
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
        placaCarreta2DocUrl: item.placa_carreta_2_doc_url,
        pipefyCardId: item.pipefy_card_id || undefined,
        pipefySentAt: item.pipefy_sent_at || undefined,
        clientePipefyId: item.cliente_pipefy_id || undefined,
        solicitantePipefyId: item.solicitante_pipefy_id || undefined,
        mercadoriaNovaUsada: item.mercadoria_nova_usada || undefined,
        outrasNecessidadesPipefy: item.outras_necessidades_pipefy || undefined,
        necessidadeGR: Array.isArray(item.necessidade_gr) ? item.necessidade_gr : undefined,
        deletedAt: item.deleted_at || undefined
});

// Histórico: somente cotações ativas (não estão na lixeira).
export const getFreightCalculations = async (): Promise<FreightCalculation[]> => {
    const { data, error } = await supabase
        .from('freight_calculations')
        .select('*')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(500);

    if (error) {
        console.error('Error fetching freight calculations:', error);
        return [];
    }

    return (data || []).map(mapFreightRow);
};

// Lixeira: somente cotações que foram movidas para a lixeira (soft delete).
export const getDeletedFreightCalculations = async (): Promise<FreightCalculation[]> => {
    const { data, error } = await supabase
        .from('freight_calculations')
        .select('*')
        .not('deleted_at', 'is', null)
        .order('deleted_at', { ascending: false })
        .limit(500);

    if (error) {
        console.error('Error fetching deleted freight calculations:', error);
        return [];
    }

    return (data || []).map(mapFreightRow);
};

export const createFreightCalculation = async (calc: FreightCalculation): Promise<{ success: boolean; data?: FreightCalculation; error?: string }> => {
    const dbRecord = {
        id: calc.id,
        proposal_number: calc.proposalNumber,
        client_reference: calc.clientReference || null,
        origin: calc.origin,
        destination: calc.destination,
        destinations: calc.destinations || [],
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
        created_by: calc.createdBy || calc.updatedBy || null,
        created_by_name: calc.createdByName || calc.updatedByName || null,
        updated_by: calc.updatedBy || null,
        updated_by_name: calc.updatedByName || null,
        lost_reason: calc.lostReason || null,
        lost_obs: calc.lostObs || null,
        lost_file_url: calc.lostFileUrl || null,
        real_profit: calc.realProfit || 0,
        real_margin_percent: calc.realMarginPercent || 0,
        elaboration_seconds: calc.elaborationSeconds || 0,
        other_costs: calc.otherCosts || [],
        coleta_date: calc.coletaDate || null,
        entrega_date: calc.entregaDate || null,
        data_fechamento: calc.dataFechamento || null,
        cliente_nome_operacao: calc.clienteNomeOperacao || null,
        referencia_cliente_operacao: calc.referenciaClienteOperacao || null,
        solicitante: calc.solicitante || null,
        solicitante_pipefy_id: calc.solicitantePipefyId || null,
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
        destinations: calc.destinations || [],
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
        elaboration_seconds: sanitize(calc.elaborationSeconds) || 0,
        other_costs: calc.otherCosts || [],
        coleta_date: calc.coletaDate || null,
        entrega_date: calc.entregaDate || null,
        data_fechamento: calc.dataFechamento || null,
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
        placa_carreta_2_doc_url: calc.placaCarreta2DocUrl || null,
        pipefy_card_id: calc.pipefyCardId || null,
        pipefy_sent_at: calc.pipefySentAt || null,
        cliente_pipefy_id: calc.clientePipefyId || null,
        solicitante_pipefy_id: calc.solicitantePipefyId || null,
        mercadoria_nova_usada: calc.mercadoriaNovaUsada || null,
        outras_necessidades_pipefy: calc.outrasNecessidadesPipefy || null,
        necessidade_gr: (calc.necessidadeGR && calc.necessidadeGR.length) ? calc.necessidadeGR : null
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

// Mover para a lixeira (soft delete): marca deleted_at, NÃO apaga o registro.
export const deleteFreightCalculation = async (id: string): Promise<boolean> => {
    const { error } = await supabase
        .from('freight_calculations')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id);

    if (error) {
        console.error('Error moving freight calculation to trash:', error);
        return false;
    }
    return true;
};

// Restaurar da lixeira: limpa deleted_at, voltando a cotação para o Histórico.
export const restoreFreightCalculation = async (id: string): Promise<boolean> => {
    const { error } = await supabase
        .from('freight_calculations')
        .update({ deleted_at: null })
        .eq('id', id);

    if (error) {
        console.error('Error restoring freight calculation:', error);
        return false;
    }
    return true;
};

// Excluir definitivamente: remove o registro do banco (irreversível).
export const permanentlyDeleteFreightCalculation = async (id: string): Promise<boolean> => {
    const { error } = await supabase
        .from('freight_calculations')
        .delete()
        .eq('id', id);

    if (error) {
        console.error('Error permanently deleting freight calculation:', error);
        return false;
    }
    return true;
};

// Limpeza automática: apaga DEFINITIVAMENTE itens que foram para a lixeira
// antes do início do dia de hoje. A lixeira guarda apenas o que foi excluído
// hoje; o que sobrou de dias anteriores é purgado ao abrir o sistema.
// Retorna a quantidade de registros removidos.
export const purgeOldTrash = async (): Promise<number> => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
        .from('freight_calculations')
        .delete()
        .not('deleted_at', 'is', null)
        .lt('deleted_at', startOfToday.toISOString())
        .select('id');

    if (error) {
        console.error('Error purging old trash:', error);
        return 0;
    }
    return (data || []).length;
};

// =================== FATURAMENTO (TMS) — cache lido pelo painel ===================
export interface FaturamentoCache {
    total: number | null;
    ctes: number | null;
    status: string;       // 'ok' | 'erro'
    erro: string | null;
    atualizadoEm: string; // ISO timestamp
}

export const getFaturamentoCache = async (): Promise<FaturamentoCache | null> => {
    const { data, error } = await supabase
        .from('faturamento_cache')
        .select('*')
        .eq('id', 1)
        .maybeSingle();

    if (error || !data) {
        if (error) console.error('Error fetching faturamento_cache:', error);
        return null;
    }
    return {
        total: data.total !== null && data.total !== undefined ? Number(data.total) : null,
        ctes: data.ctes ?? null,
        status: data.status,
        erro: data.erro ?? null,
        atualizadoEm: data.atualizado_em,
    };
};

// Token do Painel TV — lido só por usuário logado (RLS authenticated). Usado
// pra montar o link do menu sem expor o token no bundle público.
export const getPainelTvToken = async (): Promise<string | null> => {
    const { data, error } = await supabase
        .from('painel_tv_config')
        .select('token')
        .eq('id', 1)
        .maybeSingle();

    if (error || !data) return null;
    return data.token;
};

// =================== MINI CRM (Prospecção) ===================
import { CrmEmpresa, CrmContato, CrmEvento, chaveGrupo, computeLastTouch, canonizeEtapa, canonizeStatus, etapaMaisAvancada, parseDataBR } from './crm';

const mapContato = (r: any): CrmContato => ({
    id: r.id, empresaId: r.empresa_id, nome: r.nome || '', cargo: r.cargo || '',
    email: r.email || '', telefone: r.telefone || '', canal: r.canal || '',
    origem: r.origem === 'Optus' ? 'Optus' : 'Omnicargo', status: r.status || 'Novo',
    data: r.data || null, codigo: r.codigo || '', evidencia: r.evidencia || '',
    printRef: r.print_ref || '', resumoUltimo: r.resumo_ultimo || '',
});

// Carrega empresas (não deletadas) com seus contatos (não deletados).
export const getCrmEmpresas = async (): Promise<CrmEmpresa[]> => {
    const [{ data: emps, error: e1 }, { data: cts, error: e2 }] = await Promise.all([
        supabase.from('crm_empresa').select('*').is('deleted_at', null).order('atualizado_em', { ascending: false }).limit(2000),
        supabase.from('crm_contato').select('*').is('deleted_at', null).limit(10000),
    ]);
    if (e1 || e2) { console.error('Erro getCrmEmpresas:', e1 || e2); return []; }
    const porEmpresa = new Map<string, CrmContato[]>();
    (cts || []).forEach((r: any) => {
        const arr = porEmpresa.get(r.empresa_id) || [];
        arr.push(mapContato(r)); porEmpresa.set(r.empresa_id, arr);
    });
    return (emps || []).map((r: any): CrmEmpresa => ({
        id: r.id, nome: r.nome, chaveGrupo: r.chave_grupo, etapa: r.etapa,
        proximoPasso: r.proximo_passo || '', responsavel: r.responsavel || '', resumo: r.resumo || '',
        lastTouch: r.last_touch || null, contatos: porEmpresa.get(r.id) || [],
        criadoEm: r.criado_em, atualizadoEm: r.atualizado_em,
    }));
};

export const getCrmEventos = async (empresaId: string): Promise<CrmEvento[]> => {
    const { data, error } = await supabase.from('crm_evento').select('*').eq('empresa_id', empresaId).order('data', { ascending: false });
    if (error || !data) return [];
    return data.map((r: any): CrmEvento => ({ id: r.id, empresaId: r.empresa_id, tipo: r.tipo, data: r.data, autorNome: r.autor_nome || '', texto: r.texto || '', link: r.link || '' }));
};

export const addCrmEvento = async (empresaId: string, tipo: string, texto: string, link: string | null, autor?: { id?: string; nome?: string }): Promise<void> => {
    await supabase.from('crm_evento').insert([{ empresa_id: empresaId, tipo, texto, link: link || null, autor: autor?.id || null, autor_nome: autor?.nome || null }]);
};

export const createCrmEmpresa = async (e: { nome: string; etapa: string; responsavel?: string; proximoPasso?: string }, autor?: { id?: string; nome?: string }): Promise<string | null> => {
    const { data, error } = await supabase.from('crm_empresa').insert([{
        nome: e.nome, chave_grupo: chaveGrupo(e.nome), etapa: e.etapa,
        responsavel: e.responsavel || null, proximo_passo: e.proximoPasso || null,
    }]).select('id').single();
    if (error || !data) { console.error('Erro createCrmEmpresa:', error); return null; }
    await addCrmEvento(data.id, 'nota', `Empresa criada na etapa ${e.etapa}.`, null, autor);
    return data.id;
};

export const updateCrmEmpresa = async (id: string, patch: Partial<{ nome: string; etapa: string; responsavel: string; proximoPasso: string; resumo: string }>): Promise<boolean> => {
    const dbPatch: Record<string, unknown> = { atualizado_em: new Date().toISOString() };
    if (patch.nome !== undefined) { dbPatch.nome = patch.nome; dbPatch.chave_grupo = chaveGrupo(patch.nome); }
    if (patch.etapa !== undefined) dbPatch.etapa = patch.etapa;
    if (patch.responsavel !== undefined) dbPatch.responsavel = patch.responsavel;
    if (patch.proximoPasso !== undefined) dbPatch.proximo_passo = patch.proximoPasso;
    if (patch.resumo !== undefined) dbPatch.resumo = patch.resumo;
    const { error } = await supabase.from('crm_empresa').update(dbPatch).eq('id', id);
    if (error) { console.error('Erro updateCrmEmpresa:', error); return false; }
    return true;
};

// Move a empresa de etapa: grava evento de movimentação e atualiza.
export const moveCrmEmpresaEtapa = async (id: string, de: string, para: string, autor?: { id?: string; nome?: string }): Promise<boolean> => {
    const ok = await updateCrmEmpresa(id, { etapa: para });
    if (ok) await addCrmEvento(id, 'movimentacao', `Etapa: ${de} → ${para}`, null, autor);
    return ok;
};

// Recalcula o last_touch da empresa a partir das datas dos contatos (regra 5.5).
const recomputeLastTouch = async (empresaId: string): Promise<void> => {
    const { data } = await supabase.from('crm_contato').select('data').eq('empresa_id', empresaId).is('deleted_at', null);
    const last = computeLastTouch((data || []).map((r: any) => ({ data: r.data } as CrmContato)));
    await supabase.from('crm_empresa').update({ last_touch: last, atualizado_em: new Date().toISOString() }).eq('id', empresaId);
};

const contatoToDb = (c: Partial<CrmContato>) => ({
    nome: c.nome || null, cargo: c.cargo || null, email: c.email || null, telefone: c.telefone || null,
    canal: c.canal || null, origem: c.origem === 'Optus' ? 'Optus' : 'Omnicargo', status: c.status || 'Novo',
    data: c.data || null, codigo: c.codigo || null, evidencia: c.evidencia || null,
    print_ref: c.printRef || null, resumo_ultimo: c.resumoUltimo || null,
});

export const createCrmContato = async (empresaId: string, c: Partial<CrmContato>, autor?: { id?: string; nome?: string }): Promise<boolean> => {
    const { error } = await supabase.from('crm_contato').insert([{ empresa_id: empresaId, ...contatoToDb(c) }]);
    if (error) { console.error('Erro createCrmContato:', error); return false; }
    await recomputeLastTouch(empresaId);
    await addCrmEvento(empresaId, 'contato', `Contato ${c.nome || ''} (${c.status || 'Novo'})${c.data ? ' em ' + c.data : ''}`.trim(), c.evidencia || null, autor);
    return true;
};

export const updateCrmContato = async (id: string, empresaId: string, c: Partial<CrmContato>): Promise<boolean> => {
    const { error } = await supabase.from('crm_contato').update({ ...contatoToDb(c), atualizado_em: new Date().toISOString() }).eq('id', id);
    if (error) { console.error('Erro updateCrmContato:', error); return false; }
    await recomputeLastTouch(empresaId);
    return true;
};

// Importação CSV (seção 9): merge por chave de dedupe; empresa nova na etapa
// mais avançada das suas linhas; bloqueia contato duplicado (mesmo e-mail OU
// mesmo nome na mesma empresa); bulk insert por empresa. Nada é apagado.
export interface ImportResumo { empresasNovas: number; contatosAdicionados: number; ignoradas: number; }

export const importCrmCsv = async (rows: string[][], autor?: { id?: string; nome?: string }): Promise<ImportResumo> => {
    const dados = rows.slice(1).map(r => ({
        empresa: (r[0] || '').trim(), contato: (r[1] || '').trim(), cargo: (r[2] || '').trim(), email: (r[3] || '').trim(),
        telefone: (r[4] || '').trim(), origem: (r[5] || '').trim(), etapa: (r[6] || '').trim(), status: (r[7] || '').trim(),
        data: (r[8] || '').trim(), evidencia: (r[9] || '').trim(), proximoPasso: (r[10] || '').trim(),
    })).filter(d => d.empresa);

    const grupos = new Map<string, typeof dados>();
    for (const d of dados) { const k = chaveGrupo(d.empresa); const a = grupos.get(k) || []; a.push(d); grupos.set(k, a); }

    const existentes = await getCrmEmpresas();
    const porChave = new Map(existentes.map(e => [e.chaveGrupo, e]));
    let empresasNovas = 0, contatosAdicionados = 0, ignoradas = 0;

    for (const [chave, linhas] of grupos) {
        let empresaId: string;
        const emails = new Set<string>(), nomes = new Set<string>();
        const existente = porChave.get(chave);
        if (existente) {
            empresaId = existente.id;
            existente.contatos.forEach(c => { if (c.email) emails.add(c.email.toLowerCase()); if (c.nome) nomes.add(c.nome.toLowerCase()); });
        } else {
            const etapa = etapaMaisAvancada(linhas.map(l => canonizeEtapa(l.etapa)));
            const id = await createCrmEmpresa({ nome: linhas[0].empresa, etapa, proximoPasso: linhas.find(l => l.proximoPasso)?.proximoPasso || '' }, autor);
            if (!id) { ignoradas += linhas.length; continue; }
            await addCrmEvento(id, 'nota', 'Importada via planilha.', null, autor);
            empresaId = id; empresasNovas++;
        }

        const novos: any[] = [];
        for (const l of linhas) {
            const em = l.email.toLowerCase(), nm = l.contato.toLowerCase();
            if ((em && emails.has(em)) || (nm && nomes.has(nm))) { ignoradas++; continue; }
            novos.push({
                empresa_id: empresaId, ...contatoToDb({
                    nome: l.contato, cargo: l.cargo, email: l.email, telefone: l.telefone,
                    origem: l.origem.toLowerCase() === 'optus' ? 'Optus' : 'Omnicargo',
                    status: canonizeStatus(l.status), data: parseDataBR(l.data) || undefined, evidencia: l.evidencia,
                }),
            });
            if (em) emails.add(em); if (nm) nomes.add(nm);
        }
        if (novos.length) {
            const { error } = await supabase.from('crm_contato').insert(novos);
            if (error) { console.error('Erro import contatos:', error); ignoradas += novos.length; }
            else { contatosAdicionados += novos.length; await recomputeLastTouch(empresaId); }
        }
    }
    return { empresasNovas, contatosAdicionados, ignoradas };
};
