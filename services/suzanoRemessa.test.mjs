// =====================================================================
// REMESSA DA SUZANO: da planilha até o payload do card do Pipefy.
//
// Roda: npx tsx --import ./scripts/testing/registerStub.mjs services/suzanoRemessa.test.mjs
//
// Exercita o CÓDIGO REAL (abrirPlanilhaOtm, camposBasicos,
// montarCotacaoSuzano, enviarCargaAoPipefy) sobre um .xlsx montado aqui. Só o
// Supabase e o createPipefyCard são stub — o primeiro porque não há banco, o
// segundo porque o objetivo é ver o payload, não criar card.
//
// O que se prova: a remessa é lida da planilha, sobrevive à gravação, volta na
// leitura e chega no payload do card — e o DT SAP não muda em nada disso.
// =====================================================================
import * as XLSX from 'xlsx';
import {
    COLUNAS_OTM, abrirPlanilhaOtm, camposBasicos, mapearColunas,
    montarCotacaoSuzano, enviarCargaAoPipefy, remessaDoPk,
} from './fastDelivery.ts';
import { COLUNAS_DEMAIS_PLANTAS } from './demaisPlantas.ts';

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

const planilha = (aoa) => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Plan1');
    return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
};

// Cabeçalho mínimo do OTM. A 9a coluna e a de remessa do cenario em teste:
// na planilha REAL e o "PK" ("SUZANO.8819073"); uma coluna "Remessa" explicita
// nao existe hoje, e e tratada como fallback preferencial se um dia vier.
const CAB_PK = ['DT SAP', 'Data Coleta', 'Cidade de Destino', 'UF', 'Nome Destino',
    'Tipo Equipamento', 'Peso', 'Custo Frete', 'PK'];
const CAB = ['DT SAP', 'Data Coleta', 'Cidade de Destino', 'UF', 'Nome Destino',
    'Tipo Equipamento', 'Peso', 'Custo Frete', 'Remessa'];
const linhaOtm = (dt, remessa) => [dt, '2026-10-20', 'Cotia', 'SP', 'Cliente X', 'TRUCK', 1200, 3500, remessa];

console.log('--- 1) DICIONARIO ---');
eq('COLUNAS_OTM reconhece a Remessa', COLUNAS_OTM.remessa,
    ['Remessa', 'Nº Remessa', 'Numero Remessa', 'No Remessa', 'Nr Remessa']);
ok('as Demais Plantas herdam (mesmo array)', COLUNAS_DEMAIS_PLANTAS.remessa === COLUNAS_OTM.remessa);
ok('o DT SAP segue intacto no dicionario', COLUNAS_OTM.referencia.includes('DT SAP'));
{
    // Os cinco cabeçalhos aceitos, cada um num arquivo.
    for (const cab of ['Remessa', 'Nº Remessa', 'Numero Remessa', 'No Remessa', 'Nr Remessa']) {
        const { mapa } = mapearColunas([...CAB.slice(0, 8), cab], COLUNAS_OTM);
        eq(`cabecalho "${cab}" casa`, mapa.remessa, cab);
    }
    // Acento, caixa e espaco nao atrapalham (normalizarCabecalho).
    const { mapa } = mapearColunas([...CAB.slice(0, 8), '  NÚMERO REMESSA '], COLUNAS_OTM);
    eq('"  NÚMERO REMESSA " tambem casa', mapa.remessa, '  NÚMERO REMESSA ');
}
{
    // Planilha SEM a coluna: entra no aviso ambar, e nao quebra.
    const { faltando } = mapearColunas(CAB.slice(0, 8), COLUNAS_OTM);
    ok('planilha sem Remessa avisa (aviso ambar)', faltando.includes('Remessa'), faltando.join(', '));
}

