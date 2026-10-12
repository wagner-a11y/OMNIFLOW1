// =====================================================================
// BID EM LOTE — Fase 1
//
// Roda: npx tsx utils/bidLote.test.mjs
//
// O consultor de rota é INJETADO (stub), não o Qualp real: o dedup, a
// concorrência e o tratamento de falha ficam provados de forma determinística
// e com ZERO consulta paga. O caminho de produção usa o mesmo
// `processarLoteBid`, só trocando o stub pelo `consultarRotaDoLote`.
//
// Amostra de 8 linhas cobrindo, de propósito: rota repetida (dedup), frete
// urbano, falha do Qualp, linha sem dado, linha sem veículo (cai no padrão) e
// veículo fora da tabela ANTT.
// =====================================================================
import {
    processarLoteBid, planejarLote, prepararLinha, resumirBid, chaveRota,
    calcularLinhaBid, recalcularLote, linhasParaExcel, rotuloStatus,
    normalizarVeiculo, resolverVeiculo, taxaAntecipacaoProporcional,
    TETO_ROTAS_DISTINTAS,
} from './bidLote.ts';
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
const cent = (n) => Math.round(n * 100) / 100;

const TRIB = { pis: 0.65, cofins: 3.0, csll: 1.08, irpj: 1.2, insurancePolicyRate: 0.035 };

const PARAMS = {
    profitMargin: 15,
    fedTaxes: TRIB,
    icmsRates: {},
    cargoType: 'Carga geral',
    veiculoPadrao: 'Carreta',
    veiculosCadastro: ['Carreta', 'Truck', 'Fiorino'],
    deParaVeiculo: {},
    eixosPorVeiculo: { Carreta: 6, Truck: 3, Fiorino: 2 },
    modoPorVeiculo: { Carreta: 'ANTT', Truck: 'ANTT', Fiorino: 'KM_ROUND_TRIP' },
    // Antecipacao por juros ao mes x prazo/30: 2,8% a.m. em 30 dias = 2,8%,
    // que mantem os numeros dos casos abaixo identicos aos da tabela antiga.
    jurosMensal: 2.8,
    prazoDias: 30,
    comissaoPercent: '2',
    comissaoPadrao: 0,
};

// Rotas que o stub conhece. Chave = "origem>destino".
const FIXTURES = {
    'São Paulo, SP>Rio de Janeiro, RJ': { km: 430.5, pedagioCheio: 182.4, pisoAntt: 3120.55 },
    'Campinas, SP>Belo Horizonte, MG': { km: 587.2, pedagioCheio: 240.1, pisoAntt: 4015.9 },
    'São Paulo, SP>Salvador, BA': { km: 1962.3, pedagioCheio: 310.75, pisoAntt: 9840.2 },
    'Recife, PE>Natal, RN': { km: 285.1, pedagioCheio: 0, pisoAntt: null },  // sem piso p/ a combinacao
};

/** Stub do Qualp: conta chamadas e registra a ordem/concorrência. */
const fazStub = () => {
    const chamadas = [];
    let emVoo = 0, picoEmVoo = 0;
    const consultarRota = async (origem, destino, veiculo, eixos, carga) => {
        chamadas.push({ origem, destino, veiculo, eixos, carga });
        emVoo++; picoEmVoo = Math.max(picoEmVoo, emVoo);
        await new Promise(r => setTimeout(r, 12));   // simula latência de rede
        emVoo--;
        if (destino.includes('Erro')) {
            return { ok: false, mensagem: 'QUALP_TIMEOUT_7000MS: o Qualp não respondeu.' };
        }
        const f = FIXTURES[`${origem}>${destino}`];
        if (!f) return { ok: false, mensagem: `rota desconhecida no stub: ${origem}>${destino}` };
        return { ok: true, rota: f };
    };
    return { consultarRota, chamadas, pico: () => picoEmVoo };
};

const linha = (n, origem, destino, veiculoPlanilha) => ({ linhaExcel: n, origem, destino, veiculoPlanilha });
const porLinhaCedo = (res, n) => res.linhas.find(l => l.linhaExcel === n);

// ---- A amostra: 8 linhas ----
const AMOSTRA = [
    linha(2, 'São Paulo, SP', 'Rio de Janeiro, RJ', 'Carreta'),       // rota A
    linha(3, 'São Paulo, SP', 'Rio de Janeiro, RJ', 'Carreta'),       // rota A REPETIDA -> dedup
    linha(4, 'Campinas, SP', 'Belo Horizonte, MG', 'Truck'),          // rota B
    linha(5, 'São Paulo, SP', 'SAO PAULO - SP', 'Carreta'),           // URBANO (mesmo municipio)
    linha(6, 'Curitiba, PR', 'Erro, SC', 'Carreta'),                  // FALHA do Qualp
    linha(7, '', 'Rio de Janeiro, RJ', 'Carreta'),                    // PENDENCIA: sem origem
    linha(8, 'São Paulo, SP', 'Salvador, BA', ''),                    // sem veiculo -> padrao
    linha(9, 'São Paulo, SP', 'Rio de Janeiro, RJ', 'Carreta'),       // rota A DE NOVO -> dedup
];

