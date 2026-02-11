
import React, { useState, useMemo } from 'react';
import { FreightCalculation, QuoteStatus, LOST_REASONS, LostReason, FederalTaxes } from '../types';
import { MoreVertical, Paperclip, X, Check, FileText, Calendar, DollarSign, Truck, MapPin, AlertCircle, TrendingUp, Target } from 'lucide-react';

interface CRMBoardProps {
    quotes: FreightCalculation[];
    onUpdateStatus: (id: string, newStatus: QuoteStatus, lostData?: { reason: LostReason; obs: string; fileUrl: string }) => void;
    customers: any[];
    systemConfig: FederalTaxes;
}

const COLUMNS: { id: QuoteStatus; label: string; color: string; border: string }[] = [
    { id: 'pending', label: 'Cotações (Novas)', color: 'bg-slate-50 text-slate-600', border: 'border-slate-200' },
    { id: 'respondida', label: 'Respondidas', color: 'bg-blue-50 text-blue-600', border: 'border-blue-200' },
    { id: 'aprovada', label: 'Aprovadas', color: 'bg-indigo-50 text-indigo-600', border: 'border-indigo-200' },
    { id: 'em_operacao', label: 'Em Operação', color: 'bg-amber-50 text-amber-600', border: 'border-amber-200' },
    { id: 'won', label: 'Ganha (Faturado)', color: 'bg-emerald-50 text-emerald-600', border: 'border-emerald-200' },
    { id: 'lost', label: 'Perdida', color: 'bg-red-50 text-red-600', border: 'border-red-200' }
];

