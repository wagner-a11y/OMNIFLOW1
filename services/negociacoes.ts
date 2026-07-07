// Acompanhamento de Negociações — camada de dados (Camada 1).
// Módulo isolado. A RLS no banco garante: todos leem todas; dono+master editam.
// Aqui só I/O + os helpers de DIA ÚTIL (o time não trabalha fim de semana).
import { supabase } from './supabase';

export interface Negociacao {
    id: string;
    cotacaoId: string;
    propostaNumero: string | null;
    clienteNome: string | null;
    rota: string | null;
    mercadoria: string | null;
    veiculo: string | null;
    valorCotado: number | null;
    donoId: string;
    donoNome: string | null;
    ramperOpportunityId: string | null;
    abertaEm: string;
    status: 'aberta' | 'ganha' | 'perdida';
    proximoContato: string;              // 'YYYY-MM-DD'
    fechadaEm: string | null;
    fechadaMotivo: string | null;
    fechadaOrigem: string | null;
}

export interface Followup {
    id: string;
    negociacaoId: string;
    autorId: string;
    autorNome: string | null;
    dataHora: string;
    descricao: string;
    proximoContato: string | null;
}

// =================== Helpers de DIA ÚTIL (seg–sex; feriados fora do escopo da C1) ===================
const isWeekend = (d: Date) => { const g = d.getDay(); return g === 0 || g === 6; };
const atMidnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

// Soma N dias ÚTEIS (pula sáb/dom). Ex.: sexta + 1 útil = segunda.
export const addBusinessDays = (from: Date, n: number): Date => {
    const d = atMidnight(from);
    let added = 0;
    while (added < n) { d.setDate(d.getDate() + 1); if (!isWeekend(d)) added++; }
    return d;
};

// Conta dias ÚTEIS em (a, b] — exclui a, inclui b. 0 se b <= a. (Fri→Mon = 1; Fri→Sat = 0.)
export const businessDaysBetween = (a: Date, b: Date): number => {
    const start = atMidnight(a), end = atMidnight(b);
    if (end <= start) return 0;
    let count = 0; const d = new Date(start);
    while (d < end) { d.setDate(d.getDate() + 1); if (!isWeekend(d)) count++; }
    return count;
};

export const toYMD = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const parseYMD = (s: string) => { const [y, m, dd] = (s || '').split('-').map(Number); return new Date(y || 1970, (m || 1) - 1, dd || 1); };

export type Grupo = 'atrasada' | 'hoje' | 'futura';

// Classifica o "próximo contato" com lógica de dia útil: fim de semana NÃO conta como atraso.
// Só é 'atrasada' quando já passou >= 1 dia ÚTIL do próximo contato (Fri no sábado ainda é 'hoje';
// no dia útil seguinte vira 'atrasada').
export const classifyProximo = (proximoYMD: string, now: Date = new Date()): Grupo => {
    const prox = parseYMD(proximoYMD);
    const today = atMidnight(now);
    if (prox > today) return 'futura';
    if (prox.getTime() === today.getTime()) return 'hoje';
    return businessDaysBetween(prox, today) >= 1 ? 'atrasada' : 'hoje';
};

// A data inicial do próximo contato ao abrir a negociação: +1 dia útil.
export const proximoContatoInicial = (now: Date = new Date()): string => toYMD(addBusinessDays(now, 1));

// Dias corridos em aberto (p/ "aberta há X dias").
export const diasEmAberto = (abertaEmISO: string, now: Date = new Date()): number => {
    const ini = atMidnight(new Date(abertaEmISO));
    return Math.max(0, Math.round((atMidnight(now).getTime() - ini.getTime()) / 86400000));
};

// =================== Mapeamento ===================
const mapNeg = (r: any): Negociacao => ({
    id: r.id, cotacaoId: r.cotacao_id, propostaNumero: r.proposta_numero || null,
    clienteNome: r.cliente_nome || null, rota: r.rota || null, mercadoria: r.mercadoria || null,
    veiculo: r.veiculo || null, valorCotado: r.valor_cotado != null ? Number(r.valor_cotado) : null,
    donoId: r.dono_id, donoNome: r.dono_nome || null, ramperOpportunityId: r.ramper_opportunity_id || null,
    abertaEm: r.aberta_em, status: r.status, proximoContato: r.proximo_contato,
    fechadaEm: r.fechada_em || null, fechadaMotivo: r.fechada_motivo || null, fechadaOrigem: r.fechada_origem || null,
});
const mapFu = (r: any): Followup => ({
    id: r.id, negociacaoId: r.negociacao_id, autorId: r.autor_id, autorNome: r.autor_nome || null,
    dataHora: r.data_hora, descricao: r.descricao, proximoContato: r.proximo_contato || null,
});

// =================== Entrada automática (chamada no sucesso do "Mandar pro Ramper") ===================
export interface NovaNegociacao {
    cotacaoId: string; propostaNumero?: string | null; clienteNome?: string | null; rota?: string | null;
    mercadoria?: string | null; veiculo?: string | null; valorCotado?: number | null; ramperOpportunityId?: string | null;
}
// Cria a negociação ABERTA com dono = quem mandou pro Ramper e próximo contato = +1 dia útil.
// Idempotente na prática: se já existe negociação aberta pra essa cotação, o índice único barra
// (código 23505) e a gente ignora sem erro. NUNCA lança — não pode atrapalhar o envio ao Ramper.
export const createNegociacaoFromRamper = async (n: NovaNegociacao, donoId: string, donoNome: string): Promise<boolean> => {
    if (!n.cotacaoId || !donoId) return false;
    try {
        const { error } = await supabase.from('neg_negociacao').insert([{
            cotacao_id: n.cotacaoId, proposta_numero: n.propostaNumero || null, cliente_nome: n.clienteNome || null,
            rota: n.rota || null, mercadoria: n.mercadoria || null, veiculo: n.veiculo || null,
            valor_cotado: n.valorCotado ?? null, dono_id: donoId, dono_nome: donoNome || null,
            ramper_opportunity_id: n.ramperOpportunityId || null, proximo_contato: proximoContatoInicial(),
        }]);
        if (error) {
            if ((error as any).code === '23505') return false; // já havia uma negociação aberta pra essa cotação
            console.error('createNegociacaoFromRamper:', error);
            return false;
        }
        return true;
    } catch (e) {
        console.error('createNegociacaoFromRamper (exception):', e);
        return false;
    }
};

