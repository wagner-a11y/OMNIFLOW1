// ============================================================================
// BID EM LOTE — Fase 1
//
// Importa uma planilha de rotas (origem/destino/veículo), consulta o Qualp por
// rota e roda CADA linha pelo MESMO motor de preço da calculadora. Mostra
// custo, preço sugerido e margem líquida por linha, e sai em Excel.
//
// Fase 1 NÃO PERSISTE NADA: vive na tela. Nenhuma cotação é criada, nenhuma
// numeração de proposta é consumida, nada entra no histórico ou no funil.
//
// A cota do Qualp é paga e limitada, então duas travas são de desenho, não de
// configuração: dedup por rota (repetida consulta uma vez só) e no máximo
// CONCORRENCIA consultas em voo. A planilha nunca é disparada de uma vez.
//
// Linha problemática não derruba o lote: pendência, frete urbano e falha do
// Qualp viram STATUS da linha, e as linhas com problema ficam no TOPO — uma
// pendência no meio de 70 linhas passa despercebida.
// ============================================================================

import React, { useMemo, useRef, useState } from 'react';
import { AlertTriangle, FileDown, Info, Lock, Upload } from 'lucide-react';
import {
    processarLoteBid, resumirBid, rotuloStatus,
    type LinhaBid, type ParametrosBid,
} from '../utils/bidLote';
import { lerPlanilhaBid, consultarRotaDoLote, exportarBidExcel } from '../services/bidLote';
import type { ANTTCoefficients, FederalTaxes } from '../types';

/** Consultas simultâneas ao Qualp. Baixo de propósito: a cota é paga. */
const CONCORRENCIA = 3;

interface Props {
    /** Parâmetros globais: tributos, ICMS por rota e os custos ocultos. */
    fedTaxes: FederalTaxes;
    /** Eixos e modo de cálculo por veículo, do cadastro de frota. */
    vehicleConfigs: Record<string, ANTTCoefficients & { factor?: number; axles?: number }>;
    /** Tipos de carga da Tabela A, a mesma lista da calculadora. */
    tiposDeCarga: string[];
    onFeedback?: (msg: string, tipo?: 'success' | 'error' | 'info') => void;
}

const brl = (v: number | null) =>
    v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (v: number | null) => (v == null ? '—' : `${v.toFixed(1)}%`);
const numero = (v: number | null) =>
    v == null ? '—' : v.toLocaleString('pt-BR', { maximumFractionDigits: 1 });

const CORES_STATUS: Record<string, string> = {
    ok: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    pendencia: 'bg-amber-50 text-amber-700 border-amber-200',
    urbano: 'bg-blue-50 text-blue-700 border-blue-200',
    falha: 'bg-red-50 text-red-700 border-red-200',
};