console.log('--- AMOSTRA DE 8 LINHAS (stub, zero consulta paga) ---');
const stub = fazStub();
const r = await processarLoteBid(AMOSTRA, PARAMS, { consultarRota: stub.consultarRota, concorrencia: 3 });

for (const l of r.linhas) {
    const marca = { qualp: 'QUALP', cache: 'cache', 'nao-consultada': '  —  ' }[l.fonteRota];
    console.log(`  L${String(l.linhaExcel).padEnd(2)} [${marca}] ${rotuloStatus(l).padEnd(16)} ${(l.origem || '(vazio)').padEnd(18)} -> ${(l.destino || '(vazio)').padEnd(22)} ${l.veiculo.padEnd(8)} preco=${l.precoSugerido == null ? '—' : cent(l.precoSugerido)} margLiq=${l.margemLiquidaPercent == null ? '—' : cent(l.margemLiquidaPercent) + '%'}`);
    if (l.pendencias.length) console.log(`        pendencia: ${l.pendencias.join(' | ')}`);
}

console.log('\n--- DEDUP ---');
eq('consultas ao Qualp', r.consultasQualp, 4);
eq('rotas distintas', r.rotasDistintas, 4);
eq('consultas poupadas pelo dedup', r.economizadas, 2);
eq('o stub recebeu exatamente 4 chamadas', stub.chamadas.length, 4);
{
    // A rota A aparece em 3 linhas (2, 3, 9) e foi consultada UMA vez.
    const vezesRotaA = stub.chamadas.filter(c => c.destino === 'Rio de Janeiro, RJ').length;
    eq('rota repetida 3x consultou 1x', vezesRotaA, 1);
    const linhasRotaA = r.linhas.filter(l => [2, 3, 9].includes(l.linhaExcel));
    eq('as 3 linhas da rota A tem o MESMO preco', [...new Set(linhasRotaA.map(l => cent(l.precoSugerido)))].length, 1);
    eq('so 1 das 3 gastou consulta', linhasRotaA.filter(l => l.fonteRota === 'qualp').length, 1);
    eq('as outras 2 vieram do cache do lote', linhasRotaA.filter(l => l.fonteRota === 'cache').length, 2);
}
eq('chave de dedup ignora caixa e espaco',
    chaveRota(' São Paulo, SP ', 'Rio de Janeiro, RJ', 6, 'Carga geral'),
    chaveRota('são paulo, sp', 'RIO DE JANEIRO, RJ', 6, 'carga geral'));
ok('urbano e pendencia NAO gastaram consulta', !stub.chamadas.some(c => c.destino.includes('SAO PAULO') || c.origem === ''));
// Nem urbano nem pendencia contam como "poupadas": elas nunca precisaram de
// consulta. Contar as duas como economia do dedup inflaria o numero que
// justifica o proprio dedup.
eq('urbano nao e contado como consulta poupada', porLinhaCedo(r, 5).fonteRota, 'nao-consultada');
eq('pendencia tambem nao', porLinhaCedo(r, 7).fonteRota, 'nao-consultada');

console.log('\n--- CONCORRENCIA ---');
ok(`nunca passou de 3 consultas em voo (pico: ${stub.pico()})`, stub.pico() <= 3, `pico foi ${stub.pico()}`);
{
    const s2 = fazStub();
    const muitas = Array.from({ length: 12 }, (_, i) => linha(i + 2, `Cidade ${i}, SP`, 'Erro, SC', 'Carreta'));
    const r2 = await processarLoteBid(muitas, PARAMS, { consultarRota: s2.consultarRota, concorrencia: 4 });
    ok(`12 rotas distintas, pico <= 4 (pico: ${s2.pico()})`, s2.pico() <= 4);
    eq('nenhuma linha derrubou o lote', r2.linhas.length, 12);
    eq('todas viraram status de falha', r2.linhas.filter(l => l.status === 'falha').length, 12);
}

console.log('\n--- STATUS: nada derruba o lote ---');
const porLinha = Object.fromEntries(r.linhas.map(l => [l.linhaExcel, l]));
eq('L5 (mesmo municipio) = urbano', porLinha[5].status, 'urbano');
eq('L6 (Qualp nao respondeu) = falha', porLinha[6].status, 'falha');
ok('L6 guarda a mensagem do Qualp', porLinha[6].pendencias.some(m => m.includes('QUALP_TIMEOUT')));
eq('L7 (sem origem) = pendencia', porLinha[7].status, 'pendencia');
ok('L7 diz o motivo', porLinha[7].pendencias.includes('Origem em branco'));
eq('as 8 linhas voltaram', r.linhas.length, 8);
eq('as 5 linhas com rota boa fecharam', r.linhas.filter(l => l.status === 'ok').length, 5);

