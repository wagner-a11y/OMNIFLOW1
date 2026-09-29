import React, { useEffect, useMemo, useState } from 'react';
import { Mail, RefreshCw, AlertCircle, Paperclip, CheckCircle2, MinusCircle } from 'lucide-react';
import { getGmailIntakeLog, type GmailIntakeItem } from '../services/database';

/**
 * Revisão da leitura de e-mail — ETAPA 1a, MODO SECO.
 *
 * Esta tela existe para UMA pergunta: a extração do Gemini é boa o bastante
 * para virar cotação sozinha? Ela mostra, e-mail a e-mail, o que o modelo
 * entendeu, para a resposta vir de dado real e não de impressão.
 *
 * NADA aqui cria, edita ou move cotação. É leitura pura do log.
 */

const fmtData = (iso?: string | null) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isFinite(d.getTime())
        ? d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
        : '—';
};

/** Só o nome/e-mail de quem mandou, sem o "Fulano <...>" inteiro. */
const remetenteCurto = (r?: string | null) => {
    if (!r) return '—';
    const m = r.match(/^\s*"?([^"<]+?)"?\s*</);
    return (m ? m[1] : r).trim();
};

const Campo: React.FC<{ rotulo: string; valor: any }> = ({ rotulo, valor }) => {
    const vazio = valor === null || valor === undefined || valor === '';
    return (
        <div className="min-w-0">
            <p className="text-[9px] font-medium uppercase tracking-wider text-[#9ca3af]">{rotulo}</p>
            <p className={`text-xs font-medium truncate ${vazio ? 'text-[#d1d5db] italic' : 'text-[#111827]'}`}
                title={vazio ? 'não extraído' : String(valor)}>
                {vazio ? '—' : String(valor)}
            </p>
        </div>
    );
};

