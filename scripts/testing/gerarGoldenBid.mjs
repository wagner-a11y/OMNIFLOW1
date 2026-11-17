// Gera os números de REFERÊNCIA (antes do pacote de ajustes de custo) do motor
// e do bid. Rodado UMA vez sobre a main (e757e08); a saída fica congelada em
// fixtures/golden-bid-ajustes.json e é o "antes" da regressão.
// Roda: npx tsx scripts/testing/gerarGoldenBid.mjs > scripts/testing/fixtures/golden-bid-ajustes.json
import { calcularPreco } from '../../utils/motorPreco.ts';
import { prepararLinha, calcularLinhaBid } from '../../utils/bidLote.ts';

const TRIB = { pis: 0.65, cofins: 3.0, csll: 1.08, irpj: 1.2, insurancePolicyRate: 0.035 };
const OUTROS = [{ id: '1', description: 'Escolta', value: 350 }];

// Entradas da CALCULADORA: os dois modos, com e sem seguro/ICMS/extras.
const entradasMotor = [];
for (const modoTabelado of [false, true])
for (const icmsPercent of [0, 7, 12, 18])
for (const [goodsValue, insurancePercent] of [[0, 0], [250000, 0.2], [500000, 0.1]])
for (const [extraCosts, otherCosts] of [[0, []], [120.5, OUTROS]])
for (const profitMargin of [0, 15, 32.5])
    entradasMotor.push({
        baseFreight: 3120.55, tolls: 182.4, extraCosts, otherCosts, goodsValue, insurancePercent,
        profitMargin, icmsPercent, fedTaxes: TRIB, modoTabelado, valorFinalTabelado: 6800,
    });

const PARAMS = {
    profitMargin: 15, fedTaxes: TRIB, icmsRates: {}, cargoType: 'Carga geral',
    veiculoPadrao: 'Carreta', veiculosCadastro: ['Carreta', 'Truck'], deParaVeiculo: {},
    eixosPorVeiculo: { Carreta: 6, Truck: 3 }, modoPorVeiculo: { Carreta: 'ANTT', Truck: 'ANTT' },
    jurosMensal: 1.5, prazoDias: 45, comissaoPercent: '', comissaoPadrao: 1,
};
const ROTAS = [
    { bruta: { linhaExcel: 2, origem: 'São Paulo, SP', destino: 'Rio de Janeiro, RJ', veiculoPlanilha: 'Carreta' }, rota: { km: 430.5, pedagioCheio: 182.4, pisoAntt: 3120.55 } },
    { bruta: { linhaExcel: 3, origem: 'Campinas, SP', destino: 'Belo Horizonte, MG', veiculoPlanilha: 'Truck' }, rota: { km: 587.2, pedagioCheio: 240.1, pisoAntt: 4015.9 } },
    { bruta: { linhaExcel: 4, origem: 'São Paulo, SP', destino: 'Salvador, BA', veiculoPlanilha: '' }, rota: { km: 1962.3, pedagioCheio: 310.75, pisoAntt: 9840.2 } },
    { bruta: { linhaExcel: 5, origem: 'Recife, PE', destino: 'Recife Antigo, PE', veiculoPlanilha: 'Carreta' }, rota: { km: 12, pedagioCheio: 0, pisoAntt: 600 } },
];
const CAMPOS = ['km', 'pedagio', 'pisoAntt', 'custoBase', 'icmsPercent', 'icmsRS', 'federaisRS', 'taxaAntecipacao',
    'precoSugerido', 'margemBrutaRS', 'margemBrutaPercent', 'custoAntecipacao', 'custoComissao',
    'margemLiquidaRS', 'margemLiquidaPercent', 'status'];
const linhasBid = [];
for (const margem of [0, 15, 25])
for (const { bruta, rota } of ROTAS) {
    const p = { ...PARAMS, profitMargin: margem };
    const l = calcularLinhaBid(prepararLinha(bruta, p), rota, p);
    linhasBid.push({ margem, bruta, rota, saida: Object.fromEntries(CAMPOS.map(c => [c, l[c]])) });
}

console.log(JSON.stringify({
    geradoEm: 'main e757e08',
    motor: entradasMotor.map(e => ({ entrada: e, saida: calcularPreco(e) })),
    bid: { params: PARAMS, linhas: linhasBid },
}, null, 1));
