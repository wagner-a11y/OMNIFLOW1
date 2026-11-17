// =====================================================================
// BID EM LOTE — AJUSTES DE CUSTO
// (ICMS opcional, adicional sobre o piso, seguro, abertura total de custos)
//
// Roda: npx tsx utils/bidAjustesCustos.test.mjs
//
// A REGRESSÃO compara contra números CONGELADOS da main (e757e08), gerados
// por scripts/testing/gerarGoldenBid.mjs ANTES de qualquer mudança. Igualdade
// exata (bit a bit, via JSON), não "quase igual": o default dos parâmetros
// novos tem de ser literalmente o comportamento de antes.
// =====================================================================
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { calcularPreco } from './motorPreco.ts';
import {
    prepararLinha, calcularLinhaBid, montarLinhasBid, lerNumeroPlanilha,
    validarAdicionalPiso, aplicarAdicionalLinhas, adicionalEditavel,
    COLUNAS_ABERTURA, totaisAbertura, montarPlanilhaBid, NORMA_PISO_ANTT,
} from './bidLote.ts';

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
const PARAMS = GOLDEN.bid.params;
const CAMPOS = Object.keys(GOLDEN.bid.linhas[0].saida);
const pegar = (l) => Object.fromEntries(CAMPOS.map(c => [c, l[c]]));

const linha = (p, bruta, rota) => calcularLinhaBid(prepararLinha(bruta, p), rota, p);
const BRUTA = { linhaExcel: 2, origem: 'São Paulo, SP', destino: 'Rio de Janeiro, RJ', veiculoPlanilha: 'Carreta' };
const ROTA_1000 = { km: 430, pedagioCheio: 200, pisoAntt: 1000 };

console.log('\n--- 1. REGRESSÃO DA CALCULADORA (motor intocado) ---');
{
    let iguais = 0;
    const diverg = [];
    for (const { entrada, saida } of GOLDEN.motor) {
        const agora = calcularPreco(entrada);
        if (JSON.stringify(agora) === JSON.stringify(saida)) iguais++;
        else diverg.push(entrada);
    }
    eq(`${GOLDEN.motor.length} entradas da calculadora (2 modos × ICMS × seguro × extras × margem): saída idêntica`, iguais, GOLDEN.motor.length);
    ok('nenhuma divergência', diverg.length === 0, JSON.stringify(diverg[0]));
}

console.log('\n--- 2. RODADA ANTIGA REABERTA: valores idênticos ---');
{
    // Parâmetros de antes, SEM nenhum campo novo: é como uma rodada antiga abre.
    let iguais = 0;
    for (const g of GOLDEN.bid.linhas) {
        const p = { ...PARAMS, profitMargin: g.margem };
        if (JSON.stringify(pegar(linha(p, g.bruta, g.rota))) === JSON.stringify(g.saida)) iguais++;
        else console.log('  divergiu:', g.bruta.linhaExcel, g.margem);
    }
    eq(`${GOLDEN.bid.linhas.length} linhas antigas sem os campos novos: idênticas`, iguais, GOLDEN.bid.linhas.length);

    // Defaults EXPLÍCITOS (icms incluso, adicional 0, seguro não definido):
    // mesmos números — o default é o comportamento anterior, não "parecido".
    let iguaisExplicito = 0;
    for (const g of GOLDEN.bid.linhas) {
        const p = {
            ...PARAMS, profitMargin: g.margem,
            icmsIncluso: true, adicionalPisoPadraoPct: 0, adicionalPorLinha: {},
            seguroModo: 'nao_definido', seguroPct: 0.2, valorMercadoriaPadrao: 500000,
        };
        if (JSON.stringify(pegar(linha(p, g.bruta, g.rota))) === JSON.stringify(g.saida)) iguaisExplicito++;
    }
    eq('com os defaults explícitos (e seguro não definido ignorando % e valor): idênticas', iguaisExplicito, GOLDEN.bid.linhas.length);

    const l = linha(PARAMS, GOLDEN.bid.linhas[3].bruta, GOLDEN.bid.linhas[3].rota);
    eq('preço ofertado = preço sugerido de antes', l.precoOfertado, l.precoSugerido);
    eq('custo motorista = piso (adicional 0)', l.custoMotorista, l.pisoAntt);
    eq('seguro zerado', [l.seguroRS, l.seguroCustoRS], [0, 0]);
}

