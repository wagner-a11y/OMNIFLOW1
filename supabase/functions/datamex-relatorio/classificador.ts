// Classificador de faturamento por situação SEFAZ + agregação.
// PURO (sem I/O): consumido pela Edge Function (Deno) e pelo teste unitário (tsx/node).
// Regras determinísticas, sem IA. Fonte: API personalizada Bsoft (TAREFA 2).

export type Categoria = 'AUTORIZADO' | 'CANCELADO' | 'DENEGADO' | 'PENDENTE';

// Classifica o statusSefaz do CTe. Ordem de precedência importa.
//  - começa com "100"                         -> AUTORIZADO (soma no faturamento)
//  - começa com "101" ou contém "Cancelamento"-> CANCELADO  (fora)
//  - contém "Denegado" ou código 110/301/302  -> DENEGADO   (fora)
//  - contém "Rejei" (Rejeição)                -> PENDENTE   (não soma; entra no valor travado)
//  - vazio, nulo ou desconhecido              -> PENDENTE   (não transmitido)
export function classifySefaz(statusSefaz: string | null | undefined): Categoria {
    const s = (statusSefaz ?? '').trim();
    if (!s) return 'PENDENTE';                       // vazio/nulo -> não transmitido
    const lower = s.toLowerCase();
    const code = (s.match(/^(\d{2,4})/)?.[1]) ?? ''; // código numérico no início ("100 - ...")

    if (code === '100') return 'AUTORIZADO';
    if (code === '101' || lower.includes('cancelamento')) return 'CANCELADO';
    if (code === '110' || code === '301' || code === '302' || lower.includes('denegado')) return 'DENEGADO';
    if (lower.includes('rejei')) return 'PENDENTE'; // Rejeição
    return 'PENDENTE';                               // desconhecido -> pendente
}

// Registro cru vindo da API Bsoft (amostra real do suporte).
export interface RegistroBsoft {
    id?: string;
    data_emissao?: string;        // "YYYY-MM-DD HH:mm:ss"
    nroConhecimento?: string;
    valor_frete?: string;         // string com ponto decimal
    statusSefaz?: string;
    statusFaturamento?: string;
    chaveCTe?: string;
    tomador?: string;
}

export interface Pendencia {
    nroConhecimento: string;
    valor: number;
    statusSefaz: string;
    tomador: string;
}

export interface ResultadoBsoft {
    faturamentoAutorizado: number; // soma AUTORIZADO
    valorTravado: number;          // soma PENDENTE
    pendencias: Pendencia[];       // detalhe do que está travado
    autorizadoCount: number;       // qtd de CTes autorizados
    autorizadoHoje: number;        // soma AUTORIZADO emitido HOJE (p/ o "emitidos hoje")
    descartados: number;           // fora do período ou CTRC < 1000 (anulação série própria)
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// Parse defensivo do valor_frete (string com ponto decimal). Retorna null se inválido.
export function parseValor(v: unknown): number | null {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (typeof v !== 'string') return null;
    const s = v.trim().replace(',', '.'); // tolera vírgula por acaso
    if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
    const n = Number(s);
    return isFinite(n) ? n : null;
}

// Extrai a data (YYYY-MM-DD) do data_emissao. '' se malformado.
const dataDe = (dataEmissao: string): string => {
    const d = (dataEmissao || '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '';
};

// Corte rígido por data de emissão: registro fora de [ini, fim] fica de fora.
// CTe de mês anterior nunca entra no mês corrente.
export function dentroDoPeriodo(dataEmissao: string, ini: string, fim: string): boolean {
    const d = dataDe(dataEmissao);
    if (!d) return false;
    return d >= ini && d <= fim;
}

// Agrega os registros da API num resultado pronto pro painel.
// dataIni/dataFim em 'YYYY-MM-DD'; hojeYMD (opcional) alimenta autorizadoHoje.
// Parse defensivo: registro malformado é logado e vira PENDENTE — nunca derruba.
export function agregar(
    registros: RegistroBsoft[],
    dataIni: string,
    dataFim: string,
    hojeYMD?: string,
): ResultadoBsoft {
    let faturamentoAutorizado = 0, valorTravado = 0, autorizadoCount = 0, autorizadoHoje = 0, descartados = 0;
    const pendencias: Pendencia[] = [];

    for (const r of (registros ?? [])) {
        try {
            const nro = String(r?.nroConhecimento ?? '').trim();
            const nroNum = Number(nro);
            const emissao = String(r?.data_emissao ?? '');

            // Corte por data: fora do período -> descarta.
            if (!dentroDoPeriodo(emissao, dataIni, dataFim)) { descartados++; continue; }
            // Anulação com série própria (ex.: 20-25): CTRC < 1000 não é faturamento.
            // TODO(inócuo hoje): validado contra dado real (jan/2026) — a consulta do Fabricio
            // JÁ vem sem anulação e NÃO existe tipo_cte de anulação no retorno (só Normal/
            // Substituição). Então este corte é apenas cinto de segurança e não remove nada
            // hoje. Mantido caso a consulta mude; a regra definitiva seria por TIPO do documento.
            if (Number.isFinite(nroNum) && nroNum < 1000) { descartados++; continue; }

            const valor = parseValor(r?.valor_frete);
            // Registro malformado (valor inválido) -> PENDENTE, valor 0, logado. Nunca derruba.
            if (valor === null) {
                console.warn('Bsoft: registro malformado (valor_frete inválido):', JSON.stringify(r).slice(0, 200));
                pendencias.push({ nroConhecimento: nro || '?', valor: 0, statusSefaz: String(r?.statusSefaz ?? '(sem status)'), tomador: String(r?.tomador ?? '') });
                continue;
            }

            const cat = classifySefaz(r?.statusSefaz);
            if (cat === 'AUTORIZADO') {
                faturamentoAutorizado += valor;
                autorizadoCount++;
                if (hojeYMD && dataDe(emissao) === hojeYMD) autorizadoHoje += valor;
            } else if (cat === 'PENDENTE') {
                valorTravado += valor;
                pendencias.push({ nroConhecimento: nro, valor, statusSefaz: String(r?.statusSefaz ?? ''), tomador: String(r?.tomador ?? '') });
            }
            // CANCELADO e DENEGADO: fora (não soma, não trava).
        } catch (e) {
            // Parse defensivo total: nunca derruba a função por um registro ruim.
            console.warn('Bsoft: falha ao processar registro:', (e as Error).message);
            pendencias.push({ nroConhecimento: String(r?.nroConhecimento ?? '?'), valor: 0, statusSefaz: '(erro ao processar)', tomador: '' });
        }
    }

    return {
        faturamentoAutorizado: round2(faturamentoAutorizado),
        valorTravado: round2(valorTravado),
        pendencias,
        autorizadoCount,
        autorizadoHoje: round2(autorizadoHoje),
        descartados,
    };
}
