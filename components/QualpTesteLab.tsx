// Laboratório de teste da API Qualp (OCULTO, só master). Isolado: não toca na
// calculadora nem na fórmula. Só consulta o Qualp e mostra o retorno pra comparar
// NA MÃO com o que a calculadora dá pra mesma rota. Foco: pedágio e distância.
import React, { useState } from 'react';
import { FlaskConical, Loader2, MapPin, DollarSign, Route as RouteIcon, ChevronDown, ChevronRight } from 'lucide-react';
import { consultarQualp, QualpResultado, calcularAtual, CalcAtual } from '../services/qualpTeste';

const brl = (n: number | null | undefined) =>
    (n == null ? '—' : n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

// Bateria de rotas conhecidas p/ testar o pedágio na mão. EIXOS VARIADOS (2/5/9) de propósito,
// pra pegar o escalonamento do Google (que estima em 2 eixos e escala por eixos/2). Editável —
// serão trocadas pelas rotas reais do Wagner. 1 clique preenche; a consulta segue manual.
const ROTAS_CONHECIDAS: Array<{ label: string; origem: string; destino: string; eixos: string }> = [
    { label: 'Santos → São Paulo', origem: 'Santos, SP', destino: 'São Paulo, SP', eixos: '2' },
    { label: 'Rio de Janeiro → Belo Horizonte', origem: 'Rio de Janeiro, RJ', destino: 'Belo Horizonte, MG', eixos: '2' },
    { label: 'São Paulo → Rio de Janeiro', origem: 'São Paulo, SP', destino: 'Rio de Janeiro, RJ', eixos: '5' },
    { label: 'São Paulo → Uberlândia', origem: 'São Paulo, SP', destino: 'Uberlândia, MG', eixos: '5' },
    { label: 'São Paulo → Curitiba', origem: 'São Paulo, SP', destino: 'Curitiba, PR', eixos: '9' },
    { label: 'São Paulo → Belo Horizonte', origem: 'São Paulo, SP', destino: 'Belo Horizonte, MG', eixos: '9' },
];

export const QualpTesteLab: React.FC = () => {
    const [origem, setOrigem] = useState('');
    const [destino, setDestino] = useState('');
    const [eixos, setEixos] = useState('6');
    const [categoria, setCategoria] = useState('A'); // Tabela ANTT — 'A' é a que a calculadora usa
    const [compararAntt, setCompararAntt] = useState(false); // ISOLADO por padrão: só pedágio/distância
    const [fuel, setFuel] = useState(false);
    const [loading, setLoading] = useState(false);
    const [res, setRes] = useState<QualpResultado | null>(null);
    const [calc, setCalc] = useState<CalcAtual | null>(null); // coluna "calculadora atual" (Google, hoje)
    const [realPedagio, setRealPedagio] = useState('');       // coluna "real" (verdade que o Wagner sabe)
    const [rawOpen, setRawOpen] = useState(false);

    const consultar = async () => {
        if (!origem.trim() || !destino.trim()) return;
        setLoading(true); setRes(null); setCalc(null); setRawOpen(false);
        // Qualp + calculadora atual em paralelo (calculate-route não gasta consulta Qualp).
        const [r, c] = await Promise.all([
            consultarQualp({ origem: origem.trim(), destino: destino.trim(), eixos: Number(eixos) || 0, fuel, categoria, freightLoad: 'geral', antt: compararAntt }),
            calcularAtual(origem.trim(), destino.trim(), Number(eixos) || 0),
        ]);
        setRes(r); setCalc(c);
        setLoading(false);
    };
    const realNum = (() => { const n = parseFloat(realPedagio.replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : null; })();
    const diff = (v: number | null | undefined) => (v == null || realNum == null) ? null : v - realNum;

    return (
        <div className="max-w-3xl mx-auto p-6">
            {/* Aviso: laboratório isolado */}
            <div className="flex items-start gap-3 mb-6 p-4 rounded-xl bg-amber-50 border border-amber-100">
                <FlaskConical className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" strokeWidth={1.75} />
                <div>
                    <p className="text-sm font-medium text-amber-900">Laboratório de teste — API Qualp</p>
                    <p className="text-xs text-amber-700 mt-0.5">Isolado e só leitura: não altera a calculadora, a fórmula nem grava nada. Compare os números na mão com a cotação da mesma rota. Consultas gratuitas são limitadas — use com parcimônia.</p>
                </div>
            </div>

            {/* Bateria de rotas conhecidas — 1 clique preenche a rota (a consulta segue manual). */}
            <div className="mb-4">
                <p className="text-[11px] font-medium text-[#6b7280] uppercase tracking-wide mb-2">Rotas conhecidas (bateria de pedágio)</p>
                <div className="flex flex-wrap gap-2">
                    {ROTAS_CONHECIDAS.map((r, i) => (
                        <button key={i} onClick={() => { setOrigem(r.origem); setDestino(r.destino); setEixos(r.eixos); setRes(null); }}
                            className="px-3 py-1.5 rounded-full border border-[#e5e7eb] bg-white text-[12px] font-medium text-[#374151] hover:border-[#1d6fb8] hover:text-[#1d6fb8] transition-colors">
                            {r.label} · {r.eixos}e
                        </button>
                    ))}
                </div>
            </div>

            {/* Formulário */}
            <div className="bg-white rounded-xl border border-[#e5e7eb] shadow-sm p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="text-[11px] font-medium text-[#6b7280] uppercase tracking-wide">Origem</label>
                        <input value={origem} onChange={e => setOrigem(e.target.value)} placeholder="Cidade, CEP ou endereço"
                            className="mt-1 w-full px-3 py-2.5 rounded-lg border border-[#e5e7eb] text-sm focus:outline-none focus:ring-2 focus:ring-[#1d6fb8]/30 focus:border-[#1d6fb8]" />
                    </div>
                    <div>
                        <label className="text-[11px] font-medium text-[#6b7280] uppercase tracking-wide">Destino</label>
                        <input value={destino} onChange={e => setDestino(e.target.value)} placeholder="Cidade, CEP ou endereço"
                            className="mt-1 w-full px-3 py-2.5 rounded-lg border border-[#e5e7eb] text-sm focus:outline-none focus:ring-2 focus:ring-[#1d6fb8]/30 focus:border-[#1d6fb8]" />
                    </div>
                    <div>
                        <label className="text-[11px] font-medium text-[#6b7280] uppercase tracking-wide">Nº de eixos</label>
                        <input type="number" min={0} max={15} value={eixos} onChange={e => setEixos(e.target.value)}
                            className="mt-1 w-full px-3 py-2.5 rounded-lg border border-[#e5e7eb] text-sm focus:outline-none focus:ring-2 focus:ring-[#1d6fb8]/30 focus:border-[#1d6fb8]" />
                    </div>
                    <div>
                        <label className="text-[11px] font-medium text-[#6b7280] uppercase tracking-wide">Tabela ANTT (categoria)</label>
                        <select value={categoria} onChange={e => setCategoria(e.target.value)}
                            className="mt-1 w-full px-3 py-2.5 rounded-lg border border-[#e5e7eb] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1d6fb8]/30 focus:border-[#1d6fb8]">
                            <option value="A">A — carga geral (a que a calculadora usa)</option>
                            <option value="B">B — granel sólido</option>
                            <option value="C">C — granel líquido</option>
                            <option value="D">D — frigorificada / perigosa</option>
                            <option value="all">all — todas (padrão do Qualp)</option>
                        </select>
                    </div>
                </div>
                <label className="mt-4 flex items-center gap-2 text-sm text-[#374151] cursor-pointer select-none">
                    <input type="checkbox" checked={compararAntt} onChange={e => setCompararAntt(e.target.checked)} className="w-4 h-4 rounded border-[#d1d5db]" />
                    Comparar também o piso ANTT <span className="text-[11px] text-[#9ca3af]">(usa a categoria acima + carga geral; senão só pedágio/distância)</span>
                </label>
                <label className="mt-2 flex items-center gap-2 text-sm text-[#374151] cursor-pointer select-none">
                    <input type="checkbox" checked={fuel} onChange={e => setFuel(e.target.checked)} className="w-4 h-4 rounded border-[#d1d5db]" />
                    Pedir consumo de combustível
                </label>
                <button onClick={consultar} disabled={loading || !origem.trim() || !destino.trim()}
                    className="mt-5 w-full py-2.5 bg-[#1d6fb8] text-white rounded-lg font-medium text-sm hover:bg-[#1a5f9e] transition-colors flex items-center justify-center gap-2 disabled:opacity-50">
                    {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Consultando Qualp...</> : <><RouteIcon className="w-4 h-4" strokeWidth={1.75} /> Consultar Qualp</>}
                </button>
            </div>

            {/* Resultado */}
            {res && (
                <div className="mt-6 space-y-4">
                    {!res.ok && (
                        <div className="p-4 rounded-xl bg-red-50 border border-red-100 text-sm text-red-700">
                            <p className="font-medium">Não deu certo: {res.error || 'erro desconhecido'}</p>
                            {res.hint && <p className="text-xs mt-1">{res.hint}</p>}
                            {res.status && <p className="text-xs mt-1">HTTP {res.status}</p>}
                            {res.corpo !== undefined && (
                                <pre className="mt-2 text-[11px] bg-white/60 rounded-lg p-2 overflow-auto max-h-60">{JSON.stringify(res.corpo, null, 2)}</pre>
                            )}
                        </div>
                    )}

                    {res.ok && (
                        <>
                            {/* Herói: distância + pedágio (a dor principal) */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="bg-white rounded-xl border border-[#e5e7eb] shadow-sm p-5">
                                    <div className="flex items-center gap-2 text-[#6b7280]"><MapPin className="w-4 h-4" strokeWidth={1.75} /><span className="text-[11px] font-medium uppercase tracking-wide">Distância (Qualp)</span></div>
                                    <p className="mt-1 text-3xl font-semibold text-[#111827] tabular-nums">{res.distanciaKm != null ? `${brl(res.distanciaKm).replace(',00', '')} km` : '—'}</p>
                                </div>
                                <div className="bg-white rounded-xl border border-[#e5e7eb] shadow-sm p-5">
                                    <div className="flex items-center gap-2 text-[#6b7280]"><DollarSign className="w-4 h-4" strokeWidth={1.75} /><span className="text-[11px] font-medium uppercase tracking-wide">Pedágio total (Qualp)</span></div>
                                    <p className="mt-1 text-3xl font-semibold text-[#1d6fb8] tabular-nums">R$ {brl(res.pedagioTotal)}</p>
                                    <p className="text-[11px] text-[#9ca3af] mt-1">{res.pracas?.length || 0} praça(s) · {res.elapsedMs} ms</p>
                                </div>
                            </div>

                            {/* Comparação de pedágio: Qualp cheia · Qualp tag · calculadora atual · real */}
                            <div className="bg-white rounded-xl border border-[#e5e7eb] shadow-sm overflow-hidden">
                                <div className="px-5 py-3 border-b border-[#f3f4f6] text-[11px] font-medium text-[#6b7280] uppercase tracking-wide">Comparação de pedágio ({eixos} eixos)</div>
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="text-[11px] text-[#9ca3af] uppercase tracking-wide">
                                            <th className="text-left font-medium px-5 py-2">Fonte</th>
                                            <th className="text-right font-medium px-5 py-2">Pedágio</th>
                                            <th className="text-right font-medium px-5 py-2">Δ vs real</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#f3f4f6]">
                                        {[
                                            { fonte: 'Qualp (cheia)', v: res.pedagioTotal, forte: true },
                                            { fonte: 'Qualp (tag)', v: res.pedagioTag, forte: false },
                                            { fonte: 'Calculadora atual (Google)', v: calc?.pedagio ?? null, forte: false },
                                        ].map((row, i) => {
                                            const d = diff(row.v);
                                            return (
                                                <tr key={i}>
                                                    <td className={`px-5 py-2.5 ${row.forte ? 'font-medium text-[#111827]' : 'text-[#374151]'}`}>{row.fonte}</td>
                                                    <td className={`px-5 py-2.5 text-right tabular-nums ${row.forte ? 'font-semibold text-[#1d6fb8]' : 'text-[#111827]'}`}>R$ {brl(row.v)}</td>
                                                    <td className={`px-5 py-2.5 text-right tabular-nums ${d == null ? 'text-[#d1d5db]' : Math.abs(d) < 0.01 ? 'text-emerald-600' : d > 0 ? 'text-amber-600' : 'text-red-500'}`}>
                                                        {d == null ? '—' : `${d > 0 ? '+' : ''}${brl(d)}`}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                        <tr className="bg-[#f9fafb]">
                                            <td className="px-5 py-2.5 font-medium text-[#111827]">Real (você sabe)</td>
                                            <td className="px-5 py-2.5 text-right" colSpan={2}>
                                                <div className="flex items-center justify-end gap-1">
                                                    <span className="text-[#9ca3af] text-xs">R$</span>
                                                    <input value={realPedagio} onChange={e => setRealPedagio(e.target.value)} placeholder="0,00"
                                                        className="w-28 px-2 py-1 text-right rounded-lg border border-[#e5e7eb] text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-[#1d6fb8]/30 focus:border-[#1d6fb8]" />
                                                </div>
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                                {/* Distância: Qualp vs calculadora (o escalonamento por eixo do Google mora aqui) */}
                                <div className="px-5 py-3 border-t border-[#f3f4f6] flex items-center justify-between text-[13px]">
                                    <span className="text-[#6b7280]">Distância</span>
                                    <span className="text-[#374151] tabular-nums">
                                        Qualp <b className="text-[#111827]">{res.distanciaKm != null ? `${brl(res.distanciaKm).replace(',00', '')} km` : '—'}</b>
                                        <span className="text-[#d1d5db] mx-2">·</span>
                                        Calc <b className="text-[#111827]">{calc?.km != null ? `${calc.km} km` : (calc?.error ? 'erro' : '—')}</b>
                                    </span>
                                </div>
                            </div>

                            {/* Praças de pedágio */}
                            {!!res.pracas?.length && (
                                <div className="bg-white rounded-xl border border-[#e5e7eb] shadow-sm overflow-hidden">
                                    <div className="px-5 py-3 border-b border-[#f3f4f6] text-[11px] font-medium text-[#6b7280] uppercase tracking-wide">Praças de pedágio</div>
                                    <div className="divide-y divide-[#f3f4f6]">
                                        {res.pracas.map((p, i) => (
                                            <div key={i} className="px-5 py-2.5 flex items-center justify-between text-sm gap-3">
                                                <div className="min-w-0">
                                                    <p className="text-[#374151] truncate">{p.nome}{p.uf ? <span className="text-[#9ca3af]"> · {p.uf}</span> : null}</p>
                                                    <p className="text-[11px] text-[#9ca3af] truncate">
                                                        {[p.rodovia, p.km ? `km ${p.km}` : null, p.concessionaria].filter(Boolean).join(' · ')}
                                                    </p>
                                                </div>
                                                <div className="text-right shrink-0">
                                                    <p className="font-medium text-[#111827] tabular-nums">R$ {brl(p.valor)}</p>
                                                    {p.tarifaTag != null && <p className="text-[11px] text-[#9ca3af] tabular-nums">tag R$ {brl(p.tarifaTag)}</p>}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Secundário: piso ANTT + resolução */}
                            <div className="bg-white rounded-xl border border-[#e5e7eb] shadow-sm p-5">
                                <p className="text-[11px] font-medium text-[#6b7280] uppercase tracking-wide mb-2">Piso ANTT (Qualp) — comparação secundária</p>
                                {res.pisoAntt ? (
                                    <pre className="text-[11px] bg-[#f9fafb] rounded-lg p-3 overflow-auto max-h-72">{JSON.stringify(res.pisoAntt, null, 2)}</pre>
                                ) : <p className="text-sm text-[#9ca3af]">Qualp não retornou tabela de frete nesta consulta.</p>}
                                {res.resolucaoAntt != null && (
                                    <p className="text-[11px] text-[#9ca3af] mt-2">Resolução vigente: <span className="font-mono">{JSON.stringify(res.resolucaoAntt)}</span></p>
                                )}
                            </div>

                            {res.consumo != null && (
                                <div className="bg-white rounded-xl border border-[#e5e7eb] shadow-sm p-5">
                                    <p className="text-[11px] font-medium text-[#6b7280] uppercase tracking-wide mb-2">Consumo de combustível</p>
                                    <pre className="text-[11px] bg-[#f9fafb] rounded-lg p-3 overflow-auto max-h-52">{JSON.stringify(res.consumo, null, 2)}</pre>
                                </div>
                            )}

                            {/* Resposta crua (confere se algum campo veio com outro nome) */}
                            <div className="bg-white rounded-xl border border-[#e5e7eb] shadow-sm">
                                <button onClick={() => setRawOpen(v => !v)} className="w-full px-5 py-3 flex items-center gap-2 text-[11px] font-medium text-[#6b7280] uppercase tracking-wide">
                                    {rawOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />} Resposta crua do Qualp (raw)
                                </button>
                                {rawOpen && (
                                    <pre className="px-5 pb-4 text-[11px] bg-[#f9fafb] mx-4 mb-4 rounded-lg p-3 overflow-auto max-h-96">{JSON.stringify(res.raw, null, 2)}</pre>
                                )}
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
};
