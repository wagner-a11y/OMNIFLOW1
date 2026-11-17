// =====================================================================
// BID EM LOTE — HISTÓRICO POR NOME E POR RODADA
//
// Roda: npx tsx --import ./scripts/testing/registerStub.mjs utils/bidHistorico.test.mjs
//
// O repositório é o de MEMÓRIA (utils/bidHistoricoMemoria.ts), com as mesmas
// regras que o banco garante. As regras NO BANCO são provadas à parte, pela
// simulação de RLS (bid_historico_rls_simulacao.sql). O Qualp é um stub que
// conta chamadas: nenhuma consulta paga.
//
// A tela é provada renderizando o componente REAL (react-dom/server): rodada
// fechada sem campo editável, sem importar e com os números salvos.
// =====================================================================
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    prepararLinha, processarLoteBid, reaplicarLote, planejarLote, extrairCacheDeRotas,
    montarPlanilhaBid, COLUNAS_ABERTURA,
} from './bidLote.ts';
import {
    SalvadorRodada, montarRegistros, cacheDasEntradas, assinaturaRegistro, diferencaRegistros, precoPorChave,
    textoCopiaColuna, formatarValorCopia, validarNomeBid, classificarErro, nomeArquivoRodada, jsonCanonico,
    parametrosTelaPadrao, variacaoPercentual, confirmacaoExclusaoOk,
} from './bidHistorico.ts';
import { RepositorioBidMemoria } from './bidHistoricoMemoria.ts';
import { BidLote } from '../components/BidLote.tsx';
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

const GOLDEN = JSON.parse(readFileSync(new URL('../scripts/testing/fixtures/golden-bid-ajustes.json', import.meta.url), 'utf-8'));
const P = { ...GOLDEN.bid.params, seguroModo: 'ad_valorem', seguroPct: null, icmsIncluso: true, adicionalPisoPadraoPct: 0 };

// Planilha de 6 linhas; rotas que o stub conhece (com data da consulta).
const BRUTAS = [
    { linhaExcel: 2, origem: 'São Paulo, SP', destino: 'Rio de Janeiro, RJ', veiculoPlanilha: 'Carreta' },
    { linhaExcel: 3, origem: 'Campinas, SP', destino: 'Belo Horizonte, MG', veiculoPlanilha: 'Truck' },
    { linhaExcel: 4, origem: 'São Paulo, SP', destino: 'Salvador, BA', veiculoPlanilha: '' },
    { linhaExcel: 5, origem: 'São Paulo, SP', destino: 'Rio de Janeiro, RJ', veiculoPlanilha: 'Carreta' },
    { linhaExcel: 6, origem: 'Vitória, ES', destino: 'Serra, ES', veiculoPlanilha: 'Carreta' },
    { linhaExcel: 7, origem: '', destino: 'Santos, SP', veiculoPlanilha: 'Carreta' },
];
const ROTAS = {
    'São Paulo, SP>Rio de Janeiro, RJ': { km: 430.5, pedagioCheio: 182.4, pisoAntt: 3120.55, consultadoEm: '2026-11-16T14:00:00.000Z' },
    'Campinas, SP>Belo Horizonte, MG': { km: 587.2, pedagioCheio: 240.1, pisoAntt: 4015.9, consultadoEm: '2026-11-16T14:00:00.000Z' },
    'São Paulo, SP>Salvador, BA': { km: 1962.3, pedagioCheio: 310.75, pisoAntt: 9840.2, consultadoEm: '2026-11-16T14:00:00.000Z' },
    'Vitória, ES>Serra, ES': { km: 28, pedagioCheio: 0, pisoAntt: 700, consultadoEm: '2026-11-16T14:00:00.000Z' },
};
const fazStub = () => {
    const chamadas = [];
    return {
        chamadas,
        consultarRota: async (o, d) => {
            chamadas.push(`${o}>${d}`);
            const r = ROTAS[`${o}>${d}`];
            return r ? { ok: true, rota: r } : { ok: false, mensagem: 'desconhecida' };
        },
    };
};
const TELA = { ...parametrosTelaPadrao('Carga geral'), nomeArquivo: 'rotas.xlsx', abaUsada: 'Plan1' };
const parametrosRodada = (p) => ({ tela: TELA, calculo: p });

