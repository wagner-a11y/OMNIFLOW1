// ============================================================================
// BID EM LOTE — a planilha de UMA rodada
//
// Importa uma planilha de rotas (origem/destino/veículo), consulta o Qualp por
// rota e roda CADA linha pelo MESMO motor de preço da calculadora. Mostra a
// abertura de custos por linha e sai em Excel.
//
// Vive dentro de uma rodada de um bid (components/BidHistorico.tsx): o estado
// inicial vem da rodada salva e cada mudança sobe por `onMudanca` para o
// salvamento automático. Rodada FECHADA mostra o resultado salvo e NUNCA
// recalcula — nem se as taxas das Configurações mudarem.
//
// A cota do Qualp é paga e limitada, então duas travas são de desenho, não de
// configuração: dedup por rota (repetida consulta uma vez só) e no máximo
// CONCORRENCIA consultas em voo. Reabrir, recarregar e "Nova rodada" não
// consultam nada: a rota salva na linha vira o cache. Reconsultar é sempre por
// botão, com o custo na tela antes.
//
// Linha problemática não derruba o lote: pendência, frete urbano e falha do
// Qualp viram STATUS da linha, e as linhas com problema ficam no TOPO.
// ============================================================================

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
    AlertTriangle, ChevronDown, ChevronRight, Copy, FileDown, Info, Maximize2, Minimize2, RefreshCw, Trash2, Upload,
} from 'lucide-react';
import {
    planejarLote, processarLoteBid, reaplicarLote, extrairCacheDeRotas,
    resumirBid, rotuloStatus, taxaAntecipacaoProporcional, TETO_ROTAS_DISTINTAS,
    totaisAbertura, validarAdicionalPiso, aplicarAdicionalLinhas, adicionalEditavel,
    ADICIONAL_PISO_AVISO_PCT, TAXA_CUSTO_DDR_PADRAO,
    type LinhaBid, type LinhaBidBruta, type ParametrosBid, type PlanoLote, type RotaDoLote, type SeguroModo,
} from '../utils/bidLote';
import {
    cacheDasEntradas, chaveDaLinha, montarRegistros, textoCopiaColuna, formatarValorCopia, variacaoPercentual,
    type ParametrosTela, type RegistroLinha,
} from '../utils/bidHistorico';
import { lerPlanilhaBid, consultarRotaDoLote } from '../services/bidLote';
import type { ANTTCoefficients, FederalTaxes } from '../types';

/** Consultas simultâneas ao Qualp. Baixo de propósito: a cota é paga. */
const CONCORRENCIA = 3;
const CHAVE_AJUSTES_ABERTOS = 'bidLote.ajustesAbertos';

type ConfigVeiculos = Record<string, ANTTCoefficients & { factor?: number; axles?: number }>;

/** O que a rodada tem agora, para o salvamento automático. */
export interface MudancaRodada {
    tela: ParametrosTela;
    calculo: ParametrosBid;
    registros: RegistroLinha[];
    /** Sobe a cada planilha importada: a gravação troca TODAS as linhas. */
    geracao: number;
}

interface Props {
    fedTaxes: FederalTaxes;
    vehicleConfigs: ConfigVeiculos;
    tiposDeCarga: string[];
    onFeedback?: (msg: string, tipo?: 'success' | 'error' | 'info') => void;
    /** Estado salvo da rodada: ponto de partida editável (rascunho) ou o que se mostra (fechada). */
    inicial: { tela: ParametrosTela; registros: RegistroLinha[] };
    /** Rodada fechada: mostra o resultado salvo, sem editar e sem recalcular. */
    somenteLeitura: boolean;
    /** Parâmetros de cálculo salvos com a rodada (Excel de rodada fechada). */
    calculoSalvo?: ParametrosBid | null;
    /** Preço ofertado da rodada anterior, por chave de linha. Rodada 2 em diante. */
    precoAnterior?: Record<string, number | null> | null;
    onMudanca?: (m: MudancaRodada) => void;
    onExportar: (linhasNaOrdemDaPlanilha: LinhaBid[], calculo: ParametrosBid) => void;
    /** Caminho, status, indicador de salvamento e ações da rodada. */
    barraTopo?: React.ReactNode;
    telaCheia: boolean;
    onTelaCheia: (v: boolean) => void;
}

// ---------------------------------------------------------------------------
// Formatação compacta da tela (o Excel tem a sua, com colunas separadas)
// ---------------------------------------------------------------------------

/** "5.501,34" — sem "R$": o cabeçalho já diz. */
const n2 = (v: number | null | undefined) =>
    v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Percentual com no máximo 2 casas. */
const p2 = (v: number | null | undefined) =>
    v == null || !Number.isFinite(v) ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
const km0 = (v: number | null) => (v == null ? '—' : v.toLocaleString('pt-BR', { maximumFractionDigits: 0 }));

/** "Vitória, ES" -> "Vitória/ES". Sem UF reconhecida, fica como veio. */
const cidadeUF = (texto: string, uf: string): string => {
    if (!texto) return '—';
    if (!uf) return texto;
    const cidade = texto.replace(new RegExp(`\\s*[,/-]\\s*${uf}\\s*$`, 'i'), '').trim();
    return `${cidade || texto}/${uf}`;
};

