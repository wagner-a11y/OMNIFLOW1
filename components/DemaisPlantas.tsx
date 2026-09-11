import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Calculator, FileUp, Info, Loader2, Send, Zap } from 'lucide-react';
import {
    LinhaDemaisPlantas, OPERACAO_DEMAIS_PLANTAS, aplicarPiso, calcularPisoAntt,
    comoCargaEnviavel, criarCotacoesDemaisPlantas, definirValorManual, lerExcelDemaisPlantas,
} from '../services/demaisPlantas';
import {
    ApoioFastDelivery, ResultadoCotacao, SOLICITANTE_FIXO, carregarApoio, coletaAjustada,
    corDaMargem, enviarCargaAoPipefy, enviarCargaAoRamper, numero,
} from '../services/fastDelivery';
import { MapaPlantas, carregarPlantas } from '../services/suzanoPlanta';
import PlantasSuzano from './PlantasSuzano';
import HistoricoSuzano from './HistoricoSuzano';

// ============================================================================
// DEMAIS PLANTAS — prévia.
//
// NADA É GRAVADO nesta tela. Ela lê o Excel, resolve a origem pela planta,
// procura o preço e mostra. A criação das cotações é o passo seguinte.
//
// A diferença que se vê em cada linha: no Fast o valor do terceiro sempre vem
// da tabela; aqui ele vem da tabela QUANDO existe, e quando não existe é o
// operador que define — à mão ou pedindo o piso ANTT. Por isso a coluna
// "A pagar" às vezes é um número e às vezes é um campo.
//
// O piso ANTT é BOTÃO, nunca automático: cada clique é uma consulta de rota
// paga. Uma planilha de 70 linhas calculada sozinha gastaria 70 consultas sem
// ninguém ter pedido.
// ============================================================================

interface Props {
    marginThreshold: number;
    ehMaster?: boolean;
    autor: { id?: string; name?: string };
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

const DemaisPlantas: React.FC<Props> = ({ marginThreshold, ehMaster, autor, aoGravar }) => {
    const [apoio, setApoio] = useState<ApoioFastDelivery | null>(null);
    const [plantas, setPlantas] = useState<MapaPlantas | null>(null);
    const [linhas, setLinhas] = useState<LinhaDemaisPlantas[] | null>(null);
    const [colunasFaltando, setColunasFaltando] = useState<string[]>([]);
    const [lendo, setLendo] = useState(false);
    const [erro, setErro] = useState<string | null>(null);
    const [arquivo, setArquivo] = useState('');

    /** Texto em digitação por linha — separado do valor já aplicado. */
    const [digitando, setDigitando] = useState<Record<number, string>>({});
    /** Consulta de piso em curso, por linha. */
    const [calculando, setCalculando] = useState<Record<number, boolean>>({});
    const [erroPiso, setErroPiso] = useState<Record<number, string>>({});

    /** Painel de plantas aberto, e o código que deve abrir já classificando. */
    const [gerirPlantas, setGerirPlantas] = useState(false);
    const [plantaAlvo, setPlantaAlvo] = useState<string | null>(null);

    const bufferRef = useRef<ArrayBuffer | null>(null);

    // ---- gravação e envio ----
    const [aba, setAba] = useState<'previa' | 'historico'>('previa');
    const [confirmando, setConfirmando] = useState(false);
    const [gravando, setGravando] = useState(false);
    const [resultados, setResultados] = useState<ResultadoCotacao[] | null>(null);
    const [erroGravacao, setErroGravacao] = useState<string | null>(null);
    const [ramper, setRamper] = useState<Record<string, EstadoEnvio>>({});
    const [pipefy, setPipefy] = useState<Record<string, EstadoEnvio>>({});
    const [recargaHistorico, setRecargaHistorico] = useState(0);

    // Carrega o apoio ao abrir: o de-para de planta precisa estar em mãos antes
    // da planilha, senão toda linha nasceria como origem desconhecida.
    useEffect(() => {
        let vivo = true;
        Promise.all([carregarApoio(), carregarPlantas()])
            .then(([a, p]) => { if (vivo) { setApoio(a); setPlantas(p); } })
            .catch(() => { /* o upload recarrega e aí sim reporta */ });
        return () => { vivo = false; };
    }, []);

    const reprocessar = (a: ApoioFastDelivery, p: MapaPlantas) => {
        if (!bufferRef.current) return;
        const r = lerExcelDemaisPlantas(bufferRef.current, a, p);
        setLinhas(r.linhas);
        setColunasFaltando(r.colunasFaltando);
        setDigitando({});
    };

    const aoSubir = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setLendo(true); setErro(null); setLinhas(null); setArquivo(file.name);
        try {
            const a = apoio ?? await carregarApoio();
            const p = plantas ?? await carregarPlantas();
            if (!apoio) setApoio(a);
            if (!plantas) setPlantas(p);
            const buffer = await file.arrayBuffer();
            bufferRef.current = buffer;
            const r = lerExcelDemaisPlantas(buffer, a, p);
            if (!r.totalLinhas) { setErro('A planilha não tem linhas de dados.'); return; }
            setLinhas(r.linhas);
            setColunasFaltando(r.colunasFaltando);
        } catch (err) {
            setErro((err as Error).message);
        } finally {
            setLendo(false);
            e.target.value = '';
        }
    };

