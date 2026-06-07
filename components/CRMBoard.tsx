
import React, { useState, useMemo } from 'react';
import { FreightCalculation, QuoteStatus, LOST_REASONS, LostReason, FederalTaxes } from '../types';
import { MoreVertical, Paperclip, X, Check, FileText, Calendar, DollarSign, Truck, MapPin, AlertCircle, TrendingUp, Target, Activity, BarChart3, Clock, PieChart, ShieldCheck, Zap, ArrowRight, Info, Scale } from 'lucide-react';

interface CRMBoardProps {
    quotes: FreightCalculation[];
    onUpdateStatus: (id: string, newStatus: QuoteStatus, lostData?: { reason: LostReason; obs: string; fileUrl: string }) => void;
    customers: any[];
    systemConfig: FederalTaxes;
}

const COLUMNS: { id: QuoteStatus; label: string; color: string; border: string }[] = [
    { id: 'pending', label: 'Cotações (Novas)', color: 'bg-[#f9fafb] text-slate-600', border: 'border-slate-200' },
    { id: 'respondida', label: 'Respondidas', color: 'bg-blue-50 text-blue-600', border: 'border-blue-200' },
    { id: 'aprovada', label: 'Aprovadas', color: 'bg-indigo-50 text-indigo-600', border: 'border-indigo-200' },
    { id: 'em_operacao', label: 'Em Operação', color: 'bg-amber-50 text-amber-600', border: 'border-amber-200' },
    { id: 'won', label: 'Ganha (Faturado)', color: 'bg-emerald-50 text-emerald-600', border: 'border-emerald-200' },
    { id: 'lost', label: 'Perdida', color: 'bg-red-50 text-red-600', border: 'border-red-200' }
];