const ANA = { id: 'u-ana', nome: 'Ana', master: false };
const BETO = { id: 'u-beto', nome: 'Beto', master: false };
const MARIA = { id: 'u-maria', nome: 'Maria', master: true };

/** O que a tela faz ao abrir uma rodada salva: rotas salvas viram cache, e recalcula. */
const reabrirNaTela = (registros, p) => {
    const brutas = registros.map(r => r.entrada.bruta);
    const adicional = Object.fromEntries(registros.filter(r => r.entrada.adicionalPct != null).map(r => [r.entrada.bruta.linhaExcel, r.entrada.adicionalPct]));
    const valor = Object.fromEntries(registros.filter(r => r.entrada.valorMercadoria != null).map(r => [r.entrada.bruta.linhaExcel, r.entrada.valorMercadoria]));
    const pp = { ...p, adicionalPorLinha: adicional, valorMercadoriaPorLinha: valor };
    const lote = reaplicarLote(brutas, pp, cacheDasEntradas(registros, pp));
    return montarRegistros(brutas, lote.linhas, adicional, valor);
};

const esperar = () => new Promise(r => setTimeout(r, 0));

console.log('\n--- 1. CRIAR, IMPORTAR, EDITAR, RECARREGAR: TUDO VOLTA IGUAL ---');
const repo = new RepositorioBidMemoria(ANA, { [BETO.id]: BETO.nome, [MARIA.id]: MARIA.nome });
const { bidId, rodadaId: rod1 } = await repo.criarBid('Bid Suzano 2027', 'Suzano', 'Concorrência anual');
let registrosR1;
{
    const stub = fazStub();
    const lote = await processarLoteBid(BRUTAS, P, { consultarRota: stub.consultarRota, concorrencia: 2 });
    eq('importar: 4 rotas distintas consultadas (dedup na repetida)', stub.chamadas.length, 4);
    // Edição: adicional próprio de 10% na linha 3 e NF editada na linha 2.
    const adicional = { 3: 10 };
    const valor = { 2: 500000 };
    const pEditado = { ...P, adicionalPorLinha: adicional, valorMercadoriaPorLinha: valor };
    const recalculado = reaplicarLote(BRUTAS, pEditado, extrairCacheDeRotas(lote.linhas));
    registrosR1 = montarRegistros(BRUTAS, recalculado.linhas, adicional, valor);

    const carregada = await repo.carregarRodada(rod1);
    const situacoes = [];
    const s = new SalvadorRodada(repo, rod1, carregada.rodada.versao, carregada.registros, carregada.rodada.parametros, x => situacoes.push(x.estado));
    eq('há algo a gravar', s.atualizar(registrosR1, parametrosRodada(pEditado), 1), true);
    await s.salvar();
    eq('estado depois de gravar', s.situacao.estado, 'salvo');
    eq('passou por "salvando"', situacoes.includes('salvando'), true);
    ok('"Salvo às HH:MM" tem hora', s.situacao.ultimoSalvoEm instanceof Date);

    // "Recarregar a página": lê do repositório e reconstrói pela tela.
    const de_novo = await repo.carregarRodada(rod1);
    eq('linhas salvas', de_novo.registros.length, 6);
    eq('parâmetros da tela voltam iguais', jsonCanonico(de_novo.rodada.parametros.tela), jsonCanonico(TELA));
    const reconstruidos = reabrirNaTela(de_novo.registros, P);
    eq('recalculado ao reabrir = salvo (assinatura de todas as linhas)', reconstruidos.map(assinaturaRegistro), de_novo.registros.map(assinaturaRegistro));
    eq('nada a gravar depois de recarregar', diferencaRegistros(reconstruidos, new Map(de_novo.registros.map(r => [r.chave, assinaturaRegistro(r)])).set('x', 'y')).alteradas.length, 0);
    const l3 = reconstruidos.find(r => r.chave === 'linha-3').resultado;
    eq('edição do adicional (10% na linha 3) voltou', [l3.adicionalPisoPct, l3.adicionalProprio], [10, true]);
    eq('NF editada (linha 2) voltou', reconstruidos.find(r => r.chave === 'linha-2').resultado.valorMercadoriaEfetivo, 500000);
    eq('rota com a data da consulta voltou', reconstruidos.find(r => r.chave === 'linha-2').entrada.rota.consultadoEm, '2026-11-16T14:00:00.000Z');

    // Só as linhas alteradas vão na próxima gravação.
    const antes = repo.gravacoes;
    const pMais = { ...pEditado, adicionalPorLinha: { 3: 10, 4: 20 } };
    const mais = montarRegistros(BRUTAS, reaplicarLote(BRUTAS, pMais, cacheDasEntradas(registrosR1, pMais)).linhas, pMais.adicionalPorLinha, valor);
    const d = diferencaRegistros(mais, new Map(registrosR1.map(r => [r.chave, assinaturaRegistro(r)])));
    eq('editar a linha 4: só ela vai para o banco', d.alteradas.map(r => r.chave), ['linha-4']);
    s.atualizar(mais, parametrosRodada(pMais), 1);
    await s.salvar();
    eq('uma gravação a mais', repo.gravacoes - antes, 1);
    registrosR1 = mais;
}

