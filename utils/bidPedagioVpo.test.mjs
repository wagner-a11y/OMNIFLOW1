// =====================================================================
// BID EM LOTE — PEDÁGIO OPCIONAL (VPO, por conta do cliente)
//
// Roda: npx tsx utils/bidPedagioVpo.test.mjs
//
// Com pedagioIncluso = false o motor recebe pedágio ZERO: sai da formação do
// preço e do custo da linha. O valor do Qualp fica na linha só como
// referência. motorPreco.ts não muda — a regressão de 144 entradas prova.
// =====================================================================
import { readFileSync } from 'node:fs';
import { calcularPreco } from './motorPreco.ts';
import {
    prepararLinha, calcularLinhaBid, reaplicarLote, processarLoteBid, planejarLote, extrairCacheDeRotas,
    montarPlanilhaBid, totaisAbertura, COLUNAS_ABERTURA,
} from './bidLote.ts';
import { textoCopiaColuna, completarTela } from './bidHistorico.ts';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
    console.log(`${cond ? 'OK  ' : 'FAIL'} | ${label}${cond ? '' : `  ${extra}`}`);
    cond ? pass++ : fail++;
};
const eq = (label, got, want) => {
    const c = JSON.stringify(got) === JSON.stringify(want);
    console.log(`${c ? 'OK  ' : 'FAIL'} | ${label} => ${JSON.stringify(got)}${c ? '' : `  (esperado ${JSON.stringify(want)})`}`);
    c ? pass++ : fail++;
};
const cent = (n) => Math.round(n * 100) / 100;
const perto = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

const GOLDEN = JSON.parse(readFileSync(new URL('../scripts/testing/fixtures/golden-bid-ajustes.json', import.meta.url), 'utf-8'));
const P = GOLDEN.bid.params;
const BRUTA = { linhaExcel: 2, origem: 'São Paulo, SP', destino: 'Rio de Janeiro, RJ', veiculoPlanilha: 'Carreta' };
const ROTA = { km: 430.5, pedagioCheio: 182.4, pisoAntt: 3120.55, consultadoEm: '2026-11-16T14:00:00.000Z' };
const linha = (p, rota = ROTA, bruta = BRUTA) => calcularLinhaBid(prepararLinha(bruta, p), rota, p);

console.log('\n--- VPO: O PREÇO CAI MAIS DO QUE O PEDÁGIO ---');
{
    const incluso = linha(P);
    const vpo = linha({ ...P, pedagioIncluso: false });
    const queda = incluso.precoOfertado - vpo.precoOfertado;
    ok(`preço cai ${cent(queda)} > pedágio ${ROTA.pedagioCheio} (o pedágio também carregava margem e impostos)`, queda > ROTA.pedagioCheio);
    // Gross-up: o pedágio entrava dividido por (1-margem)(1-ICMS).
    ok('queda = pedágio / ((1 − margem)(1 − ICMS))', perto(queda, ROTA.pedagioCheio / ((1 - P.profitMargin / 100) * (1 - incluso.icmsPercent / 100))));
    eq('valor do Qualp continua guardado na linha', vpo.pedagio, ROTA.pedagioCheio);
    eq('pedágio VPO (referência) = valor do Qualp', vpo.pedagioVpoRS, ROTA.pedagioCheio);
    eq('pedágio dentro do preço = 0', vpo.pedagioNoPrecoRS, 0);
    eq('custo direto = só o custo do motorista', vpo.custoBase, vpo.custoMotorista);
    ok('markup = frete sem ICMS / custo do motorista', perto(vpo.markup, vpo.freteSemIcms / vpo.custoMotorista));
    eq('com pedágio incluso: dentro do preço = valor do Qualp, VPO = 0', [incluso.pedagioNoPrecoRS, incluso.pedagioVpoRS], [ROTA.pedagioCheio, 0]);
    // O motor recebeu pedágio zero: mesmo preço da calculadora sem pedágio.
    const motor = calcularPreco({
        baseFreight: vpo.custoMotorista, tolls: 0, extraCosts: 0, otherCosts: [], goodsValue: 0, insurancePercent: 0,
        profitMargin: P.profitMargin, icmsPercent: vpo.icmsPercent, fedTaxes: P.fedTaxes, modoTabelado: false, valorFinalTabelado: 0,
    });
    eq('= calculadora com pedágio 0', vpo.precoOfertado, motor.finalFreight);
}

