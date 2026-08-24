import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle, Info, Loader2, Search, Send, Truck } from 'lucide-react';
import { extractDataFromDoc } from '../services/geminiService';
import UploadDocumento from './UploadDocumento';
import {
    CAMPOS_CRITICOS, CAPM3_POR_CARROCERIA, CampoCritico, ENQUADRAMENTOS,
    ResultadoVeiculo, TipoPessoa, VEICULO_VAZIO, VeiculoParaGravar,
    buscarPessoaJuridica, buscarProprietario, cadastrarPessoaJuridica,
    cadastrarVeiculo, formatarDocumento, formatarPlaca, placaValida,
    tipoDoDocumento,
} from '../services/cadastroVeiculo';
import {
    CRLV_VAZIO, DadosCRLV, Dominio, Escolha,
    carregarDominio, traduzirCrlv,
} from '../services/traducaoVeiculo';
import MunicipioAutocomplete, { useMunicipios } from './MunicipioAutocomplete';
import { resolverMunicipio } from '../utils/municipios';

// ============================================================================
// Cadastro Rápido — Veículo (Fase 3A).
//
// Anexa o CRLV -> a IA lê -> a tradução escolhe os códigos do Bsoft -> o
// operador CONFERE -> grava. Uma placa por vez, proprietário pessoa física.
//
// A conferência não é formalidade: os campos CRÍTICOS ficam bloqueados até o
// operador tocar em cada um. Sem isso dava para gravar direto o que a IA
// cuspiu, e é justamente o que a regra do módulo proíbe.
// ============================================================================

interface Props {
    autor: { id?: string; name?: string };
}

const soDigitos = (s: string) => (s || '').replace(/\D/g, '');
interface Proprietario {
    codPessoa: string;
    nome: string;
    tipo: TipoPessoa;
}

