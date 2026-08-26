import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle, Loader2, Search } from 'lucide-react';
import { extractDataFromDoc } from '../services/geminiService';
import UploadDocumento from './UploadDocumento';
import MunicipioAutocomplete, { useMunicipios } from './MunicipioAutocomplete';
import { resolverMunicipio } from '../utils/municipios';
import {
    CAMPOS_CRITICOS, CAPM3_POR_CARROCERIA, CampoCritico, ENQUADRAMENTOS,
    TipoPessoa, VEICULO_VAZIO, VeiculoParaGravar, buscarPessoaJuridica,
    buscarProprietario, cadastrarPessoaJuridica, formatarDocumento,
    formatarPlaca, placaValida, tipoDoDocumento,
} from '../services/cadastroVeiculo';
import {
    CRLV_VAZIO, DadosCRLV, Dominio, carregarDominio, traduzirCrlv,
} from '../services/traducaoVeiculo';
import { RefProprietario } from '../services/conjunto';

// ============================================================================
// BlocoVeiculoCRLV — uma peça do conjunto: um CRLV + o proprietário dela.
//
// Existe porque no conjunto o mesmo bloco se repete (cavalo, carreta 1,
// carreta 2) e cada peça tem PROPRIETÁRIO PRÓPRIO — a carreta pode ser de um
// terceiro que não é nem o motorista nem o dono do cavalo.
//
// O dono que vem no CRLV é o dono LEGAL. Quem responde pela operação perante a
// ANTT pode ser outro, e é por isso que ele entra como SUGESTÃO e o operador
// pode trocar. Essa distinção é do negócio, não da API.
// ============================================================================

export interface EstadoPeca {
    form: VeiculoParaGravar;
    placa: string;
    categoriaNome: string;
    /** Críticos conferidos e um dono DEFINIDO (que pode ainda não existir). */
    pronto: boolean;
    /** Nada anexado nem digitado — peça opcional que o operador não usou. */
    vazio: boolean;
    /** O dono: motorista desta tela, alguém existente, ou empresa a criar. */
    ref: RefProprietario | null;
}

interface Props {
    titulo: string;
    subtitulo?: string;
    /** Peça opcional (implemento) mostra que pode ficar em branco. */
    opcional?: boolean;
    /**
     * Quando o motorista da tela foi marcado como dono, esta peça pode apontar
     * para ele sem busca nenhuma — ele ainda nem existe no Datamex.
     */
    motoristaEhDono?: boolean;
    nomeMotorista?: string;
    /** Peça principal já nasce apontando para o motorista, quando ele é o dono. */
    assumirMotorista?: boolean;
    onChange: (e: EstadoPeca) => void;
}

const soDigitos = (s: string) => (s || '').replace(/\D/g, '');

