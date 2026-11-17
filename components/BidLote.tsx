// ============================================================================
// BID EM LOTE — Fase 1
//
// Importa uma planilha de rotas (origem/destino/veículo), consulta o Qualp por
// rota e roda CADA linha pelo MESMO motor de preço da calculadora. Mostra
// custo, preço sugerido e margem líquida por linha, e sai em Excel.
//
// Fase 1 NÃO PERSISTE NADA: vive na tela. Nenhuma cotação é criada, nenhuma
// numeração de proposta é consumida, nada entra no histórico ou no funil.
//
// A cota do Qualp é paga e limitada, então duas travas são de desenho, não de
// configuração: dedup por rota (repetida consulta uma vez só) e no máximo
// CONCORRENCIA consultas em voo. A planilha nunca é disparada de uma vez.
//
// Linha problemática não derruba o lote: pendência, frete urbano e falha do
// Qualp viram STATUS da linha, e as linhas com problema ficam no TOPO — uma
// pendência no meio de 70 linhas passa despercebida.
//
// AJUSTES DE CUSTO: ICMS incluso ou por fora, adicional sobre o piso (padrão
// da rodada + próprio por linha), seguro e a abertura total de custos. Tudo
// recalcula sobre a rota em cache — nenhum ajuste volta ao Qualp.
// ============================================================================

import React, { useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, FileDown, Info, Lock, Upload } from 'lucide-react';
import {
    planejarLote, processarLoteBid, reaplicarLote, extrairCacheDeRotas,
    resumirBid, rotuloStatus, taxaAntecipacaoProporcional, TETO_ROTAS_DISTINTAS,
    COLUNAS_ABERTURA, totaisAbertura, validarAdicionalPiso, aplicarAdicionalLinhas, adicionalEditavel,
    ADICIONAL_PISO_AVISO_PCT, TAXA_CUSTO_DDR_PADRAO,
    type LinhaBid, type LinhaBidBruta, type ParametrosBid, type PlanoLote, type SeguroModo,
    type ColunaAbertura, type FormatoColuna,
} from '../utils/bidLote';
import { lerPlanilhaBid, consultarRotaDoLote, exportarBidExcel } from '../services/bidLote';
import type { ANTTCoefficients, FederalTaxes } from '../types';

/** Consultas simultâneas ao Qualp. Baixo de propósito: a cota é paga. */
const CONCORRENCIA = 3;

interface Props {
    /** Parâmetros globais: tributos, ICMS por rota e os custos ocultos. */
    fedTaxes: FederalTaxes;
    /** Eixos e modo de cálculo por veículo, do cadastro de frota. */
    vehicleConfigs: Record<string, ANTTCoefficients & { factor?: number; axles?: number }>;
    /** Tipos de carga da Tabela A, a mesma lista da calculadora. */
    tiposDeCarga: string[];
    onFeedback?: (msg: string, tipo?: 'success' | 'error' | 'info') => void;
}

const brl = (v: number | null) =>
    v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (v: number | null) => (v == null ? '—' : `${v.toFixed(1)}%`);
const numero = (v: number | null) =>
    v == null ? '—' : v.toLocaleString('pt-BR', { maximumFractionDigits: 1 });

