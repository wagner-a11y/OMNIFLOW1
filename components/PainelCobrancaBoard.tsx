import React, { useEffect, useMemo, useState } from 'react';
import { Gauge, RefreshCw, Check, AlertTriangle, Phone } from 'lucide-react';
import { PainelCobranca, CobrancaItem, getPainelCobranca } from '../services/contatoDiario';

interface Props {
    currentUser: { id?: string; name?: string };
    onFeedback?: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

type Filtro = 'todos' | 'ausentes' | 'esfriando' | 'emdia';

export const PainelCobrancaBoard: React.FC<Props> = ({ }) => {
    const [data, setData] = useState<PainelCobranca | null>(null);
    const [loading, setLoading] = useState(true);
    const [limiteDias, setLimiteDias] = useState(7);
    const [filtro, setFiltro] = useState<Filtro>('todos');

    const carregar = async (dias = limiteDias) => { setLoading(true); setData(await getPainelCobranca(dias)); setLoading(false); };
    useEffect(() => { carregar(); }, []);
    useEffect(() => { const t = setTimeout(() => carregar(limiteDias), 300); return () => clearTimeout(t); }, [limiteDias]);

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

    const Badge: React.FC<{ i: CobrancaItem }> = ({ i }) => i.emDia
        ? <span className="text-[9px] uppercase font-medium px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 flex items-center gap-1"><Check className="w-2.5 h-2.5" /> em dia{i.cotouHoje ? ' · cotou' : ''}{i.contatoHoje ? ' · contato' : ''}</span>
        : i.esfriando
            ? <span className="text-[9px] uppercase font-medium px-1.5 py-0.5 rounded bg-red-100 text-red-700 flex items-center gap-1"><AlertTriangle className="w-2.5 h-2.5" /> esfriando {i.diasParado === null ? 's/ registro' : `${i.diasParado}d`}</span>
            : <span className="text-[9px] uppercase font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">ausente hoje{i.diasParado !== null ? ` · ${i.diasParado}d` : ''}</span>;

    return (
        <div className="space-y-5 animate-fade-in-up">
            <div className="flex items-center gap-3 px-1">
                <Gauge className="w-7 h-7 text-[#111827]" />
                <h1 className="text-2xl font-medium text-[#111827] tracking-tight">Contato Diário · Cobrança</h1>
                <button onClick={() => carregar()} title="Recarregar" className="ml-auto p-2 text-[#6b7280] hover:bg-[#f9fafb] rounded-lg"><RefreshCw className="w-4 h-4" /></button>
            </div>

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
        </div>
    );
};

const Kpi: React.FC<{ label: string; valor: number; cor?: string; ativo?: boolean; onClick: () => void }> = ({ label, valor, cor, ativo, onClick }) => (
    <button onClick={onClick} className={`text-left bg-white p-3 rounded-xl border transition-colors cursor-pointer hover:border-[#1d6fb8] ${ativo ? 'border-[#1d6fb8] ring-1 ring-[#1d6fb8]' : 'border-[#e5e7eb]'}`}>
        <p className="text-[10px] font-medium uppercase tracking-wider text-[#6b7280]">{label}</p>
        <p className={`text-2xl font-semibold ${cor || 'text-[#111827]'}`}>{valor}</p>
    </button>
);
