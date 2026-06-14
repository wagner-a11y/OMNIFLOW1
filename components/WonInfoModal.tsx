
import React, { useState, useRef, useEffect } from 'react';
import { X, Calendar, MapPin, Truck, Package, DollarSign, Info, Copy, Check, Link2, Loader2 } from 'lucide-react';
import { FreightCalculation, Customer } from '../types';
import { searchPipefyRecords } from '../services/pipefy';

// Campo com autocomplete dos cadastros do Pipefy (Clientes/Solicitantes). Busca server-side,
// debounce, assíncrona e FAIL-SOFT: se o Pipefy estiver lento/fora, retorna lista vazia e o
// operador digita livre normalmente — nunca trava a cotação. Escolher um item guarda nome + id;
// digitar livre (sem escolher) limpa o id (vínculo fica vazio na criação do card, sem forçar).
const PipefyAutocomplete: React.FC<{
    tipo: 'cliente' | 'solicitante';
    value: string;
    selectedId?: string;
    onChangeText: (name: string) => void;
    onPick: (rec: { id: string; title: string }) => void;
    placeholder?: string;
    required?: boolean;
}> = ({ tipo, value, selectedId, onChangeText, onPick, placeholder, required }) => {
    const [results, setResults] = useState<{ id: string; title: string }[]>([]);
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const debRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const boxRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const onDoc = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
        document.addEventListener('mousedown', onDoc);
        return () => { document.removeEventListener('mousedown', onDoc); if (debRef.current) clearTimeout(debRef.current); };
    }, []);

    const handleType = (v: string) => {
        onChangeText(v); // atualiza o nome e limpa o id no pai (digitou livre)
        if (debRef.current) clearTimeout(debRef.current);
        if (v.trim().length < 2) { setResults([]); setOpen(false); setLoading(false); return; }
        setLoading(true); setOpen(true);
        debRef.current = setTimeout(async () => {
            const r = await searchPipefyRecords(tipo, v.trim()); // fail-soft: [] em caso de erro
            setResults(r); setLoading(false); setOpen(true);
        }, 350);
    };

    return (
        <div className="relative" ref={boxRef}>
            <input type="text" value={value} required={required} placeholder={placeholder} autoComplete="off"
                onChange={e => handleType(e.target.value)}
                onFocus={() => { if (results.length) setOpen(true); }}
                className="w-full px-3 py-2 pr-16 border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" />
            {selectedId
                ? <span className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600" title={`Vinculado ao cadastro do Pipefy (id ${selectedId})`}><Link2 className="w-3 h-3" /> vinculado</span>
                : (loading && <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 animate-spin" />)}
            {open && (loading || results.length > 0) && (
                <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                    {loading && <div className="px-3 py-2 text-xs text-gray-400">Buscando no Pipefy…</div>}
                    {!loading && results.map(r => (
                        <button key={r.id} type="button" onClick={() => { onPick(r); setOpen(false); }}
                            className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-emerald-50 flex items-center gap-2">
                            <Link2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" /> {r.title}
                        </button>
                    ))}
                    {!loading && results.length === 0 && value.trim().length >= 2 && (
                        <div className="px-3 py-2 text-xs text-gray-400">Nenhum no cadastro — segue como texto livre (sem vínculo).</div>
                    )}
                </div>
            )}
        </div>
    );
};

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
        clientePipefyId: quote.clientePipefyId || undefined,
        referenciaClienteOperacao: quote.referenciaClienteOperacao || quote.clientReference || '',
        solicitante: quote.solicitante || '',
        solicitantePipefyId: quote.solicitantePipefyId || undefined,
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
        observacoesGerais: quote.observacoesGerais || '',
        mercadoriaNovaUsada: quote.mercadoriaNovaUsada || '',
        outrasNecessidadesPipefy: quote.outrasNecessidadesPipefy || '',
        necessidadeGR: quote.necessidadeGR || []
    });

    // Opções EXATAS espelhadas do Pipefy (grafia idêntica). Não inventar nem alterar.
    const GR_OPCOES = ['Consulta/Cadastro Gerenciadora', 'Rastreamento e Monitoramento', 'Escolta', 'Isca', 'Imobilizador Inteligente', 'Pernoitar das 22h até as 5h'];
    const toggleGR = (op: string) => setFormData(p => {
        const cur = Array.isArray(p.necessidadeGR) ? p.necessidadeGR : [];
        return { ...p, necessidadeGR: cur.includes(op) ? cur.filter(x => x !== op) : [...cur, op] };
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
            <div className="bg-white rounded-lg shadow-sm w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-emerald-50">
                    <div className="flex items-center gap-3 text-emerald-700">
                        <div className="p-2 bg-emerald-100 rounded-lg">
                            <DollarSign className="w-6 h-6" />
                        </div>
                        <div>
                            <h2 className="text-xl font-medium">Informações da Carga Ganha</h2>
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
                                    <PipefyAutocomplete tipo="cliente" value={formData.clienteNomeOperacao || ''} selectedId={formData.clientePipefyId}
                                        onChangeText={name => setFormData(p => ({ ...p, clienteNomeOperacao: name, clientePipefyId: undefined }))}
                                        onPick={rec => setFormData(p => ({ ...p, clienteNomeOperacao: rec.title, clientePipefyId: rec.id }))}
                                        placeholder="Nome para operação" required />
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1 block">Referência Cliente</label>
                                    <input type="text" name="referenciaClienteOperacao" value={formData.referenciaClienteOperacao} onChange={handleChange} className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="Ex: Pedido 123" />
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1 block">Solicitante</label>
                                    <PipefyAutocomplete tipo="solicitante" value={formData.solicitante || ''} selectedId={formData.solicitantePipefyId}
                                        onChangeText={name => setFormData(p => ({ ...p, solicitante: name, solicitantePipefyId: undefined }))}
                                        onPick={rec => setFormData(p => ({ ...p, solicitante: rec.title, solicitantePipefyId: rec.id }))}
                                        placeholder="Quem solicitou?" />
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
                                <div>
                                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1 block">Mercadoria Nova/Usada?</label>
                                    <select name="mercadoriaNovaUsada" value={formData.mercadoriaNovaUsada || ''} onChange={handleChange} className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none bg-white">
                                        <option value="">— não informar —</option>
                                        <option value="Nova">Nova</option>
                                        <option value="Usada">Usada</option>
                                    </select>
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
                                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1 block">Necessidades operacionais (vão pras Observações)</label>
                                    <textarea name="outrasNecessidades" value={formData.outrasNecessidades} onChange={handleChange} className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none min-h-[60px]" placeholder="Ex: Ajudantes, Transbordo..." />
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1 block">Outras Necessidades (sistema)</label>
                                    <select name="outrasNecessidadesPipefy" value={formData.outrasNecessidadesPipefy || ''} onChange={handleChange} className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none bg-white">
                                        <option value="">— não informar —</option>
                                        <option value="Compulog">Compulog</option>
                                        <option value="Comprovei">Comprovei</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1 block">Necessidade GR</label>
                                    <div className="space-y-1.5 border border-gray-200 rounded-lg p-2.5">
                                        {GR_OPCOES.map(op => (
                                            <label key={op} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                                                <input type="checkbox" checked={(formData.necessidadeGR || []).includes(op)} onChange={() => toggleGR(op)} className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500" />
                                                {op}
                                            </label>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1 block">Observações Gerais</label>
                                    <textarea name="observacoesGerais" value={formData.observacoesGerais} onChange={handleChange} className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none min-h-[60px]" placeholder="Informações adicionais..." />
                                </div>
                            </div>
                        </div>

                    </div>

                    {/* Footer Actions */}
                    <div className="mt-8 pt-6 border-t border-gray-100 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                            <button type="button" onClick={handleCopyLoadText} className={`px-6 py-2.5 flex items-center gap-2 font-medium rounded-xl transition-all ${copied ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
                                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                {copied ? 'Copiado!' : 'Copiar Texto da Carga'}
                            </button>
                        </div>
                        <div className="flex items-center gap-3">
                            <button type="button" onClick={onClose} className="px-6 py-2.5 border border-gray-200 text-gray-600 font-semibold rounded-xl hover:bg-gray-50 transition-colors">
                                Cancelar
                            </button>
                            <button type="submit" className="px-8 py-2.5 bg-emerald-600 text-white font-medium rounded-xl hover:bg-emerald-700 shadow-sm shadow-emerald-200 transition-all flex items-center gap-2">
                                Salvar e enviar para o Pipefy
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
};
