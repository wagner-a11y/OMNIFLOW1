import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle, Info, Link2, Loader2, Send, Truck } from 'lucide-react';
import { extractDataFromDoc } from '../services/geminiService';
import UploadDocumento from './UploadDocumento';
import BlocoVeiculoCRLV, { EstadoPeca } from './BlocoVeiculoCRLV';
import {
    CAMPOS_CNH, CNH_VAZIA, DadosCNH, DadosEndereco, DadosFiscais,
    ENDERECO_VAZIO, ESTADOS_CIVIS, FISCAIS_PADRAO, celularValido,
    daIaParaFormulario, fiscaisDaCnh, formatarCelular, registrarLog,
} from '../services/cadastroMotorista';
import { buscarCep, formatarCep } from '../services/cep';
import {
    CATEGORIAS_COM_IMPLEMENTO, IMPLEMENTOS_VISIVEIS, PassoResultado,
    VinculoAtual, consultarVinculos, descreverProprietario, gravarConjunto,
} from '../services/conjunto';

// ============================================================================
// Cadastro de Conjunto (Fase 3C) — uma tela corrida, de cima para baixo.
//
// Motorista -> proprietário -> cavalo -> implementos -> vinculação -> gravar.
// Nada de assistente com etapas: o operador vê o conjunto inteiro montado
// antes de gravar qualquer coisa, e grava tudo num botão só.
//
// Não há regra nova aqui. Motorista é a Fase 2, veículo é a 3A, proprietário
// PF/PJ é a 3B — este arquivo só ORQUESTRA, e a cascata em si vive em
// services/conjunto.ts.
// ============================================================================

interface Props {
    autor: { id?: string; name?: string };
}

const soDigitos = (s: string) => (s || '').replace(/\D/g, '');
const semAcento = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

const PECA_VAZIA: EstadoPeca = {
    form: {} as any, placa: '', categoriaNome: '', pronto: false, vazio: true, ref: null,
};

