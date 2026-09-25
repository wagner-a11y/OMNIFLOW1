// Testes do parsing do relatório HTML. Roda: npx tsx <este arquivo>.
import { somaPorDia, brToYMD, brToNumber, ctrcDaLinha } from './relatorioHtml.ts';

let pass = 0, fail = 0;
const eq = (label, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    console.log(`${ok ? 'OK  ' : 'FAIL'} | ${label} => ${JSON.stringify(got)}${ok ? '' : `  (esperado ${JSON.stringify(want)})`}`);
    ok ? pass++ : fail++;
};

// ---- conversoes ----
eq('brToYMD', brToYMD('18/09/2026'), '2026-09-18');
eq('brToYMD vira o ano', brToYMD('01/01/2027'), '2027-01-01');
eq('brToNumber milhar+decimal', brToNumber('1.502.836,27'), 1502836.27);
eq('ctrcDaLinha pega o 1o inteiro depois da data', ctrcDaLinha(['18/09/2026', '12345', 'X']), 12345);

// Monta uma <tr> de CTe com 22 celulas: data, ctrc, ..., peso (4 casas), total (2 casas).
const linha = (data, ctrc, total, peso = '2.849.172,1910') => {
    const meio = Array.from({ length: 17 }, (_, i) => `<td>c${i}</td>`).join('');
    return `<tr><td>${data}</td><td>${ctrc}</td>${meio}<td>${peso}</td><td>${total}</td><td>obs</td></tr>`;
};

// ---- soma por dia ----
const html = [
    '<table>',
    '<tr><th>Emissão</th><th>CTRC</th></tr>',                 // cabecalho: poucas celulas, ignorado
    linha('18/09/2026', '12001', '1.000,00'),
    linha('18/09/2026', '12002', '500,50'),
    linha('19/09/2026', '12003', '250,25'),
    linha('20/09/2026', '25', '999,99'),                      // CTRC < 1000: anulacao, fora
    '<tr><td>TOTAL</td><td>1.750,75</td></tr>',               // rodape: poucas celulas, ignorado
    '</table>',
].join('\n');

const porDia = somaPorDia(html);
eq('dois dias somados, anulacao fora', porDia, {
    '2026-09-18': { valor: 1500.50, ctes: 2 },
    '2026-09-19': { valor: 250.25, ctes: 1 },
});
eq('dia da anulacao nao existe', porDia['2026-09-20'], undefined);
eq('o peso de 4 casas NAO foi somado (seria 2.849.172,19)', porDia['2026-09-18'].valor, 1500.50);

// ---- soma do mes bate com a soma das barras ----
const totalDasBarras = Object.values(porDia).reduce((a, d) => a + d.valor, 0);
eq('total das barras', Math.round(totalDasBarras * 100) / 100, 1750.75);

// ---- casos vazios / defensivos ----
eq('html vazio', somaPorDia(''), {});
eq('html sem linha de CTe', somaPorDia('<table><tr><td>nada</td></tr></table>'), {});

// ---- centavos: 3 CTe de 0,01 somam 0,03, nao 0,030000000000000002 ----
const centavos = ['<table>', linha('21/09/2026', '13001', '0,01'), linha('21/09/2026', '13002', '0,01'), linha('21/09/2026', '13003', '0,01'), '</table>'].join('\n');
eq('centavos arredondados uma vez', somaPorDia(centavos)['2026-09-21'].valor, 0.03);

// ---- virada de mes: dias de setembro e outubro no mesmo relatorio ----
const viradaMes = ['<table>', linha('30/09/2026', '14001', '100,00'), linha('01/10/2026', '14002', '200,00'), '</table>'].join('\n');
eq('dias de meses diferentes nao se misturam', somaPorDia(viradaMes), {
    '2026-09-30': { valor: 100, ctes: 1 },
    '2026-10-01': { valor: 200, ctes: 1 },
});

console.log(`\n${pass} ok, ${fail} falhas`);
process.exit(fail ? 1 : 0);
