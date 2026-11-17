/**
 * BID EM LOTE — HISTÓRICO POR NOME E POR RODADA (lógica pura).
 *
 * O bid deixa de ser uma planilha solta: vive numa pasta (bid) com rodadas.
 * Este módulo não fala com o banco. Ele define o que é gravado, compara o que
 * está na tela com o que foi salvo e decide o que mandar — e o `SalvadorRodada`
 * orquestra a gravação através de um `RepositorioBid` INJETADO. Em produção o
 * repositório é o Supabase (services/bidHistorico.ts); nos testes, a memória
 * (utils/bidHistoricoMemoria.ts), com as mesmas regras do banco.
 *
 * Cada linha salva guarda DUAS coisas:
 *   entrada   -> o que é preciso para continuar editando (linha crua da
 *                planilha, dados de rota do Qualp, ajustes próprios da linha)
 *   resultado -> a linha calculada completa, para a rodada fechada mostrar
 *                EXATAMENTE o que foi salvo, sem recalcular nunca.
 */

import {
    prepararLinha,
    type LinhaBid, type LinhaBidBruta, type ParametrosBid, type RotaDoLote, type SeguroModo,
} from './bidLote';

export type StatusRodada = 'rascunho' | 'fechada';

// ---------------------------------------------------------------------------
// O que é gravado
// ---------------------------------------------------------------------------

/** Parâmetros da rodada como a TELA os edita (texto digitado, não número). */
export interface ParametrosTela {
    veiculoPadrao: string;
    profitMargin: string;
    cargoType: string;
    jurosMensal: string;
    prazoDias: string;
    comissaoPercent: string;
    deParaVeiculo: Record<string, string>;
    icmsIncluso: boolean;
    /** false = pedágio por VPO, por conta do cliente. Ausente em rodada antiga = true. */
    pedagioIncluso: boolean;
    adicionalPadrao: string;
    seguroModo: SeguroModo;
    seguroPct: string;
    taxaCustoDdr: string;
    valorMercadoriaPadrao: string;
    nomeArquivo: string;
    abaUsada: string;
}

export const parametrosTelaPadrao = (cargoType: string): ParametrosTela => ({
    veiculoPadrao: '',
    profitMargin: '15',
    cargoType,
    jurosMensal: '1,5',
    prazoDias: '30',
    comissaoPercent: '',
    deParaVeiculo: {},
    icmsIncluso: true,
    pedagioIncluso: true,
    adicionalPadrao: '0',
    seguroModo: 'ad_valorem',
    seguroPct: '',
    taxaCustoDdr: '0,004',
    valorMercadoriaPadrao: '',
    nomeArquivo: '',
    abaUsada: '',
});

/**
 * O que vai na coluna `parametros` da rodada: o texto da tela (para continuar
 * editando) e os parâmetros de CÁLCULO resolvidos (para o cabeçalho do Excel
 * de uma rodada fechada mostrar as taxas da época, não as de hoje).
 */
export interface ParametrosRodada {
    tela: ParametrosTela;
    calculo: ParametrosBid | null;
}

/** A entrada de uma linha: tudo que é preciso para recalculá-la sem Qualp. */
export interface EntradaLinha {
    bruta: LinhaBidBruta;
    /** Km, pedágio, piso e data da consulta. null = rota nunca consultada. */
    rota: RotaDoLote | null;
    /** Adicional próprio da linha (%). null = segue o padrão da rodada. */
    adicionalPct: number | null;
    /** Valor de NF editado na tela. null = o da planilha ou o padrão. */
    valorMercadoria: number | null;
}

export interface RegistroLinha {
    /** Chave estável: copiada para a rodada seguinte, casa a comparação de preço. */
    chave: string;
    /** Posição na planilha importada (1, 2, 3...). */
    ordem: number;
    entrada: EntradaLinha;
    resultado: LinhaBid | null;
}

export const chaveDaLinha = (b: Pick<LinhaBidBruta, 'linhaExcel'>): string => `linha-${b.linhaExcel}`;

/**
 * Monta os registros a gravar a partir do estado da tela. A ordem é a da
 * planilha importada (a de `brutas`), nunca a ordenação da tabela.
 */