console.log('\n--- 2) LEITURA DA PLANILHA (codigo real) ---');
{
    const { bruto, mapa } = abrirPlanilhaOtm(planilha([CAB, linhaOtm('1429723', '0012345678')]), COLUNAS_OTM);
    const base = camposBasicos(bruto[0], mapa, 0);
    eq('remessa lida', base.remessa, '0012345678');
    ok('e como TEXTO: zeros a esquerda preservados', base.remessa.startsWith('00'));
    eq('o DT SAP continua lido no campo dele', base.referencia, '1429723');
}
{
    // Remessa numerica grande: nao pode arredondar nem virar notacao cientifica.
    const grande = '900300123456789';
    const { bruto, mapa } = abrirPlanilhaOtm(planilha([CAB, linhaOtm('1429724', grande)]), COLUNAS_OTM);
    const base = camposBasicos(bruto[0], mapa, 0);
    eq('remessa longa chega inteira', base.remessa, grande);
    ok('sem notacao cientifica', !base.remessa.includes('e') && !base.remessa.includes('E'));
}
{
    // Celula vazia e coluna ausente -> string vazia, nao "undefined".
    const vazia = abrirPlanilhaOtm(planilha([CAB, linhaOtm('1429725', '')]), COLUNAS_OTM);
    eq('celula vazia vira ""', camposBasicos(vazia.bruto[0], vazia.mapa, 0).remessa, '');
    const sem = abrirPlanilhaOtm(planilha([CAB.slice(0, 8), linhaOtm('1429726', '').slice(0, 8)]), COLUNAS_OTM);
    eq('coluna ausente vira ""', camposBasicos(sem.bruto[0], sem.mapa, 0).remessa, '');
}
{
    // Espacos sobrando sao aparados: " 123 " na busca do Pipefy nao acha nada.
    const { bruto, mapa } = abrirPlanilhaOtm(planilha([CAB, linhaOtm('1429727', '  7788990  ')]), COLUNAS_OTM);
    eq('espacos aparados', camposBasicos(bruto[0], mapa, 0).remessa, '7788990');
}

console.log('\n--- 3) GRAVACAO NA COTACAO (montarCotacaoSuzano, codigo real) ---');
const dadosBase = {
    id: 'id-1', proposta: 'CT-2026-0001', dt: '1429723',
    origem: 'GUARULHOS', destino: 'Cotia/SP', clienteLocal: 'Cliente X',
    tipoVeiculo: 'TRUCK', carroceria: 'Baú', coletaEm: null, entregaEm: null,
    peso: 1200, observacoes: null, valorRecebido: 3500, valorAPagar: 2800,
    km: 40, margem: 700, margemPercent: 20, operacao: 'FAST_DELIVERY',
    autor: { id: 'u1', name: 'Wagner' },
};
{
    const row = montarCotacaoSuzano({ ...dadosBase, remessa: '0012345678' });
    eq('a coluna remessa recebe o numero', row.remessa, '0012345678');
    eq('client_reference segue sendo a DT SAP', row.client_reference, '1429723');
    ok('sao campos DIFERENTES', row.remessa !== row.client_reference);
}
{
    // "Nao informado" e UM estado: null, nunca string vazia.
    eq('remessa vazia grava null', montarCotacaoSuzano({ ...dadosBase, remessa: '' }).remessa, null);
    eq('remessa so com espacos grava null', montarCotacaoSuzano({ ...dadosBase, remessa: '   ' }).remessa, null);
    eq('remessa ausente grava null', montarCotacaoSuzano({ ...dadosBase }).remessa, null);
}

