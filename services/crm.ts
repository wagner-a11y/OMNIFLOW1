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
    resumo: string;            // "situacao" — posição/resumo da empresa
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

// ---------- 5.8 Motor de diagnóstico (regras, sem IA) ----------
export type RiscoNivel = 'Alto' | 'Médio' | 'Baixo';
export interface Diagnostico { risco: RiscoNivel; leitura: string; proximoPasso: string; observacoes: string[]; }

const DIAG_BASE: Record<string, { leitura: string; acao: string; risco: RiscoNivel }> = {
    'Fechamento': { leitura: 'Conta em fechamento — não relaxar.', acao: 'Confirmar onboarding, cadastro fiscal e primeira coleta.', risco: 'Baixo' },
    'Homologação/DD': { leitura: 'Risco de travar em documento.', acao: 'Cobrar status do cadastro e das AFEs e já pedir uma cotação teste.', risco: 'Médio' },
    'Negociação/BID': { leitura: 'Em negociação/BID.', acao: 'Garantir inclusão na próxima rodada de cotação e confirmar o nível de serviço exigido.', risco: 'Médio' },
    'Proposta/Cotação': { leitura: 'O inimigo aqui é o silêncio.', acao: 'Ligar (não mandar e-mail), puxar a objeção de preço ou prazo e fechar.', risco: 'Médio' },
    'Qualificação': { leitura: 'Em qualificação.', acao: 'Mapear volume, lanes e quem assina a decisão.', risco: 'Baixo' },
    'Engajado': { leitura: 'Respondeu mas está frio.', acao: 'Marcar uma call curta com um caso parecido.', risco: 'Baixo' },
    'Contato inicial': { leitura: 'Primeiro contato.', acao: 'Segundo toque por outro canal (se mandou e-mail, ligar).', risco: 'Baixo' },
    'Barreira produto': { leitura: 'Barreira de produto.', acao: 'Registrar e revisitar quando tiver oferta — não gastar energia agora.', risco: 'Baixo' },
    'Perdido': { leitura: 'Conta perdida.', acao: 'Só reabrir com gatilho novo (troca de fornecedor, problema com o atual, novo projeto).', risco: 'Baixo' },
};

export function diagnosticar(empresa: CrmEmpresa, limiteDias: number): Diagnostico {
    const base = DIAG_BASE[empresa.etapa] || DIAG_BASE['Contato inicial'];
    let risco: RiscoNivel = base.risco;
    let leitura = base.leitura;
    const observacoes: string[] = [];

    if (isEmpocada(empresa, limiteDias)) {
        const d = diasParado(empresa.lastTouch);
        risco = 'Alto';
        leitura = `Parado ${d === null ? 'sem registro de contato' : `há ${d} dias`} — ${leitura} Agir hoje.`;
    }

    if (empresa.contatos.some(c => c.status === 'Respondeu' && !!c.telefone?.trim()))
        observacoes.push('Tem contato que respondeu e tem telefone: ligar, não ficar no e-mail.');

    const semTelefone = !empresa.contatos.some(c => !!c.telefone?.trim());
    const semConversaReal = !empresa.contatos.some(c => contatoPrecisaProva(c.status));
    if (empresa.contatos.length > 0 && semTelefone && semConversaReal)
        observacoes.push('Só e-mail frio sem retorno e sem telefone: trocar de canal, achar o telefone ou outro decisor.');

    if (deriveOrigem(empresa.contatos) === 'Optus + Omnicargo')
        observacoes.push('Conta tocada por Optus e Omnicargo: alinhar com o Carlos para não falar coisas diferentes.');

    if (empresa.contatos.length >= 3)
        observacoes.push('3+ contatos: usar isso — se um trava, atacar por outro decisor.');

    const pend = contatosSemProva(empresa);
    if (pend.length)
        observacoes.push(`Falta prova com: ${pend.map(c => c.nome || '(sem nome)').join(', ')}. Cobrar print ou link antes de dar a conta como tocada.`);

    return { risco, leitura, proximoPasso: base.acao, observacoes };
}

// ---------- 9. CSV: status canônico, parser, export, modelo ----------
const STATUS_VALIDOS = new Set(Object.keys(STATUS_COR));
export function canonizeStatus(raw: string): string {
    const v = (raw || '').trim();
    if (STATUS_VALIDOS.has(v)) return v;
    const l = v.toLowerCase();
    if (l.includes('respond')) return 'Respondeu';
    if (l.includes('interess')) return 'Interesse';
    if (l.includes('andament')) return 'Em andamento';
    if (l.includes('aguard') || l.includes('abordagem') || l.includes('abordando')) return 'Aguardando';
    if (l.includes('barreira') || l.includes('fracionad')) return 'Barreira';
    if (l.includes('sem retorno') || l.includes('sem resposta') || l.includes('neutro') || l.includes('ja abordado')) return 'Sem retorno';
    return 'Novo';
}

const isoToBR = (iso: string | null): string => {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00Z');
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR');
};

export const CSV_HEADER = ['Empresa', 'Contato', 'Cargo', 'E-mail', 'Telefone', 'Origem', 'Etapa', 'Status', 'Data', 'Evidencia (link)', 'Proximo passo'];

// Parser robusto: ignora BOM, detecta ; ou , como separador, suporta aspas com escape.
export function parseCsv(text: string): string[][] {
    const t = text.replace(/^﻿/, '');
    const nl = t.indexOf('\n');
    const head = nl < 0 ? t : t.slice(0, nl);
    const delim = (head.split(';').length >= head.split(',').length) ? ';' : ',';
    const rows: string[][] = [];
    let row: string[] = [], field = '', inQ = false;
    for (let i = 0; i < t.length; i++) {
        const ch = t[i];
        if (inQ) {
            if (ch === '"') { if (t[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
            else field += ch;
        } else if (ch === '"') inQ = true;
        else if (ch === delim) { row.push(field); field = ''; }
        else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else if (ch !== '\r') field += ch;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.some(c => c.trim() !== ''));
}

const escCsv = (v: any): string => { const s = (v ?? '').toString(); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

// Exporta a base inteira (uma linha por contato), ; como separador, BOM UTF-8.
export function exportCrmCsv(empresas: CrmEmpresa[]): string {
    const linhas = [CSV_HEADER.join(';')];
    for (const e of empresas) {
        if (e.contatos.length === 0) { linhas.push([e.nome, '', '', '', '', '', e.etapa, '', '', '', e.proximoPasso].map(escCsv).join(';')); continue; }
        for (const c of e.contatos) linhas.push([e.nome, c.nome, c.cargo, c.email, c.telefone, c.origem, e.etapa, c.status, isoToBR(c.data), c.evidencia, e.proximoPasso].map(escCsv).join(';'));
    }
    return '﻿' + linhas.join('\r\n');
}

export const CSV_MODELO = '﻿' + CSV_HEADER.join(';') + '\r\n' +
    ['Celulose Irani S/A', 'Carlos Amaro', 'Comprador', 'carlos@irani.com', '11999990000', 'Optus', 'Engajado', 'Respondeu', '28/06/2026', 'https://link-da-prova', 'Call de qualificacao'].map(escCsv).join(';') + '\r\n';
