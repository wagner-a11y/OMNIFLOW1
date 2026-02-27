import React, { useState } from 'react';
import { X, MapPin, Truck, Package, DollarSign, Calendar, Info, User, Phone, CreditCard, ExternalLink, Copy, Check, FileText } from 'lucide-react';
import { FreightCalculation } from '../types';
import { generateHiringPDF } from '../services/pdfService';

interface LoadDetailModalProps {
    isOpen: boolean;
    onClose: () => void;
    quote: FreightCalculation;
}

export const LoadDetailModal: React.FC<LoadDetailModalProps> = ({ isOpen, onClose, quote }) => {
    const [copied, setCopied] = useState(false);

    if (!isOpen) return null;

    const handleCopyGRData = () => {
        const text = `📝 *DADOS PARA GR - OMNIFLOW*\n\n` +
            `👤 *Motorista:* ${quote.motoristaNome || 'N/A'}\n` +
            `🆔 *CPF:* ${quote.motoristaCPF || 'N/A'}\n` +
            `📱 *Tel:* ${quote.motoristaTelefone || 'N/A'}\n\n` +
            `🚛 *Placa Cavalo:* ${quote.placaCavalo || 'N/A'}\n` +
            `📦 *Carreta 1:* ${quote.placaCarreta1 || 'N/A'}\n` +
            `📦 *Carreta 2:* ${quote.placaCarreta2 || 'N/A'}\n\n` +
            `📍 *Origem:* ${quote.coletaEndereco || quote.origin}\n` +
            `🏁 *Destino:* ${quote.entregaEndereco || quote.destination}`;

        navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    const maskCurrency = (val: number | undefined) => {
        if (val === undefined) return 'R$ 0,00';
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL',
        }).format(val);
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-slate-50">
                    <div className="flex items-center gap-3 text-slate-700">
                        <div className="p-2 bg-slate-100 rounded-lg">
                            <Info className="w-6 h-6" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold">Resumo Completo da Carga</h2>
                            <p className="text-sm text-slate-500">{quote.proposalNumber} • {quote.clienteNomeOperacao || 'Cliente não identificado'}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                        <X className="w-6 h-6 text-slate-700" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-8">
                    {/* Grid de Informações */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">

                        {/* Logística */}
                        <div className="space-y-4">
                            <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2">
                                <MapPin className="w-3 h-3" /> Logística
                            </h3>
                            <div className="space-y-4">
                                <div className="p-3 bg-red-50 rounded-xl border border-red-100">
                                    <label className="text-[10px] font-bold text-red-400 uppercase">Origem / Coleta</label>
                                    <p className="text-sm font-bold text-slate-800">{quote.coletaEndereco || quote.origin}</p>
                                    <p className="text-[10px] text-red-600 mt-1">{quote.coletaDate ? new Date(quote.coletaDate).toLocaleString('pt-BR') : 'A combinar'}</p>
                                </div>
                                <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                                    <label className="text-[10px] font-bold text-emerald-400 uppercase">Destino / Entrega</label>
                                    <p className="text-sm font-bold text-slate-800">{quote.entregaEndereco || quote.destination}</p>
                                    <p className="text-[10px] text-emerald-600 mt-1">{quote.entregaDate ? new Date(quote.entregaDate).toLocaleString('pt-BR') : 'A combinar'}</p>
                                </div>
                            </div>
                        </div>

                        {/* Veículo e Carga */}
                        <div className="space-y-4">
                            <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2">
                                <Truck className="w-3 h-3" /> Especificações
                            </h3>
                            <div className="bg-white border border-slate-100 rounded-xl divide-y divide-slate-50 overflow-hidden shadow-sm">
                                <DetailItem label="Veículo" value={quote.veiculoTipoOperacao || quote.vehicleType} />
                                <DetailItem label="Carroceria" value={quote.carroceriaTipoOperacao} />
                                <DetailItem label="Mercadoria" value={quote.materialTipo || quote.merchandiseType} />
                                <DetailItem label="Peso" value={`${quote.pesoCargaOperacao || quote.weight} kg`} />
                                <DetailItem label="Solicitante" value={quote.solicitante} />
                            </div>
                        </div>

                        {/* Financeiro */}
                        <div className="space-y-4">
                            <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2">
                                <DollarSign className="w-3 h-3" /> Financeiro
                            </h3>
                            <div className="bg-slate-900 text-white rounded-2xl p-4 space-y-3 shadow-xl">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase">Frete Venda</label>
                                    <p className="text-lg font-black text-emerald-400">{maskCurrency(quote.nossoFrete || quote.totalFreight)}</p>
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase">Frete Compra</label>
                                    <p className="text-lg font-black text-orange-400">{maskCurrency(quote.freteTerceiro)}</p>
                                </div>
                                <div className="pt-2 border-t border-white/10 flex justify-between items-center">
                                    <span className="text-[10px] font-bold text-slate-500 uppercase">Margem Operação</span>
                                    <span className="text-sm font-black text-white">
                                        {maskCurrency((quote.nossoFrete || 0) - (quote.freteTerceiro || 0))}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Dados do Motorista (Se houver) */}
                    {(quote.motoristaNome || quote.placaCavalo) && (
                        <div className="pt-8 border-t border-slate-100">
                            <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2 mb-4">
                                <User className="w-3 h-3" /> Dados da Contratação / GR
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                <div className="bg-orange-50 p-4 rounded-xl border border-orange-100 relative group">
                                    <label className="text-[10px] font-bold text-orange-400 uppercase">Motorista</label>
                                    <p className="font-bold text-slate-800">{quote.motoristaNome}</p>
                                    <div className="space-y-1 mt-1">
                                        <div className="flex items-center gap-1 text-[10px] text-slate-500 font-bold">CPF: {quote.motoristaCPF}</div>
                                        <div className="flex items-center gap-1 text-[10px] text-slate-500 font-bold">RG: {quote.motoristaRG || '-'}</div>
                                        <div className="flex items-center gap-1 text-[10px] text-slate-500 font-bold">Telefone: {quote.motoristaTelefone}</div>
                                        <div className="flex items-center gap-1 text-[10px] text-slate-500">CNH: {quote.motoristaCnhRegistro || '-'}</div>
                                    </div>
                                    {quote.motoristaDocUrl && (
                                        <a href={quote.motoristaDocUrl} target="_blank" rel="noopener noreferrer" className="absolute top-4 right-4 text-orange-500 hover:text-orange-700">
                                            <ExternalLink className="w-4 h-4" />
                                        </a>
                                    )}
                                </div>

                                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 relative">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase">Cavalo (Trator)</label>
                                    <div className="space-y-1 mt-1">
                                        <p className="text-xs font-bold text-slate-800 flex items-center justify-between">
                                            Placa: {quote.placaCavalo}
                                            {quote.placaCavaloDocUrl && <a href={quote.placaCavaloDocUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-3 h-3 text-slate-400 hover:text-blue-500" /></a>}
                                        </p>
                                        <p className="text-[10px] text-slate-500">
                                            <span className="font-bold">Renavam:</span> {quote.placaCavaloRenavam || '-'}
                                        </p>
                                        <p className="text-[10px] text-slate-500">
                                            <span className="font-bold">Chassi:</span> {quote.placaCavaloChassi || '-'}
                                        </p>
                                        <p className="text-[10px] text-slate-500">
                                            {quote.placaCavaloMarca} {quote.placaCavaloModelo} ({quote.placaCavaloCor})
                                        </p>
                                    </div>
                                </div>

                                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 space-y-3">
                                    {quote.placaCarreta1 && (
                                        <div>
                                            <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Carreta 1</label>
                                            <p className="text-xs font-bold text-slate-800 flex items-center justify-between">
                                                Placa: {quote.placaCarreta1}
                                                {quote.placaCarreta1DocUrl && <a href={quote.placaCarreta1DocUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-3 h-3 text-slate-400 hover:text-blue-500" /></a>}
                                            </p>
                                            <p className="text-[10px] text-slate-500">
                                                <span className="font-bold">Renavam:</span> {quote.placaCarreta1Renavam || '-'}
                                            </p>
                                        </div>
                                    )}
                                    {quote.placaCarreta2 && (
                                        <div className="pt-2 border-t border-slate-200">
                                            <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Carreta 2</label>
                                            <p className="text-xs font-bold text-slate-800 flex items-center justify-between">
                                                Placa: {quote.placaCarreta2}
                                                {quote.placaCarreta2DocUrl && <a href={quote.placaCarreta2DocUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-3 h-3 text-slate-400 hover:text-blue-500" /></a>}
                                            </p>
                                            <p className="text-[10px] text-slate-500">
                                                <span className="font-bold">Renavam:</span> {quote.placaCarreta2Renavam || '-'}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-gray-100 flex justify-between items-center bg-slate-50">
                    <div className="flex gap-3">
                        <button
                            onClick={handleCopyGRData}
                            className={`px-6 py-2.5 flex items-center gap-2 text-sm font-bold rounded-xl transition-all ${copied ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'}`}
                        >
                            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                            {copied ? 'Copiado!' : 'Copiar Texto GR'}
                        </button>

                        <button
                            onClick={() => generateHiringPDF(quote)}
                            className="px-6 py-2.5 flex items-center gap-2 text-sm font-bold bg-slate-800 text-white rounded-xl hover:bg-slate-900 transition-all shadow-lg shadow-slate-200"
                        >
                            <FileText className="w-4 h-4 text-orange-400" />
                            Baixar Ficha PDF
                        </button>
                    </div>

                    <button onClick={onClose} className="px-8 py-2.5 border border-slate-300 text-slate-600 font-bold rounded-xl hover:bg-slate-100 transition-colors text-sm">
                        Fechar Detalhes
                    </button>
                </div>
            </div>
        </div>
    );
};

const DetailItem: React.FC<{ label: string; value: string | undefined | null }> = ({ label, value }) => (
    <div className="px-4 py-2 flex justify-between items-center gap-4">
        <span className="text-[10px] font-bold text-slate-400 uppercase">{label}</span>
        <span className="text-xs font-bold text-slate-700 truncate">{value || '-'}</span>
    </div>
);
