import { supabase } from './supabase';

// ============================================================================
// Chave de emergência do Qualp.
//
// Estado global em emergencia_config (uma linha só). A trava é de SERVIDOR: a
// policy de UPDATE exige public.is_master(), então quem não é master é barrado
// mesmo chamando a API direto, sem passar pela tela. Esconder o botão é
// conveniência; a RLS é a barreira.
//
// Todo ligar/desligar entra em emergencia_log, que é imutável (sem policy de
// UPDATE/DELETE e com trigger que barra até o postgres).
// ============================================================================

export interface EstadoEmergencia {
    ligada: boolean;
    alteradoPorNome: string | null;
    alteradoEm: string | null;
}

const DESLIGADA: EstadoEmergencia = { ligada: false, alteradoPorNome: null, alteradoEm: null };

/**
 * Lê o estado atual. Falha de leitura devolve DESLIGADA de propósito: se não dá
 * para confirmar que a emergência está ligada, o sistema segue no modo normal
 * (Qualp bloqueante) — o rigoroso, não o permissivo.
 */
export async function lerEmergencia(): Promise<EstadoEmergencia> {
    try {
        const { data, error } = await supabase
            .from('emergencia_config')
            .select('ligada, alterado_por_nome, alterado_em')
            .eq('id', true)
            .maybeSingle();
        if (error || !data) return DESLIGADA;
        return {
            ligada: !!data.ligada,
            alteradoPorNome: data.alterado_por_nome ?? null,
            alteradoEm: data.alterado_em ?? null,
        };
    } catch {
        return DESLIGADA;
    }
}

/**
 * Liga ou desliga. Só master passa — quem não for recebe 0 linhas afetadas pela
 * RLS, e isso é reportado como recusa, não como sucesso silencioso.
 * O registro no ledger é best-effort: já mudou o estado, não desfaz por causa
 * do log; mas devolve o aviso para a tela poder falar a verdade.
 */
export async function definirEmergencia(
    ligada: boolean,
    autor: { id?: string; name?: string },
): Promise<{ ok: boolean; erro?: string; avisoLog?: string }> {
    if (!autor.id) return { ok: false, erro: 'Sessão sem usuário identificado.' };

    const { data, error } = await supabase
        .from('emergencia_config')
        .update({
            ligada,
            alterado_por: autor.id,
            alterado_por_nome: autor.name ?? null,
            alterado_em: new Date().toISOString(),
        })
        .eq('id', true)
        .select('ligada');

    if (error) return { ok: false, erro: error.message };
    // 0 linhas = a RLS barrou (não é master). Nunca tratar como sucesso.
    if (!data || data.length === 0) {
        return { ok: false, erro: 'Só o master pode acionar a chave de emergência.' };
    }

    let avisoLog: string | undefined;
    try {
        const { error: erroLog } = await supabase.from('emergencia_log').insert([{
            acao: ligada ? 'ligou' : 'desligou',
            autor_id: autor.id,
            autor_nome: autor.name ?? null,
        }]);
        if (erroLog) avisoLog = 'Estado alterado, mas o registro de auditoria falhou.';
    } catch {
        avisoLog = 'Estado alterado, mas o registro de auditoria falhou.';
    }

    return { ok: true, avisoLog };
}

export interface EventoEmergencia {
    id: string;
    acao: 'ligou' | 'desligou';
    autorNome: string | null;
    criadoEm: string;
}

/** Histórico de acionamentos (só master lê — a RLS devolve vazio para os demais). */
export async function lerHistoricoEmergencia(limite = 50): Promise<EventoEmergencia[]> {
    try {
        const { data, error } = await supabase
            .from('emergencia_log')
            .select('id, acao, autor_nome, criado_em')
            .order('criado_em', { ascending: false })
            .limit(limite);
        if (error || !data) return [];
        return data.map((r: { id: string; acao: string; autor_nome: string | null; criado_em: string }) => ({
            id: r.id,
            acao: r.acao === 'ligou' ? 'ligou' : 'desligou',
            autorNome: r.autor_nome,
            criadoEm: r.criado_em,
        }));
    } catch {
        return [];
    }
}