console.log('\n--- REMOVER LINHA E REIMPORTAR (rascunho) ---');
{
    const c = await repo.carregarRodada(rod1);
    const s = new SalvadorRodada(repo, rod1, c.rodada.versao, c.registros, c.rodada.parametros);
    const semLinha7 = registrosR1.filter(r => r.chave !== 'linha-7');
    s.atualizar(semLinha7, parametrosRodada(P), 0);
    await s.salvar();
    const depois = await repo.carregarRodada(rod1);
    eq('linha 7 removida do banco', depois.registros.map(r => r.chave), ['linha-2', 'linha-3', 'linha-4', 'linha-5', 'linha-6']);

    // Reimportar: planilha nova com 3 linhas, troca TUDO (geração nova).
    const novas = BRUTAS.slice(0, 3);
    const stub = fazStub();
    const lote = await processarLoteBid(novas, P, { consultarRota: stub.consultarRota, rotasEmCache: cacheDasEntradas(depois.registros, P) });
    eq('reimportar com rotas já pagas: zero consulta', stub.chamadas.length, 0);
    const reg = montarRegistros(novas, lote.linhas, {}, {});
    s.atualizar(reg, parametrosRodada(P), 1);
    await s.salvar();
    const re = await repo.carregarRodada(rod1);
    eq('reimportar: rodada com as 3 linhas da planilha nova', re.registros.map(r => r.chave), ['linha-2', 'linha-3', 'linha-4']);
    // Volta às 6 para o resto do teste.
    s.atualizar(registrosR1, parametrosRodada(P), 2);
    await s.salvar();
    eq('e reimportar de novo (6 linhas)', (await repo.carregarRodada(rod1)).registros.length, 6);
}

