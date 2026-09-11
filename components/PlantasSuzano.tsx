import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Factory, Info, Loader2, Search } from 'lucide-react';
import {
    MapaPlantas, PlantaOrigem, carregarPlantas, classificarPlanta, listarPlantas,
    municipiosParaEscolha,
} from '../services/suzanoPlanta';
import { buscarMunicipios, type Municipio } from '../utils/municipios';
import { searchPipefyRecords } from '../services/pipefy';

// ============================================================================
// DE-PARA DE PLANTA — a origem das Demais Plantas.
//
// O OTM manda `FAB_MOG_1110` na coluna "ID Origem". Não é cidade, é código de
// sistema, e a planilha não diz que lugar é esse. Aqui o master traduz uma vez
// e a tradução vale para sempre.
//
// A CIDADE NÃO É DIGITADA, é escolhida da base do IBGE. Digitar livre traria
// "Mogi das Cruzes", "mogi das cruzes" e "Mogi das Cruze" para a mesma planta —
// e como esse texto vira a origem da rota no Qualp, a terceira grafia viraria
// uma distância errada, não um erro visível. Escolher da lista é o que garante
// grafia e código do IBGE corretos de uma vez.
// ============================================================================

interface Props {
    /**
     * Só master classifica. A tela esconde o botão para os demais; quem impede
     * de fato é a RLS de fast_delivery_planta, que exige is_master(). Aqui é
     * conveniência, não proteção.
     */
    ehMaster?: boolean;
    /** Abre o modal já com este código — usado quando vem de uma pendência. */
    codigoInicial?: string | null;
    /** Avisa quem chamou que o de-para mudou, para reprocessar a prévia. */
    aoClassificar?: (plantas: MapaPlantas) => void;
    /** Sem o cabeçalho, para embutir dentro de outra tela. */
    embutido?: boolean;
}

