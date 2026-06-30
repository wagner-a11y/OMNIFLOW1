import React, { useEffect, useState } from 'react';
import { Paperclip, Check, RefreshCw, FileText, AlertTriangle } from 'lucide-react';
import {
    CdSolicitante, CdContato, CD_TIPOS, CD_RESULTADOS,
    getMinhaCarteira, getMeusContatos, uploadEvidencia, createCdContato, getEvidenciaUrl,
} from '../services/contatoDiario';

interface Props {
    currentUser: { id?: string; name?: string };
    onFeedback?: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

const labelDe = (arr: { v: string; l: string }[], v: string) => arr.find(x => x.v === v)?.l || v;

export const RegistroContatoBoard: React.FC<Props> = ({ currentUser, onFeedback }) => {
    const [carteira, setCarteira] = useState<CdSolicitante[]>([]);
    const [contatos, setContatos] = useState<CdContato[]>([]);
    const [loading, setLoading] = useState(true);
    const [solicitanteId, setSolicitanteId] = useState('');
    const [tipo, setTipo] = useState('whatsapp');
    const [resultado, setResultado] = useState('sem_demanda');
    const [observacao, setObservacao] = useState('');
    const [arquivo, setArquivo] = useState<File | null>(null);
    const [salvando, setSalvando] = useState(false);

    const carregar = async () => {
        setLoading(true);
        const [c, k] = await Promise.all([getMinhaCarteira(), getMeusContatos()]);
        setCarteira(c); setContatos(k); setLoading(false);
    };
    useEffect(() => { carregar(); }, []);

    const nomeSolic = (id: string) => carteira.find(s => s.id === id)?.nomeCanonico || '—';
    // EVIDÊNCIA OBRIGATÓRIA: sem arquivo (e sem solicitante), não dá pra salvar.
    const podeSalvar = !!arquivo && !!solicitanteId && !salvando;

    const salvar = async () => {
        if (!arquivo || !solicitanteId || !currentUser.id) return;
        setSalvando(true);
        const path = await uploadEvidencia(arquivo, currentUser.id);
        if (!path) { setSalvando(false); onFeedback?.('Falha ao subir a evidência. Registro não gravado.', 'error'); return; }
        const ok = await createCdContato({ solicitanteId, tipo, resultado, observacao, evidenciaPath: path }, currentUser.id);
        setSalvando(false);
        if (ok) {
            onFeedback?.('Contato registrado com evidência.', 'success');
            setSolicitanteId(''); setObservacao(''); setArquivo(null); setTipo('whatsapp'); setResultado('sem_demanda');
            await carregar();
        } else onFeedback?.('Erro ao registrar contato.', 'error');
    };

    const verEvidencia = async (path: string) => {
        const url = await getEvidenciaUrl(path);
        if (url) window.open(url, '_blank', 'noopener'); else onFeedback?.('Não foi possível abrir a evidência.', 'error');
    };

    return (
        <div className="space-y-5 animate-fade-in-up">
            <div className="flex items-center gap-3 px-1">
                <FileText className="w-7 h-7 text-[#111827]" />
                <h1 className="text-2xl font-medium text-[#111827] tracking-tight">Contato Diário · Registrar</h1>
                <button onClick={carregar} title="Recarregar" className="ml-auto p-2 text-[#6b7280] hover:bg-[#f9fafb] rounded-lg"><RefreshCw className="w-4 h-4" /></button>
            </div>

            {loading ? <p className="text-sm text-[#6b7280] px-1">Carregando…</p> : carteira.length === 0 ? (
                <div className="bg-white border border-[#e5e7eb] rounded-xl p-6 text-center">
                    <p className="text-sm text-[#6b7280]">Você ainda não tem solicitantes na sua carteira. Fale com o gestor.</p>
                </div>
            ) : (
                <div className="grid lg:grid-cols-2 gap-5">
                    {/* Formulário de registro */}
                    <div className="bg-white border border-[#e5e7eb] rounded-xl p-4 space-y-3">
                        <h3 className="text-sm font-semibold text-[#111827]">Registrar contato</h3>
                        <label className="block"><span className="block text-[11px] font-medium text-[#6b7280] mb-1">Solicitante (sua carteira)</span>
                            <select value={solicitanteId} onChange={e => setSolicitanteId(e.target.value)} className="inp">
                                <option value="">— escolha —</option>
                                {carteira.map(s => <option key={s.id} value={s.id}>{s.nomeCanonico}</option>)}
                            </select>
                        </label>
                        <div className="grid grid-cols-2 gap-3">
                            <label className="block"><span className="block text-[11px] font-medium text-[#6b7280] mb-1">Tipo</span>
                                <select value={tipo} onChange={e => setTipo(e.target.value)} className="inp">{CD_TIPOS.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}</select>
                            </label>
                            <label className="block"><span className="block text-[11px] font-medium text-[#6b7280] mb-1">Resultado</span>
                                <select value={resultado} onChange={e => setResultado(e.target.value)} className="inp">{CD_RESULTADOS.map(r => <option key={r.v} value={r.v}>{r.l}</option>)}</select>
                            </label>
                        </div>
                        <label className="block"><span className="block text-[11px] font-medium text-[#6b7280] mb-1">Observação</span>
                            <textarea value={observacao} onChange={e => setObservacao(e.target.value)} rows={2} className="inp" />
                        </label>

                        {/* EVIDÊNCIA OBRIGATÓRIA (arquivo real) */}
                        <div className="border border-dashed border-[#cbd5e1] rounded-lg p-3 bg-[#f9fafb]">
                            <label className="flex items-center gap-2 cursor-pointer text-sm text-[#1d6fb8] font-medium">
                                <Paperclip className="w-4 h-4" />
                                {arquivo ? 'Trocar arquivo' : 'Anexar evidência (obrigatório)'}
                                <input type="file" accept="image/*,application/pdf" className="hidden" onChange={e => setArquivo(e.target.files?.[0] || null)} />
                            </label>
                            {arquivo ? (
                                <p className="text-[11px] text-emerald-700 mt-1 flex items-center gap-1"><Check className="w-3 h-3" /> {arquivo.name} ({Math.round(arquivo.size / 1024)} KB)</p>
                            ) : (
                                <p className="text-[11px] text-amber-600 mt-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> print, foto, e-mail ou PDF. Sem arquivo não salva.</p>
                            )}
                        </div>

                        <button onClick={salvar} disabled={!podeSalvar}
                            className={`w-full py-2.5 rounded-lg text-sm font-medium text-white ${podeSalvar ? 'bg-[#1d6fb8] hover:bg-[#1a5f9e]' : 'bg-[#9ca3af] cursor-not-allowed'}`}>
                            {salvando ? 'Salvando…' : 'Registrar contato'}
                        </button>
                    </div>

                    {/* Histórico do próprio analista */}
                    <div className="bg-white border border-[#e5e7eb] rounded-xl p-4">
                        <h3 className="text-sm font-semibold text-[#111827] mb-2">Meus registros ({contatos.length})</h3>
                        <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
                            {contatos.map(c => (
                                <div key={c.id} className="border border-[#e5e7eb] rounded-lg p-2.5">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium text-xs text-[#111827] flex-1">{nomeSolic(c.solicitanteId)}</span>
                                        <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-[#eff6ff] text-[#1d6fb8]">{labelDe(CD_TIPOS, c.tipo)}</span>
                                        <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-[#f3f4f6] text-[#6b7280]">{labelDe(CD_RESULTADOS, c.resultado)}</span>
                                    </div>
                                    <p className="text-[10px] text-[#9ca3af] mt-1">{new Date(c.dataHora).toLocaleString('pt-BR')}</p>
                                    {c.observacao && <p className="text-[11px] text-[#6b7280] mt-1">{c.observacao}</p>}
                                    <button onClick={() => verEvidencia(c.evidenciaPath)} className="text-[11px] text-[#1d6fb8] hover:underline mt-1 flex items-center gap-1"><Paperclip className="w-3 h-3" /> ver evidência</button>
                                </div>
                            ))}
                            {contatos.length === 0 && <p className="text-xs text-[#9ca3af]">Nenhum registro ainda.</p>}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
