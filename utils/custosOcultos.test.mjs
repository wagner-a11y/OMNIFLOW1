// Testes dos Custos Ocultos (antecipação + comissão) e da Margem Líquida.
// Roda: npx tsx utils/custosOcultos.test.mjs
import { calcularCustosOcultos } from './custosOcultos.ts';

let pass = 0, fail = 0;
const eq = (label, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    console.log(`${ok ? 'OK  ' : 'FAIL'} | ${label} => ${JSON.stringify(got)}${ok ? '' : `  (esperado ${JSON.stringify(want)})`}`);
    ok ? pass++ : fail++;
};
const r2 = (n) => Math.round(n * 100) / 100;

// Tabela de antecipação como ela nasce na migration: 5 linhas, todas em 0.
const TABELA_SEMEADA = { '0': 0, '15': 0, '30': 0, '45': 0, '60': 0 };
// Tabela depois de o operador configurar os números reais na tela.
const TABELA_REAL = { '0': 0, '15': 1.5, '30': 2.8, '45': 4.0, '60': 5.2 };

// Cotação de referência: receita R$ 10.000, margem bruta R$ 1.800 (18,0%).
const BASE = { receita: 10000, margemBrutaRS: 1800 };

console.log('--- PROVA 1: sem prazo e sem comissao, a liquida E a bruta ---');
{
    const o = calcularCustosOcultos({ ...BASE, prazoDias: '', comissaoPercent: '', taxasAntecipacao: TABELA_SEMEADA, comissaoPadrao: 0 });
    eq('antecipacao zero', r2(o.custoAntecipacao), 0);
    eq('comissao zero', r2(o.custoComissao), 0);
    eq('liquida R$ == bruta R$', r2(o.lucroLiquido), 1800);
    eq('liquida % == bruta %', r2(o.margemLiquidaPercent), 18);
    eq('nenhum custo aplicado', o.temCusto, false);
    eq('prazo nao informado', o.prazoDias, null);
}
// Mesmo com a tabela semeada e um prazo escolhido, taxa 0 => custo 0.
{
    const o = calcularCustosOcultos({ ...BASE, prazoDias: '30', comissaoPercent: '', taxasAntecipacao: TABELA_SEMEADA, comissaoPadrao: 0 });
    eq('prazo 30 com taxa semeada em 0', r2(o.custoAntecipacao), 0);
    eq('liquida segue igual a bruta', r2(o.lucroLiquido), 1800);
}

console.log('\n--- PROVA 2: com prazo (30d a 2,8%) e comissao (2%) ---');
{
    const o = calcularCustosOcultos({ ...BASE, prazoDias: '30', comissaoPercent: '2', taxasAntecipacao: TABELA_REAL, comissaoPadrao: 0 });
    eq('taxa resolvida pela tabela', o.taxaAntecipacao, 2.8);
    eq('antecipacao = 10000 x 2,8%', r2(o.custoAntecipacao), 280);
    eq('comissao = 10000 x 2%', r2(o.custoComissao), 200);
    eq('liquida = 1800 - 280 - 200', r2(o.lucroLiquido), 1320);
    eq('liquida % = 13,2%', r2(o.margemLiquidaPercent), 13.2);
    eq('tem custo', o.temCusto, true);
}
// A vista: prazo 0 e uma escolha legitima, nao "em branco".
{
    const o = calcularCustosOcultos({ ...BASE, prazoDias: '0', comissaoPercent: '2', taxasAntecipacao: TABELA_REAL, comissaoPadrao: 0 });
    eq('a vista e prazo informado (0, nao null)', o.prazoDias, 0);
    eq('a vista nao cobra antecipacao', r2(o.custoAntecipacao), 0);
    eq('mas a comissao continua', r2(o.custoComissao), 200);
    eq('liquida = 1800 - 0 - 200', r2(o.lucroLiquido), 1600);
}
// Prazo mais caro da tabela.
{
    const o = calcularCustosOcultos({ ...BASE, prazoDias: '60', comissaoPercent: '2', taxasAntecipacao: TABELA_REAL, comissaoPadrao: 0 });
    eq('60 dias a 5,2% = 520', r2(o.custoAntecipacao), 520);
    eq('liquida = 1800 - 520 - 200', r2(o.lucroLiquido), 1080);
    eq('liquida % = 10,8%', r2(o.margemLiquidaPercent), 10.8);
}

console.log('\n--- comissao: padrao, override e virgula ---');
eq('vazio cai no padrao de 1,5%',
    r2(calcularCustosOcultos({ ...BASE, prazoDias: '', comissaoPercent: '', taxasAntecipacao: TABELA_REAL, comissaoPadrao: 1.5 }).custoComissao), 150);
eq('zero na mao sobrepoe o padrao',
    r2(calcularCustosOcultos({ ...BASE, prazoDias: '', comissaoPercent: '0', taxasAntecipacao: TABELA_REAL, comissaoPadrao: 1.5 }).custoComissao), 0);
eq('aceita virgula decimal',
    r2(calcularCustosOcultos({ ...BASE, prazoDias: '', comissaoPercent: '2,5', taxasAntecipacao: TABELA_REAL, comissaoPadrao: 0 }).custoComissao), 250);

console.log('\n--- tabela ausente/incompleta nao chuta taxa ---');
eq('tabela vazia => taxa 0',
    calcularCustosOcultos({ ...BASE, prazoDias: '30', comissaoPercent: '', taxasAntecipacao: {}, comissaoPadrao: 0 }).taxaAntecipacao, 0);
eq('tabela ausente => taxa 0',
    calcularCustosOcultos({ ...BASE, prazoDias: '30', comissaoPercent: '', comissaoPadrao: 0 }).taxaAntecipacao, 0);
eq('prazo fora da tabela => taxa 0',
    calcularCustosOcultos({ ...BASE, prazoDias: '90', comissaoPercent: '', taxasAntecipacao: TABELA_REAL, comissaoPadrao: 0 }).taxaAntecipacao, 0);

console.log('\n--- cotacao vazia nao estoura ---');
{
    const o = calcularCustosOcultos({ receita: 0, margemBrutaRS: 0, prazoDias: '30', comissaoPercent: '2', taxasAntecipacao: TABELA_REAL, comissaoPadrao: 0 });
    eq('receita 0 => % 0, sem divisao por zero', o.margemLiquidaPercent, 0);
    eq('receita 0 => custos 0', [r2(o.custoAntecipacao), r2(o.custoComissao)], [0, 0]);
}

console.log('\n--- margem bruta negativa continua negativa (nao mascara prejuizo) ---');
{
    const o = calcularCustosOcultos({ receita: 10000, margemBrutaRS: -500, prazoDias: '30', comissaoPercent: '2', taxasAntecipacao: TABELA_REAL, comissaoPadrao: 0 });
    eq('liquida = -500 - 280 - 200', r2(o.lucroLiquido), -980);
    eq('liquida % negativa', r2(o.margemLiquidaPercent), -9.8);
}

console.log(`\n${pass} ok, ${fail} falhas`);
if (fail > 0) process.exit(1);
