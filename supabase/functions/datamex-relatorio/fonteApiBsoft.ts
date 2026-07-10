// fonteApiBsoft — consome o endpoint personalizado da API Bsoft. Atrás da flag
// USE_BSOFT_API (default off). Toda a lógica pura (classificação, contrato,
// agregação) vive em ./classificador.ts. Aqui: HTTP + interpretação da resposta.

import { RegistroBsoft, ResultadoBsoft, agregar, validarContrato } from './classificador.ts';

export interface BsoftEnv { url?: string; user?: string; pass?: string; }

// Extrai o array de registros, tolerando envelopes comuns.
export function extrairRegistros(data: unknown): RegistroBsoft[] {
    if (Array.isArray(data)) return data as RegistroBsoft[];
    const o = (data ?? {}) as Record<string, unknown>;
    for (const k of ['itens', 'dados', 'data', 'result', 'registros']) {
        if (Array.isArray(o[k])) return o[k] as RegistroBsoft[];
    }
    return [];
}

// Interpreta a resposta HTTP crua. PURA e testável (401/403/500/HTML/JSON inválido).
// Lança em qualquer condição que não seja um JSON 2xx legítimo — a coleta falha e o
// index.ts mantém o último valor bom (sucesso_em não avança, banner de stale acende).
export function interpretarResposta(status: number, contentType: string, text: string): unknown {
    if (status === 401 || status === 403) throw new Error(`Bsoft API: não autorizado (HTTP ${status}) — credencial inválida/expirada`);
    if (status >= 500) throw new Error(`Bsoft API: erro do servidor (HTTP ${status})`);
    if (status < 200 || status >= 300) throw new Error(`Bsoft API: HTTP inesperado ${status}`);
    const t = (text ?? '').trim();
    const pareceHtml = /^<(!doctype|html|\?xml)/i.test(t) || (contentType ?? '').toLowerCase().includes('text/html');
    if (pareceHtml) throw new Error('Bsoft API: resposta HTML (esperado JSON) — provável tela de login/erro');
    let data: unknown;
    try { data = JSON.parse(t); } catch { throw new Error('Bsoft API: resposta não é JSON'); }
    return data;
}

// Busca o faturamento na API com janela de EMISSÃO explícita (mês corrente, BRT).
// Lança em falha de rede/HTTP/contrato — nunca classifica em cima de contrato inválido.
export async function fetchFromBsoftApi(dataInicial: string, dataFinal: string, env: BsoftEnv, hojeYMD?: string): Promise<ResultadoBsoft> {
    if (!env.url) throw new Error('BSOFT_API_URL não configurado nos secrets.');
    // A URL base já traz a query string -> concatena com '&'. Datas DD/MM/AAAA com barras %2F.
    const enc = (ymd: string) => { const [y, m, d] = ymd.split('-'); return `${d}%2F${m}%2F${y}`; };
    const url = `${env.url}&param_DATA_INICIAL=${enc(dataInicial)}&param_DATA_FINAL=${enc(dataFinal)}`;

    const headers: Record<string, string> = { 'Accept': 'application/json' };
    if (env.user || env.pass) headers['Authorization'] = 'Basic ' + btoa(`${env.user ?? ''}:${env.pass ?? ''}`);

    const res = await fetch(url, { method: 'GET', headers });
    const text = await res.text();
    const data = interpretarResposta(res.status, res.headers.get('content-type') ?? '', text);

    const registros = extrairRegistros(data);
    // VALIDAÇÃO DE CONTRATO antes de classificar qualquer coisa.
    const contrato = validarContrato(registros);
    if (!contrato.ok) throw new Error(`Contrato inválido: ${contrato.erro}`);

    return agregar(registros, dataInicial, dataFinal, hojeYMD);
}
