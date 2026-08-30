import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, CheckCircle, Loader2, Search } from 'lucide-react';
import { extractDataFromDoc } from '../services/geminiService';
import UploadDocumento from './UploadDocumento';
import MunicipioAutocomplete, { useMunicipios } from './MunicipioAutocomplete';
import { resolverMunicipio } from '../utils/municipios';
import {
    CAMPOS_CRITICOS, CAPM3_POR_CARROCERIA, CampoCritico, ENQUADRAMENTOS,
    TipoPessoa, VEICULO_VAZIO, VeiculoParaGravar, buscarPessoaJuridica,
    buscarProprietario, cadastrarPessoaJuridica, formatarDocumento,
    formatarPlaca, GRUPO_FROTA_PROPRIA, placaValida, tipoDoDocumento,
} from '../services/cadastroVeiculo';
import {
    CRLV_VAZIO, DadosCRLV, Dominio, carregarDominio, traduzirCrlv,
} from '../services/traducaoVeiculo';
import { RefProprietario, descreverProprietario } from '../services/conjunto';

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
    /**
     * Dono do veículo principal. Só os implementos recebem: é o que permite
     * "o dono desta carreta é o mesmo do cavalo" sem refazer a busca.
     *
     * A referência é COPIADA no momento do clique, não observada: se o operador
     * trocar o dono do cavalo depois, a carreta guarda o que ele escolheu, e a
     * tela avisa que os dois deixaram de coincidir. Sincronizar por trás mudaria
     * uma decisão já tomada sem ninguém pedir.
     */
    refPrincipal?: RefProprietario | null;
    /** Nome do motorista, para descrever a opção "é o proprietário do cavalo". */
    onChange: (e: EstadoPeca) => void;
}

import { buscarCep, formatarCep } from '../services/cep';
import { DadosEndereco, ENDERECO_VAZIO, celularValido, formatarCelular } from '../services/cadastroMotorista';

const soDigitos = (s: string) => (s || '').replace(/\D/g, '');

