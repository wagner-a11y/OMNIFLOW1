// =====================================================================
// FASE 0 — A REDE DE SEGURANÇA DO MOTOR DE PREÇO
//
// Roda: npx tsx utils/motorPreco.test.mjs
//
// O motor não tinha nenhuma cobertura. Esta suíte é a rede: se alguém mexer na
// equação, ela cai. Ela NÃO testa números decorados — testa as identidades que
// definem o motor, o que a torna válida mesmo se as alíquotas mudarem:
//
//   1. Identidade do gross-up (ida):
//        final × (1−ICMS) × (1−margem) = pago ao terceiro + pedágio + extras + adV
//   2. Ida e volta fecham em R$ 0,00 nos DOIS sentidos (Calcular ↔ Tabelado).
//   3. Os dois modos, no mesmo par (motorista, final), dão os MESMOS impostos,
//      lucro e margem — o Tabelado não é conta paralela.
//   4. Definições: lucro = final − ICMS − federais − custo real; margem = lucro/final.
//   5. Degenerados (margem 100%, ICMS 100%) pinados, não "quase certos".
// =====================================================================
import { calcularPreco } from './motorPreco.ts';

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
// "Fecha em R$ 0,00" = igual depois de arredondar para centavos.
const cent = (n) => Math.round(n * 100) / 100;
const fechaEmZero = (a, b) => cent(a) === cent(b);

const TRIB = { pis: 0.65, cofins: 3.0, csll: 1.08, irpj: 1.2, insurancePolicyRate: 0.035 };
const BASE = {
    baseFreight: 0, tolls: 0, extraCosts: 0, otherCosts: [], goodsValue: 0,
    insurancePercent: 0, profitMargin: 15, icmsPercent: 12,
    fedTaxes: TRIB, modoTabelado: false, valorFinalTabelado: 0,
};
const ent = (over) => ({ ...BASE, ...over });

// Cenários de ida (modo Calcular). Todos com margem < 100% e ICMS < 100%,
// que é a faixa onde a equação é inversível.
const IDAS = [
    { nome: 'base simples', baseFreight: 5000, tolls: 500 },
    { nome: 'com extras e outros custos', baseFreight: 7000, tolls: 820.35, extraCosts: 450, otherCosts: [{ id: '1', label: 'Escolta', value: 1200 }, { id: '2', label: 'Ajudante', value: 350.75 }] },
    { nome: 'com ad valorem', baseFreight: 8000, goodsValue: 1500000, insurancePercent: 0.35 },
    { nome: 'sem ICMS', baseFreight: 5000, icmsPercent: 0 },
    { nome: 'margem zero', baseFreight: 5000, profitMargin: 0 },
    { nome: 'margem e ICMS fracionarios', baseFreight: 6543.21, tolls: 231.07, profitMargin: 17.45, icmsPercent: 4.5 },
    { nome: 'margem alta (90%)', baseFreight: 5000, profitMargin: 90 },
    { nome: 'ICMS alto (19%)', baseFreight: 5000, icmsPercent: 19 },
    { nome: 'tudo junto', baseFreight: 12345.67, tolls: 1234.56, extraCosts: 890.12, goodsValue: 250000, insurancePercent: 0.2, profitMargin: 22.5, icmsPercent: 7, otherCosts: [{ id: '1', label: 'Extra', value: 999.99 }] },
    { nome: 'centavos quebrados', baseFreight: 3333.33, tolls: 66.67, profitMargin: 13.13, icmsPercent: 11.11 },
];

console.log('--- 1) IDENTIDADE DO GROSS-UP: final x (1-ICMS) x (1-margem) = custos diretos ---');
for (const cen of IDAS) {
    const r = calcularPreco(ent(cen));
    const icmsP = (cen.icmsPercent ?? BASE.icmsPercent) / 100;
    const pm = (cen.profitMargin ?? BASE.profitMargin) / 100;
    const lado = r.finalFreight * (1 - icmsP) * (1 - pm);
    ok(`${cen.nome}: identidade fecha`, fechaEmZero(lado, r.directCosts),
        `=> ${cent(lado)} vs ${cent(r.directCosts)} (delta ${cent(lado - r.directCosts)})`);
}