    /**
     * Troca a linha pela versão recalculada e SOLTA o texto em digitação dela.
     *
     * Soltar é o que conserta o piso que "não aparecia": o input mostrava
     * `digitando[linha]` com precedência, e string vazia não é nullish — então
     * o `??` nunca caía para o valor calculado. O piso chegava, era aplicado, e
     * a tela seguia exibindo o rascunho. Quem manda no campo é o valor da
     * linha; o rascunho só existe enquanto se digita.
     */
    const atualizar = (linha: LinhaDemaisPlantas) => {
        setLinhas(ls => (ls ?? []).map(l => (l.linhaExcel === linha.linhaExcel ? linha : l)));
        setDigitando(p => {
            if (!(linha.linhaExcel in p)) return p;
            const q = { ...p }; delete q[linha.linhaExcel]; return q;
        });
    };

    const aplicarDigitado = (l: LinhaDemaisPlantas) => {
        const texto = digitando[l.linhaExcel];
        if (texto === undefined) return;
        // Campo esvaziado devolve a linha à pendência — é diferente de zero.
        atualizar(definirValorManual(l, texto.trim() === '' ? null : numero(texto)));
    };

    const pedirPiso = async (l: LinhaDemaisPlantas) => {
        setCalculando(p => ({ ...p, [l.linhaExcel]: true }));
        setErroPiso(p => { const q = { ...p }; delete q[l.linhaExcel]; return q; });
        try {
            const r = await calcularPisoAntt(l);
            if (r.ok && r.piso != null && r.km != null) {
                atualizar(aplicarPiso(l, r.km, r.piso));
            } else {
                setErroPiso(p => ({ ...p, [l.linhaExcel]: r.erro ?? 'Não consegui calcular o piso.' }));
            }
        } catch (e) {
            setErroPiso(p => ({ ...p, [l.linhaExcel]: (e as Error).message }));
        } finally {
            setCalculando(p => ({ ...p, [l.linhaExcel]: false }));
        }
    };

    const { pendentes, prontas } = useMemo(() => {
        const todas = linhas ?? [];
        return {
            pendentes: todas.filter(l => l.pendencias.length),
            prontas: todas.filter(l => !l.pendencias.length),
        };
    }, [linhas]);

    const totais = useMemo(() => {
        const r = prontas.reduce((a, l) => ({
            recebido: a.recebido + (l.valorRecebido ?? 0),
            pagar: a.pagar + (l.valorAPagar ?? 0),
        }), { recebido: 0, pagar: 0 });
        const margem = r.recebido - r.pagar;
        return { ...r, margem, percent: r.recebido ? (margem / r.recebido) * 100 : null };
    }, [prontas]);