console.log('\n--- 3. ICMS DESLIGADO ---');
{
    const com = linha({ ...PARAMS, icmsIncluso: true }, BRUTA, ROTA_1000);
    const sem = linha({ ...PARAMS, icmsIncluso: false }, BRUTA, ROTA_1000);
    ok(`frete sem ICMS (${cent(sem.freteSemIcms)}) < frete com ICMS (${cent(sem.freteComIcms)})`, sem.freteSemIcms < sem.freteComIcms);
    eq('alíquota continua visível com ICMS por fora (SP→RJ = 12%)', sem.icmsPercent, 12);
    ok('e o ICMS R$ também', sem.icmsRS > 0);
    eq('preço ofertado = frete sem ICMS', sem.precoOfertado, sem.freteSemIcms);
    eq('nenhum ICMS dentro do preço ofertado', sem.icmsNoPrecoRS, 0);
    eq('com ICMS incluso, preço ofertado = frete com ICMS', com.precoOfertado, com.freteComIcms);
    eq('as duas rodadas do motor são as mesmas nos dois modos', [cent(sem.freteSemIcms), cent(sem.freteComIcms)], [cent(com.freteSemIcms), cent(com.freteComIcms)]);
    ok('frete com ICMS = sem ICMS / (1 − 12%)', perto(com.freteComIcms, com.freteSemIcms / 0.88));
    ok('ICMS R$ = com − sem', perto(com.icmsRS, com.freteComIcms - com.freteSemIcms));
    ok('ICMS por fora: margem líquida MAIOR em % (não carrega o ICMS)', sem.margemLiquidaPercent > com.margemLiquidaPercent);
    eq('markup igual nos dois modos (é sempre sobre o frete sem ICMS)', cent(sem.markup), cent(com.markup));
    // A regra de alíquota não mudou: PE→PE isento, SP→BA 7%.
    eq('regra de alíquota intacta (PE→PE isento)', linha(PARAMS, { ...BRUTA, origem: 'Recife, PE', destino: 'Olinda, PE' }, ROTA_1000).icmsPercent, 0);
    eq('regra de alíquota intacta (SP→BA 7%)', linha(PARAMS, { ...BRUTA, destino: 'Salvador, BA' }, ROTA_1000).icmsPercent, 7);
}

console.log('\n--- 4. ADICIONAL 10% SOBRE PISO DE 1.000 ---');
{
    const base = linha(PARAMS, BRUTA, ROTA_1000);
    const a10 = linha({ ...PARAMS, adicionalPisoPadraoPct: 10 }, BRUTA, ROTA_1000);
    eq('custo motorista = 1.100', cent(a10.custoMotorista), 1100);
    eq('adicional R$ = 100', cent(a10.adicionalPisoRS), 100);
    eq('pedágio intacto (200)', a10.pedagio, 200);
    eq('custo direto = 1.300', cent(a10.custoBase), 1300);
    ok('preço subiu', a10.precoOfertado > base.precoOfertado);
    eq('padrão da rodada não marca a linha como própria', a10.adicionalProprio, false);

    // Valor próprio da linha vence o padrão e marca a linha.
    const propria = linha({ ...PARAMS, adicionalPisoPadraoPct: 10, adicionalPorLinha: { 2: 25 } }, BRUTA, ROTA_1000);
    eq('linha com 25% próprio: custo motorista 1.250', cent(propria.custoMotorista), 1250);
    eq('e fica marcada', propria.adicionalProprio, true);
    const outra = linha({ ...PARAMS, adicionalPisoPadraoPct: 10, adicionalPorLinha: { 2: 25 } }, { ...BRUTA, linhaExcel: 3 }, ROTA_1000);
    eq('a linha vizinha segue o padrão (1.100)', cent(outra.custoMotorista), 1100);

    // Tabela de compra própria: paga-se o MAIOR.
    const tabMaior = linha({ ...PARAMS, adicionalPisoPadraoPct: 10 }, { ...BRUTA, tabelaCompra: 1180 }, ROTA_1000);
    eq('tabela de compra 1.180 > piso+10%: vale a tabela', cent(tabMaior.custoMotorista), 1180);
    const tabMenor = linha({ ...PARAMS, adicionalPisoPadraoPct: 10 }, { ...BRUTA, tabelaCompra: 900 }, ROTA_1000);
    eq('tabela de compra 900 < piso+10%: vale o piso com adicional', cent(tabMenor.custoMotorista), 1100);

    // Antecipação incide sobre o custo motorista (com adicional), não sobre a venda.
    ok('custo financeiro sobre o custo motorista', perto(a10.custoAntecipacao, 1100 * a10.taxaAntecipacao / 100));

    // Só veículo ANTT.
    const pAntt = { ...PARAMS, modoPorVeiculo: { ...PARAMS.modoPorVeiculo, Truck: 'KM' } };
    eq('linha ANTT ok: célula editável', adicionalEditavel(a10, PARAMS), true);
    const truckKm = prepararLinha({ ...BRUTA, veiculoPlanilha: 'Truck' }, pAntt);
    eq('veículo de modo KM: célula desabilitada', adicionalEditavel(truckKm, pAntt), false);
}