console.log('\n--- 2. FECHAR RODADA: BLOQUEADA NA TELA E RECUSADA NO REPOSITÓRIO ---');
let r1Fechada;
{
    const c = await repo.carregarRodada(rod1);
    const r = await repo.mudarStatus(rod1, c.rodada.versao, 'fechada');
    eq('fechar', r.ok, true);
    r1Fechada = await repo.carregarRodada(rod1);
    eq('status fechada', r1Fechada.rodada.status, 'fechada');

    let erro = null;
    try { await repo.salvarRodada(rod1, r1Fechada.rodada.versao, null, r1Fechada.registros.slice(0, 1), []); } catch (e) { erro = e; }
    eq('editar linha de rodada fechada: recusado', classificarErro(erro).tipo, 'fechada');
    erro = null;
    try { await repo.salvarRodada(rod1, r1Fechada.rodada.versao, null, [], ['linha-2']); } catch (e) { erro = e; }
    eq('remover linha de rodada fechada: recusado', classificarErro(erro).tipo, 'fechada');
    erro = null;
    try { await repo.substituirLinhas(rod1, r1Fechada.rodada.versao, null, []); } catch (e) { erro = e; }
    eq('reimportar em rodada fechada: recusado', classificarErro(erro).tipo, 'fechada');
    erro = null;
    try { await repo.mudarStatus(rod1, r1Fechada.rodada.versao, 'rascunho'); } catch (e) { erro = e; }
    eq('operador reabre: recusado (só master)', classificarErro(erro).tipo, 'so_master');

    // Na TELA: o componente real, renderizado.
    const html = renderToStaticMarkup(React.createElement(BidLote, {
        fedTaxes: { ...P.fedTaxes, icmsRates: {}, commissionPercent: 1 },
        vehicleConfigs: { Carreta: { fixed: 0, variable: 0, axles: 6, calcMode: 'ANTT' }, Truck: { fixed: 0, variable: 0, axles: 3, calcMode: 'ANTT' } },
        tiposDeCarga: ['Carga geral'],
        inicial: { tela: r1Fechada.rodada.parametros.tela, registros: r1Fechada.registros },
        somenteLeitura: true,
        onExportar: () => {},
        telaCheia: false,
        onTelaCheia: () => {},
    }));
    ok('tela fechada: parâmetros num fieldset desabilitado', /<fieldset[^>]*disabled/.test(html));
    ok('tela fechada: sem "Importar/Reimportar planilha"', !/(Importar|Reimportar) planilha/.test(html));
    ok('tela fechada: sem "Reconsultar rotas"', !html.includes('Reconsultar rotas'));
    ok('tela fechada: nenhuma célula editável na tabela', !/<td[^>]*>[^<]*<input/.test(html) && !html.includes('inputMode="decimal" value=""'));
    ok('tela fechada: sem botão de remover linha', !html.includes('Remover esta linha'));
}

console.log('\n--- 3. RODADA FECHADA: MESMOS NÚMEROS MESMO COM AS CONFIGURAÇÕES ALTERADAS ---');
{
    const salvo = r1Fechada.registros.find(r => r.chave === 'linha-2').resultado.precoOfertado;
    // Configurações mudam: taxa da apólice e PIS sobem.
    const fedNovo = { ...P.fedTaxes, insurancePolicyRate: 0.5, pis: 3 };
    const recalculado = reaplicarLote(r1Fechada.registros.map(r => r.entrada.bruta), { ...P, fedTaxes: fedNovo, valorMercadoriaPorLinha: { 2: 500000 } },
        cacheDasEntradas(r1Fechada.registros, P)).linhas.find(l => l.linhaExcel === 2);
    ok(`recalcular daria outro número (custo/margem mudam: ${recalculado.margemLiquidaRS.toFixed(2)} ≠ ${r1Fechada.registros.find(r => r.chave === 'linha-2').resultado.margemLiquidaRS.toFixed(2)})`,
        recalculado.margemLiquidaRS !== r1Fechada.registros.find(r => r.chave === 'linha-2').resultado.margemLiquidaRS);
    const html = renderToStaticMarkup(React.createElement(BidLote, {
        fedTaxes: { ...fedNovo, icmsRates: {}, commissionPercent: 7 },
        vehicleConfigs: { Carreta: { fixed: 0, variable: 0, axles: 6, calcMode: 'ANTT' }, Truck: { fixed: 0, variable: 0, axles: 3, calcMode: 'ANTT' } },
        tiposDeCarga: ['Carga geral'],
        inicial: { tela: r1Fechada.rodada.parametros.tela, registros: r1Fechada.registros },
        somenteLeitura: true, onExportar: () => {}, telaCheia: false, onTelaCheia: () => {},
    }));
    const fmt = v => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const liqSalva = r1Fechada.registros.find(r => r.chave === 'linha-2').resultado.margemLiquidaRS;
    ok(`tela mostra o preço SALVO (${fmt(salvo)})`, html.includes(fmt(salvo)));
    ok(`tela mostra a margem SALVA (${fmt(liqSalva)}), não a recalculada (${fmt(recalculado.margemLiquidaRS)})`,
        html.includes(fmt(liqSalva)) && !html.includes(fmt(recalculado.margemLiquidaRS)));
    eq('parâmetros de cálculo da época ficaram salvos (apólice)', r1Fechada.rodada.parametros.calculo.fedTaxes.insurancePolicyRate, P.fedTaxes.insurancePolicyRate);
}

