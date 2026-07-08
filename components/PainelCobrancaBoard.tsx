import React, { useEffect, useMemo, useState } from 'react';
import { Gauge, RefreshCw, Check, AlertTriangle, Phone, Paperclip, FileText, ExternalLink, X, Users } from 'lucide-react';
import {
    PainelCobranca, CobrancaItem, getPainelCobranca,
    Analista, getAnalistas,
    AnaliseSolicitante, QuoteResumo, getAnaliseCarteira,
    CD_TIPOS, CD_RESULTADOS, getEvidenciaUrl,
} from '../services/contatoDiario';

interface Props {
    currentUser: { id?: string; name?: string };
    onFeedback?: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

type Filtro = 'todos' | 'ausentes' | 'esfriando' | 'emdia';

const labelDe = (arr: { v: string; l: string }[], v: string) => arr.find(x => x.v === v)?.l || v;
const fmtBRL = (v: number) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const PainelCobrancaBoard: React.FC<Props> = ({ onFeedback }) => {
    const [data, setData] = useState<PainelCobranca | null>(null);
    const [loading, setLoading] = useState(true);
    const [limiteDias, setLimiteDias] = useState(7);
    const [filtro, setFiltro] = useState<Filtro>('todos');

    // Filtro por analista (aditivo): ao escolher um, mostra os solicitantes da carteira dele + ação de hoje.
    const [analistas, setAnalistas] = useState<Analista[]>([]);
    const [analistaId, setAnalistaId] = useState('');
    const [analise, setAnalise] = useState<AnaliseSolicitante[] | null>(null);
    const [loadingAnalise, setLoadingAnalise] = useState(false);
    const [quoteModal, setQuoteModal] = useState<QuoteResumo | null>(null);

    const carregar = async (dias = limiteDias) => { setLoading(true); setData(await getPainelCobranca(dias)); setLoading(false); };
    useEffect(() => { carregar(); getAnalistas().then(setAnalistas); }, []);
    useEffect(() => { const t = setTimeout(() => carregar(limiteDias), 300); return () => clearTimeout(t); }, [limiteDias]);

    const carregarAnalise = async (id: string) => {
        if (!id) { setAnalise(null); return; }
        setLoadingAnalise(true);
        setAnalise(await getAnaliseCarteira(id));
        setLoadingAnalise(false);
    };
    useEffect(() => { carregarAnalise(analistaId); /* eslint-disable-next-line */ }, [analistaId]);

    const passaFiltro = (i: CobrancaItem) =>
        filtro === 'todos' ? true : filtro === 'ausentes' ? !i.emDia : filtro === 'esfriando' ? i.esfriando : i.emDia;

    // Agrupa por analista.
    const porAnalista = useMemo(() => {
        const g = new Map<string, { nome: string; itens: CobrancaItem[] }>();
        (data?.itens || []).filter(passaFiltro).forEach(i => {
            const e = g.get(i.analistaId) || { nome: i.analistaNome, itens: [] };
            e.itens.push(i); g.set(i.analistaId, e);
        });
        return Array.from(g.values()).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    }, [data, filtro]);

    const k = data?.kpis;

    const verEvidencia = async (path: string) => {
        const url = await getEvidenciaUrl(path);
        if (url) window.open(url, '_blank', 'noopener'); else onFeedback?.('Não foi possível abrir a evidência.', 'error');
    };

    const Badge: React.FC<{ i: CobrancaItem }> = ({ i }) => i.emDia
        ? <span className="text-[9px] uppercase font-medium px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 flex items-center gap-1"><Check className="w-2.5 h-2.5" /> em dia{i.cotouHoje ? ' · cotou' : ''}{i.contatoHoje ? ' · contato' : ''}</span>
        : i.esfriando
            ? <span className="text-[9px] uppercase font-medium px-1.5 py-0.5 rounded bg-red-100 text-red-700 flex items-center gap-1"><AlertTriangle className="w-2.5 h-2.5" /> esfriando {i.diasParado === null ? 's/ registro' : `${i.diasParado}d`}</span>
            : <span className="text-[9px] uppercase font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">ausente hoje{i.diasParado !== null ? ` · ${i.diasParado}d` : ''}</span>;

    const analistaNome = analistas.find(a => a.id === analistaId)?.nome || '';

    return (
        <div className="space-y-5 animate-fade-in-up">
            <div className="flex items-center gap-3 px-1">
                <Gauge className="w-7 h-7 text-[#111827]" />
                <h1 className="text-2xl font-medium text-[#111827] tracking-tight">Contato Diário · Análise</h1>
                <button onClick={() => { carregar(); carregarAnalise(analistaId); }} title="Recarregar" className="ml-auto p-2 text-[#6b7280] hover:bg-[#f9fafb] rounded-lg"><RefreshCw className="w-4 h-4" /></button>
            </div>

            {/* Filtro por analista */}
            <div className="flex flex-wrap items-center gap-3 bg-white p-3 rounded-xl border border-[#e5e7eb]">
                <Users className="w-4 h-4 text-[#6b7280]" />
                <label className="text-sm text-[#6b7280] flex items-center gap-2">
                    Analista:
                    <select value={analistaId} onChange={e => setAnalistaId(e.target.value)}
                        className="px-3 py-1.5 bg-[#f9fafb] border border-[#e5e7eb] rounded-lg text-sm text-[#111827] outline-none focus:border-[#1d6fb8]">
                        <option value="">— visão geral (todos) —</option>
                        {analistas.map(a => <option key={a.id} value={a.id}>{a.nome}</option>)}
                    </select>
                </label>
                {analistaId && <button onClick={() => setAnalistaId('')} className="text-sm text-[#1d6fb8] hover:underline ml-auto">ver visão geral</button>}
            </div>

            {analistaId ? (
                /* ===== Detalhe do analista escolhido: solicitantes da carteira + ação de HOJE ===== */
                loadingAnalise ? <p className="text-sm text-[#6b7280] px-1">Carregando…</p>
                    : !analise || analise.length === 0 ? (
                        <div className="bg-white border border-[#e5e7eb] rounded-xl p-6 text-center">
                            <p className="text-sm text-[#6b7280]">{analistaNome || 'Este analista'} não tem solicitantes na carteira. Monte a carteira na tela do gestor.</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <div className="flex items-center gap-3 text-[11px] text-[#6b7280] px-1">
                                <span className="font-medium text-[#111827]">{analistaNome}</span>
                                <span>· {analise.length} solicitante(s)</span>
                                <span className="text-red-600 font-medium ml-auto">{analise.filter(a => !a.acao.emDia).length} sem contato hoje</span>
                            </div>
                            {analise.map(row => (
                                <div key={row.solicitanteId}
                                    className={`bg-white border rounded-xl p-4 ${row.acao.emDia ? 'border-[#e5e7eb]' : 'border-red-200 bg-red-50/40'}`}>
                                    <div className="flex items-start gap-3 flex-wrap">
                                        <div className="flex-1 min-w-0">
                                            <span className="text-sm font-semibold text-[#111827]">{row.nome}</span>
                                        </div>
                                        {row.acao.emDia
                                            ? <span className="text-[9px] uppercase font-medium px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 flex items-center gap-1"><Check className="w-2.5 h-2.5" /> em dia</span>
                                            : <span className="text-[10px] uppercase font-semibold px-2 py-1 rounded bg-red-100 text-red-700 flex items-center gap-1.5"><AlertTriangle className="w-3 h-3" /> Sem contato hoje</span>}
                                    </div>

                                    {/* Fonte 1: contato registrado com evidência */}
                                    {row.acao.registrado && (
                                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                                            <span className="uppercase font-medium px-1.5 py-0.5 rounded bg-[#eff6ff] text-[#1d6fb8] flex items-center gap-1"><FileText className="w-2.5 h-2.5" /> Contato registrado</span>
                                            <span className="text-[#6b7280]">{labelDe(CD_TIPOS, row.acao.registrado.tipo)} · {labelDe(CD_RESULTADOS, row.acao.registrado.resultado)}</span>
                                            <span className="text-[#9ca3af]">{new Date(row.acao.registrado.dataHora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                                            <button onClick={() => verEvidencia(row.acao.registrado!.evidenciaPath)} className="text-[#1d6fb8] hover:underline flex items-center gap-1"><Paperclip className="w-3 h-3" /> ver evidência</button>
                                        </div>
                                    )}

                                    {/* Fonte 2: cotou hoje (contato automático). Evidência = a cotação (abre o modal). */}
                                    {row.acao.cotacao && (
                                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                                            <span className="uppercase font-medium px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 flex items-center gap-1"><Check className="w-2.5 h-2.5" /> Contato automático · cotou hoje</span>
                                            <button onClick={() => setQuoteModal(row.acao.cotacao!)} className="text-[#1d6fb8] hover:underline font-medium flex items-center gap-1">
                                                <ExternalLink className="w-3 h-3" /> {row.acao.cotacao.proposalNumber}
                                            </button>
                                        </div>
                                    )}

                                    {!row.acao.emDia && (
                                        <p className="mt-2 text-[11px] text-red-600">Nenhum contato registrado nem cotação hoje. Cobrar o analista.</p>
                                    )}
                                </div>
                            ))}
                        </div>
                    )
            ) : (
                /* ===== Visão geral (comportamento existente, inalterado) ===== */
                <>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        <Kpi label="Carteira" valor={k?.total ?? 0} ativo={filtro === 'todos'} onClick={() => setFiltro('todos')} />
                        <Kpi label="Em dia hoje" valor={k?.emDia ?? 0} cor="text-emerald-600" ativo={filtro === 'emdia'} onClick={() => setFiltro('emdia')} />
                        <Kpi label="Ausentes hoje" valor={k?.ausentes ?? 0} cor="text-amber-600" ativo={filtro === 'ausentes'} onClick={() => setFiltro('ausentes')} />
                        <Kpi label="Esfriando" valor={k?.esfriando ?? 0} cor="text-red-600" ativo={filtro === 'esfriando'} onClick={() => setFiltro('esfriando')} />
                    </div>

                    <div className="flex items-center gap-3 bg-white p-3 rounded-xl border border-[#e5e7eb]">
                        <label className="flex items-center gap-2 text-sm text-[#6b7280]">
                            Esfriando com ≥
                            <input type="number" min={1} value={limiteDias} onChange={e => setLimiteDias(Math.max(1, parseInt(e.target.value) || 7))} className="w-16 px-2 py-1.5 bg-[#f9fafb] border border-[#e5e7eb] rounded-lg text-sm text-center outline-none" />
                            dias sem contato nem cotação
                        </label>
                        {filtro !== 'todos' && <button onClick={() => setFiltro('todos')} className="text-sm text-[#1d6fb8] hover:underline ml-auto">ver todos</button>}
                    </div>

                    {loading ? <p className="text-sm text-[#6b7280] px-1">Carregando…</p> : !data || data.itens.length === 0 ? (
                        <div className="bg-white border border-[#e5e7eb] rounded-xl p-6 text-center"><p className="text-sm text-[#6b7280]">Nenhum solicitante em carteira ainda. Monte a carteira na tela do gestor.</p></div>
                    ) : (
                        <div className="space-y-4">
                            {porAnalista.map(g => (
                                <div key={g.nome} className="bg-white border border-[#e5e7eb] rounded-xl p-4">
                                    <div className="flex items-center gap-2 mb-2">
                                        <Phone className="w-4 h-4 text-[#6b7280]" />
                                        <h3 className="text-sm font-semibold text-[#111827]">{g.nome}</h3>
                                        <span className="text-[11px] text-[#6b7280]">· {g.itens.length} solicitante(s)</span>
                                    </div>
                                    <div className="space-y-1">
                                        {g.itens.map(i => (
                                            <div key={i.solicitanteId} className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-[#f9fafb]">
                                                <span className="text-sm text-[#111827] flex-1">{i.nome}</span>
                                                <Badge i={i} />
                                            </div>
                                        ))}
                                        {g.itens.length === 0 && <p className="text-xs text-[#9ca3af] px-2">nada neste filtro</p>}
                                    </div>
                                </div>
                            ))}
                            {porAnalista.length === 0 && <p className="text-xs text-[#9ca3af] px-1">Nenhum solicitante neste filtro.</p>}
                        </div>
                    )}
                </>
            )}

            {/* Modal de conferência da cotação (só leitura; não sai da tela nem abre a calculadora) */}
            {quoteModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setQuoteModal(null)}>
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-4" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-3">
                            <FileText className="w-5 h-5 text-[#1d6fb8]" />
                            <h3 className="text-lg font-semibold text-[#111827]">Cotação {quoteModal.proposalNumber}</h3>
                            <button onClick={() => setQuoteModal(null)} className="ml-auto p-1.5 text-[#6b7280] hover:bg-[#f9fafb] rounded-lg"><X className="w-4 h-4" /></button>
                        </div>
                        <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                            <Campo label="Cliente" valor={quoteModal.clienteNome} />
                            <Campo label="Solicitante" valor={quoteModal.solicitante || '—'} />
                            <Campo label="Rota" valor={`${quoteModal.origin || '—'} → ${quoteModal.destination || '—'}`} full />
                            <Campo label="Veículo" valor={quoteModal.vehicleType || '—'} />
                            <Campo label="Mercadoria" valor={quoteModal.merchandiseType || '—'} />
                            <Campo label="Valor da carga" valor={fmtBRL(quoteModal.goodsValue)} />
                            <Campo label="Frete total" valor={fmtBRL(quoteModal.totalFreight)} />
                            <Campo label="Ref. cliente" valor={quoteModal.clientReference || '—'} />
                            <Campo label="Criada em" valor={quoteModal.createdAt ? new Date(quoteModal.createdAt).toLocaleString('pt-BR') : '—'} />
                        </div>
                        <p className="text-[11px] text-[#9ca3af] pt-2 border-t border-[#f3f4f6]">Conferência só leitura — a cotação não é alterada.</p>
                    </div>
                </div>
            )}
        </div>
    );
};

const Campo: React.FC<{ label: string; valor: string; full?: boolean }> = ({ label, valor, full }) => (
    <div className={full ? 'col-span-2' : ''}>
        <p className="text-[10px] font-medium uppercase tracking-wider text-[#6b7280]">{label}</p>
        <p className="text-[#111827]">{valor}</p>
    </div>
);

const Kpi: React.FC<{ label: string; valor: number; cor?: string; ativo?: boolean; onClick: () => void }> = ({ label, valor, cor, ativo, onClick }) => (
    <button onClick={onClick} className={`text-left bg-white p-3 rounded-xl border transition-colors cursor-pointer hover:border-[#1d6fb8] ${ativo ? 'border-[#1d6fb8] ring-1 ring-[#1d6fb8]' : 'border-[#e5e7eb]'}`}>
        <p className="text-[10px] font-medium uppercase tracking-wider text-[#6b7280]">{label}</p>
        <p className={`text-2xl font-semibold ${cor || 'text-[#111827]'}`}>{valor}</p>
    </button>
);