const BlocoVeiculoCRLV: React.FC<Props> = ({
    titulo, subtitulo, opcional, motoristaEhDono, nomeMotorista, assumirMotorista, onChange,
}) => {
    const [dominio, setDominio] = useState<Dominio>([]);
    const { lista: municipios } = useMunicipios();

    const [crlv, setCrlv] = useState<DadosCRLV>(CRLV_VAZIO);
    const [form, setForm] = useState<VeiculoParaGravar>(VEICULO_VAZIO);
    const [lendo, setLendo] = useState(false);
    const [leu, setLeu] = useState(false);
    const [erroLeitura, setErroLeitura] = useState<string | null>(null);
    const [conferidos, setConferidos] = useState<Set<CampoCritico>>(new Set());
    const [municipioDoCrlv, setMunicipioDoCrlv] = useState(false);

    const [docProp, setDocProp] = useState('');
    const [buscandoProp, setBuscandoProp] = useState(false);
    const [proprietario, setProprietario] = useState<{ codPessoa: string; nome: string; tipo: TipoPessoa } | null>(null);
    /**
     * Quem é o dono. Começa apontando para o motorista quando ele foi marcado
     * como proprietário — nesse caso não há o que buscar: ele está sendo criado
     * nesta mesma tela e ainda não tem código.
     */
    const [ref, setRef] = useState<RefProprietario | null>(assumirMotorista ? { tipo: 'motorista' } : null);
    const [querTrocarDono, setQuerTrocarDono] = useState(false);
    const [erroProp, setErroProp] = useState<string | null>(null);
    const [trocando, setTrocando] = useState(false);
    const [pjNova, setPjNova] = useState<{ razaoSocial: string; nomeFantasia: string; rntrc: string; enquadramento: string } | null>(null);

    useEffect(() => { carregarDominio().then(setDominio).catch(() => setDominio([])); }, []);

    // O pai ligou/desligou "motorista é o dono" e esta peça ainda não teve o
    // dono escolhido à mão: acompanha, sem sobrescrever decisão do operador.
    useEffect(() => {
        if (querTrocarDono) return;
        if (assumirMotorista) setRef({ tipo: 'motorista' });
        else if (ref?.tipo === 'motorista') setRef(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [assumirMotorista, querTrocarDono]);

    const listaDe = (tipo: string) =>
        dominio.filter(d => d.tipo === tipo).map(d => ({ codigo: d.codigo, rotulo: d.nome }));

    const categoriaNome = useMemo(
        () => dominio.find(d => d.tipo === 'categoria' && d.codigo === form.categoriaVeiculo)?.nome ?? '',
        [dominio, form.categoriaVeiculo],
    );

    const marcasDaCategoria = useMemo(() => {
        if (!categoriaNome) return [];
        return dominio
            .filter(d => d.tipo === 'marca' && (d.categoria_ref || '').toUpperCase() === categoriaNome.toUpperCase())
            .map(d => ({ codigo: d.codigo, rotulo: d.nome }));
    }, [dominio, categoriaNome]);

    const municipioEscolhido = useMemo(
        () => municipios.find(m => String(m.codigo) === String(form.cidade)) ?? null,
        [municipios, form.cidade],
    );

    // Avisa o pai sempre que o estado relevante muda.
    useEffect(() => {
        const vazio = !leu && !form.placa && !docProp;
        const criticosOk = CAMPOS_CRITICOS.every(c => conferidos.has(c));
        // Basta o dono estar DEFINIDO. Empresa nova conta como definida assim
        // que os campos obrigatórios dela estão preenchidos — ela é criada na
        // cascata, no fim. Exigir que já existisse era o que travava a tela.
        const donoOk = ref !== null && (ref.tipo !== 'novaPJ'
            || (!!ref.razaoSocial.trim() && !!ref.nomeFantasia.trim() && !!ref.rntrc.trim()));
        const camposOk = placaValida(form.placa) && !!form.categoriaVeiculo
            && !!form.tipoCarroceria && Number(form.capM3) > 0;
        onChange({
            form, placa: form.placa, categoriaNome,
            pronto: criticosOk && camposOk && donoOk,
            vazio, ref,
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [form, conferidos, leu, docProp, categoriaNome, ref]);

    const setCampo = (k: keyof VeiculoParaGravar, v: string) => {
        setForm(prev => ({ ...prev, [k]: v }));
        if ((CAMPOS_CRITICOS as readonly string[]).includes(k)) {
            setConferidos(prev => new Set(prev).add(k as CampoCritico));
        }
    };

    const aoAnexar = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setLendo(true); setErroLeitura(null);
        try {
            const dataUrl = await new Promise<string>((res, rej) => {
                const r = new FileReader();
                r.onload = () => res(r.result as string);
                r.onerror = () => rej(new Error('Não consegui ler o arquivo.'));
                r.readAsDataURL(file);
            });
            const ocr = await extractDataFromDoc(dataUrl.split(',')[1], file.type);
            if (!ocr || ocr.error) { setErroLeitura(ocr?.error || 'A leitura não retornou nada.'); return; }

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
                proprietario_nome: t('proprietario_nome'), proprietario_documento: t('proprietario_documento'),
                tara: t('tara'), capacidade_carga: t('capacidade_carga'), eixos: t('eixos'),
            };
            if (lido.tipo_documento && lido.tipo_documento.toUpperCase() !== 'CRLV') {
                setErroLeitura(`O documento parece ser ${lido.tipo_documento}, não um CRLV.`);
            }
            setCrlv(lido);

            const tr = traduzirCrlv(dominio, lido);
            const mun = lido.local_texto ? resolverMunicipio(municipios, lido.local_texto) : null;
            setMunicipioDoCrlv(!!mun);
            const cap = CAPM3_POR_CARROCERIA[tr.carroceria.codigo];

            setForm(prev => ({
                ...prev,
                descricao: `${tr.marca.rotulo} ${lido.modelo}`.trim(),
                placa: formatarPlaca(lido.placa),
                chassi: lido.chassi.toUpperCase(),
                renavam: soDigitos(lido.renavam),
                anoModelo: lido.ano_modelo, anoFabricacao: lido.ano_fabricacao,
                cor: tr.cor.codigo, categoriaVeiculo: tr.categoria.codigo,
                marcaVeiculo: tr.marca.codigo, tipoCarroceria: tr.carroceria.codigo,
                tipoRodado: tr.rodado.codigo,
                tara: lido.tara, capacidadeCarga: lido.capacidade_carga, quantidadeEixos: lido.eixos,
                capM3: cap ? String(cap) : '',
                cidade: mun ? String(mun.codigo) : '', estado: mun ? mun.uf : '',
            }));
            // Documento novo = conferência do zero, e proprietário do zero.
            setConferidos(new Set());
            setDocProp(lido.proprietario_documento ? formatarDocumento(lido.proprietario_documento) : '');
            setProprietario(null); setPjNova(null); setErroProp(null); setTrocando(false);
            setLeu(true);
        } catch (err) {
            setErroLeitura((err as Error).message);
        } finally {
            setLendo(false);
            e.target.value = '';
        }
    };

    const tipoProp: TipoPessoa = tipoDoDocumento(docProp);

    const procurarProprietario = async () => {
        const d = soDigitos(docProp);
        setErroProp(null); setProprietario(null); setPjNova(null);
        if (tipoProp === 'indefinido') {
            setErroProp('Documento incompleto: 11 dígitos para CPF, 14 para CNPJ.');
            return;
        }
        setBuscandoProp(true);
        try {
            if (tipoProp === 'fisica') {
                const r = await buscarProprietario(d);
                if (r.error) { setErroProp(r.error); return; }
                if (!r.codPessoa) {
                    setErroProp(
                        'Não existe pessoa física com esse CPF no Datamex. Se o dono for o motorista ' +
                        'desta tela, marque "Sim, é o dono" no bloco do motorista. Se for outra pessoa ' +
                        'física, cadastre-a antes em Cadastro Rápido · Motorista — o Datamex exige os ' +
                        'dados da CNH para criar pessoa física, e isso não cabe num mini-cadastro.',
                    );
                    return;
                }
                setProprietario({ codPessoa: r.codPessoa, nome: r.nome || '', tipo: 'fisica' });
                setRef({ tipo: 'existente', codPessoa: r.codPessoa, nome: r.nome || '' });
                return;
            }
            const r = await buscarPessoaJuridica(d);
            if (r.error) { setErroProp(r.error); return; }
            if (!r.existe || !r.codPessoa) {
                const inicial = {
                    razaoSocial: crlv.proprietario_nome || '', nomeFantasia: crlv.proprietario_nome || '',
                    rntrc: '', enquadramento: '',
                };
                setPjNova(inicial);
                setRef({ tipo: 'novaPJ', cnpj: d, ...inicial });
                return;
            }
            setProprietario({ codPessoa: r.codPessoa, nome: r.razaoSocial || r.nomeFantasia || '', tipo: 'juridica' });
            setRef({ tipo: 'existente', codPessoa: r.codPessoa, nome: r.razaoSocial || r.nomeFantasia || '' });
        } finally {
            setBuscandoProp(false);
        }
    };

    /**
     * Empresa nova não é gravada aqui. Vira referência e a cascata cria no fim,
     * junto com o resto — assim o operador não fica preso a um cadastro que só
     * faz sentido se o conjunto inteiro for adiante.
     */
    const atualizarPj = (campo: string, valor: string) => {
        setPjNova(prev => {
            const novo = { ...(prev ?? { razaoSocial: '', nomeFantasia: '', rntrc: '', enquadramento: '' }), [campo]: valor };
            setRef({
                tipo: 'novaPJ', cnpj: soDigitos(docProp),
                razaoSocial: novo.razaoSocial, nomeFantasia: novo.nomeFantasia,
                rntrc: novo.rntrc, enquadramento: novo.enquadramento,
            });
            return novo;
        });
    };

    // ---- estilos ----
    const classeNormal = 'w-full px-3 py-2.5 rounded-lg text-sm font-medium outline-none border bg-[#f9fafb] border-[#e5e7eb] focus:border-[#1d6fb8] transition-colors';
    const classeCritica = (chave: CampoCritico, ok = true) =>
        `w-full px-3 py-2.5 rounded-lg text-sm font-semibold outline-none border-2 transition-colors ${!ok
            ? 'bg-red-50 border-red-400 focus:border-red-500'
            : conferidos.has(chave)
                ? 'bg-white border-emerald-300 focus:border-emerald-500'
                : 'bg-amber-50 border-amber-400 focus:border-amber-500'}`;
    const rotuloCritico = (texto: string, chave: CampoCritico) => (
        <label className="text-[10px] font-medium uppercase text-[#92400e] mb-1.5 flex items-center gap-1.5">
            {texto}<span className="text-red-500">*</span>
            {!conferidos.has(chave) && (
                <span className="normal-case text-[9px] font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">confira</span>
            )}
        </label>
    );
    const Seletor: React.FC<{ valor: string; onChange: (v: string) => void; lista: Array<{ codigo: string; rotulo: string }>; className: string }> =
        ({ valor, onChange: oc, lista, className }) => (
            <select value={valor} onChange={e => oc(e.target.value)} className={className}>
                <option value="">— selecione —</option>
                {lista.map(o => <option key={o.codigo} value={o.codigo}>{o.rotulo}</option>)}
            </select>
        );

    return (
        <div className="bg-white border border-[#e5e7eb] rounded-xl p-6 space-y-5">
            <div className="flex flex-wrap items-center gap-3">
                <h3 className="text-sm font-semibold text-[#111827]">{titulo}</h3>
                {opcional && <span className="text-[10px] font-medium text-[#9ca3af] uppercase">opcional</span>}
                {categoriaNome && (
                    <span className="text-[10px] font-semibold text-[#1d6fb8] bg-blue-50 px-2 py-0.5 rounded">{categoriaNome}</span>
                )}
            </div>
            {subtitulo && <p className="text-xs font-normal text-[#6b7280] -mt-3">{subtitulo}</p>}

            <div className="flex flex-wrap items-center gap-4">
                <UploadDocumento label="CRLV" anexado={leu} carregando={lendo} onSelect={aoAnexar} />
                <span className="text-xs font-normal text-[#6b7280]">
                    {lendo ? 'Lendo…' : leu ? 'Lido. Confira abaixo.' : 'Imagem ou PDF do CRLV.'}
                </span>
            </div>

            {erroLeitura && (
                <div className="bg-amber-50 border border-amber-300 text-amber-900 px-4 py-2.5 rounded-lg flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" strokeWidth={1.75} />
                    <p className="text-xs font-medium">{erroLeitura} Você pode preencher à mão.</p>
                </div>
            )}

            {(leu || form.placa) && (
                <>
                    {/* críticos */}
                    <div className="border-2 border-amber-300 rounded-lg p-4">
                        <p className="text-xs font-semibold text-[#92400e] mb-3">
                            Confira estes cinco — o botão de gravar só libera depois de passar por todos.
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div className="flex flex-col">
                                {rotuloCritico('Placa', 'placa')}
                                <input value={form.placa} onChange={e => setCampo('placa', formatarPlaca(e.target.value))}
                                    placeholder="ABC-1234" className={classeCritica('placa', !form.placa || placaValida(form.placa))} />
                            </div>
                            <div className="flex flex-col">
                                {rotuloCritico('Chassi', 'chassi')}
                                <input value={form.chassi} onChange={e => setCampo('chassi', e.target.value.toUpperCase())}
                                    className={classeCritica('chassi')} />
                            </div>
                            <div className="flex flex-col">
                                {rotuloCritico('Capacidade m³', 'capM3')}
                                <input type="number" min={1} value={form.capM3} onChange={e => setCampo('capM3', e.target.value)}
                                    className={classeCritica('capM3', !form.capM3 || Number(form.capM3) > 0)} />
                            </div>
                            <div className="flex flex-col">
                                {rotuloCritico('Categoria', 'categoriaVeiculo')}
                                <Seletor valor={form.categoriaVeiculo}
                                    onChange={v => { setCampo('categoriaVeiculo', v); setCampo('marcaVeiculo', ''); }}
                                    lista={listaDe('categoria')} className={classeCritica('categoriaVeiculo')} />
                            </div>
                            <div className="flex flex-col">
                                {rotuloCritico('Carroceria', 'tipoCarroceria')}
                                <Seletor valor={form.tipoCarroceria}
                                    onChange={v => {
                                        setCampo('tipoCarroceria', v);
                                        const s = CAPM3_POR_CARROCERIA[v];
                                        if (s) setForm(prev => ({ ...prev, capM3: String(s) }));
                                    }}
                                    lista={listaDe('tipoCarroceria')} className={classeCritica('tipoCarroceria')} />
                            </div>
                        </div>
                    </div>

                    {/* demais */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                        <div className="flex flex-col">
                            <label className="text-[10px] font-medium uppercase text-[#6b7280] mb-1.5">Marca</label>
                            <Seletor valor={form.marcaVeiculo} onChange={v => setCampo('marcaVeiculo', v)} lista={marcasDaCategoria} className={classeNormal} />
                        </div>
                        <div className="flex flex-col">
                            <label className="text-[10px] font-medium uppercase text-[#6b7280] mb-1.5">Cor</label>
                            <Seletor valor={form.cor} onChange={v => setCampo('cor', v)} lista={listaDe('cor')} className={classeNormal} />
                        </div>
                        <div className="flex flex-col">
                            <label className="text-[10px] font-medium uppercase text-[#6b7280] mb-1.5">Rodado</label>
                            <Seletor valor={form.tipoRodado} onChange={v => setCampo('tipoRodado', v)} lista={listaDe('tipoRodado')} className={classeNormal} />
                        </div>
                        <div className="flex flex-col">
                            <label className="text-[10px] font-medium uppercase text-[#6b7280] mb-1.5">Grupo</label>
                            <Seletor valor={form.grupoVeiculo} onChange={v => setCampo('grupoVeiculo', v)} lista={listaDe('grupo')} className={classeNormal} />
                        </div>
                        {([
                            { k: 'renavam' as const, label: 'Renavam' },
                            { k: 'anoFabricacao' as const, label: 'Ano fab.' },
                            { k: 'anoModelo' as const, label: 'Ano mod.' },
                            { k: 'tara' as const, label: 'Tara (kg)' },
                            { k: 'capacidadeCarga' as const, label: 'Cap. carga (kg)' },
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
                                {municipioDoCrlv && <span className="ml-1 normal-case text-[#b45309] font-semibold">· do CRLV, confira</span>}
                            </label>
                            <MunicipioAutocomplete
                                valor={municipioEscolhido?.rotulo ?? ''} lista={municipios} resolvido={municipioEscolhido}
                                onSelecionar={m => { setCampo('cidade', String(m.codigo)); setCampo('estado', m.uf); setMunicipioDoCrlv(false); }}
                                placeholder="Município de registro"
                            />
                        </div>
                    </div>

                    {/* proprietário desta peça */}
                    <div className="border-t border-[#e5e7eb] pt-4">
                        {/* Caso mais comum: o dono é o motorista que está sendo criado
                            aqui. Não há o que buscar — ele ainda nem tem código. */}
                        {ref?.tipo === 'motorista' ? (
                            <div className="bg-emerald-50 border border-emerald-300 text-emerald-900 px-4 py-3 rounded-lg flex items-start gap-2">
                                <CheckCircle className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" strokeWidth={1.75} />
                                <div>
                                    <p className="text-xs font-semibold">
                                        Proprietário: {nomeMotorista?.trim() || 'o motorista desta tela'}
                                    </p>
                                    <p className="text-xs font-medium opacity-90 mt-0.5">
                                        Ele é cadastrado primeiro e o código dele entra aqui automaticamente.
                                        Não precisa buscar nada.
                                    </p>
                                    <button type="button"
                                        onClick={() => { setRef(null); setQuerTrocarDono(true); }}
                                        className="text-xs font-semibold underline mt-1.5">
                                        Trocar proprietário
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <>
                                {crlv.proprietario_nome && (
                                    <p className="text-xs font-medium text-[#6b7280] mb-2">
                                        Documento em nome de <strong className="text-[#111827]">{crlv.proprietario_nome}</strong>.
                                        Esse é o dono <em>legal</em> — quem responde pela ANTT pode ser outro.
                                    </p>
                                )}
                                {motoristaEhDono && (
                                    <button type="button"
                                        onClick={() => { setRef({ tipo: 'motorista' }); setQuerTrocarDono(false); setPjNova(null); setErroProp(null); }}
                                        className="text-xs font-semibold text-[#1d6fb8] hover:underline mb-3 block">
                                        ← Usar o motorista desta tela como proprietário
                                    </button>
                                )}
                                <div className="flex flex-wrap items-end gap-3">
                                    <div className="flex flex-col">
                                        <label className="text-[10px] font-medium uppercase text-[#6b7280] mb-1.5">
                                            CPF/CNPJ do proprietário<span className="text-red-500 ml-0.5">*</span>
                                            {tipoProp !== 'indefinido' && (
                                                <span className="ml-1 normal-case text-[#1d6fb8] font-semibold">
                                                    · {tipoProp === 'fisica' ? 'pessoa física' : 'empresa'}
                                                </span>
                                            )}
                                        </label>
                                        <input value={docProp}
                                            onChange={e => { setDocProp(formatarDocumento(e.target.value)); setProprietario(null); setPjNova(null); setRef(null); setQuerTrocarDono(true); }}
                                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); procurarProprietario(); } }}
                                            className={`w-56 px-3 py-2.5 rounded-lg text-sm font-semibold outline-none border transition-colors ${ref
                                                ? 'bg-[#f9fafb] border-[#e5e7eb] focus:border-[#1d6fb8]'
                                                : 'bg-amber-50 border-amber-300 focus:border-amber-500'}`} />
                                    </div>
                                    <button type="button" onClick={procurarProprietario}
                                        disabled={buscandoProp || tipoProp === 'indefinido'}
                                        className="px-4 py-2.5 rounded-lg text-xs font-semibold text-white bg-[#1d6fb8] hover:bg-[#175a94] disabled:bg-[#e5e7eb] disabled:text-[#9ca3af] disabled:cursor-not-allowed transition-colors flex items-center gap-2">
                                        {buscandoProp ? <><Loader2 className="w-4 h-4 animate-spin" /> Buscando…</> : <><Search className="w-4 h-4" strokeWidth={1.75} /> Buscar proprietário</>}
                                    </button>
                                </div>

                                {ref?.tipo === 'existente' && (
                                    <div className="mt-3 bg-emerald-50 border border-emerald-300 text-emerald-900 px-4 py-2.5 rounded-lg flex items-start gap-2">
                                        <CheckCircle className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" strokeWidth={1.75} />
                                        <p className="text-xs font-medium">{ref.nome} — código {ref.codPessoa}</p>
                                    </div>
                                )}

                                {pjNova && (
                                    <div className="mt-3 border-2 border-amber-300 rounded-lg p-4 bg-amber-50/40">
                                        <p className="text-xs font-semibold text-[#92400e] mb-1">
                                            Empresa não encontrada. Preencha e siga — ela é cadastrada junto com o conjunto.
                                        </p>
                                        <p className="text-[11px] font-normal text-[#92400e] mb-3">
                                            Nada é gravado agora. Se você desistir do conjunto, a empresa não é criada.
                                        </p>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            <input value={pjNova.razaoSocial} placeholder="Razão social"
                                                onChange={e => atualizarPj('razaoSocial', e.target.value)} className={classeNormal} />
                                            <input value={pjNova.nomeFantasia} placeholder="Nome fantasia"
                                                onChange={e => atualizarPj('nomeFantasia', e.target.value)} className={classeNormal} />
                                            <div>
                                                <input value={pjNova.rntrc} placeholder="RNTRC"
                                                    onChange={e => atualizarPj('rntrc', e.target.value)}
                                                    className={`w-full px-3 py-2.5 rounded-lg text-sm font-semibold outline-none border-2 transition-colors ${pjNova.rntrc
                                                        ? 'bg-white border-emerald-300' : 'bg-amber-50 border-amber-400'}`} />
                                                <p className="text-[10px] font-medium text-[#92400e] mt-1">
                                                    Não vem no CRLV. Sem ele o cadastro não grava.
                                                </p>
                                            </div>
                                            <select value={pjNova.enquadramento}
                                                onChange={e => atualizarPj('enquadramento', e.target.value)} className={classeNormal}>
                                                {ENQUADRAMENTOS.map(o => <option key={o.valor} value={o.valor}>{o.label}</option>)}
                                            </select>
                                        </div>
                                    </div>
                                )}

                                {erroProp && (
                                    <div className="mt-3 bg-amber-50 border border-amber-300 text-amber-900 px-4 py-2.5 rounded-lg flex items-start gap-2">
                                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" strokeWidth={1.75} />
                                        <p className="text-xs font-medium">{erroProp}</p>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

export default BlocoVeiculoCRLV;
