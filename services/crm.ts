// Mini CRM (Prospecção) — regras de negócio puras (sem IO, sem React).
// Reaproveitadas pelo board, pelo detalhe e pela importação CSV (fases seguintes).
// Referência: seção 5 da especificação.

export type CrmOrigem = 'Optus' | 'Omnicargo';

export interface CrmContato {
    id: string;
    empresaId: string;
    nome: string;
    cargo: string;
    email: string;
    telefone: string;
    canal: string;
    origem: CrmOrigem;
    status: string;
    data: string | null;       // ISO yyyy-mm-dd
    codigo: string;            // código de campanha (prova de que o e-mail existiu)
    evidencia: string;         // link da prova
    printRef: string;          // referência do print no storage
    resumoUltimo: string;
}

export interface CrmEmpresa {
    id: string;
    nome: string;
    chaveGrupo: string;
    etapa: string;
    proximoPasso: string;
    responsavel: string;
    lastTouch: string | null;  // ISO yyyy-mm-dd
    contatos: CrmContato[];
    criadoEm?: string;
    atualizadoEm?: string;
}

export interface CrmEvento {
    id: string;
    empresaId: string;
    tipo: 'contato' | 'nota' | 'movimentacao' | 'evidencia' | 'ia';
    data: string;              // ISO timestamp
    autorNome: string;
    texto: string;
    link: string;
}

// ---------- 5.1 Etapas do funil (ordem fixa) ----------
export const ETAPAS = [
    'Contato inicial',
    'Engajado',
    'Qualificação',
    'Negociação/BID',
    'Proposta/Cotação',
    'Homologação/DD',
    'Fechamento',
    'Barreira produto',
    'Perdido',
] as const;

// Etapas 1–7 formam o funil de avanço.
export const ETAPAS_FUNIL = ETAPAS.slice(0, 7);

// Ranking p/ escolher a etapa mais avançada quando há contatos em etapas diferentes.
export const ETAPA_RANK: Record<string, number> = {
    'Fechamento': 8, 'Homologação/DD': 7, 'Negociação/BID': 6, 'Proposta/Cotação': 5,
    'Qualificação': 4, 'Engajado': 3, 'Barreira produto': 2, 'Contato inicial': 1, 'Perdido': 0,
};

// Etapas "ativas" (conta quente / lead empoçado — regra 5.6).
const ETAPAS_ATIVAS = new Set(['Engajado', 'Qualificação', 'Negociação/BID', 'Proposta/Cotação', 'Homologação/DD', 'Fechamento']);

// Canonização de etapa (5.1): valores de entrada → etapa canônica.
export function canonizeEtapa(raw: string): string {
    const v = (raw || '').trim().toLowerCase();
    if (!v) return 'Contato inicial';
    if (ETAPAS.includes(raw as any)) return raw;
    if (v.includes('qualific')) return 'Qualificação';
    if (v.includes('negocia') || v.includes('projeto') || v.includes('bid')) return 'Negociação/BID';
    if (v.includes('proposta') || v.includes('cotaç') || v.includes('cotac')) return 'Proposta/Cotação';
    if (v.includes('homolog') || v.includes('due dilig') || v.includes('dd')) return 'Homologação/DD';
    if (v.includes('fechamento') || v.includes('onboarding')) return 'Fechamento';
    if (v.includes('barreira')) return 'Barreira produto';
    if (v.includes('perdido')) return 'Perdido';
    if (v.includes('engajad')) return 'Engajado';
    if (v.includes('contato inicial') || v.includes('inicial')) return 'Contato inicial';
    return 'Contato inicial';
}

export const etapaMaisAvancada = (etapas: string[]): string =>
    etapas.reduce((best, e) => (ETAPA_RANK[e] ?? 1) > (ETAPA_RANK[best] ?? 1) ? e : best, 'Contato inicial');

// ---------- 5.4 Chave de agrupamento / dedupe ----------
const STOP_WORDS = new Set(['sa', 's', 'a', 'ltda', 'do', 'da', 'de', 'dos', 'das', 'brasil', 'company', 'the', 'international', 'inc', 'co', 'industria', 'industrias', 'ind', 'alimentos', 'celulose', 'papel', 'papeis', 'embalagens', 'cia', 'companhia', 'e', 'comercio', 'group', 'grupo']);

