import React, { useMemo, useRef, useState } from 'react';
import { AlertTriangle, FileUp, Info, Loader2, Send, Zap } from 'lucide-react';
import {
    ApoioFastDelivery, LinhaPrevia, ORIGEM_FIXA, ResultadoCotacao, SOLICITANTE_FIXO,
    CARROCERIA_FIXA, MERCADORIA_FIXA, SOLICITANTE_PIPEFY_ID, carregarApoio, clientePipefyId, coletaAjustada,
    corDaMargem, criarCotacoesFastDelivery, lerExcelOtm, marcarJaLancadas,
    classificarEquipamento, tiposDaTabela,
} from '../services/fastDelivery';
import { createPipefyCard } from '../services/pipefy';
import { createRamperCard } from '../services/ramper';

// ============================================================================
// FAST DELIVERY — prévia (Bloco 2 de 3).
//
// Sobe o Excel do OTM, cruza com a tabela de preço e MOSTRA. Nada é gravado:
// não existe botão de criar cotação nesta tela, e isso é deliberado — a
// gravação é o Bloco 3, e antes dela o operador precisa resolver as pendências.
//
// As linhas problemáticas ficam NO TOPO, não misturadas na lista. Uma pendência
// no meio de 70 linhas passa despercebida; no topo, ela é a primeira coisa que
// se vê.
// ============================================================================

interface Props {
    /** Limiar de margem do system_config — o mesmo que a cotação já usa. */
    marginThreshold: number;
    autor: { id?: string; name?: string };
    /**
     * Só master classifica código novo. A tela esconde o botão para os demais;
     * quem realmente impede é a RLS de fast_delivery_equipamento, que exige
     * is_master(). Aqui é conveniência, não proteção.
     */
    ehMaster?: boolean;
    /** Recarrega a lista de cotações do App depois do lote. */
    aoGravar?: () => Promise<void> | void;
}

/** Estado de envio de uma linha já gravada, por destino de integração. */
type EstadoEnvio = { enviando?: boolean; enviado?: boolean; erro?: string };

const brl = (v: number | null) =>
    v === null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const dataCurta = (iso: string | null) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isFinite(d.getTime())
        ? d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
        : '—';
};

const CORES = {
    verde: 'text-emerald-600',
    ambar: 'text-amber-600',
    vermelho: 'text-red-600',
    neutro: 'text-[#9ca3af]',
} as const;

