import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, FileUp, Info, Loader2, RefreshCw, Send, Zap } from 'lucide-react';
import {
    // MERCADORIA_FIXA, SOLICITANTE_PIPEFY_ID e clientePipefyId saíram daqui: a
    // montagem do card do Pipefy passou para o service, onde prévia e histórico
    // usam a MESMA função — com a trava que consulta o banco antes de mandar.
    ApoioFastDelivery, LinhaPrevia, ORIGEM_FIXA, ResultadoCotacao, SOLICITANTE_FIXO,
    carregarApoio, coletaAjustada,
    corDaMargem, criarCotacoesFastDelivery, lerExcelOtm, marcarJaLancadas,
    classificarEquipamento, tiposDaTabela, CARROCERIAS, CARROCERIA_PADRAO, codigosSemCarroceria,
    CotacaoHistorico, carregarHistoricoFastDelivery, enviarCargaAoPipefy, enviarCargaAoRamper, LIMITE_HISTORICO,
} from '../services/fastDelivery';

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
    const [carroceriaEscolhida, setCarroceriaEscolhida] = useState('');
    const [salvandoTipo, setSalvandoTipo] = useState(false);
    const [erroTipo, setErroTipo] = useState<string | null>(null);

    /**
     * Abre o modal já preenchido com o que o código tem.
     *
     * O mesmo modal serve para os dois casos, e é o pré-preenchimento que os
     * separa: código novo abre vazio; código antigo abre com o veículo dele e o
     * master só escolhe a carroceria que falta. Um modal só de "definir
     * carroceria" seria uma segunda tela para a mesma decisão.
     */
    const abrirClassificacao = (codigo: string) => {
        const atual = apoio?.equipamentos.get(codigo);
        setClassificando(codigo);
        setTipoEscolhido(atual?.tipo_veiculo ?? '');
        setCarroceriaEscolhida(atual?.carroceria ?? '');
        setErroTipo(null);
    };

    /** Códigos que já têm veículo mas ainda não têm carroceria. */
    const semCarroceria = useMemo(() => (apoio ? codigosSemCarroceria(apoio) : []), [apoio]);

    // ---- histórico ----
    /** Prévia é o padrão: é o que o operador vem fazer aqui todo dia. */
    const [aba, setAba] = useState<'previa' | 'historico'>('previa');
    const [historico, setHistorico] = useState<CotacaoHistorico[] | null>(null);
    const [carregandoHist, setCarregandoHist] = useState(false);
    const [erroHist, setErroHist] = useState<string | null>(null);
    /** Envio em curso, por cotação e destino. Desabilita o botão e evita o duplo clique. */
    const [enviandoHist, setEnviandoHist] = useState<Record<string, boolean>>({});
    const [erroEnvioHist, setErroEnvioHist] = useState<Record<string, string>>({});

    /**
     * Relê o histórico do banco.
     *
     * Chamado ao abrir a aba e DEPOIS DE CADA ENVIO — é a releitura que faz o
     * status na tela vir do banco, e não de um palpite otimista. Se a gravação
     * do envio falhar, a linha volta mostrando "não enviado", que é a verdade.
     */
    const recarregarHistorico = async () => {
        setCarregandoHist(true); setErroHist(null);
        try {
            setHistorico(await carregarHistoricoFastDelivery());
        } catch (e) {
            setErroHist((e as Error).message);
        } finally {
            setCarregandoHist(false);
        }
    };

    // Carrega ao entrar na aba, e só então: quem só usa a prévia não paga por
    // uma consulta de 500 linhas que não vai olhar.
    useEffect(() => {
        if (aba === 'historico' && historico === null && !carregandoHist) void recarregarHistorico();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [aba]);

    /**
     * Envia uma carga do histórico e RELÊ do banco.
     *
     * A trava mora no service, que consulta a linha antes de mandar. Aqui só se
     * cuida de não deixar clicar duas vezes enquanto a primeira ainda corre.
     */
    const enviarDoHistorico = async (c: CotacaoHistorico, alvo: 'pipefy' | 'ramper') => {
        const chave = `${c.id}:${alvo}`;
        if (enviandoHist[chave]) return;
        setEnviandoHist(p => ({ ...p, [chave]: true }));
        setErroEnvioHist(p => { const q = { ...p }; delete q[chave]; return q; });
        try {
            const r = alvo === 'pipefy' ? await enviarCargaAoPipefy(c) : await enviarCargaAoRamper(c);
            if (r.erro) setErroEnvioHist(p => ({ ...p, [chave]: r.erro! }));
            await recarregarHistorico();
        } catch (e) {
            setErroEnvioHist(p => ({ ...p, [chave]: (e as Error).message }));
        } finally {
            setEnviandoHist(p => ({ ...p, [chave]: false }));
        }
    };

    /**
     * Carrega o apoio ao ABRIR a tela, sem esperar planilha.
     *
     * É o que faz a lista de códigos sem carroceria aparecer para o master
     * assim que ele entra. Amarrada ao upload, ela só existiria depois de subir
     * um Excel — e completar o de-para é justamente o trabalho que se faz ANTES
     * de subir, para a planilha já nascer certa.
     *
     * Falha em silêncio de propósito: isto alimenta um aviso, e o upload
     * recarrega o apoio de qualquer jeito e aí sim reporta o erro na cara.
     */
    useEffect(() => {
        let vivo = true;
        carregarApoio().then(a => { if (vivo) setApoio(p => p ?? a); }).catch(() => {});
        return () => { vivo = false; };
    }, []);

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
        if (!classificando || !tipoEscolhido || !carroceriaEscolhida || !apoio) return;
        setSalvandoTipo(true); setErroTipo(null);
        try {
            const r = await classificarEquipamento(classificando, tipoEscolhido, carroceriaEscolhida, apoio);
            if (r.error) { setErroTipo(r.error); return; }

            const novoApoio = await carregarApoio();
            setApoio(novoApoio);
            if (bufferRef.current) {
                const rel = lerExcelOtm(bufferRef.current, novoApoio);
                setLinhas(await marcarJaLancadas(rel.linhas));
                setColunasFaltando(rel.colunasFaltando);
            }
            setClassificando(null); setTipoEscolhido(''); setCarroceriaEscolhida('');
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

    /**
     * A linha da prévia, no formato que o envio entende.
     *
     * Existe para que prévia e histórico usem A MESMA função de envio — a que
     * confere o banco antes de mandar. Antes, a prévia montava o payload do
     * Pipefy aqui dentro e o histórico montaria outro: duas versões do mesmo
     * card, fadadas a divergir, e só uma delas com trava.
     *
     * Os campos saem da linha e da cotação recém-gravada; `id` é o que amarra
     * tudo, porque é por ele que a trava consulta a linha.
     */
    const previaComoCarga = (l: LinhaPrevia, cotacaoId: string, proposta: string): CotacaoHistorico => ({
        id: cotacaoId,
        proposta,
        dt: l.referencia,
        criadaEm: Date.now(),
        destino: `${l.cidadeOriginal}${l.uf ? `/${l.uf}` : ''}`,
        cliente: l.cliente,
        tipoVeiculo: l.tipoVeiculo,
        carroceria: l.carroceriaEfetiva,
        peso: l.peso,
        // A MESMA antecipação de uma hora que foi gravada na cotação.
        coletaEm: coletaAjustada(l.dataColeta),
        observacoes: l.volume !== null ? `Volume: ${l.volume} m³` : null,
        valorRecebido: l.valorRecebido,
        valorAPagar: l.valorAPagar,
        margem: l.margem,
        margemPercent: l.margemPercent,
        pipefySentAt: null, pipefyCardId: null, pipefyCardUrl: null, ramperSentAt: null,
    });

    /**
     * Envia da prévia. Agora pelo mesmo caminho do histórico, o que traz junto
     * a trava que consulta o banco: reenviar depois de um F5 devolve "já
     * enviado" em vez de criar o segundo card.
     */
    const enviarDaPrevia = async (l: LinhaPrevia, alvo: 'ramper' | 'pipefy') => {
        const r = gravada(l.referencia);
        if (!r?.id || !r.proposta) return;
        const set = alvo === 'ramper' ? setRamper : setPipefy;
        set(p => ({ ...p, [l.referencia]: { enviando: true } }));
        const carga = previaComoCarga(l, r.id, r.proposta);
        const res = alvo === 'ramper' ? await enviarCargaAoRamper(carga) : await enviarCargaAoPipefy(carga);
        set(p => ({
            ...p,
            [l.referencia]: res.erro ? { erro: res.erro } : { enviado: true },
        }));
        // O histórico, se já estiver carregado, precisa refletir o envio.
        if (historico !== null) void recarregarHistorico();
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
                    onClick={() => enviarDaPrevia(l, alvo)}
                    className="text-[10px] font-semibold text-[#1d6fb8] hover:underline disabled:text-[#9ca3af]">
                    {e.enviando ? 'enviando…' : `→ ${rotulo}`}
                </button>
                {e.erro && <span className="text-[10px] font-medium text-red-600 max-w-[160px]">{e.erro}</span>}
            </div>
        );
    };

    /**
     * Status de envio de uma carga do histórico, e o botão quando falta enviar.
     *
     * O estado vem do BANCO (`pipefySentAt`/`ramperSentAt` da própria linha),
     * não de um useState — é isso que faz o "enviado" continuar verdadeiro
     * depois de recarregar a página, em outra aba ou em outra máquina.
     */
    const EnvioHistorico: React.FC<{ c: CotacaoHistorico; alvo: 'pipefy' | 'ramper' }> = ({ c, alvo }) => {
        const enviadoEm = alvo === 'pipefy' ? c.pipefySentAt : c.ramperSentAt;
        const chave = `${c.id}:${alvo}`;
        const erro = erroEnvioHist[chave];
        const ocupado = !!enviandoHist[chave];

        if (enviadoEm) {
            const link = alvo === 'pipefy'
                ? (c.pipefyCardUrl || (c.pipefyCardId ? `https://app.pipefy.com/open-cards/${c.pipefyCardId}` : null))
                : null;
            return (
                <div className="flex flex-col items-start gap-0.5">
                    <span className="text-[10px] font-semibold text-emerald-700">✓ enviado</span>
                    <span className="text-[10px] text-[#9ca3af]">{dataCurta(enviadoEm)}</span>
                    {link && (
                        <a href={link} target="_blank" rel="noopener noreferrer"
                            className="text-[10px] font-semibold text-[#1d6fb8] hover:underline">
                            abrir card
                        </a>
                    )}
                </div>
            );
        }
        return (
            <div className="flex flex-col items-start gap-0.5">
                <button type="button" disabled={ocupado}
                    onClick={() => enviarDoHistorico(c, alvo)}
                    className="text-[10px] font-semibold text-white bg-[#1d6fb8] hover:bg-[#175a94] disabled:bg-[#e5e7eb] disabled:text-[#9ca3af] px-2 py-1 rounded transition-colors">
                    {ocupado ? 'enviando…' : `→ ${alvo === 'pipefy' ? 'Pipefy' : 'Ramper'}`}
                </button>
                {/* Erro NÃO vira "enviado": se não foi, o botão continua ali. E
                    quando o card foi criado mas o registro falhou, a mensagem do
                    service diz isso com todas as letras — para ninguém reenviar. */}
                {erro && <span className="text-[10px] font-medium text-red-600 max-w-[180px] block">{erro}</span>}
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
                    {/* A carroceria só aparece quando há veículo: sem de-para,
                        anunciar "Baú" seria informação inventada sobre uma linha
                        que ainda nem sabe que carro é. */}
                    {l.tipoVeiculo && (
                        <span className={l.carroceria ? 'text-[#6b7280]' : 'text-amber-700 font-semibold'}>
                            {' · '}{l.carroceriaEfetiva}{l.carroceria ? '' : ' ?'}
                        </span>
                    )}
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
            {/* Mesma natureza do aviso de volume: informa, não impede. O código
                está classificado e o preço está certo — o que falta é qual
                carroceria mandar, e o padrão entra à vista de todos. */}
            {l.avisoCarroceria && !pendente && (
                <tr className="bg-amber-50/40">
                    <td colSpan={10} className="px-3 pb-2 pt-0">
                        <span className="text-[11px] font-medium text-[#92400e] flex flex-wrap items-center gap-1.5">
                            <AlertTriangle className="w-3 h-3 text-amber-600 shrink-0" strokeWidth={2} />
                            {l.avisoCarroceria} O preço não muda.
                            {ehMaster && (
                                <button type="button"
                                    onClick={() => abrirClassificacao(l.codigoEquipamento)}
                                    className="px-2 py-0.5 rounded text-[10px] font-semibold text-white bg-[#1d6fb8] hover:bg-[#175a94] transition-colors">
                                    Definir carroceria
                                </button>
                            )}
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

            {/* ----------------------------------------------------------------
                Prévia e Histórico. Duas coisas diferentes: a prévia é sobre o
                que AINDA VAI virar cotação; o histórico, sobre o que já virou.
                Misturá-las numa lista só confundiria o que já foi com o que
                falta — que é justamente a pergunta que o histórico responde.
               ---------------------------------------------------------------- */}
            <div className="flex items-center gap-2 border-b border-[#e5e7eb]">
                {([
                    ['previa', 'Prévia da planilha'],
                    ['historico', 'Histórico de cargas'],
                ] as Array<['previa' | 'historico', string]>).map(([id, rotulo]) => (
                    <button key={id} type="button" onClick={() => setAba(id)}
                        className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${aba === id
                            ? 'border-[#1d6fb8] text-[#1d6fb8]'
                            : 'border-transparent text-[#6b7280] hover:text-[#111827]'}`}>
                        {rotulo}
                        {id === 'historico' && historico && (
                            <span className="ml-1.5 text-[10px] font-semibold text-[#9ca3af]">{historico.length}</span>
                        )}
                    </button>
                ))}
            </div>

            {aba === 'previa' && (<>
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
                                                                onClick={() => abrirClassificacao(l.codigoEquipamento)}
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

            {/* -------------------------------------------------------------
                Códigos JÁ classificados que não têm carroceria.
                Eles cotam normalmente — não são pendência e não aparecem no
                bloco de cima. Sem esta lista, ninguém descobriria que estão
                mandando "Baú" por omissão: a tela não teria por que reclamar de
                uma linha que está, para todos os efeitos, resolvida.
               ------------------------------------------------------------- */}
            {!!semCarroceria.length && (
                <div className="bg-white border border-amber-200 rounded-xl px-6 py-4">
                    <p className="text-sm font-semibold text-[#92400e] flex items-center gap-2">
                        <Info className="w-4 h-4 text-amber-600 shrink-0" strokeWidth={1.75} />
                        {semCarroceria.length} código(s) sem carroceria definida
                    </p>
                    <p className="text-xs font-medium text-[#6b7280] mt-1">
                        Foram classificados antes da carroceria existir. Continuam cotando normal, com o
                        preço de sempre — só saem como <strong className="text-[#111827]">{CARROCERIA_PADRAO}</strong>{' '}
                        até alguém dizer qual é.
                    </p>
                    <div className="flex flex-wrap gap-2 mt-3">
                        {semCarroceria.map(({ codigo, tipoVeiculo }) => (
                            <span key={codigo}
                                className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[#f9fafb] border border-[#e5e7eb]">
                                <span className="text-xs font-medium text-[#111827]">
                                    <span className="font-mono">{codigo}</span>
                                    <span className="text-[#6b7280]"> · {tipoVeiculo}</span>
                                </span>
                                {/* Mesma regra do resto: o operador VÊ o que falta,
                                    o master é quem resolve. A trava é a RLS. */}
                                {ehMaster && (
                                    <button type="button" onClick={() => abrirClassificacao(codigo)}
                                        className="text-[10px] font-semibold text-[#1d6fb8] hover:underline">
                                        definir
                                    </button>
                                )}
                            </span>
                        ))}
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
            {classificando && apoio && (() => {
                // Já classificado = o modal está COMPLETANDO a carroceria de um
                // código antigo, não classificando um novo. Muda o texto, não a
                // mecânica: é a mesma gravação.
                const jaTinha = apoio.equipamentos.get(classificando);
                return (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
                    onClick={() => !salvandoTipo && setClassificando(null)}>
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
                        <div>
                            <h3 className="text-lg font-semibold text-[#111827]">
                                {jaTinha ? 'Completar carroceria do código' : 'Classificar código do OTM'}
                            </h3>
                            <p className="text-xs font-medium text-[#6b7280] mt-1">
                                Código <strong className="text-[#111827]">{classificando}</strong>{' '}
                                {jaTinha
                                    ? <>já é <strong className="text-[#111827]">{jaTinha.tipo_veiculo}</strong>, mas ainda
                                        não tem carroceria. Sem ela a cotação sai como {CARROCERIA_PADRAO}.</>
                                    : <>ainda não tem tipo de veículo. O que você escolher fica valendo para as
                                        próximas planilhas.</>}
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
                                {/* O aviso só aparece para quem PODE trocar algo que já vale.
                                    Este é o único campo dos dois que mexe em dinheiro. */}
                                {jaTinha
                                    ? 'Este é o campo que cruza com a tabela de preço — trocá-lo muda o valor das próximas cargas deste código.'
                                    : 'Só aparecem os tipos que existem na tabela de preço.'}
                            </p>
                        </div>

                        <div>
                            <label className="text-[10px] font-medium uppercase text-[#6b7280] mb-1.5 block">
                                Carroceria
                            </label>
                            <select value={carroceriaEscolhida} onChange={e => setCarroceriaEscolhida(e.target.value)}
                                className="w-full px-3 py-2.5 bg-[#f9fafb] border border-[#e5e7eb] rounded-lg text-sm font-medium text-[#111827] outline-none focus:border-[#1d6fb8]">
                                <option value="">— selecione —</option>
                                {CARROCERIAS.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                            <p className="text-[10px] font-medium text-[#6b7280] mt-1.5">
                                Não muda o preço — vai para a cotação e para o campo Implemento do card,
                                para chegar o carro certo.
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
                            <button onClick={salvarClassificacao} disabled={!tipoEscolhido || !carroceriaEscolhida || salvandoTipo}
                                className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#1d6fb8] hover:bg-[#175a94] disabled:bg-[#e5e7eb] disabled:text-[#9ca3af] transition-colors flex items-center justify-center gap-2">
                                {salvandoTipo ? <><Loader2 className="w-4 h-4 animate-spin" /> Salvando…</> : 'Salvar e recalcular'}
                            </button>
                        </div>
                    </div>
                </div>
                );
            })()}

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
            </>)}

            {/* ----------------------------------------------------------------
                HISTÓRICO — só lê e reenvia. Não cria cotação nenhuma, não
                calcula preço e não consulta rota: nenhum token do Qualp é gasto
                aqui. O status de Pipefy e Ramper vem do BANCO, então sobrevive
                ao F5 — que é exatamente o que faltava para não duplicar card.
               ---------------------------------------------------------------- */}
            {aba === 'historico' && (
                <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm font-normal text-[#6b7280]">
                            {historico
                                ? `${historico.length} carga(s) já lançada(s)${historico.length === LIMITE_HISTORICO ? ' (as mais recentes)' : ''}`
                                : 'Cargas Fast Delivery já lançadas.'}
                        </p>
                        <button type="button" onClick={recarregarHistorico} disabled={carregandoHist}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#6b7280] bg-white border border-[#e5e7eb] hover:bg-[#f9fafb] disabled:text-[#9ca3af] transition-colors">
                            {carregandoHist ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" strokeWidth={1.75} />}
                            {carregandoHist ? 'Carregando…' : 'Atualizar'}
                        </button>
                    </div>

                    {erroHist && (
                        <div className="bg-red-50 border border-red-300 text-red-900 px-6 py-3 rounded-xl flex items-start gap-3">
                            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-red-600" strokeWidth={1.75} />
                            <p className="text-sm font-medium">{erroHist}</p>
                        </div>
                    )}

                    {historico && !historico.length && !carregandoHist && (
                        <div className="bg-white border border-[#e5e7eb] rounded-xl px-6 py-8 text-center">
                            <p className="text-sm font-medium text-[#6b7280]">Nenhuma carga Fast Delivery lançada ainda.</p>
                            <p className="text-xs font-normal text-[#9ca3af] mt-1">
                                As cargas aparecem aqui depois de criadas na aba Prévia.
                            </p>
                        </div>
                    )}

                    {!!historico?.length && (
                        <div className="bg-white border border-[#e5e7eb] rounded-xl overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead className="bg-[#f9fafb] text-[10px] uppercase text-[#6b7280]">
                                        <tr>
                                            <th className="px-3 py-2 text-left font-medium">Criada</th>
                                            <th className="px-3 py-2 text-left font-medium">DT / proposta</th>
                                            <th className="px-3 py-2 text-left font-medium">Destino / cliente</th>
                                            <th className="px-3 py-2 text-left font-medium">Veículo</th>
                                            <th className="px-3 py-2 text-right font-medium">Recebido</th>
                                            <th className="px-3 py-2 text-right font-medium">A pagar</th>
                                            <th className="px-3 py-2 text-right font-medium">Margem</th>
                                            <th className="px-3 py-2 text-left font-medium">Pipefy</th>
                                            <th className="px-3 py-2 text-left font-medium">Ramper</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#f3f4f6]">
                                        {historico.map(c => (
                                            <tr key={c.id} className="hover:bg-[#f9fafb]">
                                                <td className="px-3 py-2 text-xs whitespace-nowrap">
                                                    {/* 0 = data desconhecida: são as cargas criadas antes de o
                                                        Fast Delivery gravar created_at, e cujo id também não
                                                        carrega o instante. Dizer "—" é melhor que mostrar 1970. */}
                                                    {c.criadaEm ? dataCurta(new Date(c.criadaEm).toISOString()) : '—'}
                                                </td>
                                                <td className="px-3 py-2 font-mono text-xs">
                                                    {c.dt || '—'}
                                                    <span className="block text-[10px] text-[#9ca3af]">{c.proposta}</span>
                                                </td>
                                                <td className="px-3 py-2 text-xs">
                                                    {c.destino || '—'}
                                                    <span className="block text-[10px] text-[#9ca3af]">{c.cliente}</span>
                                                </td>
                                                <td className="px-3 py-2 text-xs">
                                                    {c.tipoVeiculo ?? '—'}
                                                    {c.carroceria && <span className="text-[#6b7280]"> · {c.carroceria}</span>}
                                                </td>
                                                <td className="px-3 py-2 text-xs text-right font-medium">{brl(c.valorRecebido)}</td>
                                                <td className="px-3 py-2 text-xs text-right font-medium">{brl(c.valorAPagar)}</td>
                                                <td className={`px-3 py-2 text-xs text-right font-semibold ${CORES[corDaMargem(c.margemPercent, marginThreshold)]}`}>
                                                    {brl(c.margem)}
                                                    <span className="block text-[10px] font-medium">
                                                        {c.margemPercent === null ? '' : `${c.margemPercent.toFixed(1)}%`}
                                                    </span>
                                                </td>
                                                <td className="px-3 py-2 text-xs">
                                                    <EnvioHistorico c={c} alvo="pipefy" />
                                                </td>
                                                <td className="px-3 py-2 text-xs">
                                                    <EnvioHistorico c={c} alvo="ramper" />
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {!!historico?.length && (
                        <p className="text-[11px] font-normal text-[#9ca3af] flex items-start gap-2">
                            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" strokeWidth={1.75} />
                            O histórico só lista e reenvia — não cria cotação nem recalcula valor.
                            O status de envio vem do banco: se disser "enviado", há card lá, e clicar
                            de novo não cria outro. A margem usa o mesmo limiar da cotação ({marginThreshold}%).
                        </p>
                    )}
                </div>
            )}
        </div>
    );
};

export default FastDelivery;
