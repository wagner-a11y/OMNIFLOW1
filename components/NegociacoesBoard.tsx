import React, { useEffect, useMemo, useState } from 'react';
import { Activity, RefreshCw, AlertTriangle, Clock, CalendarDays, User, Check, X, Plus, ChevronDown } from 'lucide-react';
import {
    Negociacao, Followup, getNegociacoes, getUltimosFollowups, getFollowups,
    registrarFollowup, encerrarNegociacao, reconciliarEspelhoLocal,
    classifyProximo, Grupo, proximoContatoInicial, diasEmAberto, parseYMD,
} from '../services/negociacoes';

interface Props {
    currentUser: { id?: string; name?: string; role?: string };
    onFeedback?: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

const fmtBRL = (v: number | null) => v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtData = (ymd: string) => { const d = parseYMD(ymd); return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }); };

export const NegociacoesBoard: React.FC<Props> = ({ currentUser, onFeedback }) => {
    const [abertas, setAbertas] = useState<Negociacao[]>([]);
    const [ultimos, setUltimos] = useState<Map<string, Followup>>(new Map());
    const [loading, setLoading] = useState(true);
    const [expandido, setExpandido] = useState<string | null>(null);

    const carregar = async () => {
        setLoading(true);
        const todas = await getNegociacoes();
        const abertasBrutas = todas.filter(n => n.status === 'aberta');
        // Espelho local: fecha as que a cotação de origem já marcou ganha/perdida no OmniFlow.
        const { fechadas } = await reconciliarEspelhoLocal(abertasBrutas);
        const vivas = abertasBrutas.filter(n => !fechadas.has(n.id));
        setAbertas(vivas);
        setUltimos(await getUltimosFollowups(vivas.map(n => n.id)));
        if (fechadas.size > 0) onFeedback?.(`${fechadas.size} negociação(ões) saíram da lista (fechadas no OmniFlow).`, 'info');
        setLoading(false);
    };
    useEffect(() => { carregar(); /* eslint-disable-next-line */ }, []);

    const grupos = useMemo(() => {
        const g: Record<Grupo, Negociacao[]> = { atrasada: [], hoje: [], futura: [] };
        for (const n of abertas) g[classifyProximo(n.proximoContato)].push(n);
        const byData = (a: Negociacao, b: Negociacao) => a.proximoContato.localeCompare(b.proximoContato);
        g.atrasada.sort(byData); g.hoje.sort(byData); g.futura.sort(byData);
        return g;
    }, [abertas]);

    return (
        <div className="space-y-5 animate-fade-in-up">
            <div className="flex items-center gap-3 px-1">
                <Activity className="w-7 h-7 text-[#111827]" />
                <h1 className="text-2xl font-medium text-[#111827] tracking-tight">Acompanhamento de Negociações</h1>
                <button onClick={carregar} title="Recarregar" className="ml-auto p-2 text-[#6b7280] hover:bg-[#f9fafb] rounded-lg"><RefreshCw className="w-4 h-4" /></button>
            </div>

            <div className="grid grid-cols-3 gap-3">
                <Kpi label="Atrasadas" valor={grupos.atrasada.length} cor="text-red-600" />
                <Kpi label="Hoje" valor={grupos.hoje.length} cor="text-amber-600" />
                <Kpi label="Futuras" valor={grupos.futura.length} cor="text-[#111827]" />
            </div>

            {loading ? (
                <p className="text-sm text-[#6b7280] px-1">Carregando…</p>
            ) : abertas.length === 0 ? (
                <div className="bg-white border border-[#e5e7eb] rounded-xl p-6 text-center">
                    <p className="text-sm text-[#6b7280]">Nenhuma negociação aberta. Elas entram aqui automaticamente quando uma cotação é enviada pro Ramper.</p>
                </div>
            ) : (
                <div className="space-y-6">
                    <Secao titulo="Atrasadas" cor="red" itens={grupos.atrasada} icone={<AlertTriangle className="w-4 h-4 text-red-500" />}
                        {...{ currentUser, ultimos, expandido, setExpandido, onFeedback, recarregar: carregar }} />
                    <Secao titulo="Hoje" cor="amber" itens={grupos.hoje} icone={<Clock className="w-4 h-4 text-amber-500" />}
                        {...{ currentUser, ultimos, expandido, setExpandido, onFeedback, recarregar: carregar }} />
                    <Secao titulo="Futuras" cor="slate" itens={grupos.futura} icone={<CalendarDays className="w-4 h-4 text-[#6b7280]" />}
                        {...{ currentUser, ultimos, expandido, setExpandido, onFeedback, recarregar: carregar }} />
                </div>
            )}
        </div>
    );
};