    /** Plantas que apareceram na planilha e não estão cadastradas. */
    const plantasFaltando = useMemo(() => {
        const s = new Set<string>();
        for (const l of linhas ?? []) if (!l.planta && l.codigoPlanta) s.add(l.codigoPlanta);
        return Array.from(s).sort();
    }, [linhas]);

    const gravar = async () => {
        setConfirmando(false); setGravando(true); setErroGravacao(null);
        try {
            const r = await criarCotacoesDemaisPlantas(prontas, autor);
            setResultados(r);
            if (r.some(x => x.ok && !x.jaExistia)) await aoGravar?.();
            setRecargaHistorico(n => n + 1);
        } catch (e) {
            setErroGravacao((e as Error).message);
        } finally {
            setGravando(false);
        }
    };

    /** Cotação gravada de uma DT, quando houver. */
    const gravada = (dt: string) => resultados?.find(r => r.dt === dt && r.ok && !r.jaExistia);

    /**
     * Envia da prévia pelo MESMO caminho do histórico — a função do service, que
     * confere o banco antes de mandar. É a trava que sobrevive ao F5.
     */
    const enviarDaPrevia = async (l: LinhaDemaisPlantas, alvo: 'ramper' | 'pipefy') => {
        const r = gravada(l.referencia);
        if (!r?.id || !r.proposta) return;
        const set = alvo === 'ramper' ? setRamper : setPipefy;
        set(p => ({ ...p, [l.referencia]: { enviando: true } }));
        const carga = comoCargaEnviavel(l, r.id, r.proposta);
        const res = alvo === 'ramper' ? await enviarCargaAoRamper(carga) : await enviarCargaAoPipefy(carga);
        set(p => ({ ...p, [l.referencia]: res.erro ? { erro: res.erro } : { enviado: true } }));
        setRecargaHistorico(n => n + 1);
    };

    /** Botão de envio de uma linha já gravada. */
    const renderEnvio = (l: LinhaDemaisPlantas, alvo: 'ramper' | 'pipefy') => {
        const e = (alvo === 'ramper' ? ramper : pipefy)[l.referencia] ?? {};
        const rotulo = alvo === 'ramper' ? 'Ramper' : 'Pipefy';
        // Enviado trava o botão. Erro NÃO trava: se não foi, tem que dar para
        // tentar de novo — travar em "enviado" o que não enviou seria mentira.
        if (e.enviado) return <span className="text-[10px] font-semibold text-emerald-700">✓ {rotulo}</span>;
        return (
            <div className="flex flex-col items-start gap-0.5">
                <button type="button" disabled={e.enviando} onClick={() => enviarDaPrevia(l, alvo)}
                    className="text-[10px] font-semibold text-[#1d6fb8] hover:underline disabled:text-[#9ca3af]">
                    {e.enviando ? 'enviando…' : `→ ${rotulo}`}
                </button>
                {e.erro && <span className="text-[10px] font-medium text-red-600 max-w-[160px]">{e.erro}</span>}
            </div>
        );
    };

    /** O que aconteceu com esta DT depois de gravar. */
    const renderCotacao = (l: LinhaDemaisPlantas) => {
        const r = resultados?.find(x => x.dt === l.referencia);
        if (!r) return <span className="text-[#9ca3af] text-[10px]">—</span>;
        if (!r.ok) return <span className="text-red-600 font-medium text-[10px]">falhou: {r.erro}</span>;
        if (r.jaExistia) {
            return (
                <span className="text-amber-700 font-medium text-[10px]">
                    DT já lançada
                    <span className="block font-normal">{r.proposta} — não dupliquei</span>
                </span>
            );
        }
        return (
            <div className="flex flex-col gap-1">
                <span className="font-semibold text-emerald-700 text-[11px]">{r.proposta}</span>
                <div className="flex gap-3">{renderEnvio(l, 'ramper')}{renderEnvio(l, 'pipefy')}</div>
            </div>
        );
    };

