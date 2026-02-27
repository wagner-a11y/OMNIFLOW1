
import React from 'react';
import { Navigation, MapPin, CheckCircle2, Clock, Truck } from 'lucide-react';
import { FreightCalculation } from '../types';

interface MonitoringPipelineProps {
    quotes: FreightCalculation[];
    onUpdateStatus: (id: string, newStage: string) => void;
}

const STAGES = [
    { id: 'Em Viagem', label: 'Em Viagem', icon: <Navigation className="w-4 h-4" />, color: 'bg-indigo-500' },
    { id: 'No Destino', label: 'No Destino', icon: <MapPin className="w-4 h-4" />, color: 'bg-emerald-500' },
    { id: 'Descarga finalizada', label: 'Descarga finalizada', icon: <CheckCircle2 className="w-4 h-4" />, color: 'bg-gray-700' }
];

export const MonitoringPipeline: React.FC<MonitoringPipelineProps> = ({ quotes, onUpdateStatus }) => {
    const filteredItems = quotes.filter(h => h.status === 'won' && ['Em Viagem', 'No Destino', 'Descarga finalizada', 'Mover p/ Monitoramento'].includes(h.pipelineStage || ''));

    return (
        <div className="flex-1 overflow-x-auto p-6 bg-gray-50/50">
            <div className="flex gap-6 min-w-max">
                {STAGES.map(stage => {
                    const stageItems = filteredItems.filter(item => (item.pipelineStage || 'Em Viagem') === stage.id);

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
                                    <div key={item.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow group">
                                        <div className="flex items-start justify-between mb-3">
                                            <div>
                                                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{item.proposalNumber}</span>
                                                <h4 className="font-bold text-gray-800 leading-tight">{item.clienteNomeOperacao || item.customerId}</h4>
                                            </div>
                                            <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                                                <select
                                                    className="text-[10px] bg-gray-50 border-none rounded p-1 outline-none"
                                                    value={item.pipelineStage || 'Em Viagem'}
                                                    onChange={(e) => onUpdateStatus(item.id, e.target.value)}
                                                >
                                                    {STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                                                    <option value="Nova carga">Voltar p/ Operações</option>
                                                </select>
                                            </div>
                                        </div>

                                        <div className="space-y-2 mb-4">
                                            <div className="flex items-center gap-2 text-xs text-gray-500">
                                                <MapPin className="w-3 h-3 text-red-400" />
                                                <span className="truncate">{item.origin} → {item.destination}</span>
                                            </div>
                                            <div className="flex items-center gap-2 text-xs text-gray-500">
                                                <Clock className="w-3 h-3 text-blue-400" />
                                                <span>Entrega: {item.entregaDate ? new Date(item.entregaDate).toLocaleString('pt-BR') : 'Sem data'}</span>
                                            </div>
                                        </div>

                                        <div className="pt-3 border-t border-gray-50 flex items-center justify-between">
                                            <div className="flex items-center gap-1.5">
                                                <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
                                                <span className="text-[10px] font-bold text-indigo-500 uppercase">Em trânsito</span>
                                            </div>
                                            <div className="text-[10px] text-gray-400">
                                                ID: {item.id.slice(0, 8)}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                {stageItems.length === 0 && (
                                    <div className="border-2 border-dashed border-gray-200 rounded-xl h-24 flex items-center justify-center text-gray-400 text-sm">
                                        Aguardando cargas
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
