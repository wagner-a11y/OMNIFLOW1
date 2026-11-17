// ============================================================================
// BID EM LOTE — HISTÓRICO POR NOME E POR RODADA
//
// Lista de bids -> pasta do bid (rodadas) -> rodada (a planilha, BidLote).
// Não existe mais planilha solta: importar só dentro de uma rodada.
//
// Salvamento automático: 2 s depois da última edição, só o que mudou, pelo
// `SalvadorRodada` (utils/bidHistorico.ts). Falha NUNCA apaga a tela;
// conflito (outra pessoa gravou depois que eu abri) não sobrescreve.
// As regras (rodada fechada, só master, nome único) são garantidas no banco.
// ============================================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronRight, FileDown, FolderOpen, Lock, LockOpen, Plus, RotateCcw, Search } from 'lucide-react';
import { BidLote, type MudancaRodada } from './BidLote';
import {
    SalvadorRodada, classificarErro, nomeArquivoRodada, parametrosTelaPadrao, precoPorChave, validarNomeBid,
    type BidResumo, type RepositorioBid, type RodadaCarregada, type RodadaResumo, type SituacaoSalvamento,
} from '../utils/bidHistorico';
import { exportarBidExcel } from '../services/bidLote';
import type { LinhaBid, ParametrosBid } from '../utils/bidLote';
import type { ANTTCoefficients, FederalTaxes } from '../types';

const ESPERA_SALVAR_MS = 2000;

type Tela =
    | { tipo: 'lista' }
    | { tipo: 'pasta'; bidId: string }
    | { tipo: 'rodada'; bidId: string; rodadaId: string };

interface Props {
    repositorio: RepositorioBid;
    fedTaxes: FederalTaxes;
    vehicleConfigs: Record<string, ANTTCoefficients & { factor?: number; axles?: number }>;
    tiposDeCarga: string[];
    ehMaster: boolean;
    onFeedback?: (msg: string, tipo?: 'success' | 'error' | 'info') => void;
    telaCheia: boolean;
    onTelaCheia: (v: boolean) => void;
}

