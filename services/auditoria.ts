// Auditoria de alterações de cotação (Parte C). Captura no app, só em EDIÇÃO.
// Ledger imutável no banco (cotacao_alteracao): RLS só master lê; trigger barra update/delete.
import { supabase } from './supabase';
import { FreightCalculation } from '../types';

export interface Mudanca { campo: string; label: string; de: unknown; para: unknown; }
export interface AlteracaoCotacao {
    id: string; cotacaoId: string; propostaNumero: string | null;
    alteradoPor: string; alteradoPorNome: string | null; alteradoEm: string;
    statusNoMomento: string | null; mudancas: Mudanca[];
}

const STATUS_LABEL: Record<string, string> = { pending: 'Pauta', won: 'Ganha', lost: 'Perdida', em_operacao: 'Em operação', respondida: 'Respondida', aprovada: 'Aprovada', spot_simulated: 'Spot' };
const rota = (q: FreightCalculation) => `${q.origin || '—'} → ${q.destination || '—'}`;
const totalCustos = (q: FreightCalculation) => (q.extraCosts || 0) + (q.otherCosts || []).reduce((s, c) => s + (c.value || 0), 0);
// Compara números tolerando 2 casas (evita ruído de ponto flutuante).
const difN = (a: number, b: number) => Math.round((a || 0) * 100) !== Math.round((b || 0) * 100);
const difS = (a: unknown, b: unknown) => String(a ?? '').trim() !== String(b ?? '').trim();

// Diff dos 14 campos auditados (business). PURO. clienteAntes/Depois já resolvidos (nome).
export function buildQuoteChanges(
    before: FreightCalculation, after: FreightCalculation,
    clienteAntes: string, clienteDepois: string,
): Mudanca[] {
    const m: Mudanca[] = [];
    const add = (campo: string, label: string, de: unknown, para: unknown) => m.push({ campo, label, de, para });

    if (difS(before.status, after.status)) add('status', 'Status', STATUS_LABEL[before.status] || before.status, STATUS_LABEL[after.status] || after.status);
    if (difN(before.totalFreight, after.totalFreight)) add('totalFreight', 'Valor do frete', before.totalFreight, after.totalFreight);
    if (difN(before.baseFreight, after.baseFreight)) add('baseFreight', 'Preço base', before.baseFreight, after.baseFreight);
    if (difN(before.profitMargin, after.profitMargin)) add('profitMargin', 'Margem (%)', before.profitMargin, after.profitMargin);
    if (difN(before.icmsPercent, after.icmsPercent)) add('icmsPercent', 'ICMS (%)', before.icmsPercent, after.icmsPercent);
    if ((before.icmsManual ?? false) !== (after.icmsManual ?? false)) add('icmsManual', 'ICMS manual', before.icmsManual ? 'sim' : 'não', after.icmsManual ? 'sim' : 'não');
    if (difS(before.origin, after.origin) || difS(before.destination, after.destination)) add('rota', 'Rota', rota(before), rota(after));
    if (difS(before.customerId, after.customerId)) add('customerId', 'Cliente', clienteAntes, clienteDepois);
    if (difS(before.vehicleType, after.vehicleType)) add('vehicleType', 'Veículo', before.vehicleType, after.vehicleType);
    if (difN(before.goodsValue, after.goodsValue)) add('goodsValue', 'Valor da carga', before.goodsValue, after.goodsValue);
    if (difN(before.tolls, after.tolls)) add('tolls', 'Pedágio', before.tolls, after.tolls);
    if (difN(totalCustos(before), totalCustos(after))) add('custosAdicionais', 'Custos adicionais', totalCustos(before), totalCustos(after));
    if (difN(before.insurancePercent, after.insurancePercent)) add('insurancePercent', 'Ad valorem (%)', before.insurancePercent, after.insurancePercent);
    if (difS(before.solicitante, after.solicitante)) add('solicitante', 'Solicitante', before.solicitante || '—', after.solicitante || '—');
    if (difS(before.clientReference, after.clientReference)) add('clientReference', 'Ref/Documento', before.clientReference || '—', after.clientReference || '—');
    return m;
}

// Grava a alteração (só quando houve mudança). alteradoPor DEVE ser o auth.uid() (RLS exige).
// Best-effort: nunca derruba o salvar da cotação.
export async function registrarAlteracao(
    quote: FreightCalculation, mudancas: Mudanca[],
    actor: { id?: string; name?: string },
): Promise<void> {
    if (!mudancas.length || !actor.id) return;
    try {
        const { error } = await supabase.from('cotacao_alteracao').insert([{
            cotacao_id: quote.id, proposta_numero: quote.proposalNumber || null,
            alterado_por: actor.id, alterado_por_nome: actor.name || null,
            status_no_momento: quote.status, mudancas,
        }]);
        if (error) console.warn('registrarAlteracao:', error.message);
    } catch (e) {
        console.warn('registrarAlteracao (exception):', (e as Error).message);
    }
}

// Lê o histórico de alterações de uma cotação (RLS: só master recebe dados).
export async function getAlteracoes(cotacaoId: string): Promise<AlteracaoCotacao[]> {
    const { data, error } = await supabase
        .from('cotacao_alteracao')
        .select('*')
        .eq('cotacao_id', cotacaoId)
        .order('alterado_em', { ascending: false });
    if (error || !data) { if (error) console.warn('getAlteracoes:', error.message); return []; }
    return (data as any[]).map(r => ({
        id: r.id, cotacaoId: r.cotacao_id, propostaNumero: r.proposta_numero,
        alteradoPor: r.alterado_por, alteradoPorNome: r.alterado_por_nome, alteradoEm: r.alterado_em,
        statusNoMomento: r.status_no_momento, mudancas: Array.isArray(r.mudancas) ? r.mudancas : [],
    }));
}