console.log('\n--- 5. ADICIONAL NEGATIVO: BLOQUEADO ---');
{
    eq('validação recusa −5%', validarAdicionalPiso(-5).ok, false);
    ok('com mensagem de bloqueio', /bloqueado/.test(validarAdicionalPiso(-5).erro));
    const r = aplicarAdicionalLinhas({ 3: 10 }, [2, 3], -5);
    ok('aplicar −5% devolve erro', r.erro != null);
    eq('e não altera NADA no mapa', r.mapa, { 3: 10 });
    const valido = aplicarAdicionalLinhas({ 3: 10 }, [2, 3], 15);
    eq('aplicar às selecionadas (15%)', valido.mapa, { 2: 15, 3: 15 });
    eq('null devolve as linhas ao padrão', aplicarAdicionalLinhas({ 2: 15, 3: 15, 4: 7 }, [2, 3], null).mapa, { 4: 7 });
    eq('NaN também é recusado', validarAdicionalPiso(NaN).ok, false);
    // Segunda trava: mesmo que um negativo chegue ao motor, o custo nunca fica abaixo do piso.
    const forcado = linha({ ...PARAMS, adicionalPisoPadraoPct: -20 }, BRUTA, ROTA_1000);
    eq('negativo forçado no cálculo: custo motorista = piso', forcado.custoMotorista, 1000);
    // Acima de 50%: aviso, sem bloquear.
    const v60 = validarAdicionalPiso(60);
    eq('60% passa', v60.ok, true);
    ok('mas com aviso', v60.aviso != null);
    const l60 = linha({ ...PARAMS, adicionalPisoPadraoPct: 60 }, BRUTA, ROTA_1000);
    eq('e a linha calcula (1.600)', cent(l60.custoMotorista), 1600);
    ok('com alerta na linha', l60.alertas.some(a => a.includes('60%')));
}