/** "1,5" -> 1.5. Percentual digitado; vazio ou ilegível = NaN. */
const lerPercentual = (s: string): number => (s.trim() === '' ? NaN : Number(s.trim().replace(',', '.')));
/** "500.000,00" -> 500000. Valor em R$ digitado; vazio = null. */
const lerReais = (s: string): number | null => {
    const t = s.replace(/R\$/gi, '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
};

/** Os parâmetros de cálculo a partir do texto da tela. */
const calcularParametros = (
    t: ParametrosTela,
    fedTaxes: FederalTaxes,
    vehicleConfigs: ConfigVeiculos,
    adicionalPorLinha: Record<number, number>,
    valorMercadoriaPorLinha: Record<number, number>,
): ParametrosBid => {
    const veiculos = Object.keys(vehicleConfigs).sort();
    const adicional = lerPercentual(t.adicionalPadrao);
    const seguro = lerPercentual(t.seguroPct);
    const ddr = lerPercentual(t.taxaCustoDdr);
    return {
        profitMargin: parseFloat(t.profitMargin.replace(',', '.')) || 0,
        fedTaxes: {
            insurancePolicyRate: fedTaxes.insurancePolicyRate,
            pis: fedTaxes.pis, cofins: fedTaxes.cofins, csll: fedTaxes.csll, irpj: fedTaxes.irpj,
        },
        icmsRates: fedTaxes.icmsRates,
        cargoType: t.cargoType,
        veiculoPadrao: t.veiculoPadrao,
        veiculosCadastro: veiculos,
        deParaVeiculo: t.deParaVeiculo,
        eixosPorVeiculo: Object.fromEntries(veiculos.map(v => [v, vehicleConfigs[v]?.axles])),
        modoPorVeiculo: Object.fromEntries(veiculos.map(v => [v, vehicleConfigs[v]?.calcMode])),
        jurosMensal: parseFloat(t.jurosMensal.replace(',', '.')) || 0,
        prazoDias: parseInt(t.prazoDias, 10) || 0,
        comissaoPercent: t.comissaoPercent,
        comissaoPadrao: fedTaxes.commissionPercent,
        icmsIncluso: t.icmsIncluso,
        adicionalPisoPadraoPct: Number.isFinite(adicional) ? Math.max(0, adicional) : 0,
        adicionalPorLinha,
        seguroModo: t.seguroModo,
        seguroPct: Number.isFinite(seguro) ? Math.max(0, seguro) : null,
        taxaCustoDdrPct: Number.isFinite(ddr) ? Math.max(0, ddr) : TAXA_CUSTO_DDR_PADRAO,
        valorMercadoriaPadrao: lerReais(t.valorMercadoriaPadrao),
        valorMercadoriaPorLinha,
    };
};

/**
 * Célula editável (adicional % ou valor de NF). Confirma no blur ou Enter;
 * vazio devolve a linha ao padrão da rodada. Sinal de menos não entra.
 */
const CelulaEditavel: React.FC<{
    texto: string;
    proprio: boolean;
    desabilitado: boolean;
    aviso: boolean;
    titulo: string;
    largura: string;
    onSalvar: (bruto: string) => string | null;
    onErro: (msg: string) => void;
}> = ({ texto, proprio, desabilitado, aviso, titulo, largura, onSalvar, onErro }) => {
    if (desabilitado) return <span className="text-[#9ca3af]">{texto || '—'}</span>;
    const confirmar = (el: HTMLInputElement) => {
        if (el.value === texto) return;
        const erro = onSalvar(el.value);
        if (erro) { onErro(erro); el.value = texto; }
    };
    return (
        <input
            key={`${texto}-${proprio}`}
            type="text"
            inputMode="decimal"
            defaultValue={texto}
            title={titulo}
            onChange={e => {
                if (e.target.value.includes('-')) {
                    e.target.value = e.target.value.replace(/-/g, '');
                    onErro('Valor negativo é bloqueado.');
                }
            }}
            onBlur={e => confirmar(e.currentTarget)}
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            className={`${largura} h-6 px-1 rounded border text-right text-[12px] tabular-nums outline-none focus:border-[#1d6fb8] ${
                aviso ? 'bg-amber-50 border-amber-300 text-amber-800'
                    : proprio ? 'bg-[#eff6ff] border-[#93c5fd] text-[#1d4ed8] font-medium'
                        : 'bg-white border-[#e5e7eb] text-[#111827]'}`}
        />
    );
};

/** Problema no topo: é a primeira coisa que precisa ser vista. */
const ordenar = (ls: LinhaBid[]): LinhaBid[] => {
    const ordem: Record<string, number> = { falha: 0, pendencia: 1, urbano: 2, ok: 3 };
    return [...ls].sort((a, b) => {
        const d = (ordem[a.status] ?? 9) - (ordem[b.status] ?? 9);
        if (d !== 0) return d;
        if (a.alertas.length !== b.alertas.length) return b.alertas.length - a.alertas.length;
        return a.linhaExcel - b.linhaExcel;
    });
};

const CORES_STATUS: Record<string, string> = {
    ok: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    pendencia: 'bg-amber-50 text-amber-700 border-amber-200',
    urbano: 'bg-blue-50 text-blue-700 border-blue-200',
    falha: 'bg-red-50 text-red-700 border-red-200',
};
const STATUS_CURTO: Record<string, string> = { ok: 'OK', pendencia: 'Pend.', urbano: 'Urbano', falha: 'Falha' };

/**
 * Coluna da TELA. Diferente das colunas do Excel (COLUNAS_ABERTURA): aqui os
 * pares % e R$ viram UMA coluna e a UF vai junto da cidade. O Excel continua
 * com as colunas separadas, na ordem de sempre.
 */
interface ColunaTela {
    id: string;
    titulo: string;
    /** Largura fixa em px. As congeladas dependem dela para o `left`. */
    largura: number;
    congelada?: boolean;
    /** Só aparece com "Abrir custos". */
    custo?: boolean;
    texto?: boolean;
    celula: (l: LinhaBid) => React.ReactNode;
    total?: React.ReactNode;
    /** Coluna de preço: botão "Copiar" no cabeçalho e clique na célula copia o valor. */
    copiar?: (l: LinhaBid) => number | null;
}

/** Estado do lote importado, esperando o OK do operador para gastar Qualp. */
interface PendenteDeOk {
    plano: PlanoLote;
    brutas: LinhaBidBruta[];
    modo: 'importar' | 'rotas-novas' | 'reconsultar';
    arquivo?: { nome: string; aba: string; abas: string[]; faltando: string[] };
}

export const BidLote: React.FC<Props> = ({
    fedTaxes, vehicleConfigs, tiposDeCarga, onFeedback, inicial, somenteLeitura, calculoSalvo,
    precoAnterior, onMudanca, onExportar, barraTopo, telaCheia, onTelaCheia,
}) => {
    const veiculos = useMemo(() => Object.keys(vehicleConfigs).sort(), [vehicleConfigs]);

    // ---- Parâmetros da rodada (o texto da tela) ----
    const [tela, setTela] = useState<ParametrosTela>(inicial.tela);
    const alterar = <K extends keyof ParametrosTela>(campo: K, valor: ParametrosTela[K]) => setTela(t => ({ ...t, [campo]: valor }));

    // ---- Linhas: o dado cru da planilha + ajustes próprios + rotas já pagas ----
    const [brutas, setBrutas] = useState<LinhaBidBruta[] | null>(
        inicial.registros.length ? inicial.registros.map(r => r.entrada.bruta) : null);
    const [adicionalPorLinha, setAdicionalPorLinha] = useState<Record<number, number>>(() => Object.fromEntries(
        inicial.registros.filter(r => r.entrada.adicionalPct != null).map(r => [r.entrada.bruta.linhaExcel, r.entrada.adicionalPct as number])));
    const [valorMercadoriaPorLinha, setValorMercadoriaPorLinha] = useState<Record<number, number>>(() => Object.fromEntries(
        inicial.registros.filter(r => r.entrada.valorMercadoria != null).map(r => [r.entrada.bruta.linhaExcel, r.entrada.valorMercadoria as number])));
    /** Rotas que o Qualp já respondeu (chave de dedup -> rota). Vem das linhas salvas. */
    const [rotasCache, setRotasCache] = useState<Record<string, RotaDoLote>>(() =>
        cacheDasEntradas(inicial.registros, calcularParametros(inicial.tela, fedTaxes, vehicleConfigs, {}, {})));
    const [geracao, setGeracao] = useState(0);

    // ---- Interface ----
    const [abrirCustos, setAbrirCustos] = useState(false);
    const [ajustesAbertos, setAjustesAbertos] = useState<boolean>(() => {
        try { return localStorage.getItem(CHAVE_AJUSTES_ABERTOS) !== '0'; } catch { return true; }
    });
    const [selecionadas, setSelecionadas] = useState<Set<number>>(new Set());
    const [adicionalMassa, setAdicionalMassa] = useState('');
    const [rodando, setRodando] = useState(false);
    const [progresso, setProgresso] = useState({ feitas: 0, total: 0 });
    const [colunasFaltando, setColunasFaltando] = useState<string[]>([]);
    const [estatQualp, setEstatQualp] = useState<{ consultas: number; distintas: number; economizadas: number } | null>(null);
    const [pendenteDeOk, setPendenteDeOk] = useState<PendenteDeOk | null>(null);
    const [confirmarReimportar, setConfirmarReimportar] = useState(false);
    const [removerLinha, setRemoverLinha] = useState<number | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        try { localStorage.setItem(CHAVE_AJUSTES_ABERTOS, ajustesAbertos ? '1' : '0'); } catch { /* sem armazenamento: só não lembra */ }
    }, [ajustesAbertos]);

    // Esc sai da tela cheia.
    useEffect(() => {
        if (!telaCheia) return;
        const aoTeclar = (e: KeyboardEvent) => { if (e.key === 'Escape') onTelaCheia(false); };
        window.addEventListener('keydown', aoTeclar);
        return () => window.removeEventListener('keydown', aoTeclar);
    }, [telaCheia, onTelaCheia]);

    const parametros = (): ParametrosBid => calcularParametros(tela, fedTaxes, vehicleConfigs, adicionalPorLinha, valorMercadoriaPorLinha);
    const paramsAtuais = useMemo(parametros,
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [tela, fedTaxes, vehicleConfigs, adicionalPorLinha, valorMercadoriaPorLinha]);

    /**
     * MOTOR VIVO (só em rascunho). A tabela é DERIVADA das linhas cruas + rotas
     * em cache: qualquer parâmetro que mude refaz a conta, sem tocar no Qualp.
     */
    const reaplicado = useMemo(() => (
        somenteLeitura || !brutas ? null : reaplicarLote(brutas, paramsAtuais, rotasCache)
    ), [somenteLeitura, brutas, paramsAtuais, rotasCache]);

    /** Na ordem da planilha importada. */
    const linhasNaOrdem: LinhaBid[] | null = useMemo(() => {
        if (somenteLeitura) {
            const salvas = inicial.registros.map(r => r.resultado).filter((l): l is LinhaBid => l != null);
            return salvas.length ? salvas : null;
        }
        return reaplicado?.linhas ?? null;
    }, [somenteLeitura, inicial.registros, reaplicado]);
    const linhas = useMemo(() => (linhasNaOrdem ? ordenar(linhasNaOrdem) : null), [linhasNaOrdem]);
    const rotasNovas = reaplicado?.rotasNovas ?? [];

    // Sobe o estado para o salvamento automático (só rascunho).
    useEffect(() => {
        if (somenteLeitura || !onMudanca) return;
        onMudanca({
            tela,
            calculo: paramsAtuais,
            registros: brutas ? montarRegistros(brutas, reaplicado?.linhas ?? [], adicionalPorLinha, valorMercadoriaPorLinha) : [],
            geracao,
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [somenteLeitura, tela, paramsAtuais, brutas, reaplicado, geracao]);

    const erro = (msg: string) => onFeedback?.(msg, 'error');

    // ---- Importar / reimportar ----
    const abrirArquivo = () => {
        if (somenteLeitura || rodando) return;
        if (brutas?.length) { setConfirmarReimportar(true); return; }
        inputRef.current?.click();
    };

    /** Passo 1: ler e PLANEJAR. Não consulta nada — mostra o custo e pede o OK. */
    const aoEscolherArquivo = async (file: File | undefined) => {
        if (!file || rodando) return;
        setPendenteDeOk(null);
        try {
            const r = lerPlanilhaBid(await file.arrayBuffer());
            if (!r.totalLinhas) { erro('A planilha está vazia.'); return; }
            const arquivo = { nome: file.name, aba: r.abaUsada, abas: r.abas, faltando: r.faltando };
            // O cache das rotas já pagas vale para o arquivo novo: rota repetida não é consultada de novo.
            const plano = planejarLote(r.linhas, parametros(), rotasCache);
            setPendenteDeOk({ plano, brutas: r.linhas, modo: 'importar', arquivo });
        } catch (e) {
            console.error('bid em lote (leitura):', e);
            erro(`Falha ao ler a planilha: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            if (inputRef.current) inputRef.current.value = '';
        }
    };

    /** Aplica a planilha nova: troca as linhas, zera os ajustes por linha, nova geração. */
    const aplicarArquivo = (novas: LinhaBidBruta[], arquivo: NonNullable<PendenteDeOk['arquivo']>, cache: Record<string, RotaDoLote>) => {
        setBrutas(novas);
        setRotasCache(cache);
        setAdicionalPorLinha({});
        setValorMercadoriaPorLinha({});
        setSelecionadas(new Set());
        setColunasFaltando(arquivo.faltando);
        setTela(t => ({ ...t, nomeArquivo: arquivo.nome, abaUsada: arquivo.aba }));
        setGeracao(g => g + 1);
    };

    /** Passo 2: só aqui o Qualp é chamado, depois do OK explícito. */
    const consultar = async (p: PendenteDeOk) => {
        if (rodando) return;
        setPendenteDeOk(null);
        const cacheBase = p.modo === 'reconsultar' ? {} : rotasCache;
        if (p.plano.rotasDistintas === 0 && p.modo === 'importar' && p.arquivo) {
            aplicarArquivo(p.brutas, p.arquivo, cacheBase);
            onFeedback?.('Planilha aplicada sem nenhuma consulta nova ao Qualp.');
            return;
        }
        setRodando(true);
        try {
            setProgresso({ feitas: 0, total: p.brutas.length });
            const r = await processarLoteBid(p.brutas, parametros(), {
                consultarRota: consultarRotaDoLote,
                concorrencia: CONCORRENCIA,
                onProgresso: (feitas, total) => setProgresso({ feitas, total }),
                rotasEmCache: cacheBase,
            });
            if (r.bloqueado) { erro(r.bloqueado.motivo); return; }
            const cache = { ...cacheBase, ...extrairCacheDeRotas(r.linhas) };
            if (p.modo === 'importar' && p.arquivo) aplicarArquivo(p.brutas, p.arquivo, cache);
            else setRotasCache(cache);
            setEstatQualp(prev => ({
                consultas: (prev?.consultas ?? 0) + r.consultasQualp,
                distintas: r.rotasDistintas,
                economizadas: r.economizadas,
            }));
            onFeedback?.(`${r.linhas.length} linha(s), ${r.consultasQualp} consulta(s) nova(s) ao Qualp.`);
        } catch (e) {
            console.error('bid em lote:', e);
            erro(`Falha ao processar o lote: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            setRodando(false);
        }
    };

    const pedirReconsulta = () => {
        if (!brutas || somenteLeitura) return;
        setPendenteDeOk({ plano: planejarLote(brutas, parametros(), {}), brutas, modo: 'reconsultar' });
    };

    // ---- Edição por linha ----
    const salvarAdicionalLinha = (linhaExcel: number, bruto: string): string | null => {
        const v = bruto.trim() === '' ? null : lerPercentual(bruto);
        const r = aplicarAdicionalLinhas(adicionalPorLinha, [linhaExcel], v);
        if (r.erro) return r.erro;
        setAdicionalPorLinha(r.mapa);
        if (v != null) { const a = validarAdicionalPiso(v).aviso; if (a) onFeedback?.(`Linha ${linhaExcel}: ${a}`, 'info'); }
        return null;
    };
    const aplicarNasSelecionadas = () => {
        if (!selecionadas.size) { erro('Selecione ao menos uma linha.'); return; }
        const v = lerPercentual(adicionalMassa);
        const r = aplicarAdicionalLinhas(adicionalPorLinha, [...selecionadas], v);
        if (r.erro) { erro(r.erro); return; }
        setAdicionalPorLinha(r.mapa);
        const a = validarAdicionalPiso(v).aviso;
        onFeedback?.(`Adicional de ${adicionalMassa}% aplicado a ${selecionadas.size} linha(s).${a ? ` ${a}.` : ''}`, a ? 'info' : 'success');
    };
    const salvarValorMercadoriaLinha = (linhaExcel: number, bruto: string): string | null => {
        const v = lerReais(bruto);
        if (v != null && v < 0) return 'Valor de NF negativo é bloqueado.';
        setValorMercadoriaPorLinha(prev => {
            const novo = { ...prev };
            if (v == null) delete novo[linhaExcel]; else novo[linhaExcel] = v;
            return novo;
        });
        return null;
    };
    const remover = (linhaExcel: number) => {
        setBrutas(bs => (bs ? bs.filter(b => b.linhaExcel !== linhaExcel) : bs));
        setAdicionalPorLinha(m => { const n = { ...m }; delete n[linhaExcel]; return n; });
        setValorMercadoriaPorLinha(m => { const n = { ...m }; delete n[linhaExcel]; return n; });
        setSelecionadas(s => { const n = new Set(s); n.delete(linhaExcel); return n; });
        setRemoverLinha(null);
        onFeedback?.(`Linha ${linhaExcel} removida da rodada.`);
    };

    // ---- Cópia ----
    const copiarTexto = async (texto: string, aviso: string) => {
        try {
            await navigator.clipboard.writeText(texto);
            onFeedback?.(aviso, 'success');
        } catch {
            erro('O navegador não deixou copiar. Tente de novo com a janela em foco.');
        }
    };
    const copiarColuna = (c: ColunaTela) => {
        if (!linhasNaOrdem || !c.copiar) return;
        const r = textoCopiaColuna(linhasNaOrdem, c.copiar);
        copiarTexto(r.texto, `${r.quantidade} valores copiados, na ordem da planilha importada`);
    };

    // ---- Derivados para a tabela ----
    const resumo = linhas ? resumirBid(linhas) : null;
    const totais = useMemo(() => (linhas ? totaisAbertura(linhas) : null), [linhas]);
    const editaveis = !somenteLeitura && linhas ? linhas.filter(l => adicionalEditavel(l, paramsAtuais)).map(l => l.linhaExcel) : [];
    const todasSelecionadas = editaveis.length > 0 && editaveis.every(n => selecionadas.has(n));
    const seguroNaoDefinido = tela.seguroModo === 'ad_valorem' && !Number.isFinite(lerPercentual(tela.seguroPct));
    const nJuros = parseFloat(tela.jurosMensal.replace(',', '.')) || 0;
    const nPrazo = parseInt(tela.prazoDias, 10) || 0;
    const avisoAdicionalPadrao = validarAdicionalPiso(paramsAtuais.adicionalPisoPadraoPct ?? 0).aviso;
    const comComparacao = !!precoAnterior;
    const anteriorDe = (l: LinhaBid) => precoAnterior?.[chaveDaLinha(l)] ?? null;
    const totalAnterior = linhas && precoAnterior
        ? linhas.filter(l => l.status === 'ok').reduce((a, l) => a + (anteriorDe(l) ?? 0), 0) : 0;

    /** Par R$ em destaque + % pequeno em cinza, numa coluna só. */
    const par = (rs: number | null, pct: number | null) => (
        <span className="block leading-tight">
            <span className="block">{n2(rs)}</span>
            <span className="block text-[10px] text-[#9ca3af]">{p2(pct)}</span>
        </span>
    );
    const parTotal = (rs: number | null | undefined) => (rs == null ? '' : n2(rs));

    const colunas: ColunaTela[] = [
        { id: 'origem', titulo: 'Origem', largura: 104, congelada: true, texto: true, celula: l => cidadeUF(l.origem, l.ufOrigem), total: <span className="text-[10px] uppercase text-[#6b7280]">Total</span> },
        { id: 'destino', titulo: 'Destino', largura: 104, congelada: true, texto: true, celula: l => cidadeUF(l.destino, l.ufDestino) },
        { id: 'km', titulo: 'Km', largura: 40, congelada: true, celula: l => km0(l.km) },
        {
            id: 'veiculo', titulo: 'Veículo', largura: 72, congelada: true, texto: true,
            celula: l => (<>{l.veiculo || '—'}{l.veiculo && !l.veiculoDaLinha && <span className="ml-1 text-[9px] text-blue-500">padrão</span>}</>),
        },
        { id: 'eixos', titulo: 'Eixos', largura: 30, congelada: true, celula: l => (l.eixos ?? '—') },
        { id: 'piso', titulo: 'Piso ANTT R$', largura: 70, custo: true, celula: l => n2(l.pisoAntt), total: parTotal(totais?.pisoAntt) },
        {
            id: 'adicional', titulo: 'Adicional R$ / %', largura: 64, custo: true,
            celula: l => (
                <span className="block leading-tight">
                    <span className="block">{n2(l.adicionalPisoRS)}</span>
                    <CelulaEditavel
                        texto={l.adicionalPisoPct == null ? '' : String(l.adicionalPisoPct).replace('.', ',')}
                        proprio={l.adicionalProprio}
                        desabilitado={somenteLeitura || !adicionalEditavel(l, paramsAtuais)}
                        aviso={(l.adicionalPisoPct ?? 0) > ADICIONAL_PISO_AVISO_PCT}
                        titulo={l.adicionalProprio ? 'Adicional próprio desta linha, em % (vazio = volta ao padrão)' : 'Adicional em %: segue o padrão da rodada'}
                        largura="w-9 !h-[15px] !text-[10px] leading-none mt-px"
                        onSalvar={b => salvarAdicionalLinha(l.linhaExcel, b)}
                        onErro={erro}
                    />
                </span>
            ),
            total: parTotal(totais?.adicionalPisoRS),
        },
        { id: 'motorista', titulo: 'Custo motorista R$', largura: 72, celula: l => n2(l.custoMotorista), total: parTotal(totais?.custoMotorista) },
        { id: 'pedagio', titulo: 'Pedágio R$', largura: 60, celula: l => n2(l.pedagio), total: parTotal(totais?.pedagio) },
        { id: 'direto', titulo: 'Custo direto R$', largura: 72, custo: true, celula: l => n2(l.custoBase), total: parTotal(totais?.custoDireto) },
        {
            id: 'nf', titulo: 'Valor NF R$', largura: 80, custo: true,
            celula: l => (
                <CelulaEditavel
                    texto={l.valorMercadoriaEfetivo == null ? '' : n2(l.valorMercadoriaEfetivo)}
                    proprio={valorMercadoriaPorLinha[l.linhaExcel] != null}
                    desabilitado={somenteLeitura || l.status !== 'ok'}
                    aviso={l.valorMercadoriaEfetivo == null}
                    titulo="Valor da NF desta linha (vazio = planilha ou padrão)"
                    largura="w-[66px] !text-[11px]"
                    onSalvar={b => salvarValorMercadoriaLinha(l.linhaExcel, b)}
                    onErro={erro}
                />
            ),
        },
        { id: 'adv', titulo: 'Ad valorem cobrado R$ / %', largura: 58, custo: true, celula: l => par(l.seguroRS, l.seguroPct), total: parTotal(totais?.seguroRS) },
        { id: 'seguro', titulo: 'Custo seguro R$ / %', largura: 56, custo: true, celula: l => par(l.seguroCustoRS, l.seguroCustoPct), total: parTotal(totais?.seguroCustoRS) },
        { id: 'financeiro', titulo: 'Custo financeiro R$ / %', largura: 62, custo: true, celula: l => par(l.custoAntecipacao, l.taxaAntecipacao), total: parTotal(totais?.custoFinanceiroRS) },
        { id: 'comissao', titulo: 'Comissão R$ / %', largura: 60, custo: true, celula: l => par(l.custoComissao, l.comissaoPct), total: parTotal(totais?.comissaoRS) },
        { id: 'federais', titulo: 'Federais R$ / %', largura: 64, custo: true, celula: l => par(l.federaisRS, l.federaisPct), total: parTotal(totais?.federaisRS) },
        { id: 'icms', titulo: 'ICMS R$ / %', largura: 64, celula: l => par(l.icmsRS, l.icmsPercent), total: parTotal(totais?.icmsRS) },
        {
            id: 'markup', titulo: 'Markup', largura: 44,
            celula: l => (l.markup == null ? '—' : l.markup.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })),
            total: totais?.markup != null ? totais.markup.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '',
        },
        { id: 'semIcms', titulo: 'Frete sem ICMS R$', largura: 74, celula: l => n2(l.freteSemIcms), total: parTotal(totais?.freteSemIcms), copiar: l => l.freteSemIcms },
        { id: 'comIcms', titulo: 'Frete com ICMS R$', largura: 74, celula: l => n2(l.freteComIcms), total: parTotal(totais?.freteComIcms), copiar: l => l.freteComIcms },
        {
            id: 'ofertado', titulo: 'Preço ofertado R$', largura: 78,
            celula: l => <span className="font-semibold text-[#1d6fb8]">{n2(l.precoOfertado)}</span>,
            total: parTotal(totais?.precoOfertado), copiar: l => l.precoOfertado,
        },
        ...(comComparacao ? [
            { id: 'anterior', titulo: 'Preço rodada anterior R$', largura: 74, celula: (l: LinhaBid) => n2(anteriorDe(l)), total: parTotal(totalAnterior || null) },
            {
                id: 'variacao', titulo: 'Variação %', largura: 52,
                celula: (l: LinhaBid) => {
                    const v = variacaoPercentual(l.precoOfertado, anteriorDe(l));
                    return <span className="text-[#374151]">{v != null && v > 0 ? '+' : ''}{p2(v)}</span>;
                },
                total: p2(variacaoPercentual(totais?.precoOfertado ?? null, totalAnterior || null)),
            },
        ] : []),
        {
            id: 'margem', titulo: 'Margem líquida R$ / %', largura: 72,
            celula: l => (
                <span className={`font-medium ${(l.margemLiquidaRS ?? 0) > 0 ? 'text-emerald-700' : l.margemLiquidaRS == null ? 'text-[#9ca3af]' : 'text-red-600'}`}>
                    {par(l.margemLiquidaRS, l.margemLiquidaPercent)}
                </span>
            ),
            total: (
                <span className="block leading-tight">
                    <span className="block">{parTotal(totais?.margemLiquidaRS)}</span>
                    <span className="block text-[10px] text-[#6b7280]">{p2(totais?.margemLiquidaPct ?? null)}</span>
                </span>
            ),
        },
    ];
    const visiveis = colunas.filter(c => abrirCustos || !c.custo);

    // Posição das colunas congeladas: seleção (28) + # (34) + as cinco referências.
    const LARG_SEL = somenteLeitura ? 0 : 24;
    const LARG_NUM = 30;
    const LARG_STATUS = 72;
    const congeladas = visiveis.filter(c => c.congelada);
    const leftDe: Record<string, number> = {};
    let acumulado = LARG_SEL + LARG_NUM;
    for (const c of congeladas) { leftDe[c.id] = acumulado; acumulado += c.largura; }
    const ultimaCongelada = congeladas[congeladas.length - 1]?.id;
    const larguraTabela = LARG_SEL + LARG_NUM + visiveis.reduce((a, c) => a + c.largura, 0) + LARG_STATUS;

    const estiloCelula = (c: ColunaTela): React.CSSProperties => ({
        width: c.largura, minWidth: c.largura, maxWidth: c.largura,
        ...(c.congelada ? { position: 'sticky', left: leftDe[c.id] } : {}),
    });
    const classeCongelada = (c: ColunaTela, fundo: string) =>
        c.congelada ? `z-10 ${fundo} ${c.id === ultimaCongelada ? 'shadow-[4px_0_6px_-2px_rgba(17,24,39,0.12)] border-r border-[#e5e7eb]' : ''}` : '';

    // ---- A tabela ocupa a altura que sobra da janela e rola por dentro ----
    const caixaRef = useRef<HTMLDivElement>(null);
    const [alturaTabela, setAlturaTabela] = useState(520);
    useLayoutEffect(() => {
        const medir = () => {
            const el = caixaRef.current;
            if (!el) return;
            let pai: HTMLElement | null = el.parentElement;
            while (pai && !/(auto|scroll)/.test(getComputedStyle(pai).overflowY)) pai = pai.parentElement;
            const topoPai = pai ? pai.getBoundingClientRect().top : 0;
            const rolagem = pai ? pai.scrollTop : window.scrollY;
            const alturaPai = pai ? pai.clientHeight : window.innerHeight;
            // Posição da tabela com a página no topo: o que sobra abaixo dela é dela.
            const deslocamento = el.getBoundingClientRect().top - topoPai + rolagem;
            setAlturaTabela(Math.max(360, Math.floor(alturaPai - deslocamento - 16)));
        };
        medir();
        window.addEventListener('resize', medir);
        return () => window.removeEventListener('resize', medir);
    }, [telaCheia, ajustesAbertos, abrirCustos, linhas?.length, pendenteDeOk, rotasNovas.length, colunasFaltando.length]);

    const rotulosPendentes = useMemo(() => {
        if (!linhas || somenteLeitura) return [];
        const mapa = new Map<string, { rotulo: string; linhas: number[]; candidatos: string[] }>();
        for (const l of linhas) {
            if (l.veiculo || !l.veiculoPlanilha) continue;
            const atual = mapa.get(l.veiculoPlanilha) || { rotulo: l.veiculoPlanilha, linhas: [], candidatos: l.candidatosVeiculo };
            atual.linhas.push(l.linhaExcel);
            mapa.set(l.veiculoPlanilha, atual);
        }
        return [...mapa.values()];
    }, [linhas, somenteLeitura]);

    const campo = 'w-full px-2.5 py-1.5 bg-[#f9fafb] border border-[#e5e7eb] rounded-md text-[13px] text-[#111827] outline-none focus:border-[#1d6fb8] transition-colors disabled:opacity-60';
    const rotulo = 'text-[10px] font-medium text-[#6b7280] uppercase tracking-tight block mb-1';
    const dica = 'text-[10px] text-[#9ca3af] mt-1';
    const botao = 'px-3 py-1.5 rounded-md font-medium text-[12px] transition-colors flex items-center gap-1.5 disabled:opacity-40';

    return (
        <div className="space-y-3">
            {/* Barra da rodada: caminho, status, salvamento e ações. Sempre visível. */}
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 flex-1">{barraTopo}</div>
                <button
                    onClick={() => onTelaCheia(!telaCheia)}
                    className={`${botao} bg-white border border-[#e5e7eb] text-[#111827] hover:bg-[#f3f4f6]`}
                    title={telaCheia ? 'Sair da tela cheia (Esc)' : 'Tela cheia: só a planilha'}
                >
                    {telaCheia ? <Minimize2 className="w-3.5 h-3.5" strokeWidth={1.75} /> : <Maximize2 className="w-3.5 h-3.5" strokeWidth={1.75} />}
                    {telaCheia ? 'Sair da tela cheia' : 'Tela cheia'}
                </button>
            </div>

            {/* Selos da rodada */}
            {(!tela.icmsIncluso || seguroNaoDefinido) && (
                <div className="flex flex-wrap gap-2">
                    {!tela.icmsIncluso && (
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-[#1d6fb8] text-white rounded-md">
                            <Info className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                            <p className="text-[12px] font-medium">Preço SEM ICMS. ICMS por fora ou por conta do embarcador.</p>
                        </div>
                    )}
                    {seguroNaoDefinido && (
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border border-amber-200 text-amber-800 rounded-md">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-600" strokeWidth={1.75} />
                            <p className="text-[12px] font-medium">Seguro não definido. Ad valorem cobrado do cliente ainda vazio.</p>
                        </div>
                    )}
                </div>
            )}

            {/* Parâmetros + ajustes de custo (recolhível, lembra o estado) */}
            {!telaCheia && (
                <div className="bg-white border border-[#e5e7eb] rounded-lg">
                    <button
                        onClick={() => setAjustesAbertos(v => !v)}
                        className="w-full flex items-center justify-between px-4 py-2.5 text-left"
                    >
                        <span className="flex items-center gap-2 text-[11px] font-medium text-[#6b7280] uppercase tracking-wide">
                            {ajustesAbertos ? <ChevronDown className="w-3.5 h-3.5" strokeWidth={1.75} /> : <ChevronRight className="w-3.5 h-3.5" strokeWidth={1.75} />}
                            Parâmetros e ajustes de custo
                        </span>
                        <span className="text-[11px] text-[#6b7280] truncate ml-4">
                            Margem {tela.profitMargin}% · ICMS {tela.icmsIncluso ? 'incluso' : 'por fora'} · Adicional {tela.adicionalPadrao || 0}% ·{' '}
                            {tela.seguroModo === 'ddr' ? 'DDR' : 'Ad valorem'} · Prazo {tela.prazoDias} dias
                            {somenteLeitura && ' · somente leitura'}
                        </span>
                    </button>
                    {ajustesAbertos && (
                        <fieldset disabled={somenteLeitura} className="px-4 pb-4 pt-1 border-t border-[#f3f4f6]">
                            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-12 gap-3 mt-3">
                                <div>
                                    <label className={rotulo}>Veículo padrão</label>
                                    <select value={tela.veiculoPadrao} onChange={e => alterar('veiculoPadrao', e.target.value)} className={campo}>
                                        <option value="">Nenhum</option>
                                        {veiculos.map(v => <option key={v} value={v}>{v}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className={rotulo}>Margem (%)</label>
                                    <input type="text" value={tela.profitMargin} onChange={e => alterar('profitMargin', e.target.value)} className={campo} />
                                </div>
                                <div>
                                    <label className={rotulo}>Tipo de carga</label>
                                    <select value={tela.cargoType} onChange={e => alterar('cargoType', e.target.value)} className={campo}>
                                        {tiposDeCarga.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className={rotulo}>Juros (% a.m.)</label>
                                    <input type="text" value={tela.jurosMensal} onChange={e => alterar('jurosMensal', e.target.value)} className={campo} />
                                </div>
                                <div>
                                    <label className={rotulo}>Prazo (dias)</label>
                                    <input type="number" min="0" value={tela.prazoDias} onChange={e => alterar('prazoDias', e.target.value)} className={campo} />
                                    <p className={dica}>Taxa: {taxaAntecipacaoProporcional(nJuros, nPrazo).toFixed(2).replace('.', ',')}%</p>
                                </div>
                                <div>
                                    <label className={rotulo}>Comissão (%)</label>
                                    <input
                                        type="number" step="0.01" value={tela.comissaoPercent}
                                        onChange={e => alterar('comissaoPercent', e.target.value)}
                                        placeholder={`Padrão ${(fedTaxes.commissionPercent ?? 0).toFixed(2).replace('.', ',')}`}
                                        className={campo}
                                    />
                                </div>
                                <div>
                                    <label className={rotulo}>ICMS no preço</label>
                                    <select value={tela.icmsIncluso ? 'sim' : 'nao'} onChange={e => alterar('icmsIncluso', e.target.value === 'sim')} className={campo}>
                                        <option value="sim">Incluso</option>
                                        <option value="nao">Por fora</option>
                                    </select>
                                </div>
                                <div>
                                    <label className={rotulo}>Adicional piso (%)</label>
                                    <input
                                        type="text" inputMode="decimal" value={tela.adicionalPadrao}
                                        onChange={e => {
                                            if (e.target.value.includes('-')) { erro('Adicional negativo é bloqueado: o custo motorista nunca fica abaixo do piso ANTT.'); return; }
                                            alterar('adicionalPadrao', e.target.value);
                                        }}
                                        className={`${campo} ${avisoAdicionalPadrao ? '!bg-amber-50 !border-amber-300' : ''}`}
                                    />
                                    <p className={`${dica} ${avisoAdicionalPadrao ? '!text-amber-700' : ''}`}>{avisoAdicionalPadrao || 'Não incide no pedágio.'}</p>
                                </div>
                                <div>
                                    <label className={rotulo}>Seguro</label>
                                    <select
                                        value={tela.seguroModo}
                                        onChange={e => {
                                            const modo = e.target.value as SeguroModo;
                                            setTela(t => ({ ...t, seguroModo: modo, seguroPct: modo === 'ddr' ? '0' : '' }));
                                        }}
                                        className={campo}
                                    >
                                        <option value="ad_valorem">Ad valorem</option>
                                        <option value="ddr">DDR</option>
                                    </select>
                                </div>
                                <div>
                                    <label className={rotulo}>Ad valorem cobrado (%)</label>
                                    <input
                                        type="text" inputMode="decimal" value={tela.seguroPct} placeholder="Ex.: 0,10"
                                        onChange={e => { if (!e.target.value.includes('-')) alterar('seguroPct', e.target.value); }}
                                        className={`${campo} ${seguroNaoDefinido ? '!bg-amber-50 !border-amber-300' : ''}`}
                                    />
                                    <p className={`${dica} ${seguroNaoDefinido ? '!text-amber-700' : ''}`}>{seguroNaoDefinido ? 'Seguro não definido' : 'Entra no preço.'}</p>
                                </div>
                                <div>
                                    <label className={rotulo}>Custo seguro (%)</label>
                                    {tela.seguroModo === 'ddr' ? (
                                        <input
                                            type="text" inputMode="decimal" value={tela.taxaCustoDdr}
                                            onChange={e => { if (!e.target.value.includes('-')) alterar('taxaCustoDdr', e.target.value); }}
                                            className={campo}
                                        />
                                    ) : (
                                        <input type="text" value={fedTaxes.insurancePolicyRate.toLocaleString('pt-BR', { maximumFractionDigits: 4 })} disabled className={campo} />
                                    )}
                                    <p className={dica}>{tela.seguroModo === 'ddr' ? 'Taxa DDR sobre a NF.' : 'Apólice (Configurações).'}</p>
                                </div>
                                <div>
                                    <label className={rotulo}>Valor NF padrão (R$)</label>
                                    <input
                                        type="text" inputMode="decimal" value={tela.valorMercadoriaPadrao} placeholder="500.000,00"
                                        onChange={e => { if (!e.target.value.includes('-')) alterar('valorMercadoriaPadrao', e.target.value); }}
                                        className={campo}
                                    />
                                </div>
                            </div>
                        </fieldset>
                    )}
                </div>
            )}

            {/* Importação (rascunho) e exportação */}
            {!telaCheia && (
                <div className="bg-white border border-[#e5e7eb] px-4 py-2.5 rounded-lg flex flex-wrap items-center justify-between gap-3">
                    <p className="text-[12px] text-[#6b7280]">
                        {tela.nomeArquivo
                            ? <>Planilha: <span className="font-medium text-[#111827]">{tela.nomeArquivo}</span>{tela.abaUsada && <> · aba {tela.abaUsada}</>} · {brutas?.length ?? linhasNaOrdem?.length ?? 0} linha(s)</>
                            : <>Colunas: <span className="font-medium">Origem</span>, <span className="font-medium">Destino</span>, <span className="font-medium">Veículo</span> (opcionais: Valor NF, Tabela de compra). Teto de {TETO_ROTAS_DISTINTAS} rotas distintas.</>}
                    </p>
                    <div className="flex items-center gap-2">
                        {!somenteLeitura && (
                            <>
                                <button
                                    onClick={abrirArquivo}
                                    disabled={rodando}
                                    className={`${botao} bg-[#1d6fb8] text-white hover:bg-[#185a96]`}
                                >
                                    <Upload className="w-3.5 h-3.5" strokeWidth={1.75} />
                                    {rodando ? `Consultando ${progresso.feitas}/${progresso.total}…` : brutas?.length ? 'Reimportar planilha' : 'Importar planilha'}
                                </button>
                                <input ref={inputRef} type="file" className="hidden" accept=".xlsx,.xls" onChange={e => aoEscolherArquivo(e.target.files?.[0])} />
                                {brutas && brutas.length > 0 && (
                                    <button onClick={pedirReconsulta} disabled={rodando} className={`${botao} bg-white border border-[#e5e7eb] text-[#111827] hover:bg-[#f3f4f6]`}>
                                        <RefreshCw className="w-3.5 h-3.5 text-[#1d6fb8]" strokeWidth={1.75} /> Reconsultar rotas
                                    </button>
                                )}
                            </>
                        )}
                        {linhasNaOrdem && linhasNaOrdem.length > 0 && (
                            <button
                                onClick={() => onExportar(linhasNaOrdem, somenteLeitura && calculoSalvo ? calculoSalvo : paramsAtuais)}
                                className={`${botao} bg-white border border-[#e5e7eb] text-[#111827] hover:bg-[#f3f4f6]`}
                            >
                                <FileDown className="w-3.5 h-3.5 text-[#1d6fb8]" strokeWidth={1.75} /> Exportar Excel
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* Reimportar: confirma quantas linhas serão trocadas ANTES de abrir o arquivo. */}
            {confirmarReimportar && (
                <div className="border rounded-lg p-4 bg-amber-50 border-amber-200 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-[12px] text-amber-900">
                        Reimportar troca as <strong>{brutas?.length ?? 0} linha(s)</strong> desta rodada pelas da planilha nova,
                        e os ajustes feitos linha a linha se perdem. Rotas já consultadas não são cobradas de novo.
                    </p>
                    <div className="flex gap-2">
                        <button
                            onClick={() => { setConfirmarReimportar(false); inputRef.current?.click(); }}
                            className={`${botao} bg-[#1d6fb8] text-white hover:bg-[#185a96]`}
                        >
                            Escolher a planilha nova
                        </button>
                        <button onClick={() => setConfirmarReimportar(false)} className={`${botao} bg-white border border-[#e5e7eb] text-[#111827]`}>Cancelar</button>
                    </div>
                </div>
            )}

            {/* CONFIRMAÇÃO DE CUSTO — o Qualp é pago, então o disparo é explícito. */}
            {pendenteDeOk && (
                <div className={`border rounded-lg p-4 ${pendenteDeOk.plano.acimaDoTeto ? 'bg-red-50 border-red-200' : 'bg-[#eff6ff] border-[#bfdbfe]'}`}>
                    <div className="flex items-start gap-3">
                        <AlertTriangle className={`w-4 h-4 mt-0.5 shrink-0 ${pendenteDeOk.plano.acimaDoTeto ? 'text-red-600' : 'text-[#1d6fb8]'}`} strokeWidth={1.75} />
                        <div className="flex-1">
                            {pendenteDeOk.plano.acimaDoTeto ? (
                                <p className="text-[12px] text-red-800">
                                    <strong>Lote bloqueado:</strong> {pendenteDeOk.plano.rotasDistintas} rotas distintas, acima do teto de {pendenteDeOk.plano.teto}.
                                    Nenhuma consulta foi feita. Divida a planilha.
                                </p>
                            ) : (
                                <p className="text-[12px] text-[#374151]">
                                    {pendenteDeOk.modo === 'reconsultar' ? 'Reconsultar TODAS as rotas desta rodada' : pendenteDeOk.modo === 'importar' && brutas?.length ? `Trocar ${brutas.length} linha(s) por ${pendenteDeOk.brutas.length}` : 'Este lote'} vai
                                    custar <strong className="text-[#111827]">{pendenteDeOk.plano.rotasDistintas} consulta(s)</strong> ao Qualp (cota paga).
                                    {pendenteDeOk.plano.rotasJaConhecidas > 0 && <> {pendenteDeOk.plano.rotasJaConhecidas} rota(s) já consultada(s) não são cobradas de novo.</>}
                                    {(pendenteDeOk.plano.pendentes > 0 || pendenteDeOk.plano.urbanas > 0) && <> Fora do cálculo: {pendenteDeOk.plano.pendentes} pendência(s) e {pendenteDeOk.plano.urbanas} urbana(s).</>}
                                </p>
                            )}
                            <div className="flex items-center gap-2 mt-3">
                                {!pendenteDeOk.plano.acimaDoTeto && (
                                    <button onClick={() => consultar(pendenteDeOk)} className={`${botao} bg-[#1d6fb8] text-white hover:bg-[#185a96]`}>
                                        {pendenteDeOk.plano.rotasDistintas > 0 ? `Consultar ${pendenteDeOk.plano.rotasDistintas} rota(s)` : 'Aplicar sem consultar'}
                                    </button>
                                )}
                                <button onClick={() => setPendenteDeOk(null)} className={`${botao} bg-white border border-[#e5e7eb] text-[#111827]`}>Cancelar</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {colunasFaltando.length > 0 && !telaCheia && (
                <div className="flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600 mt-0.5 shrink-0" strokeWidth={1.75} />
                    <p className="text-[12px] text-amber-800">
                        Coluna(s) não encontrada(s): <span className="font-medium">{colunasFaltando.join(', ')}</span>. O que faltou virou pendência na linha.
                    </p>
                </div>
            )}

            {/* DE-PARA DE VEÍCULO — por rótulo: liga uma vez e todas as linhas resolvem. */}
            {rotulosPendentes.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                    <p className="text-[12px] font-medium text-amber-900 mb-2">
                        De-para de veículo: {rotulosPendentes.length} rótulo(s) sem ligação. Ligue e a tabela recalcula, sem consultar o Qualp.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-2">
                        {rotulosPendentes.map(r => (
                            <div key={r.rotulo} className="bg-white border border-amber-200 rounded-md p-2">
                                <p className="text-[12px] font-medium text-[#111827] truncate" title={r.rotulo}>"{r.rotulo}" · {r.linhas.length} linha(s)</p>
                                <select
                                    value={tela.deParaVeiculo[r.rotulo] || ''}
                                    onChange={e => setTela(t => {
                                        const novo = { ...t.deParaVeiculo };
                                        if (e.target.value) novo[r.rotulo] = e.target.value; else delete novo[r.rotulo];
                                        return { ...t, deParaVeiculo: novo };
                                    })}
                                    className={`${campo} mt-1`}
                                >
                                    <option value="">Escolha o veículo…</option>
                                    {(r.candidatos.length > 0 ? r.candidatos : veiculos).map(v => <option key={v} value={v}>{v}</option>)}
                                </select>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {rotasNovas.length > 0 && brutas && !rodando && !pendenteDeOk && (
                <div className="bg-[#eff6ff] border border-[#bfdbfe] rounded-lg px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-[12px] text-[#374151]">{rotasNovas.length} rota(s) nova(s) depois do de-para. O que já foi consultado não é cobrado de novo.</p>
                    <button
                        onClick={() => setPendenteDeOk({ plano: planejarLote(brutas, parametros(), rotasCache), brutas, modo: 'rotas-novas' })}
                        className={`${botao} bg-[#1d6fb8] text-white hover:bg-[#185a96]`}
                    >
                        Ver custo e consultar
                    </button>
                </div>
            )}

            {/* Resumo */}
            {resumo && !telaCheia && (
                <div className="flex flex-wrap gap-2">
                    {[
                        { rot: 'Linhas', val: String(resumo.total), cor: 'text-[#111827]' },
                        { rot: 'Com preço', val: String(resumo.ok), cor: 'text-emerald-700' },
                        { rot: 'Pendência', val: String(resumo.pendencia + resumo.urbano + resumo.falha), cor: resumo.pendencia + resumo.urbano + resumo.falha > 0 ? 'text-amber-600' : 'text-[#9ca3af]' },
                        { rot: 'Com alerta', val: String(resumo.comAlerta), cor: resumo.comAlerta > 0 ? 'text-red-600' : 'text-[#9ca3af]' },
                        { rot: 'Margem líq. média', val: p2(resumo.margemLiquidaMedia), cor: 'text-[#111827]' },
                        { rot: 'Preço ofertado total R$', val: n2(resumo.totalPrecoSugerido), cor: 'text-[#1d6fb8]' },
                    ].map(c => (
                        <div key={c.rot} className="bg-white border border-[#e5e7eb] rounded-lg px-3 py-1.5 flex items-baseline gap-2">
                            <span className="text-[10px] font-medium text-[#6b7280] uppercase tracking-tight">{c.rot}</span>
                            <span className={`text-[14px] font-medium tabular-nums ${c.cor}`}>{c.val}</span>
                        </div>
                    ))}
                    {estatQualp && (
                        <div className="px-3 py-1.5 text-[11px] text-[#6b7280] self-center">
                            Qualp: {estatQualp.consultas} consulta(s), {estatQualp.economizadas} poupada(s) pelo dedup.
                        </div>
                    )}
                </div>
            )}

            {/* Resultado */}
            {linhas ? (
                <div className="bg-white border border-[#e5e7eb] rounded-lg overflow-hidden">
                    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-[#e5e7eb] bg-[#f9fafb]">
                        <button
                            onClick={() => setAbrirCustos(v => !v)}
                            className={`${botao} bg-white border border-[#e5e7eb] text-[#111827] hover:bg-[#f3f4f6]`}
                        >
                            {abrirCustos ? <ChevronDown className="w-3.5 h-3.5" strokeWidth={1.75} /> : <ChevronRight className="w-3.5 h-3.5" strokeWidth={1.75} />}
                            {abrirCustos ? 'Fechar custos' : 'Abrir custos'}
                        </button>
                        {!somenteLeitura && (
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[10px] font-medium text-[#6b7280] uppercase">Adicional</span>
                                <input
                                    type="text" inputMode="decimal" value={adicionalMassa} placeholder="%"
                                    onChange={e => {
                                        if (e.target.value.includes('-')) { erro('Adicional negativo é bloqueado.'); return; }
                                        setAdicionalMassa(e.target.value);
                                    }}
                                    className={`w-14 px-2 py-1.5 border rounded-md text-[12px] text-right outline-none focus:border-[#1d6fb8] ${(lerPercentual(adicionalMassa) || 0) > ADICIONAL_PISO_AVISO_PCT ? 'bg-amber-50 border-amber-300' : 'bg-white border-[#e5e7eb]'}`}
                                />
                                <button
                                    onClick={aplicarNasSelecionadas}
                                    disabled={!selecionadas.size || adicionalMassa.trim() === ''}
                                    className={`${botao} bg-[#1d6fb8] text-white hover:bg-[#185a96]`}
                                >
                                    Aplicar às selecionadas ({selecionadas.size})
                                </button>
                                <button
                                    onClick={() => { setAdicionalPorLinha({}); onFeedback?.(`Todas as linhas seguem o adicional padrão (${paramsAtuais.adicionalPisoPadraoPct ?? 0}%).`); }}
                                    className={`${botao} bg-white border border-[#e5e7eb] text-[#111827] hover:bg-[#f3f4f6]`}
                                >
                                    Aplicar padrão a todas
                                </button>
                            </div>
                        )}
                    </div>
                    <div ref={caixaRef} className="overflow-auto overscroll-contain" style={{ height: alturaTabela }}>
                        <table className="text-[12px] tabular-nums border-separate border-spacing-0" style={{ width: larguraTabela, minWidth: '100%' }}>
                            <thead>
                                <tr className="text-[#6b7280] text-[11px]">
                                    {!somenteLeitura && (
                                        <th style={{ position: 'sticky', left: 0, width: LARG_SEL, minWidth: LARG_SEL }} className="sticky top-0 z-30 bg-[#f3f4f6] border-b border-[#e5e7eb] px-1">
                                            <input
                                                type="checkbox" checked={todasSelecionadas} disabled={!editaveis.length}
                                                onChange={() => setSelecionadas(todasSelecionadas ? new Set() : new Set(editaveis))}
                                                title="Selecionar todas as linhas com adicional editável"
                                            />
                                        </th>
                                    )}
                                    <th style={{ position: 'sticky', left: LARG_SEL, width: LARG_NUM, minWidth: LARG_NUM }} className="sticky top-0 z-30 bg-[#f3f4f6] border-b border-[#e5e7eb] px-2 py-1.5 text-left font-medium">#</th>
                                    {visiveis.map(c => (
                                        <th
                                            key={c.id}
                                            style={estiloCelula(c)}
                                            className={`sticky top-0 ${c.congelada ? 'z-30' : 'z-20'} bg-[#f3f4f6] border-b border-[#e5e7eb] px-2 py-1.5 font-medium leading-tight align-bottom ${c.texto ? 'text-left' : 'text-right'} ${c.id === ultimaCongelada ? 'shadow-[4px_0_6px_-2px_rgba(17,24,39,0.12)] border-r' : ''}`}
                                        >
                                            <span className="block">{c.titulo}</span>
                                            {c.copiar && (
                                                <button
                                                    onClick={() => copiarColuna(c)}
                                                    className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-medium text-[#1d6fb8] hover:underline"
                                                    title="Copiar a coluna inteira, na ordem da planilha importada"
                                                >
                                                    <Copy className="w-3 h-3" strokeWidth={1.75} /> Copiar
                                                </button>
                                            )}
                                        </th>
                                    ))}
                                    <th className="sticky top-0 z-20 bg-[#f3f4f6] border-b border-[#e5e7eb] px-2 py-1.5 text-left font-medium" style={{ width: LARG_STATUS, minWidth: LARG_STATUS }}>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {linhas.map(l => (
                                    <tr key={l.linhaExcel} className="group h-[34px]">
                                        {!somenteLeitura && (
                                            <td style={{ position: 'sticky', left: 0, width: LARG_SEL }} className="z-10 bg-white group-hover:bg-[#f9fafb] border-b border-[#f3f4f6] px-1 text-center">
                                                <input
                                                    type="checkbox"
                                                    checked={selecionadas.has(l.linhaExcel)}
                                                    disabled={!adicionalEditavel(l, paramsAtuais)}
                                                    onChange={() => setSelecionadas(prev => {
                                                        const novo = new Set(prev);
                                                        if (novo.has(l.linhaExcel)) novo.delete(l.linhaExcel); else novo.add(l.linhaExcel);
                                                        return novo;
                                                    })}
                                                />
                                            </td>
                                        )}
                                        <td style={{ position: 'sticky', left: LARG_SEL, width: LARG_NUM }} className="z-10 bg-white group-hover:bg-[#f9fafb] border-b border-[#f3f4f6] px-1 whitespace-nowrap text-[11px] text-[#9ca3af]">
                                            {l.linhaExcel}
                                            {l.adicionalProprio && <span className="inline-block w-1.5 h-1.5 ml-0.5 align-middle rounded-full bg-[#1d6fb8]" title="Adicional próprio" />}
                                        </td>
                                        {visiveis.map(c => {
                                            const valorCopia = c.copiar ? c.copiar(l) : null;
                                            const textoLongo = c.id === 'origem' ? l.origem : c.id === 'destino' ? l.destino : c.id === 'veiculo' ? l.veiculo : undefined;
                                            return (
                                                <td
                                                    key={c.id}
                                                    style={estiloCelula(c)}
                                                    title={textoLongo ?? (c.copiar && valorCopia != null ? 'Clique para copiar este valor' : undefined)}
                                                    onClick={c.copiar && valorCopia != null ? () => copiarTexto(formatarValorCopia(valorCopia), '1 valor copiado') : undefined}
                                                    className={`border-b border-[#f3f4f6] px-2 py-0.5 ${c.texto ? 'text-left truncate' : 'text-right'} text-[#111827] ${c.copiar && valorCopia != null ? 'cursor-copy hover:bg-[#eff6ff]' : ''} ${classeCongelada(c, 'bg-white group-hover:bg-[#f9fafb]')}`}
                                                >
                                                    {c.celula(l)}
                                                </td>
                                            );
                                        })}
                                        <td className="border-b border-[#f3f4f6] px-2 py-0.5 whitespace-nowrap" style={{ width: LARG_STATUS }}>
                                            <span
                                                className={`inline-block px-1.5 py-0.5 rounded border text-[10px] font-medium ${CORES_STATUS[l.status]}`}
                                                title={[rotuloStatus(l), ...l.alertas, ...l.pendencias].join('\n')}
                                            >
                                                {STATUS_CURTO[l.status] ?? l.status}{l.alertas.length > 0 && ' ⚠'}
                                            </span>
                                            {!somenteLeitura && (removerLinha === l.linhaExcel ? (
                                                <span className="ml-1 text-[10px]">
                                                    <button onClick={() => remover(l.linhaExcel)} className="text-red-600 font-medium hover:underline">Remover</button>
                                                    {' · '}
                                                    <button onClick={() => setRemoverLinha(null)} className="text-[#6b7280] hover:underline">Não</button>
                                                </span>
                                            ) : (
                                                <button
                                                    onClick={() => setRemoverLinha(l.linhaExcel)}
                                                    className="ml-1 align-middle text-[#d1d5db] hover:text-red-600"
                                                    title="Remover esta linha da rodada"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5 inline" strokeWidth={1.75} />
                                                </button>
                                            ))}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            {totais && (
                                <tfoot>
                                    <tr className="font-medium text-[#111827]">
                                        {!somenteLeitura && <td style={{ position: 'sticky', left: 0, bottom: 0 }} className="z-30 bg-[#f3f4f6] border-t border-[#e5e7eb]" />}
                                        <td style={{ position: 'sticky', left: LARG_SEL, bottom: 0 }} className="z-30 bg-[#f3f4f6] border-t border-[#e5e7eb] px-2 py-1.5" />
                                        {visiveis.map(c => (
                                            <td
                                                key={c.id}
                                                style={{ ...estiloCelula(c), bottom: 0, position: 'sticky' }}
                                                className={`${c.congelada ? 'z-30' : 'z-20'} bg-[#f3f4f6] border-t border-[#e5e7eb] px-2 py-1.5 ${c.texto ? 'text-left' : 'text-right'} ${c.id === ultimaCongelada ? 'shadow-[4px_0_6px_-2px_rgba(17,24,39,0.12)] border-r' : ''}`}
                                            >
                                                {c.total ?? ''}
                                            </td>
                                        ))}
                                        <td style={{ position: 'sticky', bottom: 0 }} className="z-20 bg-[#f3f4f6] border-t border-[#e5e7eb] px-2 py-1.5 text-[10px] font-normal text-[#6b7280]">Linhas com preço</td>
                                    </tr>
                                </tfoot>
                            )}
                        </table>
                    </div>
                </div>
            ) : (
                <div className="bg-white border border-dashed border-[#d1d5db] rounded-lg p-10 text-center">
                    <p className="text-[13px] text-[#6b7280]">
                        {somenteLeitura ? 'Esta rodada foi fechada sem linhas.' : 'Rodada vazia. Importe a planilha de rotas para começar.'}
                    </p>
                    {!somenteLeitura && (
                        <button onClick={abrirArquivo} className={`${botao} bg-[#1d6fb8] text-white hover:bg-[#185a96] mx-auto mt-3`}>
                            <Upload className="w-3.5 h-3.5" strokeWidth={1.75} /> Importar planilha
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};
