#!/usr/bin/env node
// =====================================================================
// Prova da porta das funções de cadastro.
//
//   node scripts/porta_cadastro.mjs
//
// Roda o conferirPorta() DE VERDADE (o mesmo arquivo que as Edge Functions
// importam) contra os casos que importam — principalmente o que estava aberto
// até 28/08/2026: chamada só com a anon key.
//
// Deno.env não existe no node, então é injetado um equivalente mínimo.
// =====================================================================

import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'porta-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

// Compila o porta.ts real, tirando só o `import type` de Deno que o node não tem.
// O `Deno` global existe no runtime das Edge Functions, não no tsc daqui:
// declarado só na cópia temporária, para não sujar o arquivo real.
const fonte = readFileSync('supabase/functions/_shared/porta.ts', 'utf8');
writeFileSync(join(dir, 'porta.ts'), 'declare const Deno: any;\n' + fonte);
execSync(`npx tsc ${join(dir, 'porta.ts')} --outDir ${dir} --module es2020 --target es2020 --skipLibCheck`, { stdio: 'pipe' });

const SEGREDO = 'a'.repeat(64);
globalThis.Deno = { env: { get: (k) => (k === 'CADASTRO_EXTERNO_TOKEN' ? SEGREDO : undefined) } };
const { conferirPorta } = await import(join(dir, 'porta.js'));

/** Monta um JWT com o claim `role` — assinatura falsa, que é o ponto: o gateway já conferiu. */
const jwt = (role) => {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role, iss: 'supabase' })}.assinatura`;
};

const req = (headers) => new Request('https://x/f', { method: 'POST', headers });

const CASOS = [
    // [nome, headers, deve passar?]
    ['anon key sozinha (o buraco de 28/08)', { Authorization: `Bearer ${jwt('anon')}` }, false],
    ['sem header nenhum', {}, false],
    ['service_role vazado no cliente', { Authorization: `Bearer ${jwt('service_role')}` }, false],
    ['usuário logado', { Authorization: `Bearer ${jwt('authenticated')}` }, true],
    ['token do link correto', { 'x-cadastro-token': SEGREDO }, true],
    ['token do link + anon key (o caso real da tela)', { Authorization: `Bearer ${jwt('anon')}`, 'x-cadastro-token': SEGREDO }, true],
    ['token errado do mesmo tamanho', { 'x-cadastro-token': 'b'.repeat(64) }, false],
    ['token certo com um caractere a menos', { 'x-cadastro-token': 'a'.repeat(63) }, false],
    ['token vazio', { 'x-cadastro-token': '' }, false],
    ['JWT lixo', { Authorization: 'Bearer nao.e.jwt' }, false],
    ['JWT sem as três partes', { Authorization: 'Bearer abc' }, false],
];

let falhas = 0;
console.log('  caso                                                    esperado  obtido');
console.log('  ' + '-'.repeat(76));
for (const [nome, headers, deveria] of CASOS) {
    const r = conferirPorta(req(headers));
    const ok = r.ok === deveria;
    if (!ok) falhas++;
    console.log(`  ${nome.padEnd(54)} ${(deveria ? 'passa' : 'barra').padEnd(9)} ${r.ok ? `passa (${r.via})` : `barra ${r.status}`}${ok ? '' : '   <<< ERRADO'}`);
}

// Secret ausente ou curto não pode virar porta aberta.
for (const [rotulo, valor] of [['ausente', undefined], ['curto demais', 'abc']]) {
    globalThis.Deno.env.get = (k) => (k === 'CADASTRO_EXTERNO_TOKEN' ? valor : undefined);
    const comToken = conferirPorta(req({ 'x-cadastro-token': valor || 'abc' }));
    const semNada = conferirPorta(req({}));
    const ok = !comToken.ok && !semNada.ok;
    if (!ok) falhas++;
    console.log(`  ${`secret ${rotulo}: continua fechado`.padEnd(54)} ${'barra'.padEnd(9)} ${comToken.ok ? 'PASSOU' : 'barra'}${ok ? '' : '   <<< ERRADO'}`);
}

console.log();
if (falhas) {
    console.log(`FALHOU — ${falhas} caso(s) fora do esperado.`);
    process.exit(1);
}
console.log(`OK — ${CASOS.length + 2} casos conferem. A anon key sozinha não abre mais as`);
console.log('     funções de cadastro, e secret ausente/curto mantém a porta fechada.');