console.log('\n--- VEICULO: linha vs padrao do bid ---');
eq('L8 sem veiculo caiu no padrao', porLinha[8].veiculo, 'Carreta');
eq('L8 marcada como padrao (nao da linha)', porLinha[8].veiculoDaLinha, false);
eq('L2 usou o veiculo da linha', porLinha[2].veiculoDaLinha, true);
eq('eixos resolvidos pelo cadastro (Truck = 3)', porLinha[4].eixos, 3);
{
    const semPadrao = prepararLinha(linha(2, 'A, SP', 'B, SP', ''), { ...PARAMS, veiculoPadrao: '' });
    eq('sem veiculo e sem padrao = pendencia', semPadrao.status, 'pendencia');
    ok('explica a falta do padrao', semPadrao.pendencias.some(m => m.includes('sem veículo padrão')));
}
{
    const fantasma = prepararLinha(linha(2, 'A, SP', 'B, RJ', 'Veiculo Fantasma'), PARAMS);
    eq('veiculo fora do cadastro = pendencia', fantasma.status, 'pendencia');
    eq('nao monta chave de Qualp p/ veiculo invalido', fantasma.chaveQualp, null);
    ok('e manda ligar no de-para', fantasma.pendencias.some(m => m.includes('de-para')));
}
{
    const utilitario = prepararLinha(linha(2, 'A, SP', 'B, RJ', 'Fiorino'), PARAMS);
    eq('veiculo fora da tabela ANTT = pendencia', utilitario.status, 'pendencia');
    ok('diz que esta fora do escopo da Fase 1', utilitario.pendencias.some(m => m.includes('fora do escopo da Fase 1')));
}

console.log('\n--- CALCULO: reusa o motor, nao reimplementa ---');
{
    const l = porLinha[2];
    const rota = FIXTURES['São Paulo, SP>Rio de Janeiro, RJ'];
    eq('custo base = piso + pedagio', cent(l.custoBase), cent(rota.pisoAntt + rota.pedagioCheio));
    eq('ICMS SP->RJ pela regra (destino RJ interestadual)', l.icmsPercent, 12);

    // Independente: chama o motor direto e confere que o lote nao fez conta propria.
    const esperado = calcularPreco({
        baseFreight: rota.pisoAntt, tolls: rota.pedagioCheio, extraCosts: 0, otherCosts: [],
        goodsValue: 0, insurancePercent: 0, profitMargin: 15, icmsPercent: 12,
        fedTaxes: TRIB, modoTabelado: false, valorFinalTabelado: 0,
    });
    eq('preco sugerido = motorPreco.finalFreight', cent(l.precoSugerido), cent(esperado.finalFreight));
    eq('margem bruta = motorPreco.realProfitAmount', cent(l.margemBrutaRS), cent(esperado.realProfitAmount));

    // Custos ocultos: antecipacao sobre o PAGO, comissao sobre a RECEITA.
    eq('antecipacao = piso x 2,8%', cent(l.custoAntecipacao), cent(rota.pisoAntt * 0.028));
    eq('comissao = preco x 2%', cent(l.custoComissao), cent(esperado.finalFreight * 0.02));
    eq('margem liquida = bruta - antecipacao - comissao',
        cent(l.margemLiquidaRS), cent(esperado.realProfitAmount - rota.pisoAntt * 0.028 - esperado.finalFreight * 0.02));
}
{
    // ICMS por UF da rota de verdade: SP->SP intraestadual = 12, PE->PE isento.
    const dentroSP = calcularLinhaBid(
        prepararLinha(linha(2, 'Campinas, SP', 'Santos, SP', 'Carreta'), PARAMS),
        { km: 180, pedagioCheio: 40, pisoAntt: 1500 }, PARAMS);
    eq('SP->SP = 12%', dentroSP.icmsPercent, 12);
    const dentroPE = calcularLinhaBid(
        prepararLinha(linha(2, 'Recife, PE', 'Caruaru, PE', 'Carreta'), PARAMS),
        { km: 130, pedagioCheio: 0, pisoAntt: 1200 }, PARAMS);
    eq('PE->PE isento = 0%', dentroPE.icmsPercent, 0);
    // Mesmo custo, duas rotas: a isenta precisa sair MAIS BARATA, porque o ICMS
    // entra por gross-up no preco.
    const mesmoCusto = { km: 130, pedagioCheio: 0, pisoAntt: 1200 };
    const comIcms12 = calcularLinhaBid(prepararLinha(linha(2, 'Curitiba, PR', 'Florianopolis, SC', 'Carreta'), PARAMS), mesmoCusto, PARAMS);
    eq('PR->SC = 12%', comIcms12.icmsPercent, 12);
    ok(`rota isenta sai mais barata (R$ ${cent(dentroPE.precoSugerido)} < R$ ${cent(comIcms12.precoSugerido)})`,
        dentroPE.precoSugerido < comIcms12.precoSugerido);
    // E o override do master vence a regra REGIONAL, nunca a regra 1 (mesmo
    // estado) -- comportamento documentado do getIcmsRate.
    const tentaSobrepor = calcularLinhaBid(prepararLinha(linha(2, 'Recife, PE', 'Caruaru, PE', 'Carreta'), PARAMS), mesmoCusto, { ...PARAMS, icmsRates: { 'PE-PE': 12 } });
    eq('override NAO vence a isencao intraestadual', tentaSobrepor.icmsPercent, 0);
    const overrideRegional = calcularLinhaBid(prepararLinha(linha(2, 'Curitiba, PR', 'Florianopolis, SC', 'Carreta'), PARAMS), mesmoCusto, { ...PARAMS, icmsRates: { 'PR-SC': 7 } });
    eq('mas vence a regra regional', overrideRegional.icmsPercent, 7);
}
{
    // Piso ausente: nao inventa base de custo.
    const semPiso = calcularLinhaBid(
        prepararLinha(linha(2, 'Recife, PE', 'Natal, RN', 'Carreta'), PARAMS),
        FIXTURES['Recife, PE>Natal, RN'], PARAMS);
    eq('Qualp sem piso = pendencia', semPiso.status, 'pendencia');
    eq('sem piso nao calcula preco', semPiso.precoSugerido, null);
    ok('mas preserva km e pedagio do Qualp', semPiso.km === 285.1 && semPiso.pedagio === 0);
}