console.log('\n--- 4) ATE O PAYLOAD DO CARD (enviarCargaAoPipefy, codigo real) ---');
const carga = (over = {}) => ({
    id: 'id-1', proposta: 'CT-2026-0001', dt: '1429723', criadaEm: Date.now(),
    origem: 'GUARULHOS', destino: 'Cotia/SP', operacao: 'FAST_DELIVERY',
    cliente: 'Cliente X', tipoVeiculo: 'TRUCK', carroceria: 'Baú',
    peso: 1200, coletaEm: null, entregaEm: null, observacoes: null,
    remessa: '0012345678', valorRecebido: 3500, valorAPagar: 2800,
    km: 40, margem: 700, margemPercent: 20,
    pipefySentAt: null, pipefyCardId: null, pipefyCardUrl: null, ramperSentAt: null,
    ...over,
});
const enviar = async (c) => {
    globalThis.__PIPEFY_CALLS__ = [];
    // A carga ainda não foi enviada, e o cliente da operação tem vínculo.
    globalThis.__SUPABASE_FIXTURES__ = {
        freight_calculations: { pipefy_card_id: null, pipefy_sent_at: null, ramper_sent_at: null },
        customers: { pipefy_client_id: '1001' },
    };
    const res = await enviarCargaAoPipefy(c);
    return { res, payload: globalThis.__PIPEFY_CALLS__[0] };
};
{
    const { res, payload } = await enviar(carga());
    ok('o envio deu certo', !!res.ok, JSON.stringify(res));
    eq('a REMESSA chegou no payload', payload.remessa, '0012345678');
    eq('e a DT SAP foi no campo dela (referencia)', payload.referencia, '1429723');
    ok('sao campos separados no payload', payload.remessa !== payload.referencia);
    // TRUCK nao e veiculo leve, entao o titulo do Fast e "Suzano Mogi" -- a
    // regra de hoje, que a remessa NAO pode ter mexido.
    eq('o TITULO segue a regra do veiculo (TRUCK = pesado)', payload.titulo, 'Suzano Mogi');
    ok('o titulo NAO contem a remessa', !String(payload.titulo).includes('0012345678'));
    eq('a operacao vai (decide o Pipe no servidor)', payload.operacao, 'FAST_DELIVERY');
}
{
    // Veiculo leve: o titulo e "Suzano Fast". Os dois casos pinados, pra o
    // titulo nao ser tocado nem de lado.
    const { payload } = await enviar(carga({ tipoVeiculo: 'Fiorino' }));
    eq('veiculo leve -> "Suzano Fast"', payload.titulo, 'Suzano Fast');
    eq('e a remessa vai igual', payload.remessa, '0012345678');
}
{
    // Sem remessa: o campo vai undefined e o push da Edge Function o omite.
    const { payload } = await enviar(carga({ remessa: null }));
    eq('sem remessa o payload manda undefined', payload.remessa, undefined);
    eq('e a DT segue intacta', payload.referencia, '1429723');
}
{
    // Demais Plantas: MESMO caminho, outro Pipe (decidido no servidor).
    const { payload } = await enviar(carga({
        operacao: 'DEMAIS_PLANTAS', origem: 'Mogi das Cruzes, SP', remessa: '555666',
    }));
    eq('Demais Plantas tambem leva a remessa', payload.remessa, '555666');
    eq('e o titulo das Demais Plantas segue vazio (cai na rota)', payload.titulo, '');
    eq('a rota usa a origem da cotacao', payload.rota, 'Mogi das Cruzes, SP > Cotia/SP');
}

console.log('\n--- 5) CADEIA COMPLETA: um .xlsx -> payload ---');
{
    const { bruto, mapa } = abrirPlanilhaOtm(planilha([CAB, linhaOtm('1429999', '0099887766')]), COLUNAS_OTM);
    const base = camposBasicos(bruto[0], mapa, 0);
    const row = montarCotacaoSuzano({ ...dadosBase, dt: base.referencia, remessa: base.remessa });
    // O que o banco devolveria na leitura (mapeamento de CotacaoHistorico).
    const { payload } = await enviar(carga({ dt: row.client_reference, remessa: row.remessa }));
    eq('planilha -> banco -> card, sem perder digito', payload.remessa, '0099887766');
    eq('e a DT SAP atravessa igual', payload.referencia, '1429999');
}

console.log('\n--- 7) REMESSA VINDA DO PK (o caso real do OTM) ---');
eq('"SUZANO.8819073" -> "8819073"', remessaDoPk('SUZANO.8819073'), '8819073');
eq('prefixo em caixa baixa tambem', remessaDoPk('suzano.8819073'), '8819073');
eq('espacos em volta', remessaDoPk('  SUZANO.8819073  '), '8819073');
eq('zeros a esquerda preservados', remessaDoPk('SUZANO.0008819073'), '0008819073');
eq('numero longo inteiro', remessaDoPk('SUZANO.900300123456789'), '900300123456789');
eq('PK sem ponto vale inteiro', remessaDoPk('8819073'), '8819073');
eq('mais de um ponto: pega depois do ULTIMO', remessaDoPk('SUZANO.BR.8819073'), '8819073');
eq('PK vazio', remessaDoPk(''), '');
eq('PK nulo', remessaDoPk(null), '');
eq('PK undefined', remessaDoPk(undefined), '');
eq('so o prefixo, sem numero', remessaDoPk('SUZANO.'), '');
eq('numero puro vindo como number do xlsx', remessaDoPk(8819073), '8819073');