const CadastroVeiculo: React.FC<Props> = ({ autor: _autor }) => {
    const [dominio, setDominio] = useState<Dominio>([]);
    // Mesma base do autocomplete da cotação e do cadastro de motorista.
    const { lista: municipios } = useMunicipios();
    // Só para a tela avisar de onde veio o município — não vai para a API.
    const [municipioDoCrlv, setMunicipioDoCrlv] = useState(false);
    const [crlv, setCrlv] = useState<DadosCRLV>(CRLV_VAZIO);
    const [form, setForm] = useState<VeiculoParaGravar>(VEICULO_VAZIO);
    const [opcoes, setOpcoes] = useState<Record<string, Escolha>>({});
    const [lendo, setLendo] = useState(false);
    const [leu, setLeu] = useState(false);
    const [erroLeitura, setErroLeitura] = useState<string | null>(null);

    // Cada crítico só sai da lista quando o operador encosta nele.
    const [conferidos, setConferidos] = useState<Set<CampoCritico>>(new Set());

    const [docProp, setDocProp] = useState('');
    const [buscandoProp, setBuscandoProp] = useState(false);
    const [proprietario, setProprietario] = useState<Proprietario | null>(null);
    const [erroProp, setErroProp] = useState<string | null>(null);
    // PJ não encontrada: abre o mini-cadastro em vez de travar o operador.
    const [pjNova, setPjNova] = useState<{ razaoSocial: string; nomeFantasia: string; rntrc: string; enquadramento: string } | null>(null);
    const [criandoPj, setCriandoPj] = useState(false);

    const tipoProp: TipoPessoa = tipoDoDocumento(docProp);

    const [confirmando, setConfirmando] = useState(false);
    const [gravando, setGravando] = useState(false);
    const [resultado, setResultado] = useState<ResultadoVeiculo | null>(null);

    useEffect(() => {
        carregarDominio().then(setDominio).catch(() => setDominio([]));
    }, []);

    const listaDe = (tipo: string) =>
        dominio.filter(d => d.tipo === tipo).map(d => ({ codigo: d.codigo, rotulo: d.nome }));

    const marcasDaCategoria = useMemo(() => {
        const cat = dominio.find(d => d.tipo === 'categoria' && d.codigo === form.categoriaVeiculo);
        if (!cat) return [];
        return dominio
            .filter(d => d.tipo === 'marca' && (d.categoria_ref || '').toUpperCase() === cat.nome.toUpperCase())
            .map(d => ({ codigo: d.codigo, rotulo: d.nome }));
    }, [dominio, form.categoriaVeiculo]);

    /** O form guarda o código IBGE; a tela precisa do município para exibir. */
    const municipioEscolhido = useMemo(
        () => municipios.find(m => String(m.codigo) === String(form.cidade)) ?? null,
        [municipios, form.cidade],
    );

    const setCampo = (k: keyof VeiculoParaGravar, v: string) => {
        setForm(prev => ({ ...prev, [k]: v }));
        setResultado(null);
        if ((CAMPOS_CRITICOS as readonly string[]).includes(k)) {
            setConferidos(prev => new Set(prev).add(k as CampoCritico));
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
            const ocr = await extractDataFromDoc(base64, file.type);
            if (!ocr || ocr.error) {
                setErroLeitura(ocr?.error || 'A leitura não retornou nada.');
                return;
            }
            const b = ocr as Record<string, unknown>;
            const t = (...k: string[]) => {
                for (const x of k) {
                    const v = b[x];
                    if (v !== null && v !== undefined && String(v).trim()) return String(v).trim();
                }
                return '';
            };
            const lido: DadosCRLV = {
                tipo_documento: t('tipo_documento'),
                placa: t('placa'), renavam: t('renavam'), chassi: t('chassi'), cor: t('cor'),
                ano_fabricacao: t('ano_fabricacao', 'ano_fab'), ano_modelo: t('ano_modelo', 'ano_mod'),
                marca_texto: t('marca_texto', 'marca'), modelo: t('modelo'),
                especie_texto: t('especie_texto'), tipo_veiculo_inferido: t('tipo_veiculo_inferido'),
                carroceria_texto: t('carroceria_texto'), local_texto: t('local_texto'),
                tara: t('tara'), capacidade_carga: t('capacidade_carga'), eixos: t('eixos'),
            };
            if (lido.tipo_documento && lido.tipo_documento.toUpperCase() !== 'CRLV') {
                setErroLeitura(`O documento parece ser ${lido.tipo_documento}, não um CRLV. Confira o arquivo.`);
            }
            setCrlv(lido);

            const tr = traduzirCrlv(dominio, lido);
            setOpcoes({
                categoria: tr.categoria, marca: tr.marca, cor: tr.cor,
                carroceria: tr.carroceria, rodado: tr.rodado,
            });
            // O LOCAL do CRLV ("VITORIA ES") vira código IBGE pela MESMA função que
            // promove município em cotação antiga. Ela devolve null de propósito
            // quando o texto é ambíguo — nesse caso o campo fica vazio e o
            // operador escolhe, em vez de gravar um município no chute.
            const mun = lido.local_texto ? resolverMunicipio(municipios, lido.local_texto) : null;
            setMunicipioDoCrlv(!!mun);

            // O CRLV traz o dono: já preenche o campo e limpa qualquer busca
            // anterior, para o operador não vincular o proprietário do veículo
            // que estava na tela antes.
            setDocProp(lido.proprietario_documento ? formatarDocumento(lido.proprietario_documento) : '');
            setProprietario(null); setPjNova(null); setErroProp(null);

            const capSugerido = CAPM3_POR_CARROCERIA[tr.carroceria.codigo];
            setForm(prev => ({
                ...prev,
                descricao: `${tr.marca.rotulo} ${lido.modelo}`.trim(),
                placa: formatarPlaca(lido.placa),
                chassi: lido.chassi.toUpperCase(),
                renavam: soDigitos(lido.renavam),
                anoModelo: lido.ano_modelo, anoFabricacao: lido.ano_fabricacao,
                cor: tr.cor.codigo,
                categoriaVeiculo: tr.categoria.codigo,
                marcaVeiculo: tr.marca.codigo,
                tipoCarroceria: tr.carroceria.codigo,
                tipoRodado: tr.rodado.codigo,
                tara: lido.tara, capacidadeCarga: lido.capacidade_carga,
                quantidadeEixos: lido.eixos,
                cidade: mun ? String(mun.codigo) : '',
                estado: mun ? mun.uf : '',
                // Vazio quando a carroceria não casou: chutar volume é pior.
                capM3: capSugerido ? String(capSugerido) : '',
            }));
            // Leitura nova zera a conferência — o operador revê tudo de novo.
            setConferidos(new Set());
            setLeu(true);
        } catch (err) {
            setErroLeitura((err as Error).message);
        } finally {
            setLendo(false);
            e.target.value = '';
        }
    };

    /**
     * Uma busca só para os dois casos. O DOCUMENTO decide o caminho — 11 dígitos
     * vão para pessoas físicas, 14 para jurídicas. O operador não escolhe tipo,
     * então não tem como escolher errado.
     */
    const procurarProprietario = async () => {
        const d = soDigitos(docProp);
        setErroProp(null); setProprietario(null); setPjNova(null); setResultado(null);

        if (tipoProp === 'indefinido') {
            setErroProp('Documento incompleto: são 11 dígitos para CPF ou 14 para CNPJ.');
            return;
        }
        setBuscandoProp(true);
        try {
            if (tipoProp === 'fisica') {
                const r = await buscarProprietario(d);
                if (r.error) { setErroProp(r.error); return; }
                if (!r.codPessoa) {
                    setErroProp(
                        'Não existe pessoa com esse CPF no Datamex. Cadastre primeiro em ' +
                        'Cadastro Rápido · Motorista, marcando "é o dono do veículo".',
                    );
                    return;
                }
                setProprietario({ codPessoa: r.codPessoa, nome: r.nome || '', tipo: 'fisica' });
                setCampo('proprietarioId', r.codPessoa);
                return;
            }

            const r = await buscarPessoaJuridica(d);
            if (r.error) { setErroProp(r.error); return; }
            if (!r.existe || !r.codPessoa) {
                // Empresa nova: o mini-cadastro já vem com o que o CRLV deu.
                setPjNova({
                    razaoSocial: crlv.proprietario_nome || '',
                    nomeFantasia: crlv.proprietario_nome || '',
                    rntrc: '', enquadramento: '',
                });
                return;
            }
            setProprietario({ codPessoa: r.codPessoa, nome: r.razaoSocial || r.nomeFantasia || '', tipo: 'juridica' });
            setCampo('proprietarioId', r.codPessoa);
        } finally {
            setBuscandoProp(false);
        }
    };

    /** Cria a empresa proprietária e já a vincula ao veículo. */
    const criarPj = async () => {
        if (!pjNova) return;
        setCriandoPj(true); setErroProp(null);
        try {
            const r = await cadastrarPessoaJuridica({
                cnpj: soDigitos(docProp),
                razaoSocial: pjNova.razaoSocial,
                nomeFantasia: pjNova.nomeFantasia,
                rntrc: pjNova.rntrc,
                enquadramento: pjNova.enquadramento,
            });
            if (r.error) { setErroProp(r.error); return; }
            if (!r.codPessoa) { setErroProp('O Datamex não devolveu o código da empresa.'); return; }
            setProprietario({ codPessoa: r.codPessoa, nome: r.razaoSocial || pjNova.razaoSocial, tipo: 'juridica' });
            setCampo('proprietarioId', r.codPessoa);
            setPjNova(null);
            if (r.aviso) setErroProp(r.aviso);
        } finally {
            setCriandoPj(false);
        }
    };

    const criticosPendentes = CAMPOS_CRITICOS.filter(c => !conferidos.has(c));
    const faltaPreencher = [
        !placaValida(form.placa) && 'placa válida',
        !form.categoriaVeiculo && 'categoria',
        !form.tipoCarroceria && 'carroceria',
        !(Number(form.capM3) > 0) && 'capacidade em m³ maior que zero',
        !form.proprietarioId && 'proprietário',
    ].filter(Boolean) as string[];

    const podeGravar = !faltaPreencher.length && !criticosPendentes.length && !gravando;

    const gravar = async () => {
        setGravando(true); setConfirmando(false);
        try {
            const r = await cadastrarVeiculo(form);
            setResultado(r);
            if (!r.error) {
                setForm(VEICULO_VAZIO); setCrlv(CRLV_VAZIO); setOpcoes({});
                setConferidos(new Set()); setLeu(false); setMunicipioDoCrlv(false);
                setProprietario(null); setDocProp(''); setPjNova(null);
            }
        } finally {
            setGravando(false);
        }
    };

    // ---- pedaços de UI ----------------------------------------------------

    const rotuloCritico = (texto: string, chave: CampoCritico) => (
        <label className="text-[10px] font-medium uppercase text-[#92400e] mb-1.5 flex items-center gap-1.5">
            {texto}<span className="text-red-500">*</span>
            {!conferidos.has(chave) && (
                <span className="normal-case text-[9px] font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                    confira
                </span>
            )}
        </label>
    );

    const classeCritica = (chave: CampoCritico, ok = true) =>
        `w-full px-3 py-2.5 rounded-lg text-sm font-semibold outline-none border-2 transition-colors ${!ok
            ? 'bg-red-50 border-red-400 focus:border-red-500'
            : conferidos.has(chave)
                ? 'bg-white border-emerald-300 focus:border-emerald-500'
                : 'bg-amber-50 border-amber-400 focus:border-amber-500'}`;

    const classeNormal =
        'w-full px-3 py-2.5 rounded-lg text-sm font-medium outline-none border bg-[#f9fafb] border-[#e5e7eb] focus:border-[#1d6fb8] transition-colors';

    const Seletor: React.FC<{
        valor: string; onChange: (v: string) => void;
        lista: Array<{ codigo: string; rotulo: string }>; className: string;
    }> = ({ valor, onChange, lista, className }) => (
        <select value={valor} onChange={e => onChange(e.target.value)} className={className}>
            <option value="">— selecione —</option>
            {lista.map(o => <option key={o.codigo} value={o.codigo}>{o.rotulo}</option>)}
        </select>
    );

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3">
                <div className="p-2.5 bg-[#1d6fb8] rounded-lg text-white"><Truck className="w-5 h-5" strokeWidth={1.75} /></div>
                <div>
                    <h2 className="text-lg font-medium text-[#111827]">Cadastro Rápido — Veículo</h2>
                    <p className="text-sm font-normal text-[#6b7280]">Anexe o CRLV, confira o que foi lido e cadastre no Datamex.</p>
                </div>
            </div>

            {/* 1 — anexo */}
            <div className="bg-white border border-[#e5e7eb] rounded-xl p-6 flex flex-wrap items-center gap-4">
                <UploadDocumento label="CRLV" anexado={leu} carregando={lendo} onSelect={aoAnexar} />
                <span className="text-xs font-normal text-[#6b7280]">
                    {lendo ? 'Lendo o documento…' : leu ? 'Documento lido. Confira os campos abaixo.' : 'Imagem ou PDF do CRLV.'}
                </span>
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

            {/* 2 — críticos */}
            <div className="bg-white border-2 border-amber-300 rounded-xl p-6">
                <div className="flex items-center gap-2 mb-4">
                    <AlertTriangle className="w-4 h-4 text-amber-600" strokeWidth={1.75} />
                    <p className="text-xs font-semibold text-[#92400e]">
                        Confira estes cinco campos um a um — são os de maior impacto e os que a leitura
                        automática mais erra. O botão de gravar só libera depois que você passar por todos.
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div className="flex flex-col">
                        {rotuloCritico('Placa', 'placa')}
                        <input
                            value={form.placa}
                            onChange={e => setCampo('placa', formatarPlaca(e.target.value))}
                            placeholder="ABC-1234"
                            className={classeCritica('placa', !form.placa || placaValida(form.placa))}
                        />
                        {form.placa && !placaValida(form.placa) && (
                            <p className="text-[10px] font-medium text-red-600 mt-1">
                                Formato inválido. Use ABC-1234 ou ABC-1D23.
                            </p>
                        )}
                    </div>

                    <div className="flex flex-col">
                        {rotuloCritico('Chassi', 'chassi')}
                        <input
                            value={form.chassi}
                            onChange={e => setCampo('chassi', e.target.value.toUpperCase())}
                            placeholder="17 caracteres"
                            className={classeCritica('chassi')}
                        />
                    </div>

                    <div className="flex flex-col">
                        {rotuloCritico('Capacidade m³', 'capM3')}
                        <input
                            type="number" min={1}
                            value={form.capM3}
                            onChange={e => setCampo('capM3', e.target.value)}
                            className={classeCritica('capM3', !form.capM3 || Number(form.capM3) > 0)}
                        />
                        <p className="text-[10px] font-normal text-[#92400e] mt-1">
                            {form.capM3 ? 'Valor sugerido, confira antes de gravar.' : 'Sem sugestão para esta carroceria — preencha.'}
                        </p>
                    </div>

                    <div className="flex flex-col">
                        {rotuloCritico('Categoria', 'categoriaVeiculo')}
                        <Seletor
                            valor={form.categoriaVeiculo}
                            onChange={v => { setCampo('categoriaVeiculo', v); setCampo('marcaVeiculo', ''); }}
                            lista={listaDe('categoria')}
                            className={classeCritica('categoriaVeiculo')}
                        />
                        {opcoes.categoria?.origem === 'nao_resolvido' && leu && (
                            <p className="text-[10px] font-medium text-amber-700 mt-1">A leitura não definiu — escolha.</p>
                        )}
                    </div>

                    <div className="flex flex-col">
                        {rotuloCritico('Carroceria', 'tipoCarroceria')}
                        <Seletor
                            valor={form.tipoCarroceria}
                            onChange={v => {
                                setCampo('tipoCarroceria', v);
                                const s = CAPM3_POR_CARROCERIA[v];
                                if (s) setForm(prev => ({ ...prev, capM3: String(s) }));
                            }}
                            lista={listaDe('tipoCarroceria')}
                            className={classeCritica('tipoCarroceria')}
                        />
                    </div>
                </div>
            </div>

            {/* 3 — demais campos */}
            <div className="bg-white border border-[#e5e7eb] rounded-xl p-6">
                <div className="flex items-center gap-2 mb-4">
                    <Info className="w-4 h-4 text-[#6b7280]" strokeWidth={1.75} />
                    <p className="text-xs font-medium text-[#6b7280]">
                        Preenchidos pela leitura do CRLV. Todos editáveis.
                    </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="flex flex-col">
                        <label className="text-[10px] font-medium uppercase text-[#6b7280] mb-1.5">Marca</label>
                        <Seletor valor={form.marcaVeiculo} onChange={v => setCampo('marcaVeiculo', v)}
                            lista={marcasDaCategoria} className={classeNormal} />
                    </div>
                    <div className="flex flex-col">
                        <label className="text-[10px] font-medium uppercase text-[#6b7280] mb-1.5">Cor</label>
                        <Seletor valor={form.cor} onChange={v => setCampo('cor', v)}
                            lista={listaDe('cor')} className={classeNormal} />
                    </div>
                    <div className="flex flex-col">
                        <label className="text-[10px] font-medium uppercase text-[#6b7280] mb-1.5">Rodado</label>
                        <Seletor valor={form.tipoRodado} onChange={v => setCampo('tipoRodado', v)}
                            lista={listaDe('tipoRodado')} className={classeNormal} />
                    </div>
                    <div className="flex flex-col">
                        <label className="text-[10px] font-medium uppercase text-[#6b7280] mb-1.5">Grupo</label>
                        <Seletor valor={form.grupoVeiculo} onChange={v => setCampo('grupoVeiculo', v)}
                            lista={listaDe('grupo')} className={classeNormal} />
                    </div>

                    {([
                        { k: 'renavam' as const, label: 'Renavam' },
                        { k: 'anoFabricacao' as const, label: 'Ano fabricação' },
                        { k: 'anoModelo' as const, label: 'Ano modelo' },
                        { k: 'tara' as const, label: 'Tara (kg)' },
                        { k: 'capacidadeCarga' as const, label: 'Capacidade de carga (kg)' },
                        { k: 'quantidadeEixos' as const, label: 'Eixos' },
                    ]).map(({ k, label }) => (
                        <div key={k} className="flex flex-col">
                            <label className="text-[10px] font-medium uppercase text-[#6b7280] mb-1.5">{label}</label>
                            <input value={form[k]} onChange={e => setCampo(k, e.target.value)} className={classeNormal} />
                        </div>
                    ))}

                    <div className="flex flex-col md:col-span-2">
                        <label className="text-[10px] font-medium uppercase text-[#6b7280] mb-1.5">
                            Município / UF
                            {municipioDoCrlv && (
                                <span className="ml-1 normal-case text-[#b45309] font-semibold">
                                    · puxado do CRLV, confira
                                </span>
                            )}
                        </label>
                        <MunicipioAutocomplete
                            valor={municipioEscolhido?.rotulo ?? ''}
                            lista={municipios}
                            resolvido={municipioEscolhido}
                            onSelecionar={m => {
                                setCampo('cidade', String(m.codigo));
                                setCampo('estado', m.uf);
                                setMunicipioDoCrlv(false);   // escolha do operador manda
                            }}
                            placeholder="Município de registro do veículo"
                        />
                        {leu && !municipioEscolhido && (
                            <p className="text-[10px] font-medium text-amber-700 mt-1">
                                O CRLV não trouxe um município que eu conseguisse identificar com
                                segurança. Escolha na lista.
                            </p>
                        )}
                    </div>

                    <div className="flex flex-col md:col-span-2">
                        <label className="text-[10px] font-medium uppercase text-[#6b7280] mb-1.5">Descrição</label>
                        <input value={form.descricao} onChange={e => setCampo('descricao', e.target.value)} className={classeNormal} />
                    </div>
                </div>
            </div>

            {/* 4 — proprietário: um caminho só, o documento decide */}
            <div className="bg-white border border-[#e5e7eb] rounded-xl p-6">
                <p className="text-xs font-medium text-[#6b7280] mb-4">
                    Proprietário do veículo. O documento define o caminho: 11 dígitos é pessoa
                    física, 14 é empresa. Vem do CRLV, mas você pode trocar.
                </p>
                <div className="flex flex-wrap items-end gap-3">
                    <div className="flex flex-col">
                        <label className="text-[10px] font-medium uppercase text-[#6b7280] mb-1.5">
                            CPF ou CNPJ<span className="text-red-500 ml-0.5">*</span>
                            {tipoProp !== 'indefinido' && (
                                <span className="ml-1 normal-case text-[#1d6fb8] font-semibold">
                                    · {tipoProp === 'fisica' ? 'pessoa física' : 'empresa'}
                                </span>
                            )}
                        </label>
                        <input
                            value={docProp}
                            onChange={e => {
                                setDocProp(formatarDocumento(e.target.value));
                                setProprietario(null); setPjNova(null);
                            }}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); procurarProprietario(); } }}
                            placeholder="CPF ou CNPJ"
                            className={`w-60 px-3 py-2.5 rounded-lg text-sm font-semibold outline-none border transition-colors ${proprietario
                                ? 'bg-[#f9fafb] border-[#e5e7eb] focus:border-[#1d6fb8]'
                                : 'bg-amber-50 border-amber-300 focus:border-amber-500'}`}
                        />
                    </div>
                    <button
                        type="button" onClick={procurarProprietario}
                        disabled={buscandoProp || tipoProp === 'indefinido'}
                        className="px-4 py-2.5 rounded-lg text-xs font-semibold text-white bg-[#1d6fb8] hover:bg-[#175a94] disabled:bg-[#e5e7eb] disabled:text-[#9ca3af] disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                    >
                        {buscandoProp ? <><Loader2 className="w-4 h-4 animate-spin" /> Buscando…</> : <><Search className="w-4 h-4" strokeWidth={1.75} /> Buscar</>}
                    </button>
                </div>

                {/* Achou: o operador confirma que é quem devia ser. */}
                {proprietario && (
                    <div className="mt-4 bg-emerald-50 border border-emerald-300 text-emerald-900 px-4 py-3 rounded-lg flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" strokeWidth={1.75} />
                        <div>
                            <p className="text-xs font-semibold">
                                Proprietário encontrado · {proprietario.tipo === 'juridica' ? 'empresa' : 'pessoa física'}
                            </p>
                            <p className="text-xs font-medium opacity-90 mt-0.5">
                                {proprietario.nome} — código {proprietario.codPessoa}. Confira se é mesmo quem
                                deve constar como dono do veículo.
                            </p>
                        </div>
                    </div>
                )}

                {/* Não achou a empresa: cadastra na hora, sem sair da tela. */}
                {pjNova && (
                    <div className="mt-4 border-2 border-amber-300 rounded-lg p-4 bg-amber-50/40">
                        <p className="text-xs font-semibold text-[#92400e] mb-3">
                            Empresa não encontrada no Datamex. Preencha para cadastrá-la como proprietária.
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div className="flex flex-col">
                                <label className="text-[10px] font-medium uppercase text-[#6b7280] mb-1.5">
                                    Razão social<span className="text-red-500 ml-0.5">*</span>
                                </label>
                                <input value={pjNova.razaoSocial}
                                    onChange={e => setPjNova({ ...pjNova, razaoSocial: e.target.value })}
                                    className={classeNormal} />
                            </div>
                            <div className="flex flex-col">
                                <label className="text-[10px] font-medium uppercase text-[#6b7280] mb-1.5">
                                    Nome fantasia<span className="text-red-500 ml-0.5">*</span>
                                </label>
                                <input value={pjNova.nomeFantasia}
                                    onChange={e => setPjNova({ ...pjNova, nomeFantasia: e.target.value })}
                                    className={classeNormal} />
                            </div>
                            <div className="flex flex-col">
                                <label className="text-[10px] font-medium uppercase text-[#92400e] mb-1.5">
                                    RNTRC<span className="text-red-500 ml-0.5">*</span>
                                </label>
                                <input value={pjNova.rntrc}
                                    onChange={e => setPjNova({ ...pjNova, rntrc: e.target.value })}
                                    placeholder="RNTRC do proprietário"
                                    className={`w-full px-3 py-2.5 rounded-lg text-sm font-semibold outline-none border-2 transition-colors ${pjNova.rntrc
                                        ? 'bg-white border-emerald-300 focus:border-emerald-500'
                                        : 'bg-amber-50 border-amber-400 focus:border-amber-500'}`} />
                                <p className="text-[10px] font-medium text-[#92400e] mt-1">
                                    O RNTRC não vem no CRLV, digite o do proprietário. Sem ele o cadastro não grava.
                                </p>
                            </div>
                            <div className="flex flex-col">
                                <label className="text-[10px] font-medium uppercase text-[#6b7280] mb-1.5">Enquadramento</label>
                                <select value={pjNova.enquadramento}
                                    onChange={e => setPjNova({ ...pjNova, enquadramento: e.target.value })}
                                    className={classeNormal}>
                                    {ENQUADRAMENTOS.map(o => <option key={o.valor} value={o.valor}>{o.label}</option>)}
                                </select>
                            </div>
                        </div>
                        <button
                            type="button" onClick={criarPj}
                            disabled={criandoPj || !pjNova.razaoSocial.trim() || !pjNova.nomeFantasia.trim() || !pjNova.rntrc.trim()}
                            className="mt-3 px-4 py-2.5 rounded-lg text-xs font-semibold text-white bg-[#1d6fb8] hover:bg-[#175a94] disabled:bg-[#e5e7eb] disabled:text-[#9ca3af] disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                        >
                            {criandoPj ? <><Loader2 className="w-4 h-4 animate-spin" /> Cadastrando…</> : 'Cadastrar empresa e vincular'}
                        </button>
                    </div>
                )}

                {erroProp && (
                    <div className="mt-3 bg-amber-50 border border-amber-300 text-amber-900 px-4 py-2.5 rounded-lg flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" strokeWidth={1.75} />
                        <p className="text-xs font-medium">{erroProp}</p>
                    </div>
                )}
            </div>

            {/* 5 — gravar */}
            <div className="flex flex-wrap items-center gap-4">
                <button
                    onClick={() => setConfirmando(true)}
                    disabled={!podeGravar}
                    className="px-6 py-3 rounded-lg text-sm font-semibold text-white bg-[#1d6fb8] hover:bg-[#175a94] disabled:bg-[#e5e7eb] disabled:text-[#9ca3af] disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                >
                    {gravando ? <><Loader2 className="w-4 h-4 animate-spin" /> Gravando…</> : <><Send className="w-4 h-4" strokeWidth={1.75} /> Cadastrar veículo no Datamex</>}
                </button>
                {!!criticosPendentes.length && (
                    <span className="text-xs font-medium text-amber-700">
                        Falta conferir: {criticosPendentes.map(c => ({
                            placa: 'placa', chassi: 'chassi', capM3: 'capacidade m³',
                            categoriaVeiculo: 'categoria', tipoCarroceria: 'carroceria',
                        } as Record<string, string>)[c]).join(', ')}
                    </span>
                )}
                {!criticosPendentes.length && !!faltaPreencher.length && (
                    <span className="text-xs font-medium text-amber-700">Falta: {faltaPreencher.join(', ')}</span>
                )}
            </div>

            {/* Honestidade sobre o que vai gravado sem o operador ver. */}
            <p className="text-[11px] font-normal text-[#9ca3af]">
                Tipo de equipamento gravado sem classificação (padrão do sistema). A classificação
                detalhada pode ser adicionada depois.
            </p>

            {/* 6 — confirmação */}
            {confirmando && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl p-6 max-w-md w-full">
                        <h3 className="text-base font-semibold text-[#111827] mb-1">Confirmar cadastro</h3>
                        <p className="text-xs font-normal text-[#6b7280] mb-4">Isso cria o veículo no Datamex. Confira:</p>
                        <dl className="text-sm space-y-1.5 mb-6">
                            {([
                                ['Placa', form.placa],
                                ['Categoria', listaDe('categoria').find(c => c.codigo === form.categoriaVeiculo)?.rotulo ?? '—'],
                                ['Proprietário', proprietario ? `${proprietario.nome} (${proprietario.codPessoa})` : '—'],
                                ['Capacidade m³', form.capM3],
                            ] as Array<[string, string]>).map(([k, v]) => (
                                <div key={k} className="flex justify-between gap-4">
                                    <dt className="text-[#6b7280] font-normal">{k}</dt>
                                    <dd className="font-semibold text-[#111827] text-right">{v}</dd>
                                </div>
                            ))}
                        </dl>
                        <div className="flex gap-2 justify-end">
                            <button onClick={() => setConfirmando(false)}
                                className="px-4 py-2.5 rounded-lg text-xs font-semibold text-[#6b7280] hover:bg-[#f3f4f6]">
                                Cancelar
                            </button>
                            <button onClick={gravar}
                                className="px-4 py-2.5 rounded-lg text-xs font-semibold text-white bg-[#1d6fb8] hover:bg-[#175a94]">
                                Cadastrar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 7 — resultado */}
            {resultado && (
                resultado.error ? (
                    <div className="bg-red-50 border border-red-300 text-red-900 px-6 py-4 rounded-xl flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-red-600" strokeWidth={1.75} />
                        <div>
                            <p className="text-sm font-semibold">
                                {resultado.jaExistia ? 'Veículo já cadastrado' : 'Não foi cadastrado'}
                            </p>
                            <p className="text-xs font-medium opacity-90 mt-0.5">{resultado.error}</p>
                            {/* Não dá para checar o grupo por API (write-only), então
                                quando a recusa cheira a isso, apontamos o caminho. */}
                            {/grupo|propriet/i.test(resultado.error || '') && (
                                <p className="text-xs font-medium mt-1.5">
                                    Verifique se o proprietário está no grupo “Proprietários Veículos”
                                    no Datamex — isso não dá para conferir por aqui.
                                </p>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="bg-emerald-50 border border-emerald-300 text-emerald-900 px-6 py-4 rounded-xl flex items-start gap-3">
                        <CheckCircle className="w-5 h-5 shrink-0 mt-0.5 text-emerald-600" strokeWidth={1.75} />
                        <div>
                            <p className="text-sm font-semibold">Veículo cadastrado no Datamex</p>
                            <p className="text-xs font-medium opacity-90 mt-0.5">
                                Código do veículo: <strong>{resultado.codVeiculo}</strong>
                                {resultado.placa ? ` · placa ${resultado.placa}` : ''}
                            </p>
                        </div>
                    </div>
                )
            )}
        </div>
    );
};

export default CadastroVeiculo;