console.log('\n--- TRAVA DE PISO (compliance) ---');
{
    const l = calcularLinhaBid(
        prepararLinha(linha(2, 'São Paulo, SP', 'Rio de Janeiro, RJ', 'Carreta'), PARAMS),
        { km: 430, pedagioCheio: 180, pisoAntt: 3000 }, PARAMS);
    eq('margem normal: nenhum alerta', l.alertas.length, 0);
    ok('e o preco fica ACIMA do piso', l.precoSugerido > 3000);

    // Margem negativa derruba o preco abaixo do piso -> o alerta tem que acender.
    const afundado = calcularLinhaBid(
        prepararLinha(linha(2, 'São Paulo, SP', 'Rio de Janeiro, RJ', 'Carreta'), PARAMS),
        { km: 430, pedagioCheio: 0, pisoAntt: 3000 }, { ...PARAMS, profitMargin: -20, icmsRates: {} });
    ok(`margem -20% afunda o preco (R$ ${cent(afundado.precoSugerido)}) abaixo do piso (R$ 3000)`, afundado.precoSugerido < 3000);
    ok('alerta de piso acendeu', afundado.alertas.some(a => a.includes('ABAIXO do piso ANTT')));
}

console.log('\n--- RESUMO ---');
{
    const res = resumirBid(r.linhas);
    eq('total', res.total, 8);
    eq('com preco', res.ok, 5);
    eq('pendencia', res.pendencia, 1);
    eq('urbano', res.urbano, 1);
    eq('falha', res.falha, 1);
    eq('os quatro status somam o total', res.ok + res.pendencia + res.urbano + res.falha, 8);
    ok('margem liquida media > 0', res.margemLiquidaMedia > 0);
    const somaManual = r.linhas.filter(l => l.status === 'ok').reduce((a, l) => a + l.precoSugerido, 0);
    eq('preco total soma so as linhas ok', cent(res.totalPrecoSugerido), cent(somaManual));
}

console.log('\n--- EXPORT ---');
{
    const rows = linhasParaExcel(r.linhas);
    eq('uma linha por linha do lote', rows.length, 8);
    const cols = Object.keys(rows[0]);
    ok('tem as colunas do resultado', ['Origem', 'Destino', 'Veículo', 'KM', 'Pedágio', 'Piso ANTT', 'Custo base (piso + pedágio)', 'Preço sugerido', 'Margem líquida %', 'Status'].every(c => cols.includes(c)), `colunas: ${cols.join(', ')}`);
    const urbana = rows.find(x => x['Linha'] === 5);
    eq('linha urbana sai com status legivel', urbana['Status'], 'Frete urbano');
    eq('e sem numero inventado', [urbana['Preço sugerido'], urbana['Piso ANTT']], ['', '']);
    ok('observacao carrega o motivo', String(rows.find(x => x['Linha'] === 6)['Observações']).includes('QUALP_TIMEOUT'));
}

