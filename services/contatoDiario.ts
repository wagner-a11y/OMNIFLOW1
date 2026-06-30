// Controle de Contato Diário — camada de dados (Camada 1: carteira).
// Módulo isolado. RLS no banco garante a separação master/operador; aqui só I/O.
import { supabase } from './supabase';

export interface SolicitanteCotacao { nome: string; pipefyId: string | null; cotacoes: number; }
export interface CdSolicitante { id: string; nomeCanonico: string; pipefyId: string | null; aliases: string[]; }
export interface Analista { id: string; nome: string; email: string; }
export interface CdAtribuicao { id: string; solicitanteId: string; analistaId: string; }

// Fonte canônica dos solicitantes: o que já vive nas cotações do Flow (não Pipefy).
// Retorna as variações cruas (como foram grafadas), com contagem de cotações.
export const getSolicitantesCotacao = async (): Promise<SolicitanteCotacao[]> => {
    const { data, error } = await supabase
        .from('freight_calculations')
        .select('solicitante, solicitante_pipefy_id')
        .not('solicitante', 'is', null)
        .limit(5000);
    if (error || !data) { if (error) console.error('getSolicitantesCotacao:', error); return []; }
    const map = new Map<string, SolicitanteCotacao>();
    for (const r of data as any[]) {
        const nome = (r.solicitante || '').trim();
        if (!nome) continue;
        const cur = map.get(nome) || { nome, pipefyId: r.solicitante_pipefy_id || null, cotacoes: 0 };
        cur.cotacoes++;
        if (!cur.pipefyId && r.solicitante_pipefy_id) cur.pipefyId = r.solicitante_pipefy_id;
        map.set(nome, cur);
    }
    return Array.from(map.values()).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
};

const mapSol = (r: any): CdSolicitante => ({ id: r.id, nomeCanonico: r.nome_canonico, pipefyId: r.solicitante_pipefy_id || null, aliases: Array.isArray(r.aliases) ? r.aliases : [] });

export const getCdSolicitantes = async (): Promise<CdSolicitante[]> => {
    const { data, error } = await supabase.from('cd_solicitante').select('*').is('deleted_at', null).order('nome_canonico');
    if (error || !data) { if (error) console.error('getCdSolicitantes:', error); return []; }
    return data.map(mapSol);
};

export const createCdSolicitante = async (s: { nomeCanonico: string; pipefyId?: string | null; aliases: string[] }, autorId?: string): Promise<boolean> => {
    const { error } = await supabase.from('cd_solicitante').insert([{ nome_canonico: s.nomeCanonico, solicitante_pipefy_id: s.pipefyId || null, aliases: s.aliases, criado_por: autorId || null }]);
    if (error) { console.error('createCdSolicitante:', error); return false; }
    return true;
};

export const updateCdSolicitante = async (id: string, patch: { nomeCanonico?: string; pipefyId?: string | null; aliases?: string[] }): Promise<boolean> => {
    const db: Record<string, unknown> = { atualizado_em: new Date().toISOString() };
    if (patch.nomeCanonico !== undefined) db.nome_canonico = patch.nomeCanonico;
    if (patch.pipefyId !== undefined) db.solicitante_pipefy_id = patch.pipefyId || null;
    if (patch.aliases !== undefined) db.aliases = patch.aliases;
    const { error } = await supabase.from('cd_solicitante').update(db).eq('id', id);
    if (error) { console.error('updateCdSolicitante:', error); return false; }
    return true;
};

export const deleteCdSolicitante = async (id: string): Promise<boolean> => {
    const { error } = await supabase.from('cd_solicitante').update({ deleted_at: new Date().toISOString() }).eq('id', id);
    if (error) { console.error('deleteCdSolicitante:', error); return false; }
    return true;
};

export const getAnalistas = async (): Promise<Analista[]> => {
    const { data, error } = await supabase.from('profiles').select('id, name, email, role, active').eq('role', 'operador');
    if (error || !data) { if (error) console.error('getAnalistas:', error); return []; }
    return (data as any[]).filter(p => p.active !== false).map(p => ({ id: p.id, nome: p.name || p.email || 'Analista', email: p.email || '' }));
};