// =================== Leitura ===================
export const getNegociacoes = async (): Promise<Negociacao[]> => {
    const { data, error } = await supabase.from('neg_negociacao').select('*').order('proximo_contato', { ascending: true }).limit(1000);
    if (error || !data) { if (error) console.error('getNegociacoes:', error); return []; }
    return (data as any[]).map(mapNeg);
};

export const getFollowups = async (negociacaoId: string): Promise<Followup[]> => {
    const { data, error } = await supabase.from('neg_followup').select('*').eq('negociacao_id', negociacaoId).order('data_hora', { ascending: false });
    if (error || !data) { if (error) console.error('getFollowups:', error); return []; }
    return (data as any[]).map(mapFu);
};

// Último follow-up de cada negociação (p/ exibir "último follow-up" na lista, sem N queries).
export const getUltimosFollowups = async (negIds: string[]): Promise<Map<string, Followup>> => {
    const out = new Map<string, Followup>();
    if (!negIds.length) return out;
    const { data, error } = await supabase.from('neg_followup').select('*').in('negociacao_id', negIds).order('data_hora', { ascending: false });
    if (error || !data) { if (error) console.error('getUltimosFollowups:', error); return out; }
    for (const r of data as any[]) { if (!out.has(r.negociacao_id)) out.set(r.negociacao_id, mapFu(r)); }
    return out;
};

// =================== Escrita (RLS: só dono/master) ===================
// Registra um follow-up e reagenda o próximo contato da negociação.
export const registrarFollowup = async (
    negociacaoId: string, descricao: string, proximoContatoYMD: string, autorId: string, autorNome: string
): Promise<boolean> => {
    const { error: e1 } = await supabase.from('neg_followup').insert([{
        negociacao_id: negociacaoId, autor_id: autorId, autor_nome: autorNome || null,
        descricao, proximo_contato: proximoContatoYMD || null,
    }]);
    if (e1) { console.error('registrarFollowup (followup):', e1); return false; }
    if (proximoContatoYMD) {
        const { error: e2 } = await supabase.from('neg_negociacao')
            .update({ proximo_contato: proximoContatoYMD, atualizado_em: new Date().toISOString() })
            .eq('id', negociacaoId);
        if (e2) { console.error('registrarFollowup (reagenda):', e2); return false; }
    }
    return true;
};

// Encerra a negociação na mão (ganha/perdida).
export const encerrarNegociacao = async (
    negociacaoId: string, status: 'ganha' | 'perdida', motivo?: string
): Promise<boolean> => {
    const { error } = await supabase.from('neg_negociacao').update({
        status, fechada_em: new Date().toISOString(), fechada_motivo: motivo || null,
        fechada_origem: 'manual', atualizado_em: new Date().toISOString(),
    }).eq('id', negociacaoId);
    if (error) { console.error('encerrarNegociacao:', error); return false; }
    return true;
};

// =================== Espelho local (fechamento automático a partir do OmniFlow) ===================
// Lê o status da cotação de origem (freight_calculations) das negociações ABERTAS. Se a cotação
// virou operação/ganha (won/em_operacao) ou perdida (lost), a negociação sai da lista:
//  - persiste o fechamento (best-effort; a RLS só deixa dono/master gravar — espectador não grava);
//  - devolve o mapa cotacaoId->status resolvido p/ a tela refletir na hora, mesmo sem gravar.
export interface EspelhoResultado { fechadas: Map<string, 'ganha' | 'perdida'>; }
export const reconciliarEspelhoLocal = async (abertas: Negociacao[]): Promise<EspelhoResultado> => {
    const fechadas = new Map<string, 'ganha' | 'perdida'>();
    const ids = Array.from(new Set(abertas.map(n => n.cotacaoId).filter(Boolean)));
    if (!ids.length) return { fechadas };
    const { data, error } = await supabase.from('freight_calculations').select('id, status').in('id', ids);
    if (error || !data) { if (error) console.error('reconciliarEspelhoLocal:', error); return { fechadas }; }

    const statusPorCotacao = new Map<string, string>();
    for (const r of data as any[]) statusPorCotacao.set(r.id, r.status);

    const mapear = (s: string | undefined): 'ganha' | 'perdida' | null =>
        (s === 'won' || s === 'em_operacao') ? 'ganha' : (s === 'lost' ? 'perdida' : null);

    for (const neg of abertas) {
        const novo = mapear(statusPorCotacao.get(neg.cotacaoId));
        if (!novo) continue;
        fechadas.set(neg.id, novo);
        // Persiste (best-effort): dono/master gravam; espectador só reflete na tela.
        await supabase.from('neg_negociacao').update({
            status: novo, fechada_em: new Date().toISOString(),
            fechada_motivo: novo === 'ganha' ? 'Cotação marcada como ganha no OmniFlow' : 'Cotação marcada como perdida no OmniFlow',
            fechada_origem: 'espelho_omniflow', atualizado_em: new Date().toISOString(),
        }).eq('id', neg.id).eq('status', 'aberta');
    }
    return { fechadas };
};
