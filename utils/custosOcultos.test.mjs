// Testes dos Custos Ocultos (antecipação + comissão) e da Margem Líquida.
// Roda: npx tsx utils/custosOcultos.test.mjs
//
// As duas bases são DIFERENTES de propósito:
//   antecipação -> custoTerceiro (o que se PAGA)
//   comissão    -> receita       (o que se VENDE)
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

// Cotação de referência: receita R$ 10.000 (venda), pago ao terceiro R$ 7.000
// (custo), margem bruta R$ 1.800 (18,0% da receita). As duas bases divergem —
// é exatamente o que separa a antecipação da comissão.
const BASE = { receita: 10000, custoTerceiro: 7000, margemBrutaRS: 1800 };

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
    eq('antecipacao = 7000 (PAGO) x 2,8%', r2(o.custoAntecipacao), 196);
    eq('comissao = 10000 (VENDA) x 2%', r2(o.custoComissao), 200);
    eq('liquida = 1800 - 196 - 200', r2(o.lucroLiquido), 1404);
    eq('liquida % = 14,04% (medida sobre a receita)', r2(o.margemLiquidaPercent), 14.04);
    eq('tem custo', o.temCusto, true);
}

console.log('\n--- BASES: antecipacao usa o CUSTO, comissao usa a VENDA ---');
// O caso que motivou a correcao: se a antecipacao usasse a receita, daria 280.
{
    const o = calcularCustosOcultos({ ...BASE, prazoDias: '30', comissaoPercent: '2', taxasAntecipacao: TABELA_REAL, comissaoPadrao: 0 });
    eq('antecipacao NAO e 10000 x 2,8% (=280)', r2(o.custoAntecipacao) === 280, false);
    eq('antecipacao E 7000 x 2,8% (=196)', r2(o.custoAntecipacao), 196);
}
// Mexer SO no custo move a antecipacao e nao encosta na comissao.
{
    const a = calcularCustosOcultos({ ...BASE, custoTerceiro: 7000, prazoDias: '30', comissaoPercent: '2', taxasAntecipacao: TABELA_REAL, comissaoPadrao: 0 });
    const b = calcularCustosOcultos({ ...BASE, custoTerceiro: 8000, prazoDias: '30', comissaoPercent: '2', taxasAntecipacao: TABELA_REAL, comissaoPadrao: 0 });
    eq('custo 7000 -> 8000 muda a antecipacao', [r2(a.custoAntecipacao), r2(b.custoAntecipacao)], [196, 224]);
    eq('e NAO mexe na comissao', [r2(a.custoComissao), r2(b.custoComissao)], [200, 200]);
}
// Mexer SO na receita move a comissao e nao encosta na antecipacao.
{
    const a = calcularCustosOcultos({ ...BASE, receita: 10000, prazoDias: '30', comissaoPercent: '2', taxasAntecipacao: TABELA_REAL, comissaoPadrao: 0 });
    const b = calcularCustosOcultos({ ...BASE, receita: 12000, prazoDias: '30', comissaoPercent: '2', taxasAntecipacao: TABELA_REAL, comissaoPadrao: 0 });
    eq('receita 10000 -> 12000 muda a comissao', [r2(a.custoComissao), r2(b.custoComissao)], [200, 240]);
    eq('e NAO mexe na antecipacao', [r2(a.custoAntecipacao), r2(b.custoAntecipacao)], [196, 196]);
}
// Custo zero (frete de terceiro nao informado): antecipacao 0, comissao segue.
{
    const o = calcularCustosOcultos({ ...BASE, custoTerceiro: 0, prazoDias: '30', comissaoPercent: '2', taxasAntecipacao: TABELA_REAL, comissaoPadrao: 0 });
    eq('sem valor pago ao terceiro, antecipacao e 0', r2(o.custoAntecipacao), 0);
    eq('mas a comissao sobre a venda continua', r2(o.custoComissao), 200);
}

console.log('\n--- a vista e o prazo mais caro ---');
{
    const o = calcularCustosOcultos({ ...BASE, prazoDias: '0', comissaoPercent: '2', taxasAntecipacao: TABELA_REAL, comissaoPadrao: 0 });
    eq('a vista e prazo informado (0, nao null)', o.prazoDias, 0);
    eq('a vista nao cobra antecipacao', r2(o.custoAntecipacao), 0);
    eq('mas a comissao continua', r2(o.custoComissao), 200);
    eq('liquida = 1800 - 0 - 200', r2(o.lucroLiquido), 1600);
}
{
    const o = calcularCustosOcultos({ ...BASE, prazoDias: '60', comissaoPercent: '2', taxasAntecipacao: TABELA_REAL, comissaoPadrao: 0 });
    eq('60 dias: 7000 x 5,2% = 364', r2(o.custoAntecipacao), 364);
    eq('liquida = 1800 - 364 - 200', r2(o.lucroLiquido), 1236);
    eq('liquida % = 12,36%', r2(o.margemLiquidaPercent), 12.36);
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
    const o = calcularCustosOcultos({ receita: 0, custoTerceiro: 0, margemBrutaRS: 0, prazoDias: '30', comissaoPercent: '2', taxasAntecipacao: TABELA_REAL, comissaoPadrao: 0 });
    eq('receita 0 => % 0, sem divisao por zero', o.margemLiquidaPercent, 0);
    eq('receita 0 => custos 0', [r2(o.custoAntecipacao), r2(o.custoComissao)], [0, 0]);
}

console.log('\n--- margem bruta negativa continua negativa (nao mascara prejuizo) ---');
{
    const o = calcularCustosOcultos({ receita: 10000, custoTerceiro: 7000, margemBrutaRS: -500, prazoDias: '30', comissaoPercent: '2', taxasAntecipacao: TABELA_REAL, comissaoPadrao: 0 });
    eq('liquida = -500 - 196 - 200', r2(o.lucroLiquido), -896);
    eq('liquida % negativa', r2(o.margemLiquidaPercent), -8.96);
}

console.log('\n--- modo Tabelado: a base vem do motorista derivado ---');
// No Tabelado o preco e dado e o motorista e derivado pela engine invertida.
// bfEfetivo ja entrega o valor certo nos dois modos, entao aqui so muda o numero.
{
    const o = calcularCustosOcultos({ receita: 9500, custoTerceiro: 6400, margemBrutaRS: 1500, prazoDias: '45', comissaoPercent: '1,8', taxasAntecipacao: TABELA_REAL, comissaoPadrao: 0 });
    eq('antecipacao = 6400 x 4% = 256', r2(o.custoAntecipacao), 256);
    eq('comissao = 9500 x 1,8% = 171', r2(o.custoComissao), 171);
    eq('liquida = 1500 - 256 - 171', r2(o.lucroLiquido), 1073);
}

console.log(`\n${pass} ok, ${fail} falhas`);
if (fail > 0) process.exit(1);
