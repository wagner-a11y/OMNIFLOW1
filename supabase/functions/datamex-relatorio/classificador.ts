// Classificador de faturamento Bsoft (contrato NOVO) + validação de contrato + agregação.
// PURO (sem I/O): usado pela Edge Function (Deno) e pelo teste unitário (tsx/node).
// Regras determinísticas, sem IA.
//
// Contrato atual da API (campos): id, data_emissao, data_autorizacao, nroConhecimento,
//   valor_frete, tipo_cte, status_sefaz, chaveCTe, protocoloCTe, substituiCTe, tomador,
//   statusFaturamento.
//
// REGRAS (validadas contra dado real, jan/2026):
//  - Soma por status_sefaz == 100 (status VIGENTE; o campo antigo devolvia o último
//    evento do histórico e mentia nos dois sentidos — não usar histórico).
//  - Substituição por id (substituiCTe -> id do substituído): exclui o substituído
//    APENAS quando existe um substituto AUTORIZADO apontando pro id dele. Substituído
//    com substituto morto (ex.: Não Transmitido) CONTINUA valendo. Funciona em CADEIA:
//    cada substituto autorizado exclui seu alvo, então A<-B<-C mantém só C sem código especial.
//  - Cancelado (101) e Denegado (110/301/302) ficam de fora. Rejeição/vazio/não transmitido
//    -> PENDENTE (valor travado).
//  - protocoloCTe é SENTINELA, nunca filtro: status 100 sem protocolo, ou protocolo com
//    status de rejeição, gera divergência de contrato (log/alerta) mas NÃO altera o valor.
//    Exigir os dois campos criaria nova forma silenciosa de perder faturamento.

export type Categoria = 'AUTORIZADO' | 'CANCELADO' | 'DENEGADO' | 'PENDENTE';

// Classifica o status_sefaz VIGENTE do CTe.
export function classifySefaz(statusSefaz: string | null | undefined): Categoria {
    const s = (statusSefaz ?? '').trim();
    if (!s) return 'PENDENTE';
    const lower = s.toLowerCase();
    const code = (s.match(/^(\d{2,4})/)?.[1]) ?? '';
    if (code === '100') return 'AUTORIZADO';
    if (code === '101' || lower.includes('cancelamento') || lower.includes('cancelado')) return 'CANCELADO';
    if (code === '110' || code === '301' || code === '302' || lower.includes('denegado')) return 'DENEGADO';
    if (lower.includes('rejei')) return 'PENDENTE';
    return 'PENDENTE'; // vazio / não transmitido / desconhecido
}

export interface RegistroBsoft {
    id?: string;
    data_emissao?: string;
    data_autorizacao?: string;
    nroConhecimento?: string;
    valor_frete?: string;
    tipo_cte?: string;
    status_sefaz?: string;
    chaveCTe?: string;
    protocoloCTe?: string;
    substituiCTe?: string;   // id do CTe substituído ('0'/'' = não substitui ninguém)
    tomador?: string;
    statusFaturamento?: string;
}

export interface Pendencia { nroConhecimento: string; valor: number; statusSefaz: string; tomador: string; }
export interface Divergencia { nroConhecimento: string; tipo: 'autorizado_sem_protocolo' | 'protocolo_com_rejeicao'; statusSefaz: string; }

export interface ResultadoBsoft {
    faturamentoAutorizado: number;
    valorTravado: number;
    pendencias: Pendencia[];
    autorizadoCount: number;
    autorizadoHoje: number;
    canceladoCount: number;
    canceladoValor: number;
    substituidosExcluidos: string[]; // ids excluídos por substituição
    divergencias: Divergencia[];     // sentinela do protocolo (não altera o valor)
    descartados: number;
}

export interface ContratoResultado { ok: boolean; erro?: string; }

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// Campos SEM os quais NÃO se pode classificar — ausência = erro de contrato, não dado.
export const CAMPOS_OBRIGATORIOS = ['id', 'data_emissao', 'nroConhecimento', 'valor_frete', 'tipo_cte', 'status_sefaz', 'substituiCTe'];
const MAX_STATUS_VAZIO = 3; // "um punhado"; acima disso é erro de contrato

// Valida o contrato ANTES de classificar. Nunca classificar em cima de campo ausente.
export function validarContrato(registros: unknown): ContratoResultado {
    if (!Array.isArray(registros)) return { ok: false, erro: 'resposta não é um array' };
    if (registros.length === 0) return { ok: false, erro: 'array vazio (sem registros) — coleta não confiável' };
    const amostra = registros[0] ?? {};
    const faltando = CAMPOS_OBRIGATORIOS.filter(c => !(c in (amostra as Record<string, unknown>)));
    if (faltando.length) return { ok: false, erro: `campos ausentes no contrato: ${faltando.join(', ')}` };
    const vazios = registros.filter(r => !String((r as RegistroBsoft)?.status_sefaz ?? '').trim()).length;
    if (vazios > MAX_STATUS_VAZIO) return { ok: false, erro: `${vazios} registros com status_sefaz vazio (erro de contrato, não dado)` };
    return { ok: true };
}

