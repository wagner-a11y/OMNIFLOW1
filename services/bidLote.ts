/**
 * Bid em Lote — a borda com o mundo: ler o .xlsx e falar com o Qualp.
 *
 * Toda a decisão (dedup, concorrência, preço, margem, status da linha) mora em
 * utils/bidLote.ts, que é puro. Aqui ficam só os dois efeitos colaterais, para
 * o módulo puro continuar testável sem arquivo e sem cota.
 */

import * as XLSX from 'xlsx';
import { mapearColunas } from './fastDelivery';
import { estimateDistance, falhouRota } from './geminiService';
import {
    COLUNAS_BID, montarLinhasBid, linhasParaExcel,
    type LinhaBidBruta, type LinhaBid, type RespostaRota,
} from '../utils/bidLote';

/**
 * Abre a planilha do bid.
 *
 * Reusa o `mapearColunas` do Fast (o casamento de cabeçalho, que já tolera
 * acento, caixa e espaço) mas faz a própria LEITURA, por um motivo concreto: o
 * `abrirPlanilhaOtm` lê só `SheetNames[0]`, e uma planilha cujos dados estão na
 * segunda aba — porque a primeira é capa, índice ou sobrou vazia — importava
 * ZERO linhas sem dizer nada. Conferido na prática.
 *
 * Mexer no `abrirPlanilhaOtm` consertaria aqui e mudaria o Fast de tabela, que
 * não pediu nada. Então a escolha de aba é do bid, e o Fast fica intacto.
 *
 * A aba escolhida é a PRIMEIRA que tem linha de dados E pelo menos uma coluna
 * reconhecida. Se nenhuma reconhece coluna, fica a primeira com dados — assim
 * `faltando` chega na tela com a lista real do que não casou, em vez de uma
 * planilha vazia sem explicação.
 */
export const lerPlanilhaBid = (buffer: ArrayBuffer): {
    linhas: LinhaBidBruta[];
    faltando: string[];
    totalLinhas: number;
    /** Nome da aba usada — a tela mostra, para o operador conferir. */
    abaUsada: string;
    /** Todas as abas do arquivo, em ordem. */
    abas: string[];
} => {
    const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
    const abas = wb.SheetNames;

    let escolhida = '';
    let bruto: Record<string, unknown>[] = [];
    let mapa: Record<string, string> = {};
    let faltando: string[] = Object.values(COLUNAS_BID).map(c => c[0]);
    let primeiraComDados: { nome: string; bruto: Record<string, unknown>[]; mapa: Record<string, string>; faltando: string[] } | null = null;

    for (const nome of abas) {
        const linhas = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[nome], { defval: '' });
        if (!linhas.length) continue;
        const m = mapearColunas(Object.keys(linhas[0]), COLUNAS_BID);
        if (!primeiraComDados) primeiraComDados = { nome, bruto: linhas, mapa: m.mapa, faltando: m.faltando };
        // Reconheceu alguma coluna do bid: é esta.
        if (Object.keys(m.mapa).length > 0) {
            escolhida = nome; bruto = linhas; mapa = m.mapa; faltando = m.faltando;
            break;
        }
    }
    if (!escolhida && primeiraComDados) {
        escolhida = primeiraComDados.nome;
        bruto = primeiraComDados.bruto; mapa = primeiraComDados.mapa; faltando = primeiraComDados.faltando;
    }

    return {
        linhas: montarLinhasBid(bruto, mapa),
        faltando,
        totalLinhas: bruto.length,
        abaUsada: escolhida || (abas[0] ?? ''),
        abas,
    };
};

/**
 * Consultor de rota do lote: o MESMO `estimateDistance` da cotação individual.
 * Traduz o retorno para a forma que o lote consome, separando frete urbano
 * (caso conhecido, não é incidente) de falha de verdade.
 */
export const consultarRotaDoLote = async (
    origem: string,
    destino: string,
    _veiculo: string,
    eixos: number,
    carga: string,
): Promise<RespostaRota> => {
    const r = await estimateDistance(origem, destino, _veiculo, eixos, carga);
    if (falhouRota(r)) {
        return { ok: false, urbano: !!r.urbano, mensagem: r.mensagem || r.error };
    }
    return { ok: true, rota: { km: r.km, pedagioCheio: r.estimatedTolls, pisoAntt: r.pisoAntt } };
};

/**
 * Gera e baixa o .xlsx do resultado. O `xlsx` já estava no projeto (era usado
 * só para LER) — escrever não acrescenta dependência nenhuma.
 */
export const exportarBidExcel = (linhas: LinhaBid[], nomeArquivo?: string): void => {
    const aba = XLSX.utils.json_to_sheet(linhasParaExcel(linhas));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, aba, 'Bid');
    const data = new Date();
    const stamp = `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;
    XLSX.writeFile(wb, nomeArquivo || `bid-em-lote-${stamp}.xlsx`);
};
