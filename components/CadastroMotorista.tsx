import React, { useState } from 'react';
import { AlertTriangle, CheckCircle, IdCard, Info, Loader2, MapPin, Search, Send } from 'lucide-react';
import { extractDataFromDoc } from '../services/geminiService';
import UploadDocumento from './UploadDocumento';
import { buscarCep, formatarCep } from '../services/cep';
import {
    CAMPOS_CNH, CNH_VAZIA, DadosCNH, DadosEndereco, DadosFiscais,
    ENDERECO_VAZIO, ESTADOS_CIVIS, FISCAIS_PADRAO, ResultadoCadastro,
    cadastrarMotorista, celularValido, daIaParaFormulario, fiscaisDaCnh,
    formatarCelular, registrarLog,
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

/**
 * Campos sem os quais o Bsoft recusa o cadastro — a lista foi medida contra a
 * API, não suposta: ela valida um a um e devolve "Atributo obrigatório [x]".
 * O toxicológico entra aqui mesmo NÃO estando na CNH: a API exige assim.
 */
const OBRIGATORIOS: Array<keyof DadosCNH> = [
    'nome', 'sobrenome', 'cpf', 'sexo', 'data_nascimento',
    'registro_cnh', 'codigo_seguranca', 'protocolo', 'categoria',
    'orgao_expedidor_cnh', 'data_validade', 'data_expedicao',
    'data_primeira_habilitacao', 'data_validade_toxicologico',
];

const CadastroMotorista: React.FC<Props> = ({ autor }) => {
    const [dados, setDados] = useState<DadosCNH>(CNH_VAZIA);
    const [fiscais, setFiscais] = useState<DadosFiscais>(FISCAIS_PADRAO);
    const [endereco, setEndereco] = useState<DadosEndereco>(ENDERECO_VAZIO);
    const [lendo, setLendo] = useState(false);
    const [enviando, setEnviando] = useState(false);
    const [leu, setLeu] = useState(false);
    const [anexo, setAnexo] = useState<{ base64: string; extensao: string } | null>(null);
    const [resultado, setResultado] = useState<ResultadoCadastro | null>(null);
    const [erroLeitura, setErroLeitura] = useState<string | null>(null);
    const [buscandoCep, setBuscandoCep] = useState(false);
    const [erroCep, setErroCep] = useState<string | null>(null);

    const setCampo = (k: keyof DadosCNH, v: string) => {
        setDados(prev => ({ ...prev, [k]: v }));
        setResultado(null);   // mexeu depois de cadastrar: o resultado anterior não vale mais
    };
    const setFiscal = (k: keyof DadosFiscais, v: string) => {
        setFiscais(prev => ({ ...prev, [k]: v }));
        setResultado(null);
    };
    const setProprietario = (v: boolean) => {
        setFiscais(prev => ({ ...prev, proprietario: v }));
        setResultado(null);
    };
    const setEnd = (k: keyof DadosEndereco, v: string) => {
        setEndereco(prev => ({ ...prev, [k]: v }));
        setResultado(null);
    };

    /**
     * Busca o CEP e preenche rua, bairro e município. O código IBGE só é gravado
     * aqui — digitar cidade à mão não produz código, e sem código o endereço não
     * é enviado. É o que impede mandar município no chute para o Bsoft.
     */
    const procurarCep = async (valor?: string) => {
        const alvo = valor ?? endereco.cep;
        setBuscandoCep(true); setErroCep(null); setResultado(null);
        try {
            const achado = await buscarCep(alvo);
            setEndereco(prev => ({
                ...prev,
                cep: achado.cep,
                logradouro: achado.logradouro || prev.logradouro,
                bairro: achado.bairro || prev.bairro,
                cidade: String(achado.municipio.codigo),
                municipioNome: achado.municipio.nome,
                estado: achado.municipio.uf,
                municipioRotulo: achado.municipio.rotulo,
            }));
        } catch (err) {
            // Não limpa o que o operador já digitou: ele completa à mão.
            setErroCep((err as Error).message);
            setEndereco(prev => ({ ...prev, cidade: '', estado: '', municipioRotulo: '' }));
        } finally {
            setBuscandoCep(false);
        }
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
            // A CNH dá a UF de naturalidade (ou, na falta, a UF de emissão).
            setFiscais(prev => fiscaisDaCnh({ ...CNH_VAZIA, ...lido }, prev));
            setLeu(true);
        } catch (err) {
            setErroLeitura((err as Error).message);
        } finally {
            setLendo(false);
            e.target.value = '';   // permite reanexar o mesmo arquivo
        }
    };

    const rotuloDe = (k: string) =>
        CAMPOS_CNH.find(c => c.chave === k)?.label
        ?? ({ rntrc: 'RNTRC', uf_naturalidade: 'UF de naturalidade', estado_civil: 'Estado civil',
              nacionalidade: 'Nacionalidade', naturalidade: 'Naturalidade (município)',
              celular: 'Celular', cep: 'CEP', logradouro: 'Endereço', numero: 'Número',
              bairro: 'Bairro', cidade: 'Município (busque pelo CEP)' } as Record<string, string>)[k]
        ?? k;

    const faltando = [
        ...OBRIGATORIOS.filter(k => !String(dados[k] || '').trim()),
        ...(['estado_civil', 'nacionalidade', 'uf_naturalidade'] as Array<keyof DadosFiscais>)
            .filter(k => !String(fiscais[k] || '').trim()),
        // RNTRC é do transportador: só cobra de quem também é dono do veículo.
        ...(fiscais.proprietario && !fiscais.rntrc.trim() ? ['rntrc'] : []),
        // Celular não basta estar preenchido: precisa dos 11 dígitos.
        ...(celularValido(fiscais.celular) ? [] : ['celular']),
        // `cidade` é o código IBGE: só existe se a busca de CEP tiver validado.
        ...(['cep', 'logradouro', 'numero', 'bairro', 'cidade'] as Array<keyof DadosEndereco>)
            .filter(k => !String(endereco[k] || '').trim()),
    ].map(String);

    const cadastrar = async () => {
        if (faltando.length) return;
        setEnviando(true); setResultado(null);
        try {
            const r = await cadastrarMotorista(dados, fiscais, endereco, anexo ?? undefined);
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
        setDados(CNH_VAZIA); setFiscais(FISCAIS_PADRAO); setEndereco(ENDERECO_VAZIO);
        setAnexo(null); setLeu(false);
        setResultado(null); setErroLeitura(null); setErroCep(null);
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
                        Confira tudo antes de cadastrar — a leitura automática pode errar. Campos em âmbar
                        ficaram vazios na leitura; os marcados “não vem na CNH” são preenchidos à mão.
                    </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {CAMPOS_CNH.map(({ chave, label, tipo, manual }) => {
                        const valor = String(dados[chave] || '');
                        // Campo `manual` vazio não é falha de leitura: ele não vem na CNH.
                        const vazio = !valor.trim() && !manual;
                        const obrigatorio = OBRIGATORIOS.includes(chave);
                        return (
                            <div key={chave} className="flex flex-col">
                                <label className="text-[10px] font-medium uppercase text-[#6b7280] mb-1.5">
                                    {label}{obrigatorio && <span className="text-red-500 ml-0.5">*</span>}
                                    {manual && <span className="ml-1 normal-case text-[#9ca3af]">· não vem na CNH</span>}
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

            {/* 3 — dados fiscais (não vêm da CNH) */}
            <div className="bg-white border border-[#e5e7eb] rounded-xl p-6">
                <div className="flex items-center gap-2 mb-4">
                    <Info className="w-4 h-4 text-[#6b7280]" strokeWidth={1.75} />
                    <p className="text-xs font-medium text-[#6b7280]">
                        Dados que o Datamex exige e a CNH não traz. Os padrões cobrem o caso comum —
                        confira e ajuste quando for diferente.
                    </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="flex flex-col">
                        <label className="text-[10px] font-medium uppercase text-[#6b7280] mb-1.5">
                            Estado civil<span className="text-red-500 ml-0.5">*</span>
                        </label>
                        <select
                            value={fiscais.estado_civil}
                            onChange={e => setFiscal('estado_civil', e.target.value)}
                            className="w-full px-3 py-2.5 rounded-lg text-sm font-medium outline-none border bg-[#f9fafb] border-[#e5e7eb] focus:border-[#1d6fb8] transition-colors"
                        >
                            {ESTADOS_CIVIS.map(o => <option key={o.valor} value={o.valor}>{o.label}</option>)}
                        </select>
                    </div>
                    <div className="flex flex-col">
                        <label className="text-[10px] font-medium uppercase text-[#6b7280] mb-1.5">
                            Nacionalidade<span className="text-red-500 ml-0.5">*</span>
                        </label>
                        <input
                            value={fiscais.nacionalidade}
                            onChange={e => setFiscal('nacionalidade', e.target.value)}
                            className="w-full px-3 py-2.5 rounded-lg text-sm font-medium outline-none border bg-[#f9fafb] border-[#e5e7eb] focus:border-[#1d6fb8] transition-colors"
                        />
                    </div>
                    <div className="flex flex-col">
                        <label className="text-[10px] font-medium uppercase text-[#6b7280] mb-1.5">
                            Naturalidade (município)
                            <span className="ml-1 normal-case text-[#9ca3af]">· da CNH</span>
                        </label>
                        <input
                            value={fiscais.naturalidade}
                            onChange={e => setFiscal('naturalidade', e.target.value)}
                            placeholder="Município de nascimento"
                            className="w-full px-3 py-2.5 rounded-lg text-sm font-medium outline-none border bg-[#f9fafb] border-[#e5e7eb] focus:border-[#1d6fb8] transition-colors"
                        />
                    </div>
                    <div className="flex flex-col">
                        <label className="text-[10px] font-medium uppercase text-[#6b7280] mb-1.5">
                            UF de naturalidade<span className="text-red-500 ml-0.5">*</span>
                            <span className="ml-1 normal-case text-[#9ca3af]">· da CNH</span>
                        </label>
                        <input
                            value={fiscais.uf_naturalidade}
                            maxLength={2}
                            onChange={e => setFiscal('uf_naturalidade', e.target.value.toUpperCase())}
                            placeholder="RS"
                            className={`w-full px-3 py-2.5 rounded-lg text-sm font-medium outline-none border uppercase transition-colors ${fiscais.uf_naturalidade
                                ? 'bg-[#f9fafb] border-[#e5e7eb] focus:border-[#1d6fb8]'
                                : 'bg-amber-50 border-amber-300 focus:border-amber-500'}`}
                        />
                    </div>
                    <div className="flex flex-col">
                        <label className="text-[10px] font-medium uppercase text-[#6b7280] mb-1.5">
                            Matrícula INSS
                            <span className="ml-1 normal-case text-[#9ca3af]">· zerado = sem validação</span>
                        </label>
                        <input
                            value={fiscais.matricula_inss}
                            onChange={e => setFiscal('matricula_inss', e.target.value)}
                            className="w-full px-3 py-2.5 rounded-lg text-sm font-medium outline-none border bg-[#f9fafb] border-[#e5e7eb] focus:border-[#1d6fb8] transition-colors"
                        />
                    </div>
                </div>

                {/* O que não vem de lugar nenhum: sem padrão e sem OCR. */}
                <div className="mt-5 pt-5 border-t border-[#e5e7eb] flex flex-wrap gap-6">
                    <div>
                        <label className="text-[10px] font-medium uppercase text-[#6b7280] mb-1.5 block">
                            Este motorista é o proprietário do veículo?
                        </label>
                        <div className="flex gap-2">
                            {[{ v: false, r: 'Não, só dirige' }, { v: true, r: 'Sim, é o dono' }].map(o => (
                                <button
                                    key={String(o.v)}
                                    type="button"
                                    onClick={() => setProprietario(o.v)}
                                    className={`px-4 py-2.5 rounded-lg text-xs font-semibold border transition-colors ${fiscais.proprietario === o.v
                                        ? 'bg-[#1d6fb8] border-[#1d6fb8] text-white'
                                        : 'bg-white border-[#e5e7eb] text-[#6b7280] hover:bg-[#f9fafb]'}`}
                                >
                                    {o.r}
                                </button>
                            ))}
                        </div>
                        <p className="text-[10px] font-normal text-[#9ca3af] mt-1.5 max-w-xs">
                            O RNTRC é registro do transportador. Quem só dirige não tem.
                        </p>
                    </div>

                    {/* RNTRC e dependentes só existem para quem é dono do veículo. */}
                    {fiscais.proprietario && (
                        <>
                            <div>
                                <label className="text-[10px] font-medium uppercase text-[#6b7280] mb-1.5 block">
                                    RNTRC<span className="text-red-500 ml-0.5">*</span>
                                    <span className="ml-1 normal-case text-[#9ca3af]">· do proprietário, digite à mão</span>
                                </label>
                                <input
                                    value={fiscais.rntrc}
                                    onChange={e => setFiscal('rntrc', e.target.value)}
                                    placeholder="Número do RNTRC"
                                    className={`w-full md:w-64 px-3 py-2.5 rounded-lg text-sm font-semibold outline-none border transition-colors ${fiscais.rntrc
                                        ? 'bg-[#f9fafb] border-[#e5e7eb] focus:border-[#1d6fb8]'
                                        : 'bg-amber-50 border-amber-300 focus:border-amber-500'}`}
                                />
                            </div>
                            <div>
                                <label className="text-[10px] font-medium uppercase text-[#6b7280] mb-1.5 block">
                                    Dependentes IRRF
                                    <span className="ml-1 normal-case text-[#9ca3af]">· 0 se não tiver</span>
                                </label>
                                <input
                                    type="number"
                                    min={0}
                                    value={fiscais.dependentes_irrf}
                                    onChange={e => setFiscal('dependentes_irrf', e.target.value)}
                                    className="w-full md:w-36 px-3 py-2.5 rounded-lg text-sm font-medium outline-none border bg-[#f9fafb] border-[#e5e7eb] focus:border-[#1d6fb8] transition-colors"
                                />
                            </div>
                        </>
                    )}
                    <div>
                        <label className="text-[10px] font-medium uppercase text-[#6b7280] mb-1.5 block">
                            Celular<span className="text-red-500 ml-0.5">*</span>
                            <span className="ml-1 normal-case text-[#9ca3af]">· DDD + 9 dígitos</span>
                        </label>
                        <input
                            value={fiscais.celular}
                            onChange={e => setFiscal('celular', formatarCelular(e.target.value))}
                            placeholder="(00) 00000-0000"
                            inputMode="numeric"
                            className={`w-full md:w-56 px-3 py-2.5 rounded-lg text-sm font-semibold outline-none border transition-colors ${celularValido(fiscais.celular)
                                ? 'bg-[#f9fafb] border-[#e5e7eb] focus:border-[#1d6fb8]'
                                : 'bg-amber-50 border-amber-300 focus:border-amber-500'}`}
                        />
                        {fiscais.celular && !celularValido(fiscais.celular) && (
                            <p className="text-[10px] font-medium text-amber-700 mt-1">
                                Faltam dígitos — são 11 no total (DDD + 9).
                            </p>
                        )}
                    </div>
                </div>
            </div>

            {/* 4 — endereço, a partir do CEP */}
            <div className="bg-white border border-[#e5e7eb] rounded-xl p-6">
                <div className="flex items-center gap-2 mb-4">
                    <MapPin className="w-4 h-4 text-[#6b7280]" strokeWidth={1.75} />
                    <p className="text-xs font-medium text-[#6b7280]">
                        Digite o CEP para preencher rua, bairro e município. O município vem do código
                        IBGE conferido contra a tabela oficial — por isso não dá para digitá-lo à mão.
                    </p>
                </div>

                <div className="flex flex-wrap items-end gap-3 mb-4">
                    <div className="flex flex-col">
                        <label className="text-[10px] font-medium uppercase text-[#6b7280] mb-1.5">
                            CEP<span className="text-red-500 ml-0.5">*</span>
                        </label>
                        <input
                            value={endereco.cep}
                            onChange={e => setEnd('cep', formatarCep(e.target.value))}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); procurarCep(); } }}
                            onBlur={() => { if (endereco.cep.replace(/\D/g, '').length === 8 && !endereco.cidade) procurarCep(); }}
                            placeholder="00000-000"
                            className={`w-40 px-3 py-2.5 rounded-lg text-sm font-semibold outline-none border transition-colors ${endereco.cidade
                                ? 'bg-[#f9fafb] border-[#e5e7eb] focus:border-[#1d6fb8]'
                                : 'bg-amber-50 border-amber-300 focus:border-amber-500'}`}
                        />
                    </div>
                    <button
                        type="button"
                        onClick={() => procurarCep()}
                        disabled={buscandoCep || endereco.cep.replace(/\D/g, '').length !== 8}
                        className="px-4 py-2.5 rounded-lg text-xs font-semibold text-white bg-[#1d6fb8] hover:bg-[#175a94] disabled:bg-[#e5e7eb] disabled:text-[#9ca3af] disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                    >
                        {buscandoCep ? <><Loader2 className="w-4 h-4 animate-spin" /> Buscando…</> : <><Search className="w-4 h-4" strokeWidth={1.75} /> Buscar CEP</>}
                    </button>
                    {endereco.municipioRotulo && (
                        <span className="text-xs font-medium text-emerald-700 pb-2.5">
                            {endereco.municipioRotulo} · IBGE {endereco.cidade}
                        </span>
                    )}
                </div>

                {erroCep && (
                    <div className="bg-amber-50 border border-amber-300 text-amber-900 px-4 py-2.5 rounded-lg mb-4 flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" strokeWidth={1.75} />
                        <p className="text-xs font-medium">{erroCep}</p>
                    </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {([
                        { chave: 'logradouro' as const, label: 'Endereço', obrigatorio: true },
                        { chave: 'numero' as const, label: 'Número', obrigatorio: true },
                        { chave: 'complemento' as const, label: 'Complemento', obrigatorio: false },
                        { chave: 'bairro' as const, label: 'Bairro', obrigatorio: true },
                    ]).map(({ chave, label, obrigatorio }) => {
                        const valor = endereco[chave];
                        return (
                            <div key={chave} className="flex flex-col">
                                <label className="text-[10px] font-medium uppercase text-[#6b7280] mb-1.5">
                                    {label}{obrigatorio && <span className="text-red-500 ml-0.5">*</span>}
                                </label>
                                <input
                                    value={valor}
                                    onChange={e => setEnd(chave, e.target.value)}
                                    className={`w-full px-3 py-2.5 rounded-lg text-sm font-medium outline-none border transition-colors ${!valor.trim() && obrigatorio
                                        ? 'bg-amber-50 border-amber-300 focus:border-amber-500'
                                        : 'bg-[#f9fafb] border-[#e5e7eb] focus:border-[#1d6fb8]'}`}
                                />
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* 5 — cadastrar */}
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
                        Faltam campos obrigatórios: {faltando.map(rotuloDe).join(', ')}
                    </span>
                )}
            </div>

            {/* 6 — resultado */}
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
                                {resultado.codEndereco ? ` · endereço ${resultado.codEndereco}` : ''}
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
