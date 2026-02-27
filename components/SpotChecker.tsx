
import React, { useState } from 'react';
import { Zap, RotateCcw, CheckCircle, AlertTriangle, Calendar, MapPin, AlertCircle, Handshake, TrendingUp, PieChart } from 'lucide-react';
import { ANTTCoefficients, FederalTaxes, Customer, FreightCalculation } from '../types';
import { estimateDistance } from '../services/geminiService';
import { getIcmsRate, getUF } from '../utils/icms';

interface SpotCheckerProps {
    vehicleConfigs: Record<string, ANTTCoefficients & { factor?: number; axles?: number; capacity?: number; consumption?: number }>;
    fedTaxes: FederalTaxes;
    onAcceptCharge?: (data: FreightCalculation) => void;
    onSimulate?: (data: any) => void;
    stats?: { simulated: number; converted: number };
    customers: Customer[];
    history: FreightCalculation[];
}

export const SpotChecker: React.FC<SpotCheckerProps> = ({ vehicleConfigs, fedTaxes, onAcceptCharge, onSimulate, stats, customers, history }) => {
    const [spotOrigin, setSpotOrigin] = useState('');
    const [spotDest, setSpotDest] = useState('');
    const [spotFreight, setSpotFreight] = useState('');
    const [spotKm, setSpotKm] = useState('');
    const [spotVehicle, setSpotVehicle] = useState(Object.keys(vehicleConfigs)[0] || 'Truck');
    const [selectedCustomerId, setSelectedCustomerId] = useState('');
    const [spotResult, setSpotResult] = useState<any>(null);
    const [spotLoading, setSpotLoading] = useState(false);
    const [loadingDistance, setLoadingDistance] = useState(false);

    const handleFetchDistance = async () => {
        if (!spotOrigin || !spotDest) return;
        setLoadingDistance(true);
        try {
            const config = vehicleConfigs[spotVehicle];
            const result = await estimateDistance(spotOrigin, spotDest, spotVehicle, config?.axles);
            if (!result.error) {
                setSpotKm(result.km.toString());
                setSpotOrigin(result.originNormalized);
                setSpotDest(result.destinationNormalized);
            }
        } catch (err) {
            console.error('Spot KM fetch error:', err);
        } finally {
            setLoadingDistance(false);
        }
    };

    const handleSpotCheck = async () => {
        if (!spotOrigin || !spotDest || !spotFreight) return;
        setSpotLoading(true);
        try {
            const config = vehicleConfigs[spotVehicle];
            const configAxles = config?.axles || 6;

            const cleanNum = (s: string) => {
                if (!s) return 0;
                // Remove R$, spaces, and handle both . and ,
                const cleaned = s.replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.');
                const parsed = parseFloat(cleaned);
                return isNaN(parsed) ? 0 : parsed;
            };

            let dist = cleanNum(spotKm);
            let tolls = spotResult?.tolls || 0;

            // Fetch distance IF KM is 0 or empty
            if (dist <= 0) {
                const distResult = await estimateDistance(spotOrigin, spotDest, spotVehicle, configAxles);
                if (distResult.error) {
                    console.error('Spot KM Error:', distResult.error);
                    // Add a temporary visual indicator of error if needed
                    // For now, let's keep it simple as this component is less complex than App.tsx
                } else {
                    dist = distResult.km;
                    tolls = distResult.estimatedTolls;
                    setSpotKm(dist.toString());
                    setSpotOrigin(distResult.originNormalized);
                    setSpotDest(distResult.destinationNormalized);
                }
            }

            const freteOfertado = cleanNum(spotFreight);

            // ANTT Floor
            let pisoANTT = 0;
            if (config) {
                switch (config.calcMode) {
                    case 'ANTT': pisoANTT = config.fixed + (dist * config.variable); break;
                    case 'KM': pisoANTT = dist * config.factor; break;
                    case 'KM_ROUND_TRIP': pisoANTT = dist * 2 * config.factor; break;
                    case 'FREE': pisoANTT = 0; break;
                }
            }

            // ICMS (interestadual 12% padrão ou dinâmica por tabela)


            const orgUF = getUF(spotOrigin);
            const dstUF = getUF(spotDest);
            const icmsRate = getIcmsRate(orgUF || '', dstUF || '', fedTaxes.icmsRates);

            const icmsCheio = freteOfertado * (icmsRate / 100);
            const creditoPresumido = icmsCheio * 0.20;
            const icmsEfetivo = icmsCheio - creditoPresumido;

            // Federal Taxes
            const fedTaxPercent = fedTaxes.pis + fedTaxes.cofins + fedTaxes.csll + fedTaxes.irpj;
            const fedTaxAmount = freteOfertado * (fedTaxPercent / 100);

            const impostoTotal = icmsEfetivo + fedTaxAmount;

            // EBITDA
            const ebitda = freteOfertado - pisoANTT - impostoTotal;
            const ebitdaPercent = freteOfertado > 0 ? (ebitda / freteOfertado) * 100 : 0;

            const anttOk = (pisoANTT <= freteOfertado || pisoANTT === 0) && dist > 0;
            const ebitdaOk = ebitdaPercent >= 15;
            const canTake = anttOk && ebitdaOk;

            // Strategic Insights
            // totalTaxRate: ICMS (12% * 0.8 efetivo = 9.6%) + Fed Taxes
            const totalTaxRate = (icmsRate * 0.8 / 100) + (fedTaxPercent / 100);
            const targetMarginRate = 0.15;
            const retentionRate = 1 - totalTaxRate - targetMarginRate; // Quanto sobra pro motorista após impostos e margem

            const maxDriverPayment = isNaN(freteOfertado * retentionRate) ? 0 : freteOfertado * retentionRate;
            const suggestedSalesFreight = (retentionRate > 0 && !isNaN(pisoANTT / retentionRate)) ? (pisoANTT / retentionRate) : 0;



            const resultData = {
                freteOfertado, pisoANTT, dist, tolls,
                icmsRate, icmsCheio, creditoPresumido, icmsEfetivo,
                fedTaxPercent, fedTaxAmount, impostoTotal,
                ebitda, ebitdaPercent,
                anttOk, ebitdaOk, canTake, axles: configAxles,
                maxDriverPayment, suggestedSalesFreight,
                configCalcMode: config?.calcMode || 'ANTT',
                vehicleName: spotVehicle,
                origin: spotOrigin,
                destination: spotDest
            };

            setSpotResult(resultData);
            onSimulate?.({ ...resultData, customerId: selectedCustomerId });
        } catch (err) {
            console.error(err);
        } finally {
            setSpotLoading(false);
        }
    };

    const fmt = (v: any) => {
        const n = parseFloat(v);
        if (isNaN(n)) return '0,00';
        return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    const spotHistory = history.filter(h => h.status === 'spot_simulated');

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* LEFT: Input Form */}
            <div className="space-y-6">
                <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border space-y-5">
                    <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase block mb-2">Cliente / Embarcador</label>
                        <select
                            className="w-full px-6 py-4 bg-slate-50 rounded-2xl font-bold border-2 border-transparent focus:border-blue-200 outline-none mb-3"
                            value={selectedCustomerId}
                            onChange={e => setSelectedCustomerId(e.target.value)}
                        >
                            <option value="">Selecione o Cliente (Opcional)</option>
                            {customers.map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                        </select>
                        <label className="text-[10px] font-black text-slate-400 uppercase block mb-2">Rota (Cidade/UF)</label>
                        <input type="text" className="w-full px-6 py-4 bg-slate-50 rounded-2xl font-bold border-2 border-transparent focus:border-blue-200 outline-none mb-3" value={spotOrigin} onChange={e => setSpotOrigin(e.target.value)} onBlur={handleFetchDistance} placeholder="Origem — Ex: Serra, ES" />
                        <input type="text" className="w-full px-6 py-4 bg-slate-50 rounded-2xl font-bold border-2 border-transparent focus:border-blue-200 outline-none" value={spotDest} onChange={e => setSpotDest(e.target.value)} onBlur={handleFetchDistance} placeholder="Destino — Ex: Duque de Caxias, RJ" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-[10px] font-black text-slate-400 uppercase block mb-2">Frete Ofertado (R$)</label>
                            <input type="text" className="w-full px-6 py-4 bg-blue-50 rounded-2xl font-black text-xl text-blue-700 border-2 border-blue-200 focus:border-blue-400 outline-none" value={spotFreight} onChange={e => setSpotFreight(e.target.value)} placeholder="0,00" />
                        </div>
                        <div>
                            <label className="text-[10px] font-black text-slate-400 uppercase block mb-2">Distância (KM)</label>
                            <div className="flex items-center gap-3">
                                <input type="text" className="w-full px-4 py-4 bg-slate-50 rounded-2xl font-black text-center border-2 border-transparent focus:border-blue-200 outline-none" value={loadingDistance ? "Calculando..." : spotKm} onChange={e => setSpotKm(e.target.value)} placeholder="Auto" disabled={loadingDistance} />
                                <span className="text-[10px] font-black text-slate-400 uppercase">KM</span>
                            </div>
                        </div>
                    </div>
                    <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase block mb-2">Categoria de Veículo</label>
                        <select className="w-full px-6 py-4 bg-slate-50 rounded-2xl font-bold border-2 border-transparent focus:border-blue-200 outline-none" value={spotVehicle} onChange={e => setSpotVehicle(e.target.value)}>
                            {Object.keys(vehicleConfigs).map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                    </div>
                    <button
                        onClick={handleSpotCheck}
                        disabled={spotLoading || !spotOrigin || !spotDest || !spotFreight}
                        className="w-full py-5 bg-[#344a5e] text-white rounded-2xl font-black uppercase text-sm shadow-xl hover:bg-[#2a3d4e] transition-all flex items-center justify-center gap-3 disabled:opacity-50"
                    >
                        {spotLoading ? <RotateCcw className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />}
                        {spotLoading ? 'Analisando...' : 'SIMULAR & VERIFICAR'}
                    </button>
                </div>

                {/* Analytics Dashboard */}
                {stats && (
                    <div className="bg-[#344a5e] p-8 rounded-[2.5rem] shadow-xl text-white space-y-6">
                        <div className="flex items-center gap-3">
                            <PieChart className="w-6 h-6 text-blue-300" />
                            <h3 className="font-black text-xs uppercase tracking-widest text-blue-200">Funil de Aproveitamento</h3>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="bg-white/10 p-4 rounded-2xl border border-white/10">
                                <p className="text-[9px] font-bold uppercase text-blue-200 mb-1">Simuladas</p>
                                <p className="text-2xl font-black">{stats.simulated}</p>
                            </div>
                            <div className="bg-emerald-500/20 p-4 rounded-2xl border border-emerald-500/20">
                                <p className="text-[9px] font-bold uppercase text-emerald-300 mb-1">Geradas</p>
                                <p className="text-2xl font-black text-emerald-400">{stats.converted}</p>
                            </div>
                        </div>
                        <div className="bg-white/5 p-4 rounded-2xl flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase text-blue-100/60">Taxa de Conversão</span>
                            <span className="text-lg font-black text-blue-300">
                                {stats.simulated > 0 ? ((stats.converted / stats.simulated) * 100).toFixed(1) : '0.0'}%
                            </span>
                        </div>
                    </div>
                )}

                {/* Tax Summary Card */}
                {spotResult && (
                    <div className="bg-white p-6 rounded-[2rem] shadow-sm border space-y-3 animate-fade-in text-center lg:text-left">
                        <h3 className="font-black text-[11px] uppercase text-slate-400 tracking-widest">Resumo Tributário Automatizado</h3>
                        <p className="text-xs text-slate-500 leading-relaxed">
                            O cálculo considera Alíquotas Interestaduais (ICMS) e carga federal completa.
                        </p>
                    </div>
                )}
            </div>

            {/* RIGHT: Results Panel */}
            <div className="space-y-6">
                {spotResult ? (
                    <>
                        {/* Decision Badge */}
                        <div className={`p-8 rounded-[2.5rem] shadow-xl text-white relative overflow-hidden ${spotResult.canTake ? 'bg-emerald-500' : 'bg-red-500'}`}>
                            <div className="absolute -right-8 -top-8 w-40 h-40 bg-white/10 rounded-full"></div>
                            <div className="flex items-start gap-6">
                                <div className={`p-4 rounded-2xl ${spotResult.canTake ? 'bg-emerald-400' : 'bg-red-400'}`}>
                                    {spotResult.canTake ? <CheckCircle className="w-10 h-10" /> : <AlertTriangle className="w-10 h-10" />}
                                </div>
                                <div>
                                    <div className="flex items-center gap-3 mb-1">
                                        <span className="bg-white/20 px-3 py-1 rounded-lg text-[10px] font-black uppercase">EBITDA Alvo: 15%</span>
                                    </div>
                                    <h2 className="text-3xl font-black tracking-tight">{spotResult.canTake ? 'PEGAR CARGA' : 'REVISAR DADOS'}</h2>
                                    <p className="text-sm font-bold opacity-90 mt-1">Margem EBITDA Real: {spotResult.ebitdaPercent.toFixed(1)}%</p>
                                </div>
                            </div>
                        </div>

                        {/* Strategic Insights Section - MOVED HERE */}
                        <div className="bg-[#344a5e] p-8 rounded-[2.5rem] shadow-xl text-white space-y-6">
                            <div className="flex items-center gap-3">
                                <Handshake className="w-6 h-6 text-blue-300" />
                                <h3 className="font-black text-xs uppercase tracking-widest text-blue-200">Insights de Negociação</h3>
                            </div>

                            {spotResult.canTake ? (
                                <div className="bg-white/10 p-6 rounded-2xl border border-white/10">
                                    <p className="text-[10px] font-bold uppercase text-blue-200 mb-2">Teto para o Motorista</p>
                                    <div className="flex items-baseline gap-2">
                                        <span className="text-3xl font-black">R$ {fmt(spotResult.maxDriverPayment)}</span>
                                    </div>
                                    <p className="text-[10px] text-blue-100/60 mt-3 leading-relaxed">
                                        Para resguardar sua **margem de 15%**, você pode pagar até este valor ao motorista (incluindo pedágios).
                                    </p>
                                </div>
                            ) : (
                                <div className="bg-white/10 p-6 rounded-2xl border border-white/10">
                                    <p className="text-[10px] font-bold uppercase text-amber-300 mb-2">Frete de Venda Ideal</p>
                                    <div className="flex items-baseline gap-2 text-amber-400">
                                        <TrendingUp className="w-5 h-5" />
                                        <span className="text-3xl font-black">R$ {fmt(spotResult.suggestedSalesFreight)}</span>
                                    </div>
                                    <p className="text-[10px] text-blue-100/60 mt-3 leading-relaxed">
                                        Para atingir a **margem de 15%** e cobrir o piso ANTT (R$ {fmt(spotResult.pisoANTT)}), o valor de venda sugerido para o cliente é este.
                                    </p>
                                </div>
                            )}

                            {/* PEGARK CARGA BUTTON */}
                            <button
                                onClick={() => onSimulate?.({
                                    ...spotResult,
                                    customerId: selectedCustomerId,
                                    accept: true // Signal to accept immediately
                                })}
                                className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl font-black uppercase text-xs shadow-lg transition-all flex items-center justify-center gap-2 group"
                            >
                                <Zap className="w-4 h-4 fill-white group-hover:scale-110 transition-transform" />
                                PEGAR CARGA E GERAR COTAÇÃO
                            </button>
                        </div>

                        {/* Formação do Piso ANTT — Formula Breakdown */}
                        <div className="bg-white p-6 rounded-[2rem] shadow-sm border space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="font-black text-[11px] uppercase text-slate-400 tracking-widest">Formação do Piso ANTT</h3>
                                <span className="text-[9px] font-black text-blue-600 bg-blue-50 px-3 py-1 rounded-lg">{spotResult.vehicleName}</span>
                            </div>
                            {/* KM retrieved */}
                            <div className="bg-slate-50 p-4 rounded-xl flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <MapPin className="w-5 h-5 text-blue-500" />
                                    <span className="text-sm font-black text-[#344a5e]">Distância Estimada</span>
                                </div>
                                <span className="text-xl font-black text-blue-600">{fmt(spotResult.dist)} KM</span>
                            </div>
                            {/* Formula breakdown */}
                            {spotResult.configCalcMode === 'ANTT' ? (
                                <div className="space-y-3">
                                    <div className="flex justify-between items-center py-2 border-b border-slate-50">
                                        <span className="text-sm font-bold text-slate-500">Coeficiente Variável (por KM)</span>
                                        <span className="font-black text-[#344a5e]">R$ {fmt(spotResult.configVariable)}</span>
                                    </div>
                                    <div className="flex justify-between items-center py-2 border-b border-slate-50">
                                        <span className="text-sm font-bold text-slate-500">KM × Coeficiente</span>
                                        <span className="font-black text-[#344a5e]">R$ {fmt(spotResult.dist * spotResult.configVariable)}</span>
                                    </div>
                                    <div className="flex justify-between items-center py-2 border-b border-slate-50">
                                        <span className="text-sm font-bold text-slate-500">Custo Fixo Cadastrado</span>
                                        <span className="font-black text-[#344a5e]">+ R$ {fmt(spotResult.configFixed)}</span>
                                    </div>
                                    <div className="flex justify-between items-center py-3 bg-blue-50 rounded-xl px-4 -mx-1">
                                        <span className="text-sm font-black text-blue-700">Piso Mínimo Legal (ANTT)</span>
                                        <span className="font-black text-lg text-blue-700">= R$ {fmt(spotResult.pisoANTT)}</span>
                                    </div>
                                </div>
                            ) : spotResult.configCalcMode === 'KM_ROUND_TRIP' ? (
                                <div className="space-y-3">
                                    <div className="flex justify-between items-center py-2 border-b border-slate-50">
                                        <span className="text-sm font-bold text-slate-500">Valor por KM</span>
                                        <span className="font-black text-[#344a5e]">R$ {fmt(spotResult.configFactor)}</span>
                                    </div>
                                    <div className="flex justify-between items-center py-2 border-b border-slate-50">
                                        <span className="text-sm font-bold text-slate-500">KM × 2 (Ida e Volta) × Valor</span>
                                        <span className="font-black text-[#344a5e]">R$ {fmt(spotResult.dist * 2 * spotResult.configFactor)}</span>
                                    </div>
                                    <div className="flex justify-between items-center py-3 bg-blue-50 rounded-xl px-4 -mx-1">
                                        <span className="text-sm font-black text-blue-700">Piso Mínimo</span>
                                        <span className="font-black text-lg text-blue-700">= R$ {fmt(spotResult.pisoANTT)}</span>
                                    </div>
                                </div>
                            ) : spotResult.configCalcMode === 'KM' ? (
                                <div className="space-y-3">
                                    <div className="flex justify-between items-center py-2 border-b border-slate-50">
                                        <span className="text-sm font-bold text-slate-500">Valor por KM</span>
                                        <span className="font-black text-[#344a5e]">R$ {fmt(spotResult.configFactor)}</span>
                                    </div>
                                    <div className="flex justify-between items-center py-3 bg-blue-50 rounded-xl px-4 -mx-1">
                                        <span className="text-sm font-black text-blue-700">Piso Mínimo (KM × Valor)</span>
                                        <span className="font-black text-lg text-blue-700">= R$ {fmt(spotResult.pisoANTT)}</span>
                                    </div>
                                </div>
                            ) : (
                                <div className="py-3 bg-amber-50 rounded-xl px-4 text-center">
                                    <span className="text-sm font-black text-amber-600">Preço livre (sem piso ANTT)</span>
                                </div>
                            )}
                        </div>

                        {/* Compliance Comparison */}
                        <div className="bg-white p-6 rounded-[2rem] shadow-sm border space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="font-black text-[11px] uppercase text-slate-400 tracking-widest">Compliance ANTT</h3>
                                <span className="text-[9px] font-black text-blue-600 bg-blue-50 px-3 py-1 rounded-lg">Res. 5.867/2019</span>
                            </div>
                            <div className="grid grid-cols-2 gap-6">
                                <div>
                                    <p className="text-[10px] font-bold text-slate-400 uppercase">Piso Mínimo Legal</p>
                                    <p className={`text-2xl font-black ${spotResult.anttOk ? 'text-[#344a5e]' : 'text-red-500'}`}>R$ {fmt(spotResult.pisoANTT)}</p>
                                </div>
                                <div>
                                    <p className="text-[10px] font-bold text-slate-400 uppercase">Frete Oferecido</p>
                                    <p className={`text-2xl font-black ${spotResult.anttOk ? 'text-emerald-500' : 'text-red-500'}`}>R$ {fmt(spotResult.freteOfertado)}</p>
                                </div>
                            </div>
                            <p className="text-[10px] text-slate-400">* Dados cruzados com o coeficiente cadastrado em Parâmetros → Frota/ANTT para "{spotResult.vehicleName}", {fmt(spotResult.dist)} KM estimados, {spotResult.axles} eixos.</p>
                        </div>

                        {/* Tax Memory */}
                        <div className="bg-white p-6 rounded-[2rem] shadow-sm border space-y-4">
                            <h3 className="font-black text-[11px] uppercase text-slate-400 tracking-widest">Memória de Cálculo (Lucro Presumido)</h3>
                            <div className="space-y-3">
                                <div className="flex justify-between items-center py-2 border-b border-slate-50">
                                    <span className="text-sm font-bold text-slate-500">Alíquota ICMS (Cheia)</span>
                                    <span className="font-black text-[#344a5e]">{spotResult.icmsRate}%</span>
                                </div>
                                <div className="flex justify-between items-center py-2 border-b border-slate-50">
                                    <span className="text-sm font-bold text-slate-500">Crédito Presumido</span>
                                    <span className="font-black text-emerald-500">- 20%</span>
                                </div>
                                <div className="flex justify-between items-center py-2 border-b border-slate-50">
                                    <span className="text-sm font-bold text-slate-500">ICMS Efetivo</span>
                                    <span className="font-black text-[#344a5e]">R$ {fmt(spotResult.icmsEfetivo)}</span>
                                </div>
                                <div className="flex justify-between items-center py-2 border-b border-slate-50">
                                    <span className="text-sm font-bold text-slate-500">PIS + COFINS + CSLL + IRPJ ({spotResult.fedTaxPercent.toFixed(2)}%)</span>
                                    <span className="font-black text-[#344a5e]">R$ {fmt(spotResult.fedTaxAmount)}</span>
                                </div>
                                <div className="flex justify-between items-center py-3 bg-slate-50 rounded-xl px-4 -mx-1">
                                    <span className="text-sm font-black text-[#344a5e]">Imposto Efetivo (Total)</span>
                                    <span className="font-black text-red-500">R$ {fmt(spotResult.impostoTotal)}</span>
                                </div>
                                <div className="flex justify-between items-center py-3 bg-blue-50 rounded-xl px-4 -mx-1 mt-2">
                                    <span className="text-sm font-black text-blue-700">EBITDA Líquido</span>
                                    <span className={`font-black text-lg ${spotResult.ebitdaPercent >= 15 ? 'text-emerald-600' : 'text-red-500'}`}>R$ {fmt(spotResult.ebitda)} ({spotResult.ebitdaPercent.toFixed(1)}%)</span>
                                </div>
                            </div>
                        </div>

                    </>
                ) : (
                    <div className="bg-white p-16 rounded-[2.5rem] shadow-sm border flex flex-col items-center justify-center text-center gap-4">
                        <div className="w-20 h-20 bg-slate-50 rounded-3xl flex items-center justify-center">
                            <Zap className="w-10 h-10 text-slate-200" />
                        </div>
                        <h3 className="font-black text-[#344a5e] text-lg">Frete Rápido</h3>
                        <p className="text-xs text-slate-400 max-w-md leading-relaxed">Preencha a rota, o valor oferecido e o tipo de veículo. O sistema cruzará automaticamente com a tabela ANTT e tributação para dizer se você pode pegar a carga.</p>
                    </div>
                )}
            </div>

            {/* History Section */}
            <div className="col-span-1 lg:col-span-2 space-y-4 animate-fade-in-up mt-8">
                <div className="flex items-center gap-4 px-4 mb-4">
                    <RotateCcw className="w-6 h-6 text-[#344a5e]" />
                    <h1 className="text-2xl font-black text-[#344a5e] tracking-tight">Histórico de Simulações Spot</h1>
                </div>

                {spotHistory.length === 0 ? (
                    <div className="bg-white p-12 rounded-[2.5rem] shadow-sm border flex flex-col items-center justify-center text-center gap-4 opacity-60">
                        <div className="w-16 h-16 bg-slate-50 rounded-3xl flex items-center justify-center">
                            <RotateCcw className="w-8 h-8 text-slate-300" />
                        </div>
                        <h3 className="font-black text-[#344a5e]">Nenhuma simulação recente</h3>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {spotHistory.map(simulation => {
                            const customer = customers.find(c => c.id === simulation.customerId);
                            return (
                                <div key={simulation.id} className="bg-white py-2.5 px-6 rounded-[1.5rem] border shadow-sm flex flex-col lg:flex-row lg:items-center gap-4 group hover:border-blue-500 transition-all">
                                    <div className="flex items-center gap-3 lg:w-48">
                                        <div className={`p-1.5 rounded-lg ${(simulation.realMarginPercent || 0) >= 15 ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'}`}>
                                            {(simulation.realMarginPercent || 0) >= 15 ? <CheckCircle className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-[7px] font-black uppercase text-slate-400">{new Date(simulation.createdAt).toLocaleDateString()} {new Date(simulation.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                                            <p className="font-black text-[#344a5e] leading-tight truncate text-[10px]">{customer?.name || 'Cliente Avulso'}</p>
                                        </div>
                                    </div>

                                    <div className="flex-1 grid grid-cols-2 lg:grid-cols-4 gap-6 px-4">
                                        <div>
                                            <p className="text-[7px] font-bold uppercase text-slate-400">Origem</p>
                                            <p className="font-black text-[9px] text-[#344a5e] truncate" title={simulation.origin}>{simulation.origin.split(',')[0]}</p>
                                        </div>
                                        <div>
                                            <p className="text-[7px] font-bold uppercase text-slate-400">Destino</p>
                                            <p className="font-black text-[9px] text-[#344a5e] truncate" title={simulation.destination}>{simulation.destination.split(',')[0]}</p>
                                        </div>
                                        <div>
                                            <p className="text-[7px] font-bold uppercase text-slate-400">Veículo</p>
                                            <p className="font-black text-[9px] text-[#344a5e] truncate">{simulation.vehicleType}</p>
                                        </div>
                                        <div>
                                            <p className="text-[7px] font-bold uppercase text-slate-400">Valor Oferta</p>
                                            <p className="font-black text-[10px] text-blue-600">R$ {fmt(simulation.totalFreight)}</p>
                                        </div>
                                    </div>

                                    <div className="lg:w-48 flex items-center justify-end gap-5">
                                        <div className="text-right">
                                            <p className="text-[7px] font-bold uppercase text-slate-400">Margem</p>
                                            <p className={`font-black text-[10px] ${(simulation.realMarginPercent || 0) >= 15 ? 'text-emerald-500' : 'text-red-500'}`}>{(simulation.realMarginPercent || 0).toFixed(1)}%</p>
                                        </div>
                                        <button
                                            onClick={() => onAcceptCharge?.(simulation)}
                                            className="bg-[#344a5e] hover:bg-[#2a3d4e] text-white px-3 py-1.5 rounded-lg font-black uppercase text-[7px] flex items-center gap-1.5 shadow-md transition-all whitespace-nowrap"
                                        >
                                            <Zap className="w-2 h-2 text-emerald-400" /> Aceitar
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};