export const montarRegistros = (
    brutas: LinhaBidBruta[],
    calculadas: LinhaBid[],
    adicionalPorLinha: Record<number, number>,
    valorMercadoriaPorLinha: Record<number, number>,
): RegistroLinha[] => {
    const porLinha = new Map(calculadas.map(l => [l.linhaExcel, l]));
    return brutas.map((b, i) => {
        const r = porLinha.get(b.linhaExcel) ?? null;
        return {
            chave: chaveDaLinha(b),
            ordem: i + 1,
            entrada: {
                bruta: b,
                rota: r?.rota ?? null,
                adicionalPct: adicionalPorLinha[b.linhaExcel] ?? null,
                valorMercadoria: valorMercadoriaPorLinha[b.linhaExcel] ?? null,
            },
            resultado: r,
        };
    });
};

/**
 * Cache de rotas (chave de dedup do Qualp -> rota) reconstruído das entradas
 * salvas. É o que faz reabrir, recarregar e "Nova rodada" custarem ZERO
 * consulta: a chave é recalculada com os parâmetros atuais e aponta para a
 * rota que já foi paga.
 */
export const cacheDasEntradas = (registros: RegistroLinha[], p: ParametrosBid): Record<string, RotaDoLote> => {
    const cache: Record<string, RotaDoLote> = {};
    for (const r of registros) {
        if (!r.entrada.rota) continue;
        const chave = prepararLinha(r.entrada.bruta, p).chaveQualp;
        if (chave) cache[chave] = r.entrada.rota;
    }
    return cache;
};

// ---------------------------------------------------------------------------
// O que mudou desde a última gravação
// ---------------------------------------------------------------------------

/**
 * JSON com as chaves em ordem: o jsonb do Postgres devolve as chaves numa
 * ordem própria, e sem isto toda linha recém-carregada pareceria alterada.
 */
export const jsonCanonico = (v: unknown): string => {
    const ordenar = (x: unknown): unknown => {
        if (Array.isArray(x)) return x.map(ordenar);
        if (x && typeof x === 'object') {
            const o = x as Record<string, unknown>;
            return Object.fromEntries(Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => [k, ordenar(o[k])]));
        }
        return x;
    };
    return JSON.stringify(ordenar(v));
};

export const assinaturaRegistro = (r: RegistroLinha): string =>
    jsonCanonico({ ordem: r.ordem, entrada: r.entrada, resultado: r.resultado });

export interface DiferencaRegistros {
    /** Novas ou alteradas — só estas vão para o banco. */
    alteradas: RegistroLinha[];
    /** Chaves que existiam no salvo e sumiram da tela. */
    removidas: string[];
}

export const diferencaRegistros = (atuais: RegistroLinha[], salvos: Map<string, string>): DiferencaRegistros => {
    const presentes = new Set<string>();
    const alteradas: RegistroLinha[] = [];
    for (const r of atuais) {
        presentes.add(r.chave);
        if (salvos.get(r.chave) !== assinaturaRegistro(r)) alteradas.push(r);
    }
    const removidas = [...salvos.keys()].filter(k => !presentes.has(k));
    return { alteradas, removidas };
};

// ---------------------------------------------------------------------------
// Resumo, comparação entre rodadas e cópia
// ---------------------------------------------------------------------------

export interface ResumoRodada {
    linhas: number;
    totalOfertado: number;
    /** Média simples da margem líquida % das linhas com preço (mesma regra do resumo da tela). */
    margemMedia: number | null;
}

export const resumirResultados = (rs: { status: string | null; precoOfertado: number | null; margemLiquidaPercent: number | null }[]): ResumoRodada => {
    const ok = rs.filter(r => r.status === 'ok');
    const comMargem = ok.filter(r => r.margemLiquidaPercent != null);
    return {
        linhas: rs.length,
        totalOfertado: ok.reduce((a, r) => a + (r.precoOfertado ?? 0), 0),
        margemMedia: comMargem.length ? comMargem.reduce((a, r) => a + (r.margemLiquidaPercent ?? 0), 0) / comMargem.length : null,
    };
};

/** Preço ofertado da rodada anterior, por chave da linha. */
export const precoPorChave = (registros: RegistroLinha[]): Record<string, number | null> =>
    Object.fromEntries(registros.map(r => [r.chave, r.resultado?.status === 'ok' ? r.resultado.precoOfertado : null]));

