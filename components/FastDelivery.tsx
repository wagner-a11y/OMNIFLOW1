import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle, FileUp, Info, Loader2, Zap } from 'lucide-react';
import {
    ApoioFastDelivery, LinhaPrevia, ORIGEM_FIXA, carregarApoio, corDaMargem, lerExcelOtm,
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
}

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

const FastDelivery: React.FC<Props> = ({ marginThreshold }) => {
    const [apoio, setApoio] = useState<ApoioFastDelivery | null>(null);
    const [linhas, setLinhas] = useState<LinhaPrevia[] | null>(null);
    const [colunasFaltando, setColunasFaltando] = useState<string[]>([]);
    const [lendo, setLendo] = useState(false);
    const [erro, setErro] = useState<string | null>(null);
    const [arquivo, setArquivo] = useState('');

    const { pendentes, prontas } = useMemo(() => ({
        pendentes: (linhas ?? []).filter(l => l.pendencias.length),
        prontas: (linhas ?? []).filter(l => !l.pendencias.length),
    }), [linhas]);

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
            const r = lerExcelOtm(buffer, a);
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

    const Linha: React.FC<{ l: LinhaPrevia; pendente?: boolean }> = ({ l, pendente }) => {
        const cor = CORES[corDaMargem(l.margemPercent, marginThreshold)];
        return (
            <tr className={pendente ? 'bg-amber-50/60' : 'hover:bg-[#f9fafb]'}>
                <td className="px-3 py-2 font-mono text-xs">{l.referencia || '—'}</td>
                <td className="px-3 py-2 text-xs">{dataCurta(l.dataColeta)}</td>
                <td className="px-3 py-2 text-xs">
                    {l.cidadeOriginal || '—'}{l.uf ? `/${l.uf}` : ''}
                    <span className="block text-[10px] text-[#9ca3af]">{l.cliente}</span>
                </td>
                <td className="px-3 py-2 text-xs">
                    {l.tipoVeiculo ?? <span className="text-amber-700 font-semibold">?</span>}
                    <span className="block text-[10px] text-[#9ca3af]">cód. {l.codigoEquipamento || '—'}</span>
                </td>
                <td className="px-3 py-2 text-xs">{l.placa || '—'}</td>
                <td className="px-3 py-2 text-xs text-right">{l.peso !== null ? `${l.peso} kg` : '—'}</td>
                <td className="px-3 py-2 text-xs text-right font-medium">{brl(l.valorRecebido)}</td>
                <td className="px-3 py-2 text-xs text-right font-medium">{brl(l.valorAPagar)}</td>
                <td className={`px-3 py-2 text-xs text-right font-semibold ${cor}`}>
                    {brl(l.margem)}
                    <span className="block text-[10px] font-medium">
                        {l.margemPercent === null ? '' : `${l.margemPercent.toFixed(1)}%`}
                    </span>
                </td>
            </tr>
        );
    };

    const Cabecalho = () => (
        <thead className="bg-[#f9fafb] text-[10px] uppercase text-[#6b7280]">
            <tr>
                <th className="px-3 py-2 text-left font-medium">Referência</th>
                <th className="px-3 py-2 text-left font-medium">Coleta</th>
                <th className="px-3 py-2 text-left font-medium">Destino / cliente</th>
                <th className="px-3 py-2 text-left font-medium">Veículo</th>
                <th className="px-3 py-2 text-left font-medium">Placa</th>
                <th className="px-3 py-2 text-right font-medium">Peso</th>
                <th className="px-3 py-2 text-right font-medium">Recebido</th>
                <th className="px-3 py-2 text-right font-medium">A pagar</th>
                <th className="px-3 py-2 text-right font-medium">Margem</th>
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
                                                    <span key={i} className="text-[11px] font-medium text-[#92400e] block">
                                                        linha {l.linhaExcel} · {p.texto}
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

            {/* prontas */}
            {!!prontas.length && (
                <div className="bg-white border border-[#e5e7eb] rounded-xl overflow-hidden">
                    <div className="px-6 py-4 border-b border-[#e5e7eb] flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-[#111827] flex items-center gap-2">
                            <CheckCircle className="w-4 h-4 text-emerald-600" strokeWidth={1.75} />
                            {prontas.length} linha(s) prontas
                        </p>
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
                                {prontas.map(l => <Linha key={l.linhaExcel} l={l} />)}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

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