console.log('\n--- 4. NOVA RODADA: CÓPIA FIEL, ZERO QUALP, COMPARAÇÃO PREENCHIDA ---');
let rod2;
{
    const r = await repo.novaRodada(bidId);
    rod2 = r.rodadaId;
    eq('número', r.numero, 2);
    const c2 = await repo.carregarRodada(rod2);
    eq('cópia fiel das linhas (entrada e resultado)', c2.registros.map(assinaturaRegistro), r1Fechada.registros.map(assinaturaRegistro));
    eq('cópia fiel dos parâmetros', jsonCanonico(c2.rodada.parametros), jsonCanonico(r1Fechada.rodada.parametros));
    eq('rodada 2 nasce em rascunho', c2.rodada.status, 'rascunho');

    const stub = fazStub();
    const brutas = c2.registros.map(x => x.entrada.bruta);
    const cache = cacheDasEntradas(c2.registros, P);
    eq('plano de consulta: zero rota a pagar', planejarLote(brutas, P, cache).rotasDistintas, 0);
    await processarLoteBid(brutas, P, { consultarRota: stub.consultarRota, rotasEmCache: cache });
    eq('chamadas ao Qualp ao abrir a rodada 2', stub.chamadas.length, 0);

    const anterior = precoPorChave(c2.anterior);
    const comPreco = c2.registros.filter(x => x.resultado?.status === 'ok');
    ok('"Preço rodada anterior" preenchido em toda linha com preço', comPreco.every(x => anterior[x.chave] != null));
    // Margem de 15% -> 20% na rodada 2: preço sobe, variação positiva.
    const p20 = { ...P, profitMargin: 20, valorMercadoriaPorLinha: { 2: 500000 }, adicionalPorLinha: { 3: 10, 4: 20 } };
    const l2 = reaplicarLote(brutas, p20, cache).linhas.find(l => l.linhaExcel === 2);
    const v = variacaoPercentual(l2.precoOfertado, anterior['linha-2']);
    ok(`variação % da linha 2 com margem 15% -> 20% (${v.toFixed(2)}%) > 0`, v > 0);

    // Excel da rodada 2: as duas colunas a mais, depois do preço ofertado.
    const linhas = c2.registros.map(x => x.resultado);
    const aoa = montarPlanilhaBid(linhas, P, new Date(), {
        cabecalho: [['Bid', 'Bid Suzano 2027'], ['Cliente', 'Suzano'], ['Rodada', '2'], ['Status', 'Rascunho']],
        precoAnterior: Object.fromEntries(linhas.map(l => [l.linhaExcel, anterior[`linha-${l.linhaExcel}`]])),
    });
    eq('cabeçalho do Excel: nome do bid, cliente, rodada e status', aoa.slice(0, 4), [['Bid', 'Bid Suzano 2027'], ['Cliente', 'Suzano'], ['Rodada', '2'], ['Status', 'Rascunho']]);
    const cab = aoa.find(r => r[0] === 'Linha');
    const i = cab.indexOf('Preço ofertado R$');
    eq('comparação logo depois do preço ofertado', cab.slice(i, i + 3), ['Preço ofertado R$', 'Preço rodada anterior R$', 'Variação %']);
    eq('nome do arquivo', nomeArquivoRodada('Bid Suzano 2027', 2), 'bid-suzano-2027_rodada-2.xlsx');
}

console.log('\n--- EXCEL: COLUNAS SEPARADAS E NA MESMA ORDEM DE ANTES ---');
{
    const linhas = r1Fechada.registros.map(x => x.resultado);
    const aoa = montarPlanilhaBid(linhas, P, new Date());
    const cab = aoa.find(r => r[0] === 'Linha');
    eq('sem rodada anterior: cabeçalho idêntico ao de antes', cab, ['Linha', ...COLUNAS_ABERTURA.map(c => c.titulo), 'Adicional próprio', 'Status', 'Rota', 'Observações']);
    ok('pares % e R$ continuam SEPARADOS no Excel', ['Ad valorem cobrado %', 'Ad valorem cobrado R$', 'Custo seguro %', 'Custo seguro R$', 'Comissão %', 'Comissão R$'].every(t => cab.includes(t)));
    ok('UF continua em coluna própria no Excel', cab.includes('UF origem') && cab.includes('UF destino'));
    eq('sem cabeçalho de bid, a 1ª linha é a de sempre', aoa[0], ['Parâmetros da rodada']);
}

