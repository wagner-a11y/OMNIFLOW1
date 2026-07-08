// fonteApiBsoft — consome o endpoint personalizado da API Bsoft (em construção
// pelo suporte; a URL ainda não existe). Atrás da flag USE_BSOFT_API (default off):
// enquanto off, a Edge Function segue no scraping atual. Toda a lógica de
// classificação/agregação vive em ./classificador.ts (pura e testada).

import { RegistroBsoft, ResultadoBsoft, agregar } from './classificador.ts';

export interface BsoftEnv {
    url?: string;   // BSOFT_API_URL
    user?: string;  // BSOFT_API_USER
    pass?: string;  // BSOFT_API_PASS
}

// Extrai o array de registros da resposta, tolerando formatos comuns
// (array puro, ou envelopado em {itens|dados|data|result}).
function extrairRegistros(data: unknown): RegistroBsoft[] {
    if (Array.isArray(data)) return data as RegistroBsoft[];
    const o = (data ?? {}) as Record<string, unknown>;
    for (const k of ['itens', 'dados', 'data', 'result', 'registros']) {
        if (Array.isArray(o[k])) return o[k] as RegistroBsoft[];
    }
    return [];
}

// Busca o faturamento na API Bsoft, com data inicial e final de EMISSÃO explícitas
// (janela atual do painel: 1º dia do mês corrente até hoje, BRT). Retorna o
// resultado agregado (autorizado, travado, pendências). Lança em falha de rede/HTTP;
// o index.ts trata e mantém o último valor bom no cache.
export async function fetchFromBsoftApi(
    dataInicial: string,   // 'YYYY-MM-DD'
    dataFinal: string,     // 'YYYY-MM-DD'
    env: BsoftEnv,
    hojeYMD?: string,
): Promise<ResultadoBsoft> {
    if (!env.url) throw new Error('BSOFT_API_URL não configurado nos secrets.');

    const sep = env.url.includes('?') ? '&' : '?';
    const url = `${env.url}${sep}data_inicial=${encodeURIComponent(dataInicial)}&data_final=${encodeURIComponent(dataFinal)}`;

    const headers: Record<string, string> = { 'Accept': 'application/json' };
    // Auth básica (usuário/senha) — ajustável quando o suporte definir o contrato.
    if (env.user || env.pass) {
        headers['Authorization'] = 'Basic ' + btoa(`${env.user ?? ''}:${env.pass ?? ''}`);
    }

    const res = await fetch(url, { headers });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Bsoft API ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json().catch(() => { throw new Error('Bsoft API: resposta não é JSON.'); });

    const registros = extrairRegistros(data);
    // Mesmo se vier vazio/estranho, agregar é defensivo e devolve zeros.
    return agregar(registros, dataInicial, dataFinal, hojeYMD);
}