const dataHora = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
const hora = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const n2 = (v: number | null) => (v == null ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const p2 = (v: number | null) => (v == null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`);

const botao = 'px-3 py-1.5 rounded-md font-medium text-[12px] transition-colors inline-flex items-center gap-1.5 disabled:opacity-40';
const botaoPrimario = `${botao} bg-[#1d6fb8] text-white hover:bg-[#185a96]`;
const botaoSecundario = `${botao} bg-white border border-[#e5e7eb] text-[#111827] hover:bg-[#f3f4f6]`;

const SeloStatus: React.FC<{ status: 'rascunho' | 'fechada' }> = ({ status }) => (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium uppercase tracking-tight ${
        status === 'fechada' ? 'bg-[#f3f4f6] text-[#374151] border-[#d1d5db]' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
        {status === 'fechada' ? <Lock className="w-3 h-3" strokeWidth={1.75} /> : null}
        {status === 'fechada' ? 'Fechada' : 'Rascunho'}
    </span>
);

/** Exporta uma rodada a partir do que está SALVO (pasta) ou na tela (rodada). */
const exportarRodada = (
    bid: { nome: string; cliente: string | null },
    numero: number,
    status: 'rascunho' | 'fechada',
    linhas: LinhaBid[],
    calculo: ParametrosBid,
    precoAnterior: Record<string, number | null> | null,
    dataCalculo: Date,
) => {
    const porLinha = precoAnterior
        ? Object.fromEntries(linhas.map(l => [l.linhaExcel, precoAnterior[`linha-${l.linhaExcel}`] ?? null]))
        : null;
    exportarBidExcel(linhas, calculo, nomeArquivoRodada(bid.nome, numero), {
        cabecalho: [
            ['Bid', bid.nome],
            ['Cliente', bid.cliente || '—'],
            ['Rodada', String(numero)],
            ['Status', status === 'fechada' ? 'Fechada' : 'Rascunho'],
        ],
        precoAnterior: porLinha,
    }, dataCalculo);
};

export const BidHistorico: React.FC<Props> = props => {
    const { repositorio, onFeedback } = props;
    const [tela, setTela] = useState<Tela>({ tipo: 'lista' });
    const [bids, setBids] = useState<BidResumo[] | null>(null);
    const [erroLista, setErroLista] = useState<string | null>(null);

    const carregarBids = useCallback(async () => {
        try {
            setErroLista(null);
            setBids(await repositorio.listarBids());
        } catch (e) {
            setErroLista(classificarErro(e).mensagem);
        }
    }, [repositorio]);

    useEffect(() => { if (tela.tipo === 'lista') carregarBids(); }, [tela.tipo, carregarBids]);

    const bidAtual = tela.tipo !== 'lista' ? bids?.find(b => b.id === tela.bidId) ?? null : null;

    if (tela.tipo === 'lista') {
        return (
            <ListaBids
                bids={bids}
                erro={erroLista}
                repositorio={repositorio}
                onAbrir={id => setTela({ tipo: 'pasta', bidId: id })}
                onCriado={async (bidId, rodadaId) => { await carregarBids(); setTela({ tipo: 'rodada', bidId, rodadaId }); }}
                onFeedback={onFeedback}
            />
        );
    }
    if (tela.tipo === 'pasta') {
        return (
            <PastaBid
                bid={bidAtual}
                bidId={tela.bidId}
                repositorio={repositorio}
                ehMaster={props.ehMaster}
                onVoltar={() => setTela({ tipo: 'lista' })}
                onAbrirRodada={rodadaId => setTela({ tipo: 'rodada', bidId: tela.bidId, rodadaId })}
                onFeedback={onFeedback}
            />
        );
    }
    return (
        <RodadaBid
            key={tela.rodadaId}
            {...props}
            bid={bidAtual}
            bidId={tela.bidId}
            rodadaId={tela.rodadaId}
            onIrParaLista={() => { props.onTelaCheia(false); setTela({ tipo: 'lista' }); }}
            onIrParaPasta={() => { props.onTelaCheia(false); setTela({ tipo: 'pasta', bidId: tela.bidId }); }}
            onAbrirRodada={rodadaId => setTela({ tipo: 'rodada', bidId: tela.bidId, rodadaId })}
        />
    );
};

// ---------------------------------------------------------------------------
// Lista de bids
// ---------------------------------------------------------------------------

const ListaBids: React.FC<{
    bids: BidResumo[] | null;
    erro: string | null;
    repositorio: RepositorioBid;
    onAbrir: (bidId: string) => void;
    onCriado: (bidId: string, rodadaId: string) => void;
    onFeedback?: Props['onFeedback'];
}> = ({ bids, erro, repositorio, onAbrir, onCriado, onFeedback }) => {
    const [busca, setBusca] = useState('');
    const [novo, setNovo] = useState(false);
    const [nome, setNome] = useState('');
    const [cliente, setCliente] = useState('');
    const [observacao, setObservacao] = useState('');
    const [erroNovo, setErroNovo] = useState<string | null>(null);
    const [criando, setCriando] = useState(false);

    const filtrados = useMemo(() => {
        const q = busca.trim().toLowerCase();
        return (bids ?? []).filter(b => !q || b.nome.toLowerCase().includes(q) || (b.cliente ?? '').toLowerCase().includes(q));
    }, [bids, busca]);

    const criar = async () => {
        const invalido = validarNomeBid(nome, (bids ?? []).map(b => b.nome));
        if (invalido) { setErroNovo(invalido); return; }
        setCriando(true);
        try {
            const r = await repositorio.criarBid(nome.trim(), cliente, observacao);
            onFeedback?.(`Bid "${nome.trim()}" criado com a Rodada 1.`, 'success');
            setNovo(false); setNome(''); setCliente(''); setObservacao(''); setErroNovo(null);
            onCriado(r.bidId, r.rodadaId);
        } catch (e) {
            setErroNovo(classificarErro(e).mensagem);
        } finally {
            setCriando(false);
        }
    };

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[15px] font-medium text-[#111827]">Bids</h3>
                <div className="flex items-center gap-2">
                    <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#9ca3af]" strokeWidth={1.75} />
                        <input
                            value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por nome ou cliente"
                            className="w-64 pl-8 pr-3 py-1.5 bg-white border border-[#e5e7eb] rounded-md text-[13px] outline-none focus:border-[#1d6fb8]"
                        />
                    </div>
                    <button onClick={() => setNovo(true)} className={botaoPrimario}><Plus className="w-3.5 h-3.5" strokeWidth={1.75} /> Novo bid</button>
                </div>
            </div>

            {novo && (
                <div className="bg-white border border-[#bfdbfe] rounded-lg p-4 space-y-3">
                    <p className="text-[13px] font-medium text-[#111827]">Novo bid</p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                            <label className="text-[10px] font-medium text-[#6b7280] uppercase block mb-1">Nome *</label>
                            <input autoFocus value={nome} onChange={e => { setNome(e.target.value); setErroNovo(null); }} className="w-full px-2.5 py-1.5 border border-[#e5e7eb] rounded-md text-[13px] outline-none focus:border-[#1d6fb8]" />
                        </div>
                        <div>
                            <label className="text-[10px] font-medium text-[#6b7280] uppercase block mb-1">Cliente</label>
                            <input value={cliente} onChange={e => setCliente(e.target.value)} className="w-full px-2.5 py-1.5 border border-[#e5e7eb] rounded-md text-[13px] outline-none focus:border-[#1d6fb8]" />
                        </div>
                        <div>
                            <label className="text-[10px] font-medium text-[#6b7280] uppercase block mb-1">Observação</label>
                            <input value={observacao} onChange={e => setObservacao(e.target.value)} className="w-full px-2.5 py-1.5 border border-[#e5e7eb] rounded-md text-[13px] outline-none focus:border-[#1d6fb8]" />
                        </div>
                    </div>
                    {erroNovo && <p className="text-[12px] text-red-600">{erroNovo}</p>}
                    <div className="flex gap-2">
                        <button onClick={criar} disabled={criando} className={botaoPrimario}>{criando ? 'Criando…' : 'Criar bid e abrir a Rodada 1'}</button>
                        <button onClick={() => { setNovo(false); setErroNovo(null); }} className={botaoSecundario}>Cancelar</button>
                    </div>
                </div>
            )}

            {erro && <p className="text-[12px] text-red-600">{erro}</p>}

            <div className="bg-white border border-[#e5e7eb] rounded-lg overflow-hidden">
                <table className="w-full text-[13px]">
                    <thead className="bg-[#f3f4f6] text-[11px] text-[#6b7280]">
                        <tr>
                            <th className="px-3 py-2 text-left font-medium">Nome</th>
                            <th className="px-3 py-2 text-left font-medium">Cliente</th>
                            <th className="px-3 py-2 text-right font-medium">Rodadas</th>
                            <th className="px-3 py-2 text-left font-medium">Última alteração</th>
                            <th className="px-3 py-2 text-left font-medium">Quem alterou</th>
                            <th className="px-3 py-2" />
                        </tr>
                    </thead>
                    <tbody>
                        {bids == null && <tr><td colSpan={6} className="px-3 py-6 text-center text-[#9ca3af]">Carregando…</td></tr>}
                        {bids != null && filtrados.length === 0 && (
                            <tr><td colSpan={6} className="px-3 py-6 text-center text-[#9ca3af]">{busca ? 'Nenhum bid com esse nome.' : 'Nenhum bid ainda. Crie o primeiro.'}</td></tr>
                        )}
                        {filtrados.map(b => (
                            <tr key={b.id} onClick={() => onAbrir(b.id)} className="border-t border-[#f3f4f6] hover:bg-[#f9fafb] cursor-pointer">
                                <td className="px-3 py-2 font-medium text-[#111827]">
                                    <FolderOpen className="w-3.5 h-3.5 inline mr-1.5 text-[#1d6fb8] -mt-0.5" strokeWidth={1.75} />{b.nome}
                                </td>
                                <td className="px-3 py-2 text-[#374151]">{b.cliente || '—'}</td>
                                <td className="px-3 py-2 text-right tabular-nums">{b.rodadas}</td>
                                <td className="px-3 py-2 text-[#374151] tabular-nums">{dataHora(b.atualizadoEm)}</td>
                                <td className="px-3 py-2 text-[#374151]">{b.atualizadoPorNome || '—'}</td>
                                <td className="px-3 py-2 text-right text-[#9ca3af]"><ChevronRight className="w-4 h-4 inline" strokeWidth={1.75} /></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

// ---------------------------------------------------------------------------
// Pasta do bid
// ---------------------------------------------------------------------------

const PastaBid: React.FC<{
    bid: BidResumo | null;
    bidId: string;
    repositorio: RepositorioBid;
    ehMaster: boolean;
    onVoltar: () => void;
    onAbrirRodada: (rodadaId: string) => void;
    onFeedback?: Props['onFeedback'];
}> = ({ bid, bidId, repositorio, onVoltar, onAbrirRodada, onFeedback }) => {
    const [rodadas, setRodadas] = useState<RodadaResumo[] | null>(null);
    const [erro, setErro] = useState<string | null>(null);
    const [ocupado, setOcupado] = useState(false);

    const carregar = useCallback(async () => {
        try { setRodadas(await repositorio.listarRodadas(bidId)); } catch (e) { setErro(classificarErro(e).mensagem); }
    }, [repositorio, bidId]);
    useEffect(() => { carregar(); }, [carregar]);

    const ultima = rodadas?.[rodadas.length - 1];

    const novaRodada = async () => {
        setOcupado(true);
        try {
            const r = await repositorio.novaRodada(bidId);
            onFeedback?.(`Rodada ${r.numero} criada como cópia da anterior. Nenhuma consulta ao Qualp.`, 'success');
            onAbrirRodada(r.rodadaId);
        } catch (e) {
            onFeedback?.(classificarErro(e).mensagem, 'error');
        } finally {
            setOcupado(false);
        }
    };

    const exportar = async (rodadaId: string) => {
        try {
            const c = await repositorio.carregarRodada(rodadaId);
            const linhas = c.registros.map(r => r.resultado).filter((l): l is LinhaBid => l != null);
            const calculo = c.rodada.parametros?.calculo;
            if (!linhas.length || !calculo) { onFeedback?.('Esta rodada ainda não tem linhas salvas.', 'info'); return; }
            exportarRodada(
                { nome: bid?.nome ?? 'bid', cliente: bid?.cliente ?? null }, c.rodada.numero, c.rodada.status, linhas, calculo,
                c.anterior ? precoPorChave(c.anterior) : null, new Date(c.rodada.atualizadoEm),
            );
            onFeedback?.('Excel gerado a partir da rodada salva.');
        } catch (e) {
            onFeedback?.(classificarErro(e).mensagem, 'error');
        }
    };

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-[13px]">
                    <button onClick={onVoltar} className="text-[#1d6fb8] hover:underline inline-flex items-center gap-1"><ArrowLeft className="w-3.5 h-3.5" strokeWidth={1.75} /> Bids</button>
                    <ChevronRight className="w-3.5 h-3.5 text-[#9ca3af]" strokeWidth={1.75} />
                    <span className="font-medium text-[#111827]">{bid?.nome ?? '…'}</span>
                    {bid?.cliente && <span className="text-[#6b7280]">· {bid.cliente}</span>}
                </div>
                {ultima?.status === 'fechada' && (
                    <button onClick={novaRodada} disabled={ocupado} className={botaoPrimario}>
                        <Plus className="w-3.5 h-3.5" strokeWidth={1.75} /> Nova rodada
                    </button>
                )}
            </div>
            {bid?.observacao && <p className="text-[12px] text-[#6b7280]">{bid.observacao}</p>}
            {erro && <p className="text-[12px] text-red-600">{erro}</p>}

            <div className="bg-white border border-[#e5e7eb] rounded-lg overflow-hidden">
                <table className="w-full text-[13px]">
                    <thead className="bg-[#f3f4f6] text-[11px] text-[#6b7280]">
                        <tr>
                            <th className="px-3 py-2 text-left font-medium">Rodada</th>
                            <th className="px-3 py-2 text-left font-medium">Status</th>
                            <th className="px-3 py-2 text-left font-medium">Data</th>
                            <th className="px-3 py-2 text-right font-medium">Linhas</th>
                            <th className="px-3 py-2 text-right font-medium">Total ofertado R$</th>
                            <th className="px-3 py-2 text-right font-medium">Margem líq. média</th>
                            <th className="px-3 py-2 text-left font-medium">Última alteração</th>
                            <th className="px-3 py-2 text-right font-medium">Ações</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rodadas == null && <tr><td colSpan={8} className="px-3 py-6 text-center text-[#9ca3af]">Carregando…</td></tr>}
                        {rodadas?.map(r => (
                            <tr key={r.id} className="border-t border-[#f3f4f6]">
                                <td className="px-3 py-2 font-medium text-[#111827]">Rodada {r.numero}</td>
                                <td className="px-3 py-2"><SeloStatus status={r.status} /></td>
                                <td className="px-3 py-2 tabular-nums text-[#374151]">{dataHora(r.criadoEm)}</td>
                                <td className="px-3 py-2 text-right tabular-nums">{r.resumo.linhas}</td>
                                <td className="px-3 py-2 text-right tabular-nums">{n2(r.resumo.totalOfertado)}</td>
                                <td className="px-3 py-2 text-right tabular-nums">{p2(r.resumo.margemMedia)}</td>
                                <td className="px-3 py-2 text-[#374151] text-[12px]">{dataHora(r.atualizadoEm)}{r.atualizadoPorNome ? ` · ${r.atualizadoPorNome}` : ''}</td>
                                <td className="px-3 py-2 text-right whitespace-nowrap">
                                    <button onClick={() => onAbrirRodada(r.id)} className={botaoSecundario}>Abrir</button>{' '}
                                    <button onClick={() => exportar(r.id)} disabled={!r.resumo.linhas} className={botaoSecundario}>
                                        <FileDown className="w-3.5 h-3.5 text-[#1d6fb8]" strokeWidth={1.75} /> Excel
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {ultima?.status === 'rascunho' && (
                <p className="text-[11px] text-[#6b7280]">"Nova rodada" aparece quando a Rodada {ultima.numero} for fechada.</p>
            )}
        </div>
    );
};

// ---------------------------------------------------------------------------
// Rodada
// ---------------------------------------------------------------------------

const RodadaBid: React.FC<Props & {
    bid: BidResumo | null;
    bidId: string;
    rodadaId: string;
    onIrParaLista: () => void;
    onIrParaPasta: () => void;
    onAbrirRodada: (rodadaId: string) => void;
}> = ({ repositorio, fedTaxes, vehicleConfigs, tiposDeCarga, ehMaster, onFeedback, telaCheia, onTelaCheia, bid, bidId, rodadaId, onIrParaLista, onIrParaPasta }) => {
    const [carregada, setCarregada] = useState<RodadaCarregada | null>(null);
    const [ehUltima, setEhUltima] = useState(false);
    const [erro, setErro] = useState<string | null>(null);
    const [situacao, setSituacao] = useState<SituacaoSalvamento>({ estado: 'salvo', ultimoSalvoEm: null, erro: null, conflito: null });
    const [confirmarFechar, setConfirmarFechar] = useState(false);
    const [recarga, setRecarga] = useState(0);
    const salvadorRef = useRef<SalvadorRodada | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        let vivo = true;
        (async () => {
            try {
                setErro(null);
                const [c, rods] = await Promise.all([repositorio.carregarRodada(rodadaId), repositorio.listarRodadas(bidId)]);
                if (!vivo) return;
                salvadorRef.current = new SalvadorRodada(repositorio, rodadaId, c.rodada.versao, c.registros, c.rodada.parametros, setSituacao);
                setSituacao(salvadorRef.current.situacao);
                setEhUltima(rods[rods.length - 1]?.id === rodadaId);
                setCarregada(c);
            } catch (e) {
                if (vivo) setErro(classificarErro(e).mensagem);
            }
        })();
        return () => { vivo = false; if (timerRef.current) clearTimeout(timerRef.current); };
    }, [repositorio, rodadaId, bidId, recarga]);

    // Aviso ao sair com alteração não gravada.
    useEffect(() => {
        const aoSair = (e: BeforeUnloadEvent) => {
            if (salvadorRef.current?.temAlteracoes()) { e.preventDefault(); e.returnValue = ''; }
        };
        window.addEventListener('beforeunload', aoSair);
        return () => window.removeEventListener('beforeunload', aoSair);
    }, []);

    const agendar = useCallback(() => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => { salvadorRef.current?.salvar(); }, ESPERA_SALVAR_MS);
    }, []);

    const aoMudar = useCallback((m: MudancaRodada) => {
        const s = salvadorRef.current;
        if (!s) return;
        if (s.atualizar(m.registros, { tela: m.tela, calculo: m.calculo }, m.geracao)) agendar();
    }, [agendar]);

    const salvarAgora = async () => {
        if (timerRef.current) clearTimeout(timerRef.current);
        await salvadorRef.current?.salvar();
    };

    const fecharRodada = async () => {
        setConfirmarFechar(false);
        await salvarAgora();
        const s = salvadorRef.current;
        if (!s || s.situacao.estado !== 'salvo') { onFeedback?.('Há alterações não salvas. Resolva antes de fechar.', 'error'); return; }
        try {
            const r = await repositorio.mudarStatus(rodadaId, s.versaoAtual, 'fechada');
            if (!r.ok) { setSituacao({ ...s.situacao, estado: 'conflito', conflito: r.conflito }); return; }
            onFeedback?.('Rodada fechada. A partir de agora ela é somente leitura.', 'success');
            setRecarga(x => x + 1);
        } catch (e) {
            onFeedback?.(classificarErro(e).mensagem, 'error');
        }
    };

    const reabrir = async () => {
        const s = salvadorRef.current;
        if (!s) return;
        try {
            const r = await repositorio.mudarStatus(rodadaId, s.versaoAtual, 'rascunho');
            if (!r.ok) { setSituacao({ ...s.situacao, estado: 'conflito', conflito: r.conflito }); return; }
            onFeedback?.('Rodada reaberta para edição.', 'success');
            setRecarga(x => x + 1);
        } catch (e) {
            onFeedback?.(classificarErro(e).mensagem, 'error');
        }
    };

    if (erro) {
        return (
            <div className="space-y-3">
                <button onClick={onIrParaPasta} className="text-[#1d6fb8] text-[13px] hover:underline">Voltar ao bid</button>
                <p className="text-[13px] text-red-600">{erro}</p>
            </div>
        );
    }
    if (!carregada) return <p className="text-[13px] text-[#9ca3af]">Carregando rodada…</p>;

    const { rodada, registros, anterior } = carregada;
    const fechada = rodada.status === 'fechada';
    const bidInfo = { nome: bid?.nome ?? 'bid', cliente: bid?.cliente ?? null };

    const indicador = () => {
        if (fechada) return <span className="text-[11px] text-[#6b7280]">Fechada em {dataHora(rodada.fechadaEm)}{rodada.fechadaPorNome ? ` por ${rodada.fechadaPorNome}` : ''}</span>;
        switch (situacao.estado) {
            case 'salvando': return <span className="text-[11px] text-[#6b7280]">Salvando…</span>;
            case 'pendente': return <span className="text-[11px] text-[#6b7280]">Alterações a salvar…</span>;
            case 'erro': return (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-red-600">
                    <AlertTriangle className="w-3.5 h-3.5" strokeWidth={1.75} /> Não salvo{situacao.erro ? `: ${situacao.erro.mensagem}` : ''}
                    <button onClick={salvarAgora} className="ml-1 px-2 py-0.5 rounded border border-red-300 bg-white hover:bg-red-50">Tentar de novo</button>
                </span>
            );
            case 'conflito': return <span className="text-[11px] font-medium text-red-600">Não salvo: conflito de edição</span>;
            default: return (
                <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700">
                    <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                    {situacao.ultimoSalvoEm ? `Salvo às ${hora(situacao.ultimoSalvoEm)}` : `Salvo · ${dataHora(rodada.atualizadoEm)}`}
                </span>
            );
        }
    };

    const barraTopo = (
        <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <nav className="flex items-center gap-1.5 text-[13px]">
                    <button onClick={onIrParaLista} className="text-[#1d6fb8] hover:underline">Bids</button>
                    <ChevronRight className="w-3.5 h-3.5 text-[#9ca3af]" strokeWidth={1.75} />
                    <button onClick={onIrParaPasta} className="text-[#1d6fb8] hover:underline max-w-[280px] truncate">{bidInfo.nome}</button>
                    <ChevronRight className="w-3.5 h-3.5 text-[#9ca3af]" strokeWidth={1.75} />
                    <span className="font-medium text-[#111827]">Rodada {rodada.numero}</span>
                </nav>
                <SeloStatus status={rodada.status} />
                {indicador()}
                <span className="flex-1" />
                {!fechada && (
                    <button onClick={() => setConfirmarFechar(true)} className={botaoSecundario}>
                        <Lock className="w-3.5 h-3.5" strokeWidth={1.75} /> Fechar rodada
                    </button>
                )}
                {fechada && ehMaster && ehUltima && (
                    <button onClick={reabrir} className={botaoSecundario}>
                        <LockOpen className="w-3.5 h-3.5" strokeWidth={1.75} /> Reabrir rodada
                    </button>
                )}
            </div>
            {situacao.estado === 'conflito' && situacao.conflito && (
                <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-md">
                    <p className="text-[12px] text-red-800">
                        Esta rodada foi alterada por <strong>{situacao.conflito.atualizadoPorNome || 'outra pessoa'}</strong> em {dataHora(situacao.conflito.atualizadoEm)},
                        depois que você abriu. Suas alterações NÃO foram gravadas para não sobrescrever as dela.
                    </p>
                    <button onClick={() => setRecarga(x => x + 1)} className={botaoSecundario}><RotateCcw className="w-3.5 h-3.5" strokeWidth={1.75} /> Recarregar a rodada</button>
                </div>
            )}
            {confirmarFechar && (
                <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-md">
                    <p className="text-[12px] text-amber-900">
                        Fechar a Rodada {rodada.numero}? Ela fica <strong>somente leitura</strong> e guarda os números de agora.
                        {ehMaster ? ' Você (master) pode reabrir enquanto ela for a última.' : ' Só o master pode reabrir.'}
                    </p>
                    <div className="flex gap-2">
                        <button onClick={fecharRodada} className={botaoPrimario}>Fechar rodada</button>
                        <button onClick={() => setConfirmarFechar(false)} className={botaoSecundario}>Cancelar</button>
                    </div>
                </div>
            )}
        </div>
    );

    return (
        <BidLote
            key={`${rodada.id}-${rodada.versao}-${recarga}`}
            fedTaxes={fedTaxes}
            vehicleConfigs={vehicleConfigs}
            tiposDeCarga={tiposDeCarga}
            onFeedback={onFeedback}
            inicial={{ tela: rodada.parametros?.tela ?? parametrosTelaPadrao(tiposDeCarga[0] || 'Carga geral'), registros }}
            somenteLeitura={fechada}
            calculoSalvo={rodada.parametros?.calculo ?? null}
            precoAnterior={anterior ? precoPorChave(anterior) : null}
            onMudanca={fechada ? undefined : aoMudar}
            onExportar={(linhas, calculo) => {
                exportarRodada(bidInfo, rodada.numero, rodada.status, linhas, calculo, anterior ? precoPorChave(anterior) : null,
                    fechada ? new Date(rodada.atualizadoEm) : new Date());
                onFeedback?.('Excel gerado.');
            }}
            barraTopo={barraTopo}
            telaCheia={telaCheia}
            onTelaCheia={onTelaCheia}
        />
    );
};
