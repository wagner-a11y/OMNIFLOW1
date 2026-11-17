/**
 * Repositório de bids EM MEMÓRIA, com as mesmas regras que o banco garante em
 * migrations_bid_historico.sql (nome único entre não excluídos, versão inteira,
 * rodada fechada somente leitura, nova rodada só com a última fechada,
 * reabertura só pelo master e só da última, cópia fiel na nova rodada).
 *
 * Usado pelos testes e pela tela de demonstração — nunca pela produção, que
 * usa services/bidHistorico.ts. As recusas saem com o MESMO prefixo de
 * mensagem do banco, então `classificarErro` é exercitado de verdade.
 */

import {
    normalizarNomeBid, resumirResultados,
    type BidResumo, type ParametrosRodada, type RegistroLinha, type RepositorioBid, type RespostaGravacao,
    type RodadaCarregada, type RodadaInfo, type RodadaResumo, type StatusRodada,
} from './bidHistorico';

export interface UsuarioMemoria {
    id: string;
    nome: string;
    master: boolean;
}

interface BidMem {
    id: string; nome: string; cliente: string | null; observacao: string | null;
    atualizadoEm: string; atualizadoPor: string; deletedAt: string | null;
}
interface RodadaMem {
    id: string; bidId: string; numero: number; status: StatusRodada; versao: number;
    parametros: ParametrosRodada | null; criadoEm: string; atualizadoEm: string; atualizadoPor: string;
    fechadaEm: string | null; fechadaPor: string | null;
}