export const variacaoPercentual = (atual: number | null, anterior: number | null): number | null =>
    atual != null && anterior != null && anterior !== 0 ? (atual / anterior - 1) * 100 : null;

/** "5501,34": vírgula decimal, duas casas, sem "R$" e sem ponto de milhar. */
export const formatarValorCopia = (v: number | null | undefined): string =>
    v == null || !Number.isFinite(v) ? '' : v.toFixed(2).replace('.', ',');

/**
 * Uma coluna inteira para colar na planilha do cliente: um valor por linha, na
 * ORDEM DA PLANILHA IMPORTADA (ignora ordenação e filtro da tela), com TODAS
 * as linhas. Linha sem preço sai em branco para não desalinhar.
 */
export const textoCopiaColuna = (linhas: LinhaBid[], valor: (l: LinhaBid) => number | null): { texto: string; quantidade: number } => {
    const naOrdem = [...linhas].sort((a, b) => a.linhaExcel - b.linhaExcel);
    return { texto: naOrdem.map(l => formatarValorCopia(valor(l))).join('\n'), quantidade: naOrdem.length };
};

// ---------------------------------------------------------------------------
// Nome do bid e do arquivo
// ---------------------------------------------------------------------------

export const normalizarNomeBid = (s: string): string => s.trim().toLowerCase();

/** Mesma regra do índice único do banco: obrigatório, único ignorando maiúsculas. */
export const validarNomeBid = (nome: string, existentes: string[]): string | null => {
    if (!nome.trim()) return 'O nome é obrigatório.';
    const alvo = normalizarNomeBid(nome);
    if (existentes.some(e => normalizarNomeBid(e) === alvo)) return 'Já existe um bid com esse nome.';
    return null;
};

export const nomeArquivoRodada = (nomeBid: string, numero: number): string => {
    const slug = nomeBid.normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'bid';
    return `${slug}_rodada-${numero}.xlsx`;
};

// ---------------------------------------------------------------------------
// Erros de gravação
// ---------------------------------------------------------------------------

export type TipoErro =
    | 'sessao' | 'fechada' | 'duplicado' | 'so_master' | 'rodada_aberta' | 'rodada_antiga' | 'rede' | 'outro';

export interface ErroClassificado {
    tipo: TipoErro;
    mensagem: string;
}

/**
 * Traduz o erro do banco para o que a tela diz. O banco marca as recusas de
 * regra com um prefixo na mensagem (RODADA_FECHADA:, SO_MASTER: ...); sessão
 * expirada chega como 42501 (sem papel authenticated) ou JWT expirado.
 */
export const classificarErro = (e: unknown): ErroClassificado => {
    const o = (e && typeof e === 'object' ? e : {}) as { code?: unknown; message?: unknown; status?: unknown };
    const code = typeof o.code === 'string' ? o.code : '';
    const msg = typeof o.message === 'string' ? o.message : String(e ?? '');
    if (code === '42501' || code === 'PGRST301' || code === 'PGRST303' || o.status === 401 || /jwt expired/i.test(msg)) {
        return { tipo: 'sessao', mensagem: 'Sua sessão expirou. Entre de novo para salvar.' };
    }
    if (msg.includes('RODADA_FECHADA')) return { tipo: 'fechada', mensagem: 'Esta rodada está fechada: somente leitura.' };
    if (code === '23505') return { tipo: 'duplicado', mensagem: 'Já existe um bid com esse nome.' };
    if (msg.includes('SO_MASTER')) return { tipo: 'so_master', mensagem: 'Só o master pode fazer isso.' };
    if (msg.includes('RODADA_ABERTA')) return { tipo: 'rodada_aberta', mensagem: 'Feche a última rodada antes de abrir uma nova.' };
    if (msg.includes('RODADA_ANTIGA')) return { tipo: 'rodada_antiga', mensagem: 'Só a última rodada pode ser reaberta.' };
    if (/failed to fetch|network|fetch failed|load failed/i.test(msg)) {
        return { tipo: 'rede', mensagem: 'Sem conexão com o banco. Nada foi perdido na tela.' };
    }
    return { tipo: 'outro', mensagem: msg || 'Erro ao gravar.' };
};