console.log('\n--- 2a) IDA e VOLTA: Calcular -> Tabelado devolve o MESMO motorista ---');
for (const cen of IDAS) {
    const ida = calcularPreco(ent(cen));
    // Volta: o valor final da ida entra como preço dado; o motorista tem que voltar.
    const volta = calcularPreco(ent({ ...cen, modoTabelado: true, valorFinalTabelado: ida.finalFreight, baseFreight: 0 }));
    const motoristaOriginal = cen.baseFreight ?? 0;
    ok(`${cen.nome}: motorista volta igual`, fechaEmZero(volta.motoristaTabelado, motoristaOriginal),
        `=> R$ ${cent(volta.motoristaTabelado)} vs R$ ${cent(motoristaOriginal)} (delta R$ ${cent(volta.motoristaTabelado - motoristaOriginal)})`);
}

console.log('\n--- 2b) VOLTA e IDA: Tabelado -> Calcular devolve o MESMO valor final ---');
const VALORES_TABELADOS = [10000, 18500, 9000, 7353.17, 42000.99, 1234.56];
for (const vf of VALORES_TABELADOS) {
    const cen = { tolls: 500, extraCosts: 250, goodsValue: 100000, insurancePercent: 0.2, profitMargin: 18, icmsPercent: 12 };
    const tab = calcularPreco(ent({ ...cen, modoTabelado: true, valorFinalTabelado: vf }));
    // Ida: o motorista derivado entra como preço base; o valor final tem que voltar.
    const normal = calcularPreco(ent({ ...cen, baseFreight: tab.motoristaTabelado }));
    ok(`valor final R$ ${vf}: volta igual`, fechaEmZero(normal.finalFreight, vf),
        `=> R$ ${cent(normal.finalFreight)} vs R$ ${cent(vf)} (delta R$ ${cent(normal.finalFreight - vf)})`);
}

console.log('\n--- 2c) IDA e VOLTA em 500 cenarios aleatorios (margem<100, ICMS<100) ---');
let semente = 20261011, piorDelta = 0, piorNome = '';
const rnd = () => { semente = (semente * 1103515245 + 12345) & 0x7fffffff; return semente / 0x7fffffff; };
let rtOk = 0, rtFail = 0;
for (let k = 0; k < 500; k++) {
    const cen = {
        baseFreight: Number((rnd() * 40000).toFixed(2)),
        tolls: Number((rnd() * 3000).toFixed(2)),
        extraCosts: Number((rnd() * 2000).toFixed(2)),
        goodsValue: Number((rnd() * 2000000).toFixed(2)),
        insurancePercent: Number((rnd() * 2).toFixed(3)),
        profitMargin: Number((rnd() * 95).toFixed(2)),
        icmsPercent: Number((rnd() * 20).toFixed(2)),
        otherCosts: rnd() < 0.3 ? [{ id: 'x', label: 'Extra', value: Number((rnd() * 5000).toFixed(2)) }] : [],
    };
    const ida = calcularPreco(ent(cen));
    const volta = calcularPreco(ent({ ...cen, modoTabelado: true, valorFinalTabelado: ida.finalFreight, baseFreight: 0 }));
    const delta = Math.abs(volta.motoristaTabelado - cen.baseFreight);
    if (delta > Math.abs(piorDelta)) { piorDelta = delta; piorNome = `#${k + 1}`; }
    fechaEmZero(volta.motoristaTabelado, cen.baseFreight) ? rtOk++ : rtFail++;
}
ok(`500 aleatorios fecham em R$ 0,00 (${rtOk} ok, ${rtFail} falhas)`, rtFail === 0);
console.log(`     pior desvio bruto antes do arredondamento: R$ ${piorDelta.toExponential(3)} (cenario ${piorNome})`);

console.log('\n--- 3) OS DOIS MODOS dao os MESMOS impostos, lucro e margem ---');
for (const cen of IDAS) {
    const ida = calcularPreco(ent(cen));
    const volta = calcularPreco(ent({ ...cen, modoTabelado: true, valorFinalTabelado: ida.finalFreight, baseFreight: 0 }));
    const campos = ['finalFreight', 'icmsAmount', 'fedTaxesAmount', 'adValoremSelling', 'adValoremCost', 'realProfitAmount', 'realMarginPercent', 'bfEfetivo'];
    const difs = campos.filter(f => !fechaEmZero(ida[f], volta[f]));
    ok(`${cen.nome}: os 8 campos batem nos dois modos`, difs.length === 0, `divergiram: ${difs.join(', ')}`);
}

