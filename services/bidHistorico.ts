/**
 * Bid em Lote — histórico: o repositório de produção (Supabase).
 *
 * Toda gravação passa pelas funções do banco (migrations_bid_historico.sql),
 * que checam a versão da rodada na mesma transação em que gravam. As regras
 * (rodada fechada, só master, nome único) são do banco; aqui só se traduz.
 *
 * Erros do banco são relançados como vieram: quem chama passa por
 * `classificarErro`, que conhece os códigos e prefixos.
 */

import { supabase } from './supabase';
import {
    resumirResultados,
    type BidResumo, type Conflito, type ParametrosRodada, type RegistroLinha, type RepositorioBid,
    type RespostaGravacao, type RodadaCarregada, type RodadaInfo, type RodadaResumo, type StatusRodada,
    type EntradaLinha,
} from '../utils/bidHistorico';
import type { LinhaBid } from '../utils/bidLote';

interface BidDb {
    id: string; nome: string; cliente: string | null; observacao: string | null;
    atualizado_em: string; atualizado_por: string | null;
}
interface RodadaDb {
    id: string; bid_id: string; numero: number; status: StatusRodada; versao: number;
    parametros: ParametrosRodada | Record<string, never> | null;
    criado_em: string; atualizado_em: string; atualizado_por: string | null;
    fechada_em: string | null; fechada_por: string | null;
}
interface LinhaDb {
    chave_linha: string; ordem: number; entrada: EntradaLinha; resultado: LinhaBid | null;
}
interface LinhaResumoDb {
    rodada_id: string; status: string | null; preco: number | null; margem: number | null;
}
interface RespostaRpc {
    ok?: boolean; versao?: number; conflito?: boolean; status?: StatusRodada;
    atualizado_em?: string; atualizado_por_nome?: string | null;
}

const COLUNAS_RODADA = 'id,bid_id,numero,status,versao,parametros,criado_em,atualizado_em,atualizado_por,fechada_em,fechada_por';
/** O PostgREST devolve no máximo 1.000 linhas por chamada: lê em páginas. */
const PAGINA = 1000;

const nomesDePerfis = async (): Promise<Record<string, string>> => {
    const { data, error } = await supabase.from('profiles').select('id,name');
    if (error) throw error;
    return Object.fromEntries(((data ?? []) as { id: string; name: string }[]).map(p => [p.id, p.name]));
};

/** Rodada recém-criada nasce com `{}`: ainda não tem parâmetros. */
const parametrosValidos = (p: RodadaDb['parametros']): ParametrosRodada | null =>
    p && 'tela' in p ? (p as ParametrosRodada) : null;

const paraInfo = (r: RodadaDb, nomes: Record<string, string>): RodadaInfo => ({
    id: r.id, bidId: r.bid_id, numero: r.numero, status: r.status, versao: Number(r.versao),
    parametros: parametrosValidos(r.parametros),
    criadoEm: r.criado_em, atualizadoEm: r.atualizado_em,
    atualizadoPorNome: r.atualizado_por ? (nomes[r.atualizado_por] ?? null) : null,
    fechadaEm: r.fechada_em,
    fechadaPorNome: r.fechada_por ? (nomes[r.fechada_por] ?? null) : null,
});

const paraRegistro = (l: LinhaDb): RegistroLinha => ({ chave: l.chave_linha, ordem: l.ordem, entrada: l.entrada, resultado: l.resultado });

const paraLinhaDb = (r: RegistroLinha) => ({ chave_linha: r.chave, ordem: r.ordem, entrada: r.entrada, resultado: r.resultado });

const lerResposta = (data: unknown): RespostaGravacao => {
    const r = (data ?? {}) as RespostaRpc;
    if (r.ok && r.versao != null) return { ok: true, versao: Number(r.versao) };
    const conflito: Conflito = {
        versao: r.versao != null ? Number(r.versao) : null,
        status: r.status ?? null,
        atualizadoEm: r.atualizado_em ?? null,
        atualizadoPorNome: r.atualizado_por_nome ?? null,
    };
    return { ok: false, conflito };
};

const linhasDaRodada = async (rodadaId: string): Promise<RegistroLinha[]> => {
    const todas: LinhaDb[] = [];
    for (let de = 0; ; de += PAGINA) {
        const { data, error } = await supabase.from('bid_rodada_linha')
            .select('chave_linha,ordem,entrada,resultado')
            .eq('rodada_id', rodadaId).order('ordem').range(de, de + PAGINA - 1);
        if (error) throw error;
        const pagina = (data ?? []) as LinhaDb[];
        todas.push(...pagina);
        if (pagina.length < PAGINA) break;
    }
    return todas.map(paraRegistro);
};

