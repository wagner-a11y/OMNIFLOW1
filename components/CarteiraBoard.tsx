import React, { useEffect, useMemo, useState } from 'react';
import { Users, Plus, X, Trash2, RefreshCw, Check, Link2, Building2 } from 'lucide-react';
import {
    SolicitanteCotacao, CdSolicitante, Analista, CdAtribuicao, ClienteRef,
    getSolicitantesCotacao, getCdSolicitantes, createCdSolicitante, updateCdSolicitante, deleteCdSolicitante,
    getAnalistas, getCdAtribuicoes, setCdAtribuicao, removeCdAtribuicao, getClientes, getMapaSolicitanteClientes,
} from '../services/contatoDiario';

interface Props {
    currentUser: { id?: string; name?: string };
    onFeedback?: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export const CarteiraBoard: React.FC<Props> = ({ currentUser, onFeedback }) => {
    const [aba, setAba] = useState<'solicitantes' | 'carteira' | 'clientes'>('solicitantes');
    const [loading, setLoading] = useState(true);
    const [raw, setRaw] = useState<SolicitanteCotacao[]>([]);
    const [canon, setCanon] = useState<CdSolicitante[]>([]);
    const [analistas, setAnalistas] = useState<Analista[]>([]);
    const [atrib, setAtrib] = useState<CdAtribuicao[]>([]);
    const [clientes, setClientes] = useState<ClienteRef[]>([]);
    const [mapaCli, setMapaCli] = useState<Map<string, string[]>>(new Map());
    const [sel, setSel] = useState<Set<string>>(new Set());
    const [nomeCanon, setNomeCanon] = useState('');

    const autorId = currentUser.id;
    const carregar = async () => {
        setLoading(true);
        const [r, c, a, at, cl, mp] = await Promise.all([getSolicitantesCotacao(), getCdSolicitantes(), getAnalistas(), getCdAtribuicoes(), getClientes(), getMapaSolicitanteClientes()]);
        setRaw(r); setCanon(c); setAnalistas(a); setAtrib(at); setClientes(cl); setMapaCli(mp); setLoading(false);
    };
    useEffect(() => { carregar(); }, []);

    // Variações já cobertas por algum canônico (alias).
    const mapeados = useMemo(() => new Set(canon.flatMap(c => c.aliases)), [canon]);
    const naoMapeados = useMemo(() => raw.filter(r => !mapeados.has(r.nome)), [raw, mapeados]);
    const atribPorSol = useMemo(() => new Map(atrib.map(a => [a.solicitanteId, a.analistaId])), [atrib]);
    const nomeAnalista = (id?: string) => analistas.find(a => a.id === id)?.nome || '';
    const nomeCliente = (id?: string | null) => clientes.find(c => c.id === id)?.nome || '';
    const normN = (s: string) => (s || '').trim().toLowerCase();
    // Palpite: se todas as variações do solicitante cotaram p/ UM único cliente, sugere.
    const sugestaoCliente = (c: CdSolicitante): string | null => {
        const set = new Set<string>();
        [c.nomeCanonico, ...c.aliases].map(normN).forEach(n => (mapaCli.get(n) || []).forEach(id => set.add(id)));
        return set.size === 1 ? Array.from(set)[0] : null;
    };
    const associarCliente = async (c: CdSolicitante, clienteId: string) => {
        if (await updateCdSolicitante(c.id, { clienteId: clienteId || null })) { onFeedback?.(clienteId ? 'Cliente vinculado.' : 'Vínculo removido.', 'success'); await carregar(); }
        else onFeedback?.('Erro ao vincular cliente.', 'error');
    };
    // Agrupamento por cliente (visão "os dois lados").
    const porCliente = useMemo(() => {
        const g = new Map<string, CdSolicitante[]>();
        canon.forEach(c => { const k = c.clienteId || '__sem__'; const arr = g.get(k) || []; arr.push(c); g.set(k, arr); });
        return g;
    }, [canon]);

    const toggle = (nome: string) => setSel(s => { const n = new Set(s); n.has(nome) ? n.delete(nome) : n.add(nome); return n; });

    const criarCanon = async () => {
        const aliases = Array.from(sel);
        if (!aliases.length) return;
        const nome = (nomeCanon || aliases.sort((a, b) => b.length - a.length)[0]).trim();
        const pipefyId = aliases.map(a => raw.find(r => r.nome === a)?.pipefyId).find(Boolean) || null;
        const ok = await createCdSolicitante({ nomeCanonico: nome, pipefyId, aliases }, autorId);
        if (ok) { onFeedback?.(`Solicitante "${nome}" cadastrado (${aliases.length} variação(ões)).`, 'success'); setSel(new Set()); setNomeCanon(''); await carregar(); }
        else onFeedback?.('Erro ao cadastrar solicitante.', 'error');
    };

    const removerCanon = async (c: CdSolicitante) => {
        if (!confirm(`Remover o solicitante canônico "${c.nomeCanonico}" do cadastro? (não apaga cotações)`)) return;
        if (await deleteCdSolicitante(c.id)) { onFeedback?.('Solicitante removido do cadastro.', 'info'); await carregar(); }
    };

    const tirarAlias = async (c: CdSolicitante, alias: string) => {
        if (await updateCdSolicitante(c.id, { aliases: c.aliases.filter(a => a !== alias) })) await carregar();
    };

    const atribuir = async (solId: string, analistaId: string) => {
        if (!analistaId) {
            const a = atrib.find(x => x.solicitanteId === solId);
            if (a && await removeCdAtribuicao(a.id)) { onFeedback?.('Removido da carteira.', 'info'); await carregar(); }
            return;
        }
        if (await setCdAtribuicao(solId, analistaId, autorId)) { onFeedback?.('Carteira atualizada.', 'success'); await carregar(); }
        else onFeedback?.('Erro ao atribuir.', 'error');
    };

    return (
        <div className="space-y-5 animate-fade-in-up">
            <div className="flex items-center gap-3 px-1">
                <Users className="w-7 h-7 text-[#111827]" />
                <h1 className="text-2xl font-medium text-[#111827] tracking-tight">Contato Diário · Carteira</h1>
                <button onClick={carregar} title="Recarregar" className="ml-auto p-2 text-[#6b7280] hover:bg-[#f9fafb] rounded-lg"><RefreshCw className="w-4 h-4" /></button>
            </div>

            <div className="flex gap-2">
                {(['solicitantes', 'carteira', 'clientes'] as const).map(t => (
                    <button key={t} onClick={() => setAba(t)} className={`px-4 py-2 rounded-lg text-sm font-medium ${aba === t ? 'bg-[#1d6fb8] text-white' : 'bg-white border border-[#e5e7eb] text-[#6b7280] hover:bg-[#f9fafb]'}`}>
                        {t === 'solicitantes' ? '1. Cadastro de solicitantes' : t === 'carteira' ? '2. Montar carteira' : '3. Por cliente'}
                    </button>
                ))}
            </div>

            {loading ? <p className="text-sm text-[#6b7280] px-1">Carregando…</p> : aba === 'solicitantes' ? (
                <div className="grid lg:grid-cols-2 gap-5">
                    {/* Variações cruas das cotações, ainda não cadastradas */}
                    <div className="bg-white border border-[#e5e7eb] rounded-xl p-4">
                        <h3 className="text-sm font-semibold text-[#111827] mb-1">Variações nas cotações ({naoMapeados.length} pendentes)</h3>
                        <p className="text-[11px] text-[#6b7280] mb-3">Marque as variações da MESMA pessoa (ex.: os três "Alyson") e agrupe num cadastro único.</p>
                        <div className="space-y-1 max-h-[46vh] overflow-y-auto pr-1">
                            {naoMapeados.map(r => (
                                <label key={r.nome} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[#f9fafb] cursor-pointer">
                                    <input type="checkbox" checked={sel.has(r.nome)} onChange={() => toggle(r.nome)} />
                                    <span className="text-sm text-[#111827] flex-1">{r.nome}</span>
                                    {r.pipefyId && <span className="text-[8px] uppercase px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">pipefy</span>}
                                    <span className="text-[10px] text-[#9ca3af]">{r.cotacoes} cot.</span>
                                </label>
                            ))}
                            {naoMapeados.length === 0 && <p className="text-xs text-[#9ca3af]">Todas as variações já foram cadastradas.</p>}
                        </div>
                        {sel.size > 0 && (
                            <div className="mt-3 border-t border-[#e5e7eb] pt-3 space-y-2">
                                <p className="text-[11px] text-[#6b7280]">{sel.size} variação(ões) selecionada(s) → vão virar 1 pessoa:</p>
                                <input className="inp" placeholder="Nome canônico (oficial)" value={nomeCanon} onChange={e => setNomeCanon(e.target.value)} />
                                <button onClick={criarCanon} className="w-full py-2 bg-[#1d6fb8] text-white rounded-lg text-sm font-medium hover:bg-[#1a5f9e] flex items-center justify-center gap-1.5"><Link2 className="w-4 h-4" /> Agrupar em 1 cadastro</button>
                            </div>
                        )}
                    </div>

                    {/* Cadastro canônico */}
                    <div className="bg-white border border-[#e5e7eb] rounded-xl p-4">
                        <h3 className="text-sm font-semibold text-[#111827] mb-3">Cadastro canônico ({canon.length})</h3>
                        <div className="space-y-2 max-h-[52vh] overflow-y-auto pr-1">
                            {canon.map(c => (
                                <div key={c.id} className="border border-[#e5e7eb] rounded-lg p-2.5">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium text-sm text-[#111827] flex-1">{c.nomeCanonico}</span>
                                        {c.pipefyId && <span className="text-[8px] uppercase px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">pipefy</span>}
                                        <button onClick={() => removerCanon(c)} className="p-1 text-[#9ca3af] hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                                    </div>
                                    <div className="flex flex-wrap gap-1 mt-1.5">
                                        {c.aliases.map(a => (
                                            <span key={a} className="text-[10px] bg-[#f3f4f6] text-[#6b7280] px-1.5 py-0.5 rounded flex items-center gap-1">
                                                {a}{a !== c.nomeCanonico && <button onClick={() => tirarAlias(c, a)} className="hover:text-red-500"><X className="w-2.5 h-2.5" /></button>}
                                            </span>
                                        ))}
                                    </div>
                                    {/* Vínculo com o cliente (dropdown do cadastro que já existe) + palpite */}
                                    <div className="flex items-center gap-2 mt-2">
                                        <Building2 className="w-3.5 h-3.5 text-[#9ca3af] shrink-0" />
                                        <select value={c.clienteId || ''} onChange={e => associarCliente(c, e.target.value)} className="inp" style={{ flex: 1 }}>
                                            <option value="">— sem cliente —</option>
                                            {clientes.map(cl => <option key={cl.id} value={cl.id}>{cl.nome}</option>)}
                                        </select>
                                        {!c.clienteId && sugestaoCliente(c) && (
                                            <button onClick={() => associarCliente(c, sugestaoCliente(c)!)} title="Aplicar palpite do histórico de cotações" className="text-[10px] whitespace-nowrap text-[#1d6fb8] hover:underline shrink-0">palpite: {nomeCliente(sugestaoCliente(c))} ✓</button>
                                        )}
                                    </div>
                                </div>
                            ))}
                            {canon.length === 0 && <p className="text-xs text-[#9ca3af]">Nenhum solicitante cadastrado ainda.</p>}
                        </div>
                    </div>
                </div>
            ) : aba === 'carteira' ? (
                <div className="bg-white border border-[#e5e7eb] rounded-xl p-4">
                    <h3 className="text-sm font-semibold text-[#111827] mb-1">Montar carteira ({canon.length} solicitantes)</h3>
                    <p className="text-[11px] text-[#6b7280] mb-3">Atribua cada solicitante canônico a um analista. O analista só verá a própria carteira.</p>
                    {canon.length === 0 ? <p className="text-xs text-[#9ca3af]">Cadastre solicitantes na aba 1 primeiro.</p> : (
                        <div className="space-y-1 max-h-[60vh] overflow-y-auto pr-1">
                            {canon.map(c => {
                                const aId = atribPorSol.get(c.id) || '';
                                return (
                                    <div key={c.id} className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-[#f9fafb]">
                                        <span className="text-sm text-[#111827] flex-1">{c.nomeCanonico}</span>
                                        {aId && <Check className="w-4 h-4 text-emerald-500" />}
                                        <select value={aId} onChange={e => atribuir(c.id, e.target.value)} className="inp" style={{ width: 220 }}>
                                            <option value="">— sem carteira —</option>
                                            {analistas.map(a => <option key={a.id} value={a.id}>{a.nome}</option>)}
                                        </select>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    {analistas.length === 0 && <p className="text-xs text-amber-600 mt-2">Nenhum analista (operador) cadastrado em usuários.</p>}
                </div>
            ) : (
                /* 3. Por cliente — os dois lados: cada cliente e seus solicitantes */
                <div className="bg-white border border-[#e5e7eb] rounded-xl p-4">
                    <h3 className="text-sm font-semibold text-[#111827] mb-1">Solicitantes por cliente</h3>
                    <p className="text-[11px] text-[#6b7280] mb-3">Cada cliente e os solicitantes vinculados a ele. Vincule na aba 1.</p>
                    <div className="space-y-3 max-h-[62vh] overflow-y-auto pr-1">
                        {clientes.filter(cl => porCliente.has(cl.id)).map(cl => (
                            <div key={cl.id} className="border border-[#e5e7eb] rounded-lg p-2.5">
                                <div className="flex items-center gap-2 mb-1"><Building2 className="w-4 h-4 text-[#1d6fb8]" /><span className="font-medium text-sm text-[#111827]">{cl.nome}</span><span className="text-[11px] text-[#6b7280]">· {porCliente.get(cl.id)!.length} solicitante(s)</span></div>
                                <div className="flex flex-wrap gap-1 ml-6">
                                    {porCliente.get(cl.id)!.map(s => <span key={s.id} className="text-[11px] bg-[#eff6ff] text-[#1d6fb8] px-2 py-0.5 rounded">{s.nomeCanonico}</span>)}
                                </div>
                            </div>
                        ))}
                        {porCliente.has('__sem__') && (
                            <div className="border border-dashed border-amber-200 bg-amber-50 rounded-lg p-2.5">
                                <p className="text-xs font-medium text-amber-700 mb-1">Sem cliente vinculado ({porCliente.get('__sem__')!.length})</p>
                                <div className="flex flex-wrap gap-1">
                                    {porCliente.get('__sem__')!.map(s => <span key={s.id} className="text-[11px] bg-white text-[#6b7280] border border-[#e5e7eb] px-2 py-0.5 rounded">{s.nomeCanonico}</span>)}
                                </div>
                            </div>
                        )}
                        {canon.length === 0 && <p className="text-xs text-[#9ca3af]">Cadastre e vincule solicitantes primeiro.</p>}
                    </div>
                </div>
            )}
        </div>
    );
};
