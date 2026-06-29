import React, { useEffect, useMemo, useState } from 'react';
import { X, Plus, Target, AlertTriangle, ShieldCheck, Search, RefreshCw } from 'lucide-react';
import {
    CrmEmpresa, CrmContato, CrmEvento, ETAPAS, ETAPAS_FUNIL, corStatus, deriveOrigem,
    diasParado, isContaQuente, isEmpocada, empresaSemProva, contatoSemProva, contatoTemProva, contatoPrecisaProva, parseDataBR,
} from '../services/crm';
import {
    getCrmEmpresas, getCrmEventos, createCrmEmpresa, updateCrmEmpresa, moveCrmEmpresaEtapa, createCrmContato,
} from '../services/database';

interface Props {
    currentUser: { id?: string; name?: string };
    onFeedback?: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

const fmtBR = (iso: string | null): string => {
    if (!iso) return '—';
    const d = new Date(iso + 'T00:00:00Z');
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
};

const STATUS_OPCOES = ['Novo', 'Aguardando', 'Em andamento', 'Respondeu', 'Interesse', 'Sem retorno', 'Barreira'];

export const ProspeccaoBoard: React.FC<Props> = ({ currentUser, onFeedback }) => {
    const [empresas, setEmpresas] = useState<CrmEmpresa[]>([]);
    const [loading, setLoading] = useState(true);
    const [busca, setBusca] = useState('');
    const [filtroOrigem, setFiltroOrigem] = useState<'todas' | 'Optus' | 'Omnicargo'>('todas');
    const [soEmpocados, setSoEmpocados] = useState(false);
    const [soSemProva, setSoSemProva] = useState(false);
    const [limiteDias, setLimiteDias] = useState(10);
    const [selecionada, setSelecionada] = useState<CrmEmpresa | null>(null);
    const [showNova, setShowNova] = useState(false);

    const autor = { id: currentUser.id, nome: currentUser.name };
    const carregar = async () => { setLoading(true); setEmpresas(await getCrmEmpresas()); setLoading(false); };
    useEffect(() => { carregar(); }, []);

    // Mantém a empresa selecionada em sincronia após recarregar.
    useEffect(() => {
        if (selecionada) { const atual = empresas.find(e => e.id === selecionada.id); if (atual) setSelecionada(atual); }
    }, [empresas]);

    const filtradas = useMemo(() => {
        const q = busca.trim().toLowerCase();
        return empresas.filter(e => {
            if (q && !e.nome.toLowerCase().includes(q) && !e.contatos.some(c => c.nome.toLowerCase().includes(q))) return false;
            if (filtroOrigem !== 'todas' && !e.contatos.some(c => c.origem === filtroOrigem)) return false;
            if (soEmpocados && !isEmpocada(e, limiteDias)) return false;
            if (soSemProva && !empresaSemProva(e)) return false;
            return true;
        });
    }, [empresas, busca, filtroOrigem, soEmpocados, soSemProva, limiteDias]);

    const kpis = useMemo(() => ({
        total: empresas.length,
        optus: empresas.filter(e => e.contatos.some(c => c.origem === 'Optus')).length,
        omni: empresas.filter(e => e.contatos.some(c => c.origem === 'Omnicargo')).length,
        quentes: empresas.filter(isContaQuente).length,
        empocados: empresas.filter(e => isEmpocada(e, limiteDias)).length,
        semProva: empresas.filter(empresaSemProva).length,
    }), [empresas, limiteDias]);

    const porEtapa = (etapa: string) => filtradas.filter(e => e.etapa === etapa);

    return (
        <div className="space-y-5 animate-fade-in-up">
            {/* Cabeçalho + KPIs */}
            <div className="flex items-center gap-3 px-1">
                <Target className="w-7 h-7 text-[#111827]" />
                <h1 className="text-2xl font-medium text-[#111827] tracking-tight">Prospecção · Mini CRM</h1>
                <button onClick={carregar} title="Recarregar" className="ml-auto p-2 text-[#6b7280] hover:bg-[#f9fafb] rounded-lg"><RefreshCw className="w-4 h-4" /></button>
                <button onClick={() => setShowNova(true)} className="flex items-center gap-2 bg-[#1d6fb8] text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-[#1a5f9e]"><Plus className="w-4 h-4" /> Nova empresa</button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <Kpi label="Empresas" valor={kpis.total} />
                <Kpi label="Com Optus" valor={kpis.optus} />
                <Kpi label="Com Omnicargo" valor={kpis.omni} />
                <Kpi label="Quentes" valor={kpis.quentes} cor="text-emerald-600" />
                <Kpi label="Empoçados" valor={kpis.empocados} cor="text-red-600" ativo={soEmpocados} onClick={() => setSoEmpocados(v => !v)} />
                <Kpi label="Sem prova" valor={kpis.semProva} cor="text-amber-600" ativo={soSemProva} onClick={() => setSoSemProva(v => !v)} />
            </div>

            {/* Filtros */}
            <div className="flex flex-wrap items-center gap-3 bg-white p-3 rounded-xl border border-[#e5e7eb]">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6b7280]" />
                    <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar empresa ou contato" className="pl-9 pr-3 py-2 bg-[#f9fafb] border border-[#e5e7eb] rounded-lg text-sm outline-none focus:border-[#1d6fb8] w-64" />
                </div>
                <select value={filtroOrigem} onChange={e => setFiltroOrigem(e.target.value as any)} className="px-3 py-2 bg-[#f9fafb] border border-[#e5e7eb] rounded-lg text-sm outline-none">
                    <option value="todas">Todas as origens</option>
                    <option value="Optus">Optus</option>
                    <option value="Omnicargo">Omnicargo</option>
                </select>
                <label className="flex items-center gap-2 text-sm text-[#6b7280]">
                    Empoçar com ≥
                    <input type="number" min={1} value={limiteDias} onChange={e => setLimiteDias(Math.max(1, parseInt(e.target.value) || 10))} className="w-16 px-2 py-1.5 bg-[#f9fafb] border border-[#e5e7eb] rounded-lg text-sm outline-none text-center" />
                    dias
                </label>
                {(soEmpocados || soSemProva || filtroOrigem !== 'todas' || busca) && (
                    <button onClick={() => { setSoEmpocados(false); setSoSemProva(false); setFiltroOrigem('todas'); setBusca(''); }} className="text-sm text-[#1d6fb8] hover:underline">limpar filtros</button>
                )}
            </div>

            {/* Kanban */}
            {loading ? <p className="text-sm text-[#6b7280] px-1">Carregando…</p> : (
                <div className="flex gap-4 overflow-x-auto pb-4">
                    {ETAPAS.map(etapa => {
                        const lista = porEtapa(etapa);
                        return (
                            <div key={etapa} className="shrink-0 w-72">
                                <div className="flex items-center justify-between px-2 mb-2">
                                    <span className="text-xs font-semibold uppercase tracking-wide text-[#111827]">{etapa}</span>
                                    <span className="text-xs font-medium text-[#6b7280] bg-[#f3f4f6] px-2 py-0.5 rounded-full">{lista.length}</span>
                                </div>
                                <div className="space-y-2">
                                    {lista.map(e => <Card key={e.id} empresa={e} limiteDias={limiteDias} onClick={() => setSelecionada(e)} />)}
                                    {lista.length === 0 && <div className="text-[11px] text-[#9ca3af] px-2 py-4 text-center border border-dashed border-[#e5e7eb] rounded-lg">vazio</div>}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {showNova && <NovaEmpresaModal onClose={() => setShowNova(false)} onSaved={async () => { setShowNova(false); await carregar(); }} autor={autor} onFeedback={onFeedback} />}
            {selecionada && <DetalheModal empresa={selecionada} limiteDias={limiteDias} autor={autor} onClose={() => setSelecionada(null)} onChanged={carregar} onFeedback={onFeedback} />}
        </div>
    );
};

const Kpi: React.FC<{ label: string; valor: number; cor?: string; ativo?: boolean; onClick?: () => void }> = ({ label, valor, cor, ativo, onClick }) => (
    <button onClick={onClick} disabled={!onClick} className={`text-left bg-white p-3 rounded-xl border transition-colors ${ativo ? 'border-[#1d6fb8] ring-1 ring-[#1d6fb8]' : 'border-[#e5e7eb]'} ${onClick ? 'cursor-pointer hover:border-[#1d6fb8]' : ''}`}>
        <p className="text-[10px] font-medium uppercase tracking-wider text-[#6b7280]">{label}</p>
        <p className={`text-2xl font-semibold ${cor || 'text-[#111827]'}`}>{valor}</p>
    </button>
);

const Card: React.FC<{ empresa: CrmEmpresa; limiteDias: number; onClick: () => void }> = ({ empresa, limiteDias, onClick }) => {
    const empocada = isEmpocada(empresa, limiteDias);
    const dias = diasParado(empresa.lastTouch);
    const semProva = empresaSemProva(empresa);
    const origem = deriveOrigem(empresa.contatos);
    return (
        <div onClick={onClick} className={`cursor-pointer p-3 rounded-xl border shadow-sm hover:border-[#1d6fb8] transition-all ${empocada ? 'bg-red-50 border-red-200' : 'bg-white border-[#e5e7eb]'}`}>
            <div className="flex items-start justify-between gap-2">
                <p className="font-medium text-sm text-[#111827] leading-tight">{empresa.nome}</p>
                <span className="shrink-0 text-[10px] text-[#6b7280] bg-[#f3f4f6] px-1.5 py-0.5 rounded-full">{empresa.contatos.length}</span>
            </div>
            <div className="flex items-center gap-1 mt-1.5">
                {empresa.contatos.slice(0, 4).map(c => <span key={c.id} title={`${c.nome} · ${c.status}`} className="w-2.5 h-2.5 rounded-full" style={{ background: corStatus(c.status) }} />)}
                {empresa.contatos.length > 4 && <span className="text-[9px] text-[#9ca3af]">+{empresa.contatos.length - 4}</span>}
            </div>
            <div className="flex flex-wrap gap-1 mt-2">
                {origem && <span className="text-[8px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#eff6ff] text-[#1d6fb8]">{origem}</span>}
                {empocada && <span className="text-[8px] font-medium uppercase px-1.5 py-0.5 rounded bg-red-100 text-red-700">parado {dias === null ? 's/ registro' : `há ${dias}d`}</span>}
                {semProva && <span className="text-[8px] font-medium uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 flex items-center gap-1"><AlertTriangle className="w-2.5 h-2.5" /> sem prova</span>}
            </div>
            {empresa.proximoPasso && <p className="text-[10px] text-[#6b7280] mt-2 line-clamp-2">▸ {empresa.proximoPasso}</p>}
        </div>
    );
};

const NovaEmpresaModal: React.FC<{ onClose: () => void; onSaved: () => void; autor: any; onFeedback?: Props['onFeedback'] }> = ({ onClose, onSaved, autor, onFeedback }) => {
    const [nome, setNome] = useState('');
    const [etapa, setEtapa] = useState<string>('Contato inicial');
    const [responsavel, setResponsavel] = useState('');
    const [proximoPasso, setProximoPasso] = useState('');
    const [salvando, setSalvando] = useState(false);
    const salvar = async () => {
        if (!nome.trim()) { onFeedback?.('Informe o nome da empresa.', 'error'); return; }
        setSalvando(true);
        const id = await createCrmEmpresa({ nome: nome.trim(), etapa, responsavel, proximoPasso }, autor);
        setSalvando(false);
        if (id) { onFeedback?.('Empresa criada.', 'success'); onSaved(); } else onFeedback?.('Erro ao criar empresa.', 'error');
    };
    return (
        <Overlay onClose={onClose} titulo="Nova empresa">
            <div className="space-y-3">
                <Campo label="Nome *"><input value={nome} onChange={e => setNome(e.target.value)} className="inp" autoFocus /></Campo>
                <Campo label="Etapa"><select value={etapa} onChange={e => setEtapa(e.target.value)} className="inp">{ETAPAS.map(et => <option key={et} value={et}>{et}</option>)}</select></Campo>
                <Campo label="Responsável"><input value={responsavel} onChange={e => setResponsavel(e.target.value)} className="inp" /></Campo>
                <Campo label="Próximo passo"><textarea value={proximoPasso} onChange={e => setProximoPasso(e.target.value)} rows={2} className="inp" /></Campo>
                <button onClick={salvar} disabled={salvando} className="w-full py-2.5 bg-[#1d6fb8] text-white rounded-lg text-sm font-medium hover:bg-[#1a5f9e] disabled:opacity-50">{salvando ? 'Salvando…' : 'Criar empresa'}</button>
            </div>
        </Overlay>
    );
};

const DetalheModal: React.FC<{ empresa: CrmEmpresa; limiteDias: number; autor: any; onClose: () => void; onChanged: () => void; onFeedback?: Props['onFeedback'] }> = ({ empresa, limiteDias, autor, onClose, onChanged, onFeedback }) => {
    const [eventos, setEventos] = useState<CrmEvento[]>([]);
    const [etapa, setEtapa] = useState(empresa.etapa);
    const [responsavel, setResponsavel] = useState(empresa.responsavel);
    const [proximoPasso, setProximoPasso] = useState(empresa.proximoPasso);
    const [showAddContato, setShowAddContato] = useState(false);
    const dias = diasParado(empresa.lastTouch);

    useEffect(() => { getCrmEventos(empresa.id).then(setEventos); }, [empresa.id, empresa.atualizadoEm]);

    const salvarCampos = async () => {
        if (etapa !== empresa.etapa) await moveCrmEmpresaEtapa(empresa.id, empresa.etapa, etapa, autor);
        await updateCrmEmpresa(empresa.id, { responsavel, proximoPasso });
        onFeedback?.('Empresa atualizada.', 'success');
        await onChanged();
    };

    return (
        <Overlay onClose={onClose} titulo={empresa.nome} largo>
            <div className="grid md:grid-cols-2 gap-5">
                <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                        <Campo label="Etapa"><select value={etapa} onChange={e => setEtapa(e.target.value)} className="inp">{ETAPAS.map(et => <option key={et} value={et}>{et}</option>)}</select></Campo>
                        <Campo label="Responsável"><input value={responsavel} onChange={e => setResponsavel(e.target.value)} className="inp" /></Campo>
                    </div>
                    <Campo label="Próximo passo"><textarea value={proximoPasso} onChange={e => setProximoPasso(e.target.value)} rows={2} className="inp" /></Campo>
                    <p className="text-xs text-[#6b7280]">Último contato: <strong className="text-[#111827]">{fmtBR(empresa.lastTouch)}</strong>{dias !== null && `, há ${dias} dia(s)`}{isEmpocada(empresa, limiteDias) && <span className="text-red-600 font-medium"> · empoçado</span>}</p>
                    <button onClick={salvarCampos} className="px-4 py-2 bg-[#1d6fb8] text-white rounded-lg text-sm font-medium hover:bg-[#1a5f9e]">Salvar</button>

                    <div className="pt-2">
                        <div className="flex items-center justify-between mb-2">
                            <h4 className="text-sm font-semibold text-[#111827]">Contatos ({empresa.contatos.length})</h4>
                            <button onClick={() => setShowAddContato(s => !s)} className="text-xs text-[#1d6fb8] hover:underline flex items-center gap-1"><Plus className="w-3 h-3" /> contato</button>
                        </div>
                        {showAddContato && <AddContatoForm empresaId={empresa.id} autor={autor} onSaved={async () => { setShowAddContato(false); await onChanged(); }} onFeedback={onFeedback} />}
                        <div className="space-y-2 mt-2">
                            {empresa.contatos.map(c => <ContatoRow key={c.id} c={c} />)}
                            {empresa.contatos.length === 0 && <p className="text-xs text-[#9ca3af]">Sem contatos ainda.</p>}
                        </div>
                    </div>
                </div>

                <div>
                    <h4 className="text-sm font-semibold text-[#111827] mb-2">Linha do tempo</h4>
                    <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
                        {eventos.map(ev => (
                            <div key={ev.id} className="text-xs border-l-2 border-[#e5e7eb] pl-3 py-1">
                                <p className="text-[#111827]">{ev.texto}</p>
                                <p className="text-[10px] text-[#9ca3af]">{new Date(ev.data).toLocaleString('pt-BR')} {ev.autorNome && `· ${ev.autorNome}`}{ev.link && <a href={ev.link} target="_blank" rel="noopener noreferrer" className="text-[#1d6fb8] ml-1">prova</a>}</p>
                            </div>
                        ))}
                        {eventos.length === 0 && <p className="text-xs text-[#9ca3af]">Sem eventos.</p>}
                    </div>
                </div>
            </div>
        </Overlay>
    );
};

const ContatoRow: React.FC<{ c: CrmContato }> = ({ c }) => {
    const semProva = contatoSemProva(c);
    return (
        <div className="border border-[#e5e7eb] rounded-lg p-2.5">
            <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: corStatus(c.status) }} title={c.status} />
                <span className="font-medium text-xs text-[#111827]">{c.nome || '(sem nome)'}</span>
                {c.cargo && <span className="text-[10px] text-[#6b7280]">· {c.cargo}</span>}
                <span className="ml-auto text-[8px] uppercase font-medium px-1.5 py-0.5 rounded bg-[#eff6ff] text-[#1d6fb8]">{c.origem}</span>
                {contatoPrecisaProva(c.status) && (
                    semProva
                        ? <span className="text-[8px] uppercase font-medium px-1.5 py-0.5 rounded bg-red-100 text-red-700">sem prova</span>
                        : <span className="text-[8px] uppercase font-medium px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 flex items-center gap-0.5"><ShieldCheck className="w-2.5 h-2.5" /> prova</span>
                )}
            </div>
            <div className="text-[10px] text-[#6b7280] mt-1 flex flex-wrap gap-x-3">
                {c.email && <span>{c.email}</span>}{c.telefone && <span>{c.telefone}</span>}{c.canal && <span>canal: {c.canal}</span>}{c.data && <span>{fmtBR(c.data)}</span>}
            </div>
            {c.resumoUltimo && <p className="text-[10px] text-[#6b7280] mt-1">{c.resumoUltimo}</p>}
            {(c.evidencia || c.codigo) && <p className="text-[10px] mt-1">{c.evidencia && <a href={c.evidencia} target="_blank" rel="noopener noreferrer" className="text-[#1d6fb8]">abrir prova</a>}{c.codigo && <span className="text-[#6b7280] ml-2">cód: {c.codigo}</span>}</p>}
        </div>
    );
};

const AddContatoForm: React.FC<{ empresaId: string; autor: any; onSaved: () => void; onFeedback?: Props['onFeedback'] }> = ({ empresaId, autor, onSaved, onFeedback }) => {
    const [f, setF] = useState<Partial<CrmContato>>({ origem: 'Omnicargo', status: 'Novo' });
    const [dataTxt, setDataTxt] = useState('');
    const [salvando, setSalvando] = useState(false);
    const set = (k: keyof CrmContato, v: any) => setF(p => ({ ...p, [k]: v }));
    const salvar = async () => {
        const data = dataTxt ? parseDataBR(dataTxt) : null;
        if (dataTxt && !data) { onFeedback?.('Data inválida (use 28/06 ou 28/06/2026).', 'error'); return; }
        // Regra de prova: se o status afirma conversa real, exigir prova.
        if (contatoPrecisaProva(f.status || '') && !contatoTemProva({ ...f, data } as CrmContato)) {
            onFeedback?.('Esse status precisa de prova (link, código de campanha ou print).', 'error'); return;
        }
        setSalvando(true);
        const ok = await createCrmContato(empresaId, { ...f, data }, autor);
        setSalvando(false);
        if (ok) { onFeedback?.('Contato adicionado.', 'success'); onSaved(); } else onFeedback?.('Erro ao salvar contato.', 'error');
    };
    return (
        <div className="bg-[#f9fafb] border border-[#e5e7eb] rounded-lg p-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
                <input placeholder="Nome" className="inp" onChange={e => set('nome', e.target.value)} />
                <input placeholder="Cargo" className="inp" onChange={e => set('cargo', e.target.value)} />
                <input placeholder="E-mail" className="inp" onChange={e => set('email', e.target.value)} />
                <input placeholder="Telefone" className="inp" onChange={e => set('telefone', e.target.value)} />
                <input placeholder="Canal" className="inp" onChange={e => set('canal', e.target.value)} />
                <input placeholder="Data (28/06)" className="inp" value={dataTxt} onChange={e => setDataTxt(e.target.value)} />
                <select className="inp" value={f.origem} onChange={e => set('origem', e.target.value)}><option>Omnicargo</option><option>Optus</option></select>
                <select className="inp" value={f.status} onChange={e => set('status', e.target.value)}>{STATUS_OPCOES.map(s => <option key={s}>{s}</option>)}</select>
                <input placeholder="Evidência (link)" className="inp col-span-2" onChange={e => set('evidencia', e.target.value)} />
                <input placeholder="Código campanha (MC DC)" className="inp" onChange={e => set('codigo', e.target.value)} />
                <input placeholder="Resumo do contato" className="inp" onChange={e => set('resumoUltimo', e.target.value)} />
            </div>
            <button onClick={salvar} disabled={salvando} className="w-full py-2 bg-[#1d6fb8] text-white rounded-lg text-xs font-medium hover:bg-[#1a5f9e] disabled:opacity-50">{salvando ? 'Salvando…' : 'Adicionar contato'}</button>
        </div>
    );
};

const Overlay: React.FC<{ onClose: () => void; titulo: string; largo?: boolean; children: React.ReactNode }> = ({ onClose, titulo, largo, children }) => (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[120] flex items-center justify-center p-6 animate-fade-in" onClick={onClose}>
        <div className={`bg-white w-full ${largo ? 'max-w-4xl' : 'max-w-md'} rounded-xl border border-[#e5e7eb] shadow-lg p-6 max-h-[90vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-medium text-[#111827]">{titulo}</h3>
                <button onClick={onClose} className="p-1.5 text-[#6b7280] hover:bg-[#f9fafb] rounded-md"><X className="w-4 h-4" /></button>
            </div>
            {children}
        </div>
    </div>
);

const Campo: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <label className="block"><span className="block text-[11px] font-medium text-[#6b7280] mb-1">{label}</span>{children}</label>
);
