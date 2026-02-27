
import React, { useState } from 'react';
import { Truck, Search, ShieldCheck, UserCheck, MapPin, MoreHorizontal, Copy, Check, User, UserMinus, FileText } from 'lucide-react';
import { FreightCalculation } from '../types';
import { LoadDetailModal } from './LoadDetailModal';
import { HiringInfoModal } from './HiringInfoModal';
import { generateHiringPDF } from '../services/pdfService';

interface OperationsPipelineProps {
    quotes: FreightCalculation[];
    onUpdateStatus: (id: string, newStage: string) => void;
    onUpdateLoadData: (id: string, data: Partial<FreightCalculation>) => void;
}

const STAGES = [
    { id: 'Nova carga', label: 'Nova carga', icon: <Truck className="w-4 h-4" />, color: 'bg-blue-500' },
    { id: 'Em contratação', label: 'Em contratação', icon: <Search className="w-4 h-4" />, color: 'bg-orange-500' },
    { id: 'GR', label: 'GR', icon: <ShieldCheck className="w-4 h-4" />, color: 'bg-purple-500' },
    { id: 'Contratado', label: 'Contratado', icon: <UserCheck className="w-4 h-4" />, color: 'bg-emerald-500' },
    { id: 'No cliente', label: 'No cliente', icon: <MapPin className="w-4 h-4" />, color: 'bg-indigo-500' }
];