const Kpi: React.FC<{ label: string; valor: number; cor?: string }> = ({ label, valor, cor }) => (
    <div className="bg-white p-3 rounded-xl border border-[#e5e7eb]">
        <p className="text-[10px] font-medium uppercase tracking-wider text-[#6b7280]">{label}</p>
        <p className={`text-2xl font-semibold ${cor || 'text-[#111827]'}`}>{valor}</p>
    </div>
);

interface SecaoProps {
    titulo: string; cor: 'red' | 'amber' | 'slate'; itens: Negociacao[]; icone: React.ReactNode;
    currentUser: Props['currentUser']; ultimos: Map<string, Followup>;
    expandido: string | null; setExpandido: (id: string | null) => void;
    onFeedback?: Props['onFeedback']; recarregar: () => void;
}
const Secao: React.FC<SecaoProps> = ({ titulo, itens, icone, ...rest }) => {
    if (itens.length === 0) return null;
    return (
        <div>
            <div className="flex items-center gap-2 mb-2 px-1">
                {icone}
                <h2 className="text-sm font-semibold text-[#111827]">{titulo}</h2>
                <span className="text-[11px] text-[#6b7280]">· {itens.length}</span>
            </div>
            <div className="space-y-2">
                {itens.map(n => <Card key={n.id} n={n} {...rest} />)}
            </div>
        </div>
    );
};

