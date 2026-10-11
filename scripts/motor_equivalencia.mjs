// =====================================================================
// EQUIVALÊNCIA DO MOTOR DE PREÇO — prova de que a extração não mudou nada.
//
// Roda: npx tsx scripts/motor_equivalencia.mjs
//
// Não compara o motor novo com uma transcrição minha da conta antiga: compara
// com o CÓDIGO ORIGINAL, lido de `git show main:App.tsx` e executado de
// verdade. O `num()` também vem de lá, não de uma cópia.
//
// Cada cenário é definido com as STRINGS que o formulário produzia e roda nos
// dois lados: o original recebe as strings (parsing dentro, como era), e o
// motor extraído recebe os números pela casca (parsing fora, como ficou).
// Assim o que está sendo verificado é casca + motor contra o original —
// inclusive a mudança de fronteira do parsing, que é o risco real.
//
// Comparação campo a campo com Object.is: bit-a-bit, sem tolerância. Qualquer
// diferença de arredondamento aparece.
// =====================================================================
import { execSync } from 'node:child_process';
import { calcularPreco } from '../utils/motorPreco.ts';

const REF = process.env.MOTOR_REF || 'main';

// ---------------------------------------------------------------------
// 1) Extrai do App.tsx original: o corpo do calcData e o helper num()
// ---------------------------------------------------------------------
const fonte = execSync(`git show ${REF}:App.tsx`, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const linhas = fonte.split('\n');

const iCalc = linhas.findIndex(l => l.trim().startsWith('const calcData = useMemo'));
const jCalc = linhas.findIndex(l => l.startsWith('    }, [baseFreight, tolls, extraCosts'));
if (iCalc < 0 || jCalc < 0) throw new Error('nao achei o calcData no App.tsx de ' + REF);
// Corpo = tudo entre a abertura do useMemo e o fechamento (exclusive).
const corpoCalc = linhas.slice(iCalc + 1, jCalc).join('\n');

const iNum = linhas.findIndex(l => l.includes('const num = (s: string | number | undefined | null) => {'));
if (iNum < 0) throw new Error('nao achei o num() no App.tsx de ' + REF);
const jNum = iNum + linhas.slice(iNum).findIndex(l => l === '    };');
const corpoNum = linhas.slice(iNum, jNum + 1).join('\n')
    .replace('(s: string | number | undefined | null)', '(s)');   // tira a anotacao TS

console.log(`Motor original: ${REF}:App.tsx linhas ${iCalc + 1}-${jCalc + 1} (${jCalc - iCalc + 1} linhas)`);
console.log(`Helper num():   ${REF}:App.tsx linhas ${iNum + 1}-${jNum + 1}\n`);

// num() original, executado de verdade.
const num = new Function(`${corpoNum} return num;`)();

// Motor ORIGINAL como função: as 11 variáveis do closure viram parâmetros.
const motorOriginal = new Function(
    'num', 'baseFreight', 'tolls', 'extraCosts', 'otherCosts', 'goodsValue',
    'insurancePercent', 'profitMargin', 'icmsPercent', 'fedTaxes',
    'modoTabelado', 'valorFinalTabelado',
    corpoCalc,
);

// ---------------------------------------------------------------------
// 2) A casca: a MESMA tradução que o App.tsx faz agora
// ---------------------------------------------------------------------
const pct = (v) => parseFloat(String(v).replace(',', '.')) || 0;
const viaCasca = (c) => calcularPreco({
    baseFreight: num(c.baseFreight),
    tolls: num(c.tolls),
    extraCosts: num(c.extraCosts),
    otherCosts: c.otherCosts,
    goodsValue: num(c.goodsValue),
    insurancePercent: pct(c.insurancePercent),
    profitMargin: pct(c.profitMargin),
    icmsPercent: pct(c.icmsPercent),
    fedTaxes: c.fedTaxes,
    modoTabelado: c.modoTabelado,
    valorFinalTabelado: num(c.valorFinalTabelado),
});

const viaOriginal = (c) => motorOriginal(
    num, c.baseFreight, c.tolls, c.extraCosts, c.otherCosts, c.goodsValue,
    c.insurancePercent, c.profitMargin, c.icmsPercent, c.fedTaxes,
    c.modoTabelado, c.valorFinalTabelado,
);

// ---------------------------------------------------------------------
// 3) Cenários
// ---------------------------------------------------------------------
const TRIB = { pis: 0.65, cofins: 3.0, csll: 1.08, irpj: 1.2, insurancePolicyRate: 0.035 };

const base = {
    baseFreight: '0', tolls: '0', extraCosts: '0', otherCosts: [], goodsValue: '0',
    insurancePercent: '0.2', profitMargin: '15', icmsPercent: '12',
    fedTaxes: TRIB, modoTabelado: false, valorFinalTabelado: '0',
};
const c = (nome, over) => ({ nome, ...base, ...over });

const cenarios = [
    c('zerado (formulario vazio)', {}),
    c('normal simples', { baseFreight: 'R$ 5.000,00', tolls: 'R$ 320,50' }),
    c('normal com mascara cheia', { baseFreight: 'R$ 12.345,67', tolls: 'R$ 1.234,56', extraCosts: 'R$ 890,12', goodsValue: 'R$ 250.000,00' }),
    c('normal com outros custos', { baseFreight: '7000', tolls: '500', otherCosts: [{ id: '1', label: 'Escolta', value: 1200 }, { id: '2', label: 'Ajudante', value: 350.75 }] }),
    c('normal com ad valorem', { baseFreight: '8000', goodsValue: 'R$ 1.500.000,00', insurancePercent: '0,35' }),
    c('normal sem ICMS', { baseFreight: '5000', icmsPercent: '0' }),
    c('normal margem 0', { baseFreight: '5000', profitMargin: '0' }),
    c('normal margem 100 (divisor zero)', { baseFreight: '5000', profitMargin: '100' }),
    c('normal margem acima de 100 (divisor negativo)', { baseFreight: '5000', profitMargin: '120' }),
    c('normal ICMS 100 (divisor zero)', { baseFreight: '5000', icmsPercent: '100' }),
    c('normal margem fracionaria', { baseFreight: '6543,21', profitMargin: '17,45', icmsPercent: '4,5' }),
    c('normal base negativa', { baseFreight: '-1000', tolls: '200' }),
    c('normal tributos zerados', { baseFreight: '5000', fedTaxes: { pis: 0, cofins: 0, csll: 0, irpj: 0, insurancePolicyRate: 0 } }),
    c('tabelado simples', { modoTabelado: true, valorFinalTabelado: 'R$ 10.000,00', tolls: '500' }),
    c('tabelado com tudo', { modoTabelado: true, valorFinalTabelado: 'R$ 18.500,00', tolls: 'R$ 1.100,00', extraCosts: '450', goodsValue: 'R$ 800.000,00', insurancePercent: '0,25', profitMargin: '22', icmsPercent: '7', otherCosts: [{ id: '1', label: 'Escolta', value: 900 }] }),
    c('tabelado sem ICMS', { modoTabelado: true, valorFinalTabelado: '9000', icmsPercent: '0' }),
    c('tabelado margem 0', { modoTabelado: true, valorFinalTabelado: '9000', profitMargin: '0' }),
    c('tabelado margem 100', { modoTabelado: true, valorFinalTabelado: '9000', profitMargin: '100' }),
    c('tabelado valor zero', { modoTabelado: true, valorFinalTabelado: '0', tolls: '300' }),
    c('tabelado ignora o baseFreight digitado', { modoTabelado: true, valorFinalTabelado: '10000', baseFreight: 'R$ 99.999,00' }),
    c('lixo no campo monetario', { baseFreight: 'abc', tolls: 'R$ ', extraCosts: '' }),
    c('lixo no campo percentual', { baseFreight: '5000', profitMargin: 'xyz', icmsPercent: '' }),
];

// Aleatórios: cobrem combinações que eu não pensaria em escrever à mão.
let semente = 20261011;
const rnd = () => { semente = (semente * 1103515245 + 12345) & 0x7fffffff; return semente / 0x7fffffff; };
for (let k = 0; k < 400; k++) {
    const tab = rnd() < 0.5;
    cenarios.push(c(`aleatorio #${k + 1} (${tab ? 'tabelado' : 'normal'})`, {
        baseFreight: (rnd() * 40000).toFixed(2).replace('.', ','),
        tolls: (rnd() * 3000).toFixed(2).replace('.', ','),
        extraCosts: (rnd() * 2000).toFixed(2).replace('.', ','),
        goodsValue: (rnd() * 2000000).toFixed(2).replace('.', ','),
        insurancePercent: (rnd() * 2).toFixed(3),
        profitMargin: (rnd() * 130).toFixed(2),
        icmsPercent: (rnd() * 20).toFixed(2),
        otherCosts: rnd() < 0.3 ? [{ id: 'x', label: 'Extra', value: Number((rnd() * 5000).toFixed(2)) }] : [],
        modoTabelado: tab,
        valorFinalTabelado: (rnd() * 60000).toFixed(2).replace('.', ','),
    }));
}

// ---------------------------------------------------------------------
// 4) Comparação campo a campo, bit-a-bit
// ---------------------------------------------------------------------
const CAMPOS = [
    'directCosts', 'realDirectCosts', 'priceAfterMargin', 'finalFreight',
    'icmsAmount', 'fedTaxesAmount', 'adValoremSelling', 'adValoremCost',
    'realProfitAmount', 'realMarginPercent', 'motoristaTabelado', 'bfEfetivo',
];

let iguais = 0;
const divergencias = [];
for (const cen of cenarios) {
    const velho = viaOriginal(cen);
    const novo = viaCasca(cen);

    const chavesVelho = Object.keys(velho).sort().join(',');
    const chavesNovo = Object.keys(novo).sort().join(',');
    if (chavesVelho !== chavesNovo) {
        divergencias.push(`${cen.nome}: formato do objeto difere\n  antes: ${chavesVelho}\n  agora: ${chavesNovo}`);
        continue;
    }

    const difs = CAMPOS.filter(f => !Object.is(velho[f], novo[f]))
        .map(f => `${f}: antes ${velho[f]} / agora ${novo[f]}`);
    if (difs.length) divergencias.push(`${cen.nome}\n    ` + difs.join('\n    '));
    else iguais++;
}

console.log(`Cenarios comparados: ${cenarios.length} (${cenarios.length - 400} escritos a mao + 400 aleatorios)`);
console.log(`Campos por cenario:  ${CAMPOS.length}`);
console.log(`Identicos bit-a-bit: ${iguais}`);
console.log(`Divergentes:         ${divergencias.length}`);

if (divergencias.length) {
    console.log('\n--- DIVERGENCIAS ---');
    for (const d of divergencias.slice(0, 20)) console.log('  ' + d);
    console.log('\n>>> A EXTRACAO MUDOU COMPORTAMENTO.');
    process.exit(1);
}
console.log('\n>>> Motor extraido e IDENTICO ao original em todos os cenarios.');