console.log('\n--- 6. SEGURO ---');
{
    const ddr = linha({ ...PARAMS, seguroModo: 'ddr', seguroPct: 0.1, valorMercadoriaPadrao: 500000 }, BRUTA, ROTA_1000);
    eq('DDR: seguro zero (cobrado e custo)', [ddr.seguroRS, ddr.seguroCustoRS, ddr.seguroPct], [0, 0, 0]);
    const av = linha({ ...PARAMS, seguroModo: 'ad_valorem', seguroPct: 0.1, valorMercadoriaPadrao: 500000 }, BRUTA, ROTA_1000);
    eq('ad valorem 0,10% sobre 500.000 = R$ 500', cent(av.seguroRS), 500);
    // A regra é a do motor: cobrado = goodsValue × %, custo = goodsValue × taxa da apólice.
    const motor = calcularPreco({
        baseFreight: 1000, tolls: 200, extraCosts: 0, otherCosts: [], goodsValue: 500000, insurancePercent: 0.1,
        profitMargin: PARAMS.profitMargin, icmsPercent: 12, fedTaxes: PARAMS.fedTaxes, modoTabelado: false, valorFinalTabelado: 0,
    });
    eq('mesmo preço que a calculadora daria com seguro 0,10% e carga de 500.000', cent(av.precoOfertado), cent(motor.finalFreight));
    eq('custo do seguro = taxa da apólice (0,035% × 500.000 = 175)', cent(av.seguroCustoRS), 175);
    eq('nenhum alerta de valor de mercadoria', av.alertas.filter(a => a.includes('mercadoria')).length, 0);

    // Valor da planilha vence o padrão; o editado na tela vence os dois.
    const daLinha = linha({ ...PARAMS, seguroModo: 'ad_valorem', seguroPct: 0.1, valorMercadoriaPadrao: 500000 }, { ...BRUTA, valorMercadoria: 200000 }, ROTA_1000);
    eq('valor da planilha (200.000) vence o padrão', cent(daLinha.seguroRS), 200);
    const editado = linha({ ...PARAMS, seguroModo: 'ad_valorem', seguroPct: 0.1, valorMercadoriaPadrao: 500000, valorMercadoriaPorLinha: { 2: 100000 } }, { ...BRUTA, valorMercadoria: 200000 }, ROTA_1000);
    eq('valor editado na tela (100.000) vence a planilha', cent(editado.seguroRS), 100);

    const semValor = linha({ ...PARAMS, seguroModo: 'ad_valorem', seguroPct: 0.1 }, BRUTA, ROTA_1000);
    ok('ad valorem sem valor de mercadoria: aviso na linha', semValor.alertas.some(a => a.includes('sem valor de mercadoria')));
    eq('sem bloquear (linha ok, seguro 0)', [semValor.status, semValor.seguroRS], ['ok', 0]);
    const nd = linha({ ...PARAMS, seguroModo: 'nao_definido', seguroPct: 0.1, valorMercadoriaPadrao: 500000 }, BRUTA, ROTA_1000);
    eq('não definido: seguro zero', [nd.seguroRS, nd.seguroCustoRS], [0, 0]);

    // Importação: coluna de valor de NF mapeada quando existe.
    const brutas = montarLinhasBid(
        [{ O: 'A, SP', D: 'B, RJ', V: 'Carreta', NF: 'R$ 500.000,00', __rowNum__: 1 }, { O: 'C, SP', D: 'D, RJ', V: 'Carreta', NF: '', __rowNum__: 2 }],
        { origem: 'O', destino: 'D', veiculo: 'V', valorMercadoria: 'NF' },
    );
    eq('importação lê "R$ 500.000,00" como 500000', brutas[0].valorMercadoria, 500000);
    eq('célula vazia vira null (usa o padrão), não zero', brutas[1].valorMercadoria, null);
    const semColuna = montarLinhasBid([{ O: 'A, SP', D: 'B, RJ', V: 'Carreta' }], { origem: 'O', destino: 'D', veiculo: 'V' });
    eq('sem a coluna, a linha fica exatamente como era', Object.keys(semColuna[0]), ['linhaExcel', 'origem', 'destino', 'veiculoPlanilha']);
    eq('número nativo do Excel', lerNumeroPlanilha(123456.78), 123456.78);
    eq('"1.234,5"', lerNumeroPlanilha('1.234,5'), 1234.5);
}

console.log('\n--- 7. SOMA DOS COMPONENTES + MARGEM LÍQUIDA = PREÇO OFERTADO ---');
{
    // Grade de combinações: ICMS dentro/fora, adicional, seguro, tabela de compra, margens.
    let fechou = 0, total = 0;
    const falhas = [];
    for (const icmsIncluso of [true, false])
    for (const adicionalPisoPadraoPct of [0, 10, 55])
    for (const [seguroModo, seguroPct, valorMercadoriaPadrao] of [['nao_definido', 0, null], ['ddr', 0, null], ['ad_valorem', 0.1, 500000], ['ad_valorem', 0.25, null]])
    for (const profitMargin of [0, 15, 30])
    for (const g of GOLDEN.bid.linhas.slice(0, 4)) {
        const p = { ...PARAMS, profitMargin, icmsIncluso, adicionalPisoPadraoPct, seguroModo, seguroPct, valorMercadoriaPadrao };
        const l = linha(p, { ...g.bruta, tabelaCompra: g.bruta.linhaExcel === 3 ? 5000 : undefined }, g.rota);
        const soma = l.custoMotorista + l.pedagio + l.seguroCustoRS + l.custoAntecipacao + l.custoComissao
            + l.federaisRS + l.icmsNoPrecoRS + l.margemLiquidaRS;
        total++;
        if (perto(soma, l.precoOfertado, 1e-6)) fechou++;
        else falhas.push({ p: { icmsIncluso, adicionalPisoPadraoPct, seguroModo, profitMargin }, soma, preco: l.precoOfertado });
    }
    eq(`motorista + pedágio + seguro + financeiro + comissão + federais + ICMS + margem = preço (${total} casos)`, fechou, total);
    ok('nenhum caso fora', falhas.length === 0, JSON.stringify(falhas[0]));
}