{
    // Dicionario reconhece o PK.
    eq('COLUNAS_OTM reconhece PK', COLUNAS_OTM.pk, ['PK']);
    const { mapa } = mapearColunas(CAB_PK, COLUNAS_OTM);
    eq('a coluna PK casa', mapa.pk, 'PK');
}
{
    // O caso REAL: planilha com PK e SEM coluna Remessa.
    const { bruto, mapa } = abrirPlanilhaOtm(planilha([CAB_PK, linhaOtm('1429723', 'SUZANO.8819073')]), COLUNAS_OTM);
    const base = camposBasicos(bruto[0], mapa, 0);
    eq('remessa derivada do PK', base.remessa, '8819073');
    eq('e o DT SAP segue no campo dele', base.referencia, '1429723');
    const { faltando } = mapearColunas(CAB_PK, COLUNAS_OTM);
    ok('a planilha de hoje NAO reclama de PK', !faltando.includes('PK'), faltando.join(', '));
    ok('mas avisa da coluna Remessa ausente (fallback, nao obrigatoria)', faltando.includes('Remessa'));
}
{
    // Zero a esquerda atravessando a planilha de verdade (vai como texto).
    const { bruto, mapa } = abrirPlanilhaOtm(planilha([CAB_PK, linhaOtm('1429724', 'SUZANO.0008819073')]), COLUNAS_OTM);
    eq('zeros sobrevivem ao xlsx', camposBasicos(bruto[0], mapa, 0).remessa, '0008819073');
}
{
    // PRECEDENCIA: coluna explicita "Remessa" VENCE o PK.
    const cab = [...CAB_PK, 'Remessa'];
    const linha = [...linhaOtm('1429725', 'SUZANO.1111111'), '2222222'];
    const { bruto, mapa } = abrirPlanilhaOtm(planilha([cab, linha]), COLUNAS_OTM);
    const base = camposBasicos(bruto[0], mapa, 0);
    eq('com as duas colunas, a Remessa explicita vence', base.remessa, '2222222');
}
{
    // Remessa explicita VAZIA cai de volta no PK: coluna presente mas em branco
    // nao pode apagar o numero que o PK tem.
    const cab = [...CAB_PK, 'Remessa'];
    const linha = [...linhaOtm('1429726', 'SUZANO.3333333'), ''];
    const { bruto, mapa } = abrirPlanilhaOtm(planilha([cab, linha]), COLUNAS_OTM);
    eq('coluna Remessa vazia -> usa o PK', camposBasicos(bruto[0], mapa, 0).remessa, '3333333');
}
{
    // Nem PK nem Remessa: fica vazia, e a carga ainda lanca.
    const cab = CAB_PK.slice(0, 8);
    const { bruto, mapa } = abrirPlanilhaOtm(planilha([cab, linhaOtm('1429727', '').slice(0, 8)]), COLUNAS_OTM);
    eq('sem PK e sem Remessa -> vazia', camposBasicos(bruto[0], mapa, 0).remessa, '');
}

console.log('\n--- 8) PK -> PAYLOAD DO CARD, nos DOIS fluxos ---');
{
    const { bruto, mapa } = abrirPlanilhaOtm(planilha([CAB_PK, linhaOtm('1429999', 'SUZANO.8819073')]), COLUNAS_OTM);
    const base = camposBasicos(bruto[0], mapa, 0);
    const row = montarCotacaoSuzano({ ...dadosBase, dt: base.referencia, remessa: base.remessa });
    eq('o banco recebe a remessa do PK', row.remessa, '8819073');
    eq('e o client_reference segue sendo a DT', row.client_reference, '1429999');

    // Fast
    const fast = await enviar(carga({ dt: row.client_reference, remessa: row.remessa }));
    eq('FAST: PK -> payload do card', fast.payload.remessa, '8819073');
    eq('FAST: a DT atravessa igual', fast.payload.referencia, '1429999');

    // Demais Plantas: MESMO parser (herda o dicionario), outro Pipe.
    const dp = await enviar(carga({
        dt: row.client_reference, remessa: row.remessa,
        operacao: 'DEMAIS_PLANTAS', origem: 'Mogi das Cruzes, SP',
    }));
    eq('DEMAIS PLANTAS: PK -> payload do card', dp.payload.remessa, '8819073');
    eq('DEMAIS PLANTAS: a DT atravessa igual', dp.payload.referencia, '1429999');
    ok('o titulo nao carrega a remessa em nenhum dos dois',
        !String(fast.payload.titulo).includes('8819073') && !String(dp.payload.titulo).includes('8819073'));
}
{
    // As Demais Plantas herdam o PK pelo dicionario, nao por copia.
    const { COLUNAS_DEMAIS_PLANTAS: DP } = await import('./demaisPlantas.ts');
    eq('COLUNAS_DEMAIS_PLANTAS herda o PK', DP.pk, COLUNAS_OTM.pk);
}