const FastDelivery: React.FC<Props> = ({ marginThreshold, autor, aoGravar, ehMaster }) => {
    const [apoio, setApoio] = useState<ApoioFastDelivery | null>(null);
    const [linhas, setLinhas] = useState<LinhaPrevia[] | null>(null);
    const [colunasFaltando, setColunasFaltando] = useState<string[]>([]);
    const [lendo, setLendo] = useState(false);
    const [erro, setErro] = useState<string | null>(null);
    const [arquivo, setArquivo] = useState('');

    // ---- gravação ----
    const [confirmando, setConfirmando] = useState(false);
    const [gravando, setGravando] = useState(false);
    const [resultados, setResultados] = useState<ResultadoCotacao[] | null>(null);
    const [erroGravacao, setErroGravacao] = useState<string | null>(null);
    const [ramper, setRamper] = useState<Record<string, EstadoEnvio>>({});
    const [pipefy, setPipefy] = useState<Record<string, EstadoEnvio>>({});
    const [criandoUma, setCriandoUma] = useState<Record<string, boolean>>({});
    /** Filtro da lista. 'novas' e o padrao: e o que o operador quer lancar. */
    const [filtro, setFiltro] = useState<'todas' | 'novas' | 'lancadas'>('novas');
    /**
     * O conteúdo da planilha, guardado para reprocessar depois de classificar um
     * código. Sem isto o operador teria de subir o arquivo de novo só para ver a
     * linha sair de pendência — e "suba de novo" é o passo que esta tela existe
     * para eliminar.
     */
    const bufferRef = useRef<ArrayBuffer | null>(null);
    /** Código do OTM que o master está classificando. null = modal fechado. */
    const [classificando, setClassificando] = useState<string | null>(null);
    const [tipoEscolhido, setTipoEscolhido] = useState('');
    const [salvandoTipo, setSalvandoTipo] = useState(false);
    const [erroTipo, setErroTipo] = useState<string | null>(null);

    const { pendentes, prontas, lancadas } = useMemo(() => {
        const todas = linhas ?? [];
        const semPendencia = todas.filter(l => !l.pendencias.length);
        // "Já lançada" cobre os dois casos: a DT que virou cotação num lote
        // anterior, e a que se repete dentro DESTE arquivo.
        const ehLancada = (l: LinhaPrevia) => !!l.jaLancada || !!l.repetidaNoArquivo;
        return {
            pendentes: todas.filter(l => l.pendencias.length),
            prontas: semPendencia.filter(l => !ehLancada(l)),
            lancadas: semPendencia.filter(ehLancada),
        };
    }, [linhas]);

    /** O que a tabela de baixo mostra, conforme o filtro. */
    const visiveis = filtro === 'novas' ? prontas : filtro === 'lancadas' ? lancadas : [...prontas, ...lancadas];

    // Totais do que está À VISTA, não do arquivo inteiro: somar linhas já
    // lançadas contaria de novo dinheiro que já entrou noutro lote.
    const totais = useMemo(() => {
        const r = prontas.reduce((a, l) => ({
            recebido: a.recebido + (l.valorRecebido ?? 0),
            pagar: a.pagar + (l.valorAPagar ?? 0),
        }), { recebido: 0, pagar: 0 });
        const margem = r.recebido - r.pagar;
        return { ...r, margem, percent: r.recebido ? (margem / r.recebido) * 100 : null };
    }, [prontas]);

    const aoSubir = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setLendo(true); setErro(null); setLinhas(null); setArquivo(file.name);
        try {
            const a = apoio ?? await carregarApoio();
            if (!apoio) setApoio(a);
            const buffer = await file.arrayBuffer();
            bufferRef.current = buffer;
            const r = lerExcelOtm(buffer, a);
            if (!r.totalLinhas) { setErro('A planilha não tem linhas de dados.'); return; }
            // Consulta as DTs já lançadas AQUI, no upload: descobrir isso só na
            // hora de gravar seria tarde para quem ainda está decidindo.
            setLinhas(await marcarJaLancadas(r.linhas));
            setColunasFaltando(r.colunasFaltando);
        } catch (err) {
            setErro((err as Error).message);
        } finally {
            setLendo(false);
            e.target.value = '';
        }
    };

    /**
     * Grava o de-para e REPROCESSA a planilha que já está na tela.
     *
     * Reprocessar é o ponto: sem isso o master classificaria o código e a linha
     * continuaria em pendência até alguém subir o arquivo de novo. Como o de-para
     * mudou, o apoio inteiro é relido — a linha volta a ser avaliada do zero e
     * cai onde tiver de cair: vira cotação se houver preço para o novo tipo, ou
     * vira a pendência de "destino sem preço", que é informação diferente e
     * verdadeira, não erro.
     */
    const salvarClassificacao = async () => {
        if (!classificando || !tipoEscolhido || !apoio) return;
        setSalvandoTipo(true); setErroTipo(null);
        try {
            const r = await classificarEquipamento(classificando, tipoEscolhido, apoio);
            if (r.error) { setErroTipo(r.error); return; }

            const novoApoio = await carregarApoio();
            setApoio(novoApoio);
            if (bufferRef.current) {
                const rel = lerExcelOtm(bufferRef.current, novoApoio);
                setLinhas(await marcarJaLancadas(rel.linhas));
                setColunasFaltando(rel.colunasFaltando);
            }
            setClassificando(null); setTipoEscolhido('');
        } catch (e) {
            setErroTipo((e as Error).message);
        } finally {
            setSalvandoTipo(false);
        }
    };

    const gravar = async () => {
        setConfirmando(false); setGravando(true); setErroGravacao(null);
        try {
            const r = await criarCotacoesFastDelivery(prontas, autor);
            setResultados(r);
            // Sem isto, a lista de cotações do OmniFlow continuaria mostrando o
            // estado anterior e o operador acharia que nada foi criado.
            if (r.some(x => x.ok && !x.jaExistia)) await aoGravar?.();
        } catch (e) {
            setErroGravacao((e as Error).message);
        } finally {
            setGravando(false);
        }
    };

    /** Cotação gravada de uma DT, quando houver. */
    const gravada = (dt: string) => resultados?.find(r => r.dt === dt && r.ok && !r.jaExistia);

    const enviarRamper = async (l: LinhaPrevia) => {
        const r = gravada(l.referencia);
        if (!r) return;
        setRamper(p => ({ ...p, [l.referencia]: { enviando: true } }));
        // Mesma integração da cotação normal — nenhum caminho novo.
        const res = await createRamperCard({
            title: `${r.proposta} · ${l.cidadeOriginal}${l.uf ? `/${l.uf}` : ''}`,
            value: l.valorRecebido ?? 0,
            organizationName: 'Suzano Fast',
            solicitante: SOLICITANTE_FIXO,
            tipoDeVeiculo: l.tipoVeiculo ?? undefined,
            documento: l.referencia,
            responsavelEmail: undefined,
        });
        setRamper(p => ({
            ...p,
            [l.referencia]: res?.error ? { erro: res.error } : { enviado: true },
        }));
    };

    const enviarPipefy = async (l: LinhaPrevia) => {
        const r = gravada(l.referencia);
        if (!r) return;
        setPipefy(p => ({ ...p, [l.referencia]: { enviando: true } }));
        // Card em fase e campos que JÁ EXISTEM. Nada de estrutura é tocado.
        // Os campos "Cliente" e "Solicitante da Carga" são CONEXÕES: preenchem
        // pelo ID do registro no Pipefy, não pelo nome. Sem os ids os dois ficam
        // vazios no card — e o título, que sai do nome do cliente, sai errado
        // junto. Por isso os dois vão sempre em par: nome e id.
        const idCliente = await clientePipefyId();
        const res = await createPipefyCard({
            // Título = só o nome do cliente. O Wagner filtra pela DT, que já vai
            // no campo de solicitação — DT e destino no título só poluiriam.
            titulo: 'Suzano Fast',
            rota: `${ORIGEM_FIXA} > ${l.cidadeOriginal}${l.uf ? `/${l.uf}` : ''}`,
            receita: l.valorRecebido ?? 0,
            freteTerceiro: l.valorAPagar ?? 0,
            valorCarga: 0,
            peso: l.peso ?? undefined,
            veiculo: l.tipoVeiculo ?? undefined,
            mercadoria: MERCADORIA_FIXA,
            implemento: CARROCERIA_FIXA,
            // Mesma antecipação de uma hora que foi gravada na cotação.
            dataColeta: coletaAjustada(l.dataColeta) ?? undefined,
            localEntrega: l.cliente || undefined,
            referencia: l.referencia,
            cliente: 'Suzano Fast',
            clienteId: idCliente ?? undefined,
            solicitante: SOLICITANTE_FIXO,
            solicitanteId: SOLICITANTE_PIPEFY_ID,
            observacoes: l.volume !== null ? `Volume: ${l.volume} m³` : undefined,
        });
        setPipefy(p => ({
            ...p,
            [l.referencia]: res?.error ? { erro: res.error } : { enviado: true },
        }));
    };

    const BotaoEnvio: React.FC<{ l: LinhaPrevia; alvo: 'ramper' | 'pipefy' }> = ({ l, alvo }) => {
        const mapa = alvo === 'ramper' ? ramper : pipefy;
        const e = mapa[l.referencia] ?? {};
        const rotulo = alvo === 'ramper' ? 'Ramper' : 'Pipefy';
        // Enviado trava o botão. Erro NÃO trava: se não foi, tem que dar para
        // tentar de novo — travar em "enviado" o que não enviou seria mentira.
        if (e.enviado) {
            return <span className="text-[10px] font-semibold text-emerald-700">✓ enviado ao {rotulo}</span>;
        }
        return (
            <div className="flex flex-col items-start gap-0.5">
                <button type="button" disabled={e.enviando}
                    onClick={() => (alvo === 'ramper' ? enviarRamper(l) : enviarPipefy(l))}
                    className="text-[10px] font-semibold text-[#1d6fb8] hover:underline disabled:text-[#9ca3af]">
                    {e.enviando ? 'enviando…' : `→ ${rotulo}`}
                </button>
                {e.erro && <span className="text-[10px] font-medium text-red-600 max-w-[160px]">{e.erro}</span>}
            </div>
        );
    };

    /** Lança UMA linha. Mesma função do lote, com uma linha só. */
    const criarUma = async (l: LinhaPrevia) => {
        setCriandoUma(p => ({ ...p, [l.referencia]: true }));
        try {
            const r = await criarCotacoesFastDelivery([l], autor);
            setResultados(p => [...(p ?? []).filter(x => x.dt !== l.referencia), ...r]);
            if (r.some(x => x.ok && !x.jaExistia)) await aoGravar?.();
        } finally {
            setCriandoUma(p => ({ ...p, [l.referencia]: false }));
        }
    };

    /** O que aconteceu com esta DT depois de gravar, e os envios. */
    const ColunaCotacao: React.FC<{ l: LinhaPrevia }> = ({ l }) => {
        // DT já lançada não ganha botão: relançar criaria a segunda cotação da
        // mesma carga, que é o erro que a operação não pode cometer.
        if (l.jaLancada || l.repetidaNoArquivo) {
            return (
                <span className="text-amber-700 font-medium text-[11px]">
                    {l.jaLancada ? `já lançada · ${l.jaLancada}` : 'repetida nesta planilha'}
                </span>
            );
        }
        const r = resultados?.find(x => x.dt === l.referencia);
        if (!r) {
            return (
                <button type="button" disabled={!!criandoUma[l.referencia]}
                    onClick={() => criarUma(l)}
                    className="text-[10px] font-semibold text-white bg-[#1d6fb8] hover:bg-[#175a94] disabled:bg-[#e5e7eb] disabled:text-[#9ca3af] px-2.5 py-1.5 rounded transition-colors">
                    {criandoUma[l.referencia] ? 'criando…' : 'Criar cotação'}
                </button>
            );
        }
        if (!r.ok) return <span className="text-red-600 font-medium">falhou: {r.erro}</span>;
        if (r.jaExistia) {
            return (
                <span className="text-amber-700 font-medium">
                    DT já lançada
                    <span className="block text-[10px] font-normal">{r.proposta} — não dupliquei</span>
                </span>
            );
        }
        return (
            <div className="flex flex-col gap-1">
                <span className="font-semibold text-emerald-700">{r.proposta}</span>
                <div className="flex gap-3">
                    <BotaoEnvio l={l} alvo="ramper" />
                    <BotaoEnvio l={l} alvo="pipefy" />
                </div>
            </div>
        );
    };

    const Linha: React.FC<{ l: LinhaPrevia; pendente?: boolean }> = ({ l, pendente }) => {
        const cor = CORES[corDaMargem(l.margemPercent, marginThreshold)];
        return (
            <>
            <tr className={pendente ? 'bg-amber-50/60' : 'hover:bg-[#f9fafb]'}>
                <td className="px-3 py-2 font-mono text-xs">{l.referencia || '—'}</td>
                <td className="px-3 py-2 text-xs">
                    {dataCurta(coletaAjustada(l.dataColeta))}
                    <span className="block text-[10px] text-[#9ca3af]">OTM {dataCurta(l.dataColeta)}</span>
                </td>
                <td className="px-3 py-2 text-xs">
                    {l.cidadeOriginal || '—'}{l.uf ? `/${l.uf}` : ''}
                    <span className="block text-[10px] text-[#9ca3af]">{l.cliente}</span>
                </td>
                <td className="px-3 py-2 text-xs">
                    {l.tipoVeiculo ?? <span className="text-amber-700 font-semibold">?</span>}
                    <span className="block text-[10px] text-[#9ca3af]">cód. {l.codigoEquipamento || '—'}</span>
                </td>
                {/* A placa saiu: vinha vazia do OTM quase sempre. O volume é o
                    dado que decide se a carga cabe no veículo. */}
                <td className="px-3 py-2 text-xs text-right">
                    {l.volume !== null
                        ? <span className={l.alertaVolume ? 'font-semibold text-amber-700' : ''}>
                            {l.volume.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}
                        </span>
                        : '—'}
                    {l.alertaVolume && (
                        <span className="block text-[10px] font-medium text-amber-700">
                            {Math.round(l.alertaVolume.ocupacao * 100)}% do {l.alertaVolume.tipoVeiculo}
                        </span>
                    )}
                </td>
                <td className="px-3 py-2 text-xs text-right">{l.peso !== null ? `${l.peso} kg` : '—'}</td>
                <td className="px-3 py-2 text-xs text-right font-medium">{brl(l.valorRecebido)}</td>
                <td className="px-3 py-2 text-xs text-right font-medium">{brl(l.valorAPagar)}</td>
                <td className={`px-3 py-2 text-xs text-right font-semibold ${cor}`}>
                    {brl(l.margem)}
                    <span className="block text-[10px] font-medium">
                        {l.margemPercent === null ? '' : `${l.margemPercent.toFixed(1)}%`}
                    </span>
                </td>
                <td className="px-3 py-2 text-xs">{pendente ? <span className="text-[#9ca3af]">—</span> : <ColunaCotacao l={l} />}</td>
            </tr>
            {/* AVISO, não bloqueio: a linha continua cotável e o botão de criar
                segue ativo. Quem conhece a carga é o operador — há carga que
                passa da conta e entra assim mesmo. */}
            {l.alertaVolume && !pendente && (
                <tr className="bg-amber-50/40">
                    <td colSpan={10} className="px-3 pb-2 pt-0">
                        <span className="text-[11px] font-medium text-[#92400e] flex items-center gap-1.5">
                            <AlertTriangle className="w-3 h-3 text-amber-600 shrink-0" strokeWidth={2} />
                            {l.alertaVolume.texto} — confira antes de fechar. Dá para cotar assim mesmo.
                        </span>
                    </td>
                </tr>
            )}
            </>
        );
    };

    const Cabecalho = () => (
        <thead className="bg-[#f9fafb] text-[10px] uppercase text-[#6b7280]">
            <tr>
                <th className="px-3 py-2 text-left font-medium">DT</th>
                <th className="px-3 py-2 text-left font-medium">Coleta (−1h)</th>
                <th className="px-3 py-2 text-left font-medium">Destino / cliente</th>
                <th className="px-3 py-2 text-left font-medium">Veículo</th>
                <th className="px-3 py-2 text-right font-medium">Volume m³</th>
                <th className="px-3 py-2 text-right font-medium">Peso</th>
                <th className="px-3 py-2 text-right font-medium">Recebido</th>
                <th className="px-3 py-2 text-right font-medium">A pagar</th>
                <th className="px-3 py-2 text-right font-medium">Margem</th>
                <th className="px-3 py-2 text-left font-medium">Cotação</th>
            </tr>
        </thead>
    );

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3">
                <div className="p-2.5 bg-[#1d6fb8] rounded-lg text-white"><Zap className="w-5 h-5" strokeWidth={1.75} /></div>
                <div>
                    <h2 className="text-lg font-medium text-[#111827]">Fast Delivery — prévia</h2>
                    <p className="text-sm font-normal text-[#6b7280]">
                        Suba o Excel do OTM. Origem sempre {ORIGEM_FIXA}; o valor a pagar vem da tabela de preço.
                    </p>
                </div>
            </div>

            {/* upload */}
            <div className="bg-white border border-[#e5e7eb] rounded-xl p-6 flex flex-wrap items-center gap-4">
                <label className={`cursor-pointer flex items-center gap-2 px-5 py-3 rounded-lg border text-xs font-medium transition-colors ${lendo
                    ? 'bg-[#f3f4f6] border-[#e5e7eb] text-[#9ca3af] cursor-wait'
                    : 'bg-white border-[#e5e7eb] text-[#111827] hover:bg-[#f9fafb]'}`}>
                    <input type="file" className="hidden" accept=".xlsx,.xls"
                        onChange={aoSubir} disabled={lendo} />
                    {lendo ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" strokeWidth={1.75} />}
                    {lendo ? 'Lendo…' : 'Subir Excel do OTM'}
                </label>
                <span className="text-xs font-normal text-[#6b7280]">
                    {arquivo || 'Arquivo .xlsx exportado do OTM.'}
                </span>
                {linhas && (
                    <span className="ml-auto text-xs font-medium text-[#6b7280]">
                        {linhas.length} linha(s) · {prontas.length} nova(s) · {lancadas.length} já lançada(s) · {pendentes.length} com pendência
                    </span>
                )}
            </div>

            {erro && (
                <div className="bg-red-50 border border-red-300 text-red-900 px-6 py-3 rounded-xl flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-red-600" strokeWidth={1.75} />
                    <p className="text-sm font-medium">{erro}</p>
                </div>
            )}

            {!!colunasFaltando.length && (
                <div className="bg-amber-50 border border-amber-300 text-amber-900 px-6 py-3 rounded-xl flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" strokeWidth={1.75} />
                    <div>
                        <p className="text-sm font-semibold">Colunas não encontradas na planilha</p>
                        <p className="text-xs font-medium opacity-90 mt-0.5">
                            {colunasFaltando.join(', ')}. Os campos correspondentes ficaram vazios —
                            confira se o arquivo é o export certo do OTM.
                        </p>
                    </div>
                </div>
            )}

            {/* pendências primeiro */}
            {!!pendentes.length && (
                <div className="bg-white border-2 border-amber-300 rounded-xl overflow-hidden">
                    <div className="px-6 py-4 bg-amber-50 border-b border-amber-200">
                        <p className="text-sm font-semibold text-[#92400e] flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 text-amber-600" strokeWidth={1.75} />
                            {pendentes.length} linha(s) precisam de você antes de virar cotação
                        </p>
                        <p className="text-xs font-medium text-[#92400e] mt-1">
                            Não inventei valor para nenhuma delas. Resolva o que está apontado e suba de novo.
                        </p>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <Cabecalho />
                            <tbody className="divide-y divide-[#f3f4f6]">
                                {pendentes.map(l => (
                                    <React.Fragment key={`p-${l.linhaExcel}`}>
                                        <Linha l={l} pendente />
                                        <tr className="bg-amber-50/60">
                                            <td colSpan={9} className="px-3 pb-2 pt-0">
                                                {l.pendencias.map((p, i) => (
                                                    <span key={i} className="text-[11px] font-medium text-[#92400e] flex flex-wrap items-center gap-2">
                                                        <span>linha {l.linhaExcel} · {p.texto}</span>
                                                        {/* Só o master classifica. O operador continua vendo a
                                                            pendência — ele precisa saber que apareceu código novo —,
                                                            mas quem resolve é quem responde pela tabela de preço. */}
                                                        {p.motivo === 'equipamento' && ehMaster && !!l.codigoEquipamento && (
                                                            <button type="button"
                                                                onClick={() => { setClassificando(l.codigoEquipamento); setTipoEscolhido(''); setErroTipo(null); }}
                                                                className="px-2 py-0.5 rounded text-[10px] font-semibold text-white bg-[#1d6fb8] hover:bg-[#175a94] transition-colors">
                                                                Classificar código
                                                            </button>
                                                        )}
                                                    </span>
                                                ))}
                                            </td>
                                        </tr>
                                    </React.Fragment>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* prontas e já lançadas, com filtro */}
            {/* -------------------------------------------------------------
                Classificar um código do OTM que ainda não está no de-para.
                A lista de tipos vem da TABELA DE PREÇO, não de constante: um
                tipo sem preço cadastrado deixaria a linha "resolvida" e ainda
                assim impossível de cotar.
               ------------------------------------------------------------- */}
            {classificando && apoio && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
                    onClick={() => !salvandoTipo && setClassificando(null)}>
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
                        <div>
                            <h3 className="text-lg font-semibold text-[#111827]">Classificar código do OTM</h3>
                            <p className="text-xs font-medium text-[#6b7280] mt-1">
                                Código <strong className="text-[#111827]">{classificando}</strong> ainda não tem
                                tipo de veículo. O que você escolher fica valendo para as próximas planilhas.
                            </p>
                        </div>

                        <div>
                            <label className="text-[10px] font-medium uppercase text-[#6b7280] mb-1.5 block">
                                Tipo de veículo
                            </label>
                            <select value={tipoEscolhido} onChange={e => setTipoEscolhido(e.target.value)}
                                className="w-full px-3 py-2.5 bg-[#f9fafb] border border-[#e5e7eb] rounded-lg text-sm font-medium text-[#111827] outline-none focus:border-[#1d6fb8]">
                                <option value="">— selecione —</option>
                                {tiposDaTabela(apoio).map(tp => <option key={tp} value={tp}>{tp}</option>)}
                            </select>
                            <p className="text-[10px] font-medium text-[#6b7280] mt-1.5">
                                Só aparecem os tipos que existem na tabela de preço.
                            </p>
                        </div>

                        {erroTipo && (
                            <div className="bg-amber-50 border border-amber-300 text-amber-900 px-3 py-2 rounded-lg">
                                <p className="text-xs font-medium">{erroTipo}</p>
                            </div>
                        )}

                        <div className="flex gap-2 pt-1">
                            <button onClick={() => setClassificando(null)} disabled={salvandoTipo}
                                className="flex-1 py-2.5 rounded-lg text-sm font-medium text-[#6b7280] bg-[#f9fafb] border border-[#e5e7eb] hover:bg-[#f3f4f6] transition-colors">
                                Cancelar
                            </button>
                            <button onClick={salvarClassificacao} disabled={!tipoEscolhido || salvandoTipo}
                                className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#1d6fb8] hover:bg-[#175a94] disabled:bg-[#e5e7eb] disabled:text-[#9ca3af] transition-colors flex items-center justify-center gap-2">
                                {salvandoTipo ? <><Loader2 className="w-4 h-4 animate-spin" /> Salvando…</> : 'Salvar e recalcular'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {!!(prontas.length + lancadas.length) && (
                <div className="bg-white border border-[#e5e7eb] rounded-xl overflow-hidden">
                    <div className="px-6 py-4 border-b border-[#e5e7eb] flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                            {([
                                ['novas', `Novas (${prontas.length})`],
                                ['lancadas', `Já lançadas (${lancadas.length})`],
                                ['todas', `Todas (${prontas.length + lancadas.length})`],
                            ] as Array<['novas' | 'lancadas' | 'todas', string]>).map(([id, rotulo]) => (
                                <button key={id} type="button" onClick={() => setFiltro(id)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${filtro === id
                                        ? 'bg-[#1d6fb8] border-[#1d6fb8] text-white'
                                        : 'bg-white border-[#e5e7eb] text-[#6b7280] hover:bg-[#f9fafb]'}`}>
                                    {rotulo}
                                </button>
                            ))}
                        </div>
                        <div className="flex flex-wrap gap-5 text-xs">
                            <span className="text-[#6b7280]">Recebido <strong className="text-[#111827]">{brl(totais.recebido)}</strong></span>
                            <span className="text-[#6b7280]">A pagar <strong className="text-[#111827]">{brl(totais.pagar)}</strong></span>
                            <span className="text-[#6b7280]">
                                Margem{' '}
                                <strong className={CORES[corDaMargem(totais.percent, marginThreshold)]}>
                                    {brl(totais.margem)}{totais.percent !== null ? ` (${totais.percent.toFixed(1)}%)` : ''}
                                </strong>
                            </span>
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <Cabecalho />
                            <tbody className="divide-y divide-[#f3f4f6]">
                                {visiveis.length
                                    ? visiveis.map(l => <Linha key={l.linhaExcel} l={l} />)
                                    : (
                                        <tr>
                                            <td colSpan={10} className="px-6 py-6 text-center text-xs text-[#6b7280]">
                                                {filtro === 'novas'
                                                    ? 'Nenhuma linha nova: todas as DTs desta planilha já foram lançadas.'
                                                    : 'Nenhuma linha neste filtro.'}
                                            </td>
                                        </tr>
                                    )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* gravar */}
            {!!prontas.length && (
                <div className="flex flex-wrap items-center gap-4">
                    <button onClick={() => setConfirmando(true)}
                        disabled={gravando || !!pendentes.length || !!resultados}
                        className="px-6 py-3 rounded-lg text-sm font-semibold text-white bg-[#1d6fb8] hover:bg-[#175a94] disabled:bg-[#e5e7eb] disabled:text-[#9ca3af] disabled:cursor-not-allowed transition-colors flex items-center gap-2">
                        {gravando
                            ? <><Loader2 className="w-4 h-4 animate-spin" /> Criando…</>
                            : <><Send className="w-4 h-4" strokeWidth={1.75} /> Criar {prontas.length} cotações</>}
                    </button>
                    {!!pendentes.length && (
                        <span className="text-xs font-medium text-amber-700">
                            Resolva as {pendentes.length} pendência(s) acima antes de criar. As linhas
                            pendentes não são gravadas.
                        </span>
                    )}
                    {resultados && (
                        <span className="text-xs font-medium text-[#6b7280]">
                            Lote já processado. Suba a planilha de novo para um lote novo.
                        </span>
                    )}
                </div>
            )}

            {erroGravacao && (
                <div className="bg-red-50 border border-red-300 text-red-900 px-6 py-3 rounded-xl flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-red-600" strokeWidth={1.75} />
                    <p className="text-sm font-medium">{erroGravacao}</p>
                </div>
            )}

            {/* confirmação */}
            {confirmando && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl p-6 max-w-md w-full">
                        <h3 className="text-base font-semibold text-[#111827] mb-1">Criar cotações Fast Delivery</h3>
                        <p className="text-xs font-normal text-[#6b7280] mb-4">
                            Isto grava no OmniFlow. DT já lançada é pulada, não duplicada.
                        </p>
                        <dl className="text-sm space-y-1.5 mb-6">
                            {([
                                ['Cotações', String(prontas.length)],
                                ['Cliente', 'Suzano Fast'],
                                ['Solicitante', SOLICITANTE_FIXO],
                                ['Total recebido', brl(totais.recebido)],
                                ['Total a pagar', brl(totais.pagar)],
                                ['Margem', `${brl(totais.margem)}${totais.percent !== null ? ` (${totais.percent.toFixed(1)}%)` : ''}`],
                            ] as Array<[string, string]>).map(([k, v]) => (
                                <div key={k} className="flex justify-between gap-4">
                                    <dt className="text-[#6b7280] font-normal">{k}</dt>
                                    <dd className="font-semibold text-[#111827] text-right">{v}</dd>
                                </div>
                            ))}
                        </dl>
                        <div className="flex gap-2 justify-end">
                            <button onClick={() => setConfirmando(false)}
                                className="px-4 py-2.5 rounded-lg text-xs font-semibold text-[#6b7280] hover:bg-[#f3f4f6]">Cancelar</button>
                            <button onClick={gravar}
                                className="px-4 py-2.5 rounded-lg text-xs font-semibold text-white bg-[#1d6fb8] hover:bg-[#175a94]">Criar</button>
                        </div>
                    </div>
                </div>
            )}

            {/* relato do lote */}
            {resultados && (() => {
                const criadas = resultados.filter(r => r.ok && !r.jaExistia);
                const puladas = resultados.filter(r => r.jaExistia);
                const falhas = resultados.filter(r => !r.ok);
                return (
                    <div className={`px-6 py-4 rounded-xl border ${falhas.length ? 'bg-amber-50 border-amber-300' : 'bg-emerald-50 border-emerald-300'}`}>
                        <p className={`text-sm font-semibold ${falhas.length ? 'text-[#92400e]' : 'text-emerald-900'}`}>
                            {criadas.length} criada(s)
                            {puladas.length ? ` · ${puladas.length} pulada(s) por DT já lançada` : ''}
                            {falhas.length ? ` · ${falhas.length} falhou(ram)` : ''}
                        </p>
                        {!!falhas.length && (
                            <div className="mt-2">
                                {falhas.map(f => (
                                    <p key={f.dt} className="text-xs font-medium text-red-900">DT {f.dt}: {f.erro}</p>
                                ))}
                                <p className="text-xs font-medium text-[#92400e] mt-1">
                                    As criadas acima JÁ ESTÃO no OmniFlow e não foram desfeitas — corrija só as que falharam.
                                </p>
                            </div>
                        )}
                        <p className="text-[11px] font-normal text-[#6b7280] mt-2">
                            Use os links → Ramper e → Pipefy na coluna Cotação de cada linha.
                        </p>
                    </div>
                );
            })()}

            {linhas && (
                <p className="text-[11px] font-normal text-[#9ca3af] flex items-start gap-2">
                    <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" strokeWidth={1.75} />
                    Isto é só prévia — nada foi gravado. A criação das cotações é o próximo passo.
                    A margem usa o mesmo limiar da cotação ({marginThreshold}%): verde acima dele,
                    âmbar entre zero e ele, vermelho em zero ou negativo.
                </p>
            )}
        </div>
    );
};

export default FastDelivery;