console.log('\n--- PLANEJAMENTO: o custo ANTES de consultar ---');
{
    // O plano roda sem consultor nenhum: nao existe caminho pra consultar aqui.
    const plano = planejarLote(AMOSTRA, PARAMS);
    eq('8 linhas na planilha', plano.linhas.length, 8);
    eq('o numero da confirmacao e de ROTAS DISTINTAS, nao de linhas', plano.rotasDistintas, 4);
    ok('e e MENOR que o total de linhas (senao o dedup nao estaria contando)',
        plano.rotasDistintas < plano.linhas.length);
    eq('linhas que precisam de rota', plano.linhasComRota, 6);
    eq('economia prevista = comRota - distintas', plano.economiaPrevista, 2);
    eq('urbanas fora da conta', plano.urbanas, 1);
    eq('pendentes fora da conta', plano.pendentes, 1);
    ok('dentro do teto', !plano.acimaDoTeto);

    // O previsto tem que bater com o gasto: se divergir, a confirmacao mente.
    eq('previsto == gasto (rotas distintas)', plano.rotasDistintas, r.consultasQualp);
    eq('economia prevista == poupada de fato', plano.economiaPrevista, r.economizadas);
}
{
    // Caso que mais importa: muitas linhas, poucas rotas. A confirmacao nao
    // pode assustar o operador com o numero de linhas.
    const repetida = Array.from({ length: 60 }, (_, i) =>
        linha(i + 2, 'São Paulo, SP', 'Rio de Janeiro, RJ', 'Carreta'));
    const plano = planejarLote(repetida, PARAMS);
    eq('60 linhas da MESMA rota custam 1 consulta', plano.rotasDistintas, 1);
    eq('e o dedup poupa 59', plano.economiaPrevista, 59);
    const s3 = fazStub();
    const r3 = await processarLoteBid(repetida, PARAMS, { consultarRota: s3.consultarRota, concorrencia: 3 });
    eq('executado: 1 consulta de verdade', s3.chamadas.length, 1);
    eq('e as 60 linhas voltaram com preco', r3.linhas.filter(l => l.status === 'ok').length, 60);
}
{
    // Plano de planilha so com pendencia: custo zero, nada a confirmar.
    const soLixo = [linha(2, '', '', ''), linha(3, '', 'RJ', 'Carreta')];
    const plano = planejarLote(soLixo, { ...PARAMS, veiculoPadrao: '' });
    eq('custo zero', plano.rotasDistintas, 0);
    eq('nenhuma linha com rota', plano.linhasComRota, 0);
}

console.log('\n--- TETO DURO: acima do limite NAO consulta nada ---');
eq('o teto esta numa constante exportada', TETO_ROTAS_DISTINTAS, 100);
{
    // Exatamente no teto: passa.
    const noTeto = Array.from({ length: TETO_ROTAS_DISTINTAS }, (_, i) =>
        linha(i + 2, `Cidade ${i}, SP`, 'Rio de Janeiro, RJ', 'Carreta'));
    const plano = planejarLote(noTeto, PARAMS);
    eq(`${TETO_ROTAS_DISTINTAS} rotas distintas`, plano.rotasDistintas, TETO_ROTAS_DISTINTAS);
    ok('exatamente no teto NAO bloqueia', !plano.acimaDoTeto);
    const s4 = fazStub();
    const r4 = await processarLoteBid(noTeto, PARAMS, { consultarRota: s4.consultarRota, concorrencia: 4 });
    eq('rodou e consultou as 100', s4.chamadas.length, TETO_ROTAS_DISTINTAS);
    ok('nao veio bloqueado', !r4.bloqueado);
}
{
    // Uma rota acima do teto: bloqueia e NAO consulta nada.
    const acima = Array.from({ length: TETO_ROTAS_DISTINTAS + 1 }, (_, i) =>
        linha(i + 2, `Cidade ${i}, SP`, 'Rio de Janeiro, RJ', 'Carreta'));
    const plano = planejarLote(acima, PARAMS);
    eq(`${TETO_ROTAS_DISTINTAS + 1} rotas distintas`, plano.rotasDistintas, TETO_ROTAS_DISTINTAS + 1);
    ok('o plano marca acima do teto', plano.acimaDoTeto);

    const s5 = fazStub();
    const r5 = await processarLoteBid(acima, PARAMS, { consultarRota: s5.consultarRota, concorrencia: 4 });
    eq('ZERO consultas ao Qualp', s5.chamadas.length, 0);
    eq('consultasQualp reportado = 0', r5.consultasQualp, 0);
    ok('veio bloqueado', !!r5.bloqueado);
    eq('o bloqueio diz o numero e o teto', [r5.bloqueado.rotasDistintas, r5.bloqueado.teto], [TETO_ROTAS_DISTINTAS + 1, TETO_ROTAS_DISTINTAS]);
    ok('a mensagem manda dividir a planilha', r5.bloqueado.motivo.includes('Divida a planilha'));
    ok('e diz que nada foi consultado', r5.bloqueado.motivo.includes('nenhuma consulta foi feita'));
    eq('as linhas voltam preparadas (p/ o operador ver o que mandou)', r5.linhas.length, TETO_ROTAS_DISTINTAS + 1);
    eq('nenhuma linha tem preco', r5.linhas.filter(l => l.precoSugerido != null).length, 0);
}
{
    // MUITAS linhas mas poucas rotas distintas NAO pode ser bloqueado: o teto
    // e de rotas, nao de linhas.
    const muitasLinhasPoucasRotas = Array.from({ length: 500 }, (_, i) =>
        linha(i + 2, `Cidade ${i % 20}, SP`, 'Rio de Janeiro, RJ', 'Carreta'));
    const plano = planejarLote(muitasLinhasPoucasRotas, PARAMS);
    eq('500 linhas, 20 rotas distintas', plano.rotasDistintas, 20);
    ok('500 linhas NAO bloqueiam, porque o teto e de rotas', !plano.acimaDoTeto);
}
{
    // O teto conta rotas CONSULTAVEIS: urbanas e pendencias nao empurram o lote
    // pro bloqueio.
    const comRuido = [
        ...Array.from({ length: TETO_ROTAS_DISTINTAS }, (_, i) => linha(i + 2, `Cidade ${i}, SP`, 'Rio de Janeiro, RJ', 'Carreta')),
        linha(900, 'São Paulo, SP', 'SAO PAULO - SP', 'Carreta'),   // urbana
        linha(901, '', 'Rio de Janeiro, RJ', 'Carreta'),            // pendencia
        linha(902, 'A, SP', 'B, RJ', 'Fiorino'),                    // fora do ANTT
    ];
    const plano = planejarLote(comRuido, PARAMS);
    eq('103 linhas, 100 rotas consultaveis', plano.rotasDistintas, TETO_ROTAS_DISTINTAS);
    ok('ruido nao empurra pro bloqueio', !plano.acimaDoTeto);
}