console.log('\n--- 5. NOME DUPLICADO: RECUSADO ---');
{
    eq('validação na tela (maiúsculas e espaços)', validarNomeBid('  BID SUZANO 2027 ', ['Bid Suzano 2027']), 'Já existe um bid com esse nome.');
    eq('nome vazio', validarNomeBid('  ', []), 'O nome é obrigatório.');
    let erro = null;
    try { await repo.criarBid('bid suzano 2027', '', ''); } catch (e) { erro = e; }
    eq('repositório recusa (23505)', classificarErro(erro), { tipo: 'duplicado', mensagem: 'Já existe um bid com esse nome.' });
}

console.log('\n--- 6. CONFLITO DE EDIÇÃO: NÃO SOBRESCREVE ---');
{
    const c = await repo.carregarRodada(rod2);
    // Ana e Beto abrem a mesma rodada.
    const sAna = new SalvadorRodada(repo, rod2, c.rodada.versao, c.registros, c.rodada.parametros);
    const sBeto = new SalvadorRodada(repo, rod2, c.rodada.versao, c.registros, c.rodada.parametros);
    const pAna = { ...P, profitMargin: 18 };
    const regAna = reabrirNaTela(c.registros, pAna);
    repo.comoUsuario(ANA);
    sAna.atualizar(regAna, { tela: { ...TELA, profitMargin: '18' }, calculo: pAna }, 0);
    await sAna.salvar();
    eq('Ana grava', sAna.situacao.estado, 'salvo');

    repo.comoUsuario(BETO);
    const pBeto = { ...P, profitMargin: 25 };
    sBeto.atualizar(reabrirNaTela(c.registros, pBeto), { tela: { ...TELA, profitMargin: '25' }, calculo: pBeto }, 0);
    await sBeto.salvar();
    eq('Beto: conflito', sBeto.situacao.estado, 'conflito');
    eq('avisa quem alterou', sBeto.situacao.conflito.atualizadoPorNome, 'Ana');
    ok('e quando', !!sBeto.situacao.conflito.atualizadoEm);
    const depois = await repo.carregarRodada(rod2);
    eq('o banco ficou com a gravação da Ana', depois.rodada.parametros.tela.profitMargin, '18');
    // Em conflito, nenhuma gravação sai até recarregar.
    const g = repo.gravacoes;
    await sBeto.salvar();
    eq('nova tentativa de Beto não grava nada', repo.gravacoes, g);
}

console.log('\n--- 7. FALHA DE GRAVAÇÃO: TELA MANTÉM OS DADOS, "NÃO SALVO" ---');
{
    repo.comoUsuario(ANA);
    const c = await repo.carregarRodada(rod2);
    const s = new SalvadorRodada(repo, rod2, c.rodada.versao, c.registros, c.rodada.parametros);
    const pNovo = { ...P, profitMargin: 22 };
    const naTela = reabrirNaTela(c.registros, pNovo);
    const copiaDaTela = JSON.stringify(naTela);
    s.atualizar(naTela, { tela: { ...TELA, profitMargin: '22' }, calculo: pNovo }, 0);

    repo.falharProxima({ code: '42501', message: 'new row violates row-level security policy for table "bid_rodada"' });
    await s.salvar();
    eq('sessão expirada: estado "erro" (Não salvo)', s.situacao.estado, 'erro');
    eq('mensagem clara', s.situacao.erro.mensagem, 'Sua sessão expirou. Entre de novo para salvar.');
    eq('o que está na tela não foi tocado', JSON.stringify(naTela), copiaDaTela);
    ok('continua com alteração pendente', s.temAlteracoes());

    repo.falharProxima(new TypeError('Failed to fetch'));
    await s.salvar();
    eq('sem rede: mensagem', s.situacao.erro.mensagem, 'Sem conexão com o banco. Nada foi perdido na tela.');

    await s.salvar();   // "Tentar de novo"
    eq('tentar de novo: salvo', s.situacao.estado, 'salvo');
    eq('e o banco tem a margem nova', (await repo.carregarRodada(rod2)).rodada.parametros.tela.profitMargin, '22');
}