export const OperationsPipeline: React.FC<OperationsPipelineProps> = ({ quotes, onUpdateStatus, onUpdateLoadData }) => {
    const [selectedLoad, setSelectedLoad] = useState<FreightCalculation | null>(null);
    const [isDetailOpen, setIsDetailOpen] = useState(false);
    const [hiringLoad, setHiringLoad] = useState<FreightCalculation | null>(null);
    const [targetStage, setTargetStage] = useState<string>('Em contratação');
    const [copiedId, setCopiedId] = useState<string | null>(null);

    const filteredItems = quotes.filter(h => h.status === 'won' && !['Em Viagem', 'No Destino', 'Descarga finalizada'].includes(h.pipelineStage || ''));

    const handleCopyGR = (e: React.MouseEvent, item: FreightCalculation) => {
        e.stopPropagation();
        const text = `📝 *DADOS PARA GR - OMNIFLOW*\n\n` +
            `👤 *Motorista:* ${item.motoristaNome || 'N/A'}\n` +
            `🆔 *CPF:* ${item.motoristaCPF || 'N/A'}\n` +
            `📱 *Tel:* ${item.motoristaTelefone || 'N/A'}\n\n` +
            `🚛 *Placa Cavalo:* ${item.placaCavalo || 'N/A'}\n` +
            `📦 *Carreta 1:* ${item.placaCarreta1 || 'N/A'}\n` +
            `📦 *Carreta 2:* ${item.placaCarreta2 || 'N/A'}\n\n` +
            `📍 *Origem:* ${item.coletaEndereco || item.origin}\n` +
            `🏁 *Destino:* ${item.entregaEndereco || item.destination}`;

        navigator.clipboard.writeText(text).then(() => {
            setCopiedId(item.id);
            setTimeout(() => setCopiedId(null), 2000);
        });
    };

    const handleCardClick = (item: FreightCalculation) => {
        setSelectedLoad(item);
        setIsDetailOpen(true);
    };

    const handleStageChange = (item: FreightCalculation, newStage: string) => {
        if (newStage === 'Em contratação' && !item.motoristaNome) {
            setTargetStage('Em contratação');
            setHiringLoad(item);
            return;
        }

        if (newStage === 'GR' && (!item.motoristaRG || !item.placaCavaloRenavam)) {
            setTargetStage('GR');
            setHiringLoad(item);
            return;
        }

        onUpdateStatus(item.id, newStage);
    };

    const handleHiringSubmit = (hiringData: Partial<FreightCalculation>) => {
        if (!hiringLoad) return;
        onUpdateLoadData(hiringLoad.id, {
            ...hiringData,
            pipelineStage: targetStage
        });
        setHiringLoad(null);
    };

    const handleRemoveDriver = (e: React.MouseEvent, item: FreightCalculation) => {
        e.stopPropagation();
        if (window.confirm(`Deseja remover o motorista ${item.motoristaNome} e resetar os dados desta carga?`)) {
            onUpdateLoadData(item.id, {
                motoristaNome: undefined,
                motoristaCPF: undefined,
                motoristaTelefone: undefined,
                motoristaRG: undefined,
                motoristaCnhRegistro: undefined,
                motoristaCnhProtocolo: undefined,
                motoristaCnhSeguranca: undefined,
                placaCavalo: undefined,
                placaCavaloRenavam: undefined,
                placaCavaloChassi: undefined,
                placaCavaloCor: undefined,
                placaCavaloAnoFab: undefined,
                placaCavaloAnoMod: undefined,
                placaCavaloMarca: undefined,
                placaCavaloModelo: undefined,
                placaCarreta1: undefined,
                placaCarreta1Renavam: undefined,
                placaCarreta1Chassi: undefined,
                placaCarreta1Cor: undefined,
                placaCarreta1AnoFab: undefined,
                placaCarreta1AnoMod: undefined,
                placaCarreta1Marca: undefined,
                placaCarreta1Modelo: undefined,
                placaCarreta2: undefined,
                placaCarreta2Renavam: undefined,
                placaCarreta2Chassi: undefined,
                placaCarreta2Cor: undefined,
                placaCarreta2AnoFab: undefined,
                placaCarreta2AnoMod: undefined,
                placaCarreta2Marca: undefined,
                placaCarreta2Modelo: undefined,
                motoristaDocUrl: undefined,
                placaCavaloDocUrl: undefined,
                placaCarreta1DocUrl: undefined,
                placaCarreta2DocUrl: undefined,
                pipelineStage: 'Nova carga'
            });
        }
    };

    return (
        <div className="flex-1 overflow-x-auto p-6 bg-gray-50/50">
            <div className="flex gap-6 min-w-max">
                {STAGES.map(stage => {
                    const stageItems = filteredItems.filter(item => (item.pipelineStage || 'Nova carga') === stage.id);

                    return (
                        <div key={stage.id} className="w-80 flex flex-col gap-4">
                            <div className="flex items-center justify-between px-3 py-2 bg-white rounded-xl shadow-sm border border-gray-100">
                                <div className="flex items-center gap-2">
                                    <div className={`p-1.5 rounded-lg ${stage.color} text-white`}>
                                        {stage.icon}
                                    </div>
                                    <h3 className="font-bold text-gray-700">{stage.label}</h3>
                                </div>
                                <span className="bg-gray-100 text-gray-500 text-xs font-bold px-2 py-1 rounded-full">
                                    {stageItems.length}
                                </span>
                            </div>

                            <div className="flex-1 flex flex-col gap-3 min-h-[500px]">
                                {stageItems.map(item => (
                                    <div
                                        key={item.id}
                                        className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition-all group cursor-pointer active:scale-[0.98]"
                                        onClick={() => handleCardClick(item)}
                                    >
                                        <div className="flex items-start justify-between mb-3">
                                            <div>
                                                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{item.proposalNumber}</span>
                                                <h4 className="font-bold text-gray-800 leading-tight">{item.clienteNomeOperacao || item.customerId}</h4>
                                            </div>
                                            <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1" onClick={e => e.stopPropagation()}>
                                                <select
                                                    className="text-[10px] bg-slate-100 border-none rounded-lg font-bold px-2 py-1 outline-none focus:ring-2 focus:ring-orange-500"
                                                    value={item.pipelineStage || 'Nova carga'}
                                                    onChange={(e) => handleStageChange(item, e.target.value)}
                                                >
                                                    {STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                                                    <option value="Em Viagem">Mover p/ Monitoramento</option>
                                                </select>
                                            </div>
                                        </div>

                                        <div className="space-y-2 mb-4">
                                            <div className="flex items-center gap-2 text-xs text-gray-500">
                                                <MapPin className="w-3 h-3 text-red-400" />
                                                <span className="truncate">{item.origin} → {item.destination}</span>
                                            </div>
                                            <div className="flex items-center gap-2 text-xs text-gray-500">
                                                <Truck className="w-3 h-3 text-blue-400" />
                                                <span className="truncate">{item.veiculoTipoOperacao} - {item.materialTipo}</span>
                                            </div>
                                            {item.motoristaNome && (
                                                <div className="flex items-center gap-2 text-[10px] font-bold text-orange-600 bg-orange-50 px-2 py-1 rounded-md">
                                                    <Search className="w-3 h-3" />
                                                    {item.motoristaNome} / {item.placaCavalo}
                                                </div>
                                            )}
                                        </div>

                                        <div className="pt-3 border-t border-gray-50 flex items-center justify-between">
                                            <div className="text-xs font-black text-emerald-600">
                                                R$ {item.nossoFrete?.toLocaleString('pt-BR')}
                                            </div>

                                            <div className="flex items-center gap-2">
                                                <div className="flex -space-x-2 mr-1">
                                                    <div className="w-6 h-6 rounded-full bg-slate-50 border-2 border-white flex items-center justify-center shadow-sm">
                                                        <User className="w-3 h-3 text-slate-400" />
                                                    </div>
                                                    <div className="w-6 h-6 rounded-full bg-slate-50 border-2 border-white flex items-center justify-center shadow-sm">
                                                        <Truck className="w-3 h-3 text-slate-400" />
                                                    </div>
                                                </div>

                                                {item.motoristaNome && (
                                                    <div className="flex items-center gap-1.5">
                                                        <button
                                                            onClick={(e) => handleCopyGR(e, item)}
                                                            className={`px-2 py-1 rounded flex items-center gap-1.5 transition-all outline-none ${copiedId === item.id ? 'bg-emerald-500 text-white shadow-emerald-200' : 'bg-slate-800 text-white hover:bg-slate-900 shadow-slate-200'} shadow-sm`}
                                                            title="Copiar dados para GR"
                                                        >
                                                            {copiedId === item.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                                                            <span className="text-[10px] font-black uppercase tracking-tighter">{copiedId === item.id ? 'Copiado' : 'GR'}</span>
                                                        </button>

                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); generateHiringPDF(item); }}
                                                            className="p-1 px-1.5 rounded bg-orange-50 text-orange-600 hover:bg-orange-100 transition-all shadow-sm border border-orange-100"
                                                            title="Baixar PDF da Ficha"
                                                        >
                                                            <FileText className="w-3 h-3" />
                                                        </button>

                                                        <button
                                                            onClick={(e) => handleRemoveDriver(e, item)}
                                                            className="p-1 px-1.5 rounded bg-red-50 text-red-500 hover:bg-red-100 transition-all shadow-sm border border-red-100"
                                                            title="Remover Motorista"
                                                        >
                                                            <UserMinus className="w-3 h-3" />
                                                        </button>
                                                    </div>
                                                )}

                                                <button className="p-1 text-slate-300 hover:text-slate-500 transition-colors">
                                                    <MoreHorizontal className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                {stageItems.length === 0 && (
                                    <div className="border-2 border-dashed border-gray-200 rounded-xl h-24 flex items-center justify-center text-gray-400 text-sm">
                                        Vazio
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Modals */}
            {selectedLoad && (
                <LoadDetailModal
                    isOpen={isDetailOpen}
                    onClose={() => setIsDetailOpen(false)}
                    quote={selectedLoad}
                />
            )}

            {hiringLoad && (
                <HiringInfoModal
                    isOpen={!!hiringLoad}
                    onClose={() => setHiringLoad(null)}
                    onSubmit={handleHiringSubmit}
                    quote={hiringLoad}
                    targetStage={targetStage}
                />
            )}
        </div>
    );
};