console.log('\n--- SOMA DOS COMPONENTES = PREÇO OFERTADO NAS 4 COMBINAÇÕES ---');
{
    let total = 0, bate = 0;
    const falhas = [];
    for (const icmsIncluso of [true, false])
    for (const pedagioIncluso of [true, false])
    for (const [seguroModo, seguroPct, valorMercadoriaPadrao] of [[undefined, null, null], ['ddr', 0.05, 500000], ['ad_valorem', 0.1, 500000]])
    for (const adicionalPisoPadraoPct of [0, 10])
    for (const g of GOLDEN.bid.linhas.slice(0, 4)) {
        const p = { ...P, icmsIncluso, pedagioIncluso, seguroModo, seguroPct, valorMercadoriaPadrao, adicionalPisoPadraoPct };
        const l = linha(p, g.rota, g.bruta);
        // O pedágio VPO NÃO entra na conferência: está fora do preço.
        const soma = l.custoMotorista + l.pedagioNoPrecoRS + l.seguroCustoRS + l.custoAntecipacao + l.custoComissao
            + l.federaisRS + l.icmsNoPrecoRS + l.margemLiquidaRS;
        total++;
        if (perto(soma, l.precoOfertado)) bate++; else falhas.push({ icmsIncluso, pedagioIncluso, seguroModo, soma, preco: l.precoOfertado });
    }
    eq(`ICMS × pedágio (4 combinações) × seguro × adicional × 4 rotas: ${total} casos batem`, bate, total);
    ok('nenhum fora', falhas.length === 0, JSON.stringify(falhas[0]));

    // As duas chaves são independentes: cada uma mexe só na sua parte.
    const base = linha(P);
    const soIcms = linha({ ...P, icmsIncluso: false });
    const soPed = linha({ ...P, pedagioIncluso: false });
    const ambos = linha({ ...P, icmsIncluso: false, pedagioIncluso: false });
    eq('desligar ICMS não mexe no pedágio do preço', soIcms.pedagioNoPrecoRS, base.pedagioNoPrecoRS);
    eq('desligar pedágio não mexe na alíquota de ICMS', soPed.icmsPercent, base.icmsPercent);
    eq('as duas desligadas: frete sem ICMS = o da chave de pedágio sozinha', cent(ambos.freteSemIcms), cent(soPed.freteSemIcms));
    eq('e o preço ofertado é esse frete sem ICMS', ambos.precoOfertado, ambos.freteSemIcms);
}

console.log('\n--- TROCAR A CHAVE RECALCULA SEM CONSULTAR O QUALP ---');
{
    const brutas = GOLDEN.bid.linhas.slice(0, 4).map(g => g.bruta);
    const rotas = Object.fromEntries(GOLDEN.bid.linhas.slice(0, 4).map(g => [`${g.bruta.origem}>${g.bruta.destino}`, g.rota]));
    const chamadas = [];
    const consultarRota = async (o, d) => { chamadas.push(`${o}>${d}`); return { ok: true, rota: rotas[`${o}>${d}`] }; };
    const lote = await processarLoteBid(brutas, P, { consultarRota });
    const gastas = chamadas.length;
    const cache = extrairCacheDeRotas(lote.linhas);
    const vpo = reaplicarLote(brutas, { ...P, pedagioIncluso: false }, cache);
    eq('nada a consultar ao trocar a chave', planejarLote(brutas, { ...P, pedagioIncluso: false }, cache).rotasDistintas, 0);
    eq('chamadas ao Qualp depois da importação', chamadas.length - gastas, 0);
    eq('rota nova nenhuma', vpo.rotasNovas.length, 0);
    const comPedagio = vpo.linhas.filter((l, i) => l.status === 'ok' && lote.linhas[i].pedagio > 0);
    ok(`linhas com pedágio (${comPedagio.length}) ficaram mais baratas`, comPedagio.length > 0 && comPedagio.every(l => l.precoOfertado < lote.linhas[vpo.linhas.indexOf(l)].precoOfertado));
    ok('linha com pedágio zero ficou igual', vpo.linhas.every((l, i) => l.status !== 'ok' || lote.linhas[i].pedagio !== 0 || l.precoOfertado === lote.linhas[i].precoOfertado));
}

