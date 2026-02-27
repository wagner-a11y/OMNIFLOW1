
import React, { useState } from 'react';
import { X, Calendar, MapPin, Truck, Package, DollarSign, Info, Copy, Check } from 'lucide-react';
import { FreightCalculation, Customer } from '../types';

interface WonInfoModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (data: Partial<FreightCalculation>) => void;
    quote: FreightCalculation;
    customers: Customer[];
}

export const WonInfoModal: React.FC<WonInfoModalProps> = ({ isOpen, onClose, onSubmit, quote, customers }) => {
    const num = (s: string | number | undefined | null) => {
        if (s === undefined || s === null) return 0;
        if (typeof s === 'number') return s;
        const clean = s.replace(/R\$\s?/, '').replace(/\./g, '').replace(',', '.').trim();
        return parseFloat(clean) || 0;
    };

    const maskCurrency = (val: string | number) => {
        let value = typeof val === 'number' ? val.toFixed(2) : val;
        value = value.replace(/\D/g, '');
        const numberValue = parseInt(value) / 100;
        if (isNaN(numberValue)) return 'R$ 0,00';
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL',
        }).format(numberValue);
    };

    const [formData, setFormData] = useState<Partial<FreightCalculation>>({
        coletaDate: quote.coletaDate || '',
        entregaDate: quote.entregaDate || '',
        clienteNomeOperacao: quote.clienteNomeOperacao || '',
        referenciaClienteOperacao: quote.referenciaClienteOperacao || quote.clientReference || '',
        solicitante: quote.solicitante || '',
        coletaEndereco: quote.coletaEndereco || quote.origin || '',
        entregaEndereco: quote.entregaEndereco || quote.destination || '',
        pesoCargaOperacao: quote.pesoCargaOperacao || quote.weight || 0,
        veiculoTipoOperacao: quote.veiculoTipoOperacao || quote.vehicleType || '',
        carroceriaTipoOperacao: quote.carroceriaTipoOperacao || '',
        materialTipo: quote.materialTipo || quote.merchandiseType || '',
        nossoFrete: quote.nossoFrete || quote.totalFreight || 0,
        freteTerceiro: quote.freteTerceiro || 0,
        valorCarga: quote.valorCarga || quote.goodsValue || 0,
        outrasNecessidades: quote.outrasNecessidades || '',
        observacoesGerais: quote.observacoesGerais || ''
    });

    if (!isOpen) return null;

    const [copied, setCopied] = useState(false);

    const handleCopyLoadText = () => {
        const text = `📦 *DETALHES DA CARGA - OMNIFLOW*\n\n` +
            `🏢 *Cliente:* ${formData.clienteNomeOperacao}\n` +
            `📅 *Coleta:* ${formData.coletaDate ? new Date(formData.coletaDate).toLocaleString('pt-BR') : 'A combinar'}\n` +
            `📅 *Entrega:* ${formData.entregaDate ? new Date(formData.entregaDate).toLocaleString('pt-BR') : 'A combinar'}\n\n` +
            `📍 *Origem:* ${formData.coletaEndereco}\n` +
            `🏁 *Destino:* ${formData.entregaEndereco}\n\n` +
            `🚛 *Veículo:* ${formData.veiculoTipoOperacao}\n` +
            `🏗️ *Carroceria:* ${formData.carroceriaTipoOperacao || 'A definir'}\n` +
            `📦 *Produto:* ${formData.materialTipo}\n` +
            `⚖️ *Peso:* ${formData.pesoCargaOperacao} kg\n\n` +
            `💰 *Valor da Carga:* ${maskCurrency(formData.valorCarga || 0)}\n` +
            `💵 *Frete Venda:* ${maskCurrency(formData.nossoFrete || 0)}\n` +
            `💵 *Frete Compra:* ${maskCurrency(formData.freteTerceiro || 0)}\n\n` +
            `📝 *Necessidades:* ${formData.outrasNecessidades || 'Nenhuma'}\n` +
            `💬 *Obs:* ${formData.observacoesGerais || 'Nenhuma'}`;

        navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        const isCurrency = name === 'nossoFrete' || name === 'freteTerceiro' || name === 'valorCarga';

        setFormData(prev => ({
            ...prev,
            [name]: isCurrency ? num(value) : (name.includes('peso') ? parseFloat(value) || 0 : value)
        }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSubmit(formData);
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 md:pl-64">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-emerald-50">
                    <div className="flex items-center gap-3 text-emerald-700">
                        <div className="p-2 bg-emerald-100 rounded-lg">
                            <DollarSign className="w-6 h-6" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold">Informações da Carga Ganha</h2>
                            <p className="text-sm text-emerald-600/80">Complete os detalhes para iniciar a operação</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-emerald-100 rounded-full transition-colors">
                        <X className="w-6 h-6 text-emerald-700" />
                    </button>
                </div>

                {/* Form Content */}
                <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

                        {/* Datas Component */}
                        <div className="space-y-4">
                            <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                                <Calendar className="w-4 h-4 text-emerald-500" /> Agendamento
                            </h3>
                            <div className="space-y-3">
                                <div>
                                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1 block">Coleta (Data/Hora)</label>
                                    <input type="datetime-local" name="coletaDate" value={formData.coletaDate} onChange={handleChange} className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500 transition-all outline-none" required />
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1 block">Entrega (Data/Hora)</label>
                                    <input type="datetime-local" name="entregaDate" value={formData.entregaDate} onChange={handleChange} className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500 transition-all outline-none" required />
                                </div>
                            </div>
                        </div>

                        {/* Cliente Info */}
                        <div className="space-y-4">
                            <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                                <Info className="w-4 h-4 text-emerald-500" /> Identificação
                            </h3>
                            <div className="space-y-3">
                                <div>
                                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1 block">Nome do Cliente</label>
                                    <input type="text" name="clienteNomeOperacao" value={formData.clienteNomeOperacao} onChange={handleChange} className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="Nome para operação" required />
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1 block">Referência Cliente</label>
                                    <input type="text" name="referenciaClienteOperacao" value={formData.referenciaClienteOperacao} onChange={handleChange} className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="Ex: Pedido 123" />
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1 block">Solicitante</label>
                                    <input type="text" name="solicitante" value={formData.solicitante} onChange={handleChange} className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="Quem solicitou?" />
                                </div>
                            </div>
                        </div>

                        {/* Endereços */}
                        <div className="space-y-4">
                            <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                                <MapPin className="w-4 h-4 text-emerald-500" /> Logística
                            </h3>
                            <div className="space-y-3">
                                <div>
                                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1 block">Endereço de Coleta</label>
                                    <input type="text" name="coletaEndereco" value={formData.coletaEndereco} onChange={handleChange} className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="Endereço completo" required />
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1 block">Endereço de Entrega</label>
                                    <input type="text" name="entregaEndereco" value={formData.entregaEndereco} onChange={handleChange} className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="Endereço completo" required />
                                </div>
                            </div>
                        </div>

                        {/* Veículo e Carga */}
                        <div className="space-y-4">
                            <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                                <Truck className="w-4 h-4 text-emerald-500" /> Veículo e Carga
                            </h3>
                            <div className="space-y-3">
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1 block">Tipo Veículo</label>
                                        <input type="text" name="veiculoTipoOperacao" value={formData.veiculoTipoOperacao} onChange={handleChange} className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" required />
                                    </div>
                                    <div>
                                        <label className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1 block">Tipo Carroceria</label>
                                        <input type="text" name="carroceriaTipoOperacao" value={formData.carroceriaTipoOperacao} onChange={handleChange} className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="Ex: Sider, Grade" />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1 block">Peso (kg)</label>
                                        <input type="text" name="pesoCargaOperacao" value={formData.pesoCargaOperacao} onChange={e => setFormData(prev => ({ ...prev, pesoCargaOperacao: parseFloat(e.target.value) || 0 }))} className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" />
                                    </div>
                                    <div>
                                        <label className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1 block">Material</label>
                                        <input type="text" name="materialTipo" value={formData.materialTipo} onChange={handleChange} className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" required />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Valores */}
                        <div className="space-y-4">
                            <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                                <DollarSign className="w-4 h-4 text-emerald-500" /> Financeiro
                            </h3>
                            <div className="space-y-3">
                                <div>
                                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1 block">Nosso Frete (Venda)</label>
                                    <input type="text" name="nossoFrete" value={maskCurrency(formData.nossoFrete || 0)} onChange={e => setFormData(prev => ({ ...prev, nossoFrete: num(maskCurrency(e.target.value)) }))} className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" required />
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1 block">Frete Terceiro (Compra)</label>
                                    <input type="text" name="freteTerceiro" value={maskCurrency(formData.freteTerceiro || 0)} onChange={e => setFormData(prev => ({ ...prev, freteTerceiro: num(maskCurrency(e.target.value)) }))} className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" required />
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1 block">Valor da Carga</label>
                                    <input type="text" name="valorCarga" value={maskCurrency(formData.valorCarga || 0)} onChange={e => setFormData(prev => ({ ...prev, valorCarga: num(maskCurrency(e.target.value)) }))} className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" />
                                </div>
                            </div>
                        </div>

                        {/* Outras Necessidades */}
                        <div className="space-y-4">
                            <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                                <Package className="w-4 h-4 text-emerald-500" /> Necessidades
                            </h3>
                            <div className="space-y-3">
                                <div>
                                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1 block">Outras Necessidades</label>
                                    <textarea name="outrasNecessidades" value={formData.outrasNecessidades} onChange={handleChange} className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none min-h-[80px]" placeholder="Ex: Ajudantes, Transbordo..." />
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1 block">Observações Gerais</label>
                                    <textarea name="observacoesGerais" value={formData.observacoesGerais} onChange={handleChange} className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none min-h-[80px]" placeholder="Informações adicionais..." />
                                </div>
                            </div>
                        </div>

                    </div>

                    {/* Footer Actions */}
                    <div className="mt-8 pt-6 border-t border-gray-100 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                            <button type="button" onClick={handleCopyLoadText} className={`px-6 py-2.5 flex items-center gap-2 font-bold rounded-xl transition-all ${copied ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
                                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                {copied ? 'Copiado!' : 'Copiar Texto da Carga'}
                            </button>
                        </div>
                        <div className="flex items-center gap-3">
                            <button type="button" onClick={onClose} className="px-6 py-2.5 border border-gray-200 text-gray-600 font-semibold rounded-xl hover:bg-gray-50 transition-colors">
                                Cancelar
                            </button>
                            <button type="submit" className="px-8 py-2.5 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 shadow-lg shadow-emerald-200 transition-all flex items-center gap-2">
                                Salvar e Iniciar Operação
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
};