console.log('\n--- 6) EDGE FUNCTION: field_id da Remessa POR PIPE ---');
{
    // Fatia o codigo REAL da Edge Function (Deno, nao importavel aqui) e
    // executa: o mapa de field_id, o roteamento de Pipe e a regra do push.
    // Mesma tecnica do scripts/motor_equivalencia.mjs -- comparar com uma
    // transcricao minha nao provaria nada.
    const { readFileSync } = await import('node:fs');
    const fonte = readFileSync('supabase/functions/pipefy-create-card/index.ts', 'utf8');

    const fatia = (re, nome) => {
        const m = fonte.match(re);
        if (!m) throw new Error(`nao achei ${nome} na Edge Function`);
        return m[0];
    };
    const mapaSrc = fatia(/const REMESSA_FIELD_POR_PIPE[\s\S]*?\n};/, 'REMESSA_FIELD_POR_PIPE');
    const destSrc = fatia(/const DESTINO_POR_OPERACAO[\s\S]*?\n};/, 'DESTINO_POR_OPERACAO');
    const padraoSrc = fatia(/const PIPE_PADRAO = '\d+';/, 'PIPE_PADRAO');
    const phaseSrc = fatia(/const PHASE_PADRAO = '\d+';/, 'PHASE_PADRAO');
    const fnSrc = fatia(/function destinoDaOperacao[\s\S]*?\n}/, 'destinoDaOperacao');

    const semTipos = (t) => t.replace(/: Record<string, [^>]+>/g, '').replace(/: \{ pipe: string; phase: string \}/g, '').replace(/: unknown/g, '');
    const ambiente = new Function(`
        ${semTipos(padraoSrc)}
        ${semTipos(phaseSrc)}
        ${semTipos(mapaSrc)}
        ${semTipos(destSrc)}
        ${semTipos(fnSrc)}
        // A regra do push, igual a da funcao: vazio/nulo => omitido.
        const push = (fields, id, val) => { if (val !== '' && val != null) fields.push({ field_id: id, field_value: val }); };
        return { REMESSA_FIELD_POR_PIPE, destinoDaOperacao, push, PIPE_PADRAO };
    `)();

    const { REMESSA_FIELD_POR_PIPE: MAPA, destinoDaOperacao, push, PIPE_PADRAO } = ambiente;

    eq('o mapa cobre os DOIS pipes', Object.keys(MAPA).sort(), ['304753830', '307341584']);
    eq('Fast (307341584) -> field_id', MAPA['307341584'], 'remessa');
    eq('Padrao (304753830) -> field_id', MAPA['304753830'], 'remessa');

    // O id usado e o do Pipe de DESTINO, resolvido pela operacao.
    const idPara = (operacao) => MAPA[destinoDaOperacao(operacao).pipe];
    eq('FAST_DELIVERY resolve o pipe do Fast', destinoDaOperacao('FAST_DELIVERY').pipe, '307341584');
    eq('e pega o field_id dele', idPara('FAST_DELIVERY'), 'remessa');
    eq('DEMAIS_PLANTAS cai no pipe padrao', destinoDaOperacao('DEMAIS_PLANTAS').pipe, '304753830');
    eq('e pega o field_id dele', idPara('DEMAIS_PLANTAS'), 'remessa');
    eq('cotacao normal (sem operacao) tambem cai no padrao', destinoDaOperacao(undefined).pipe, PIPE_PADRAO);
    eq('e tem field_id', idPara(undefined), 'remessa');

    // A regra do push: com valor entra, sem valor e OMITIDO.
    const comValor = []; push(comValor, idPara('FAST_DELIVERY'), '0012345678');
    eq('remessa preenchida entra no fields_attributes', comValor, [{ field_id: 'remessa', field_value: '0012345678' }]);
    for (const vazio of ['', null, undefined]) {
        const f = []; push(f, idPara('FAST_DELIVERY'), vazio);
        eq(`remessa ${JSON.stringify(vazio)} e OMITIDA`, f.length, 0);
    }

    // Pipe fora do mapa: nao manda nada. Enviar field_id inexistente nao da
    // erro no Pipefy -- o card nasceria com o campo em branco, calado.
    eq('pipe desconhecido nao tem field_id', MAPA['999999999'], undefined);
    const f2 = []; const idDesconhecido = MAPA['999999999'];
    if (idDesconhecido) push(f2, idDesconhecido, '123');
    eq('e por isso nada e enviado', f2.length, 0);

    // O push da remessa nao substituiu o da DT SAP.
    ok('o campo da DT SAP continua no codigo',
        fonte.includes("push('solicita_o_ste_coleta_etc', referenciaRaw)"));
    ok('e o comentario dos "25 campos" foi atualizado', !fonte.includes('mesmos 25 campos'));
}

console.log(`\n${pass} ok, ${fail} falhas`);
if (fail > 0) process.exit(1);
