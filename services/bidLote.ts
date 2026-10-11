/**
 * Bid em Lote — a borda com o mundo: ler o .xlsx e falar com o Qualp.
 *
 * Toda a decisão (dedup, concorrência, preço, margem, status da linha) mora em
 * utils/bidLote.ts, que é puro. Aqui ficam só os dois efeitos colaterais, para
 * o módulo puro continuar testável sem arquivo e sem cota.
 */

import * as XLSX from 'xlsx';
import { abrirPlanilhaOtm } from './fastDelivery';
import { estimateDistance, falhouRota } from './geminiService';
import {
    COLUNAS_BID, montarLinhasBid, linhasParaExcel,
    type LinhaBidBruta, type LinhaBid, type RespostaRota,
} from '../utils/bidLote';

/**
 * Abre a planilha do bid reusando o leitor do Fast (`abrirPlanilhaOtm`), com o
 * dicionário próprio do bid.
 *
 * `faltando` lista as colunas que não foram encontradas — a tela avisa, mas o
 * lote ainda roda: linha sem dado vira pendência, não erro do arquivo.
 */
export const lerPlanilhaBid = (buffer: ArrayBuffer): {
    linhas: LinhaBidBruta[];
    faltando: string[];
    totalLinhas: number;
} => {
    const { bruto, mapa, faltando } = abrirPlanilhaOtm(buffer, COLUNAS_BID);
    return { linhas: montarLinhasBid(bruto, mapa), faltando, totalLinhas: bruto.length };
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