console.log('\n--- TAXA DE ANTECIPACAO: juros x prazo/30 ---');
eq('1,5% a.m. em 45 dias = 2,25%', taxaAntecipacaoProporcional(1.5, 45), 2.25);
eq('1,5% a.m. em 30 dias = 1,5%', taxaAntecipacaoProporcional(1.5, 30), 1.5);
eq('1,5% a.m. em 15 dias = 0,75%', taxaAntecipacaoProporcional(1.5, 15), 0.75);
eq('1,5% a.m. em 60 dias = 3%', taxaAntecipacaoProporcional(1.5, 60), 3);
eq('prazo 0 (a vista) = 0%', taxaAntecipacaoProporcional(1.5, 0), 0);
eq('juros 0 = 0%', taxaAntecipacaoProporcional(0, 45), 0);
eq('juros 2% em 90 dias = 6%', taxaAntecipacaoProporcional(2, 90), 6);
{
    // A taxa tem que chegar na LINHA, sobre o valor PAGO ao terceiro.
    const p45 = { ...PARAMS, jurosMensal: 1.5, prazoDias: 45 };
    const l = calcularLinhaBid(prepararLinha(linha(2, 'São Paulo, SP', 'Rio de Janeiro, RJ', 'Carreta'), p45),
        { km: 430, pedagioCheio: 180, pisoAntt: 3000 }, p45);
    eq('a linha registra a taxa aplicada', l.taxaAntecipacao, 2.25);
    eq('antecipacao = 3000 (pago) x 2,25%', cent(l.custoAntecipacao), 67.5);
    ok('e a comissao continua sobre a receita', cent(l.custoComissao) === cent(l.precoSugerido * 0.02));
}