console.log('\n--- REABRIR: SÓ MASTER E SÓ A ÚLTIMA ---');
{
    repo.comoUsuario(ANA);
    let c = await repo.carregarRodada(rod2);
    await repo.mudarStatus(rod2, c.rodada.versao, 'fechada');
    repo.comoUsuario(MARIA);
    const c1 = await repo.carregarRodada(rod1);
    let erro = null;
    try { await repo.mudarStatus(rod1, c1.rodada.versao, 'rascunho'); } catch (e) { erro = e; }
    eq('master reabre a rodada 1 (existe a 2): recusado', classificarErro(erro).tipo, 'rodada_antiga');
    c = await repo.carregarRodada(rod2);
    eq('master reabre a última', (await repo.mudarStatus(rod2, c.rodada.versao, 'rascunho')).ok, true);
    eq('nova rodada com a última em rascunho: recusada', await repo.novaRodada(bidId).then(() => 'criou', e => classificarErro(e).tipo), 'rodada_aberta');
}

console.log('\n--- EXCLUIR BID (só master, lógica) ---');
{
    eq('confirmação: nome exato', confirmacaoExclusaoOk(' Bid Suzano 2027 ', 'Bid Suzano 2027'), true);
    eq('confirmação: nome diferente não libera', confirmacaoExclusaoOk('bid suzano', 'Bid Suzano 2027'), false);
    eq('confirmação: vazio não libera', confirmacaoExclusaoOk('', 'Bid Suzano 2027'), false);
    repo.comoUsuario(ANA);
    eq('operador não exclui', await repo.excluirBid(bidId).then(() => 'excluiu', e => classificarErro(e).tipo), 'so_master');
    ok('e o bid continua na lista', (await repo.listarBids()).some(b => b.id === bidId));
    repo.comoUsuario(MARIA);
    await repo.excluirBid(bidId);
    ok('master exclui: some da lista', !(await repo.listarBids()).some(b => b.id === bidId));
    const novo = await repo.criarBid('Bid Suzano 2027', 'Suzano', '');
    ok('e o nome fica livre para um bid novo', !!novo.bidId && novo.bidId !== bidId);
    ok('as rodadas do excluído continuam no repositório (exclusão lógica)', (await repo.carregarRodada(rod1)).registros.length > 0);
}

console.log('\n--- COPIAR VALOR DO FRETE ---');
{
    const linhas = r1Fechada.registros.map(x => x.resultado);
    // A tela ordena com problema no topo: ordem diferente da planilha.
    const naTela = [...linhas].sort((a, b) => (a.status === 'ok') - (b.status === 'ok') || b.linhaExcel - a.linhaExcel);
    ok('a tela está em outra ordem', naTela.map(l => l.linhaExcel).join() !== '2,3,4,5,6,7');
    const r = textoCopiaColuna(naTela, l => l.precoOfertado);
    const partes = r.texto.split('\n');
    eq('quantidade = linhas da planilha importada', [r.quantidade, partes.length], [6, 6]);
    eq('ordem da planilha: linha 2 primeiro', partes[0], formatarValorCopia(linhas.find(l => l.linhaExcel === 2).precoOfertado));
    eq('linha sem preço sai em branco (linha 7, sem origem)', partes[5], '');
    eq('formato: vírgula, 2 casas, sem R$ e sem milhar', formatarValorCopia(5501.3449), '5501,34');
    eq('formato de 12.345,6', formatarValorCopia(12345.6), '12345,60');
    ok('nenhum "R$" nem ponto', !r.texto.includes('R$') && !r.texto.includes('.'));
}

console.log('\n--- 8. REGRESSÃO DA CALCULADORA ---');
{
    let iguais = 0;
    for (const { entrada, saida } of GOLDEN.motor) if (JSON.stringify(calcularPreco(entrada)) === JSON.stringify(saida)) iguais++;
    eq(`${GOLDEN.motor.length} de ${GOLDEN.motor.length} idênticas`, iguais, GOLDEN.motor.length);
}

await esperar();
console.log(`\n${pass} ok, ${fail} falhas`);
if (fail > 0) process.exit(1);