export function parseValor(v: unknown): number | null {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (typeof v !== 'string') return null;
    const s = v.trim().replace(',', '.');
    if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
    const n = Number(s);
    return isFinite(n) ? n : null;
}

const dataDe = (dataEmissao: string): string => {
    const d = (dataEmissao || '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '';
};

export function dentroDoPeriodo(dataEmissao: string, ini: string, fim: string): boolean {
    const d = dataDe(dataEmissao);
    if (!d) return false;
    return d >= ini && d <= fim;
}

const vazio = (v: unknown) => !String(v ?? '').trim() || String(v).trim() === '0';

// Agrega os registros no faturamento pronto pro painel. Assume contrato já validado.
export function agregar(registros: RegistroBsoft[], dataIni: string, dataFim: string, hojeYMD?: string): ResultadoBsoft {
    const arr = registros ?? [];

    // 1) Filtra por período + CTRC<1000 (inócuo hoje; ver TODO) e classifica.
    type Item = { r: RegistroBsoft; valor: number; cat: Categoria };
    const validos: Item[] = [];
    let descartados = 0;
    for (const r of arr) {
        try {
            const nroNum = Number(String(r?.nroConhecimento ?? '').trim());
            if (!dentroDoPeriodo(String(r?.data_emissao ?? ''), dataIni, dataFim)) { descartados++; continue; }
            // TODO(inócuo hoje): a consulta do Fabricio já vem sem anulação e NÃO há tipo_cte de
            // anulação no retorno. CTRC<1000 fica só como cinto de segurança; não remove nada hoje.
            if (Number.isFinite(nroNum) && nroNum < 1000) { descartados++; continue; }
            const valor = parseValor(r?.valor_frete);
            if (valor === null) {
                console.warn('Bsoft: valor_frete inválido:', JSON.stringify(r).slice(0, 160));
                validos.push({ r, valor: 0, cat: 'PENDENTE' });
                continue;
            }
            validos.push({ r, valor, cat: classifySefaz(r?.status_sefaz) });
        } catch (e) {
            console.warn('Bsoft: falha ao processar registro:', (e as Error).message);
            validos.push({ r: (r ?? {}), valor: 0, cat: 'PENDENTE' });
        }
    }

    // 2) Substituição por id (com cadeia): um substituto AUTORIZADO exclui o id que ele substitui.
    //    Cada exclusão é independente -> cadeias A<-B<-C funcionam sem código especial.
    const excluidos = new Set<string>();
    for (const { r, cat } of validos) {
        const alvo = String(r?.substituiCTe ?? '').trim();
        if (cat === 'AUTORIZADO' && !vazio(alvo)) excluidos.add(alvo);
    }

    // 3) Agrega.
    let faturamentoAutorizado = 0, autorizadoCount = 0, autorizadoHoje = 0;
    let valorTravado = 0, canceladoCount = 0, canceladoValor = 0;
    const pendencias: Pendencia[] = [];
    const divergencias: Divergencia[] = [];
    for (const { r, valor, cat } of validos) {
        const id = String(r?.id ?? '').trim();
        const status = String(r?.status_sefaz ?? '');

        // Sentinela do protocolo — NUNCA altera o valor somado.
        const temProto = !vazio(r?.protocoloCTe);
        if (cat === 'AUTORIZADO' && !temProto)
            divergencias.push({ nroConhecimento: String(r?.nroConhecimento ?? '?'), tipo: 'autorizado_sem_protocolo', statusSefaz: status });
        if (temProto && status.toLowerCase().includes('rejei'))
            divergencias.push({ nroConhecimento: String(r?.nroConhecimento ?? '?'), tipo: 'protocolo_com_rejeicao', statusSefaz: status });

        if (cat === 'AUTORIZADO') {
            if (excluidos.has(id)) continue; // substituído por um substituto autorizado -> não conta
            faturamentoAutorizado += valor;
            autorizadoCount++;
            if (hojeYMD && dataDe(String(r?.data_emissao ?? '')) === hojeYMD) autorizadoHoje += valor;
        } else if (cat === 'CANCELADO') {
            canceladoCount++; canceladoValor += valor; // fora do faturamento
        } else if (cat === 'PENDENTE') {
            valorTravado += valor;
            pendencias.push({ nroConhecimento: String(r?.nroConhecimento ?? ''), valor, statusSefaz: status, tomador: String(r?.tomador ?? '') });
        }
        // DENEGADO: fora, não soma nem trava.
    }

    if (divergencias.length) console.warn(`Bsoft: ${divergencias.length} divergência(s) de contrato (protocolo/status):`, JSON.stringify(divergencias).slice(0, 300));

    return {
        faturamentoAutorizado: round2(faturamentoAutorizado),
        valorTravado: round2(valorTravado),
        pendencias, autorizadoCount, autorizadoHoje: round2(autorizadoHoje),
        canceladoCount, canceladoValor: round2(canceladoValor),
        substituidosExcluidos: [...excluidos], divergencias, descartados,
    };
}
