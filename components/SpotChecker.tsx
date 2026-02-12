
import React, { useState } from 'react';
import { Zap, RotateCcw, CheckCircle, AlertTriangle, Calendar, MapPin, AlertCircle } from 'lucide-react';
import { ANTTCoefficients, FederalTaxes } from '../types';
import { estimateDistance } from '../services/geminiService';

interface SpotCheckerProps {
    vehicleConfigs: Record<string, ANTTCoefficients & { factor?: number; axles?: number; capacity?: number; consumption?: number }>;
    fedTaxes: FederalTaxes;
}

export const SpotChecker: React.FC<SpotCheckerProps> = ({ vehicleConfigs, fedTaxes }) => {
    const [spotOrigin, setSpotOrigin] = useState('');
    const [spotDest, setSpotDest] = useState('');
    const [spotFreight, setSpotFreight] = useState('');
    const [spotAxles, setSpotAxles] = useState('6');
    const [spotVehicle, setSpotVehicle] = useState(Object.keys(vehicleConfigs)[0] || 'Truck');
    const [spotResult, setSpotResult] = useState<any>(null);
    const [spotLoading, setSpotLoading] = useState(false);

    const handleSpotCheck = async () => {
        if (!spotOrigin || !spotDest || !spotFreight) return;
        setSpotLoading(true);
        try {
            const config = vehicleConfigs[spotVehicle];
            const axles = parseInt(spotAxles) || config?.axles || 6;

            // Fetch distance
            const distResult = await estimateDistance(spotOrigin, spotDest, spotVehicle, axles);
            const dist = distResult.km;
            const tolls = distResult.estimatedTolls;
            setSpotOrigin(distResult.originNormalized);
            setSpotDest(distResult.destinationNormalized);

            const freteOfertado = parseFloat(spotFreight.replace(',', '.')) || 0;

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

            // ICMS (interestadual 12% padrão, crédito presumido 20%)
            const icmsRate = 12;
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

            const anttOk = pisoANTT <= freteOfertado || pisoANTT === 0;
            const ebitdaOk = ebitdaPercent >= 15;
            const canTake = anttOk && ebitdaOk;

            setSpotResult({
                freteOfertado, pisoANTT, dist, tolls,
                icmsRate, icmsCheio, creditoPresumido, icmsEfetivo,
                fedTaxPercent, fedTaxAmount, impostoTotal,
                ebitda, ebitdaPercent,
                anttOk, ebitdaOk, canTake, axles
            });
        } catch (err) {
            console.error(err);
        } finally {
            setSpotLoading(false);
        }
    };

    const fmt = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* LEFT: Input Form */}
            <div className="space-y-6">
                <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border space-y-5">
                    <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase block mb-2">Rota (Cidade/UF)</label>
                        <input type="text" className="w-full px-6 py-4 bg-slate-50 rounded-2xl font-bold border-2 border-transparent focus:border-blue-200 outline-none mb-3" value={spotOrigin} onChange={e => setSpotOrigin(e.target.value)} placeholder="Origem — Ex: Serra, ES" />
                        <input type="text" className="w-full px-6 py-4 bg-slate-50 rounded-2xl font-bold border-2 border-transparent focus:border-blue-200 outline-none" value={spotDest} onChange={e => setSpotDest(e.target.value)} placeholder="Destino — Ex: Duque de Caxias, RJ" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-[10px] font-black text-slate-400 uppercase block mb-2">Frete Ofertado (R$)</label>
                            <input type="text" className="w-full px-6 py-4 bg-blue-50 rounded-2xl font-black text-xl text-blue-700 border-2 border-blue-200 focus:border-blue-400 outline-none" value={spotFreight} onChange={e => setSpotFreight(e.target.value)} placeholder="0,00" />
                        </div>
                        <div>
                            <label className="text-[10px] font-black text-slate-400 uppercase block mb-2">Config. Eixos</label>
                            <div className="flex items-center gap-3">
                                <input type="number" className="w-24 px-4 py-4 bg-slate-50 rounded-2xl font-black text-center border-2 border-transparent focus:border-blue-200 outline-none" value={spotAxles} onChange={e => setSpotAxles(e.target.value)} />
                                <span className="text-sm font-bold text-slate-400">Eixos</span>
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
                        {spotLoading ? 'Analisando...' : 'VERIFICAR CARGA'}
                    </button>
                </div>

                {/* Tax Summary Card */}
                {spotResult && (
                    <div className="bg-white p-6 rounded-[2rem] shadow-sm border space-y-3 animate-fade-in">
                        <h3 className="font-black text-[11px] uppercase text-slate-400 tracking-widest">Resumo Tributário Automatizado</h3>
                        <p className="text-xs text-slate-500 leading-relaxed">
                            O cálculo considera Alíquotas Interestaduais ({spotResult.icmsRate}%), e o crédito presumido de 20% sobre o ICMS devido.
                        </p>
                    </div>
                )}
            </div>

            {/* RIGHT: Results Panel */}
            <div className="space-y-6">
                {spotResult ? (
                    <>
                        {/* Decision Badge */}
                        <div className={`p-8 rounded-[2.5rem] shadow-xl text-white relative overflow-hidden ${spotResult.canTake ? 'bg-emerald-500' : 'bg-amber-500'}`}>
                            <div className="absolute -right-8 -top-8 w-40 h-40 bg-white/10 rounded-full"></div>
                            <div className="flex items-start gap-6">
                                <div className={`p-4 rounded-2xl ${spotResult.canTake ? 'bg-emerald-400' : 'bg-amber-400'}`}>
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

                        {/* ANTT Compliance */}
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
                                    <p className="text-[10px] font-bold text-slate-400 uppercase">P_Max Oferecido</p>
                                    <p className={`text-2xl font-black ${spotResult.anttOk ? 'text-emerald-500' : 'text-red-500'}`}>R$ {fmt(spotResult.freteOfertado)}</p>
                                </div>
                            </div>
                            <p className="text-[10px] text-slate-400">* O cálculo considera a categoria informada, {fmt(spotResult.dist)} KM estimados e custos de {spotResult.axles} eixos.</p>
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
                        <h3 className="font-black text-[#344a5e] text-lg">Verificação Rápida de Carga</h3>
                        <p className="text-xs text-slate-400 max-w-md leading-relaxed">Preencha a rota, o valor oferecido e o tipo de veículo. O sistema cruzará automaticamente com a tabela ANTT e tributação para dizer se você pode pegar a carga.</p>
                    </div>
                )}
            </div>
        </div>
    );
};