export const getCdAtribuicoes = async (): Promise<CdAtribuicao[]> => {
    const { data, error } = await supabase.from('cd_atribuicao').select('id, solicitante_id, analista_id').is('deleted_at', null);
    if (error || !data) { if (error) console.error('getCdAtribuicoes:', error); return []; }
    return (data as any[]).map(r => ({ id: r.id, solicitanteId: r.solicitante_id, analistaId: r.analista_id }));
};

// Atribui (ou reatribui) um solicitante a um analista. Mantém 1 ativa por solicitante.
export const setCdAtribuicao = async (solicitanteId: string, analistaId: string, autorId?: string): Promise<boolean> => {
    await supabase.from('cd_atribuicao').update({ deleted_at: new Date().toISOString() }).eq('solicitante_id', solicitanteId).is('deleted_at', null);
    const { error } = await supabase.from('cd_atribuicao').insert([{ solicitante_id: solicitanteId, analista_id: analistaId, criado_por: autorId || null }]);
    if (error) { console.error('setCdAtribuicao:', error); return false; }
    return true;
};

export const removeCdAtribuicao = async (id: string): Promise<boolean> => {
    const { error } = await supabase.from('cd_atribuicao').update({ deleted_at: new Date().toISOString() }).eq('id', id);
    if (error) { console.error('removeCdAtribuicao:', error); return false; }
    return true;
};

// =================== Camada 2: registro de contato + evidência ===================
const BUCKET = 'cd-evidencias';
export const CD_TIPOS = [
    { v: 'whatsapp', l: 'WhatsApp' }, { v: 'ligacao', l: 'Ligação' }, { v: 'email', l: 'E-mail' },
    { v: 'visita', l: 'Visita' }, { v: 'reuniao', l: 'Reunião' },
];
export const CD_RESULTADOS = [
    { v: 'sem_demanda', l: 'Sem demanda hoje' }, { v: 'cotar_depois', l: 'Vai cotar depois' },
    { v: 'negociacao', l: 'Em negociação' }, { v: 'sem_resposta', l: 'Sem resposta' }, { v: 'outro', l: 'Outro' },
];
export interface CdContato { id: string; solicitanteId: string; analistaId: string; dataHora: string; tipo: string; resultado: string; observacao: string; evidenciaPath: string; }

// A carteira do analista logado (RLS já devolve só os solicitantes dele).
export const getMinhaCarteira = getCdSolicitantes;

// Sobe o arquivo de evidência pro bucket PRIVADO, na pasta do próprio analista.
export const uploadEvidencia = async (file: File, analistaId: string): Promise<string | null> => {
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
    const path = `${analistaId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
    if (error) { console.error('uploadEvidencia:', error); return null; }
    return path;
};

// Registra o contato. Exige evidenciaPath (a tela só chama isto após o upload);
// o banco ainda barra por NOT NULL + RLS se vier sem prova ou fora da carteira.
export const createCdContato = async (c: { solicitanteId: string; tipo: string; resultado: string; observacao?: string; evidenciaPath: string }, analistaId: string): Promise<boolean> => {
    if (!c.evidenciaPath) return false;
    const { error } = await supabase.from('cd_contato').insert([{
        solicitante_id: c.solicitanteId, analista_id: analistaId, tipo: c.tipo, resultado: c.resultado,
        observacao: c.observacao || null, evidencia_path: c.evidenciaPath,
    }]);
    if (error) { console.error('createCdContato:', error); return false; }
    return true;
};

export const getMeusContatos = async (): Promise<CdContato[]> => {
    const { data, error } = await supabase.from('cd_contato').select('*').order('data_hora', { ascending: false }).limit(500);
    if (error || !data) { if (error) console.error('getMeusContatos:', error); return []; }
    return (data as any[]).map(r => ({ id: r.id, solicitanteId: r.solicitante_id, analistaId: r.analista_id, dataHora: r.data_hora, tipo: r.tipo, resultado: r.resultado, observacao: r.observacao || '', evidenciaPath: r.evidencia_path }));
};

// URL assinada temporária p/ visualizar a evidência (bucket é privado).
export const getEvidenciaUrl = async (path: string): Promise<string | null> => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
    if (error || !data) return null;
    return data.signedUrl;
};