export const CRMBoard: React.FC<CRMBoardProps> = ({ quotes, onUpdateStatus, customers, systemConfig }) => {
    const [draggedId, setDraggedId] = useState<string | null>(null);
    const [showLostModal, setShowLostModal] = useState<string | null>(null);
    const [selectedQuote, setSelectedQuote] = useState<FreightCalculation | null>(null);
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
            pending: [], respondida: [], aprovada: [], em_operacao: [], won: [], lost: [], spot_simulated: []
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

    const formatCurrency = (val: number | undefined | null) => {
        if (val === undefined || val === null || isNaN(val)) return 'R$ 0,00';
        return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    };

    return (
        <div className="h-full flex flex-col gap-6">
            {/* Header / Insights */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-[#e5e7eb] flex flex-col md:flex-row justify-between items-center gap-6 animate-fade-in-up">

                {/* Month Selector */}
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-blue-50 rounded-lg text-blue-600"><Calendar className="w-6 h-6" /></div>
                    <div>
                        <label className="text-[10px] font-medium uppercase text-[#6b7280] block">Mês de Referência</label>
                        <input
                            type="month"
                            value={selectedMonth}
                            onChange={e => setSelectedMonth(e.target.value)}
                            className="text-lg font-medium text-[#111827] bg-transparent outline-none uppercase cursor-pointer"
                        />
                    </div>
                </div>

                {/* Insights Cards */}
                <div className="flex items-center gap-8 flex-1 justify-end">
                    <div className="text-right">
                        <p className="text-[10px] font-medium uppercase text-[#6b7280]">Meta do Mês</p>
                        <p className="text-xl font-medium text-[#111827]">{formatCurrency(insights.goalValue)}</p>
                    </div>

                    <div className="text-right relative group cursor-help">
                        <p className="text-[10px] font-medium uppercase text-[#6b7280]">Realizado (Vendas)</p>
                        <p className={`text-xl font-medium ${insights.percentReached >= 100 ? 'text-emerald-500' : 'text-blue-600'}`}>
                            {formatCurrency(insights.realizedValue)}
                        </p>
                        <div className="absolute top-full right-0 mt-2 bg-[#111827] text-white text-[10px] p-2 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity w-48 z-10 pointer-events-none">
                            Aprovadas + Em Operação + Ganha
                        </div>
                    </div>

                    <div className="w-32">
                        <div className="flex justify-between text-[9px] font-medium uppercase text-[#6b7280] mb-1">
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
                        <p className="text-[10px] font-medium uppercase text-[#6b7280] flex items-center gap-1 justify-end">
                            <Target className="w-3 h-3" /> Meta Diária (Restante)
                        </p>
                        <p className={`text-xl font-medium ${insights.dailyTarget > 0 ? 'text-amber-500' : 'text-slate-300'}`}>
                            {insights.dailyTarget > 0 ? formatCurrency(insights.dailyTarget) : '---'}
                        </p>
                        <p className="text-[9px] font-medium text-[#6b7280]">{insights.businessDaysRemaining} dias úteis restantes</p>
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
                            className={`min-w-[320px] w-[320px] flex flex-col rounded-xl border ${col.border} shadow-sm bg-white overflow-hidden`}
                            onDragOver={handleDragOver}
                            onDrop={(e) => handleDrop(e, col.id)}
                        >
                            {/* Column Header */}
                            <div className={`p-5 flex flex-col gap-2 ${col.color}`}>
                                <div className="flex justify-between items-center">
                                    <span className="font-medium text-sm uppercase tracking-wide">{col.label}</span>
                                    <span className="bg-white/40 px-3 py-1 rounded-full text-xs font-medium">{items.length}</span>
                                </div>
                                <div className="text-xs font-medium opacity-80 mt-1">
                                    Total: {formatCurrency(totalValue)}
                                </div>
                            </div>

                            {/* Cards Container */}
                            <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3 bg-[#f9fafb]/50">
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
                                            onClick={() => setSelectedQuote(quote)}
                                            className="bg-white p-4 rounded-lg shadow-sm border border-[#e5e7eb] cursor-pointer hover:shadow-sm hover:-translate-y-1 transition-all active:cursor-grabbing group relative overflow-hidden"
                                        >
                                            <div className="absolute top-0 left-0 w-1 h-full bg-slate-200 group-hover:bg-blue-400 transition-colors"></div>
                                            <div className="pl-3">
                                                {/* Header: Logo + Info */}
                                                <div className="flex items-start gap-3 mb-3">
                                                    {/* Customer Logo */}
                                                    <div className="w-10 h-10 rounded-xl bg-[#f9fafb] border border-[#e5e7eb] flex items-center justify-center overflow-hidden flex-shrink-0">
                                                        {customer?.logoUrl ? (
                                                            <img src={customer.logoUrl} className="w-full h-full object-contain" alt={customer.name} />
                                                        ) : (
                                                            <span className="font-medium text-slate-300 text-sm">{(customer?.name || '?').charAt(0)}</span>
                                                        )}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex justify-between items-start">
                                                            <h4 className="font-medium text-[#111827] text-sm line-clamp-1">{customer?.name || 'Cliente'}</h4>
                                                            {quote.disponibilidade === 'Imediato' && (
                                                                <span className="bg-red-50 text-red-600 text-[9px] px-2 py-1 rounded-lg font-medium flex items-center gap-1 uppercase tracking-tighter ml-1 flex-shrink-0">
                                                                    <AlertCircle className="w-3 h-3" /> Urgente
                                                                </span>
                                                            )}
                                                        </div>
                                                        <span className="text-[10px] font-medium text-[#6b7280]">#{quote.proposalNumber}</span>
                                                    </div>
                                                </div>

                                                {/* Route */}
                                                <div className="flex items-center gap-1 text-[10px] font-medium text-[#6b7280] mb-3">
                                                    <MapPin className="w-3 h-3 flex-shrink-0" />
                                                    <span className="truncate">{(quote.origin || '').split(',')[0]} × {(quote.destination || '').split(',')[0]}</span>
                                                </div>

                                                {/* Value */}
                                                <div className="flex justify-between items-center mb-2">
                                                    <div className="flex flex-col">
                                                        <span className="text-[9px] text-[#6b7280] font-medium uppercase tracking-wider">{quote.vehicleType.split('-')[0]}</span>
                                                        <span className="text-base font-medium text-[#111827]">{formatCurrency(quote.totalFreight)}</span>
                                                    </div>
                                                </div>

                                                {/* Date */}
                                                <div className={`flex items-center gap-1.5 pt-2 border-t border-slate-50 ${isUrgentDate ? 'text-amber-500' : 'text-slate-300'}`}>
                                                    <Calendar className="w-3 h-3" />
                                                    <span className="text-[10px] font-medium">
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
                <div className="fixed inset-0 bg-black/40 z-[200] flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-xl shadow-sm w-full max-w-lg p-8 animate-scale-in border-4 border-white/20">
                        <div className="flex justify-between items-center mb-8">
                            <h3 className="text-xl font-medium text-[#111827] uppercase tracking-tight">Justificar Perda</h3>
                            <button onClick={() => setShowLostModal(null)} className="p-3 hover:bg-slate-100 rounded-full transition-colors">
                                <X className="w-6 h-6 text-[#6b7280]" />
                            </button>
                        </div>

                        <div className="space-y-6">
                            <div>
                                <label className="block text-xs font-medium text-[#6b7280] uppercase mb-2">Motivo Principal <span className="text-red-500">*</span></label>
                                <div className="grid grid-cols-2 gap-3">
                                    {Object.entries(LOST_REASONS).map(([key, label]) => (
                                        <button
                                            key={key}
                                            onClick={() => setLostForm({ ...lostForm, reason: key as LostReason })}
                                            className={`p-3 rounded-xl text-xs font-medium border-2 transition-all ${lostForm.reason === key
                                                ? 'border-red-500 bg-red-50 text-red-600'
                                                : 'border-slate-100 bg-[#f9fafb] text-[#6b7280] hover:border-slate-200'
                                                }`}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-[#6b7280] uppercase mb-2">Observações Detalhadas</label>
                                <textarea
                                    value={lostForm.obs}
                                    onChange={(e) => setLostForm({ ...lostForm, obs: e.target.value })}
                                    className="w-full p-4 bg-[#f9fafb] border border-[#e5e7eb] rounded-lg font-medium text-sm text-[#111827] h-32 resize-none outline-none focus:border-blue-300 transition-all"
                                    placeholder="Descreva o que aconteceu..."
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-[#6b7280] uppercase mb-2">Anexar Comprovante (URL)</label>
                                <div className="flex gap-2">
                                    <div className="flex-1 bg-[#f9fafb] border border-[#e5e7eb] rounded-lg flex items-center px-4 transition-all focus-within:border-blue-300">
                                        <Paperclip className="w-4 h-4 text-[#6b7280] mr-2" />
                                        <input
                                            type="text"
                                            value={lostForm.fileUrl}
                                            onChange={(e) => setLostForm({ ...lostForm, fileUrl: e.target.value })}
                                            className="w-full py-4 bg-transparent font-medium text-sm text-[#111827] outline-none placeholder:text-slate-300"
                                            placeholder="https://..."
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-end gap-3 mt-10">
                            <button
                                onClick={() => setShowLostModal(null)}
                                className="px-6 py-4 text-[#6b7280] font-medium uppercase text-xs hover:bg-[#f9fafb] rounded-lg transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleLostSubmit}
                                disabled={!lostForm.reason}
                                className="px-8 py-4 bg-red-500 text-white font-medium uppercase text-xs rounded-lg hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm shadow-red-200 hover:shadow-sm hover:-translate-y-1"
                            >
                                Confirmar Perda
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Quote Details Modal - Redesigned (Premium & Managerial) */}
            {selectedQuote && (() => {
                const customer = customers.find(c => c.id === selectedQuote.customerId);
                const isSpot = selectedQuote.status === 'spot_simulated';

                return (
                    <div className="fixed inset-0 bg-black/40 z-[9999] flex items-center justify-center p-4 md:p-10 backdrop-blur-sm animate-fade-in overflow-hidden">
                        <div className="bg-white w-full max-w-6xl max-h-[92vh] rounded-xl shadow-sm animate-scale-in border border-[#e5e7eb] overflow-y-auto flex flex-col pointer-events-auto relative scrollbar-hide">
                            {/* Modal Header */}
                            <div className="bg-white border-b border-[#e5e7eb] p-8 relative">
                                <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-6">
                                    <div className="flex items-center gap-5">
                                        <div className="w-20 h-20 bg-[#f9fafb] rounded-xl p-3 border border-[#e5e7eb] flex items-center justify-center overflow-hidden flex-shrink-0">
                                            {customer?.logoUrl ? (
                                                <img src={customer.logoUrl} className="w-full h-full object-contain" alt={customer.name} />
                                            ) : (
                                                <span className="font-medium text-[#6b7280] text-3xl">{(customer?.name || '?').charAt(0)}</span>
                                            )}
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-3 mb-2">
                                                <h2 className="text-2xl font-medium text-[#111827] tracking-tight">{customer?.name || 'Cliente Avulso'}</h2>
                                                <span className={`px-3 py-1 rounded-full text-[10px] font-medium uppercase tracking-wide ${selectedQuote.status === 'won' ? 'bg-emerald-50 text-emerald-700' :
                                                    selectedQuote.status === 'lost' ? 'bg-red-50 text-red-700' :
                                                        'bg-blue-50 text-[#1d6fb8]'
                                                    }`}>
                                                    {COLUMNS.find(c => c.id === selectedQuote.status)?.label || (isSpot ? 'SPOT SIMULADO' : selectedQuote.status)}
                                                </span>
                                            </div>
                                            <div className="flex flex-wrap gap-3 items-center">
                                                <span className="text-[#6b7280] font-normal text-xs">Proposta #{selectedQuote.proposalNumber}</span>
                                                <span className="w-1 h-1 bg-[#d1d5db] rounded-full"></span>
                                                <div className="flex items-center gap-2 text-[#6b7280]">
                                                    <Clock className="w-3.5 h-3.5" strokeWidth={1.75} />
                                                    <span className="text-[11px] font-normal">Criado em {new Date(selectedQuote.createdAt).toLocaleDateString()}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <button
                                        onClick={() => setSelectedQuote(null)}
                                        className="self-start p-2.5 bg-[#f9fafb] border border-[#e5e7eb] hover:bg-[#f3f4f6] text-[#6b7280] rounded-lg transition-colors"
                                    >
                                        <X className="w-5 h-5" strokeWidth={1.75} />
                                    </button>
                                </div>
                            </div>

                            {/* Main Content Area */}
                            <div className="p-10 space-y-10 bg-[#f9fafb]/50">
                                {/* Top KPI Dashboard */}
                                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                                    <div className="bg-white p-6 rounded-xl border border-[#e5e7eb] shadow-sm hover:shadow-md transition-all group">
                                        <div className="flex items-center gap-4 mb-4">
                                            <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600 group-hover:scale-110 transition-transform">
                                                <DollarSign className="w-5 h-5" />
                                            </div>
                                            <p className="text-[10px] font-medium uppercase text-[#6b7280]">Total Cliente</p>
                                        </div>
                                        <p className="text-2xl font-medium text-[#111827]">R$ {formatCurrency(selectedQuote.totalFreight)}</p>
                                    </div>

                                    <div className="bg-white p-6 rounded-xl border border-[#e5e7eb] shadow-sm hover:shadow-md transition-all group">
                                        <div className="flex items-center gap-4 mb-4">
                                            <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-600 group-hover:scale-110 transition-transform">
                                                <TrendingUp className="w-5 h-5" />
                                            </div>
                                            <p className="text-[10px] font-medium uppercase text-[#6b7280]">Margem Real</p>
                                        </div>
                                        <p className={`text-2xl font-medium ${(selectedQuote.realMarginPercent || 0) < 15 ? 'text-red-500' : 'text-emerald-500'}`}>
                                            {selectedQuote.realMarginPercent?.toFixed(1)}%
                                        </p>
                                    </div>

                                    <div className="bg-white p-6 rounded-xl border border-[#e5e7eb] shadow-sm hover:shadow-md transition-all group">
                                        <div className="flex items-center gap-4 mb-4">
                                            <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center text-amber-600 group-hover:scale-110 transition-transform">
                                                <PieChart className="w-5 h-5" />
                                            </div>
                                            <p className="text-[10px] font-medium uppercase text-[#6b7280]">EBITDA Estimado</p>
                                        </div>
                                        <p className="text-2xl font-medium text-[#111827]">R$ {formatCurrency(selectedQuote.realProfit)}</p>
                                    </div>

                                    <div className="bg-white p-6 rounded-xl shadow-sm border border-[#e5e7eb]">
                                        <div className="flex items-center gap-4 mb-4">
                                            <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center text-amber-600">
                                                <Zap className="w-5 h-5" />
                                            </div>
                                            <p className="text-[10px] font-medium uppercase text-[#6b7280]">Poder de Compra</p>
                                        </div>
                                        <p className="text-2xl font-medium text-[#111827] tracking-tight">R$ {formatCurrency(selectedQuote.baseFreight)}</p>
                                    </div>
                                </div>

                                {/* Detailed Breakdown Section */}
                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
                                    {/* Left: Route Visualization */}
                                    <div className="lg:col-span-1 bg-white p-8 rounded-xl border border-[#e5e7eb] shadow-sm relative overflow-hidden">
                                        <div className="absolute top-0 right-0 p-8 opacity-5">
                                            <MapPin className="w-32 h-32 text-[#f3f4f6]" />
                                        </div>
                                        <h3 className="text-xs font-medium uppercase text-[#6b7280] tracking-widest mb-8 flex items-center gap-2">
                                            <Activity className="w-4 h-4 text-blue-500" /> Fluxo da Operação
                                        </h3>

                                        <div className="space-y-6 relative">
                                            <div className="absolute left-[19px] top-6 bottom-6 w-0.5 bg-[#e5e7eb]"></div>

                                            <div className="flex items-start gap-6 relative">
                                                <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center text-white ring-8 ring-blue-50 z-10 flex-shrink-0">
                                                    <MapPin className="w-5 h-5" />
                                                </div>
                                                <div>
                                                    <p className="text-[9px] font-medium uppercase text-blue-500 mb-1">Ponto de Coleta</p>
                                                    <p className="font-medium text-slate-700 leading-tight">{selectedQuote.origin}</p>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-6 py-4">
                                                <div className="w-10 flex justify-center flex-shrink-0">
                                                    <div className="w-2 h-2 bg-slate-200 rounded-full translate-x-px"></div>
                                                </div>
                                                <div className="flex-1 bg-[#f9fafb] p-3 rounded-lg border border-[#e5e7eb] flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <TrendingUp className="w-3 h-3 text-[#6b7280]" />
                                                        <span className="text-[10px] font-medium text-[#6b7280] uppercase tracking-tighter">{selectedQuote.distanceKm} KM PERCORRIDOS</span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <BarChart3 className="w-3 h-3 text-[#6b7280]" />
                                                        <span className="text-[10px] font-medium text-[#6b7280] uppercase tracking-tighter">{selectedQuote.vehicleType}</span>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex items-start gap-6 relative">
                                                <div className="w-10 h-10 bg-[#1d6fb8] rounded-full flex items-center justify-center text-white ring-8 ring-[#f3f4f6] z-10 flex-shrink-0">
                                                    <Target className="w-5 h-5" />
                                                </div>
                                                <div>
                                                    <p className="text-[9px] font-medium uppercase text-[#6b7280] mb-1">Destino Final</p>
                                                    <p className="font-medium text-slate-700 leading-tight">{selectedQuote.destination}</p>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="mt-12 pt-8 border-t border-slate-100 flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 bg-[#f9fafb] rounded-xl flex items-center justify-center text-[#6b7280]">
                                                    <Scale className="w-5 h-5" />
                                                </div>
                                                <div>
                                                    <p className="text-[9px] font-medium uppercase text-[#6b7280]">Tipo de Carga</p>
                                                    <p className="text-xs font-medium text-slate-700 uppercase">{selectedQuote.merchandiseType || 'Carga Geral'}</p>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-[9px] font-medium uppercase text-[#6b7280]">Peso Estimado</p>
                                                <p className="text-xs font-medium text-slate-700">{(selectedQuote.weight || 0).toLocaleString()} KG</p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Right: Technical & Financial Breakdown */}
                                    <div className="lg:col-span-2 space-y-6">
                                        <div className="bg-white p-8 rounded-xl border border-[#e5e7eb] shadow-sm transition-all hover:border-blue-100">
                                            <h3 className="text-xs font-medium uppercase text-[#6b7280] tracking-widest mb-6 flex items-center gap-2">
                                                <BarChart3 className="w-4 h-4 text-emerald-500" /> Demonstrativo Gerencial
                                            </h3>

                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8">
                                                <div className="space-y-6">
                                                    <div className="flex items-center justify-between group">
                                                        <span className="text-[10px] font-medium text-[#6b7280] uppercase tracking-tight group-hover:text-slate-600 transition-colors">Frete Base (Motorista)</span>
                                                        <span className="font-medium text-slate-700">R$ {formatCurrency(selectedQuote.baseFreight)}</span>
                                                    </div>
                                                    <div className="flex items-center justify-between group">
                                                        <span className="text-[10px] font-medium text-[#6b7280] uppercase tracking-tight group-hover:text-slate-600 transition-colors">Pedágios / Custos Fixos</span>
                                                        <span className="font-medium text-slate-700">R$ {formatCurrency(selectedQuote.tolls)}</span>
                                                    </div>
                                                    <div className="flex items-center justify-between group">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-[10px] font-medium text-[#6b7280] uppercase tracking-tight">Impostos</span>
                                                            <span className="px-1.5 py-0.5 bg-red-100 text-red-600 rounded text-[8px] font-medium">{selectedQuote.icmsPercent}% ICMS</span>
                                                        </div>
                                                        <span className="font-medium text-red-400">R$ {formatCurrency((selectedQuote.totalFreight || 0) * (selectedQuote.icmsPercent / 100))}</span>
                                                    </div>
                                                </div>

                                                <div className="space-y-6">
                                                    <div className="flex items-center justify-between group">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-[10px] font-medium text-[#6b7280] uppercase tracking-tight">Ad Valorem / Seguros</span>
                                                        </div>
                                                        <span className="font-medium text-slate-700">R$ {formatCurrency(selectedQuote.adValorem)}</span>
                                                    </div>
                                                    <div className="flex items-center justify-between group">
                                                        <span className="text-[10px] font-medium text-[#6b7280] uppercase tracking-tight group-hover:text-slate-600 transition-colors">Custos Adicionais</span>
                                                        <span className="font-medium text-slate-700">R$ {formatCurrency(selectedQuote.extraCosts)}</span>
                                                    </div>
                                                    <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                                                        <span className="text-xs font-medium text-blue-600 uppercase">Faturamento Total</span>
                                                        <span className="text-xl font-medium text-[#111827]">R$ {formatCurrency(selectedQuote.totalFreight)}</span>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Margin Progress Bar */}
                                            <div className="mt-10 p-6 bg-[#f9fafb] rounded-lg border border-[#e5e7eb]">
                                                <div className="flex items-center justify-between mb-3">
                                                    <p className="text-[10px] font-medium uppercase text-[#6b7280] tracking-tighter flex items-center gap-2">
                                                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" /> Saúde Financeira do Frete
                                                    </p>
                                                    <span className={`text-xs font-medium ${(selectedQuote.realMarginPercent || 0) < 15 ? 'text-red-500' : 'text-emerald-600'}`}>
                                                        {selectedQuote.realMarginPercent?.toFixed(1)}% Margem
                                                    </span>
                                                </div>
                                                <div className="w-full h-3 bg-slate-200 rounded-full overflow-hidden flex shadow-inner">
                                                    <div
                                                        className={`h-full transition-all duration-1000 ease-out ${(selectedQuote.realMarginPercent || 0) < 10 ? 'bg-red-500' : (selectedQuote.realMarginPercent || 0) < 15 ? 'bg-amber-400' : 'bg-emerald-500'}`}
                                                        style={{ width: `${Math.min(100, (selectedQuote.realMarginPercent || 0) * 4)}%` }} // Scaled for visualization
                                                    ></div>
                                                </div>
                                                <div className="flex justify-between mt-2">
                                                    <span className="text-[8px] font-medium text-[#6b7280]">CRÍTICO</span>
                                                    <span className="text-[8px] font-medium text-[#6b7280]">IDEAL</span>
                                                    <span className="text-[8px] font-medium text-[#6b7280]">EXCELENTE</span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                            <div className="bg-white p-6 rounded-lg border border-[#e5e7eb] shadow-sm flex items-center gap-4 group">
                                                <div className="w-12 h-12 bg-[#f9fafb] rounded-lg flex items-center justify-center text-[#6b7280] group-hover:bg-blue-600 group-hover:text-white transition-all">
                                                    <FileText className="w-6 h-6" />
                                                </div>
                                                <div>
                                                    <p className="text-[9px] font-medium uppercase text-[#6b7280]">Responsável</p>
                                                    <p className="text-xs font-medium text-slate-700 uppercase">{selectedQuote.updatedByName || 'Admin'}</p>
                                                </div>
                                            </div>

                                            <div className="bg-white p-6 rounded-lg border border-[#e5e7eb] shadow-sm flex items-center justify-between gap-4 group">
                                                <div className="flex items-center gap-4">
                                                    <div className="w-12 h-12 bg-[#f9fafb] rounded-lg flex items-center justify-center text-[#6b7280] group-hover:bg-amber-500 group-hover:text-white transition-all">
                                                        <Clock className="w-6 h-6" />
                                                    </div>
                                                    <div>
                                                        <p className="text-[9px] font-medium uppercase text-[#6b7280]">Disponibilidade</p>
                                                        <p className="text-xs font-medium text-slate-700 uppercase">{selectedQuote.disponibilidade || 'Programada'}</p>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Modal Footer Actions */}
                            <div className="p-8 bg-white border-t border-slate-100 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Info className="w-4 h-4 text-slate-300" />
                                    <span className="text-[10px] font-medium text-slate-300 uppercase tracking-widest">Os valores acima são estimativas baseadas na configuração atual do sistema.</span>
                                </div>
                                <div className="flex gap-4">
                                    <button
                                        onClick={() => setSelectedQuote(null)}
                                        className="px-10 py-5 bg-slate-100 text-[#6b7280] font-medium uppercase text-xs rounded-lg hover:bg-slate-200 transition-all active:scale-95 tracking-widest"
                                    >
                                        Fechar Resumo
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
};