export const CRMBoard: React.FC<CRMBoardProps> = ({ quotes, onUpdateStatus, customers, systemConfig }) => {
    const [draggedId, setDraggedId] = useState<string | null>(null);
    const [showLostModal, setShowLostModal] = useState<string | null>(null);
    const [lostForm, setLostForm] = useState({ reason: '' as LostReason, obs: '', fileUrl: '' });

    // Filter State
    const [selectedMonth, setSelectedMonth] = useState(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    });

    // Calculations & Filtering
    const { columns, insights } = useMemo(() => {
        const [year, month] = selectedMonth.split('-').map(Number);

        // Filter quotes by month (created_at)
        const filteredQuotes = quotes.filter(q => {
            const date = new Date(q.createdAt);
            return date.getFullYear() === year && date.getMonth() === (month - 1);
        });

        // Columns Logic
        const cols: Record<QuoteStatus, FreightCalculation[]> = {
            pending: [], respondida: [], aprovada: [], em_operacao: [], won: [], lost: []
        };
        filteredQuotes.forEach(q => {
            const status = q.status as QuoteStatus;
            if (cols[status]) cols[status].push(q);
            else cols['pending'].push(q);
        });

        // Insights Logic
        const goalValue = systemConfig.goals?.[selectedMonth] || 0;

        // Realizado = Aprovada + Em Operação + Ganha
        const realizedValue = [...cols.aprovada, ...cols.em_operacao, ...cols.won]
            .reduce((acc, curr) => acc + (curr.totalFreight || 0), 0);

        const percentReached = goalValue > 0 ? (realizedValue / goalValue) * 100 : 0;

        // Business Days Calculation
        const lastDay = new Date(year, month, 0).getDate();
        const businessDaysTotal = Array.from({ length: lastDay }, (_, i) => {
            const d = new Date(year, month - 1, i + 1);
            return d.getDay() !== 0 && d.getDay() !== 6;
        }).filter(Boolean).length;

        const today = new Date();
        const currentDay = today.getDate();
        const isCurrentMonth = today.getFullYear() === year && today.getMonth() === (month - 1);

        let businessDaysRemaining = 0;
        if (isCurrentMonth) {
            businessDaysRemaining = Array.from({ length: lastDay - currentDay }, (_, i) => {
                const d = new Date(year, month - 1, currentDay + 1 + i);
                return d.getDay() !== 0 && d.getDay() !== 6;
            }).filter(Boolean).length;
        } else if (today < new Date(year, month - 1, 1)) {
            businessDaysRemaining = businessDaysTotal; // Future month
        } else {
            businessDaysRemaining = 0; // Past month
        }

        const remainingValue = Math.max(0, goalValue - realizedValue);
        const dailyTarget = businessDaysRemaining > 0 ? remainingValue / businessDaysRemaining : 0;

        return {
            columns: cols,
            insights: {
                goalValue,
                realizedValue,
                percentReached,
                businessDaysRemaining,
                dailyTarget,
                businessDaysTotal
            }
        };
    }, [quotes, selectedMonth, systemConfig]);

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
        <div className="h-full flex flex-col gap-6">
            {/* Header / Insights */}
            <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100 flex flex-col md:flex-row justify-between items-center gap-6 animate-fade-in-up">

                {/* Month Selector */}
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-blue-50 rounded-2xl text-blue-600"><Calendar className="w-6 h-6" /></div>
                    <div>
                        <label className="text-[10px] font-black uppercase text-slate-400 block">Mês de Referência</label>
                        <input
                            type="month"
                            value={selectedMonth}
                            onChange={e => setSelectedMonth(e.target.value)}
                            className="text-lg font-black text-[#344a5e] bg-transparent outline-none uppercase cursor-pointer"
                        />
                    </div>
                </div>

                {/* Insights Cards */}
                <div className="flex items-center gap-8 flex-1 justify-end">
                    <div className="text-right">
                        <p className="text-[10px] font-black uppercase text-slate-400">Meta do Mês</p>
                        <p className="text-xl font-black text-[#344a5e]">{formatCurrency(insights.goalValue)}</p>
                    </div>

                    <div className="text-right relative group cursor-help">
                        <p className="text-[10px] font-black uppercase text-slate-400">Realizado (Vendas)</p>
                        <p className={`text-xl font-black ${insights.percentReached >= 100 ? 'text-emerald-500' : 'text-blue-600'}`}>
                            {formatCurrency(insights.realizedValue)}
                        </p>
                        <div className="absolute top-full right-0 mt-2 bg-[#344a5e] text-white text-[10px] p-2 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity w-48 z-10 pointer-events-none">
                            Aprovadas + Em Operação + Ganha
                        </div>
                    </div>

                    <div className="w-32">
                        <div className="flex justify-between text-[9px] font-black uppercase text-slate-400 mb-1">
                            <span>Conquista</span>
                            <span>{insights.percentReached.toFixed(1)}%</span>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div
                                className={`h-full rounded-full transition-all duration-1000 ${insights.percentReached >= 100 ? 'bg-emerald-500' : 'bg-blue-500'}`}
                                style={{ width: `${Math.min(insights.percentReached, 100)}%` }}
                            ></div>
                        </div>
                    </div>

                    <div className="text-right border-l pl-8 border-slate-100">
                        <p className="text-[10px] font-black uppercase text-slate-400 flex items-center gap-1 justify-end">
                            <Target className="w-3 h-3" /> Meta Diária (Restante)
                        </p>
                        <p className={`text-xl font-black ${insights.dailyTarget > 0 ? 'text-amber-500' : 'text-slate-300'}`}>
                            {insights.dailyTarget > 0 ? formatCurrency(insights.dailyTarget) : '---'}
                        </p>
                        <p className="text-[9px] font-bold text-slate-400">{insights.businessDaysRemaining} dias úteis restantes</p>
                    </div>
                </div>
            </div>

            {/* Kanban Board */}
            <div className="flex-1 flex overflow-x-auto gap-4 pb-4">
                {COLUMNS.map(col => {
                    const items = columns[col.id];
                    const totalValue = items.reduce((acc, curr) => acc + (curr.totalFreight || 0), 0);

                    return (
                        <div
                            key={col.id}
                            className={`min-w-[320px] w-[320px] flex flex-col rounded-[2rem] border ${col.border} shadow-sm bg-white overflow-hidden`}
                            onDragOver={handleDragOver}
                            onDrop={(e) => handleDrop(e, col.id)}
                        >
                            {/* Column Header */}
                            <div className={`p-5 flex flex-col gap-2 ${col.color}`}>
                                <div className="flex justify-between items-center">
                                    <span className="font-black text-sm uppercase tracking-wide">{col.label}</span>
                                    <span className="bg-white/40 px-3 py-1 rounded-full text-xs font-black">{items.length}</span>
                                </div>
                                <div className="text-xs font-bold opacity-80 mt-1">
                                    Total: {formatCurrency(totalValue)}
                                </div>
                            </div>

                            {/* Cards Container */}
                            <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3 bg-slate-50/50">
                                {items.map(quote => {
                                    const customer = customers.find(c => c.id === quote.customerId);
                                    const loadingDate = quote.createdAt ? new Date(quote.createdAt) : null;
                                    const daysUntilLoad = loadingDate ? Math.ceil((loadingDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null;
                                    const isUrgentDate = daysUntilLoad !== null && daysUntilLoad <= 3 && daysUntilLoad >= 0;
                                    return (
                                        <div
                                            key={quote.id}
                                            draggable
                                            onDragStart={(e) => handleDragStart(e, quote.id)}
                                            className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 cursor-move hover:shadow-lg hover:-translate-y-1 transition-all active:cursor-grabbing group relative overflow-hidden"
                                        >
                                            <div className="absolute top-0 left-0 w-1 h-full bg-slate-200 group-hover:bg-blue-400 transition-colors"></div>
                                            <div className="pl-3">
                                                {/* Header: Logo + Info */}
                                                <div className="flex items-start gap-3 mb-3">
                                                    {/* Customer Logo */}
                                                    <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                                                        {customer?.logoUrl ? (
                                                            <img src={customer.logoUrl} className="w-full h-full object-contain" alt={customer.name} />
                                                        ) : (
                                                            <span className="font-black text-slate-300 text-sm">{(customer?.name || '?').charAt(0)}</span>
                                                        )}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex justify-between items-start">
                                                            <h4 className="font-black text-[#344a5e] text-sm line-clamp-1">{customer?.name || 'Cliente'}</h4>
                                                            {quote.disponibilidade === 'Imediato' && (
                                                                <span className="bg-red-50 text-red-600 text-[9px] px-2 py-1 rounded-lg font-black flex items-center gap-1 uppercase tracking-tighter ml-1 flex-shrink-0">
                                                                    <AlertCircle className="w-3 h-3" /> Urgente
                                                                </span>
                                                            )}
                                                        </div>
                                                        <span className="text-[10px] font-bold text-slate-400">#{quote.proposalNumber}</span>
                                                    </div>
                                                </div>

                                                {/* Route */}
                                                <div className="flex items-center gap-1 text-[10px] font-bold text-slate-400 mb-3">
                                                    <MapPin className="w-3 h-3 flex-shrink-0" />
                                                    <span className="truncate">{quote.origin.split(',')[0]} × {quote.destination.split(',')[0]}</span>
                                                </div>

                                                {/* Value */}
                                                <div className="flex justify-between items-center mb-2">
                                                    <div className="flex flex-col">
                                                        <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">{quote.vehicleType.split('-')[0]}</span>
                                                        <span className="text-base font-black text-[#344a5e]">{formatCurrency(quote.totalFreight)}</span>
                                                    </div>
                                                </div>

                                                {/* Date */}
                                                <div className={`flex items-center gap-1.5 pt-2 border-t border-slate-50 ${isUrgentDate ? 'text-amber-500' : 'text-slate-300'}`}>
                                                    <Calendar className="w-3 h-3" />
                                                    <span className="text-[10px] font-bold">
                                                        {loadingDate ? loadingDate.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) : '---'}
                                                    </span>
                                                    {isUrgentDate && <AlertCircle className="w-3 h-3 text-amber-500" />}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Lost Reason Modal */}
            {showLostModal && (
                <div className="fixed inset-0 bg-[#344a5e]/60 z-[200] flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-lg p-8 animate-scale-in border-4 border-white/20">
                        <div className="flex justify-between items-center mb-8">
                            <h3 className="text-xl font-black text-[#344a5e] uppercase tracking-tight">Justificar Perda</h3>
                            <button onClick={() => setShowLostModal(null)} className="p-3 hover:bg-slate-100 rounded-full transition-colors">
                                <X className="w-6 h-6 text-slate-400" />
                            </button>
                        </div>

                        <div className="space-y-6">
                            <div>
                                <label className="block text-xs font-black text-slate-400 uppercase mb-2">Motivo Principal <span className="text-red-500">*</span></label>
                                <div className="grid grid-cols-2 gap-3">
                                    {Object.entries(LOST_REASONS).map(([key, label]) => (
                                        <button
                                            key={key}
                                            onClick={() => setLostForm({ ...lostForm, reason: key as LostReason })}
                                            className={`p-3 rounded-xl text-xs font-bold border-2 transition-all ${lostForm.reason === key
                                                ? 'border-red-500 bg-red-50 text-red-600'
                                                : 'border-slate-100 bg-slate-50 text-slate-500 hover:border-slate-200'
                                                }`}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-black text-slate-400 uppercase mb-2">Observações Detalhadas</label>
                                <textarea
                                    value={lostForm.obs}
                                    onChange={(e) => setLostForm({ ...lostForm, obs: e.target.value })}
                                    className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-medium text-sm text-[#344a5e] h-32 resize-none outline-none focus:border-blue-300 transition-all"
                                    placeholder="Descreva o que aconteceu..."
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-black text-slate-400 uppercase mb-2">Anexar Comprovante (URL)</label>
                                <div className="flex gap-2">
                                    <div className="flex-1 bg-slate-50 border-2 border-slate-100 rounded-2xl flex items-center px-4 transition-all focus-within:border-blue-300">
                                        <Paperclip className="w-4 h-4 text-slate-400 mr-2" />
                                        <input
                                            type="text"
                                            value={lostForm.fileUrl}
                                            onChange={(e) => setLostForm({ ...lostForm, fileUrl: e.target.value })}
                                            className="w-full py-4 bg-transparent font-bold text-sm text-[#344a5e] outline-none placeholder:text-slate-300"
                                            placeholder="https://..."
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-end gap-3 mt-10">
                            <button
                                onClick={() => setShowLostModal(null)}
                                className="px-6 py-4 text-slate-500 font-bold uppercase text-xs hover:bg-slate-50 rounded-2xl transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleLostSubmit}
                                disabled={!lostForm.reason}
                                className="px-8 py-4 bg-red-500 text-white font-black uppercase text-xs rounded-2xl hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-red-200 hover:shadow-xl hover:-translate-y-1"
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