const BlocoVeiculoCRLV: React.FC<Props> = ({
    titulo, subtitulo, opcional, motoristaEhDono, nomeMotorista, assumirMotorista,
    refPrincipal, onChange,
}) => {
    const [dominio, setDominio] = useState<Dominio>([]);
    const { lista: municipios } = useMunicipios();

    const [crlv, setCrlv] = useState<DadosCRLV>(CRLV_VAZIO);
    const [form, setForm] = useState<VeiculoParaGravar>(VEICULO_VAZIO);
    const [lendo, setLendo] = useState(false);
    const [leu, setLeu] = useState(false);
    const [erroLeitura, setErroLeitura] = useState<string | null>(null);
    /**
     * Formulário aberto sem leitura bem-sucedida.
     *
     * Existia um beco aqui: os campos só apareciam depois que o OCR desse
     * certo, e o único campo de placa ficava dentro desse mesmo bloco. Quando
     * o Gemini falhava, a tela dizia "você pode preencher à mão" e não havia
     * onde digitar — o Cadastro Conjunto parava por completo, enquanto as
     * telas de cadastro avulso seguiam funcionando.
     */
    const [manual, setManual] = useState(false);
    /** Erro de COTA/limite (transitório) x qualquer outro. Muda o que se diz. */
    const [erroDeCota, setErroDeCota] = useState(false);
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
    const [pjNova, setPjNova] = useState<
        { razaoSocial: string; nomeFantasia: string; rntrc: string; enquadramento: string;
          celular: string; endereco: DadosEndereco } | null
    >(null);

    // Mini-cadastro de pessoa física NOVA. `null` = não está aberto.
    // `ehMotorista` decide entre os dois caminhos: quem dirige vai para o
    // cadastro completo (com CNH), quem só é dono fica aqui.
    const [pfNova, setPfNova] = useState<
        { ehMotorista: boolean; nome: string; sobrenome: string; rntrc: string;
          celular: string; dataNascimento: string; endereco: DadosEndereco } | null
    >(null);
    const [buscandoCep, setBuscandoCep] = useState(false);
    const [erroCep, setErroCep] = useState<string | null>(null);

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
        const donoOk = ref !== null
            // Empresa: além de razão social e RNTRC, agora telefone e endereço —
            // o CT-e exige os dois, e a empresa nascia sem nenhum deles.
            && (ref.tipo !== 'novaPJ'
                || (!!ref.razaoSocial.trim() && !!ref.nomeFantasia.trim() && !!ref.rntrc.trim()
                    && celularValido(ref.celular) && enderecoOk(ref.endereco)))
            // Pessoa física nova: nome, RNTRC e o endereço com município
            // resolvido pelo CEP. `cidade` é o código IBGE — digitado à mão ele
            // não existe, e sem ele o endereço não é enviado.
            && (ref.tipo !== 'novaPF'
                || (!!ref.nome.trim() && !!ref.rntrc.trim()
                    && celularValido(ref.celular)
                    // Nascimento é obrigatório porque a API não aceita vazio:
                    // grava "0000-00-00", que é data inválida, não ausência.
                    && !!ref.dataNascimento.trim()
                    && enderecoOk(ref.endereco)));
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
        // Editar um crítico DESFAZ a conferência: o valor conferido não é mais
        // o valor que está na tela. Antes, digitar valia como conferido — o que
        // confundia "mexi no campo" com "olhei e está certo", e deixava passar
        // justamente o erro de digitação que a conferência existe para pegar.
        if ((CAMPOS_CRITICOS as readonly string[]).includes(k)) {
            setConferidos(prev => {
                if (!prev.has(k as CampoCritico)) return prev;
                const n = new Set(prev); n.delete(k as CampoCritico); return n;
            });
        }
    };

    /**
     * Marca/desmarca um crítico como conferido.
     *
     * É um ato deliberado: o operador olha o valor e afirma que está certo. Não
     * exige editar nada — o caso comum é o OCR ter acertado, e obrigar a mexer
     * num valor correto para "provar" que olhou fazia o operador digitar por
     * cima do que já estava bom.
     */
    const alternarConferido = (k: CampoCritico) =>
        setConferidos(prev => {
            const n = new Set(prev);
            n.has(k) ? n.delete(k) : n.add(k);
            return n;
        });

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
            if (!ocr || ocr.error) {
                const bruto = ocr?.error || 'A leitura não retornou nada.';
                // Cota/limite é transitório: vale tentar de novo daqui a pouco.
                // Os outros não — insistir com o mesmo arquivo dá no mesmo, e
                // dizer "tente mais tarde" faria o operador esperar à toa.
                setErroDeCota(/cota|quota|429|RESOURCE_EXHAUSTED|sobrecarregad/i.test(bruto));
                setErroLeitura(bruto);
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
                // Modelo é campo próprio no Bsoft (modeloVeiculo), texto livre.
                // Não basta estar dentro da descrição: sem ele o CT-e não emite.
                modelo: lido.modelo,
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
            setErroDeCota(false);
        } catch (err) {
            setErroDeCota(false);
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
                    // Antes isto era um beco sem saída: mandava o operador para
                    // outra tela porque "o Datamex exige CNH". Não exige — a
                    // exigência era nossa. Agora abre o mini-cadastro aqui.
                    const primeiro = (crlv.proprietario_nome || '').split(' ')[0] || '';
                    const resto = (crlv.proprietario_nome || '').split(' ').slice(1).join(' ');
                    setPfNova({ ehMotorista: false, nome: primeiro, sobrenome: resto,
                        rntrc: '', celular: '', dataNascimento: '', endereco: ENDERECO_VAZIO });
                    setRef({ tipo: 'novaPF', cpf: soDigitos(docProp), nome: primeiro, sobrenome: resto,
                        rntrc: '', celular: '', dataNascimento: '', endereco: ENDERECO_VAZIO });
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
    const atualizarPj = (campo: string, valor: string | DadosEndereco) => {
        setPjNova(prev => {
            const base = prev ?? { razaoSocial: '', nomeFantasia: '', rntrc: '', enquadramento: '', celular: '', endereco: ENDERECO_VAZIO };
            const novo = { ...base, [campo]: valor } as typeof base;
            setRef({
                tipo: 'novaPJ', cnpj: soDigitos(docProp),
                razaoSocial: novo.razaoSocial, nomeFantasia: novo.nomeFantasia,
                rntrc: novo.rntrc, enquadramento: novo.enquadramento,
                celular: novo.celular, endereco: novo.endereco,
            });
            return novo;
        });
    };

    /**
     * Pessoa física nova não é gravada aqui: vira referência e a cascata cria
     * antes dos veículos, junto das empresas. Mesma regra da PJ — se o operador
     * desistir do conjunto, ninguém é criado.
     */
    const atualizarPf = (campo: string, valor: string | boolean | DadosEndereco) => {
        setPfNova(prev => {
            const base = prev ?? { ehMotorista: false, nome: '', sobrenome: '', rntrc: '', celular: '', dataNascimento: '', endereco: ENDERECO_VAZIO };
            const novo = { ...base, [campo]: valor } as typeof base;
            // Marcou que dirige: o caminho é o cadastro completo, com CNH, que
            // não cabe aqui. A referência sai para não gravar meia pessoa.
            setRef(novo.ehMotorista ? null : {
                tipo: 'novaPF', cpf: soDigitos(docProp),
                nome: novo.nome, sobrenome: novo.sobrenome,
                rntrc: novo.rntrc, celular: novo.celular,
                dataNascimento: novo.dataNascimento, endereco: novo.endereco,
            });
            return novo;
        });
    };

    /**
     * Busca o CEP do proprietário novo — serve a pessoa física E a empresa. O
     * código IBGE só nasce aqui: digitado à mão, o município não tem código, e
     * sem código o endereço não é aceito.
     */
    const procurarCepDe = async (
        atual: DadosEndereco,
        aplicar: (e: DadosEndereco) => void,
    ) => {
        setBuscandoCep(true); setErroCep(null);
        try {
            const achado = await buscarCep(atual.cep);
            aplicar({
                ...atual,
                cep: achado.cep,
                logradouro: achado.logradouro || atual.logradouro,
                bairro: achado.bairro || atual.bairro,
                cidade: String(achado.municipio.codigo),
                municipioNome: achado.municipio.nome,
                estado: achado.municipio.uf,
                municipioRotulo: achado.municipio.rotulo,
            });
        } catch (err) {
            setErroCep((err as Error).message);
            aplicar({ ...atual, cidade: '', estado: '', municipioRotulo: '' });
        } finally {
            setBuscandoCep(false);
        }
    };

    const procurarCepPf = () =>
        procurarCepDe(pfNova?.endereco ?? ENDERECO_VAZIO, e => atualizarPf('endereco', e));
    const procurarCepPj = () =>
        procurarCepDe(pjNova?.endereco ?? ENDERECO_VAZIO, e => atualizarPj('endereco', e));

    /** Um campo do endereço da PF nova. */
    const setEndPf = (campo: keyof DadosEndereco, valor: string) =>
        atualizarPf('endereco', { ...(pfNova?.endereco ?? ENDERECO_VAZIO), [campo]: valor });
    /** Um campo do endereço da PJ nova. */
    const setEndPj = (campo: keyof DadosEndereco, valor: string) =>
        atualizarPj('endereco', { ...(pjNova?.endereco ?? ENDERECO_VAZIO), [campo]: valor });

    /**
     * Endereço completo o bastante para o CT-e. `cidade` é o código IBGE, que
     * só existe se o CEP foi buscado — é o que impede mandar município no chute.
     */
    const enderecoOk = (e: DadosEndereco) =>
        !!e.cep.trim() && !!e.logradouro.trim() && !!e.numero.trim()
        && !!e.bairro.trim() && !!e.cidade.trim();

    // ---- estilos ----
    const classeNormal = 'w-full px-3 py-2.5 rounded-lg text-sm font-medium outline-none border bg-[#f9fafb] border-[#e5e7eb] focus:border-[#1d6fb8] transition-colors';
    const classeCritica = (chave: CampoCritico, ok = true) =>
        `w-full px-3 py-2.5 rounded-lg text-sm font-semibold outline-none border-2 transition-colors ${!ok
            ? 'bg-red-50 border-red-400 focus:border-red-500'
            : conferidos.has(chave)
                ? 'bg-white border-emerald-300 focus:border-emerald-500'
                : 'bg-amber-50 border-amber-400 focus:border-amber-500'}`;
    const rotuloCritico = (texto: string, chave: CampoCritico) => {
        const ok = conferidos.has(chave);
        return (
            <div className="flex items-center gap-1.5 mb-1.5">
                <label className="text-[10px] font-medium uppercase text-[#92400e] flex items-center gap-1">
                    {texto}<span className="text-red-500">*</span>
                </label>
                <button type="button" onClick={() => alternarConferido(chave)}
                    title={ok ? 'Conferido — clique para desmarcar' : 'Confira o valor e clique para marcar'}
                    className={`ml-auto normal-case text-[9px] font-semibold px-1.5 py-0.5 rounded border transition-colors flex items-center gap-1 ${ok
                        ? 'bg-emerald-100 border-emerald-300 text-emerald-800 hover:bg-emerald-200'
                        : 'bg-amber-100 border-amber-300 text-amber-800 hover:bg-amber-200'}`}>
                    {ok ? <><Check className="w-2.5 h-2.5" strokeWidth={3} /> conferido</> : 'confere'}
                </button>
            </div>
        );
    };
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
                <div className="bg-amber-50 border border-amber-300 text-amber-900 px-4 py-3 rounded-lg flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" strokeWidth={1.75} />
                    <div className="min-w-0">
                        <p className="text-xs font-semibold">
                            {erroDeCota
                                ? 'Leitor ocupado no momento.'
                                : 'Não consegui ler o documento.'}
                        </p>
                        <p className="text-xs font-medium opacity-90 mt-0.5">
                            {erroDeCota
                                ? 'Tente de novo em instantes ou preencha os campos à mão — o cadastro segue igual.'
                                : 'Anexe outra foto do CRLV ou preencha os campos à mão — o cadastro segue igual.'}
                        </p>
                        <p className="text-[11px] font-normal opacity-75 mt-1">{erroLeitura}</p>
                        {!manual && !leu && (
                            <button type="button" onClick={() => setManual(true)}
                                className="mt-2 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-[#1d6fb8] hover:bg-[#175a94] transition-colors">
                                Preencher à mão
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* Quem não tem o documento em mãos também precisa de saída: o CRLV
                nem sempre está com quem cadastra. Sem erro nenhum, o caminho
                manual fica discreto — a leitura continua sendo o normal. */}
            {!leu && !manual && !erroLeitura && (
                <button type="button" onClick={() => setManual(true)}
                    className="text-xs font-semibold text-[#1d6fb8] hover:underline self-start">
                    Não tenho o documento — preencher à mão
                </button>
            )}

            {(leu || manual || form.placa) && (
                <>
                    {/* críticos */}
                    <div className="border-2 border-amber-300 rounded-lg p-4">
                        <p className="text-xs font-semibold text-[#92400e] mb-3">
                            Confira estes cinco e clique em <strong>confere</strong> em cada um. Não
                            precisa editar: se o valor está certo, basta marcar. Corrigiu algum? Ele
                            volta a pedir conferência. O gravar libera com os cinco marcados.
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
                            {form.grupoVeiculo === GRUPO_FROTA_PROPRIA && (
                                <p className="text-[10px] font-medium text-amber-700 mt-1">
                                    Frota própria pode exigir vínculo com equipamento de manutenção no
                                    Datamex, e o cadastro pode ser recusado. Se der erro, cadastre este
                                    veículo manualmente lá.
                                </p>
                            )}
                        </div>
                        {/* `modelo` vai para o modeloVeiculo do Bsoft; sem ele o veículo
                            entra sem modelo e o CT-e não emite. Por isso ele — e só ele —
                            fica marcado quando está vazio. */}
                        {([
                            { k: 'modelo' as const, label: 'Modelo', destacarVazio: true },
                            { k: 'renavam' as const, label: 'Renavam' },
                            { k: 'anoFabricacao' as const, label: 'Ano fab.' },
                            { k: 'anoModelo' as const, label: 'Ano mod.' },
                            { k: 'tara' as const, label: 'Tara (kg)' },
                            { k: 'capacidadeCarga' as const, label: 'Cap. carga (kg)' },
                            { k: 'quantidadeEixos' as const, label: 'Eixos' },
                        ] as Array<{ k: keyof VeiculoParaGravar; label: string; destacarVazio?: boolean }>).map(({ k, label, destacarVazio }) => {
                            const faltando = destacarVazio && !String(form[k] ?? '').trim();
                            return (
                                <div key={k} className="flex flex-col">
                                    <label className="text-[10px] font-medium uppercase text-[#6b7280] mb-1.5">
                                        {label}
                                        {faltando && <span className="ml-1 normal-case text-[#b45309] font-semibold">· sem ele o CT-e não emite</span>}
                                    </label>
                                    <input value={String(form[k] ?? '')} onChange={e => setCampo(k, e.target.value)}
                                        className={faltando ? `${classeNormal} border-amber-400 bg-amber-50` : classeNormal} />
                                </div>
                            );
                        })}
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
                    {/* ---------------------------------------------------------------
                        DE ONDE VEM O DONO desta peça. Três origens, sempre visíveis.

                        As duas primeiras existem porque, na prática, o dono da carreta
                        quase sempre é alguém que JÁ está nesta tela — o motorista ou o
                        dono do cavalo. Obrigar a redigitar o CPF de quem está logo
                        acima era pedir para errar.

                        Uma origem escolhida COPIA a referência; não fica observando a
                        outra peça. Se o operador trocar o dono do cavalo depois, esta
                        carreta guarda o que ele escolheu — e o aviso abaixo diz que os
                        dois deixaram de coincidir, em vez de mudar por conta própria.
                       --------------------------------------------------------------- */}
                    {(() => {
                        const mesmoRef = (a: RefProprietario | null, b: RefProprietario | null) =>
                            JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
                        const ehDoMotorista = ref?.tipo === 'motorista';
                        const ehDoCavalo = !!refPrincipal && mesmoRef(ref, refPrincipal) && !ehDoMotorista;
                        const podeUsarCavalo = !!refPrincipal;
                        // "Outro" é qualquer coisa que não veio de atalho.
                        const ehOutro = !!ref && !ehDoMotorista && !ehDoCavalo;

                        const Opcao: React.FC<{ ativa: boolean; onClick: () => void; titulo: string; desc: string; desabilitada?: boolean }> =
                            ({ ativa, onClick, titulo, desc, desabilitada }) => (
                                <button type="button" onClick={onClick} disabled={desabilitada}
                                    className={`flex-1 min-w-[180px] text-left px-3 py-2.5 rounded-lg border-2 transition-colors ${desabilitada
                                        ? 'bg-[#f9fafb] border-[#e5e7eb] text-[#9ca3af] cursor-not-allowed'
                                        : ativa
                                            ? 'bg-[#eff6ff] border-[#1d6fb8] text-[#1d6fb8]'
                                            : 'bg-white border-[#e5e7eb] text-[#6b7280] hover:border-[#1d6fb8]'}`}>
                                    <span className="block text-xs font-semibold">{titulo}</span>
                                    <span className="block text-[11px] font-normal opacity-80 mt-0.5">{desc}</span>
                                </button>
                            );

                        return (
                            <>
                                <p className="text-[10px] font-medium uppercase text-[#6b7280] mb-2">
                                    Proprietário desta peça<span className="text-red-500 ml-0.5">*</span>
                                </p>
                                <div className="flex flex-wrap gap-2 mb-3">
                                    <Opcao ativa={ehDoMotorista} titulo="É o motorista"
                                        desc={nomeMotorista?.trim() || 'o motorista desta tela'}
                                        onClick={() => {
                                            setRef({ tipo: 'motorista' });
                                            setQuerTrocarDono(true); setPjNova(null); setPfNova(null); setErroProp(null);
                                        }} />
                                    <Opcao ativa={ehDoCavalo} desabilitada={!podeUsarCavalo}
                                        titulo="É o proprietário do cavalo"
                                        desc={podeUsarCavalo
                                            ? descreverProprietario(refPrincipal!, nomeMotorista || '')
                                            : 'defina o dono do veículo principal primeiro'}
                                        onClick={() => {
                                            if (!refPrincipal) return;
                                            // Cópia, não vínculo. Ver a nota acima.
                                            setRef(JSON.parse(JSON.stringify(refPrincipal)));
                                            setQuerTrocarDono(true); setPjNova(null); setPfNova(null); setErroProp(null);
                                        }} />
                                    <Opcao ativa={ehOutro} titulo="Outro"
                                        desc="buscar por CPF ou CNPJ"
                                        onClick={() => { setRef(null); setQuerTrocarDono(true); setErroProp(null); }} />
                                </div>

                                {/* Conferência: quem escolheu atalho vê nome e documento sem
                                    abrir busca nenhuma. */}
                                {(ehDoMotorista || ehDoCavalo) && (
                                    <div className="bg-emerald-50 border border-emerald-300 text-emerald-900 px-4 py-3 rounded-lg flex items-start gap-2">
                                        <CheckCircle className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" strokeWidth={1.75} />
                                        <div>
                                            <p className="text-xs font-semibold">
                                                {descreverProprietario(ref, nomeMotorista || '')}
                                            </p>
                                            <p className="text-xs font-medium opacity-90 mt-0.5">
                                                {ref?.tipo === 'existente'
                                                    ? 'Já cadastrado no Datamex. Nada a preencher.'
                                                    : 'É cadastrado antes dos veículos e o código entra aqui automaticamente. Não precisa de RNTRC de novo.'}
                                            </p>
                                        </div>
                                    </div>
                                )}

                                {/* O dono do cavalo mudou depois da escolha: avisa, não corrige. */}
                                {ehOutro && podeUsarCavalo && !mesmoRef(ref, refPrincipal) && ref?.tipo !== 'motorista' && null}
                            </>
                        );
                    })()}

                        {(ref === null || (ref.tipo !== 'motorista' && !(refPrincipal && JSON.stringify(ref) === JSON.stringify(refPrincipal)))) && (
                            <>
                                {crlv.proprietario_nome && (
                                    <p className="text-xs font-medium text-[#6b7280] mb-2">
                                        Documento em nome de <strong className="text-[#111827]">{crlv.proprietario_nome}</strong>.
                                        Esse é o dono <em>legal</em> — quem responde pela ANTT pode ser outro.
                                    </p>
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
                                            onChange={e => { setDocProp(formatarDocumento(e.target.value)); setProprietario(null); setPjNova(null); setPfNova(null); setRef(null); setQuerTrocarDono(true); }}
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

                                        {/* Telefone e endereço: até 30/08/2026 a empresa era gravada com
                                            cinco campos e mais nada — sem contato e sem endereço —, e o
                                            CT-e não emitia. */}
                                        <div className="mt-3">
                                            <label className="text-[10px] font-medium uppercase text-[#92400e] mb-1.5 block">
                                                Celular<span className="text-red-500 ml-0.5">*</span>
                                            </label>
                                            <input value={pjNova.celular} placeholder="(11) 90000-0000"
                                                onChange={e => atualizarPj('celular', formatarCelular(e.target.value))}
                                                className={`w-full md:w-56 px-3 py-2.5 rounded-lg text-sm font-semibold outline-none border-2 transition-colors ${celularValido(pjNova.celular)
                                                    ? 'bg-white border-emerald-300' : 'bg-amber-50 border-amber-400'}`} />
                                        </div>

                                        <p className="text-[11px] font-semibold text-[#92400e] mt-4 mb-1.5">Endereço da empresa</p>
                                        <div className="flex flex-wrap items-end gap-2">
                                            <input value={pjNova.endereco.cep} placeholder="CEP"
                                                onChange={e => setEndPj('cep', formatarCep(e.target.value))}
                                                onBlur={() => { if (soDigitos(pjNova.endereco.cep).length === 8 && !pjNova.endereco.cidade) procurarCepPj(); }}
                                                className={`w-36 px-3 py-2.5 rounded-lg text-sm font-semibold outline-none border-2 transition-colors ${pjNova.endereco.cidade
                                                    ? 'bg-white border-emerald-300' : 'bg-amber-50 border-amber-400'}`} />
                                            <button type="button" onClick={procurarCepPj}
                                                disabled={buscandoCep || soDigitos(pjNova.endereco.cep).length !== 8}
                                                className="px-3 py-2.5 rounded-lg text-xs font-semibold text-white bg-[#1d6fb8] hover:bg-[#175a94] disabled:bg-[#e5e7eb] disabled:text-[#9ca3af] transition-colors flex items-center gap-1.5">
                                                {buscandoCep ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Buscando…</> : <><Search className="w-3.5 h-3.5" strokeWidth={1.75} /> Buscar CEP</>}
                                            </button>
                                            {pjNova.endereco.municipioRotulo && (
                                                <span className="text-[11px] font-medium text-emerald-700 pb-2.5">{pjNova.endereco.municipioRotulo}</span>
                                            )}
                                        </div>
                                        {erroCep && <p className="text-[11px] font-medium text-amber-700 mt-1.5">{erroCep}</p>}
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                                            <input value={pjNova.endereco.logradouro} placeholder="Endereço"
                                                onChange={e => setEndPj('logradouro', e.target.value)} className={classeNormal} />
                                            <input value={pjNova.endereco.numero} placeholder="Número"
                                                onChange={e => setEndPj('numero', e.target.value)} className={classeNormal} />
                                            <input value={pjNova.endereco.bairro} placeholder="Bairro"
                                                onChange={e => setEndPj('bairro', e.target.value)} className={classeNormal} />
                                            <input value={pjNova.endereco.complemento} placeholder="Complemento (opcional)"
                                                onChange={e => setEndPj('complemento', e.target.value)} className={classeNormal} />
                                        </div>
                                    </div>
                                )}

                                {/* -------------------------------------------------------
                                    Pessoa física NOVA. O caso que não existia: dono que não
                                    dirige — o caminhão no nome da mãe do motorista.

                                    A pergunta vem primeiro porque separa dois cadastros
                                    diferentes. Quem dirige precisa de CNH inteira e vai
                                    para a tela completa; quem só é dono precisa de muito
                                    menos, e nada de CNH.

                                    Nenhum campo de CNH é gravado em branco. Uma habilitação
                                    vazia no Datamex afirmaria que a pessoa tem CNH sem
                                    número, e ninguém depois distinguiria isso de um erro de
                                    digitação.
                                   ------------------------------------------------------- */}
                                {pfNova && (
                                    <div className="mt-3 border-2 border-amber-300 rounded-lg p-4 bg-amber-50/40">
                                        <p className="text-xs font-semibold text-[#92400e] mb-2">
                                            Não existe pessoa física com esse CPF no Datamex.
                                        </p>

                                        <p className="text-[11px] font-semibold text-[#92400e] mb-1.5">Essa pessoa é motorista?</p>
                                        <div className="flex gap-2 mb-3">
                                            {([[false, 'Não — só é dona do veículo'], [true, 'Sim, ela dirige']] as Array<[boolean, string]>).map(([v, rotulo]) => (
                                                <button key={String(v)} type="button"
                                                    onClick={() => atualizarPf('ehMotorista', v)}
                                                    className={`px-3 py-2 rounded-lg text-xs font-semibold border-2 transition-colors ${pfNova.ehMotorista === v
                                                        ? 'bg-[#eff6ff] border-[#1d6fb8] text-[#1d6fb8]'
                                                        : 'bg-white border-[#e5e7eb] text-[#6b7280] hover:border-[#1d6fb8]'}`}>
                                                    {rotulo}
                                                </button>
                                            ))}
                                        </div>

                                        {pfNova.ehMotorista ? (
                                            <div className="bg-white border border-[#e5e7eb] rounded-lg px-3 py-2.5">
                                                <p className="text-[11px] font-medium text-[#6b7280]">
                                                    Quem dirige precisa da CNH inteira — registro, categoria, validade e
                                                    toxicológico —, e isso não cabe aqui. Se for o motorista deste conjunto,
                                                    escolha <strong className="text-[#111827]">É o motorista</strong> acima.
                                                    Se for outro condutor, cadastre-o em Cadastro Pessoa e volte.
                                                </p>
                                            </div>
                                        ) : (
                                            <>
                                                <p className="text-[11px] font-normal text-[#92400e] mb-3">
                                                    Nada é gravado agora. Se você desistir do conjunto, a pessoa não é criada.
                                                </p>
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                    <input value={pfNova.nome} placeholder="Nome"
                                                        onChange={e => atualizarPf('nome', e.target.value)}
                                                        className={`px-3 py-2.5 rounded-lg text-sm font-semibold outline-none border-2 transition-colors ${pfNova.nome
                                                            ? 'bg-white border-emerald-300' : 'bg-amber-50 border-amber-400'}`} />
                                                    <input value={pfNova.sobrenome} placeholder="Sobrenome"
                                                        onChange={e => atualizarPf('sobrenome', e.target.value)} className={classeNormal} />
                                                </div>

                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                                                    <div>
                                                        <label className="text-[10px] font-medium uppercase text-[#92400e] mb-1.5 block">
                                                            Celular<span className="text-red-500 ml-0.5">*</span>
                                                        </label>
                                                        <input value={pfNova.celular} placeholder="(11) 90000-0000"
                                                            onChange={e => atualizarPf('celular', formatarCelular(e.target.value))}
                                                            className={`w-full px-3 py-2.5 rounded-lg text-sm font-semibold outline-none border-2 transition-colors ${celularValido(pfNova.celular)
                                                                ? 'bg-white border-emerald-300' : 'bg-amber-50 border-amber-400'}`} />
                                                        <p className="text-[10px] font-medium text-[#92400e] mt-1">
                                                            DDD + 9 dígitos. O CT-e exige contato do proprietário.
                                                        </p>
                                                    </div>
                                                    <div>
                                                        <label className="text-[10px] font-medium uppercase text-[#92400e] mb-1.5 block">
                                                            Nascimento<span className="text-red-500 ml-0.5">*</span>
                                                        </label>
                                                        <input type="date" value={pfNova.dataNascimento}
                                                            onChange={e => atualizarPf('dataNascimento', e.target.value)}
                                                            className={`w-full px-3 py-2.5 rounded-lg text-sm font-semibold outline-none border-2 transition-colors ${pfNova.dataNascimento
                                                                ? 'bg-white border-emerald-300' : 'bg-amber-50 border-amber-400'}`} />
                                                        <p className="text-[10px] font-medium text-[#92400e] mt-1">
                                                            Sem isto o Datamex grava 00/00/0000, que é data inválida.
                                                        </p>
                                                    </div>
                                                </div>

                                                <div className="mt-3">
                                                    <input value={pfNova.rntrc} placeholder="RNTRC"
                                                        onChange={e => atualizarPf('rntrc', e.target.value)}
                                                        className={`w-full md:w-64 px-3 py-2.5 rounded-lg text-sm font-semibold outline-none border-2 transition-colors ${pfNova.rntrc
                                                            ? 'bg-white border-emerald-300' : 'bg-amber-50 border-amber-400'}`} />
                                                    <p className="text-[10px] font-medium text-[#92400e] mt-1">
                                                        Obrigatório aqui. A API aceitaria sem, mas proprietário sem RNTRC
                                                        volta como pendência na emissão do CT-e.
                                                    </p>
                                                </div>

                                                <p className="text-[11px] font-semibold text-[#92400e] mt-4 mb-1.5">Endereço</p>
                                                <div className="flex flex-wrap items-end gap-2">
                                                    <input value={pfNova.endereco.cep} placeholder="CEP"
                                                        onChange={e => setEndPf('cep', formatarCep(e.target.value))}
                                                        onBlur={() => { if (soDigitos(pfNova.endereco.cep).length === 8 && !pfNova.endereco.cidade) procurarCepPf(); }}
                                                        className={`w-36 px-3 py-2.5 rounded-lg text-sm font-semibold outline-none border-2 transition-colors ${pfNova.endereco.cidade
                                                            ? 'bg-white border-emerald-300' : 'bg-amber-50 border-amber-400'}`} />
                                                    <button type="button" onClick={procurarCepPf}
                                                        disabled={buscandoCep || soDigitos(pfNova.endereco.cep).length !== 8}
                                                        className="px-3 py-2.5 rounded-lg text-xs font-semibold text-white bg-[#1d6fb8] hover:bg-[#175a94] disabled:bg-[#e5e7eb] disabled:text-[#9ca3af] transition-colors flex items-center gap-1.5">
                                                        {buscandoCep ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Buscando…</> : <><Search className="w-3.5 h-3.5" strokeWidth={1.75} /> Buscar CEP</>}
                                                    </button>
                                                    {pfNova.endereco.municipioRotulo && (
                                                        <span className="text-[11px] font-medium text-emerald-700 pb-2.5">
                                                            {pfNova.endereco.municipioRotulo}
                                                        </span>
                                                    )}
                                                </div>
                                                {erroCep && (
                                                    <p className="text-[11px] font-medium text-amber-700 mt-1.5">{erroCep}</p>
                                                )}
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                                                    <input value={pfNova.endereco.logradouro} placeholder="Endereço"
                                                        onChange={e => setEndPf('logradouro', e.target.value)} className={classeNormal} />
                                                    <input value={pfNova.endereco.numero} placeholder="Número"
                                                        onChange={e => setEndPf('numero', e.target.value)} className={classeNormal} />
                                                    <input value={pfNova.endereco.bairro} placeholder="Bairro"
                                                        onChange={e => setEndPf('bairro', e.target.value)} className={classeNormal} />
                                                    <input value={pfNova.endereco.complemento} placeholder="Complemento (opcional)"
                                                        onChange={e => setEndPf('complemento', e.target.value)} className={classeNormal} />
                                                </div>
                                                <p className="text-[10px] font-medium text-[#6b7280] mt-2">
                                                    O município vem da busca de CEP — digitado à mão ele não tem código IBGE,
                                                    e sem código o endereço não é enviado.
                                                </p>
                                            </>
                                        )}
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
