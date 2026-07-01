// Controle de Contato Diário — camada de dados (Camada 1: carteira).
// Módulo isolado. RLS no banco garante a separação master/operador; aqui só I/O.
import { supabase } from './supabase';

export interface SolicitanteCotacao { nome: string; pipefyId: string | null; cotacoes: number; }
export interface CdSolicitante { id: string; nomeCanonico: string; pipefyId: string | null; aliases: string[]; clienteId: string | null; }
export interface ClienteRef { id: string; nome: string; }
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

const mapSol = (r: any): CdSolicitante => ({ id: r.id, nomeCanonico: r.nome_canonico, pipefyId: r.solicitante_pipefy_id || null, aliases: Array.isArray(r.aliases) ? r.aliases : [], clienteId: r.cliente_id || null });

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

export const updateCdSolicitante = async (id: string, patch: { nomeCanonico?: string; pipefyId?: string | null; aliases?: string[]; clienteId?: string | null }): Promise<boolean> => {
    const db: Record<string, unknown> = { atualizado_em: new Date().toISOString() };
    if (patch.nomeCanonico !== undefined) db.nome_canonico = patch.nomeCanonico;
    if (patch.pipefyId !== undefined) db.solicitante_pipefy_id = patch.pipefyId || null;
    if (patch.aliases !== undefined) db.aliases = patch.aliases;
    if (patch.clienteId !== undefined) db.cliente_id = patch.clienteId || null;
    const { error } = await supabase.from('cd_solicitante').update(db).eq('id', id);
    if (error) { console.error('updateCdSolicitante:', error); return false; }
    return true;
};

export const deleteCdSolicitante = async (id: string): Promise<boolean> => {
    const { error } = await supabase.from('cd_solicitante').update({ deleted_at: new Date().toISOString() }).eq('id', id);
    if (error) { console.error('deleteCdSolicitante:', error); return false; }
    return true;
};

// Clientes do OmniFlow (customers) — mesmo cadastro do Dashboard/Ramper/PDF.
export const getClientes = async (): Promise<ClienteRef[]> => {
    const { data, error } = await supabase.from('customers').select('id, name').order('name');
    if (error || !data) { if (error) console.error('getClientes:', error); return []; }
    return (data as any[]).map(c => ({ id: c.id, nome: c.name || c.id }));
};

// Histórico: por nome de solicitante (normalizado), os clientes distintos p/ quem
// ele já cotou. Usado no palpite assistido (1 cliente = sugere; vários = em branco).
const normNome = (s: string) => (s || '').trim().toLowerCase();
export const getMapaSolicitanteClientes = async (): Promise<Map<string, string[]>> => {
    const { data } = await supabase.from('freight_calculations').select('solicitante, customer_id').not('solicitante', 'is', null).not('customer_id', 'is', null).limit(8000);
    const m = new Map<string, Set<string>>();
    for (const r of (data || []) as any[]) {
        const nome = normNome(r.solicitante); if (!nome || !r.customer_id) continue;
        const s = m.get(nome) || new Set<string>(); s.add(r.customer_id); m.set(nome, s);
    }
    const out = new Map<string, string[]>();
    m.forEach((v, k) => out.set(k, Array.from(v)));
    return out;
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

// =================== Camada 3: painel de cobrança (gestor / master) ===================
export interface CobrancaItem {
    solicitanteId: string; nome: string; analistaId: string; analistaNome: string;
    emDia: boolean; contatoHoje: boolean; cotouHoje: boolean; diasParado: number | null; esfriando: boolean;
}
export interface PainelCobranca {
    itens: CobrancaItem[];
    kpis: { total: number; emDia: number; ausentes: number; esfriando: number };
}

const norm = (s: string) => (s || '').trim().toLowerCase();

// Cruza carteira × (contatos registrados + cotações reais). Determinístico, lido
// do banco. "Em dia" = contato hoje OU cotou hoje (casando o solicitante canônico
// e seus aliases contra o campo solicitante das cotações). Só faz sentido p/ master
// (a RLS já impede o operador de ver a carteira/contatos dos outros).
export const getPainelCobranca = async (limiteDias: number): Promise<PainelCobranca> => {
    const inicioHoje = new Date(); inicioHoje.setHours(0, 0, 0, 0);
    const inicioHojeMs = inicioHoje.getTime();

    const [{ data: atr }, sols, analistas, { data: cts }, { data: fcs }] = await Promise.all([
        supabase.from('cd_atribuicao').select('solicitante_id, analista_id').is('deleted_at', null),
        getCdSolicitantes(),
        getAnalistas(),
        supabase.from('cd_contato').select('solicitante_id, data_hora'),
        supabase.from('freight_calculations').select('solicitante, created_at').not('solicitante', 'is', null).limit(8000),
    ]);

    const solById = new Map(sols.map(s => [s.id, s]));
    const analistaNome = new Map(analistas.map(a => [a.id, a.nome]));

    // Último contato (ms) e contato-hoje por solicitante.
    const ultContato = new Map<string, number>(), contatoHoje = new Set<string>();
    for (const r of (cts || []) as any[]) {
        const ms = new Date(r.data_hora).getTime();
        if (ms > (ultContato.get(r.solicitante_id) || 0)) ultContato.set(r.solicitante_id, ms);
        if (ms >= inicioHojeMs) contatoHoje.add(r.solicitante_id);
    }
    // Cotações: por nome de solicitante (cru) -> última (ms) e se cotou hoje.
    const ultCotacaoNome = new Map<string, number>(), cotouHojeNome = new Set<string>();
    for (const r of (fcs || []) as any[]) {
        const nome = norm(r.solicitante); const ms = Number(r.created_at) || 0;
        if (ms > (ultCotacaoNome.get(nome) || 0)) ultCotacaoNome.set(nome, ms);
        if (ms >= inicioHojeMs) cotouHojeNome.add(nome);
    }

    const itens: CobrancaItem[] = [];
    for (const a of (atr || []) as any[]) {
        const s = solById.get(a.solicitante_id); if (!s) continue;
        const nomes = [s.nomeCanonico, ...s.aliases].map(norm).filter(Boolean);
        const cotHoje = nomes.some(n => cotouHojeNome.has(n));
        const conHoje = contatoHoje.has(a.solicitante_id);
        const ultCot = Math.max(0, ...nomes.map(n => ultCotacaoNome.get(n) || 0));
        const ultCon = ultContato.get(a.solicitante_id) || 0;
        const ultimoToque = Math.max(ultCot, ultCon);
        const emDia = cotHoje || conHoje;
        const diasParado = ultimoToque ? Math.max(0, Math.floor((inicioHojeMs - ultimoToque) / 86400000)) : null;
        const esfriando = !emDia && (diasParado === null || diasParado >= limiteDias);
        itens.push({
            solicitanteId: a.solicitante_id, nome: s.nomeCanonico, analistaId: a.analista_id,
            analistaNome: analistaNome.get(a.analista_id) || '—',
            emDia, contatoHoje: conHoje, cotouHoje: cotHoje, diasParado, esfriando,
        });
    }
    const kpis = {
        total: itens.length,
        emDia: itens.filter(i => i.emDia).length,
        ausentes: itens.filter(i => !i.emDia).length,
        esfriando: itens.filter(i => i.esfriando).length,
    };
    return { itens, kpis };
};
