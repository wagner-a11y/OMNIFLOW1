import React, { useState } from 'react';
import { AlertTriangle, CheckCircle, IdCard, Info, Loader2, Send } from 'lucide-react';
import { extractDataFromDoc } from '../services/geminiService';
import UploadDocumento from './UploadDocumento';
import {
    CAMPOS_CNH, CNH_VAZIA, DadosCNH, ResultadoCadastro,
    cadastrarMotorista, daIaParaFormulario, registrarLog,
} from '../services/cadastroMotorista';

// ============================================================================
// Cadastro Rápido — Motorista (Fase 2).
//
// Fluxo: anexa a CNH -> a IA lê -> o operador CONFERE e corrige -> cadastra no
// Bsoft. A conferência é obrigatória por desenho: OCR erra, e aqui o resultado
// vira cadastro de pessoa num sistema externo.
//
// Só motorista nesta fase. Nada de veículo, nada de Pipefy.
// ============================================================================

interface Props {
    /** Usuário logado — vai para o log de rastreabilidade. */
    autor: { id?: string; name?: string };
}

/** Campos sem os quais o Bsoft recusa o cadastro. */
const OBRIGATORIOS: Array<keyof DadosCNH> = ['nome', 'sobrenome', 'cpf', 'sexo', 'data_nascimento'];