console.log('\n--- 4) DEFINICOES: lucro e margem ---');
for (const cen of IDAS) {
    const r = calcularPreco(ent(cen));
    const lucroEsperado = r.finalFreight - r.icmsAmount - r.fedTaxesAmount - r.realDirectCosts;
    ok(`${cen.nome}: lucro = final - ICMS - federais - custo real`, fechaEmZero(r.realProfitAmount, lucroEsperado));
    const margemEsperada = r.finalFreight > 0 ? (r.realProfitAmount / r.finalFreight) * 100 : 0;
    ok(`${cen.nome}: margem = lucro / final`, fechaEmZero(r.realMarginPercent, margemEsperada));
}

console.log('\n--- 5) VALORES FIXOS (golden) ---');
{
    const r = calcularPreco(ent({ baseFreight: 5000, tolls: 500 }));
    eq('custo direto', cent(r.directCosts), 5500);
    eq('preco com margem (15%)', cent(r.priceAfterMargin), 6470.59);
    eq('valor final (ICMS 12%)', cent(r.finalFreight), 7352.94);
    eq('ICMS', cent(r.icmsAmount), 882.35);
    eq('federais (5,93%)', cent(r.fedTaxesAmount), 436.03);
    eq('lucro', cent(r.realProfitAmount), 534.56);
    eq('margem %', Number(r.realMarginPercent.toFixed(2)), 7.27);
    eq('bfEfetivo = o que se paga', cent(r.bfEfetivo), 5000);
}
{
    // Ad valorem: o COBRADO (0,2%) e o de CUSTO (apolice 0,035%) sao diferentes.
    const r = calcularPreco(ent({ baseFreight: 5000, goodsValue: 1000000, insurancePercent: 0.2 }));
    eq('ad valorem cobrado = 0,2% de 1M', cent(r.adValoremSelling), 2000);
    eq('ad valorem custo = 0,035% de 1M', cent(r.adValoremCost), 350);
    ok('custo real usa o de CUSTO, nao o cobrado', cent(r.realDirectCosts) === cent(5000 + 350));
    ok('custo direto de venda usa o COBRADO', cent(r.directCosts) === cent(5000 + 2000));
}

console.log('\n--- 6) DEGENERADOS (pinados, nao arredondados pra bonito) ---');
{
    // Margem 100% => marginDivisor 0 => o fallback mantem o custo direto.
    const r = calcularPreco(ent({ baseFreight: 5000, tolls: 500, profitMargin: 100 }));
    eq('margem 100: preco com margem cai no custo direto', cent(r.priceAfterMargin), 5500);
    eq('margem 100: final = custo / (1-ICMS)', cent(r.finalFreight), 6250);
}
{
    // ICMS 100% => icmsDivisor 0 => o fallback mantem o preco com margem.
    const r = calcularPreco(ent({ baseFreight: 5000, tolls: 500, icmsPercent: 100 }));
    eq('ICMS 100: final cai no preco com margem', cent(r.finalFreight), cent(r.priceAfterMargin));
}
{
    // Formulario vazio: tudo zero, sem NaN e sem divisao por zero.
    const r = calcularPreco(ent({}));
    const temNaN = Object.values(r).some(v => Number.isNaN(v));
    ok('formulario zerado nao produz NaN', !temNaN);
    eq('formulario zerado: margem 0 (nao NaN)', r.realMarginPercent, 0);
}
{
    // Tabelado ignora o baseFreight digitado: o motorista e DERIVADO.
    const comBase = calcularPreco(ent({ modoTabelado: true, valorFinalTabelado: 10000, baseFreight: 99999 }));
    const semBase = calcularPreco(ent({ modoTabelado: true, valorFinalTabelado: 10000, baseFreight: 0 }));
    eq('tabelado ignora o preco base digitado', cent(comBase.finalFreight), cent(semBase.finalFreight));
    eq('tabelado: motorista identico com ou sem base digitada', cent(comBase.motoristaTabelado), cent(semBase.motoristaTabelado));
}

console.log(`\n${pass} ok, ${fail} falhas`);
if (fail > 0) process.exit(1);