    /**
     * Desenha uma linha. É uma FUNÇÃO que devolve JSX, não um componente
     * declarado aqui dentro — e a diferença não é estilo.
     *
     * Como componente, `Linha` seria uma função NOVA a cada render do pai. O
     * React compara tipos por identidade: tipo novo = componente diferente =
     * desmonta e remonta a <tr> inteira. A cada tecla no campo "A pagar" o
     * input era destruído e recriado, e o foco ia junto — dava para digitar um
     * caractere por vez. Devolvendo JSX direto, o React vê <tr> na mesma
     * posição e só atualiza os atributos: o input sobrevive e o foco fica.
     */
    const renderLinha = (l: LinhaDemaisPlantas, pendente = false) => {
        const cor = CORES[corDaMargem(l.margemPercent, marginThreshold)];
        const daTabela = l.fonteValor === 'tabela';
        return (
            <React.Fragment key={`${pendente ? 'p' : 'k'}-${l.linhaExcel}`}>
                <tr className={pendente ? 'bg-amber-50/60' : 'hover:bg-[#f9fafb]'}>
                    <td className="px-3 py-2 font-mono text-xs">{l.referencia || '—'}</td>
                    <td className="px-3 py-2 text-xs">
                        {dataCurta(coletaAjustada(l.dataColeta))}
                        <span className="block text-[10px] text-[#9ca3af]">OTM {dataCurta(l.dataColeta)}</span>
                    </td>
                    <td className="px-3 py-2 text-xs">
                        {l.planta
                            ? <>{l.planta.cidade}/{l.planta.uf}</>
                            : <span className="text-amber-700 font-semibold">?</span>}
                        <span className="block text-[10px] text-[#9ca3af] font-mono">{l.codigoPlanta || '—'}</span>
                    </td>
                    <td className="px-3 py-2 text-xs">
                        {l.cidadeOriginal || '—'}{l.uf ? `/${l.uf}` : ''}
                        <span className="block text-[10px] text-[#9ca3af]">{l.cliente}</span>
                    </td>
                    <td className="px-3 py-2 text-xs">
                        {l.tipoVeiculo ?? <span className="text-amber-700 font-semibold">?</span>}
                        {l.tipoVeiculo && (
                            <span className={l.carroceria ? 'text-[#6b7280]' : 'text-amber-700 font-semibold'}>
                                {' · '}{l.carroceriaEfetiva}{l.carroceria ? '' : ' ?'}
                            </span>
                        )}
                        <span className="block text-[10px] text-[#9ca3af]">cód. {l.codigoEquipamento || '—'}</span>
                    </td>
                    <td className="px-3 py-2 text-xs text-right">
                        {l.volume !== null
                            ? <span className={l.alertaVolume ? 'font-semibold text-amber-700' : ''}>
                                {l.volume.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}
                            </span>
                            : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-right font-medium">{brl(l.valorRecebido)}</td>

                    {/* A COLUNA QUE DIFERE DO FAST. Da tabela vira número; sem
                        tabela vira campo, com o botão de piso ao lado. */}
                    <td className="px-3 py-2 text-xs text-right">
                        {daTabela ? (
                            <>
                                <span className="font-medium">{brl(l.valorAPagar)}</span>
                                <span className="block text-[10px] text-[#9ca3af]">tabela</span>
                            </>
                        ) : (
                            <div className="flex flex-col items-end gap-1">
                                <input
                                    type="text" inputMode="decimal"
                                    /* O rascunho manda enquanto existe; quando some
                                       (blur, piso aplicado, nova planilha), o campo
                                       volta a refletir o valor da linha. */
                                    value={digitando[l.linhaExcel] ?? (l.valorAPagar !== null ? String(l.valorAPagar) : '')}
                                    onChange={e => setDigitando(p => ({ ...p, [l.linhaExcel]: e.target.value }))}
                                    onBlur={() => aplicarDigitado(l)}
                                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                    placeholder="0,00"
                                    className="w-24 px-2 py-1 text-right bg-white border border-[#e5e7eb] rounded text-xs font-medium text-[#111827] outline-none focus:border-[#1d6fb8]" />
                                <div className="flex items-center gap-2">
                                    {l.fonteValor === 'antt' && (
                                        <span className="text-[10px] font-semibold text-emerald-700">
                                            piso ANTT{l.km != null ? ` · ${Math.round(l.km)} km` : ''}
                                        </span>
                                    )}
                                    {l.fonteValor === 'manual' && (
                                        <span className="text-[10px] text-[#9ca3af]">à mão</span>
                                    )}
                                    <button type="button" disabled={!!calculando[l.linhaExcel]}
                                        onClick={() => pedirPiso(l)}
                                        title="Consulta a rota no Qualp — consome token"
                                        className="flex items-center gap-1 text-[10px] font-semibold text-[#1d6fb8] hover:underline disabled:text-[#9ca3af]">
                                        {calculando[l.linhaExcel]
                                            ? <><Loader2 className="w-3 h-3 animate-spin" /> calculando…</>
                                            : <><Calculator className="w-3 h-3" strokeWidth={2} /> piso ANTT</>}
                                    </button>
                                </div>
                                {erroPiso[l.linhaExcel] && (
                                    <span className="text-[10px] font-medium text-red-600 max-w-[180px] text-right">
                                        {erroPiso[l.linhaExcel]}
                                    </span>
                                )}
                            </div>
                        )}
                    </td>

                    <td className={`px-3 py-2 text-xs text-right font-semibold ${cor}`}>
                        {brl(l.margem)}
                        <span className="block text-[10px] font-medium">
                            {l.margemPercent === null ? '' : `${l.margemPercent.toFixed(1)}%`}
                        </span>
                    </td>
                    <td className="px-3 py-2 text-xs">
                        {pendente ? <span className="text-[#9ca3af]">—</span> : renderCotacao(l)}
                    </td>
                </tr>

                {/* PROTEÇÃO DE MARGEM — avisa, não impede. */}
                {l.alertaMargem && (
                    <tr className={l.alertaMargem.nivel === 'erro' ? 'bg-red-50/60' : 'bg-amber-50/40'}>
                        <td colSpan={10} className="px-3 pb-2 pt-0">
                            <span className={`text-[11px] font-medium flex items-center gap-1.5 ${l.alertaMargem.nivel === 'erro' ? 'text-red-800' : 'text-[#92400e]'}`}>
                                <AlertTriangle className={`w-3 h-3 shrink-0 ${l.alertaMargem.nivel === 'erro' ? 'text-red-600' : 'text-amber-600'}`} strokeWidth={2} />
                                {l.alertaMargem.texto} Dá para cotar assim mesmo.
                            </span>
                        </td>
                    </tr>
                )}

                {l.alertaVolume && (
                    <tr className="bg-amber-50/40">
                        <td colSpan={10} className="px-3 pb-2 pt-0">
                            <span className="text-[11px] font-medium text-[#92400e] flex items-center gap-1.5">
                                <AlertTriangle className="w-3 h-3 text-amber-600 shrink-0" strokeWidth={2} />
                                {l.alertaVolume.texto}
                            </span>
                        </td>
                    </tr>
                )}

                {pendente && (
                    <tr className="bg-amber-50/60">
                        <td colSpan={10} className="px-3 pb-2 pt-0">
                            {l.pendencias.map((p, i) => (
                                <span key={i} className="text-[11px] font-medium text-[#92400e] flex flex-wrap items-center gap-2">
                                    <span>linha {l.linhaExcel} · {p.texto}</span>
                                    {p.motivo === 'planta' && ehMaster && !!l.codigoPlanta && (
                                        <button type="button"
                                            onClick={() => { setPlantaAlvo(l.codigoPlanta); setGerirPlantas(true); }}
                                            className="px-2 py-0.5 rounded text-[10px] font-semibold text-white bg-[#1d6fb8] hover:bg-[#175a94] transition-colors">
                                            Classificar planta
                                        </button>
                                    )}
                                </span>
                            ))}
                        </td>
                    </tr>
                )}
            </React.Fragment>
        );
    };

    const cabecalho = (
        <thead className="bg-[#f9fafb] text-[10px] uppercase text-[#6b7280]">
            <tr>
                <th className="px-3 py-2 text-left font-medium">DT</th>
                <th className="px-3 py-2 text-left font-medium">Coleta (−1h)</th>
                <th className="px-3 py-2 text-left font-medium">Origem</th>
                <th className="px-3 py-2 text-left font-medium">Destino / cliente</th>
                <th className="px-3 py-2 text-left font-medium">Veículo</th>
                <th className="px-3 py-2 text-right font-medium">Volume m³</th>
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
                    <h2 className="text-lg font-medium text-[#111827]">Demais Plantas — prévia</h2>
                    <p className="text-sm font-normal text-[#6b7280]">
                        A origem vem da planilha (coluna “ID Origem”). O valor do terceiro vem da tabela
                        quando existe; quando não, você define.
                    </p>
                </div>
            </div>

            {/* Prévia e Histórico, como no Fast: o que ainda vai virar cotação e
                o que já virou. */}
            <div className="flex items-center gap-2 border-b border-[#e5e7eb]">
                {([['previa', 'Prévia da planilha'], ['historico', 'Histórico de cargas']] as Array<['previa' | 'historico', string]>)
                    .map(([id, rotulo]) => (
                        <button key={id} type="button" onClick={() => setAba(id)}
                            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${aba === id
                                ? 'border-[#1d6fb8] text-[#1d6fb8]'
                                : 'border-transparent text-[#6b7280] hover:text-[#111827]'}`}>
                            {rotulo}
                        </button>
                    ))}
            </div>

            {aba === 'previa' && (<>
            <div className="bg-white border border-[#e5e7eb] rounded-xl p-6 flex flex-wrap items-center gap-4">
                <label className={`cursor-pointer flex items-center gap-2 px-5 py-3 rounded-lg border text-xs font-medium transition-colors ${lendo
                    ? 'bg-[#f3f4f6] border-[#e5e7eb] text-[#9ca3af] cursor-wait'
                    : 'bg-white border-[#e5e7eb] text-[#111827] hover:bg-[#f9fafb]'}`}>
                    <input type="file" className="hidden" accept=".xlsx,.xls" onChange={aoSubir} disabled={lendo} />
                    {lendo ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" strokeWidth={1.75} />}
                    {lendo ? 'Lendo…' : 'Subir Excel do OTM'}
                </label>
                <span className="text-xs font-normal text-[#6b7280]">{arquivo || 'Arquivo .xlsx exportado do OTM.'}</span>
                <button type="button" onClick={() => { setPlantaAlvo(null); setGerirPlantas(v => !v); }}
                    className="text-xs font-semibold text-[#1d6fb8] hover:underline">
                    {gerirPlantas ? 'ocultar plantas' : 'plantas cadastradas'}
                </button>
                {linhas && (
                    <span className="ml-auto text-xs font-medium text-[#6b7280]">
                        {linhas.length} linha(s) · {prontas.length} pronta(s) · {pendentes.length} com pendência
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
                            {colunasFaltando.join(', ')}. Se “ID Origem” estiver aí, a origem de toda linha
                            fica pendente — confira se é o export certo do OTM.
                        </p>
                    </div>
                </div>
            )}

            {!!plantasFaltando.length && (
                <div className="bg-white border-2 border-amber-300 rounded-xl px-6 py-4">
                    <p className="text-sm font-semibold text-[#92400e] flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-600" strokeWidth={1.75} />
                        {plantasFaltando.length} planta(s) desta planilha não estão cadastradas
                    </p>
                    <p className="text-xs font-medium text-[#6b7280] mt-1">
                        Sem a origem não há rota, não há piso ANTT e não há cotação. Cadastre para
                        liberar as linhas de uma vez.
                    </p>
                    <div className="flex flex-wrap gap-2 mt-3">
                        {plantasFaltando.map(c => (
                            <span key={c} className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[#f9fafb] border border-[#e5e7eb]">
                                <span className="text-xs font-mono font-medium text-[#111827]">{c}</span>
                                {ehMaster && (
                                    <button type="button" onClick={() => { setPlantaAlvo(c); setGerirPlantas(true); }}
                                        className="text-[10px] font-semibold text-[#1d6fb8] hover:underline">
                                        classificar
                                    </button>
                                )}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* O MESMO componente da tela de Plantas — não há segunda versão do
                cadastro. Ao classificar, o de-para é relido e a planilha que já
                está na tela é reprocessada: a linha sai de pendência sem upload
                novo. */}
            {gerirPlantas && (
                <div className="bg-white border border-[#e5e7eb] rounded-xl p-6">
                    <PlantasSuzano
                        embutido
                        ehMaster={ehMaster}
                        codigoInicial={plantaAlvo}
                        aoClassificar={p => {
                            setPlantas(p);
                            setPlantaAlvo(null);
                            if (apoio) reprocessar(apoio, p);
                        }}
                    />
                </div>
            )}

            {!!pendentes.length && (
                <div className="bg-white border-2 border-amber-300 rounded-xl overflow-hidden">
                    <div className="px-6 py-4 bg-amber-50 border-b border-amber-200">
                        <p className="text-sm font-semibold text-[#92400e] flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 text-amber-600" strokeWidth={1.75} />
                            {pendentes.length} linha(s) precisam de você antes de virar cotação
                        </p>
                        <p className="text-xs font-medium text-[#92400e] mt-1">
                            Não inventei valor nem origem para nenhuma delas.
                        </p>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            {cabecalho}
                            <tbody className="divide-y divide-[#f3f4f6]">
                                {pendentes.map(l => renderLinha(l, true))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {!!prontas.length && (
                <div className="bg-white border border-[#e5e7eb] rounded-xl overflow-hidden">
                    <div className="px-6 py-4 border-b border-[#e5e7eb] flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm font-medium text-[#111827]">{prontas.length} linha(s) pronta(s)</p>
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
                            {cabecalho}
                            <tbody className="divide-y divide-[#f3f4f6]">
                                {prontas.map(l => renderLinha(l))}
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

            {/* confirmação — o resumo antes de gravar */}
            {confirmando && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl p-6 max-w-md w-full">
                        <h3 className="text-base font-semibold text-[#111827] mb-1">Criar cotações Demais Plantas</h3>
                        <p className="text-xs font-normal text-[#6b7280] mb-4">
                            Isto grava no OmniFlow. DT já lançada é pulada, não duplicada.
                        </p>
                        <dl className="text-sm space-y-1.5 mb-6">
                            {([
                                ['Cotações', String(prontas.length)],
                                ['Operação', OPERACAO_DEMAIS_PLANTAS],
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
                    O piso ANTT só é consultado quando você clica no botão da linha, porque cada
                    consulta é paga. A margem usa o mesmo limiar da cotação ({marginThreshold}%).
                </p>
            )}
            </>)}

            {/* O MESMO histórico do Fast, filtrado por esta operação. */}
            {aba === 'historico' && (
                <HistoricoSuzano
                    operacao={OPERACAO_DEMAIS_PLANTAS}
                    marginThreshold={marginThreshold}
                    recarregarEm={recargaHistorico}
                />
            )}
        </div>
    );
};

export default DemaisPlantas;