export const GmailIntakeBoard: React.FC = () => {
    const [itens, setItens] = useState<GmailIntakeItem[]>([]);
    const [carregando, setCarregando] = useState(true);
    const [aberto, setAberto] = useState<string | null>(null);
    const [filtro, setFiltro] = useState<'todos' | 'cotacao' | 'nao' | 'erro'>('todos');

    const carregar = async () => {
        setCarregando(true);
        setItens(await getGmailIntakeLog(200));
        setCarregando(false);
    };
    useEffect(() => { carregar(); }, []);

    const { lista, resumo } = useMemo(() => {
        const ehCotacao = (i: GmailIntakeItem) => i.extraido?.ehCotacao === true;
        const r = {
            total: itens.length,
            cotacoes: itens.filter(ehCotacao).length,
            naoCotacoes: itens.filter(i => !i.erro && i.extraido && i.extraido.ehCotacao !== true).length,
            erros: itens.filter(i => !!i.erro).length,
            confMedia: (() => {
                const cs = itens.filter(ehCotacao).map(i => i.confianca).filter((c): c is number => c !== null);
                return cs.length ? cs.reduce((a, b) => a + b, 0) / cs.length : null;
            })(),
        };
        const l = itens.filter(i =>
            filtro === 'todos' ? true
                : filtro === 'erro' ? !!i.erro
                    : filtro === 'cotacao' ? ehCotacao(i)
                        : !i.erro && i.extraido && i.extraido.ehCotacao !== true);
        return { lista: l, resumo: r };
    }, [itens, filtro]);

    const corConfianca = (c: number | null) =>
        c === null ? 'bg-slate-100 text-slate-500'
            : c >= 0.8 ? 'bg-emerald-50 text-emerald-600'
                : c >= 0.5 ? 'bg-amber-50 text-amber-600'
                    : 'bg-red-50 text-red-600';

    return (
        <div className="space-y-5 animate-fade-in">
            {/* Cabeçalho: o aviso de modo seco fica em destaque de propósito */}
            <div className="bg-white border border-[#e5e7eb] rounded-2xl p-6 shadow-sm">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex items-start gap-3">
                        <div className="p-2.5 bg-blue-50 rounded-xl text-blue-600"><Mail className="w-5 h-5" /></div>
                        <div>
                            <h3 className="text-base font-medium text-[#111827]">Leitura de e-mail · revisão da extração</h3>
                            <p className="text-sm font-normal text-[#6b7280] mt-0.5">
                                O que o Gemini entendeu de cada e-mail de <span className="font-medium">cotacoes@omnicargo.com.br</span>.
                            </p>
                            <p className="text-xs font-medium text-amber-600 mt-2 flex items-center gap-1.5">
                                <MinusCircle className="w-3.5 h-3.5" />
                                MODO SECO — nada aqui virou cotação. Nenhum card foi criado no funil.
                            </p>
                        </div>
                    </div>
                    <button onClick={carregar} disabled={carregando}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[#e5e7eb] text-sm font-medium text-[#6b7280] hover:bg-[#f9fafb] disabled:opacity-50 transition-colors">
                        <RefreshCw className={`w-4 h-4 ${carregando ? 'animate-spin' : ''}`} /> Atualizar
                    </button>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
                    {[
                        { r: 'E-mails lidos', v: resumo.total, cor: 'text-[#111827]' },
                        { r: 'Reconhecidos como cotação', v: resumo.cotacoes, cor: 'text-emerald-600' },
                        { r: 'Não são cotação', v: resumo.naoCotacoes, cor: 'text-[#6b7280]' },
                        { r: 'Falharam na leitura', v: resumo.erros, cor: resumo.erros ? 'text-red-500' : 'text-[#6b7280]' },
                    ].map(c => (
                        <div key={c.r} className="bg-[#f9fafb] rounded-xl p-3">
                            <p className="text-[10px] font-medium uppercase tracking-wider text-[#6b7280]">{c.r}</p>
                            <p className={`text-2xl font-semibold mt-0.5 ${c.cor}`}>{c.v}</p>
                        </div>
                    ))}
                </div>
                {resumo.confMedia !== null && (
                    <p className="text-xs font-medium text-[#6b7280] mt-3">
                        Confiança média nas que o modelo considerou cotação:{' '}
                        <span className="font-semibold text-[#111827]">{(resumo.confMedia * 100).toFixed(0)}%</span>
                        <span className="text-[#9ca3af]"> · autodeclarada pelo modelo, não é probabilidade calculada</span>
                    </p>
                )}

                <div className="flex gap-2 mt-4 flex-wrap">
                    {([['todos', 'Todos'], ['cotacao', 'Cotações'], ['nao', 'Não é cotação'], ['erro', 'Com erro']] as const).map(([id, rot]) => (
                        <button key={id} onClick={() => setFiltro(id)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filtro === id ? 'bg-[#1d6fb8] text-white' : 'bg-[#f9fafb] text-[#6b7280] hover:bg-[#f3f4f6]'}`}>
                            {rot}
                        </button>
                    ))}
                </div>
            </div>

            {carregando && itens.length === 0 && (
                <p className="text-sm font-medium text-[#6b7280] animate-pulse px-1">Carregando…</p>
            )}
            {!carregando && lista.length === 0 && (
                <div className="bg-white border border-dashed border-[#e5e7eb] rounded-2xl p-10 text-center">
                    <p className="text-sm font-medium text-[#6b7280]">Nenhum e-mail no log ainda.</p>
                    <p className="text-xs font-normal text-[#9ca3af] mt-1">Rode o backfill da gmail-intake para popular.</p>
                </div>
            )}

            {lista.map(i => {
                const e = i.extraido || {};
                const ehCot = e.ehCotacao === true;
                const abertoAqui = aberto === i.messageId;
                return (
                    <div key={i.messageId} className={`bg-white border rounded-2xl shadow-sm overflow-hidden ${i.erro ? 'border-red-200' : 'border-[#e5e7eb]'}`}>
                        <button onClick={() => setAberto(abertoAqui ? null : i.messageId)} className="w-full text-left px-5 py-4 hover:bg-[#f9fafb] transition-colors">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        {i.erro
                                            ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-red-50 text-red-600"><AlertCircle className="w-3 h-3" /> erro</span>
                                            : ehCot
                                                ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-600"><CheckCircle2 className="w-3 h-3" /> cotação</span>
                                                : <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-500">não é cotação</span>}
                                        {!i.erro && (
                                            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${corConfianca(i.confianca)}`}>
                                                confiança {i.confianca === null ? '—' : `${(i.confianca * 100).toFixed(0)}%`}
                                            </span>
                                        )}
                                        {i.partes > 1 && (
                                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[#9ca3af]">
                                                <Paperclip className="w-3 h-3" /> {i.partes - 1} parte(s) além do texto
                                            </span>
                                        )}
                                        {e.ondeEstavaODado && (
                                            <span className="text-[10px] font-medium text-[#9ca3af]">dado em: {String(e.ondeEstavaODado)}</span>
                                        )}
                                    </div>
                                    <p className="text-sm font-semibold text-[#111827] mt-1.5 truncate" title={i.assunto || ''}>{i.assunto || '(sem assunto)'}</p>
                                    <p className="text-xs font-medium text-[#6b7280] truncate" title={i.remetente || ''}>
                                        {remetenteCurto(i.remetente)} · {fmtData(i.recebidoEm)}
                                    </p>
                                </div>
                            </div>

                            {!i.erro && (
                                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mt-3 pt-3 border-t border-[#f3f4f6]">
                                    <Campo rotulo="Cliente" valor={e.cliente} />
                                    <Campo rotulo="Origem" valor={e.origem} />
                                    <Campo rotulo="Destino" valor={e.destino} />
                                    <Campo rotulo="Veículo" valor={e.veiculo} />
                                    <Campo rotulo="Peso (kg)" valor={e.peso} />
                                    <Campo rotulo="Valor carga" valor={e.valorMercadoria} />
                                    <Campo rotulo="Coleta" valor={e.prazoColeta} />
                                </div>
                            )}
                            {i.erro && <p className="text-xs font-medium text-red-500 mt-2 break-words">{i.erro}</p>}
                        </button>

                        {abertoAqui && (
                            <div className="px-5 pb-5 bg-[#f9fafb] border-t border-[#e5e7eb]">
                                <p className="text-[10px] font-medium uppercase tracking-wider text-[#6b7280] mt-4 mb-2">JSON cru do Gemini</p>
                                <pre className="text-[11px] font-mono bg-white border border-[#e5e7eb] rounded-lg p-3 overflow-x-auto text-[#111827]">
                                    {JSON.stringify(i.extraido, null, 2) || '—'}
                                </pre>
                                <p className="text-[10px] font-medium text-[#9ca3af] mt-2">
                                    message_id {i.messageId} · processado {fmtData(i.processadoEm)}
                                </p>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};