console.log('\n--- MOTOR VIVO: trocar parametro recalcula SEM consultar ---');
{
    const s6 = fazStub();
    const r6 = await processarLoteBid(AMOSTRA, PARAMS, { consultarRota: s6.consultarRota, concorrencia: 3 });
    const consultasDepoisDoLote = s6.chamadas.length;
    eq('o lote inicial consultou', consultasDepoisDoLote, 4);

    // Guardou a rota fixa por linha?
    const comRota = r6.linhas.filter(l => l.rota);
    eq('as 5 linhas com rota guardaram km/pedagio/piso em cache', comRota.length, 5);
    ok('e as UFs ficaram fixas na linha', r6.linhas.find(l => l.linhaExcel === 2).ufOrigem === 'SP'
        && r6.linhas.find(l => l.linhaExcel === 2).ufDestino === 'RJ');

    const antes = r6.linhas.find(l => l.linhaExcel === 2);

    // 1) MARGEM
    const comMargem30 = recalcularLote(r6.linhas, { ...PARAMS, profitMargin: 30 });
    const depois = comMargem30.find(l => l.linhaExcel === 2);
    eq('ZERO consultas novas ao trocar a margem', s6.chamadas.length, consultasDepoisDoLote);
    ok(`margem 15% -> 30% mudou o preco (${cent(antes.precoSugerido)} -> ${cent(depois.precoSugerido)})`,
        cent(depois.precoSugerido) !== cent(antes.precoSugerido));
    ok('e o preco SUBIU', depois.precoSugerido > antes.precoSugerido);
    eq('km nao mudou (vem do cache)', depois.km, antes.km);
    eq('pedagio nao mudou', depois.pedagio, antes.pedagio);
    eq('piso nao mudou', depois.pisoAntt, antes.pisoAntt);
    eq('custo base nao mudou', cent(depois.custoBase), cent(antes.custoBase));

    // 2) JUROS
    const comJuros = recalcularLote(r6.linhas, { ...PARAMS, jurosMensal: 1.5, prazoDias: 45 });
    const cj = comJuros.find(l => l.linhaExcel === 2);
    eq('ZERO consultas ao trocar juros/prazo', s6.chamadas.length, consultasDepoisDoLote);
    eq('a taxa virou 2,25%', cj.taxaAntecipacao, 2.25);
    ok('e a antecipacao mudou', cent(cj.custoAntecipacao) !== cent(antes.custoAntecipacao));
    eq('mas o PRECO ao cliente nao mudou (antecipacao e custo)', cent(cj.precoSugerido), cent(antes.precoSugerido));

    // 3) COMISSAO
    const comComissao = recalcularLote(r6.linhas, { ...PARAMS, comissaoPercent: '5' });
    const cc = comComissao.find(l => l.linhaExcel === 2);
    eq('ZERO consultas ao trocar comissao', s6.chamadas.length, consultasDepoisDoLote);
    ok('a comissao mudou', cent(cc.custoComissao) > cent(antes.custoComissao));
    ok('a margem liquida caiu', cc.margemLiquidaRS < antes.margemLiquidaRS);
    eq('o preco ao cliente seguiu igual', cent(cc.precoSugerido), cent(antes.precoSugerido));

    // 4) OVERRIDE DE ICMS
    const comIcms = recalcularLote(r6.linhas, { ...PARAMS, icmsRates: { 'SP-RJ': 4 } });
    const ci = comIcms.find(l => l.linhaExcel === 2);
    eq('ZERO consultas ao trocar o ICMS', s6.chamadas.length, consultasDepoisDoLote);
    eq('ICMS SP-RJ virou 4%', ci.icmsPercent, 4);
    ok('e o preco caiu (menos gross-up)', ci.precoSugerido < antes.precoSugerido);

    // 5) Idempotencia: recalcular N vezes nao empilha mensagem nem muda numero
    let acum = r6.linhas;
    for (let k = 0; k < 5; k++) acum = recalcularLote(acum, PARAMS);
    const re = acum.find(l => l.linhaExcel === 2);
    eq('5 recalculos seguidos dao o MESMO preco', cent(re.precoSugerido), cent(antes.precoSugerido));
    eq('e nao empilham alertas', re.alertas.length, antes.alertas.length);
    const falhaDepois = acum.find(l => l.linhaExcel === 6);
    eq('a linha de falha nao duplicou a mensagem', falhaDepois.pendencias.length, 1);
    eq('ZERO consultas em 5 recalculos', s6.chamadas.length, consultasDepoisDoLote);

    // 6) Linhas sem rota passam intactas
    const urbanaDepois = acum.find(l => l.linhaExcel === 5);
    eq('urbana segue urbana', urbanaDepois.status, 'urbano');
    eq('e sem preco inventado', urbanaDepois.precoSugerido, null);
}