export const BidLote: React.FC<Props> = ({ fedTaxes, vehicleConfigs, tiposDeCarga, onFeedback }) => {
    // ---- Parâmetros do bid inteiro ----
    const veiculos = useMemo(() => Object.keys(vehicleConfigs).sort(), [vehicleConfigs]);
    const [veiculoPadrao, setVeiculoPadrao] = useState('');
    const [profitMargin, setProfitMargin] = useState('15');
    const [cargoType, setCargoType] = useState(tiposDeCarga[0] || 'Carga geral');
    const [prazoDias, setPrazoDias] = useState('');
    const [comissaoPercent, setComissaoPercent] = useState('');

    // ---- Lote ----
    const [linhas, setLinhas] = useState<LinhaBid[] | null>(null);
    const [rodando, setRodando] = useState(false);
    const [progresso, setProgresso] = useState({ feitas: 0, total: 0 });
    const [colunasFaltando, setColunasFaltando] = useState<string[]>([]);
    const [estatQualp, setEstatQualp] = useState<{ consultas: number; distintas: number; economizadas: number } | null>(null);
    const [nomeArquivo, setNomeArquivo] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    const prazosDisponiveis = useMemo(
        () => Object.keys(fedTaxes.anticipationRates || {})
            .map(k => parseInt(k, 10)).filter(n => !isNaN(n)).sort((a, b) => a - b),
        [fedTaxes.anticipationRates],
    );

    const parametros = (): ParametrosBid => ({
        profitMargin: parseFloat(profitMargin.replace(',', '.')) || 0,
        fedTaxes: {
            insurancePolicyRate: fedTaxes.insurancePolicyRate,
            pis: fedTaxes.pis, cofins: fedTaxes.cofins, csll: fedTaxes.csll, irpj: fedTaxes.irpj,
        },
        icmsRates: fedTaxes.icmsRates,
        cargoType,
        veiculoPadrao,
        eixosPorVeiculo: Object.fromEntries(veiculos.map(v => [v, vehicleConfigs[v]?.axles])),
        modoPorVeiculo: Object.fromEntries(veiculos.map(v => [v, vehicleConfigs[v]?.calcMode])),
        prazoDias,
        comissaoPercent,
        taxasAntecipacao: fedTaxes.anticipationRates,
        comissaoPadrao: fedTaxes.commissionPercent,
    });

    const aoEscolherArquivo = async (file: File | undefined) => {
        if (!file || rodando) return;
        setRodando(true);
        setLinhas(null);
        setEstatQualp(null);
        setNomeArquivo(file.name);
        try {
            const { linhas: brutas, faltando, totalLinhas } = lerPlanilhaBid(await file.arrayBuffer());
            setColunasFaltando(faltando);
            if (!totalLinhas) {
                onFeedback?.('A planilha está vazia.', 'error');
                return;
            }
            setProgresso({ feitas: 0, total: brutas.length });

            const r = await processarLoteBid(brutas, parametros(), {
                consultarRota: consultarRotaDoLote,
                concorrencia: CONCORRENCIA,
                onProgresso: (feitas, total) => setProgresso({ feitas, total }),
            });

            // Problema no topo: é a primeira coisa que precisa ser vista.
            const ordem: Record<string, number> = { falha: 0, pendencia: 1, urbano: 2, ok: 3 };
            setLinhas([...r.linhas].sort((a, b) => {
                const d = (ordem[a.status] ?? 9) - (ordem[b.status] ?? 9);
                if (d !== 0) return d;
                if (a.alertas.length !== b.alertas.length) return b.alertas.length - a.alertas.length;
                return a.linhaExcel - b.linhaExcel;
            }));
            setEstatQualp({ consultas: r.consultasQualp, distintas: r.rotasDistintas, economizadas: r.economizadas });
            onFeedback?.(`Lote processado: ${r.linhas.length} linha(s), ${r.consultasQualp} consulta(s) ao Qualp.`);
        } catch (e: any) {
            console.error('bid em lote:', e);
            onFeedback?.(`Falha ao processar a planilha: ${e?.message || e}`, 'error');
        } finally {
            setRodando(false);
            if (inputRef.current) inputRef.current.value = '';
        }
    };

    const resumo = linhas ? resumirBid(linhas) : null;

    return (
        <div className="space-y-6">
            {/* Aviso do que esta tela é e do que ela NÃO faz */}
            <div className="flex items-start gap-3 p-4 bg-[#f9fafb] border border-[#e5e7eb] rounded-xl">
                <Lock className="w-4 h-4 text-[#6b7280] mt-0.5 shrink-0" strokeWidth={1.75} />
                <div>
                    <h3 className="font-medium text-sm text-[#111827] mb-1">Bid em Lote · estudo de precificação</h3>
                    <p className="text-[11px] font-normal text-[#6b7280] leading-relaxed">
                        Roda cada rota da planilha pelo <strong className="font-medium">mesmo motor de preço da calculadora</strong>.
                        Nada é salvo: não cria cotação, não consome numeração de proposta e não entra no histórico nem no funil.
                        O resultado vive nesta tela e sai em Excel.
                        Base de custo da Fase 1: <strong className="font-medium">piso ANTT + pedágio</strong>.
                    </p>
                </div>
            </div>

            {/* Parâmetros do bid */}
            <div className="bg-white border border-[#e5e7eb] p-6 rounded-xl">
                <h4 className="text-[10px] font-medium text-[#6b7280] uppercase tracking-widest mb-4">Parâmetros deste bid</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
                    <div>
                        <label className="text-[10px] font-medium text-[#6b7280] uppercase tracking-tighter block mb-1.5">Veículo padrão</label>
                        <select
                            value={veiculoPadrao}
                            onChange={e => setVeiculoPadrao(e.target.value)}
                            className="w-full px-3 py-2.5 bg-[#f9fafb] border border-[#e5e7eb] rounded-lg text-sm font-normal text-[#111827] outline-none focus:border-[#1d6fb8] transition-colors"
                        >
                            <option value="">Nenhum</option>
                            {veiculos.map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                        <p className="text-[9px] font-medium text-[#9ca3af] mt-1.5 uppercase tracking-tight">Usado só quando a linha não traz veículo.</p>
                    </div>
                    <div>
                        <label className="text-[10px] font-medium text-[#6b7280] uppercase tracking-tighter block mb-1.5">Margem pretendida (%)</label>
                        <input
                            type="text"
                            value={profitMargin}
                            onChange={e => setProfitMargin(e.target.value)}
                            className="w-full px-3 py-2.5 bg-[#f9fafb] border border-[#e5e7eb] rounded-lg text-sm font-normal text-[#111827] outline-none focus:border-[#1d6fb8] transition-colors"
                        />
                    </div>
                    <div>
                        <label className="text-[10px] font-medium text-[#6b7280] uppercase tracking-tighter block mb-1.5">Tipo de carga</label>
                        <select
                            value={cargoType}
                            onChange={e => setCargoType(e.target.value)}
                            className="w-full px-3 py-2.5 bg-[#f9fafb] border border-[#e5e7eb] rounded-lg text-sm font-normal text-[#111827] outline-none focus:border-[#1d6fb8] transition-colors"
                        >
                            {tiposDeCarga.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="text-[10px] font-medium text-[#6b7280] uppercase tracking-tighter block mb-1.5">Prazo de pagamento</label>
                        <select
                            value={prazoDias}
                            onChange={e => setPrazoDias(e.target.value)}
                            className="w-full px-3 py-2.5 bg-[#f9fafb] border border-[#e5e7eb] rounded-lg text-sm font-normal text-[#111827] outline-none focus:border-[#1d6fb8] transition-colors"
                        >
                            <option value="">Não informado</option>
                            {prazosDisponiveis.map(d => (
                                <option key={d} value={String(d)}>
                                    {d === 0 ? 'À vista' : `${d} dias`} — {(fedTaxes.anticipationRates?.[String(d)] ?? 0).toFixed(2).replace('.', ',')}%
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="text-[10px] font-medium text-[#6b7280] uppercase tracking-tighter block mb-1.5">Comissão (%)</label>
                        <input
                            type="number"
                            step="0.01"
                            value={comissaoPercent}
                            onChange={e => setComissaoPercent(e.target.value)}
                            placeholder={`Padrão: ${(fedTaxes.commissionPercent ?? 0).toFixed(2).replace('.', ',')}%`}
                            className="w-full px-3 py-2.5 bg-[#f9fafb] border border-[#e5e7eb] rounded-lg text-sm font-normal text-[#111827] outline-none focus:border-[#1d6fb8] transition-colors"
                        />
                    </div>
                </div>
            </div>

            {/* Importar */}
            <div className="bg-white border border-[#e5e7eb] p-6 rounded-xl flex flex-wrap items-center justify-between gap-4">
                <div>
                    <h4 className="font-medium text-sm text-[#111827] mb-1">Planilha de rotas</h4>
                    <p className="text-[11px] font-normal text-[#6b7280]">
                        Colunas: <span className="font-medium">Origem</span>, <span className="font-medium">Destino</span>, <span className="font-medium">Veículo</span>.
                        {nomeArquivo && <span className="ml-2 text-[#111827]">· {nomeArquivo}</span>}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => inputRef.current?.click()}
                        disabled={rodando}
                        className="px-4 py-2.5 bg-[#1d6fb8] text-white rounded-lg font-medium text-xs hover:bg-[#185a96] disabled:opacity-50 transition-colors flex items-center gap-2"
                    >
                        <Upload className="w-3.5 h-3.5" strokeWidth={1.75} />
                        {rodando ? `Processando ${progresso.feitas}/${progresso.total}…` : 'Importar planilha'}
                    </button>
                    <input
                        ref={inputRef}
                        type="file"
                        className="hidden"
                        accept=".xlsx,.xls"
                        onChange={e => aoEscolherArquivo(e.target.files?.[0])}
                    />
                    {linhas && linhas.length > 0 && (
                        <button
                            onClick={() => { exportarBidExcel(linhas); onFeedback?.('Excel gerado.'); }}
                            className="px-4 py-2.5 bg-white border border-[#e5e7eb] text-[#111827] rounded-lg font-medium text-xs hover:bg-[#f9fafb] transition-colors flex items-center gap-2"
                        >
                            <FileDown className="w-3.5 h-3.5 text-[#1d6fb8]" strokeWidth={1.75} /> Exportar Excel
                        </button>
                    )}
                </div>
            </div>

            {colunasFaltando.length > 0 && (
                <div className="flex items-start gap-2 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                    <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" strokeWidth={1.75} />
                    <p className="text-[11px] font-normal text-amber-800">
                        Coluna(s) não encontrada(s): <span className="font-medium">{colunasFaltando.join(', ')}</span>.
                        O lote rodou de todo jeito — o que faltou virou pendência na linha, não erro do arquivo.
                    </p>
                </div>
            )}

            {/* Resumo */}
            {resumo && (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                    {[
                        { rot: 'Linhas', val: String(resumo.total), cor: 'text-[#111827]' },
                        { rot: 'Com preço', val: String(resumo.ok), cor: 'text-emerald-600' },
                        { rot: 'Pendência', val: String(resumo.pendencia + resumo.urbano + resumo.falha), cor: resumo.pendencia + resumo.urbano + resumo.falha > 0 ? 'text-amber-600' : 'text-[#9ca3af]' },
                        { rot: 'Alerta de piso', val: String(resumo.comAlerta), cor: resumo.comAlerta > 0 ? 'text-red-600' : 'text-[#9ca3af]' },
                        { rot: 'Margem líq. média', val: pct(resumo.margemLiquidaMedia), cor: 'text-[#111827]' },
                        { rot: 'Preço sugerido total', val: brl(resumo.totalPrecoSugerido), cor: 'text-[#1d6fb8]' },
                    ].map(c => (
                        <div key={c.rot} className="bg-white border border-[#e5e7eb] rounded-xl p-4">
                            <p className="text-[9px] font-medium text-[#6b7280] uppercase tracking-widest mb-1">{c.rot}</p>
                            <p className={`text-lg font-medium ${c.cor}`}>{c.val}</p>
                        </div>
                    ))}
                </div>
            )}

            {estatQualp && (
                <div className="flex items-start gap-2 p-4 bg-[#f9fafb] border border-[#e5e7eb] rounded-xl">
                    <Info className="w-4 h-4 text-[#6b7280] mt-0.5 shrink-0" strokeWidth={1.75} />
                    <p className="text-[11px] font-normal text-[#6b7280]">
                        Qualp: <span className="font-medium text-[#111827]">{estatQualp.consultas} consulta(s)</span> para{' '}
                        {estatQualp.distintas} rota(s) distinta(s) — {estatQualp.economizadas} consulta(s) poupada(s) pelo dedup.
                        No máximo {CONCORRENCIA} simultâneas.
                    </p>
                </div>
            )}

            {/* Resultado */}
            {linhas && (
                <div className="bg-white border border-[#e5e7eb] rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead className="bg-[#f9fafb] border-b border-[#e5e7eb]">
                                <tr className="text-[#6b7280]">
                                    <th className="px-3 py-2.5 text-left font-medium">#</th>
                                    <th className="px-3 py-2.5 text-left font-medium">Origem</th>
                                    <th className="px-3 py-2.5 text-left font-medium">Destino</th>
                                    <th className="px-3 py-2.5 text-left font-medium">Veículo</th>
                                    <th className="px-3 py-2.5 text-right font-medium">KM</th>
                                    <th className="px-3 py-2.5 text-right font-medium">Pedágio</th>
                                    <th className="px-3 py-2.5 text-right font-medium">Piso ANTT</th>
                                    <th className="px-3 py-2.5 text-right font-medium">Custo</th>
                                    <th className="px-3 py-2.5 text-right font-medium">Preço sugerido</th>
                                    <th className="px-3 py-2.5 text-right font-medium">Margem líq.</th>
                                    <th className="px-3 py-2.5 text-left font-medium">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {linhas.map(l => (
                                    <tr key={l.linhaExcel} className="border-b border-[#f3f4f6] last:border-0 hover:bg-[#f9fafb]">
                                        <td className="px-3 py-2.5 text-[#9ca3af]">{l.linhaExcel}</td>
                                        <td className="px-3 py-2.5 text-[#111827]">{l.origem || '—'}</td>
                                        <td className="px-3 py-2.5 text-[#111827]">{l.destino || '—'}</td>
                                        <td className="px-3 py-2.5 text-[#111827]">
                                            {l.veiculo || '—'}
                                            {l.veiculo && !l.veiculoDaLinha && (
                                                <span className="ml-1 text-[9px] font-medium text-blue-500 uppercase">padrão</span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2.5 text-right text-[#111827]">{numero(l.km)}</td>
                                        <td className="px-3 py-2.5 text-right text-[#111827]">{brl(l.pedagio)}</td>
                                        <td className="px-3 py-2.5 text-right text-[#111827]">{brl(l.pisoAntt)}</td>
                                        <td className="px-3 py-2.5 text-right text-[#111827]">{brl(l.custoBase)}</td>
                                        <td className="px-3 py-2.5 text-right font-medium text-[#1d6fb8]">{brl(l.precoSugerido)}</td>
                                        <td className={`px-3 py-2.5 text-right font-medium ${(l.margemLiquidaRS ?? 0) > 0 ? 'text-emerald-600' : l.margemLiquidaRS == null ? 'text-[#9ca3af]' : 'text-red-600'}`}>
                                            {brl(l.margemLiquidaRS)}
                                            {l.margemLiquidaPercent != null && (
                                                <span className="block text-[9px] font-normal text-[#9ca3af]">{pct(l.margemLiquidaPercent)}</span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2.5">
                                            <span className={`inline-block px-2 py-0.5 rounded-md border text-[9px] font-medium uppercase tracking-tight ${CORES_STATUS[l.status]}`}>
                                                {rotuloStatus(l)}
                                            </span>
                                            {(l.pendencias.length > 0 || l.alertas.length > 0) && (
                                                <p className="text-[9px] font-normal text-[#6b7280] mt-1 max-w-xs">
                                                    {[...l.alertas, ...l.pendencias].join(' · ')}
                                                </p>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
};