/** "1,5" -> 1.5. Percentual digitado; vazio ou ilegível = NaN. */
const lerPercentual = (s: string): number => (s.trim() === '' ? NaN : Number(s.trim().replace(',', '.')));
/** "500.000,00" -> 500000. Valor em R$ digitado; vazio = null. */
const lerReais = (s: string): number | null => {
    const t = s.replace(/R\$/gi, '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
};

const formatar = (formato: FormatoColuna, v: number | string | null): string => {
    if (v == null || v === '') return '—';
    if (typeof v === 'string') return v;
    switch (formato) {
        case 'brl': return brl(v);
        case 'pct': return `${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}%`;
        case 'km': return numero(v);
        case 'markup': return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        default: return String(v);
    }
};

/**
 * Célula editável (adicional % ou valor de mercadoria). Confirma no blur ou
 * Enter; vazio devolve a linha ao padrão da rodada. Sinal de menos não entra:
 * negativo é bloqueado na digitação, não só na validação.
 */
const CelulaEditavel: React.FC<{
    valor: number | null;
    texto: string;
    proprio: boolean;
    desabilitado: boolean;
    aviso: boolean;
    titulo: string;
    onSalvar: (bruto: string) => string | null;
    onErro: (msg: string) => void;
}> = ({ valor, texto, proprio, desabilitado, aviso, titulo, onSalvar, onErro }) => {
    if (desabilitado) return <span className="text-[#d1d5db]" title="Só para veículo de tabela ANTT com preço calculado">—</span>;
    const confirmar = (el: HTMLInputElement) => {
        if (el.value === texto) return;
        const erro = onSalvar(el.value);
        if (erro) { onErro(erro); el.value = texto; }
    };
    return (
        <input
            key={`${valor}-${proprio}`}
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
            className={`w-20 px-1.5 py-1 rounded-md border text-right text-xs outline-none focus:border-[#1d6fb8] ${
                aviso ? 'bg-amber-50 border-amber-300 text-amber-800'
                    : proprio ? 'bg-[#eff6ff] border-[#93c5fd] text-[#1d4ed8] font-medium'
                        : 'bg-[#f9fafb] border-[#e5e7eb] text-[#111827]'}`}
        />
    );
};

/** Colunas congeladas na rolagem horizontal: seleção, # e origem. */
const CONGELADA: Record<string, { left: number; width: number }> = {
    sel: { left: 0, width: 32 },
    num: { left: 32, width: 44 },
    origem: { left: 76, width: 170 },
};
const estiloCongelada = (id: string): React.CSSProperties | undefined =>
    CONGELADA[id] ? { position: 'sticky', left: CONGELADA[id].left, minWidth: CONGELADA[id].width, maxWidth: CONGELADA[id].width } : undefined;

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

export const BidLote: React.FC<Props> = ({ fedTaxes, vehicleConfigs, tiposDeCarga, onFeedback }) => {
    // ---- Parâmetros do bid inteiro ----
    const veiculos = useMemo(() => Object.keys(vehicleConfigs).sort(), [vehicleConfigs]);
    const [veiculoPadrao, setVeiculoPadrao] = useState('');
    const [profitMargin, setProfitMargin] = useState('15');
    const [cargoType, setCargoType] = useState(tiposDeCarga[0] || 'Carga geral');
    const [jurosMensal, setJurosMensal] = useState('1,5');
    const [prazoDias, setPrazoDias] = useState('30');
    const [comissaoPercent, setComissaoPercent] = useState('');
    /** De-para do operador: rótulo da planilha -> veículo do cadastro. */
    const [deParaVeiculo, setDeParaVeiculo] = useState<Record<string, string>>({});
    // ---- Ajustes de custo da rodada (defaults = comportamento anterior) ----
    const [icmsIncluso, setIcmsIncluso] = useState(true);
    const [adicionalPadrao, setAdicionalPadrao] = useState('0');
    /** Adicional próprio por linha (linhaExcel -> %). Ausente = segue o padrão. */
    const [adicionalPorLinha, setAdicionalPorLinha] = useState<Record<number, number>>({});
    // Ad valorem começa com o % cobrado VAZIO (não definido, com aviso); DDR
    // começa cobrando 0 — trocar o modo reposiciona o campo nesse ponto de partida.
    const [seguroModo, setSeguroModo] = useState<SeguroModo>('ad_valorem');
    const [seguroPct, setSeguroPct] = useState('');
    const [taxaCustoDdr, setTaxaCustoDdr] = useState(String(TAXA_CUSTO_DDR_PADRAO).replace('.', ','));
    const [valorMercadoriaPadrao, setValorMercadoriaPadrao] = useState('');
    /** Valor de mercadoria editado na tela (linhaExcel -> R$). Vence o da planilha. */
    const [valorMercadoriaPorLinha, setValorMercadoriaPorLinha] = useState<Record<number, number>>({});
    const [abrirCustos, setAbrirCustos] = useState(false);
    const [selecionadas, setSelecionadas] = useState<Set<number>>(new Set());
    const [adicionalMassa, setAdicionalMassa] = useState('');

    // ---- Lote ----
    /**
     * Linhas COM A ROTA EM CACHE, exatamente como voltaram da consulta. É a
     * fonte do motor vivo: a tabela exibida é derivada daqui por recálculo, e
     * trocar parâmetro NUNCA volta ao Qualp.
     */
    const [linhasBrutas, setLinhasBrutas] = useState<LinhaBid[] | null>(null);
    /**
     * As linhas CRUAS do arquivo. Precisam ficar guardadas porque mexer no
     * de-para de veículo exige RE-PREPARAR a linha (re-resolver o veículo), não
     * só refazer a conta — e o preparo parte do dado cru.
     */
    const [brutasArquivo, setBrutasArquivo] = useState<LinhaBidBruta[] | null>(null);
    const [abaInfo, setAbaInfo] = useState<{ usada: string; abas: string[] } | null>(null);
    const [rodando, setRodando] = useState(false);
    const [progresso, setProgresso] = useState({ feitas: 0, total: 0 });
    const [colunasFaltando, setColunasFaltando] = useState<string[]>([]);
    const [estatQualp, setEstatQualp] = useState<{ consultas: number; distintas: number; economizadas: number } | null>(null);
    const [nomeArquivo, setNomeArquivo] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    /**
     * Lote lido e planejado, esperando o OK do operador. O custo em consultas
     * já está calculado aqui — nada foi consultado ainda.
     */
    const [pendenteDeOk, setPendenteDeOk] = useState<{ plano: PlanoLote; brutas: LinhaBidBruta[] } | null>(null);

    const nJuros = parseFloat(jurosMensal.replace(',', '.')) || 0;
    const nPrazo = parseInt(prazoDias, 10) || 0;
    const taxaAplicada = taxaAntecipacaoProporcional(nJuros, nPrazo);
    const nAdicionalPadrao = lerPercentual(adicionalPadrao);
    const adicionalPadraoValido = Number.isFinite(nAdicionalPadrao) ? Math.max(0, nAdicionalPadrao) : 0;
    const avisoAdicionalPadrao = validarAdicionalPiso(adicionalPadraoValido).aviso;

    const parametros = (): ParametrosBid => ({
        profitMargin: parseFloat(profitMargin.replace(',', '.')) || 0,
        fedTaxes: {
            insurancePolicyRate: fedTaxes.insurancePolicyRate,
            pis: fedTaxes.pis, cofins: fedTaxes.cofins, csll: fedTaxes.csll, irpj: fedTaxes.irpj,
        },
        icmsRates: fedTaxes.icmsRates,
        cargoType,
        veiculoPadrao,
        veiculosCadastro: veiculos,
        deParaVeiculo,
        eixosPorVeiculo: Object.fromEntries(veiculos.map(v => [v, vehicleConfigs[v]?.axles])),
        modoPorVeiculo: Object.fromEntries(veiculos.map(v => [v, vehicleConfigs[v]?.calcMode])),
        jurosMensal: nJuros,
        prazoDias: nPrazo,
        comissaoPercent,
        comissaoPadrao: fedTaxes.commissionPercent,
        icmsIncluso,
        adicionalPisoPadraoPct: adicionalPadraoValido,
        adicionalPorLinha,
        seguroModo,
        seguroPct: Number.isFinite(lerPercentual(seguroPct)) ? Math.max(0, lerPercentual(seguroPct)) : null,
        taxaCustoDdrPct: Number.isFinite(lerPercentual(taxaCustoDdr)) ? Math.max(0, lerPercentual(taxaCustoDdr)) : TAXA_CUSTO_DDR_PADRAO,
        valorMercadoriaPadrao: lerReais(valorMercadoriaPadrao),
        valorMercadoriaPorLinha,
    });

    /**
     * MOTOR VIVO. A tabela exibida é DERIVADA das linhas em cache: qualquer
     * parâmetro do topo que mude refaz a conta aqui, na hora, sem tocar no
     * Qualp. É por isso que a tabela não é estado — se fosse, ela congelaria
     * no valor do momento da consulta.
     */
    const reaplicado = useMemo(() => {
        if (!linhasBrutas || !brutasArquivo) return null;
        // O cache guarda o que o Qualp já respondeu, por chave de rota. Re-preparar
        // reaproveita tudo: só rota NOVA (ex.: a que apareceu depois de um de-para)
        // fica faltando, e aí a confirmação pede o OK antes de gastar.
        return reaplicarLote(brutasArquivo, parametros(), extrairCacheDeRotas(linhasBrutas));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [linhasBrutas, brutasArquivo, profitMargin, cargoType, jurosMensal, prazoDias,
        comissaoPercent, veiculoPadrao, deParaVeiculo, fedTaxes,
        icmsIncluso, adicionalPadrao, adicionalPorLinha, seguroModo, seguroPct, taxaCustoDdr,
        valorMercadoriaPadrao, valorMercadoriaPorLinha]);

    const linhas = useMemo(() => (reaplicado ? ordenar(reaplicado.linhas) : null), [reaplicado]);
    /** Rotas que apareceram depois do lote inicial (tipicamente via de-para). */
    const rotasNovas = reaplicado?.rotasNovas ?? [];

    /**
     * Passo 1: ler e PLANEJAR. Não consulta nada — só descobre quantas rotas
     * distintas o lote vai custar, e pede o OK. A cota do Qualp é paga.
     */
    const aoEscolherArquivo = async (file: File | undefined) => {
        if (!file || rodando) return;
        setLinhasBrutas(null);
        setBrutasArquivo(null);
        setEstatQualp(null);
        setPendenteDeOk(null);
        // Ajustes por linha valem para a planilha em que foram feitos.
        setAdicionalPorLinha({});
        setValorMercadoriaPorLinha({});
        setSelecionadas(new Set());
        setNomeArquivo(file.name);
        try {
            const { linhas: brutas, faltando, totalLinhas, abaUsada, abas } = lerPlanilhaBid(await file.arrayBuffer());
            setColunasFaltando(faltando);
            setAbaInfo({ usada: abaUsada, abas });
            setBrutasArquivo(brutas);
            if (!totalLinhas) {
                onFeedback?.('A planilha está vazia.', 'error');
                return;
            }
            const plano = planejarLote(brutas, parametros());
            if (plano.rotasDistintas === 0) {
                // Nada a consultar: mostra o resultado (só pendências/urbanas)
                // sem incomodar o operador com uma confirmação de custo zero.
                setLinhasBrutas(plano.linhas);
                onFeedback?.('Nenhuma rota para consultar — confira as pendências.', 'info');
                return;
            }
            setPendenteDeOk({ plano, brutas });
        } catch (e: any) {
            console.error('bid em lote (leitura):', e);
            onFeedback?.(`Falha ao ler a planilha: ${e?.message || e}`, 'error');
        } finally {
            if (inputRef.current) inputRef.current.value = '';
        }
    };

    /**
     * Passo 2: só aqui o Qualp é chamado, depois do OK explícito.
     *
     * Serve para o lote inicial E para as rotas que aparecem depois (de-para de
     * veículo): o cache do que já foi respondido entra junto, então o que já se
     * pagou não é consultado de novo.
     */
    const consultar = async (brutas: LinhaBidBruta[]) => {
        if (rodando) return;
        setPendenteDeOk(null);
        setRodando(true);
        try {
            setProgresso({ feitas: 0, total: brutas.length });
            const r = await processarLoteBid(brutas, parametros(), {
                consultarRota: consultarRotaDoLote,
                concorrencia: CONCORRENCIA,
                onProgresso: (feitas, total) => setProgresso({ feitas, total }),
                rotasEmCache: linhasBrutas ? extrairCacheDeRotas(linhasBrutas) : {},
            });

            // Teto duro: o módulo recusa e não consulta nada.
            if (r.bloqueado) {
                setLinhasBrutas(null);
                onFeedback?.(r.bloqueado.motivo, 'error');
                return;
            }

            setLinhasBrutas(r.linhas);
            setEstatQualp(prev => ({
                // Acumula: o segundo disparo (rotas novas do de-para) soma ao que
                // o lote inicial já gastou. Mostrar só o último esconderia o custo.
                consultas: (prev?.consultas ?? 0) + r.consultasQualp,
                distintas: r.rotasDistintas,
                economizadas: r.economizadas,
            }));
            onFeedback?.(`Lote processado: ${r.linhas.length} linha(s), ${r.consultasQualp} consulta(s) nova(s) ao Qualp.`);
        } catch (e: any) {
            console.error('bid em lote:', e);
            onFeedback?.(`Falha ao processar o lote: ${e?.message || e}`, 'error');
        } finally {
            setRodando(false);
        }
    };

    const resumo = linhas ? resumirBid(linhas) : null;
    const totais = useMemo(() => (linhas ? totaisAbertura(linhas) : null), [linhas]);
    const colunasVisiveis = abrirCustos ? COLUNAS_ABERTURA : COLUNAS_ABERTURA.filter(c => c.sempreVisivel);
    const paramsAtuais = parametros();
    const editaveis = linhas ? linhas.filter(l => adicionalEditavel(l, paramsAtuais)).map(l => l.linhaExcel) : [];
    const todasSelecionadas = editaveis.length > 0 && editaveis.every(n => selecionadas.has(n));

    const erro = (msg: string) => onFeedback?.(msg, 'error');
    const seguroNaoDefinido = seguroModo === 'ad_valorem' && !Number.isFinite(lerPercentual(seguroPct));

    /** Edição de uma célula de adicional. Vazio = volta ao padrão da rodada. */
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

    const aplicarPadraoATodas = () => {
        setAdicionalPorLinha({});
        onFeedback?.(`Todas as linhas seguem o adicional padrão (${adicionalPadraoValido}%).`);
    };

    const salvarValorMercadoriaLinha = (linhaExcel: number, bruto: string): string | null => {
        const v = lerReais(bruto);
        if (v != null && v < 0) return 'Valor de mercadoria negativo é bloqueado.';
        setValorMercadoriaPorLinha(prev => {
            const novo = { ...prev };
            if (v == null) delete novo[linhaExcel]; else novo[linhaExcel] = v;
            return novo;
        });
        return null;
    };

    const celula = (c: ColunaAbertura, l: LinhaBid): React.ReactNode => {
        if (c.id === 'adicionalPisoPct') {
            const pctLinha = l.adicionalPisoPct;
            return (
                <CelulaEditavel
                    valor={pctLinha}
                    texto={pctLinha == null ? '' : String(pctLinha).replace('.', ',')}
                    proprio={l.adicionalProprio}
                    desabilitado={!adicionalEditavel(l, paramsAtuais)}
                    aviso={(pctLinha ?? 0) > ADICIONAL_PISO_AVISO_PCT}
                    titulo={l.adicionalProprio ? 'Adicional próprio desta linha (vazio = volta ao padrão)' : 'Segue o padrão da rodada'}
                    onSalvar={b => salvarAdicionalLinha(l.linhaExcel, b)}
                    onErro={erro}
                />
            );
        }
        if (c.id === 'valorMercadoria') {
            const proprio = valorMercadoriaPorLinha[l.linhaExcel] != null;
            return (
                <CelulaEditavel
                    valor={l.valorMercadoriaEfetivo}
                    texto={l.valorMercadoriaEfetivo == null ? '' : l.valorMercadoriaEfetivo.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    proprio={proprio}
                    desabilitado={l.status !== 'ok'}
                    aviso={l.valorMercadoriaEfetivo == null}
                    titulo="Valor da NF desta linha (vazio = planilha ou padrão)"
                    onSalvar={b => salvarValorMercadoriaLinha(l.linhaExcel, b)}
                    onErro={erro}
                />
            );
        }
        if (c.id === 'veiculo') {
            return (
                <>
                    {l.veiculo || '—'}
                    {l.veiculo && !l.veiculoDaLinha && <span className="ml-1 text-[9px] font-medium text-blue-500 uppercase">padrão</span>}
                </>
            );
        }
        return formatar(c.formato, c.valor(l));
    };

    /**
     * Rótulos da planilha que o match tolerante não conseguiu ligar sozinho.
     * Agrupado por rótulo (não por linha): o operador liga "Carreta" uma vez e
     * as 40 linhas que usam esse rótulo resolvem juntas.
     */
    const rotulosPendentes = useMemo(() => {
        if (!linhas) return [];
        const mapa = new Map<string, { rotulo: string; linhas: number[]; candidatos: string[] }>();
        for (const l of linhas) {
            if (l.veiculo || !l.veiculoPlanilha) continue;
            const atual = mapa.get(l.veiculoPlanilha) || { rotulo: l.veiculoPlanilha, linhas: [], candidatos: l.candidatosVeiculo };
            atual.linhas.push(l.linhaExcel);
            mapa.set(l.veiculoPlanilha, atual);
        }
        return [...mapa.values()];
    }, [linhas]);

    return (
        <div className="space-y-6">
            {/* Selos da rodada: fixos no topo enquanto a tabela rola. */}
            {(!icmsIncluso || seguroNaoDefinido) && (
                <div className="sticky top-0 z-30 space-y-2">
                    {!icmsIncluso && (
                        <div className="flex items-center gap-2 px-4 py-2.5 bg-[#1d6fb8] text-white rounded-xl shadow-sm">
                            <Info className="w-4 h-4 shrink-0" strokeWidth={1.75} />
                            <p className="text-xs font-medium">Preço SEM ICMS. ICMS por fora ou por conta do embarcador.</p>
                        </div>
                    )}
                    {seguroNaoDefinido && (
                        <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl">
                            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" strokeWidth={1.75} />
                            <p className="text-xs font-medium">Seguro não definido. Ad valorem cobrado do cliente ainda vazio.</p>
                        </div>
                    )}
                </div>
            )}

            {/* Aviso do que esta tela é e do que ela NÃO faz */}
            <div className="flex items-start gap-3 p-4 bg-[#f9fafb] border border-[#e5e7eb] rounded-xl">
                <Lock className="w-4 h-4 text-[#6b7280] mt-0.5 shrink-0" strokeWidth={1.75} />
                <div>
                    <h3 className="font-medium text-sm text-[#111827] mb-1">Bid em Lote · estudo de precificação</h3>
                    <p className="text-[11px] font-normal text-[#6b7280] leading-relaxed">
                        Roda cada rota da planilha pelo <strong className="font-medium">mesmo motor de preço da calculadora</strong>.
                        Nada é salvo: não cria cotação, não consome numeração de proposta e não entra no histórico nem no funil.
                        O resultado vive nesta tela e sai em Excel.
                        Custo direto: <strong className="font-medium">piso ANTT (+ adicional) + pedágio</strong>.
                    </p>
                </div>
            </div>

            {/* Parâmetros do bid */}
            <div className="bg-white border border-[#e5e7eb] p-6 rounded-xl">
                <div className="flex items-center justify-between mb-4">
                    <h4 className="text-[10px] font-medium text-[#6b7280] uppercase tracking-widest">Parâmetros deste bid</h4>
                    {linhasBrutas && (
                        <span className="text-[9px] font-medium text-emerald-600 uppercase tracking-tight bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-md">
                            Recalcula ao vivo · sem nova consulta ao Qualp
                        </span>
                    )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
                    <div>
                        <label className="text-[10px] font-medium text-[#6b7280] uppercase tracking-tighter block mb-1.5">Veículo padrão</label>
                        <select
                            value={veiculoPadrao}
                            onChange={e => setVeiculoPadrao(e.target.value)}
                            className="w-full px-3 py-2.5 bg-[#f9fafb] border border-[#e5e7eb] rounded-lg text-sm font-normal text-[#111827] outline-none focus:border-[#1d6fb8] transition-colors"
                        >
                            <option value="">Nenhum</option>
                            {veiculos.map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                        <p className="text-[9px] font-medium text-[#9ca3af] mt-1.5 uppercase tracking-tight">Usado só quando a linha não traz veículo.</p>
                    </div>
                    <div>
                        <label className="text-[10px] font-medium text-[#6b7280] uppercase tracking-tighter block mb-1.5">Margem pretendida (%)</label>
                        <input
                            type="text"
                            value={profitMargin}
                            onChange={e => setProfitMargin(e.target.value)}
                            className="w-full px-3 py-2.5 bg-[#f9fafb] border border-[#e5e7eb] rounded-lg text-sm font-normal text-[#111827] outline-none focus:border-[#1d6fb8] transition-colors"
                        />
                    </div>
                    <div>
                        <label className="text-[10px] font-medium text-[#6b7280] uppercase tracking-tighter block mb-1.5">Tipo de carga</label>
                        <select
                            value={cargoType}
                            onChange={e => setCargoType(e.target.value)}
                            className="w-full px-3 py-2.5 bg-[#f9fafb] border border-[#e5e7eb] rounded-lg text-sm font-normal text-[#111827] outline-none focus:border-[#1d6fb8] transition-colors"
                        >
                            {tiposDeCarga.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="text-[10px] font-medium text-[#6b7280] uppercase tracking-tighter block mb-1.5">Juros (% ao mês)</label>
                        <input
                            type="text"
                            value={jurosMensal}
                            onChange={e => setJurosMensal(e.target.value)}
                            className="w-full px-3 py-2.5 bg-[#f9fafb] border border-[#e5e7eb] rounded-lg text-sm font-normal text-[#111827] outline-none focus:border-[#1d6fb8] transition-colors"
                        />
                    </div>
                    <div>
                        <label className="text-[10px] font-medium text-[#6b7280] uppercase tracking-tighter block mb-1.5">Prazo (dias)</label>
                        <input
                            type="number"
                            min="0"
                            value={prazoDias}
                            onChange={e => setPrazoDias(e.target.value)}
                            className="w-full px-3 py-2.5 bg-[#f9fafb] border border-[#e5e7eb] rounded-lg text-sm font-normal text-[#111827] outline-none focus:border-[#1d6fb8] transition-colors"
                        />
                        <p className="text-[9px] font-medium text-[#1d6fb8] mt-1.5 uppercase tracking-tight">
                            Taxa aplicada: {taxaAplicada.toFixed(2).replace('.', ',')}% ({jurosMensal || 0}% × {nPrazo}/30)
                        </p>
                    </div>
                    <div>
                        <label className="text-[10px] font-medium text-[#6b7280] uppercase tracking-tighter block mb-1.5">Comissão (%)</label>
                        <input
                            type="number"
                            step="0.01"
                            value={comissaoPercent}
                            onChange={e => setComissaoPercent(e.target.value)}
                            placeholder={`Padrão: ${(fedTaxes.commissionPercent ?? 0).toFixed(2).replace('.', ',')}%`}
                            className="w-full px-3 py-2.5 bg-[#f9fafb] border border-[#e5e7eb] rounded-lg text-sm font-normal text-[#111827] outline-none focus:border-[#1d6fb8] transition-colors"
                        />
                    </div>
                </div>

                {/* Ajustes de custo da rodada */}
                <h4 className="text-[10px] font-medium text-[#6b7280] uppercase tracking-widest mt-6 mb-4 pt-5 border-t border-[#f3f4f6]">Ajustes de custo</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
                    <div>
                        <label className="text-[10px] font-medium text-[#6b7280] uppercase tracking-tighter block mb-1.5">ICMS no preço</label>
                        <select
                            value={icmsIncluso ? 'sim' : 'nao'}
                            onChange={e => setIcmsIncluso(e.target.value === 'sim')}
                            className="w-full px-3 py-2.5 bg-[#f9fafb] border border-[#e5e7eb] rounded-lg text-sm font-normal text-[#111827] outline-none focus:border-[#1d6fb8] transition-colors"
                        >
                            <option value="sim">Incluso</option>
                            <option value="nao">Por fora (sem ICMS)</option>
                        </select>
                        <p className="text-[9px] font-medium text-[#9ca3af] mt-1.5 uppercase tracking-tight">Alíquota segue a regra da rota.</p>
                    </div>
                    <div>
                        <label className="text-[10px] font-medium text-[#6b7280] uppercase tracking-tighter block mb-1.5">Adicional sobre o piso (%)</label>
                        <input
                            type="text"
                            inputMode="decimal"
                            value={adicionalPadrao}
                            onChange={e => {
                                if (e.target.value.includes('-')) { erro('Adicional negativo é bloqueado: o custo motorista nunca fica abaixo do piso ANTT.'); return; }
                                setAdicionalPadrao(e.target.value);
                            }}
                            className={`w-full px-3 py-2.5 border rounded-lg text-sm font-normal text-[#111827] outline-none focus:border-[#1d6fb8] transition-colors ${avisoAdicionalPadrao ? 'bg-amber-50 border-amber-300' : 'bg-[#f9fafb] border-[#e5e7eb]'}`}
                        />
                        <p className={`text-[9px] font-medium mt-1.5 uppercase tracking-tight ${avisoAdicionalPadrao ? 'text-amber-700' : 'text-[#9ca3af]'}`}>
                            {avisoAdicionalPadrao || 'Padrão da rodada. Não incide sobre pedágio.'}
                        </p>
                    </div>
                    <div>
                        <label className="text-[10px] font-medium text-[#6b7280] uppercase tracking-tighter block mb-1.5">Seguro</label>
                        <select
                            value={seguroModo}
                            onChange={e => {
                                const modo = e.target.value as SeguroModo;
                                setSeguroModo(modo);
                                setSeguroPct(modo === 'ddr' ? '0' : '');
                            }}
                            className="w-full px-3 py-2.5 border rounded-lg text-sm font-normal text-[#111827] outline-none focus:border-[#1d6fb8] transition-colors bg-[#f9fafb] border-[#e5e7eb]"
                        >
                            <option value="ad_valorem">Ad valorem</option>
                            <option value="ddr">DDR</option>
                        </select>
                    </div>
                    <div>
                        <label className="text-[10px] font-medium text-[#6b7280] uppercase tracking-tighter block mb-1.5">Ad valorem cobrado (%)</label>
                        <input
                            type="text"
                            inputMode="decimal"
                            value={seguroPct}
                            onChange={e => { if (!e.target.value.includes('-')) setSeguroPct(e.target.value); }}
                            placeholder="Ex.: 0,10"
                            className={`w-full px-3 py-2.5 border rounded-lg text-sm font-normal text-[#111827] outline-none focus:border-[#1d6fb8] transition-colors ${seguroNaoDefinido ? 'bg-amber-50 border-amber-300' : 'bg-[#f9fafb] border-[#e5e7eb]'}`}
                        />
                        <p className={`text-[9px] font-medium mt-1.5 uppercase tracking-tight ${seguroNaoDefinido ? 'text-amber-700' : 'text-[#9ca3af]'}`}>
                            {seguroNaoDefinido ? 'Seguro não definido' : 'Cobrado do cliente, entra no preço.'}
                        </p>
                    </div>
                    <div>
                        <label className="text-[10px] font-medium text-[#6b7280] uppercase tracking-tighter block mb-1.5">Custo do seguro (%)</label>
                        {seguroModo === 'ddr' ? (
                            <input
                                type="text"
                                inputMode="decimal"
                                value={taxaCustoDdr}
                                onChange={e => { if (!e.target.value.includes('-')) setTaxaCustoDdr(e.target.value); }}
                                className="w-full px-3 py-2.5 border rounded-lg text-sm font-normal text-[#111827] outline-none focus:border-[#1d6fb8] transition-colors bg-[#f9fafb] border-[#e5e7eb]"
                            />
                        ) : (
                            <input
                                type="text"
                                value={fedTaxes.insurancePolicyRate.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}
                                disabled
                                className="w-full px-3 py-2.5 border rounded-lg text-sm font-normal text-[#111827] outline-none focus:border-[#1d6fb8] transition-colors bg-[#f9fafb] border-[#e5e7eb] disabled:opacity-60"
                            />
                        )}
                        <p className="text-[9px] font-medium text-[#9ca3af] mt-1.5 uppercase tracking-tight">
                            {seguroModo === 'ddr' ? 'Taxa DDR sobre a NF.' : 'Taxa da apólice (Configurações).'}
                        </p>
                    </div>
                    <div>
                        <label className="text-[10px] font-medium text-[#6b7280] uppercase tracking-tighter block mb-1.5">Valor NF padrão (R$)</label>
                        <input
                            type="text"
                            inputMode="decimal"
                            value={valorMercadoriaPadrao}
                            onChange={e => { if (!e.target.value.includes('-')) setValorMercadoriaPadrao(e.target.value); }}
                            placeholder="Ex.: 500.000,00"
                            className="w-full px-3 py-2.5 border rounded-lg text-sm font-normal text-[#111827] outline-none focus:border-[#1d6fb8] transition-colors bg-[#f9fafb] border-[#e5e7eb]"
                        />
                        <p className="text-[9px] font-medium text-[#9ca3af] mt-1.5 uppercase tracking-tight">Para linhas sem valor de NF.</p>
                    </div>
                </div>
            </div>

            {/* Importar */}
            <div className="bg-white border border-[#e5e7eb] p-6 rounded-xl flex flex-wrap items-center justify-between gap-4">
                <div>
                    <h4 className="font-medium text-sm text-[#111827] mb-1">Planilha de rotas</h4>
                    <p className="text-[11px] font-normal text-[#6b7280]">
                        Colunas: <span className="font-medium">Origem</span>, <span className="font-medium">Destino</span>, <span className="font-medium">Veículo</span>
                        {' '}(opcionais: <span className="font-medium">Valor NF</span>, <span className="font-medium">Tabela de compra</span>).
                        {' '}Importar só LÊ o arquivo — a consulta ao Qualp é confirmada depois, com o custo na tela.
                        Teto de {TETO_ROTAS_DISTINTAS} rotas distintas por lote.
                        {nomeArquivo && <span className="ml-2 text-[#111827]">· {nomeArquivo}</span>}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => inputRef.current?.click()}
                        disabled={rodando}
                        className="px-4 py-2.5 bg-[#1d6fb8] text-white rounded-lg font-medium text-xs hover:bg-[#185a96] disabled:opacity-50 transition-colors flex items-center gap-2"
                    >
                        <Upload className="w-3.5 h-3.5" strokeWidth={1.75} />
                        {rodando ? `Consultando ${progresso.feitas}/${progresso.total}…` : 'Importar planilha'}
                    </button>
                    <input
                        ref={inputRef}
                        type="file"
                        className="hidden"
                        accept=".xlsx,.xls"
                        onChange={e => aoEscolherArquivo(e.target.files?.[0])}
                    />
                    {linhas && linhas.length > 0 && (
                        <button
                            onClick={() => { exportarBidExcel(linhas, parametros()); onFeedback?.('Excel gerado.'); }}
                            className="px-4 py-2.5 bg-white border border-[#e5e7eb] text-[#111827] rounded-lg font-medium text-xs hover:bg-[#f9fafb] transition-colors flex items-center gap-2"
                        >
                            <FileDown className="w-3.5 h-3.5 text-[#1d6fb8]" strokeWidth={1.75} /> Exportar Excel
                        </button>
                    )}
                </div>
            </div>

            {/* CONFIRMAÇÃO DE CUSTO — a cota do Qualp é paga, então o disparo é
                explícito. O número abaixo é o de rotas DISTINTAS (pós-dedup),
                calculado pelo mesmo caminho que a execução usa. */}
            {pendenteDeOk && (
                <div className={`border rounded-xl p-6 ${pendenteDeOk.plano.acimaDoTeto ? 'bg-red-50 border-red-200' : 'bg-[#eff6ff] border-[#bfdbfe]'}`}>
                    <div className="flex items-start gap-3">
                        <AlertTriangle className={`w-5 h-5 mt-0.5 shrink-0 ${pendenteDeOk.plano.acimaDoTeto ? 'text-red-600' : 'text-[#1d6fb8]'}`} strokeWidth={1.75} />
                        <div className="flex-1">
                            {pendenteDeOk.plano.acimaDoTeto ? (
                                <>
                                    <h4 className="font-medium text-sm text-red-900 mb-1">Lote bloqueado — divida a planilha</h4>
                                    <p className="text-[11px] font-normal text-red-800 leading-relaxed">
                                        São <strong className="font-medium">{pendenteDeOk.plano.rotasDistintas} rotas distintas</strong>, acima do teto
                                        de <strong className="font-medium">{pendenteDeOk.plano.teto}</strong> por lote.
                                        Nenhuma consulta foi feita. Separe a planilha em partes menores e importe uma por vez.
                                    </p>
                                </>
                            ) : (
                                <>
                                    <h4 className="font-medium text-sm text-[#111827] mb-1">Confirmar consulta ao Qualp</h4>
                                    <p className="text-[11px] font-normal text-[#6b7280] leading-relaxed">
                                        Este lote vai custar <strong className="font-medium text-[#111827]">{pendenteDeOk.plano.rotasDistintas} consulta(s)</strong> ao Qualp
                                        — a cota é paga. São {pendenteDeOk.plano.linhasComRota} linha(s) com rota, e o dedup já poupou{' '}
                                        <strong className="font-medium text-[#111827]">{pendenteDeOk.plano.economiaPrevista}</strong> consulta(s) de rota repetida.
                                        {(pendenteDeOk.plano.pendentes > 0 || pendenteDeOk.plano.urbanas > 0) && (
                                            <> Fora do cálculo: {pendenteDeOk.plano.pendentes} com pendência e {pendenteDeOk.plano.urbanas} urbana(s), que não consultam nada.</>
                                        )}
                                    </p>
                                </>
                            )}
                            <div className="flex items-center gap-2 mt-4">
                                {!pendenteDeOk.plano.acimaDoTeto && (
                                    <button
                                        onClick={() => consultar(pendenteDeOk.brutas)}
                                        className="px-4 py-2.5 bg-[#1d6fb8] text-white rounded-lg font-medium text-xs hover:bg-[#185a96] transition-colors"
                                    >
                                        Consultar {pendenteDeOk.plano.rotasDistintas} rota(s)
                                    </button>
                                )}
                                <button
                                    onClick={() => { setPendenteDeOk(null); setNomeArquivo(''); }}
                                    className="px-4 py-2.5 bg-white border border-[#e5e7eb] text-[#111827] rounded-lg font-medium text-xs hover:bg-[#f9fafb] transition-colors"
                                >
                                    Cancelar
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {abaInfo && abaInfo.abas.length > 1 && (
                <div className="flex items-start gap-2 p-4 bg-[#f9fafb] border border-[#e5e7eb] rounded-xl">
                    <Info className="w-4 h-4 text-[#6b7280] mt-0.5 shrink-0" strokeWidth={1.75} />
                    <p className="text-[11px] font-normal text-[#6b7280]">
                        O arquivo tem {abaInfo.abas.length} abas ({abaInfo.abas.join(', ')}). Li a aba{' '}
                        <span className="font-medium text-[#111827]">{abaInfo.usada}</span> — a primeira com dados e colunas reconhecidas.
                    </p>
                </div>
            )}

            {colunasFaltando.length > 0 && (
                <div className="flex items-start gap-2 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                    <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" strokeWidth={1.75} />
                    <p className="text-[11px] font-normal text-amber-800">
                        Coluna(s) não encontrada(s): <span className="font-medium">{colunasFaltando.join(', ')}</span>.
                        O lote rodou de todo jeito — o que faltou virou pendência na linha, não erro do arquivo.
                    </p>
                </div>
            )}

            {/* DE-PARA DE VEÍCULO — ligar o rótulo da planilha ao cadastro, em vez
                de só recusar a linha. Por RÓTULO, não por linha: liga uma vez e
                todas as linhas daquele rótulo resolvem. Recalcula ao vivo. */}
            {rotulosPendentes.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
                    <div className="flex items-start gap-3 mb-4">
                        <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" strokeWidth={1.75} />
                        <div>
                            <h4 className="font-medium text-sm text-amber-900 mb-1">
                                De-para de veículo ({rotulosPendentes.length} rótulo{rotulosPendentes.length > 1 ? 's' : ''} sem ligação)
                            </h4>
                            <p className="text-[11px] font-normal text-amber-800">
                                Estes rótulos da planilha não casaram com o cadastro. Ligue cada um e a tabela recalcula na hora,
                                sem nova consulta ao Qualp.
                            </p>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {rotulosPendentes.map(r => (
                            <div key={r.rotulo} className="bg-white border border-amber-200 rounded-lg p-3">
                                <p className="text-xs font-medium text-[#111827] mb-1">"{r.rotulo}"</p>
                                <p className="text-[9px] font-medium text-[#6b7280] uppercase tracking-tight mb-2">
                                    {r.linhas.length} linha(s): {r.linhas.slice(0, 6).join(', ')}{r.linhas.length > 6 ? '…' : ''}
                                    {r.candidatos.length > 0 && <span className="text-amber-700"> · ambíguo entre {r.candidatos.length}</span>}
                                </p>
                                <select
                                    value={deParaVeiculo[r.rotulo] || ''}
                                    onChange={e => setDeParaVeiculo(prev => {
                                        const novo = { ...prev };
                                        if (e.target.value) novo[r.rotulo] = e.target.value;
                                        else delete novo[r.rotulo];
                                        return novo;
                                    })}
                                    className="w-full px-2 py-2 bg-[#f9fafb] border border-[#e5e7eb] rounded-lg text-xs font-normal text-[#111827] outline-none focus:border-[#1d6fb8]"
                                >
                                    {/* Opção neutra no topo: sem ela o select exibiria o
                                        primeiro veículo do cadastro sem o onChange ter
                                        disparado, e o de-para pareceria preenchido estando
                                        vazio. */}
                                    <option value="">Escolha o veículo…</option>
                                    {(r.candidatos.length > 0 ? r.candidatos : veiculos).map(v => (
                                        <option key={v} value={v}>{v}</option>
                                    ))}
                                </select>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* ROTAS NOVAS. Aparecem quando um de-para destrava linhas que nunca
                foram consultadas. Não dispara sozinho: continua custando cota. */}
            {rotasNovas.length > 0 && brutasArquivo && !rodando && (
                <div className="bg-[#eff6ff] border border-[#bfdbfe] rounded-xl p-6">
                    <div className="flex items-start gap-3">
                        <Info className="w-5 h-5 text-[#1d6fb8] mt-0.5 shrink-0" strokeWidth={1.75} />
                        <div className="flex-1">
                            <h4 className="font-medium text-sm text-[#111827] mb-1">
                                {rotasNovas.length} rota(s) nova(s) para consultar
                            </h4>
                            <p className="text-[11px] font-normal text-[#6b7280] leading-relaxed">
                                Linhas que acabaram de resolver o veículo e ainda não têm rota. O que já foi consultado
                                não é cobrado de novo — só estas {rotasNovas.length}.
                            </p>
                            <button
                                onClick={() => consultar(brutasArquivo)}
                                className="mt-4 px-4 py-2.5 bg-[#1d6fb8] text-white rounded-lg font-medium text-xs hover:bg-[#185a96] transition-colors"
                            >
                                Consultar {rotasNovas.length} rota(s)
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Resumo */}
            {resumo && (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                    {[
                        { rot: 'Linhas', val: String(resumo.total), cor: 'text-[#111827]' },
                        { rot: 'Com preço', val: String(resumo.ok), cor: 'text-emerald-600' },
                        { rot: 'Pendência', val: String(resumo.pendencia + resumo.urbano + resumo.falha), cor: resumo.pendencia + resumo.urbano + resumo.falha > 0 ? 'text-amber-600' : 'text-[#9ca3af]' },
                        { rot: 'Com alerta', val: String(resumo.comAlerta), cor: resumo.comAlerta > 0 ? 'text-red-600' : 'text-[#9ca3af]' },
                        { rot: 'Margem líq. média', val: pct(resumo.margemLiquidaMedia), cor: 'text-[#111827]' },
                        { rot: 'Preço ofertado total', val: brl(resumo.totalPrecoSugerido), cor: 'text-[#1d6fb8]' },
                    ].map(c => (
                        <div key={c.rot} className="bg-white border border-[#e5e7eb] rounded-xl p-4">
                            <p className="text-[9px] font-medium text-[#6b7280] uppercase tracking-widest mb-1">{c.rot}</p>
                            <p className={`text-lg font-medium ${c.cor}`}>{c.val}</p>
                        </div>
                    ))}
                </div>
            )}

            {estatQualp && (
                <div className="flex items-start gap-2 p-4 bg-[#f9fafb] border border-[#e5e7eb] rounded-xl">
                    <Info className="w-4 h-4 text-[#6b7280] mt-0.5 shrink-0" strokeWidth={1.75} />
                    <p className="text-[11px] font-normal text-[#6b7280]">
                        Qualp: <span className="font-medium text-[#111827]">{estatQualp.consultas} consulta(s)</span> para{' '}
                        {estatQualp.distintas} rota(s) distinta(s) — {estatQualp.economizadas} consulta(s) poupada(s) pelo dedup.
                        No máximo {CONCORRENCIA} simultâneas.
                    </p>
                </div>
            )}

            {/* Resultado — colunas da abertura de custos (mesma definição do Excel) */}
            {linhas && (
                <div className="bg-white border border-[#e5e7eb] rounded-xl overflow-hidden">
                    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-[#e5e7eb] bg-[#f9fafb]">
                        <button
                            onClick={() => setAbrirCustos(v => !v)}
                            className="px-3 py-2 bg-white border border-[#e5e7eb] text-[#111827] rounded-lg font-medium text-xs hover:bg-[#f3f4f6] transition-colors flex items-center gap-1.5"
                        >
                            {abrirCustos ? <ChevronDown className="w-3.5 h-3.5" strokeWidth={1.75} /> : <ChevronRight className="w-3.5 h-3.5" strokeWidth={1.75} />}
                            {abrirCustos ? 'Fechar custos' : 'Abrir custos'}
                        </button>
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[10px] font-medium text-[#6b7280] uppercase tracking-tight">Adicional</span>
                            <input
                                type="text"
                                inputMode="decimal"
                                value={adicionalMassa}
                                onChange={e => {
                                    if (e.target.value.includes('-')) { erro('Adicional negativo é bloqueado.'); return; }
                                    setAdicionalMassa(e.target.value);
                                }}
                                placeholder="%"
                                className={`w-16 px-2 py-2 border rounded-lg text-xs text-right outline-none focus:border-[#1d6fb8] ${(lerPercentual(adicionalMassa) || 0) > ADICIONAL_PISO_AVISO_PCT ? 'bg-amber-50 border-amber-300' : 'bg-white border-[#e5e7eb]'}`}
                            />
                            <button
                                onClick={aplicarNasSelecionadas}
                                disabled={!selecionadas.size || adicionalMassa.trim() === ''}
                                className="px-3 py-2 bg-[#1d6fb8] text-white rounded-lg font-medium text-xs hover:bg-[#185a96] disabled:opacity-40 transition-colors"
                            >
                                Aplicar às selecionadas ({selecionadas.size})
                            </button>
                            <button
                                onClick={aplicarPadraoATodas}
                                className="px-3 py-2 bg-white border border-[#e5e7eb] text-[#111827] rounded-lg font-medium text-xs hover:bg-[#f3f4f6] transition-colors"
                            >
                                Aplicar padrão a todas
                            </button>
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead className="bg-[#f9fafb] border-b border-[#e5e7eb]">
                                <tr className="text-[#6b7280]">
                                    <th style={estiloCongelada('sel')} className="z-10 bg-[#f9fafb] px-2 py-2.5">
                                        <input
                                            type="checkbox"
                                            checked={todasSelecionadas}
                                            disabled={!editaveis.length}
                                            onChange={() => setSelecionadas(todasSelecionadas ? new Set() : new Set(editaveis))}
                                            title="Selecionar todas as linhas com adicional editável"
                                        />
                                    </th>
                                    <th style={estiloCongelada('num')} className="z-10 bg-[#f9fafb] px-3 py-2.5 text-left font-medium">#</th>
                                    {colunasVisiveis.map(c => (
                                        <th
                                            key={c.id}
                                            style={estiloCongelada(c.id)}
                                            className={`px-3 py-2.5 font-medium whitespace-nowrap ${c.formato === 'texto' ? 'text-left' : 'text-right'} ${CONGELADA[c.id] ? 'z-10 bg-[#f9fafb] shadow-[1px_0_0_#e5e7eb]' : ''}`}
                                        >
                                            {c.titulo}
                                        </th>
                                    ))}
                                    <th className="px-3 py-2.5 text-left font-medium">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {linhas.map(l => (
                                    <tr key={l.linhaExcel} className="group border-b border-[#f3f4f6] last:border-0 hover:bg-[#f9fafb]">
                                        <td style={estiloCongelada('sel')} className="z-10 bg-white group-hover:bg-[#f9fafb] px-2 py-2.5 text-center">
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
                                        <td style={estiloCongelada('num')} className="z-10 bg-white group-hover:bg-[#f9fafb] px-3 py-2.5 text-[#9ca3af]">
                                            {l.linhaExcel}
                                            {l.adicionalProprio && <span className="block w-1.5 h-1.5 mt-0.5 rounded-full bg-[#1d6fb8]" title="Adicional próprio" />}
                                        </td>
                                        {colunasVisiveis.map(c => (
                                            <td
                                                key={c.id}
                                                style={estiloCongelada(c.id)}
                                                className={`px-3 py-2.5 whitespace-nowrap ${c.formato === 'texto' ? 'text-left' : 'text-right'} ${
                                                    CONGELADA[c.id] ? 'z-10 bg-white group-hover:bg-[#f9fafb] shadow-[1px_0_0_#e5e7eb] truncate' : ''} ${
                                                    c.id === 'precoOfertado' ? 'font-medium text-[#1d6fb8]'
                                                        : c.id.startsWith('margemLiquida') ? `font-medium ${(l.margemLiquidaRS ?? 0) > 0 ? 'text-emerald-600' : l.margemLiquidaRS == null ? 'text-[#9ca3af]' : 'text-red-600'}`
                                                            : 'text-[#111827]'}`}
                                                title={c.id === 'origem' ? l.origem : undefined}
                                            >
                                                {celula(c, l)}
                                            </td>
                                        ))}
                                        <td className="px-3 py-2.5">
                                            <span className={`inline-block px-2 py-0.5 rounded-md border text-[9px] font-medium uppercase tracking-tight ${CORES_STATUS[l.status]}`}>
                                                {rotuloStatus(l)}
                                            </span>
                                            {(l.pendencias.length > 0 || l.alertas.length > 0) && (
                                                <p className="text-[9px] font-normal text-[#6b7280] mt-1 max-w-xs whitespace-normal">
                                                    {[...l.alertas, ...l.pendencias].join(' · ')}
                                                </p>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            {totais && (
                                <tfoot className="bg-[#f9fafb] border-t border-[#e5e7eb] font-medium">
                                    <tr className="text-[#111827]">
                                        <td style={estiloCongelada('sel')} className="z-10 bg-[#f9fafb]" />
                                        <td style={estiloCongelada('num')} className="z-10 bg-[#f9fafb] px-3 py-2.5 text-[10px] uppercase text-[#6b7280]">Total</td>
                                        {colunasVisiveis.map(c => (
                                            <td
                                                key={c.id}
                                                style={estiloCongelada(c.id)}
                                                className={`px-3 py-2.5 whitespace-nowrap text-right ${CONGELADA[c.id] ? 'z-10 bg-[#f9fafb] shadow-[1px_0_0_#e5e7eb]' : ''}`}
                                            >
                                                {c.id in totais ? formatar(c.formato, totais[c.id]) : ''}
                                            </td>
                                        ))}
                                        <td className="px-3 py-2.5 text-[9px] font-normal text-[#6b7280]">Só linhas com preço · markup e margem ponderados</td>
                                    </tr>
                                </tfoot>
                            )}
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
};