console.log('\n--- VEICULO TOLERANTE ---');
eq('normaliza acento/caixa/espaco', normalizarVeiculo('  Carreta  LS '), normalizarVeiculo('carreta-ls'));
{
    const cadastro = ['Carreta Simples', 'Truck', 'Bitruck', 'Fiorino'];
    eq('match exato', resolverVeiculo('Truck', cadastro).como, 'exato');
    eq('acento/caixa', resolverVeiculo('TRUCK', cadastro).como, 'normalizado');
    eq('"Carreta" acha "Carreta Simples" por prefixo', resolverVeiculo('Carreta', cadastro).veiculo, 'Carreta Simples');
    eq('e marca como prefixo', resolverVeiculo('Carreta', cadastro).como, 'prefixo');
    // O caso que NAO pode chutar.
    const ambiguo = ['Carreta Simples', 'Carreta LS'];
    eq('dois candidatos = ambiguo', resolverVeiculo('Carreta', ambiguo).como, 'ambiguo');
    eq('e NAO escolhe nenhum', resolverVeiculo('Carreta', ambiguo).veiculo, '');
    eq('mas devolve os candidatos', resolverVeiculo('Carreta', ambiguo).candidatos.sort(), ['Carreta LS', 'Carreta Simples']);
    // De-para do operador vence o ambiguo.
    eq('de-para resolve o ambiguo', resolverVeiculo('Carreta', ambiguo, { Carreta: 'Carreta LS' }).veiculo, 'Carreta LS');
    eq('e marca como depara', resolverVeiculo('Carreta', ambiguo, { Carreta: 'Carreta LS' }).como, 'depara');
    eq('desconhecido de verdade', resolverVeiculo('Carroca', cadastro).como, 'desconhecido');
    eq('vazio cai no padrao', resolverVeiculo('', cadastro, {}, 'Truck').como, 'padrao');
}
{
    // O caso reportado: planilha diz "Carreta", cadastro tem "Carreta Simples".
    const P = { ...PARAMS, veiculosCadastro: ['Carreta Simples', 'Truck'], eixosPorVeiculo: { 'Carreta Simples': 6, Truck: 3 }, modoPorVeiculo: { 'Carreta Simples': 'ANTT', Truck: 'ANTT' }, veiculoPadrao: '' };
    const l = prepararLinha(linha(2, 'São Paulo, SP', 'Rio de Janeiro, RJ', 'Carreta'), P);
    eq('"Carreta" NAO e mais pendencia', l.status, 'ok');
    eq('resolveu p/ Carreta Simples', l.veiculo, 'Carreta Simples');
    eq('e pegou os eixos certos', l.eixos, 6);
    ok('e monta chave de Qualp', !!l.chaveQualp);
}
{
    // De-para aplicado no lote inteiro, por rotulo.
    const P = { ...PARAMS, veiculosCadastro: ['Carreta LS', 'Carreta Simples', 'Truck'], eixosPorVeiculo: { 'Carreta LS': 7, 'Carreta Simples': 6, Truck: 3 }, modoPorVeiculo: { 'Carreta LS': 'ANTT', 'Carreta Simples': 'ANTT', Truck: 'ANTT' }, veiculoPadrao: '' };
    const brutas = [linha(2, 'A, SP', 'B, RJ', 'Carreta'), linha(3, 'C, SP', 'D, RJ', 'Carreta')];
    const semDePara = brutas.map(b => prepararLinha(b, P));
    eq('ambiguo: as 2 linhas pendentes', semDePara.filter(l => l.status === 'pendencia').length, 2);
    const comDePara = brutas.map(b => prepararLinha(b, { ...P, deParaVeiculo: { Carreta: 'Carreta LS' } }));
    eq('um de-para resolve as 2', comDePara.filter(l => l.status === 'ok').length, 2);
    eq('com os eixos do escolhido', comDePara[0].eixos, 7);
}

console.log('\n--- NUMERO DA LINHA: __rowNum__ e nao a posicao no array ---');
{
    // Simula o que o sheet_to_json devolve quando a planilha tem uma linha
    // VAZIA na 3: a linha 4 vem na posicao 1 do array, com __rowNum__ = 3.
    const { montarLinhasBid } = await import('./bidLote.ts');
    const bruto = [
        { Origem: 'São Paulo, SP', Destino: 'Rio de Janeiro, RJ', Veiculo: 'Carreta', __rowNum__: 1 },
        { Origem: 'Curitiba, PR', Destino: 'Joinville, SC', Veiculo: 'Carreta', __rowNum__: 3 },
    ];
    const mapa = { origem: 'Origem', destino: 'Destino', veiculo: 'Veiculo' };
    const ls = montarLinhasBid(bruto, mapa);
    eq('1a linha = 2', ls[0].linhaExcel, 2);
    eq('2a linha = 4 (nao 3): a linha vazia nao desloca mais', ls[1].linhaExcel, 4);
    // Sem __rowNum__ (defensivo), cai na posicao.
    const semRowNum = montarLinhasBid([{ Origem: 'A', Destino: 'B', Veiculo: 'C' }], mapa);
    eq('sem __rowNum__ usa a posicao', semRowNum[0].linhaExcel, 2);
}

console.log('\n--- EXPORT: ICMS e federais vao pro Excel ---');
{
    const s7 = fazStub();
    const r7 = await processarLoteBid(AMOSTRA, PARAMS, { consultarRota: s7.consultarRota, concorrencia: 3 });
    const rows = linhasParaExcel(r7.linhas);
    const cols = Object.keys(rows[0]);
    ok('tem ICMS % e R$', cols.includes('ICMS %') && cols.includes('ICMS R$'), cols.join(', '));
    ok('tem Federais R$', cols.includes('Federais R$'));
    ok('tem a taxa de antecipacao', cols.includes('Taxa antecipação %'));
    ok('tem as UFs', cols.includes('UF origem') && cols.includes('UF destino'));
    const boa = rows.find(x => x['Linha'] === 2);
    ok('e os valores estao preenchidos na linha boa', boa['ICMS R$'] > 0 && boa['Federais R$'] > 0);
}

console.log('\n--- LOTE VAZIO ---');
{
    const vazio = await processarLoteBid([], PARAMS, { consultarRota: fazStub().consultarRota });
    eq('nao estoura', vazio.linhas.length, 0);
    eq('nenhuma consulta', vazio.consultasQualp, 0);
}

console.log(`\n${pass} ok, ${fail} falhas`);
if (fail > 0) process.exit(1);