// ---------------------------------------------------------------------------
// Repositório (injetado)
// ---------------------------------------------------------------------------

export interface BidResumo {
    id: string;
    nome: string;
    cliente: string | null;
    observacao: string | null;
    rodadas: number;
    atualizadoEm: string;
    atualizadoPorNome: string | null;
}

export interface RodadaInfo {
    id: string;
    bidId: string;
    numero: number;
    status: StatusRodada;
    versao: number;
    parametros: ParametrosRodada | null;
    criadoEm: string;
    atualizadoEm: string;
    atualizadoPorNome: string | null;
    fechadaEm: string | null;
    fechadaPorNome: string | null;
}

export interface RodadaResumo extends RodadaInfo {
    resumo: ResumoRodada;
}

export interface RodadaCarregada {
    rodada: RodadaInfo;
    registros: RegistroLinha[];
    /** Registros da rodada anterior (comparação de preço). null na Rodada 1. */
    anterior: RegistroLinha[] | null;
}

export interface Conflito {
    versao: number | null;
    status: StatusRodada | null;
    atualizadoEm: string | null;
    atualizadoPorNome: string | null;
}

export type RespostaGravacao = { ok: true; versao: number } | { ok: false; conflito: Conflito };

export interface RepositorioBid {
    listarBids(): Promise<BidResumo[]>;
    criarBid(nome: string, cliente: string, observacao: string): Promise<{ bidId: string; rodadaId: string }>;
    listarRodadas(bidId: string): Promise<RodadaResumo[]>;
    carregarRodada(rodadaId: string): Promise<RodadaCarregada>;
    salvarRodada(rodadaId: string, versao: number, parametros: ParametrosRodada | null, linhas: RegistroLinha[], remover: string[]): Promise<RespostaGravacao>;
    substituirLinhas(rodadaId: string, versao: number, parametros: ParametrosRodada | null, linhas: RegistroLinha[]): Promise<RespostaGravacao>;
    mudarStatus(rodadaId: string, versao: number, status: StatusRodada): Promise<RespostaGravacao>;
    novaRodada(bidId: string): Promise<{ rodadaId: string; numero: number }>;
    /** Exclusão LÓGICA (deleted_at). Só master — o banco recusa os demais. */
    excluirBid(bidId: string): Promise<void>;
}

/** Confirmação de exclusão: digitar o nome do bid (espaços nas pontas não contam). */
export const confirmacaoExclusaoOk = (digitado: string, nomeBid: string): boolean =>
    digitado.trim() !== '' && digitado.trim() === nomeBid.trim();

// ---------------------------------------------------------------------------
// Salvamento
// ---------------------------------------------------------------------------

export type EstadoSalvamento = 'salvo' | 'pendente' | 'salvando' | 'erro' | 'conflito';

export interface SituacaoSalvamento {
    estado: EstadoSalvamento;
    ultimoSalvoEm: Date | null;
    erro: ErroClassificado | null;
    conflito: Conflito | null;
}

/**
 * Orquestra a gravação de UMA rodada. Sem timer e sem React: quem usa decide
 * quando chamar `salvar()` (a tela, 2 s depois da última edição).
 *
 * Garantias:
 *   * só vai o que mudou (linhas alteradas/removidas; parâmetros só se mudaram);
 *   * falha NUNCA mexe no que está na tela — o pendente continua pendente e o
 *     próximo `salvar()` tenta de novo;
 *   * conflito (outra pessoa gravou depois que eu abri) não sobrescreve: o
 *     estado vira 'conflito' e nenhuma gravação sai até recarregar;
 *   * reimportação usa a troca atômica de todas as linhas.
 */
export class SalvadorRodada {
    private versao: number;
    private salvos: Map<string, string>;
    private parametrosSalvos: string;
    private geracaoSalva: number;
    private atual: { registros: RegistroLinha[]; parametros: ParametrosRodada; geracao: number } | null = null;
    private emVoo: Promise<void> | null = null;
    situacao: SituacaoSalvamento = { estado: 'salvo', ultimoSalvoEm: null, erro: null, conflito: null };