const CadastroConjunto: React.FC<Props> = ({ autor }) => {
    // ---- Bloco 1: motorista ----
    const [temMotorista, setTemMotorista] = useState(true);
    const [cnh, setCnh] = useState<DadosCNH>(CNH_VAZIA);
    const [fiscais, setFiscais] = useState<DadosFiscais>(FISCAIS_PADRAO);
    const [endereco, setEndereco] = useState<DadosEndereco>(ENDERECO_VAZIO);
    const [anexoCnh, setAnexoCnh] = useState<{ base64: string; extensao: string } | null>(null);
    const [lendoCnh, setLendoCnh] = useState(false);
    const [leuCnh, setLeuCnh] = useState(false);
    const [erroCnh, setErroCnh] = useState<string | null>(null);
    const [buscandoCep, setBuscandoCep] = useState(false);
    const [erroCep, setErroCep] = useState<string | null>(null);

    // ---- Blocos 3/4: peças ----
    const [principal, setPrincipal] = useState<EstadoPeca>(PECA_VAZIA);
    const [impl1, setImpl1] = useState<EstadoPeca>(PECA_VAZIA);
    const [impl2, setImpl2] = useState<EstadoPeca>(PECA_VAZIA);
    const [querSegundoImplemento, setQuerSegundoImplemento] = useState(false);

    // ---- Bloco 5: vinculação ----
    const [vinculos, setVinculos] = useState<VinculoAtual[] | null>(null);
    const [buscandoVinculos, setBuscandoVinculos] = useState(false);
    const [removerAnteriores, setRemoverAnteriores] = useState(false);
    const [confirmouRemocao, setConfirmouRemocao] = useState(false);

    const [confirmando, setConfirmando] = useState(false);
    const [gravando, setGravando] = useState(false);
    const [passos, setPassos] = useState<PassoResultado[] | null>(null);
    const [erroFinal, setErroFinal] = useState<string | null>(null);
    const [concluido, setConcluido] = useState(false);

    // O cavalo puxa carreta; truck, toco e utilitário não.
    const ehTracao = useMemo(
        () => CATEGORIAS_COM_IMPLEMENTO.some(c => semAcento(principal.categoriaNome) === semAcento(c)),
        [principal.categoriaNome],
    );

    const nomeMotorista = `${cnh.nome} ${cnh.sobrenome}`.trim();
    /** O motorista só pode ser dono se estiver sendo cadastrado E marcado como tal. */
    const motoristaEhDono = temMotorista && fiscais.proprietario;

    const implementosUsados = useMemo(
        () => [impl1, impl2].filter(p => !p.vazio && p.placa),
        [impl1, impl2],
    );

    // ---- CNH ----
    const aoAnexarCnh = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setLendoCnh(true); setErroCnh(null);
        try {
            const dataUrl = await new Promise<string>((res, rej) => {
                const r = new FileReader();
                r.onload = () => res(r.result as string);
                r.onerror = () => rej(new Error('Não consegui ler o arquivo.'));
                r.readAsDataURL(file);
            });
            const base64 = dataUrl.split(',')[1];
            setAnexoCnh({ base64, extensao: (file.name.split('.').pop() || 'jpg').toLowerCase() });
            const ocr = await extractDataFromDoc(base64, file.type);
            if (!ocr || ocr.error) { setErroCnh(ocr?.error || 'A leitura não retornou nada.'); return; }
            const lido = daIaParaFormulario(ocr as Record<string, unknown>);
            if (lido.tipo_documento && lido.tipo_documento.toUpperCase() !== 'CNH') {
                setErroCnh(`O documento parece ser ${lido.tipo_documento}, não uma CNH.`);
            }
            setCnh(prev => ({ ...prev, ...lido }));
            setFiscais(prev => fiscaisDaCnh({ ...CNH_VAZIA, ...lido }, prev));
            setLeuCnh(true);
        } catch (err) {
            setErroCnh((err as Error).message);
        } finally {
            setLendoCnh(false);
            e.target.value = '';
        }
    };

    const procurarCep = async () => {
        setBuscandoCep(true); setErroCep(null);
        try {
            const a = await buscarCep(endereco.cep);
            setEndereco(prev => ({
                ...prev, cep: a.cep, logradouro: a.logradouro || prev.logradouro,
                bairro: a.bairro || prev.bairro, cidade: String(a.municipio.codigo),
                municipioNome: a.municipio.nome,
                estado: a.municipio.uf, municipioRotulo: a.municipio.rotulo,
            }));
        } catch (err) {
            setErroCep((err as Error).message);
        } finally { setBuscandoCep(false); }
    };

    const verVinculos = async () => {
        const cpf = soDigitos(cnh.cpf);
        if (cpf.length !== 11) return;
        setBuscandoVinculos(true);
        try {
            const r = await consultarVinculos(cpf);
            setVinculos(r.error ? [] : (r.vinculos ?? []));
        } finally { setBuscandoVinculos(false); }
    };

    // ---- O que ainda falta ----
    const faltaMotorista = temMotorista
        ? [
            ...(['nome', 'sobrenome', 'cpf', 'sexo', 'data_nascimento', 'registro_cnh',
                'codigo_seguranca', 'protocolo', 'categoria', 'orgao_expedidor_cnh',
                'data_validade', 'data_expedicao', 'data_primeira_habilitacao',
                'data_validade_toxicologico'] as Array<keyof DadosCNH>)
                .filter(k => !String(cnh[k] || '').trim()).map(String),
            ...(celularValido(fiscais.celular) ? [] : ['celular']),
            ...(fiscais.proprietario && !fiscais.rntrc.trim() ? ['RNTRC'] : []),
            ...(['cep', 'logradouro', 'numero', 'bairro', 'cidade'] as Array<keyof DadosEndereco>)
                .filter(k => !String(endereco[k] || '').trim()).map(String),
        ]
        : [];

    const podeGravar =
        !gravando &&
        principal.pronto &&
        implementosUsados.every(p => p.pronto) &&
        (!temMotorista || faltaMotorista.length === 0) &&
        (!removerAnteriores || confirmouRemocao);

    const gravar = async () => {
        setConfirmando(false); setGravando(true);
        setPassos(null); setErroFinal(null); setConcluido(false);
        try {
            const r = await gravarConjunto({
                motorista: temMotorista
                    ? { dados: cnh, fiscais, endereco, anexo: anexoCnh ?? undefined }
                    : undefined,
                motoristaCpf: cnh.cpf,
                principal: { rotulo: 'principal', form: principal.form, placa: principal.placa, ref: principal.ref },
                implementos: implementosUsados.map(p => ({ rotulo: 'implemento', form: p.form, placa: p.placa, ref: p.ref })),
                removerVinculacoes: removerAnteriores && confirmouRemocao ? 'S' : 'N',
            });
            setPassos(r.passos);
            setErroFinal(r.erro ?? null);
            setConcluido(r.concluido);

            if (temMotorista) {
                const m = r.passos.find(p => p.passo === 'Motorista');
                await registrarLog({
                    cpf: cnh.cpf, nome: `${cnh.nome} ${cnh.sobrenome}`.trim(),
                    codPessoa: m?.codigo, jaExistia: m?.detalhe?.includes('já existia'),
                    anexado: !!anexoCnh, sucesso: r.concluido, erro: r.erro, autor,
                });
            }
        } finally {
            setGravando(false);
        }
    };

    const classeNormal = 'w-full px-3 py-2.5 rounded-lg text-sm font-medium outline-none border bg-[#f9fafb] border-[#e5e7eb] focus:border-[#1d6fb8] transition-colors';

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3">
                <div className="p-2.5 bg-[#1d6fb8] rounded-lg text-white"><Truck className="w-5 h-5" strokeWidth={1.75} /></div>
                <div>
                    <h2 className="text-lg font-medium text-[#111827]">Cadastro de Conjunto</h2>
                    <p className="text-sm font-normal text-[#6b7280]">
                        Motorista, cavalo e carretas numa página só. Nada é gravado até o botão do fim.
                    </p>
                </div>
            </div>

            {/* ---- 1. MOTORISTA ---- */}
            <div className="bg-white border border-[#e5e7eb] rounded-xl p-6 space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-[#111827]">1 · Motorista</h3>
                    <div className="flex gap-2">
                        {[{ v: true, r: 'Cadastrar motorista' }, { v: false, r: 'Sem motorista' }].map(o => (
                            <button key={String(o.v)} type="button" onClick={() => setTemMotorista(o.v)}
                                className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${temMotorista === o.v
                                    ? 'bg-[#1d6fb8] border-[#1d6fb8] text-white'
                                    : 'bg-white border-[#e5e7eb] text-[#6b7280] hover:bg-[#f9fafb]'}`}>
                                {o.r}
                            </button>
                        ))}
                    </div>
                </div>

                {!temMotorista && (
                    <div className="bg-amber-50 border border-amber-300 text-amber-900 px-4 py-3 rounded-lg flex items-start gap-2">
                        <Info className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" strokeWidth={1.75} />
                        <p className="text-xs font-medium">
                            Sem motorista, os veículos são cadastrados mas <strong>a vinculação é pulada</strong> —
                            a API exige um motorista para amarrar o conjunto. Você pode vincular depois.
                        </p>
                    </div>
                )}

                {temMotorista && (
                    <>
                        <div className="flex flex-wrap items-center gap-4">
                            <UploadDocumento label="CNH" anexado={!!anexoCnh} carregando={lendoCnh} onSelect={aoAnexarCnh} />
                            <span className="text-xs font-normal text-[#6b7280]">
                                {lendoCnh ? 'Lendo…' : leuCnh ? 'Lida. Confira abaixo.' : 'Imagem ou PDF da CNH.'}
                            </span>
                        </div>
                        {erroCnh && (
                            <div className="bg-amber-50 border border-amber-300 text-amber-900 px-4 py-2.5 rounded-lg flex items-start gap-2">
                                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" strokeWidth={1.75} />
                                <p className="text-xs font-medium">{erroCnh} Você pode preencher à mão.</p>
                            </div>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3">
                            {CAMPOS_CNH.map(({ chave, label, tipo, manual }) => {
                                const valor = String(cnh[chave] || '');
                                const vazio = !valor.trim() && !manual;
                                return (
                                    <div key={chave} className="flex flex-col">
                                        <label className="text-[10px] font-medium uppercase text-[#6b7280] mb-1.5">
                                            {label}{manual && <span className="ml-1 normal-case text-[#9ca3af]">· manual</span>}
                                        </label>
                                        <input type={tipo === 'date' ? 'date' : 'text'} value={valor}
                                            onChange={e => setCnh(prev => ({ ...prev, [chave]: e.target.value }))}
                                            className={`w-full px-3 py-2.5 rounded-lg text-sm font-medium outline-none border transition-colors ${vazio
                                                ? 'bg-amber-50 border-amber-300 focus:border-amber-500'
                                                : 'bg-[#f9fafb] border-[#e5e7eb] focus:border-[#1d6fb8]'}`} />
                                    </div>
                                );
                            })}
                        </div>

                        {/* fiscais + o toggle de proprietário */}
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                            <div className="flex flex-col">
                                <label className="text-[10px] font-medium uppercase text-[#6b7280] mb-1.5">Estado civil</label>
                                <select value={fiscais.estado_civil} onChange={e => setFiscais({ ...fiscais, estado_civil: e.target.value })} className={classeNormal}>
                                    {ESTADOS_CIVIS.map(o => <option key={o.valor} value={o.valor}>{o.label}</option>)}
                                </select>
                            </div>
                            <div className="flex flex-col">
                                <label className="text-[10px] font-medium uppercase text-[#6b7280] mb-1.5">Nacionalidade</label>
                                <input value={fiscais.nacionalidade} onChange={e => setFiscais({ ...fiscais, nacionalidade: e.target.value })} className={classeNormal} />
                            </div>
                            <div className="flex flex-col">
                                <label className="text-[10px] font-medium uppercase text-[#6b7280] mb-1.5">Naturalidade</label>
                                <input value={fiscais.naturalidade} onChange={e => setFiscais({ ...fiscais, naturalidade: e.target.value })} className={classeNormal} />
                            </div>
                            <div className="flex flex-col">
                                <label className="text-[10px] font-medium uppercase text-[#6b7280] mb-1.5">UF naturalidade</label>
                                <input value={fiscais.uf_naturalidade} maxLength={2}
                                    onChange={e => setFiscais({ ...fiscais, uf_naturalidade: e.target.value.toUpperCase() })} className={classeNormal} />
                            </div>
                            <div className="flex flex-col">
                                <label className="text-[10px] font-medium uppercase text-[#6b7280] mb-1.5">
                                    Celular<span className="text-red-500 ml-0.5">*</span>
                                </label>
                                <input value={fiscais.celular} placeholder="(00) 00000-0000"
                                    onChange={e => setFiscais({ ...fiscais, celular: formatarCelular(e.target.value) })}
                                    className={`w-full px-3 py-2.5 rounded-lg text-sm font-semibold outline-none border transition-colors ${celularValido(fiscais.celular)
                                        ? 'bg-[#f9fafb] border-[#e5e7eb] focus:border-[#1d6fb8]'
                                        : 'bg-amber-50 border-amber-300 focus:border-amber-500'}`} />
                            </div>
                        </div>

                        <div className="border-t border-[#e5e7eb] pt-4">
                            <label className="text-[10px] font-medium uppercase text-[#6b7280] mb-1.5 block">
                                O motorista é o proprietário do veículo?
                            </label>
                            <div className="flex flex-wrap gap-2 items-end">
                                {[{ v: false, r: 'Não, só dirige' }, { v: true, r: 'Sim, é o dono' }].map(o => (
                                    <button key={String(o.v)} type="button"
                                        onClick={() => setFiscais({ ...fiscais, proprietario: o.v })}
                                        className={`px-4 py-2.5 rounded-lg text-xs font-semibold border transition-colors ${fiscais.proprietario === o.v
                                            ? 'bg-[#1d6fb8] border-[#1d6fb8] text-white'
                                            : 'bg-white border-[#e5e7eb] text-[#6b7280] hover:bg-[#f9fafb]'}`}>
                                        {o.r}
                                    </button>
                                ))}
                                {fiscais.proprietario && (
                                    <div className="flex flex-col">
                                        <label className="text-[10px] font-medium uppercase text-[#92400e] mb-1.5">
                                            RNTRC<span className="text-red-500 ml-0.5">*</span>
                                        </label>
                                        <input value={fiscais.rntrc} placeholder="RNTRC do proprietário"
                                            onChange={e => setFiscais({ ...fiscais, rntrc: e.target.value })}
                                            className={`w-56 px-3 py-2.5 rounded-lg text-sm font-semibold outline-none border-2 transition-colors ${fiscais.rntrc
                                                ? 'bg-white border-emerald-300' : 'bg-amber-50 border-amber-400'}`} />
                                    </div>
                                )}
                            </div>
                            {fiscais.proprietario && (
                                <p className="text-[11px] font-normal text-[#6b7280] mt-2">
                                    O veículo principal já assume ele como proprietário — não precisa buscar
                                    CPF nenhum. Se alguma peça for de outro dono, dá para trocar no bloco dela.
                                </p>
                            )}
                        </div>

                        {/* endereço */}
                        <div className="border-t border-[#e5e7eb] pt-4">
                            <div className="flex flex-wrap items-end gap-3 mb-3">
                                <div className="flex flex-col">
                                    <label className="text-[10px] font-medium uppercase text-[#6b7280] mb-1.5">
                                        CEP<span className="text-red-500 ml-0.5">*</span>
                                    </label>
                                    <input value={endereco.cep} placeholder="00000-000"
                                        onChange={e => setEndereco({ ...endereco, cep: formatarCep(e.target.value) })}
                                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); procurarCep(); } }}
                                        className={`w-40 px-3 py-2.5 rounded-lg text-sm font-semibold outline-none border transition-colors ${endereco.cidade
                                            ? 'bg-[#f9fafb] border-[#e5e7eb]' : 'bg-amber-50 border-amber-300'}`} />
                                </div>
                                <button type="button" onClick={procurarCep}
                                    disabled={buscandoCep || soDigitos(endereco.cep).length !== 8}
                                    className="px-4 py-2.5 rounded-lg text-xs font-semibold text-white bg-[#1d6fb8] hover:bg-[#175a94] disabled:bg-[#e5e7eb] disabled:text-[#9ca3af] transition-colors">
                                    {buscandoCep ? 'Buscando…' : 'Buscar CEP'}
                                </button>
                                {endereco.municipioRotulo && (
                                    <span className="text-xs font-medium text-emerald-700 pb-2.5">
                                        {endereco.municipioRotulo} · IBGE {endereco.cidade}
                                    </span>
                                )}
                            </div>
                            {erroCep && <p className="text-xs font-medium text-amber-700 mb-3">{erroCep}</p>}
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                                {([['logradouro', 'Endereço'], ['numero', 'Número'], ['complemento', 'Complemento'], ['bairro', 'Bairro']] as Array<[keyof DadosEndereco, string]>)
                                    .map(([k, label]) => (
                                        <div key={k} className="flex flex-col">
                                            <label className="text-[10px] font-medium uppercase text-[#6b7280] mb-1.5">{label}</label>
                                            <input value={String(endereco[k])} onChange={e => setEndereco({ ...endereco, [k]: e.target.value })} className={classeNormal} />
                                        </div>
                                    ))}
                            </div>
                        </div>
                    </>
                )}
            </div>

            {/* ---- 2/3. VEÍCULO PRINCIPAL (o proprietário vem dentro do bloco) ---- */}
            <BlocoVeiculoCRLV
                titulo="2 · Veículo principal"
                subtitulo="Anexe o CRLV da tração. Se for cavalo, os blocos de carreta abrem sozinhos."
                motoristaEhDono={motoristaEhDono}
                nomeMotorista={nomeMotorista}
                assumirMotorista={motoristaEhDono}
                onChange={setPrincipal}
            />

            {/* ---- 4. IMPLEMENTOS ---- */}
            {ehTracao && (
                <>
                    <div className="bg-blue-50 border border-blue-200 text-[#1e3a8a] px-4 py-3 rounded-xl flex items-start gap-2">
                        <Info className="w-4 h-4 shrink-0 mt-0.5" strokeWidth={1.75} />
                        <p className="text-xs font-medium">
                            O veículo principal é um <strong>{principal.categoriaNome}</strong>, então puxa implemento.
                            A carreta pode ser de um terceiro — cada uma tem proprietário próprio.
                        </p>
                    </div>

                    <BlocoVeiculoCRLV titulo="3 · Implemento 1 (carreta / central)" opcional
                        motoristaEhDono={motoristaEhDono} nomeMotorista={nomeMotorista} onChange={setImpl1} />

                    {!querSegundoImplemento && IMPLEMENTOS_VISIVEIS > 1 && (
                        <button type="button" onClick={() => setQuerSegundoImplemento(true)}
                            className="text-xs font-semibold text-[#1d6fb8] hover:underline">
                            + Tem um segundo implemento (bitrem, rodotrem)
                        </button>
                    )}
                    {querSegundoImplemento && (
                        <BlocoVeiculoCRLV titulo="4 · Implemento 2" opcional
                            motoristaEhDono={motoristaEhDono} nomeMotorista={nomeMotorista} onChange={setImpl2} />
                    )}
                </>
            )}

            {/* ---- 5. VINCULAÇÃO ---- */}
            <div className="bg-white border border-[#e5e7eb] rounded-xl p-6 space-y-4">
                <div className="flex items-center gap-2">
                    <Link2 className="w-4 h-4 text-[#6b7280]" strokeWidth={1.75} />
                    <h3 className="text-sm font-semibold text-[#111827]">5 · Vinculação</h3>
                </div>

                {!temMotorista ? (
                    <p className="text-xs font-medium text-amber-700">
                        Sem motorista definido, a vinculação será pulada. Os veículos entram assim mesmo.
                    </p>
                ) : (
                    <>
                        <div className="flex flex-wrap items-center gap-3">
                            <button type="button" onClick={verVinculos}
                                disabled={buscandoVinculos || soDigitos(cnh.cpf).length !== 11}
                                className="px-4 py-2.5 rounded-lg text-xs font-semibold text-white bg-[#1d6fb8] hover:bg-[#175a94] disabled:bg-[#e5e7eb] disabled:text-[#9ca3af] transition-colors">
                                {buscandoVinculos ? 'Consultando…' : 'Ver vínculos atuais deste motorista'}
                            </button>
                            {vinculos && (
                                <span className="text-xs font-medium text-[#6b7280]">
                                    {vinculos.length === 0 ? 'Nenhum vínculo hoje.' : `${vinculos.length} vínculo(s) hoje.`}
                                </span>
                            )}
                        </div>

                        {!!vinculos?.length && (
                            <ul className="text-xs font-medium text-[#374151] bg-[#f9fafb] rounded-lg p-3 space-y-1">
                                {vinculos.map(v => <li key={v.id}>• {v.veiculo} — {v.motorista}</li>)}
                            </ul>
                        )}

                        <label className="flex items-start gap-2 cursor-pointer">
                            <input type="checkbox" checked={removerAnteriores}
                                onChange={e => { setRemoverAnteriores(e.target.checked); setConfirmouRemocao(false); }}
                                className="mt-0.5" />
                            <span className="text-xs font-medium text-[#374151]">
                                Remover os vínculos anteriores deste motorista
                                <span className="block text-[11px] font-normal text-[#6b7280]">
                                    Desmarcado, o novo vínculo é somado aos que já existem.
                                </span>
                            </span>
                        </label>

                        {removerAnteriores && (
                            <div className="bg-red-50 border-2 border-red-300 text-red-900 px-4 py-3 rounded-lg">
                                <p className="text-xs font-semibold flex items-start gap-2">
                                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" strokeWidth={1.75} />
                                    {vinculos === null
                                        ? 'Consulte os vínculos atuais antes — sem isso você não sabe o que vai apagar.'
                                        : vinculos.length === 0
                                            ? 'Este motorista não tem vínculo nenhum hoje, então nada será apagado.'
                                            : `Isto vai APAGAR os ${vinculos.length} vínculo(s) listados acima. Não tem desfazer.`}
                                </p>
                                {vinculos !== null && (
                                    <label className="flex items-center gap-2 mt-2 cursor-pointer">
                                        <input type="checkbox" checked={confirmouRemocao}
                                            onChange={e => setConfirmouRemocao(e.target.checked)} />
                                        <span className="text-xs font-semibold">Entendi, pode apagar</span>
                                    </label>
                                )}
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* ---- GRAVAR ---- */}
            <div className="flex flex-wrap items-center gap-4">
                <button onClick={() => setConfirmando(true)} disabled={!podeGravar}
                    className="px-6 py-3 rounded-lg text-sm font-semibold text-white bg-[#1d6fb8] hover:bg-[#175a94] disabled:bg-[#e5e7eb] disabled:text-[#9ca3af] disabled:cursor-not-allowed transition-colors flex items-center gap-2">
                    {gravando ? <><Loader2 className="w-4 h-4 animate-spin" /> Gravando…</> : <><Send className="w-4 h-4" strokeWidth={1.75} /> Gravar conjunto</>}
                </button>
                {!podeGravar && !gravando && (
                    <span className="text-xs font-medium text-amber-700">
                        {!principal.pronto ? 'Confira os campos críticos do veículo principal e defina o proprietário.'
                            : implementosUsados.some(p => !p.pronto) ? 'Um implemento está incompleto.'
                                : faltaMotorista.length ? `Faltam dados do motorista: ${faltaMotorista.slice(0, 4).join(', ')}${faltaMotorista.length > 4 ? '…' : ''}`
                                    : removerAnteriores && !confirmouRemocao ? 'Confirme a remoção dos vínculos anteriores.'
                                        : ''}
                    </span>
                )}
            </div>

            {/* ---- confirmação ---- */}
            {confirmando && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl p-6 max-w-lg w-full max-h-[85vh] overflow-auto">
                        <h3 className="text-base font-semibold text-[#111827] mb-1">Confirmar o conjunto</h3>
                        <p className="text-xs font-normal text-[#6b7280] mb-4">
                            Isto grava no Datamex, um passo de cada vez. Não há desfazer.
                        </p>
                        <dl className="text-sm space-y-2 mb-6">
                            <div className="flex justify-between gap-4">
                                <dt className="text-[#6b7280]">Motorista</dt>
                                <dd className="font-semibold text-right">
                                    {temMotorista ? `${cnh.nome} ${cnh.sobrenome}`.trim() || '—' : 'não será cadastrado'}
                                </dd>
                            </div>
                            <div className="flex justify-between gap-4">
                                <dt className="text-[#6b7280]">Veículo principal</dt>
                                <dd className="font-semibold text-right">
                                    {principal.placa} · {principal.categoriaNome}
                                    <span className="block font-normal text-xs text-[#6b7280]">dono: {descreverProprietario(principal.ref, nomeMotorista)}</span>
                                </dd>
                            </div>
                            {implementosUsados.map((p, i) => (
                                <div key={i} className="flex justify-between gap-4">
                                    <dt className="text-[#6b7280]">Implemento {i + 1}</dt>
                                    <dd className="font-semibold text-right">
                                        {p.placa} · {p.categoriaNome}
                                        <span className="block font-normal text-xs text-[#6b7280]">dono: {descreverProprietario(p.ref, nomeMotorista)}</span>
                                    </dd>
                                </div>
                            ))}
                            <div className="flex justify-between gap-4 border-t border-[#e5e7eb] pt-2">
                                <dt className="text-[#6b7280]">Vinculação</dt>
                                <dd className="font-semibold text-right">
                                    {!temMotorista ? 'pulada (sem motorista)'
                                        : removerAnteriores && confirmouRemocao
                                            ? `SUBSTITUI os ${vinculos?.length ?? 0} vínculos atuais`
                                            : 'somada aos vínculos existentes'}
                                </dd>
                            </div>
                        </dl>
                        <div className="flex gap-2 justify-end">
                            <button onClick={() => setConfirmando(false)}
                                className="px-4 py-2.5 rounded-lg text-xs font-semibold text-[#6b7280] hover:bg-[#f3f4f6]">Cancelar</button>
                            <button onClick={gravar}
                                className="px-4 py-2.5 rounded-lg text-xs font-semibold text-white bg-[#1d6fb8] hover:bg-[#175a94]">Gravar</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ---- resultado passo a passo ---- */}
            {passos && (
                <div className={`px-6 py-4 rounded-xl border ${concluido ? 'bg-emerald-50 border-emerald-300' : 'bg-red-50 border-red-300'}`}>
                    <p className={`text-sm font-semibold mb-2 ${concluido ? 'text-emerald-900' : 'text-red-900'}`}>
                        {concluido ? 'Conjunto gravado' : 'A gravação parou no meio'}
                    </p>
                    <ul className="space-y-1 mb-2">
                        {passos.map((p, i) => (
                            <li key={i} className="text-xs font-medium flex items-start gap-2">
                                {p.ok
                                    ? <CheckCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-emerald-600" strokeWidth={2} />
                                    : <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-red-600" strokeWidth={2} />}
                                <span>
                                    {p.passo}
                                    {p.codigo ? <strong> — código {p.codigo}</strong> : ''}
                                    {p.detalhe ? <span className="opacity-80"> ({p.detalhe})</span> : ''}
                                </span>
                            </li>
                        ))}
                    </ul>
                    {erroFinal && (
                        <p className="text-xs font-medium text-red-900 mt-2">
                            {erroFinal}
                            <span className="block mt-1 opacity-90">
                                O que está marcado com ✓ acima JÁ ESTÁ no Datamex e não foi desfeito —
                                não recadastre essas peças, resolva a partir daqui.
                            </span>
                        </p>
                    )}
                </div>
            )}
        </div>
    );
};

export default CadastroConjunto;