console.log('\n--- TOTAIS ---');
{
    const p = { ...PARAMS, adicionalPisoPadraoPct: 10 };
    const ls = GOLDEN.bid.linhas.slice(0, 4).map(g => linha(p, g.bruta, g.rota));
    const pend = { ...prepararLinha({ linhaExcel: 9, origem: '', destino: 'X, SP', veiculoPlanilha: 'Carreta' }, p) };
    const t = totaisAbertura([...ls, pend]);
    ok('soma do preço ofertado só das linhas ok', perto(t.precoOfertado, ls.reduce((a, l) => a + l.precoOfertado, 0)));
    ok('markup ponderado = Σ frete sem ICMS / Σ custo direto',
        perto(t.markup, ls.reduce((a, l) => a + l.freteSemIcms, 0) / ls.reduce((a, l) => a + l.custoBase, 0)));
    ok('margem ponderada = Σ margem líquida / Σ preço ofertado',
        perto(t.margemLiquidaPct, 100 * ls.reduce((a, l) => a + l.margemLiquidaRS, 0) / ls.reduce((a, l) => a + l.precoOfertado, 0)));
    eq('percentuais não são somados', ['adicionalPisoPct', 'icmsPct', 'seguroPct'].map(k => k in t), [false, false, false]);
}

console.log('\n--- 8. EXCEL: TODAS AS COLUNAS + CABEÇALHO DE PARÂMETROS ---');
{
    const p = { ...PARAMS, icmsIncluso: false, adicionalPisoPadraoPct: 10, seguroModo: 'ad_valorem', seguroPct: 0.1, valorMercadoriaPadrao: 500000 };
    const ls = GOLDEN.bid.linhas.slice(0, 4).map(g => linha(p, g.bruta, g.rota));
    const data = new Date(2026, 10, 17, 9, 30);
    const aoa = montarPlanilhaBid(ls, p, data);

    // Ida e volta pelo SheetJS: é o que vai para o arquivo.
    const aba = XLSX.utils.aoa_to_sheet(aoa);
    const lido = XLSX.utils.sheet_to_json(aba, { header: 1, defval: '' });

    eq('título do bloco', lido[0][0], 'Parâmetros da rodada');
    const params = Object.fromEntries(lido.slice(1, 9).map(r => [r[0], r[1]]));
    ok('ICMS não incluso', String(params['ICMS']).startsWith('NÃO incluso'), params['ICMS']);
    eq('adicional padrão', params['Adicional padrão sobre o piso'], '10,00%');
    eq('modo e % do seguro', params['Seguro'], 'Ad valorem 0,100%');
    ok('prazo de pagamento', String(params['Prazo de pagamento']).startsWith('45 dias'), params['Prazo de pagamento']);
    eq('portaria ANTT vigente', params['Portaria ANTT vigente'], NORMA_PISO_ANTT);
    eq('data do cálculo', params['Data do cálculo'], '17/11/2026, 09:30');

    const iCab = lido.findIndex(r => r[0] === 'Linha');
    const cab = lido[iCab];
    eq(`cabeçalho com TODAS as ${COLUNAS_ABERTURA.length} colunas da abertura, na ordem`, cab.slice(1, 1 + COLUNAS_ABERTURA.length), COLUNAS_ABERTURA.map(c => c.titulo));
    const grupos = [...new Set(COLUNAS_ABERTURA.map(c => c.grupo))];
    eq('cobre os itens 1 a 16, em ordem', grupos, Array.from({ length: 16 }, (_, i) => i + 1));
    eq('uma linha por linha do bid + total', lido.length - iCab - 1, ls.length + 1);
    const l1 = lido[iCab + 1];
    const v = (titulo) => l1[cab.indexOf(titulo)];
    ok('valores preenchidos (preço ofertado = frete sem ICMS)', perto(v('Preço ofertado R$'), ls[0].freteSemIcms));
    eq('custo motorista = piso × 1,10', cent(v('Custo motorista R$')), cent(ls[0].pisoAntt * 1.1));
    eq('linha de total', lido[lido.length - 1][0], 'Total');
}

console.log(`\n${pass} ok, ${fail} falhas`);
if (fail > 0) process.exit(1);
