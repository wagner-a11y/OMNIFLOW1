#!/usr/bin/env node
// =====================================================================
// O caso que faltava: um usuário LOGADO DE VERDADE ainda grava?
//
//   node scripts/comercial_logado.mjs <caminho-da-service-role-key>
//
// Os outros testes provaram as pontas (a porta aceita role=authenticated; o
// cliente logado manda role=authenticated). Aqui o elo fica fechado com um JWT
// EMITIDO PELO SUPABASE, não forjado.
//
// COMO, SEM A SENHA DE NINGUÉM: cria um usuário descartável, faz login com ele,
// usa o access_token real e APAGA o usuário no fim — inclusive se o teste
// falhar no meio. Nenhuma conta real é tocada, e nada é criado no Datamex: o
// corpo enviado é inválido de propósito.
//
//   401 -> a porta recusou            (o comercial QUEBROU)
//   400 -> entrou e caiu na validação  (o comercial continua entrando)
// =====================================================================

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const URL_SUPA = 'https://trdkggiobsydruihvesj.supabase.co';
const caminho = process.argv[2];
if (!caminho) {
    console.error('uso: node scripts/comercial_logado.mjs <arquivo-com-a-service-role-key>');
    process.exit(2);
}
const SERVICE = readFileSync(caminho, 'utf8').trim();

const admin = createClient(URL_SUPA, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

const EMAIL = 'teste.blindagem.descartavel@omnicargo.com.br';
const SENHA = `T!${Math.abs(Number(process.hrtime.bigint() % 10n ** 12n))}xQ`;

const FUNCOES = ['cadastrar-veiculo', 'cadastrar-motorista', 'cadastrar-pessoa-juridica',
    'buscar-pessoa-juridica', 'vincular-conjunto', 'dominio-veiculo-ler', 'process-document'];

let idCriado = null;
let ANON_GLOBAL = '';
let falhas = 0;

async function limpar() {
    if (!idCriado) return;
    const { error } = await admin.auth.admin.deleteUser(idCriado);
    console.log(`\n  usuário descartável removido: ${error ? 'FALHOU — ' + error.message : 'ok'}`);
    if (error) console.log(`  >>> APAGUE NA MÃO: ${EMAIL} (${idCriado})`);
}

try {
    // Se sobrou de uma execução anterior, remove antes.
    const { data: lista } = await admin.auth.admin.listUsers({ perPage: 200 });
    const velho = lista?.users?.find(u => u.email === EMAIL);
    if (velho) await admin.auth.admin.deleteUser(velho.id);

    const { data: novo, error: errCriar } = await admin.auth.admin.createUser({
        email: EMAIL, password: SENHA, email_confirm: true,
    });
    if (errCriar) throw new Error(`não consegui criar o usuário de teste: ${errCriar.message}`);
    idCriado = novo.user.id;
    console.log(`  usuário descartável criado (será apagado no fim)`);

    // Login real -> access_token assinado pelo projeto.
    const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRyZGtnZ2lvYnN5ZHJ1aWh2ZXNqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzNjMwNTcsImV4cCI6MjA4NDkzOTA1N30.yHzshSV2kJ5gWwAFxCDY85q6HdUcKtRKuGCX33nS144';
    ANON_GLOBAL = ANON;
    const anonClient = createClient(URL_SUPA, ANON, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: sessao, error: errLogin } = await anonClient.auth.signInWithPassword({ email: EMAIL, password: SENHA });
    if (errLogin) throw new Error(`login do usuário de teste falhou: ${errLogin.message}`);

    const jwt = sessao.session.access_token;
    const papel = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).role;
    console.log(`  JWT real emitido pelo Supabase — role no token: ${papel}\n`);
    if (papel !== 'authenticated') {
        falhas++;
        console.log('  <<< o JWT real NÃO traz role=authenticated. A premissa da guarda está errada.');
    }

    for (const fn of FUNCOES) {
        const r = await fetch(`${URL_SUPA}/functions/v1/${fn}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: ANON_GLOBAL, Authorization: `Bearer ${jwt}` },
            body: JSON.stringify({}),
        });
        const entrou = r.status !== 401;
        if (!entrou) falhas++;
        let motivo = '';
        try { motivo = String((await r.json())?.error ?? '').slice(0, 46); } catch { /* vazio */ }
        console.log(`      ${fn.padEnd(26)} ${(entrou ? `ENTROU (${r.status})` : `RECUSOU (401)`).padEnd(16)} ${entrou ? motivo : '<<< COMERCIAL QUEBRADO'}`);
    }
} catch (e) {
    falhas++;
    console.log(`\n  ERRO: ${e.message}`);
} finally {
    await limpar();
}

console.log('\n' + '='.repeat(72));
if (falhas) {
    console.log(`FALHOU — ${falhas} problema(s). O fluxo do comercial NÃO está provado.`);
    process.exit(1);
}
console.log('OK — usuário logado de verdade entra em todas as funções do cadastro.');
console.log('     A blindagem não quebrou o comercial.');