    constructor(
        private readonly repo: RepositorioBid,
        private readonly rodadaId: string,
        versao: number,
        registrosSalvos: RegistroLinha[],
        parametrosSalvos: ParametrosRodada | null,
        private readonly aoMudar: (s: SituacaoSalvamento) => void = () => {},
    ) {
        this.versao = versao;
        this.salvos = new Map(registrosSalvos.map(r => [r.chave, assinaturaRegistro(r)]));
        this.parametrosSalvos = jsonCanonico(parametrosSalvos);
        this.geracaoSalva = 0;
    }

    get versaoAtual(): number { return this.versao; }

    private mudar(parcial: Partial<SituacaoSalvamento>) {
        this.situacao = { ...this.situacao, ...parcial };
        this.aoMudar(this.situacao);
    }

    /** O que a tela tem agora. Devolve true se há algo a gravar. */
    atualizar(registros: RegistroLinha[], parametros: ParametrosRodada, geracao: number): boolean {
        this.atual = { registros, parametros, geracao };
        const pendente = this.temAlteracoes();
        if (this.situacao.estado === 'conflito') return false;
        if (pendente && this.situacao.estado === 'salvo') this.mudar({ estado: 'pendente' });
        if (!pendente && this.situacao.estado === 'pendente') this.mudar({ estado: 'salvo' });
        return pendente;
    }

    temAlteracoes(): boolean {
        if (!this.atual) return false;
        if (this.atual.geracao !== this.geracaoSalva) return true;
        if (jsonCanonico(this.atual.parametros) !== this.parametrosSalvos) return true;
        const d = diferencaRegistros(this.atual.registros, this.salvos);
        return d.alteradas.length > 0 || d.removidas.length > 0;
    }

    /** Grava o pendente. Chamadas sobrepostas esperam a anterior e gravam o resto. */
    async salvar(): Promise<void> {
        if (this.emVoo) await this.emVoo;
        if (this.situacao.estado === 'conflito' || !this.atual || !this.temAlteracoes()) return;
        this.emVoo = this.gravar().finally(() => { this.emVoo = null; });
        return this.emVoo;
    }

    private async gravar(): Promise<void> {
        const alvo = this.atual;
        if (!alvo) return;
        const substituir = alvo.geracao !== this.geracaoSalva;
        const assinaturaParametros = jsonCanonico(alvo.parametros);
        const parametrosMudaram = assinaturaParametros !== this.parametrosSalvos;
        const d = diferencaRegistros(alvo.registros, this.salvos);
        this.mudar({ estado: 'salvando', erro: null });
        try {
            const r = substituir
                ? await this.repo.substituirLinhas(this.rodadaId, this.versao, alvo.parametros, alvo.registros)
                : await this.repo.salvarRodada(this.rodadaId, this.versao, parametrosMudaram ? alvo.parametros : null, d.alteradas, d.removidas);
            if (!r.ok) {
                this.mudar({ estado: 'conflito', conflito: r.conflito });
                return;
            }
            this.versao = r.versao;
            if (substituir) {
                this.salvos = new Map(alvo.registros.map(x => [x.chave, assinaturaRegistro(x)]));
                this.geracaoSalva = alvo.geracao;
            } else {
                for (const x of d.alteradas) this.salvos.set(x.chave, assinaturaRegistro(x));
                for (const k of d.removidas) this.salvos.delete(k);
            }
            this.parametrosSalvos = assinaturaParametros;
            this.mudar({ estado: this.temAlteracoes() ? 'pendente' : 'salvo', ultimoSalvoEm: new Date(), erro: null });
        } catch (e) {
            // A tela não é tocada: o que estava pendente continua pendente.
            this.mudar({ estado: 'erro', erro: classificarErro(e) });
        }
    }

    /** Depois de fechar/reabrir a rodada: a versão andou por uma ação que não é gravação de linhas. */
    definirVersao(v: number) { this.versao = v; }
}

/**
 * Texto da tela salvo numa rodada, completado com os padrões: rodada salva
 * antes de um parâmetro existir (ex.: pedágio por VPO) abre com o padrão
 * dele, que é o comportamento da época.
 */
export const completarTela = (salva: Partial<ParametrosTela> | null | undefined, cargoType: string): ParametrosTela =>
    ({ ...parametrosTelaPadrao(cargoType), ...(salva ?? {}) });
