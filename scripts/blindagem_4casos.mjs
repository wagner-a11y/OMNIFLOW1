#!/usr/bin/env node
// =====================================================================
// Os quatro casos da blindagem, contra as Edge Functions REAIS.
//
//   node scripts/blindagem_4casos.mjs <token-do-link>
//
// NÃO GRAVA NADA no Datamex: os corpos são propositalmente inválidos. O que se
// mede é a PORTA, e ela responde antes de qualquer chamada ao Bsoft:
//   401 -> recusou na porta            (barrado)
//   400 -> passou a porta e caiu na validação de campo   (autorizado)
// Um 400 aqui é a prova de que entrou; nunca de que gravou.
//
// O caso do usuário logado não usa JWT real (não há senha em lote): ele é
// coberto por outros dois testes que juntos o provam —
//   scripts/porta_cadastro.mjs   a porta aceita role=authenticated
//   scripts/header_invoke.mjs    o cliente logado manda role=authenticated
// e aqui se confirma o que falta: que um JWT NÃO emitido pelo projeto não
// entra, ou seja, que a via de sessão não é falsificável de fora.
// =====================================================================

const URL_SUPA = 'https://trdkggiobsydruihvesj.supabase.co';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRyZGtnZ2lvYnN5ZHJ1aWh2ZXNqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzNjMwNTcsImV4cCI6MjA4NDkzOTA1N30.yHzshSV2kJ5gWwAFxCDY85q6HdUcKtRKuGCX33nS144';

const TOKEN = process.argv[2];
if (!TOKEN) {
    console.error('uso: node scripts/blindagem_4casos.mjs <token>');
    process.exit(2);
}

// As que o fluxo por link precisa alcançar.
const FUNCOES = [
    'cadastrar-veiculo', 'cadastrar-motorista', 'cadastrar-pessoa-juridica',
    'buscar-pessoa-juridica', 'vincular-conjunto', 'dominio-veiculo-ler',
    'process-document',
];

// Guardadas também, mas FORA do alcance do link: manutenção, não cadastro.
// O portador do link lê o dicionário (dominio-veiculo-ler); reconstruí-lo a
// partir do Bsoft exige sessão.
const SO_SESSAO = ['dominio-veiculo-sync'];

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwtForjado = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    role: 'authenticated', sub: 'x', exp: Math.floor(Date.now() / 1000) + 3600,
})}.assinatura-inventada`;

async function bater(fn, headers) {
    const r = await fetch(`${URL_SUPA}/functions/v1/${fn}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: ANON, ...headers },
        body: JSON.stringify({}),
    });
    let corpo = '';
    try { corpo = (await r.json())?.error ?? ''; } catch { /* sem corpo */ }
    return { status: r.status, corpo: String(corpo).slice(0, 52) };
}

const CENARIOS = [
    {
        nome: '2. link externo COM token válido',
        headers: { Authorization: `Bearer ${ANON}`, 'x-cadastro-token': TOKEN },
        esperado: 'entra',
    },
    {
        nome: '3a. link externo SEM token',
        headers: { Authorization: `Bearer ${ANON}` },
        esperado: 'barra',
    },
    {
        nome: '3b. link externo com token ERRADO',
        headers: { Authorization: `Bearer ${ANON}`, 'x-cadastro-token': 'f'.repeat(64) },
        esperado: 'barra',
    },
    {
        nome: '4a. DevTools: só a anon key',
        headers: { Authorization: `Bearer ${ANON}` },
        esperado: 'barra',
    },
    {
        nome: '4b. DevTools: sem Authorization nenhum',
        headers: {},
        esperado: 'barra',
    },
    {
        nome: '4c. DevTools: JWT authenticated FORJADO',
        headers: { Authorization: `Bearer ${jwtForjado}` },
        esperado: 'barra',
    },
];

let falhas = 0;
for (const c of CENARIOS) {
    console.log(`\n  ${c.nome}   (esperado: ${c.esperado === 'entra' ? 'ENTRA' : 'RECUSA'})`);
    for (const fn of FUNCOES) {
        const { status, corpo } = await bater(fn, c.headers);
        // 401 = porta recusou. Qualquer outra coisa = passou da porta.
        const entrou = status !== 401;
        const ok = c.esperado === 'entra' ? entrou : !entrou;
        if (!ok) falhas++;
        const veredito = entrou ? `ENTROU (${status})` : `recusou (${status})`;
        console.log(`      ${fn.padEnd(26)} ${veredito.padEnd(16)} ${ok ? '' : '<<< ERRADO'}  ${entrou ? corpo : ''}`);
    }
}

// As de manutenção recusam o link mesmo quando o token está certo.
console.log('\n  5. funções de manutenção: token do link NÃO alcança   (esperado: RECUSA)');
for (const fn of SO_SESSAO) {
    const { status } = await bater(fn, { Authorization: `Bearer ${ANON}`, 'x-cadastro-token': TOKEN });
    const ok = status === 401;
    if (!ok) falhas++;
    console.log(`      ${fn.padEnd(26)} ${(status === 401 ? 'recusou (401)' : `ENTROU (${status})`).padEnd(16)} ${ok ? '' : '<<< ERRADO'}`);
}

console.log('\n' + '='.repeat(72));
if (falhas) {
    console.log(`FALHOU — ${falhas} resultado(s) fora do esperado. NÃO publicar.`);
    process.exit(1);
}
console.log(`OK — nas ${FUNCOES.length} funções do fluxo: token válido entra; sem token, token errado,`);
console.log('     anon pura, sem Authorization e JWT forjado são todos recusados na porta.');
console.log(`     E o link não alcança as ${SO_SESSAO.length} de manutenção, nem com o token certo.`);