export function chaveGrupo(nome: string): string {
    const semAcento = (nome || '').normalize('NFKD').replace(/[̀-ͯ]/g, '');
    const tokens = semAcento.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(Boolean);
    const restantes = tokens.filter(t => !STOP_WORDS.has(t));
    return restantes.sort().join('');
}

// ---------- 5.2 Status do contato (cores p/ UI) ----------
export const STATUS_COR: Record<string, string> = {
    'Respondeu': '#22c55e',
    'Interesse': '#14b8a6',
    'Em andamento': '#3b82f6',
    'Aguardando': '#f59e0b',
    'Sem retorno': '#9ca3af',
    'Barreira': '#ef4444',
    'Novo': '#a855f7',
};
export const corStatus = (status: string): string => STATUS_COR[status] || STATUS_COR['Sem retorno'];

// ---------- 5.5 Datas ----------
const MESES: Record<string, number> = { jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5, jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11 };

// Aceita "28/jun", "28/06/2026", "28/06". Retorna ISO yyyy-mm-dd ou null.
export function parseDataBR(raw: string, anoRef = new Date().getFullYear()): string | null {
    const s = (raw || '').trim().toLowerCase();
    if (!s) return null;
    const m = s.match(/^(\d{1,2})[/\-\s]+([a-z]{3,}|\d{1,2})(?:[/\-\s]+(\d{2,4}))?$/);
    if (!m) return null;
    const dia = parseInt(m[1], 10);
    let mes: number;
    if (/^\d+$/.test(m[2])) mes = parseInt(m[2], 10) - 1;
    else { const k = m[2].slice(0, 3); if (!(k in MESES)) return null; mes = MESES[k]; }
    let ano = m[3] ? parseInt(m[3], 10) : anoRef;
    if (ano < 100) ano += 2000;
    if (isNaN(dia) || isNaN(mes) || mes < 0 || mes > 11 || dia < 1 || dia > 31) return null;
    const dt = new Date(Date.UTC(ano, mes, dia));
    return dt.toISOString().slice(0, 10);
}

export function diasParado(lastTouch: string | null, hoje = new Date()): number | null {
    if (!lastTouch) return null;
    const t = new Date(lastTouch + 'T00:00:00Z').getTime();
    if (isNaN(t)) return null;
    const h = Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
    return Math.floor((h - t) / 86400000);
}

// Maior data entre os contatos (regra 5.5).
export function computeLastTouch(contatos: CrmContato[]): string | null {
    const datas = contatos.map(c => c.data).filter((d): d is string => !!d).sort();
    return datas.length ? datas[datas.length - 1] : null;
}

// ---------- 5.3 Origem derivada ----------
export function deriveOrigem(contatos: CrmContato[]): string {
    const origens = new Set(contatos.map(c => c.origem));
    const optus = origens.has('Optus'), omni = origens.has('Omnicargo');
    if (optus && omni) return 'Optus + Omnicargo';
    if (optus) return 'Optus';
    if (omni) return 'Omnicargo';
    return '';
}

// ---------- 5.6 Conta quente / lead empoçado ----------
const STATUS_QUENTE = new Set(['Respondeu', 'Interesse', 'Em andamento', 'Aguardando']);

export function isContaQuente(empresa: CrmEmpresa): boolean {
    if (empresa.etapa === 'Perdido') return false;
    if (ETAPAS_ATIVAS.has(empresa.etapa)) return true;
    return empresa.contatos.some(c => STATUS_QUENTE.has(c.status));
}

export function isEmpocada(empresa: CrmEmpresa, limiteDias: number): boolean {
    if (!isContaQuente(empresa)) return false;
    const d = diasParado(empresa.lastTouch);
    if (d === null) return true;          // conta quente sem registro de data = empoçada
    return d >= limiteDias;
}

// ---------- 5.7 Prova de contato (regra dura) ----------
export const contatoPrecisaProva = (status: string): boolean => STATUS_QUENTE.has(status);
export const contatoTemProva = (c: CrmContato): boolean => !!(c.evidencia?.trim() || c.printRef?.trim() || c.codigo?.trim());
export const contatoSemProva = (c: CrmContato): boolean => contatoPrecisaProva(c.status) && !contatoTemProva(c);
export const empresaSemProva = (empresa: CrmEmpresa): boolean => empresa.contatos.some(contatoSemProva);

// Contatos pendentes de prova (nominal — usado no diagnóstico e no registro rápido).
export const contatosSemProva = (empresa: CrmEmpresa): CrmContato[] => empresa.contatos.filter(contatoSemProva);
