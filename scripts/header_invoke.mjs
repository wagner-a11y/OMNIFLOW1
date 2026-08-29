#!/usr/bin/env node
// =====================================================================
// O que o supabase-js manda no Authorization ao chamar uma Edge Function?
//
//   node scripts/header_invoke.mjs
//
// Esta é A pergunta que decide se blindar as funções quebra o comercial.
// Se o cliente logado mandasse a ANON KEY, a guarda de _shared/porta.ts
// recusaria o usuário logado e o cadastro pararia para todo mundo.
//
// Ler o código do supabase-js dá a resposta, mas dedução não é medida: aqui o
// fetch é interceptado e o header REAL é impresso, com e sem sessão.
//
// Nada sai para a rede — o fetch é substituído antes da chamada.
// =====================================================================

import { createClient } from '@supabase/supabase-js';

const URL_SUPA = 'https://trdkggiobsydruihvesj.supabase.co';
const REF = 'trdkggiobsydruihvesj';
// A anon key pública do projeto (a mesma que já vai no bundle).
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRyZGtnZ2lvYnN5ZHJ1aWh2ZXNqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzNjMwNTcsImV4cCI6MjA4NDkzOTA1N30.yHzshSV2kJ5gWwAFxCDY85q6HdUcKtRKuGCX33nS144';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const FAKE_USER_JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    role: 'authenticated', sub: '00000000-0000-0000-0000-000000000001',
    exp: Math.floor(Date.now() / 1000) + 3600, aud: 'authenticated',
})}.assinatura-irrelevante-aqui`;

/** Armazenamento em memória, para simular "tem sessão" sem tocar na rede. */
const storageCom = (sessao) => {
    const m = new Map(sessao ? [[`sb-${REF}-auth-token`, JSON.stringify(sessao)]] : []);
    return {
        getItem: (k) => m.get(k) ?? null,
        setItem: (k, v) => m.set(k, v),
        removeItem: (k) => m.delete(k),
    };
};

const SESSAO = {
    access_token: FAKE_USER_JWT,
    refresh_token: 'r',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    expires_in: 3600,
    token_type: 'bearer',
    user: { id: '00000000-0000-0000-0000-000000000001', aud: 'authenticated', role: 'authenticated' },
};

/** Papel declarado no JWT do header Authorization — é isso que a porta lê. */
const papel = (auth) => {
    try {
        const p = (auth || '').replace(/^Bearer\s+/i, '').split('.')[1];
        return JSON.parse(Buffer.from(p, 'base64url').toString()).role;
    } catch { return '(ilegível)'; }
};

async function medir(rotulo, sessao, headersExtra) {
    let capturado = null;
    const fetchFalso = async (_url, init) => {
        capturado = new Headers(init?.headers);
        return new Response(JSON.stringify({ ok: true }), {
            status: 200, headers: { 'Content-Type': 'application/json' },
        });
    };

    const supa = createClient(URL_SUPA, ANON, {
        auth: { storage: storageCom(sessao), persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
        global: { fetch: fetchFalso },
    });

    await supa.functions.invoke('cadastrar-veiculo', { body: {}, headers: headersExtra || {} });

    const auth = capturado?.get('authorization');
    const tok = capturado?.get('x-cadastro-token');
    return { rotulo, papel: papel(auth), token: tok ? `sim (${tok.length} chars)` : 'não', auth };
}

const linhas = [
    await medir('usuário LOGADO, pelo sistema normal', SESSAO, null),
    await medir('link externo (sem sessão) + token', null, { 'x-cadastro-token': 'T'.repeat(64) }),
    await medir('sem sessão e sem token (DevTools cru)', null, null),
];

console.log('\n  o que o navegador realmente envia:\n');
console.log('  ' + 'cenário'.padEnd(40) + 'role no JWT'.padEnd(18) + 'x-cadastro-token');
console.log('  ' + '-'.repeat(76));
for (const l of linhas) {
    console.log('  ' + l.rotulo.padEnd(40) + String(l.papel).padEnd(18) + l.token);
}

const logado = linhas[0];
const externo = linhas[1];
const cru = linhas[2];

const erros = [];
if (logado.papel !== 'authenticated') {
    erros.push(`o usuário logado manda role="${logado.papel}" — a guarda o recusaria e o cadastro pararia`);
}
if (externo.papel !== 'anon' || !externo.token.startsWith('sim')) {
    erros.push('o fluxo por link não está mandando anon + x-cadastro-token como esperado');
}
if (cru.papel !== 'anon' || cru.token !== 'não') {
    erros.push('o caso sem sessão nem token não é o esperado');
}

console.log();
if (erros.length) {
    console.log('FALHOU:');
    for (const e of erros) console.log('  -', e);
    process.exit(1);
}
console.log('OK — o usuário logado manda o JWT DELE (role=authenticated), não a anon key.');
console.log('     Blindar as funções não derruba o fluxo do comercial: ele entra pela via de sessão.');