const copia = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export class RepositorioBidMemoria implements RepositorioBid {
    private bids: BidMem[] = [];
    private rodadas: RodadaMem[] = [];
    private linhas = new Map<string, RegistroLinha[]>();
    private seq = 0;
    private relogio = Date.parse('2026-11-17T09:00:00Z');
    private falhas: unknown[] = [];
    /** Quantas gravações chegaram (sucesso ou não). */
    gravacoes = 0;

    constructor(public usuario: UsuarioMemoria, private nomes: Record<string, string> = {}) {
        this.nomes[usuario.id] = usuario.nome;
    }

    /** Troca o usuário (simula outra pessoa na mesma rodada). */
    comoUsuario(u: UsuarioMemoria): this { this.usuario = u; this.nomes[u.id] = u.nome; return this; }

    /** A próxima gravação falha com este erro (rede, sessão expirada...). */
    falharProxima(erro: unknown) { this.falhas.push(erro); }

    private agora(): string { this.relogio += 60_000; return new Date(this.relogio).toISOString(); }
    private id(p: string): string { return `${p}-${++this.seq}`; }
    private nome(id: string | null): string | null { return id ? (this.nomes[id] ?? null) : null; }
    private talvezFalhar() { const f = this.falhas.shift(); if (f !== undefined) throw f; }

    private info(r: RodadaMem): RodadaInfo {
        return {
            id: r.id, bidId: r.bidId, numero: r.numero, status: r.status, versao: r.versao,
            parametros: copia(r.parametros), criadoEm: r.criadoEm, atualizadoEm: r.atualizadoEm,
            atualizadoPorNome: this.nome(r.atualizadoPor), fechadaEm: r.fechadaEm, fechadaPorNome: this.nome(r.fechadaPor),
        };
    }
    private rodada(id: string): RodadaMem {
        const r = this.rodadas.find(x => x.id === id);
        if (!r) throw new Error('RODADA_INEXISTENTE: rodada não encontrada.');
        return r;
    }
    private tocar(r: RodadaMem) {
        r.versao += 1;
        r.atualizadoEm = this.agora();
        r.atualizadoPor = this.usuario.id;
        const b = this.bids.find(x => x.id === r.bidId);
        if (b) { b.atualizadoEm = r.atualizadoEm; b.atualizadoPor = this.usuario.id; }
    }
    private conflito(r: RodadaMem): RespostaGravacao {
        return { ok: false, conflito: { versao: r.versao, status: r.status, atualizadoEm: r.atualizadoEm, atualizadoPorNome: this.nome(r.atualizadoPor) } };
    }

    async listarBids(): Promise<BidResumo[]> {
        return this.bids.filter(b => !b.deletedAt)
            .sort((a, b) => b.atualizadoEm.localeCompare(a.atualizadoEm))
            .map(b => ({
                id: b.id, nome: b.nome, cliente: b.cliente, observacao: b.observacao,
                rodadas: this.rodadas.filter(r => r.bidId === b.id).length,
                atualizadoEm: b.atualizadoEm, atualizadoPorNome: this.nome(b.atualizadoPor),
            }));
    }

    async criarBid(nome: string, cliente: string, observacao: string) {
        this.talvezFalhar();
        const n = nome.trim();
        if (!n) throw new Error('O nome é obrigatório.');
        if (this.bids.some(b => !b.deletedAt && normalizarNomeBid(b.nome) === normalizarNomeBid(n))) {
            throw { code: '23505', message: 'duplicate key value violates unique constraint "bid_nome_unico_ativo"' };
        }
        const t = this.agora();
        const bid: BidMem = { id: this.id('bid'), nome: n, cliente: cliente.trim() || null, observacao: observacao.trim() || null, atualizadoEm: t, atualizadoPor: this.usuario.id, deletedAt: null };
        this.bids.push(bid);
        const rod: RodadaMem = { id: this.id('rodada'), bidId: bid.id, numero: 1, status: 'rascunho', versao: 1, parametros: null, criadoEm: t, atualizadoEm: t, atualizadoPor: this.usuario.id, fechadaEm: null, fechadaPor: null };
        this.rodadas.push(rod);
        this.linhas.set(rod.id, []);
        return { bidId: bid.id, rodadaId: rod.id };
    }

    async listarRodadas(bidId: string): Promise<RodadaResumo[]> {
        return this.rodadas.filter(r => r.bidId === bidId).sort((a, b) => a.numero - b.numero).map(r => ({
            ...this.info(r),
            resumo: resumirResultados((this.linhas.get(r.id) ?? []).map(l => ({
                status: l.resultado?.status ?? null,
                precoOfertado: l.resultado?.precoOfertado ?? null,
                margemLiquidaPercent: l.resultado?.margemLiquidaPercent ?? null,
            }))),
        }));
    }

    async carregarRodada(rodadaId: string): Promise<RodadaCarregada> {
        const r = this.rodada(rodadaId);
        const ant = this.rodadas.find(x => x.bidId === r.bidId && x.numero === r.numero - 1);
        return {
            rodada: this.info(r),
            registros: copia([...(this.linhas.get(r.id) ?? [])].sort((a, b) => a.ordem - b.ordem)),
            anterior: ant ? copia(this.linhas.get(ant.id) ?? []) : null,
        };
    }

    async salvarRodada(rodadaId: string, versao: number, parametros: ParametrosRodada | null, linhas: RegistroLinha[], remover: string[]): Promise<RespostaGravacao> {
        this.gravacoes++;
        this.talvezFalhar();
        const r = this.rodada(rodadaId);
        if (r.versao !== versao) return this.conflito(r);
        if (r.status === 'fechada') throw new Error('RODADA_FECHADA: rodada fechada é somente leitura.');
        const atuais = (this.linhas.get(r.id) ?? []).filter(l => !remover.includes(l.chave));
        for (const l of copia(linhas)) {
            const i = atuais.findIndex(x => x.chave === l.chave);
            if (i >= 0) atuais[i] = l; else atuais.push(l);
        }
        this.linhas.set(r.id, atuais);
        if (parametros) r.parametros = copia(parametros);
        this.tocar(r);
        return { ok: true, versao: r.versao };
    }

    async substituirLinhas(rodadaId: string, versao: number, parametros: ParametrosRodada | null, linhas: RegistroLinha[]): Promise<RespostaGravacao> {
        this.gravacoes++;
        this.talvezFalhar();
        const r = this.rodada(rodadaId);
        if (r.versao !== versao) return this.conflito(r);
        if (r.status === 'fechada') throw new Error('RODADA_FECHADA: rodada fechada é somente leitura.');
        this.linhas.set(r.id, copia(linhas));
        if (parametros) r.parametros = copia(parametros);
        this.tocar(r);
        return { ok: true, versao: r.versao };
    }

    async mudarStatus(rodadaId: string, versao: number, status: StatusRodada): Promise<RespostaGravacao> {
        this.talvezFalhar();
        const r = this.rodada(rodadaId);
        if (r.versao !== versao) return this.conflito(r);
        if (r.status === 'fechada') {
            if (status !== 'rascunho') throw new Error('RODADA_FECHADA: rodada fechada é somente leitura.');
            if (!this.usuario.master) throw new Error('SO_MASTER: só o master reabre uma rodada fechada.');
            if (this.rodadas.some(x => x.bidId === r.bidId && x.numero > r.numero)) {
                throw new Error('RODADA_ANTIGA: só a última rodada do bid pode ser reaberta.');
            }
            r.status = 'rascunho'; r.fechadaEm = null; r.fechadaPor = null;
        } else if (status === 'fechada') {
            r.status = 'fechada'; r.fechadaEm = this.agora(); r.fechadaPor = this.usuario.id;
        }
        this.tocar(r);
        return { ok: true, versao: r.versao };
    }

    async excluirBid(bidId: string): Promise<void> {
        this.talvezFalhar();
        if (!this.usuario.master) throw new Error('SO_MASTER: só o master exclui ou restaura um bid.');
        const b = this.bids.find(x => x.id === bidId && !x.deletedAt);
        if (!b) throw new Error('BID_INEXISTENTE: bid não encontrado ou excluído.');
        b.deletedAt = this.agora();
    }

    async novaRodada(bidId: string) {
        this.talvezFalhar();
        const doBid = this.rodadas.filter(r => r.bidId === bidId).sort((a, b) => b.numero - a.numero);
        const ultima = doBid[0];
        if (!ultima) throw new Error('BID_INEXISTENTE: bid sem rodadas.');
        if (doBid.some(r => r.status === 'rascunho')) throw new Error('RODADA_ABERTA: feche a última rodada antes de abrir uma nova.');
        const t = this.agora();
        const nova: RodadaMem = { id: this.id('rodada'), bidId, numero: ultima.numero + 1, status: 'rascunho', versao: 1, parametros: copia(ultima.parametros), criadoEm: t, atualizadoEm: t, atualizadoPor: this.usuario.id, fechadaEm: null, fechadaPor: null };
        this.rodadas.push(nova);
        this.linhas.set(nova.id, copia(this.linhas.get(ultima.id) ?? []));
        const b = this.bids.find(x => x.id === bidId);
        if (b) { b.atualizadoEm = t; b.atualizadoPor = this.usuario.id; }
        return { rodadaId: nova.id, numero: nova.numero };
    }
}