console.log('\n--- TOTAIS, CÓPIA E EXCEL ---');
{
    const ls = GOLDEN.bid.linhas.slice(0, 4).map(g => linha({ ...P, pedagioIncluso: false }, g.rota, g.bruta));
    const t = totaisAbertura(ls);
    const somaPed = ls.filter(l => l.status === 'ok').reduce((a, l) => a + l.pedagio, 0);
    ok('total de pedágio VPO separado', perto(t.pedagio, somaPed));
    ok('total ofertado não contém o pedágio VPO', perto(t.precoOfertado, ls.reduce((a, l) => a + (l.status === 'ok' ? l.precoOfertado : 0), 0)));
    const c = textoCopiaColuna([...ls].reverse(), l => l.pedagio);
    eq('copiar pedágio: na ordem da planilha, formato brasileiro', c.texto.split('\n')[0], String(ls[0].pedagio.toFixed(2)).replace('.', ','));

    const cab = (p) => Object.fromEntries(montarPlanilhaBid(ls, p, new Date()).filter(r => r.length === 2).map(r => [r[0], r[1]]));
    eq('Excel com VPO', cab({ ...P, pedagioIncluso: false })['Pedágio'], 'VPO por conta do cliente, fora do preço');
    eq('Excel com pedágio incluso', cab(P)['Pedágio'], 'incluso no frete');

    // Título da coluna de pedágio: muda com o modo, na MESMA posição.
    const colunas = (p) => montarPlanilhaBid(ls, p, new Date()).find(r => r[0] === 'Linha');
    const incl = colunas(P), vpoCab = colunas({ ...P, pedagioIncluso: false });
    const pos = COLUNAS_ABERTURA.findIndex(c => c.id === 'pedagio') + 1;
    eq('incluso: "Pedágio R$"', incl[pos], 'Pedágio R$');
    eq('VPO: "Pedágio VPO (fora do preço) R$" na mesma posição', vpoCab[pos], 'Pedágio VPO (fora do preço) R$');
    eq('incluso: cabeçalho = títulos de sempre', incl, ['Linha', ...COLUNAS_ABERTURA.map(c => c.titulo), 'Adicional próprio', 'Status', 'Rota', 'Observações']);
    eq('VPO: só o título do pedágio difere', incl.filter((t, i) => t !== vpoCab[i]), ['Pedágio R$']);
    eq('mesmo número de colunas nos dois modos', vpoCab.length, incl.length);

    // Rodada salva antes da chave existir abre com pedágio incluso.
    eq('tela de rodada antiga sem o campo: pedágio incluso', completarTela({ profitMargin: '15' }, 'Carga geral').pedagioIncluso, true);
    eq('e mantém o que estava salvo', completarTela({ profitMargin: '18' }, 'Carga geral').profitMargin, '18');
}

console.log('\n--- REGRESSÃO DA CALCULADORA ---');
{
    let iguais = 0;
    for (const { entrada, saida } of GOLDEN.motor) if (JSON.stringify(calcularPreco(entrada)) === JSON.stringify(saida)) iguais++;
    eq(`${GOLDEN.motor.length} de ${GOLDEN.motor.length} idênticas`, iguais, GOLDEN.motor.length);
    // E o bid de antes: chave ausente = pedágio incluso = números de antes.
    const CAMPOS = Object.keys(GOLDEN.bid.linhas[0].saida);
    let bid = 0;
    for (const g of GOLDEN.bid.linhas) {
        const p = { ...P, profitMargin: g.margem };
        const l = linha(p, g.rota, g.bruta);
        if (JSON.stringify(Object.fromEntries(CAMPOS.map(c => [c, l[c]]))) === JSON.stringify(g.saida)) bid++;
    }
    eq('bid sem a chave: 12 de 12 linhas idênticas às de antes', bid, GOLDEN.bid.linhas.length);
}

console.log(`\n${pass} ok, ${fail} falhas`);
if (fail > 0) process.exit(1);
