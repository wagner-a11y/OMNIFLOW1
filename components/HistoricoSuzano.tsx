import React, { useEffect, useState } from 'react';
import { AlertTriangle, Info, Loader2, RefreshCw } from 'lucide-react';
import {
    CotacaoHistorico, LIMITE_HISTORICO, carregarHistoricoFastDelivery,
    corDaMargem, enviarCargaAoPipefy, enviarCargaAoRamper,
} from '../services/fastDelivery';

// ============================================================================
// HISTÓRICO DAS CARGAS SUZANO — serve as duas operações.
//
// A tabela, o status de envio e a trava anti-duplicação são idênticos no Fast e
// nas Demais Plantas; o que muda é UMA string, a operação pela qual se filtra.
// Por isso este componente existe: a segunda tela não copiou o histórico da
// primeira, ela usa este mesmo.
//
// O STATUS VEM DO BANCO, não de useState. É o que faz o "enviado" continuar
// verdadeiro depois de um F5, em outra aba ou em outra máquina — e o que
// impede o card duplicado que o Fast vinha criando em silêncio.
// ============================================================================

interface Props {
    /** 'FAST_DELIVERY' ou 'DEMAIS_PLANTAS'. */
    operacao: string;
    marginThreshold: number;
    /**
     * Muda de valor para forçar releitura. Serve para a prévia avisar que
     * acabou de enviar uma carga e o histórico precisa refletir isso.
     */
    recarregarEm?: number;
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

const HistoricoSuzano: React.FC<Props> = ({ operacao, marginThreshold, recarregarEm }) => {
    const [historico, setHistorico] = useState<CotacaoHistorico[] | null>(null);
    const [carregando, setCarregando] = useState(false);
    const [erro, setErro] = useState<string | null>(null);
    const [enviando, setEnviando] = useState<Record<string, boolean>>({});
    const [erroEnvio, setErroEnvio] = useState<Record<string, string>>({});

    const recarregar = async () => {
        setCarregando(true); setErro(null);
        try {
            setHistorico(await carregarHistoricoFastDelivery(operacao));
        } catch (e) {
            setErro((e as Error).message);
        } finally {
            setCarregando(false);
        }
    };

    useEffect(() => { void recarregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [operacao, recarregarEm]);

    /**
     * Envia e RELÊ do banco.
     *
     * A releitura não é zelo: é o que faz o status na tela vir do banco e não de
     * um palpite otimista. Se a gravação do envio falhar, a linha volta dizendo
     * "não enviado", que é a verdade.
     */
    const enviar = async (c: CotacaoHistorico, alvo: 'pipefy' | 'ramper') => {
        const chave = `${c.id}:${alvo}`;
        if (enviando[chave]) return;
        setEnviando(p => ({ ...p, [chave]: true }));
        setErroEnvio(p => { const q = { ...p }; delete q[chave]; return q; });
        try {
            const r = alvo === 'pipefy' ? await enviarCargaAoPipefy(c) : await enviarCargaAoRamper(c);
            if (r.erro) setErroEnvio(p => ({ ...p, [chave]: r.erro! }));
            await recarregar();
        } catch (e) {
            setErroEnvio(p => ({ ...p, [chave]: (e as Error).message }));
        } finally {
            setEnviando(p => ({ ...p, [chave]: false }));
        }
    };

    /**
     * Status de envio de uma carga — função que devolve JSX, não componente
     * declarado aqui dentro. Componente interno vira função nova a cada render
     * e o React remonta a subárvore; aqui não há input, mas o padrão é o mesmo
     * que fazia o campo "A pagar" das Demais Plantas perder o foco a cada tecla.
     */
    const renderEnvio = (c: CotacaoHistorico, alvo: 'pipefy' | 'ramper') => {
        const enviadoEm = alvo === 'pipefy' ? c.pipefySentAt : c.ramperSentAt;
        const chave = `${c.id}:${alvo}`;
        const erroDaLinha = erroEnvio[chave];
        const ocupado = !!enviando[chave];

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
                <button type="button" disabled={ocupado} onClick={() => enviar(c, alvo)}
                    className="text-[10px] font-semibold text-white bg-[#1d6fb8] hover:bg-[#175a94] disabled:bg-[#e5e7eb] disabled:text-[#9ca3af] px-2 py-1 rounded transition-colors">
                    {ocupado ? 'enviando…' : `→ ${alvo === 'pipefy' ? 'Pipefy' : 'Ramper'}`}
                </button>
                {/* Erro NÃO vira "enviado": se não foi, o botão continua ali. E
                    quando o card foi criado mas o registro falhou, a mensagem do
                    service diz isso com todas as letras — para ninguém reenviar. */}
                {erroDaLinha && <span className="text-[10px] font-medium text-red-600 max-w-[180px] block">{erroDaLinha}</span>}
            </div>
        );
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-normal text-[#6b7280]">
                    {historico
                        ? `${historico.length} carga(s) já lançada(s)${historico.length === LIMITE_HISTORICO ? ' (as mais recentes)' : ''}`
                        : 'Cargas já lançadas.'}
                </p>
                <button type="button" onClick={recarregar} disabled={carregando}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#6b7280] bg-white border border-[#e5e7eb] hover:bg-[#f9fafb] disabled:text-[#9ca3af] transition-colors">
                    {carregando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" strokeWidth={1.75} />}
                    {carregando ? 'Carregando…' : 'Atualizar'}
                </button>
            </div>

            {erro && (
                <div className="bg-red-50 border border-red-300 text-red-900 px-6 py-3 rounded-xl flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-red-600" strokeWidth={1.75} />
                    <p className="text-sm font-medium">{erro}</p>
                </div>
            )}

            {historico && !historico.length && !carregando && (
                <div className="bg-white border border-[#e5e7eb] rounded-xl px-6 py-8 text-center">
                    <p className="text-sm font-medium text-[#6b7280]">Nenhuma carga lançada ainda nesta operação.</p>
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
                                    <th className="px-3 py-2 text-left font-medium">Origem → destino</th>
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
                                            {/* 0 = data desconhecida: cargas criadas antes de o insert
                                                gravar created_at, e cujo id também não carrega o
                                                instante. "—" é melhor do que mostrar 1970. */}
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
                                        <td className="px-3 py-2 text-xs">{renderEnvio(c, 'pipefy')}</td>
                                        <td className="px-3 py-2 text-xs">{renderEnvio(c, 'ramper')}</td>
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
                    O status de envio vem do banco: se disser “enviado”, há card lá, e clicar
                    de novo não cria outro. A margem usa o mesmo limiar da cotação ({marginThreshold}%).
                </p>
            )}
        </div>
    );
};

export default HistoricoSuzano;