const CadastroMotorista: React.FC<Props> = ({ autor }) => {
    const [dados, setDados] = useState<DadosCNH>(CNH_VAZIA);
    const [lendo, setLendo] = useState(false);
    const [enviando, setEnviando] = useState(false);
    const [leu, setLeu] = useState(false);
    const [anexo, setAnexo] = useState<{ base64: string; extensao: string } | null>(null);
    const [resultado, setResultado] = useState<ResultadoCadastro | null>(null);
    const [erroLeitura, setErroLeitura] = useState<string | null>(null);

    const setCampo = (k: keyof DadosCNH, v: string) => {
        setDados(prev => ({ ...prev, [k]: v }));
        setResultado(null);   // mexeu depois de cadastrar: o resultado anterior não vale mais
    };

    const aoAnexar = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setLendo(true); setErroLeitura(null); setResultado(null);
        try {
            const dataUrl = await new Promise<string>((resolve, reject) => {
                const r = new FileReader();
                r.onload = () => resolve(r.result as string);
                r.onerror = () => reject(new Error('Não consegui ler o arquivo.'));
                r.readAsDataURL(file);
            });
            const base64 = dataUrl.split(',')[1];
            const extensao = (file.name.split('.').pop() || 'jpg').toLowerCase();
            setAnexo({ base64, extensao });

            const ocr = await extractDataFromDoc(base64, file.type);
            if (!ocr || ocr.error) {
                setErroLeitura(ocr?.error || 'A leitura não retornou nada.');
                return;
            }
            const lido = daIaParaFormulario(ocr as Record<string, unknown>);
            if (lido.tipo_documento && lido.tipo_documento.toUpperCase() !== 'CNH') {
                setErroLeitura(`O documento parece ser ${lido.tipo_documento}, não uma CNH. Confira o arquivo.`);
            }
            setDados(prev => ({ ...prev, ...lido }));
            setLeu(true);
        } catch (err) {
            setErroLeitura((err as Error).message);
        } finally {
            setLendo(false);
            e.target.value = '';   // permite reanexar o mesmo arquivo
        }
    };

    const faltando = OBRIGATORIOS.filter(k => !String(dados[k] || '').trim());

    const cadastrar = async () => {
        if (faltando.length) return;
        setEnviando(true); setResultado(null);
        try {
            const r = await cadastrarMotorista(dados, anexo ?? undefined);
            setResultado(r);
            await registrarLog({
                cpf: dados.cpf, nome: `${dados.nome} ${dados.sobrenome}`.trim(),
                codPessoa: r.codPessoa, jaExistia: r.jaExistia, anexado: r.anexado,
                sucesso: !r.error, erro: r.error, autor,
            });
        } finally {
            setEnviando(false);
        }
    };

    const limpar = () => {
        setDados(CNH_VAZIA); setAnexo(null); setLeu(false);
        setResultado(null); setErroLeitura(null);
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3">
                <div className="p-2.5 bg-[#1d6fb8] rounded-lg text-white"><IdCard className="w-5 h-5" strokeWidth={1.75} /></div>
                <div>
                    <h2 className="text-lg font-medium text-[#111827]">Cadastro Rápido — Motorista</h2>
                    <p className="text-sm font-normal text-[#6b7280]">Anexe a CNH, confira o que foi lido e cadastre no Datamex.</p>
                </div>
            </div>

            {/* 1 — anexo */}
            <div className="bg-white border border-[#e5e7eb] rounded-xl p-6 flex flex-wrap items-center gap-4">
                <UploadDocumento label="CNH" anexado={!!anexo} carregando={lendo} onSelect={aoAnexar} />
                <span className="text-xs font-normal text-[#6b7280]">
                    {lendo ? 'Lendo o documento…' : leu ? 'Documento lido. Confira os campos abaixo.' : 'Imagem ou PDF da CNH.'}
                </span>
                {(leu || anexo) && (
                    <button onClick={limpar} className="ml-auto text-xs font-medium text-[#6b7280] hover:text-[#111827] underline">
                        limpar
                    </button>
                )}
            </div>

            {erroLeitura && (
                <div className="bg-amber-50 border border-amber-300 text-amber-900 px-6 py-3 rounded-xl flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" strokeWidth={1.75} />
                    <div>
                        <p className="text-sm font-semibold">Leitura com problema</p>
                        <p className="text-xs font-medium opacity-90 mt-0.5">{erroLeitura} Você pode preencher à mão.</p>
                    </div>
                </div>
            )}

            {/* 2 — conferência */}
            <div className="bg-white border border-[#e5e7eb] rounded-xl p-6">
                <div className="flex items-center gap-2 mb-4">
                    <Info className="w-4 h-4 text-[#6b7280]" strokeWidth={1.75} />
                    <p className="text-xs font-medium text-[#6b7280]">
                        Confira tudo antes de cadastrar — a leitura automática pode errar. Campos em âmbar estão vazios.
                    </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {CAMPOS_CNH.map(({ chave, label, tipo }) => {
                        const valor = String(dados[chave] || '');
                        const vazio = !valor.trim();
                        const obrigatorio = OBRIGATORIOS.includes(chave);
                        return (
                            <div key={chave} className="flex flex-col">
                                <label className="text-[10px] font-medium uppercase text-[#6b7280] mb-1.5">
                                    {label}{obrigatorio && <span className="text-red-500 ml-0.5">*</span>}
                                </label>
                                <input
                                    type={tipo === 'date' ? 'date' : 'text'}
                                    value={valor}
                                    onChange={e => setCampo(chave, e.target.value)}
                                    className={`w-full px-3 py-2.5 rounded-lg text-sm font-medium outline-none border transition-colors ${vazio
                                        ? 'bg-amber-50 border-amber-300 focus:border-amber-500'
                                        : 'bg-[#f9fafb] border-[#e5e7eb] focus:border-[#1d6fb8]'}`}
                                />
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* 3 — cadastrar */}
            <div className="flex flex-wrap items-center gap-4">
                <button
                    onClick={cadastrar}
                    disabled={enviando || faltando.length > 0}
                    className="px-6 py-3 rounded-lg text-sm font-semibold text-white bg-[#1d6fb8] hover:bg-[#175a94] disabled:bg-[#e5e7eb] disabled:text-[#9ca3af] disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                >
                    {enviando ? <><Loader2 className="w-4 h-4 animate-spin" /> Cadastrando…</> : <><Send className="w-4 h-4" strokeWidth={1.75} /> Cadastrar no Datamex</>}
                </button>
                {faltando.length > 0 && (
                    <span className="text-xs font-medium text-amber-700">
                        Faltam campos obrigatórios: {faltando.map(k => CAMPOS_CNH.find(c => c.chave === k)?.label || k).join(', ')}
                    </span>
                )}
            </div>

            {/* 4 — resultado */}
            {resultado && (
                resultado.error ? (
                    <div className="bg-red-50 border border-red-300 text-red-900 px-6 py-4 rounded-xl flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-red-600" strokeWidth={1.75} />
                        <div>
                            <p className="text-sm font-semibold">Não foi cadastrado</p>
                            {/* Mensagem do próprio Bsoft — costuma dizer qual campo faltou. */}
                            <p className="text-xs font-medium opacity-90 mt-0.5">{resultado.error}</p>
                        </div>
                    </div>
                ) : (
                    <div className={`px-6 py-4 rounded-xl flex items-start gap-3 border ${resultado.jaExistia
                        ? 'bg-amber-50 border-amber-300 text-amber-900'
                        : 'bg-emerald-50 border-emerald-300 text-emerald-900'}`}>
                        <CheckCircle className={`w-5 h-5 shrink-0 mt-0.5 ${resultado.jaExistia ? 'text-amber-600' : 'text-emerald-600'}`} strokeWidth={1.75} />
                        <div>
                            <p className="text-sm font-semibold">
                                {resultado.jaExistia
                                    ? 'Motorista já existia no Datamex — não dupliquei'
                                    : 'Motorista cadastrado no Datamex'}
                            </p>
                            <p className="text-xs font-medium opacity-90 mt-0.5">
                                Código da pessoa: <strong>{resultado.codPessoa}</strong>
                                {resultado.anexado ? ' · CNH anexada' : anexo ? ' · CNH não anexada' : ''}
                            </p>
                            {resultado.aviso && <p className="text-xs font-medium text-amber-700 mt-1">{resultado.aviso}</p>}
                        </div>
                    </div>
                )
            )}
        </div>
    );
};

export default CadastroMotorista;
