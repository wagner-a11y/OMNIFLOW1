
import React, { useState, useRef } from 'react';
import { X, User, Phone, CreditCard, Truck, Link, FileUp, Loader2, CheckCircle2, AlertCircle, FileText } from 'lucide-react';
import { FreightCalculation } from '../types';
import { extractDataFromDoc } from '../services/geminiService';
import { supabase } from '../services/supabase';
import { generateHiringPDF } from '../services/pdfService';

interface HiringInfoModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (data: Partial<FreightCalculation>) => void;
    quote: FreightCalculation;
    targetStage: string;
}

export const HiringInfoModal: React.FC<HiringInfoModalProps> = ({ isOpen, onClose, onSubmit, quote, targetStage }) => {
    const [formData, setFormData] = useState<Partial<FreightCalculation>>({
        motoristaNome: quote.motoristaNome || '',
        motoristaCPF: quote.motoristaCPF || '',
        motoristaTelefone: quote.motoristaTelefone || '',
        motoristaRG: quote.motoristaRG || '',
        motoristaCnhRegistro: quote.motoristaCnhRegistro || '',
        motoristaCnhProtocolo: quote.motoristaCnhProtocolo || '',
        motoristaCnhSeguranca: quote.motoristaCnhSeguranca || '',

        placaCavalo: quote.placaCavalo || '',
        placaCavaloRenavam: quote.placaCavaloRenavam || '',
        placaCavaloChassi: quote.placaCavaloChassi || '',
        placaCavaloCor: quote.placaCavaloCor || '',
        placaCavaloAnoFab: quote.placaCavaloAnoFab || '',
        placaCavaloAnoMod: quote.placaCavaloAnoMod || '',
        placaCavaloMarca: quote.placaCavaloMarca || '',
        placaCavaloModelo: quote.placaCavaloModelo || '',

        placaCarreta1: quote.placaCarreta1 || '',
        placaCarreta1Renavam: quote.placaCarreta1Renavam || '',
        placaCarreta1Chassi: quote.placaCarreta1Chassi || '',
        placaCarreta1Cor: quote.placaCarreta1Cor || '',
        placaCarreta1AnoFab: quote.placaCarreta1AnoFab || '',
        placaCarreta1AnoMod: quote.placaCarreta1AnoMod || '',
        placaCarreta1Marca: quote.placaCarreta1Marca || '',
        placaCarreta1Modelo: quote.placaCarreta1Modelo || '',

        placaCarreta2: quote.placaCarreta2 || '',
        placaCarreta2Renavam: quote.placaCarreta2Renavam || '',
        placaCarreta2Chassi: quote.placaCarreta2Chassi || '',
        placaCarreta2Cor: quote.placaCarreta2Cor || '',
        placaCarreta2AnoFab: quote.placaCarreta2AnoFab || '',
        placaCarreta2AnoMod: quote.placaCarreta2AnoMod || '',
        placaCarreta2Marca: quote.placaCarreta2Marca || '',
        placaCarreta2Modelo: quote.placaCarreta2Modelo || '',

        motoristaDocUrl: quote.motoristaDocUrl || '',
        placaCavaloDocUrl: quote.placaCavaloDocUrl || '',
        placaCarreta1DocUrl: quote.placaCarreta1DocUrl || '',
        placaCarreta2DocUrl: quote.placaCarreta2DocUrl || ''
    });

    const [isUploading, setIsUploading] = useState<Record<string, boolean>>({});
    const [isProcessingOCR, setIsProcessingOCR] = useState(false);

    if (!isOpen) return null;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, field: string, type: 'motorista' | 'veiculo') => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsUploading(prev => ({ ...prev, [field]: true }));

        try {
            // 1. Convert to base64 for OCR
            const reader = new FileReader();
            const base64Promise = new Promise<string>((resolve) => {
                reader.onload = () => resolve(reader.result as string);
                reader.readAsDataURL(file);
            });
            const base64 = await base64Promise;

            // 2. Upload to Supabase Storage
            const fileExt = file.name.split('.').pop();
            const fileName = `${quote.id}_${field}_${Math.random().toString(36).substring(7)}.${fileExt}`;
            const filePath = `hiring-docs/${fileName}`;

            const { data: uploadData, error: uploadError } = await supabase.storage
                .from('documents')
                .upload(filePath, file);

            if (uploadError) throw uploadError;

            const { data: { publicUrl } } = supabase.storage
                .from('documents')
                .getPublicUrl(filePath);

            setFormData(prev => ({ ...prev, [field]: publicUrl }));

            // 3. Trigger OCR with Gemini
            setIsProcessingOCR(true);
            const ocrResult = await extractDataFromDoc(base64.split(',')[1], file.type);

            if (ocrResult && !ocrResult.error) {
                // Auto-fill fields based on OCR
                if (type === 'motorista') {
                    setFormData(prev => ({
                        ...prev,
                        motoristaNome: ocrResult.nome || prev.motoristaNome,
                        motoristaCPF: ocrResult.cpf || prev.motoristaCPF,
                    }));
                } else {
                    setFormData(prev => ({
                        ...prev,
                        [field.replace('DocUrl', '')]: ocrResult.placa || prev[field.replace('DocUrl', '') as keyof FreightCalculation],
                    }));
                }
            }
        } catch (error: any) {
            console.error('Detailed Error handling file:', error);
            const errorMsg = error.message || 'Erro desconhecido';
            if (error.status === 404 || error.message?.includes('bucket')) {
                alert(`Erro de Armazenamento: Verifique se o bucket "documents" existe no Supabase. (${errorMsg})`);
            } else if (error.name === 'FunctionsHttpError') {
                alert(`Erro no OCR: Problema ao processar o documento via IA. (${errorMsg})`);
            } else {
                alert(`Erro ao processar documento: ${errorMsg}`);
            }
        } finally {
            setIsUploading(prev => ({ ...prev, [field]: false }));
            setIsProcessingOCR(false);
        }
    };

    const isFormValid = targetStage === 'Em contratação'
        ? (!!formData.motoristaNome && !!formData.motoristaCPF && !!formData.placaCavalo && !!formData.motoristaTelefone)
        : (!!formData.motoristaNome && !!formData.motoristaCPF && !!formData.motoristaRG && !!formData.motoristaCnhRegistro && !!formData.placaCavalo && !!formData.placaCavaloRenavam);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!isFormValid) {
            alert('Por favor, preencha todos os campos obrigatórios para o estágio ' + targetStage + '.');
            return;
        }
        onSubmit(formData);
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-orange-50">
                    <div className="flex items-center gap-3 text-orange-700">
                        <div className="p-2 bg-orange-100 rounded-lg">
                            <Truck className="w-6 h-6" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold">Dados para {targetStage}</h2>
                            <p className="text-sm text-orange-600/80">
                                {targetStage === 'GR' ? 'Preencha os detalhes avançados para o Gerenciamento de Risco' : 'Dados básicos para iniciar a contratação'}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-orange-100 rounded-full transition-colors">
                        <X className="w-6 h-6 text-orange-700" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 overflow-y-auto max-h-[80vh]">
                    <div className="space-y-6">
                        {/* Seção Motorista */}
                        <div className="bg-slate-50 p-4 rounded-xl space-y-4">
                            <h3 className="font-bold text-slate-700 flex items-center gap-2 mb-2 uppercase text-xs tracking-wider">
                                <User className="w-4 h-4" /> Dados do Motorista
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="md:col-span-2">
                                    <label className="text-xs font-bold text-gray-500 mb-1 block uppercase">Nome Completo *</label>
                                    <input type="text" name="motoristaNome" value={formData.motoristaNome} onChange={handleChange} className="w-full px-3 py-2 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-orange-500" required />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-gray-500 mb-1 block uppercase">CPF *</label>
                                    <input type="text" name="motoristaCPF" value={formData.motoristaCPF} onChange={handleChange} className="w-full px-3 py-2 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-orange-500" placeholder="000.000.000-00" required />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-gray-500 mb-1 block uppercase">RG {targetStage === 'GR' && '*'}</label>
                                    <input type="text" name="motoristaRG" value={formData.motoristaRG} onChange={handleChange} className="w-full px-3 py-2 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-orange-500" required={targetStage === 'GR'} />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-gray-500 mb-1 block uppercase">Telefone *</label>
                                    <input type="text" name="motoristaTelefone" value={formData.motoristaTelefone} onChange={handleChange} className="w-full px-3 py-2 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-orange-500" placeholder="(00) 00000-0000" required />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-gray-500 mb-1 block uppercase">Registro CNH {targetStage === 'GR' && '*'}</label>
                                    <input type="text" name="motoristaCnhRegistro" value={formData.motoristaCnhRegistro} onChange={handleChange} className="w-full px-3 py-2 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-orange-500" required={targetStage === 'GR'} />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-gray-500 mb-1 block uppercase italic text-orange-600">Protocolo CNH (Vertical)</label>
                                    <input type="text" name="motoristaCnhProtocolo" value={formData.motoristaCnhProtocolo} onChange={handleChange} className="w-full px-3 py-2 border border-orange-200 rounded-lg outline-none focus:ring-2 focus:ring-orange-500" placeholder="Negrito perto da foto" />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-gray-500 mb-1 block uppercase">Nº Segurança CNH</label>
                                    <input type="text" name="motoristaCnhSeguranca" value={formData.motoristaCnhSeguranca} onChange={handleChange} className="w-full px-3 py-2 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-orange-500" />
                                </div>
                            </div>

                            <div className="pt-2">
                                <label className="text-xs font-bold text-gray-500 mb-2 block uppercase">Anexar Documento (CNH)</label>
                                <div className="flex items-center gap-3">
                                    <label className={`cursor-pointer flex items-center gap-2 px-4 py-2 rounded-lg border-2 border-dashed transition-all ${formData.motoristaDocUrl ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-white border-gray-200 text-gray-500 hover:border-orange-300'}`}>
                                        <input type="file" className="hidden" accept="image/*,application/pdf" onChange={(e) => handleFileUpload(e, 'motoristaDocUrl', 'motorista')} disabled={isUploading['motoristaDocUrl']} />
                                        {isUploading['motoristaDocUrl'] ? <Loader2 className="w-4 h-4 animate-spin" /> : (formData.motoristaDocUrl ? <CheckCircle2 className="w-4 h-4" /> : <FileUp className="w-4 h-4" />)}
                                        <span className="text-sm font-semibold">{formData.motoristaDocUrl ? 'Documento Anexado' : 'Selecionar Arquivo'}</span>
                                    </label>
                                    {isProcessingOCR && <span className="text-[10px] text-orange-600 animate-pulse font-bold uppercase tracking-tighter italic flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Extraindo dados via OCR...</span>}
                                </div>
                            </div>
                        </div>

                        {/* Seção Veículo */}
                        <div className="bg-slate-50 p-4 rounded-xl space-y-4">
                            <h3 className="font-bold text-slate-700 flex items-center gap-2 mb-2 uppercase text-xs tracking-wider">
                                <Truck className="w-4 h-4" /> Veículo e Implementos
                            </h3>
                            <div className="space-y-6">
                                {/* Cavalo */}
                                <div className="p-3 border border-slate-200 rounded-xl bg-white shadow-sm">
                                    <label className="text-xs font-black text-slate-800 mb-3 block uppercase border-b pb-2">1. Cavalo (Trator)</label>
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                        <div className="col-span-1">
                                            <label className="text-[10px] font-bold text-gray-400 uppercase">Placa *</label>
                                            <input type="text" name="placaCavalo" value={formData.placaCavalo} onChange={handleChange} className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-orange-500" placeholder="AAA-0000" />
                                        </div>
                                        <div className="col-span-1">
                                            <label className="text-[10px] font-bold text-gray-400 uppercase">Renavam {targetStage === 'GR' && '*'}</label>
                                            <input type="text" name="placaCavaloRenavam" value={formData.placaCavaloRenavam} onChange={handleChange} className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-orange-500" required={targetStage === 'GR'} />
                                        </div>
                                        <div className="col-span-1">
                                            <label className="text-[10px] font-bold text-gray-400 uppercase">Chassi</label>
                                            <input type="text" name="placaCavaloChassi" value={formData.placaCavaloChassi} onChange={handleChange} className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-orange-500" />
                                        </div>
                                        <div className="col-span-1">
                                            <label className="text-[10px] font-bold text-gray-400 uppercase">Cor</label>
                                            <input type="text" name="placaCavaloCor" value={formData.placaCavaloCor} onChange={handleChange} className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-orange-500" />
                                        </div>
                                        <div className="col-span-1">
                                            <label className="text-[10px] font-bold text-gray-400 uppercase">Ano Fab/Mod</label>
                                            <div className="flex gap-1">
                                                <input type="text" name="placaCavaloAnoFab" value={formData.placaCavaloAnoFab} onChange={handleChange} className="w-full px-1 py-1.5 text-xs border border-gray-200 rounded-lg" placeholder="Fab" />
                                                <input type="text" name="placaCavaloAnoMod" value={formData.placaCavaloAnoMod} onChange={handleChange} className="w-full px-1 py-1.5 text-xs border border-gray-200 rounded-lg" placeholder="Mod" />
                                            </div>
                                        </div>
                                        <div className="col-span-1">
                                            <label className="text-[10px] font-bold text-gray-400 uppercase">Marca/Modelo</label>
                                            <input type="text" name="placaCavaloMarca" value={formData.placaCavaloMarca} onChange={handleChange} className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg" placeholder="Marca" />
                                        </div>
                                        <div className="col-span-2">
                                            <UploadSmall field="placaCavaloDocUrl" label="CRL-V Cavalo" url={formData.placaCavaloDocUrl} isUploading={isUploading['placaCavaloDocUrl']} onUpload={(e) => handleFileUpload(e, 'placaCavaloDocUrl', 'veiculo')} />
                                        </div>
                                    </div>
                                </div>

                                {/* Carreta 1 */}
                                <div className="p-3 border border-slate-200 rounded-xl bg-white shadow-sm">
                                    <label className="text-xs font-black text-slate-800 mb-3 block uppercase border-b pb-2">2. Carreta 1</label>
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                        <div className="col-span-1">
                                            <label className="text-[10px] font-bold text-gray-400 uppercase">Placa</label>
                                            <input type="text" name="placaCarreta1" value={formData.placaCarreta1} onChange={handleChange} className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg" placeholder="AAA-0000" />
                                        </div>
                                        <div className="col-span-1">
                                            <label className="text-[10px] font-bold text-gray-400 uppercase">Renavam</label>
                                            <input type="text" name="placaCarreta1Renavam" value={formData.placaCarreta1Renavam} onChange={handleChange} className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg" />
                                        </div>
                                        <div className="col-span-1">
                                            <label className="text-[10px] font-bold text-gray-400 uppercase">Ano Fab/Mod</label>
                                            <div className="flex gap-1">
                                                <input type="text" name="placaCarreta1AnoFab" value={formData.placaCarreta1AnoFab} onChange={handleChange} className="w-full px-1 py-1.5 text-xs border border-gray-200 rounded-lg" placeholder="Fab" />
                                                <input type="text" name="placaCarreta1AnoMod" value={formData.placaCarreta1AnoMod} onChange={handleChange} className="w-full px-1 py-1.5 text-xs border border-gray-200 rounded-lg" placeholder="Mod" />
                                            </div>
                                        </div>
                                        <div className="col-span-1">
                                            <UploadSmall field="placaCarreta1DocUrl" label="Doc Carreta 1" url={formData.placaCarreta1DocUrl} isUploading={isUploading['placaCarreta1DocUrl']} onUpload={(e) => handleFileUpload(e, 'placaCarreta1DocUrl', 'veiculo')} />
                                        </div>
                                    </div>
                                </div>

                                {/* Carreta 2 */}
                                <div className="p-3 border border-slate-200 rounded-xl bg-white shadow-sm">
                                    <label className="text-xs font-black text-slate-800 mb-3 block uppercase border-b pb-2">3. Carreta 2 (Bi-Trem)</label>
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                        <div className="col-span-1">
                                            <label className="text-[10px] font-bold text-gray-400 uppercase">Placa</label>
                                            <input type="text" name="placaCarreta2" value={formData.placaCarreta2} onChange={handleChange} className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg" placeholder="AAA-0000" />
                                        </div>
                                        <div className="col-span-1">
                                            <label className="text-[10px] font-bold text-gray-400 uppercase">Renavam</label>
                                            <input type="text" name="placaCarreta2Renavam" value={formData.placaCarreta2Renavam} onChange={handleChange} className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg" />
                                        </div>
                                        <div className="col-span-1">
                                            <label className="text-[10px] font-bold text-gray-400 uppercase">Ano Fab/Mod</label>
                                            <div className="flex gap-1">
                                                <input type="text" name="placaCarreta2AnoFab" value={formData.placaCarreta2AnoFab} onChange={handleChange} className="w-full px-1 py-1.5 text-xs border border-gray-200 rounded-lg" placeholder="Fab" />
                                                <input type="text" name="placaCarreta2AnoMod" value={formData.placaCarreta2AnoMod} onChange={handleChange} className="w-full px-1 py-1.5 text-xs border border-gray-200 rounded-lg" placeholder="Mod" />
                                            </div>
                                        </div>
                                        <div className="col-span-1">
                                            <UploadSmall field="placaCarreta2DocUrl" label="Doc Carreta 2" url={formData.placaCarreta2DocUrl} isUploading={isUploading['placaCarreta2DocUrl']} onUpload={(e) => handleFileUpload(e, 'placaCarreta2DocUrl', 'veiculo')} />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="mt-8 pt-6 border-t border-gray-100 flex items-center justify-between gap-3">
                        <button type="button" onClick={() => generateHiringPDF(formData as any)} className="px-4 py-2.5 border border-slate-200 text-slate-600 font-bold rounded-xl hover:bg-slate-50 transition-colors flex items-center gap-2 text-sm shadow-sm">
                            <FileText className="w-4 h-4" />
                            Gerar PDF
                        </button>

                        <div className="flex items-center gap-3">
                            <button type="button" onClick={onClose} className="px-6 py-2.5 border border-gray-200 text-gray-600 font-semibold rounded-xl hover:bg-gray-50 transition-colors text-sm">
                                Cancelar
                            </button>
                            <button type="submit" disabled={!isFormValid} className={`px-8 py-2.5 font-bold rounded-xl shadow-lg transition-all flex items-center gap-2 text-sm ${isFormValid ? 'bg-orange-600 text-white hover:bg-orange-700 shadow-orange-200' : 'bg-gray-100 text-gray-400 cursor-not-allowed shadow-none'}`}>
                                Confirmar {targetStage}
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
};

interface UploadSmallProps {
    field: string;
    label: string;
    url?: string;
    isUploading: boolean;
    onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

const UploadSmall: React.FC<UploadSmallProps> = ({ label, url, isUploading, onUpload }) => (
    <div className="mt-2">
        <label className={`cursor-pointer flex items-center justify-center gap-1 p-1 rounded-md border text-[10px] font-bold transition-all ${url ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
            <input type="file" className="hidden" accept="image/*,application/pdf" onChange={onUpload} disabled={isUploading} />
            {isUploading ? <Loader2 className="w-3 h-3 animate-spin" /> : (url ? <CheckCircle2 className="w-3 h-3" /> : <FileUp className="w-3 h-3" />)}
            {url ? 'Anexado' : `Anexar ${label}`}
        </label>
    </div>
);