export const repositorioBidSupabase: RepositorioBid = {
    async listarBids(): Promise<BidResumo[]> {
        const [bids, rodadas, nomes] = await Promise.all([
            supabase.from('bid').select('id,nome,cliente,observacao,atualizado_em,atualizado_por')
                .is('deleted_at', null).order('atualizado_em', { ascending: false }),
            supabase.from('bid_rodada').select('bid_id'),
            nomesDePerfis(),
        ]);
        if (bids.error) throw bids.error;
        if (rodadas.error) throw rodadas.error;
        const contagem = new Map<string, number>();
        for (const r of (rodadas.data ?? []) as { bid_id: string }[]) contagem.set(r.bid_id, (contagem.get(r.bid_id) ?? 0) + 1);
        return ((bids.data ?? []) as BidDb[]).map(b => ({
            id: b.id, nome: b.nome, cliente: b.cliente, observacao: b.observacao,
            rodadas: contagem.get(b.id) ?? 0,
            atualizadoEm: b.atualizado_em,
            atualizadoPorNome: b.atualizado_por ? (nomes[b.atualizado_por] ?? null) : null,
        }));
    },

    async criarBid(nome, cliente, observacao) {
        const { data, error } = await supabase.rpc('bid_criar', { p_nome: nome, p_cliente: cliente, p_observacao: observacao });
        if (error) throw error;
        const r = (data ?? {}) as { bid_id: string; rodada_id: string };
        return { bidId: r.bid_id, rodadaId: r.rodada_id };
    },

    async listarRodadas(bidId: string): Promise<RodadaResumo[]> {
        const [rods, nomes] = await Promise.all([
            supabase.from('bid_rodada').select(COLUNAS_RODADA).eq('bid_id', bidId).order('numero'),
            nomesDePerfis(),
        ]);
        if (rods.error) throw rods.error;
        const rodadas = (rods.data ?? []) as RodadaDb[];
        const ids = rodadas.map(r => r.id);
        const resumoDb: LinhaResumoDb[] = [];
        if (ids.length) {
            for (let de = 0; ; de += PAGINA) {
                // Só os três campos do resultado que o resumo usa — não o JSON inteiro.
                const { data, error } = await supabase.from('bid_rodada_linha')
                    .select('rodada_id,status:resultado->>status,preco:resultado->precoOfertado,margem:resultado->margemLiquidaPercent')
                    .in('rodada_id', ids).order('rodada_id').order('ordem').range(de, de + PAGINA - 1);
                if (error) throw error;
                const pagina = (data ?? []) as LinhaResumoDb[];
                resumoDb.push(...pagina);
                if (pagina.length < PAGINA) break;
            }
        }
        return rodadas.map(r => ({
            ...paraInfo(r, nomes),
            resumo: resumirResultados(resumoDb.filter(l => l.rodada_id === r.id).map(l => ({
                status: l.status, precoOfertado: l.preco, margemLiquidaPercent: l.margem,
            }))),
        }));
    },

    async carregarRodada(rodadaId: string): Promise<RodadaCarregada> {
        const [rod, nomes] = await Promise.all([
            supabase.from('bid_rodada').select(COLUNAS_RODADA).eq('id', rodadaId).single(),
            nomesDePerfis(),
        ]);
        if (rod.error) throw rod.error;
        const r = rod.data as RodadaDb;
        const registros = await linhasDaRodada(r.id);
        let anterior: RegistroLinha[] | null = null;
        if (r.numero > 1) {
            const ant = await supabase.from('bid_rodada').select('id').eq('bid_id', r.bid_id).eq('numero', r.numero - 1).maybeSingle();
            if (ant.error) throw ant.error;
            const antId = (ant.data as { id: string } | null)?.id;
            if (antId) anterior = await linhasDaRodada(antId);
        }
        return { rodada: paraInfo(r, nomes), registros, anterior };
    },

    async salvarRodada(rodadaId, versao, parametros, linhas, remover) {
        const { data, error } = await supabase.rpc('bid_salvar_rodada', {
            p_rodada_id: rodadaId, p_versao: versao, p_parametros: parametros,
            p_linhas: linhas.map(paraLinhaDb), p_remover: remover,
        });
        if (error) throw error;
        return lerResposta(data);
    },

    async substituirLinhas(rodadaId, versao, parametros, linhas) {
        const { data, error } = await supabase.rpc('bid_substituir_linhas', {
            p_rodada_id: rodadaId, p_versao: versao, p_parametros: parametros, p_linhas: linhas.map(paraLinhaDb),
        });
        if (error) throw error;
        return lerResposta(data);
    },

    async mudarStatus(rodadaId, versao, status) {
        const { data, error } = await supabase.rpc('bid_mudar_status_rodada', { p_rodada_id: rodadaId, p_versao: versao, p_status: status });
        if (error) throw error;
        return lerResposta(data);
    },

    async excluirBid(bidId) {
        // Exclusão lógica: o trigger grava deleted_by e recusa quem não é master.
        const { data, error } = await supabase.from('bid')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', bidId).is('deleted_at', null).select('id');
        if (error) throw error;
        if (!data?.length) throw new Error('BID_INEXISTENTE: bid não encontrado ou já excluído.');
    },

    async novaRodada(bidId) {
        const { data, error } = await supabase.rpc('bid_nova_rodada', { p_bid_id: bidId });
        if (error) throw error;
        const r = (data ?? {}) as { rodada_id: string; numero: number };
        return { rodadaId: r.rodada_id, numero: r.numero };
    },
};