const PlantasSuzano: React.FC<Props> = ({ ehMaster, codigoInicial, aoClassificar, embutido }) => {
    const [plantas, setPlantas] = useState<MapaPlantas | null>(null);
    const [carregando, setCarregando] = useState(false);
    const [erro, setErro] = useState<string | null>(null);

    // ---- modal de classificação ----
    const [aberto, setAberto] = useState(false);
    const [codigo, setCodigo] = useState('');
    const [termo, setTermo] = useState('');
    const [escolhido, setEscolhido] = useState<Municipio | null>(null);
    const [municipios, setMunicipios] = useState<Municipio[]>([]);
    const [salvando, setSalvando] = useState(false);
    const [erroSalvar, setErroSalvar] = useState<string | null>(null);

    // ---- cliente do Pipefy ----
    /** Texto buscado e o registro escolhido. null = não mexer no vínculo atual. */
    const [termoCliente, setTermoCliente] = useState('');
    const [clientes, setClientes] = useState<{ id: string; title: string }[]>([]);
    const [clienteEscolhido, setClienteEscolhido] = useState<{ id: string; nome: string } | null>(null);
    const [buscandoCliente, setBuscandoCliente] = useState(false);

    /**
     * Busca na tabela "Clientes" do Pipefy. Só por clique, não a cada tecla:
     * é chamada de rede para fora, e disparar a cada letra encheria de
     * requisições um campo que se usa uma vez por planta.
     */
    const buscarCliente = async () => {
        const q = termoCliente.trim();
        if (q.length < 2) return;
        setBuscandoCliente(true);
        try {
            setClientes(await searchPipefyRecords('cliente', q));
        } finally {
            setBuscandoCliente(false);
        }
    };

    const recarregar = async () => {
        setCarregando(true); setErro(null);
        try {
            const m = await carregarPlantas();
            setPlantas(m);
            return m;
        } catch (e) {
            setErro((e as Error).message);
            return null;
        } finally {
            setCarregando(false);
        }
    };

    useEffect(() => { void recarregar(); }, []);

    // A base do IBGE é um chunk separado, carregado sob demanda. Só se paga por
    // ela quando o modal abre — quem só olha a lista não baixa 5.571 municípios.
    useEffect(() => {
        if (!aberto || municipios.length) return;
        void municipiosParaEscolha().then(setMunicipios).catch(() => {
            setErroSalvar('Não consegui carregar a lista de municípios.');
        });
    }, [aberto, municipios.length]);

    // Abre sozinho quando alguém manda um código (pendência da prévia).
    useEffect(() => {
        if (codigoInicial) abrir(codigoInicial);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [codigoInicial]);

    const abrir = (cod: string) => {
        const atual = plantas?.get(cod);
        setCodigo(cod);
        // Já cadastrada abre com a cidade atual no campo de busca, para corrigir
        // ser tão fácil quanto cadastrar.
        setTermo(atual ? `${atual.cidade}, ${atual.uf}` : '');
        setEscolhido(null);
        setErroSalvar(null);
        // Abre com o vínculo atual à vista; sem escolher nada, ele é preservado.
        setTermoCliente(atual?.pipefyClienteNome ?? '');
        setClientes([]);
        setClienteEscolhido(null);
        setAberto(true);
    };

    const resultados = useMemo(
        () => (termo.trim().length < 2 ? [] : buscarMunicipios(municipios, termo, 8)),
        [municipios, termo],
    );

    const salvar = async () => {
        if (!codigo.trim() || !escolhido) return;
        setSalvando(true); setErroSalvar(null);
        try {
            const r = await classificarPlanta(codigo.trim(), escolhido, clienteEscolhido);
            if (r.error) { setErroSalvar(r.error); return; }
            const m = await recarregar();
            if (m) aoClassificar?.(m);
            setAberto(false); setCodigo(''); setTermo(''); setEscolhido(null);
        } catch (e) {
            setErroSalvar((e as Error).message);
        } finally {
            setSalvando(false);
        }
    };

    const lista: PlantaOrigem[] = plantas ? listarPlantas(plantas) : [];

    return (
        <div className="space-y-4">
            {!embutido && (
                <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-[#1d6fb8] rounded-lg text-white">
                        <Factory className="w-5 h-5" strokeWidth={1.75} />
                    </div>
                    <div>
                        <h2 className="text-lg font-medium text-[#111827]">Plantas da Suzano — origem das cargas</h2>
                        <p className="text-sm font-normal text-[#6b7280]">
                            O OTM manda o código da planta (ex.: FAB_MOG_1110), não a cidade. Aqui ele vira origem.
                        </p>
                    </div>
                </div>
            )}

            {erro && (
                <div className="bg-red-50 border border-red-300 text-red-900 px-6 py-3 rounded-xl flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-red-600" strokeWidth={1.75} />
                    <p className="text-sm font-medium">{erro}</p>
                </div>
            )}

            <div className="bg-white border border-[#e5e7eb] rounded-xl overflow-hidden">
                <div className="px-6 py-4 border-b border-[#e5e7eb] flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm font-medium text-[#111827]">
                        {carregando ? 'Carregando…' : `${lista.length} planta(s) cadastrada(s)`}
                    </p>
                    {ehMaster && (
                        <button type="button" onClick={() => abrir('')}
                            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-[#1d6fb8] hover:bg-[#175a94] transition-colors">
                            Cadastrar planta
                        </button>
                    )}
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-[#f9fafb] text-[10px] uppercase text-[#6b7280]">
                            <tr>
                                <th className="px-3 py-2 text-left font-medium">Código do OTM</th>
                                <th className="px-3 py-2 text-left font-medium">Cidade</th>
                                <th className="px-3 py-2 text-left font-medium">UF</th>
                                <th className="px-3 py-2 text-left font-medium">IBGE</th>
                                <th className="px-3 py-2 text-left font-medium">Cliente Pipefy</th>
                                <th className="px-3 py-2 text-left font-medium"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#f3f4f6]">
                            {lista.map(p => (
                                <tr key={p.codigo} className="hover:bg-[#f9fafb]">
                                    <td className="px-3 py-2 font-mono text-xs">{p.codigo}</td>
                                    <td className="px-3 py-2 text-xs font-medium text-[#111827]">{p.cidade}</td>
                                    <td className="px-3 py-2 text-xs">{p.uf}</td>
                                    <td className="px-3 py-2 text-xs">
                                        {/* Sem IBGE a origem ainda serve para mostrar na tela, mas é a
                                            base oficial que garante a grafia que o Qualp entende. */}
                                        {p.codIbge ?? <span className="text-amber-700 font-semibold">sem código</span>}
                                    </td>
                                    <td className="px-3 py-2 text-xs">
                                        {/* Sem vínculo o card sai sem cliente — por isso âmbar,
                                            e não um traço discreto. */}
                                        {p.pipefyClienteNome
                                            ? <>{p.pipefyClienteNome}<span className="block text-[10px] text-[#9ca3af]">id {p.pipefyClienteId}</span></>
                                            : <span className="text-amber-700 font-semibold">falta vincular</span>}
                                    </td>
                                    <td className="px-3 py-2 text-xs">
                                        {ehMaster && (
                                            <button type="button" onClick={() => abrir(p.codigo)}
                                                className="text-[10px] font-semibold text-[#1d6fb8] hover:underline">
                                                corrigir
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                            {!lista.length && !carregando && (
                                <tr>
                                    <td colSpan={6} className="px-6 py-6 text-center text-xs text-[#6b7280]">
                                        Nenhuma planta cadastrada. Enquanto isso, toda carga de Demais Plantas
                                        fica pendente de origem.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <p className="text-[11px] font-normal text-[#9ca3af] flex items-start gap-2">
                <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" strokeWidth={1.75} />
                A cidade é escolhida da base do IBGE, não digitada — é ela que vira a origem da rota,
                e uma grafia diferente viraria uma distância errada em silêncio. Só master cadastra;
                a trava é da RLS, no servidor.
            </p>

            {/* ---- modal ---- */}
            {aberto && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
                    onClick={() => !salvando && setAberto(false)}>
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4"
                        onClick={e => e.stopPropagation()}>
                        <div>
                            <h3 className="text-lg font-semibold text-[#111827]">
                                {plantas?.has(codigo) ? 'Corrigir origem da planta' : 'Classificar planta do OTM'}
                            </h3>
                            <p className="text-xs font-medium text-[#6b7280] mt-1">
                                O que você escolher vira a origem de toda carga dessa planta — e a base
                                da distância e do piso ANTT.
                            </p>
                        </div>

                        <div>
                            <label className="text-[10px] font-medium uppercase text-[#6b7280] mb-1.5 block">
                                Código da planta (coluna “ID Origem”)
                            </label>
                            <input value={codigo} onChange={e => setCodigo(e.target.value)}
                                placeholder="FAB_MOG_1110"
                                className="w-full px-3 py-2.5 bg-[#f9fafb] border border-[#e5e7eb] rounded-lg text-sm font-mono text-[#111827] outline-none focus:border-[#1d6fb8]" />
                        </div>

                        <div>
                            <label className="text-[10px] font-medium uppercase text-[#6b7280] mb-1.5 block">
                                Cidade da planta
                            </label>
                            <div className="relative">
                                <Search className="w-4 h-4 absolute left-3 top-3 text-[#9ca3af]" strokeWidth={1.75} />
                                <input value={termo}
                                    onChange={e => { setTermo(e.target.value); setEscolhido(null); }}
                                    placeholder="digite para buscar no IBGE…"
                                    className="w-full pl-9 pr-3 py-2.5 bg-[#f9fafb] border border-[#e5e7eb] rounded-lg text-sm font-medium text-[#111827] outline-none focus:border-[#1d6fb8]" />
                            </div>
                            {escolhido ? (
                                <p className="text-[11px] font-semibold text-emerald-700 mt-1.5">
                                    ✓ {escolhido.rotulo} · IBGE {escolhido.codigo}
                                </p>
                            ) : (
                                <div className="mt-1.5 max-h-44 overflow-y-auto">
                                    {resultados.map(m => (
                                        <button key={m.codigo} type="button"
                                            onClick={() => { setEscolhido(m); setTermo(m.rotulo); }}
                                            className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium text-[#111827] hover:bg-[#f3f4f6] transition-colors">
                                            {m.rotulo}
                                            <span className="text-[10px] text-[#9ca3af]"> · IBGE {m.codigo}</span>
                                        </button>
                                    ))}
                                    {termo.trim().length >= 2 && !resultados.length && municipios.length > 0 && (
                                        <p className="text-[11px] font-medium text-amber-700 px-3 py-2">
                                            Nenhum município com esse nome. Confira a grafia.
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>

                        <div>
                            <label className="text-[10px] font-medium uppercase text-[#6b7280] mb-1.5 block">
                                Cliente no Pipefy
                            </label>
                            <div className="flex gap-2">
                                <input value={termoCliente}
                                    onChange={e => { setTermoCliente(e.target.value); setClienteEscolhido(null); }}
                                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void buscarCliente(); } }}
                                    placeholder="Suzano Mucuri…"
                                    className="flex-1 px-3 py-2.5 bg-[#f9fafb] border border-[#e5e7eb] rounded-lg text-sm font-medium text-[#111827] outline-none focus:border-[#1d6fb8]" />
                                <button type="button" onClick={buscarCliente} disabled={buscandoCliente || termoCliente.trim().length < 2}
                                    className="px-3 py-2.5 rounded-lg text-xs font-semibold text-[#1d6fb8] bg-[#f9fafb] border border-[#e5e7eb] hover:bg-[#f3f4f6] disabled:text-[#9ca3af] transition-colors">
                                    {buscandoCliente ? <Loader2 className="w-4 h-4 animate-spin" /> : 'buscar'}
                                </button>
                            </div>
                            {clienteEscolhido ? (
                                <p className="text-[11px] font-semibold text-emerald-700 mt-1.5">
                                    ✓ {clienteEscolhido.nome} · id {clienteEscolhido.id}
                                </p>
                            ) : (
                                <div className="mt-1.5 max-h-32 overflow-y-auto">
                                    {clientes.map(c => (
                                        <button key={c.id} type="button"
                                            onClick={() => { setClienteEscolhido({ id: c.id, nome: c.title }); setTermoCliente(c.title); }}
                                            className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium text-[#111827] hover:bg-[#f3f4f6] transition-colors">
                                            {c.title}
                                            <span className="text-[10px] text-[#9ca3af]"> · id {c.id}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                            <p className="text-[10px] font-medium text-[#6b7280] mt-1.5">
                                {/* O campo Cliente do card é CONEXÃO: vincula pelo id do registro,
                                    não pelo nome. Sem escolher da busca, o card sai sem cliente. */}
                                O card vincula pelo id do registro, não pelo nome — escolha da busca.
                                Sem vínculo, o card vai sem cliente. Deixar como está preserva o atual.
                            </p>
                        </div>

                        {erroSalvar && (
                            <div className="bg-amber-50 border border-amber-300 text-amber-900 px-3 py-2 rounded-lg">
                                <p className="text-xs font-medium">{erroSalvar}</p>
                            </div>
                        )}

                        <div className="flex gap-2 pt-1">
                            <button onClick={() => setAberto(false)} disabled={salvando}
                                className="flex-1 py-2.5 rounded-lg text-sm font-medium text-[#6b7280] bg-[#f9fafb] border border-[#e5e7eb] hover:bg-[#f3f4f6] transition-colors">
                                Cancelar
                            </button>
                            <button onClick={salvar} disabled={!codigo.trim() || !escolhido || salvando}
                                className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#1d6fb8] hover:bg-[#175a94] disabled:bg-[#e5e7eb] disabled:text-[#9ca3af] transition-colors flex items-center justify-center gap-2">
                                {salvando ? <><Loader2 className="w-4 h-4 animate-spin" /> Salvando…</> : 'Salvar'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PlantasSuzano;
