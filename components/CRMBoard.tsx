
import React, { useState, useMemo } from 'react';
import { FreightCalculation, QuoteStatus, LOST_REASONS, LostReason } from '../types';
import { MoreVertical, Paperclip, X, Check, FileText, Calendar, DollarSign, Truck, MapPin, AlertCircle } from 'lucide-react';

interface CRMBoardProps {
    quotes: FreightCalculation[];
    onUpdateStatus: (id: string, newStatus: QuoteStatus, lostData?: { reason: LostReason; obs: string; fileUrl: string }) => void;
    customers: any[];
}

const COLUMNS: { id: QuoteStatus; label: string; color: string }[] = [
    { id: 'pending', label: 'Cotações', color: 'bg-blue-100 text-blue-800' },
    { id: 'respondida', label: 'Respondidas', color: 'bg-purple-100 text-purple-800' },
    { id: 'aprovada', label: 'Aprovadas', color: 'bg-emerald-100 text-emerald-800' },
    { id: 'em_operacao', label: 'Em Operação', color: 'bg-amber-100 text-amber-800' },
    { id: 'won', label: 'Ganha', color: 'bg-green-100 text-green-800' },
    { id: 'lost', label: 'Perdida', color: 'bg-red-100 text-red-800' }
];

export const CRMBoard: React.FC<CRMBoardProps> = ({ quotes, onUpdateStatus, customers }) => {
    const [draggedId, setDraggedId] = useState<string | null>(null);
    const [showLostModal, setShowLostModal] = useState<string | null>(null);
    const [lostForm, setLostForm] = useState({ reason: '' as LostReason, obs: '', fileUrl: '' });

    const columns = useMemo(() => {
        const cols: Record<QuoteStatus, FreightCalculation[]> = {
            pending: [], respondida: [], aprovada: [], em_operacao: [], won: [], lost: []
        };
        quotes.forEach(q => {
            const status = q.status as QuoteStatus;
            if (cols[status]) cols[status].push(q);
            else cols['pending'].push(q); // Fallback
        });
        return cols;
    }, [quotes]);

    const handleDragStart = (e: React.DragEvent, id: string) => {
        setDraggedId(id);
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    };

    const handleDrop = (e: React.DragEvent, status: QuoteStatus) => {
        e.preventDefault();
        if (!draggedId) return;

        if (status === 'lost') {
            setShowLostModal(draggedId);
        } else {
            onUpdateStatus(draggedId, status);
        }
        setDraggedId(null);
    };

    const handleLostSubmit = () => {
        if (!showLostModal || !lostForm.reason) return;
        onUpdateStatus(showLostModal, 'lost', lostForm);
        setShowLostModal(null);
        setLostForm({ reason: '', obs: '', fileUrl: '' });
    };

    const formatCurrency = (val: number) => val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    return (
        <div className="flex h-full overflow-x-auto gap-4 p-4 pb-2">
            {COLUMNS.map(col => {
                const items = columns[col.id];
                const totalValue = items.reduce((acc, curr) => acc + (curr.totalFreight || 0), 0);

                return (
                    <div
                        key={col.id}
                        className="min-w-[300px] w-[300px] flex flex-col bg-slate-50/50 rounded-xl border border-slate-200 shadow-sm"
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDrop(e, col.id)}
                    >
                        {/* Column Header */}
                        <div className={`p-3 rounded-t-xl border-b border-slate-200 flex flex-col gap-1 ${col.color.split(' ')[0]}`}>
                            <div className="flex justify-between items-center">
                                <span className={`font-bold text-sm uppercase ${col.color.split(' ')[1]}`}>{col.label}</span>
                                <span className="bg-white/50 px-2 py-0.5 rounded-full text-xs font-bold">{items.length}</span>
                            </div>
                            <div className="text-xs font-medium opacity-80">
                                Total: {formatCurrency(totalValue)}
                            </div>
                        </div>

                        {/* Cards Container */}
                        <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-2 min-h-[100px]">
                            {items.map(quote => {
                                const customer = customers.find(c => c.id === quote.customerId);
                                return (
                                    <div
                                        key={quote.id}
                                        draggable
                                        onDragStart={(e) => handleDragStart(e, quote.id)}
                                        className="bg-white p-3 rounded-lg shadow-sm border border-slate-200 cursor-move hover:shadow-md transition-all active:cursor-grabbing group"
                                    >
                                        <div className="flex justify-between items-start mb-2">
                                            <span className="text-[10px] font-bold text-slate-500">{quote.proposalNumber}</span>
                                            {quote.disponibilidade === 'Imediato' && (
                                                <span className="bg-red-50 text-red-600 text-[10px] px-1.5 py-0.5 rounded font-bold flex items-center gap-1">
                                                    <AlertCircle className="w-3 h-3" /> Imediato
                                                </span>
                                            )}
                                        </div>

                                        <div className="mb-2">
                                            <h4 className="font-bold text-slate-800 text-sm line-clamp-1">{customer?.name || 'Cliente Desconhecido'}</h4>
                                            <div className="flex items-center gap-1 text-[11px] text-slate-500 mt-1">
                                                <MapPin className="w-3 h-3" />
                                                <span className="truncate max-w-[200px]">{quote.origin.split(',')[0]} ➝ {quote.destination.split(',')[0]}</span>
                                            </div>
                                        </div>

                                        <div className="flex justify-between items-end mt-2 pt-2 border-t border-slate-100">
                                            <div className="flex flex-col">
                                                <span className="text-[10px] text-slate-400 font-medium">{quote.vehicleType.split('-')[0]}</span>
                                                <span className="text-sm font-black text-slate-700">{formatCurrency(quote.totalFreight)}</span>
                                            </div>
                                            <div className="text-[10px] text-slate-400">
                                                {new Date(quote.createdAt).toLocaleDateString()}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            })}

            {/* Lost Reason Modal */}
            {showLostModal && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 animate-scale-in">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-lg font-bold text-slate-800">Justificar Perda</h3>
                            <button onClick={() => setShowLostModal(null)} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                                <X className="w-5 h-5 text-slate-500" />
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Motivo <span className="text-red-500">*</span></label>
                                <select
                                    value={lostForm.reason}
                                    onChange={(e) => setLostForm({ ...lostForm, reason: e.target.value as LostReason })}
                                    className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                                >
                                    <option value="">Selecione um motivo...</option>
                                    {Object.entries(LOST_REASONS).map(([key, label]) => (
                                        <option key={key} value={key}>{label}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Observações (Opcional)</label>
                                <textarea
                                    value={lostForm.obs}
                                    onChange={(e) => setLostForm({ ...lostForm, obs: e.target.value })}
                                    className="w-full p-2 border border-slate-300 rounded-lg h-24 resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                                    placeholder="Detalhes adicionais..."
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Anexo (URL - Opcional)</label>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={lostForm.fileUrl}
                                        onChange={(e) => setLostForm({ ...lostForm, fileUrl: e.target.value })}
                                        className="flex-1 p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                                        placeholder="https://..."
                                    />
                                    <button className="bg-slate-100 p-2 rounded-lg text-slate-600 hover:bg-slate-200 transition-colors">
                                        <Paperclip className="w-5 h-5" />
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-end gap-3 mt-8">
                            <button
                                onClick={() => setShowLostModal(null)}
                                className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-100 rounded-lg transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleLostSubmit}
                                disabled={!lostForm.reason}
                                className="px-6 py-2 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-red-200"
                            >
                                Confirmar Perda
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