type CardProps = Omit<SecaoProps, 'titulo' | 'cor' | 'itens' | 'icone'> & { n: Negociacao };
const Card: React.FC<CardProps> = ({ n, currentUser, ultimos, expandido, setExpandido, onFeedback, recarregar }) => {
    const podeEditar = currentUser.role === 'master' || n.donoId === currentUser.id;
    const isDono = n.donoId === currentUser.id;
    const aberto = expandido === n.id;
    const ult = ultimos.get(n.id);

    const [descricao, setDescricao] = useState('');
    const [proxima, setProxima] = useState(n.proximoContato || proximoContatoInicial());
    const [motivo, setMotivo] = useState('');
    const [salvando, setSalvando] = useState(false);
    const [historico, setHistorico] = useState<Followup[] | null>(null);

    const abrir = async () => {
        if (aberto) { setExpandido(null); return; }
        setExpandido(n.id);
        setHistorico(await getFollowups(n.id));
    };

    const onFollowup = async () => {
        if (!descricao.trim()) { onFeedback?.('Descreva o que foi feito no follow-up.', 'info'); return; }
        setSalvando(true);
        const ok = await registrarFollowup(n.id, descricao.trim(), proxima, currentUser.id || '', currentUser.name || '');
        setSalvando(false);
        if (ok) { onFeedback?.('Follow-up registrado.'); setDescricao(''); recarregar(); }
        else onFeedback?.('Não foi possível registrar (só o dono ou o master edita).', 'error');
    };

    const onEncerrar = async (status: 'ganha' | 'perdida') => {
        setSalvando(true);
        const ok = await encerrarNegociacao(n.id, status, motivo.trim() || undefined);
        setSalvando(false);
        if (ok) { onFeedback?.(`Negociação marcada como ${status}.`); recarregar(); }
        else onFeedback?.('Não foi possível encerrar (só o dono ou o master edita).', 'error');
    };

    const dias = diasEmAberto(n.abertaEm);

    return (
        <div className="bg-white border border-[#e5e7eb] rounded-xl overflow-hidden">
            <button onClick={abrir} className="w-full text-left p-4 hover:bg-[#f9fafb] transition-colors">
                <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-[#111827] truncate">{n.clienteNome || 'Cliente não informado'}</span>
                            <span className="text-[11px] text-[#6b7280]">{n.rota || ''}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1 flex-wrap text-[11px] text-[#6b7280]">
                            {n.veiculo && <span>{n.veiculo}</span>}
                            {n.mercadoria && <span>· {n.mercadoria}</span>}
                            <span className="font-medium text-[#111827]">· {fmtBRL(n.valorCotado)}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                            <span className={`text-[10px] uppercase font-medium px-1.5 py-0.5 rounded flex items-center gap-1 ${isDono ? 'bg-blue-100 text-blue-700' : 'bg-[#f1f5f9] text-[#6b7280]'}`}>
                                <User className="w-2.5 h-2.5" /> {isDono ? 'Você' : (n.donoNome || 'Dono')}
                            </span>
                            <span className="text-[10px] text-[#6b7280]">aberta há {dias}d</span>
                            <span className="text-[10px] text-[#6b7280]">· próximo contato {fmtData(n.proximoContato)}</span>
                        </div>
                        <p className="text-[11px] text-[#9ca3af] mt-1 truncate">
                            {ult ? `Último: ${ult.descricao}` : 'Sem follow-up ainda'}
                        </p>
                    </div>
                    <ChevronDown className={`w-4 h-4 text-[#9ca3af] shrink-0 transition-transform ${aberto ? 'rotate-180' : ''}`} />
                </div>
            </button>

            {aberto && (
                <div className="border-t border-[#e5e7eb] p-4 space-y-4 bg-[#fafafa]">
                    {/* Histórico */}
                    <div>
                        <p className="text-[10px] font-medium uppercase tracking-wider text-[#6b7280] mb-2">Follow-ups</p>
                        {historico === null ? <p className="text-xs text-[#9ca3af]">Carregando…</p>
                            : historico.length === 0 ? <p className="text-xs text-[#9ca3af]">Nenhum follow-up ainda.</p>
                                : <div className="space-y-2">
                                    {historico.map(f => (
                                        <div key={f.id} className="text-xs text-[#374151] bg-white border border-[#e5e7eb] rounded-lg p-2">
                                            <div className="flex items-center gap-2 text-[10px] text-[#6b7280] mb-0.5">
                                                <span className="font-medium text-[#111827]">{f.autorNome || 'Analista'}</span>
                                                <span>· {new Date(f.dataHora).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                                                {f.proximoContato && <span>· reagendou p/ {fmtData(f.proximoContato)}</span>}
                                            </div>
                                            {f.descricao}
                                        </div>
                                    ))}
                                </div>}
                    </div>

                    {podeEditar ? (
                        <>
                            {/* Novo follow-up */}
                            <div className="space-y-2">
                                <textarea value={descricao} onChange={e => setDescricao(e.target.value)} rows={2}
                                    placeholder="O que foi feito? (ligação, e-mail, proposta enviada…)"
                                    className="w-full px-3 py-2 bg-white border border-[#e5e7eb] rounded-lg text-sm outline-none focus:border-[#1d6fb8]" />
                                <div className="flex flex-wrap items-center gap-2">
                                    <label className="text-xs text-[#6b7280] flex items-center gap-2">
                                        Próximo contato:
                                        <input type="date" value={proxima} onChange={e => setProxima(e.target.value)}
                                            className="px-2 py-1.5 bg-white border border-[#e5e7eb] rounded-lg text-sm outline-none" />
                                    </label>
                                    <button onClick={onFollowup} disabled={salvando}
                                        className="ml-auto flex items-center gap-1.5 px-4 py-2 bg-[#1d6fb8] text-white rounded-lg text-xs font-medium hover:bg-[#155a96] disabled:opacity-50">
                                        <Plus className="w-3.5 h-3.5" /> Registrar follow-up
                                    </button>
                                </div>
                            </div>

                            {/* Encerrar */}
                            <div className="pt-3 border-t border-[#e5e7eb] space-y-2">
                                <p className="text-[10px] font-medium uppercase tracking-wider text-[#6b7280]">Encerrar negociação</p>
                                <input value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Motivo (opcional)"
                                    className="w-full px-3 py-2 bg-white border border-[#e5e7eb] rounded-lg text-sm outline-none focus:border-[#1d6fb8]" />
                                <div className="flex gap-2">
                                    <button onClick={() => onEncerrar('ganha')} disabled={salvando}
                                        className="flex items-center gap-1.5 px-4 py-2 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-medium hover:bg-emerald-100 disabled:opacity-50">
                                        <Check className="w-3.5 h-3.5" /> Ganha
                                    </button>
                                    <button onClick={() => onEncerrar('perdida')} disabled={salvando}
                                        className="flex items-center gap-1.5 px-4 py-2 bg-red-50 text-red-700 border border-red-200 rounded-lg text-xs font-medium hover:bg-red-100 disabled:opacity-50">
                                        <X className="w-3.5 h-3.5" /> Perdida
                                    </button>
                                </div>
                            </div>
                        </>
                    ) : (
                        <p className="text-xs text-[#9ca3af]">Somente o dono ({n.donoNome || '—'}) ou um master pode registrar follow-up ou encerrar.</p>
                    )}
                </div>
            )}
        </div>
    );
};
