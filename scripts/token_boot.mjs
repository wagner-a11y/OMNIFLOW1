#!/usr/bin/env node
// =====================================================================
// O token do link sobrevive ao F5?
//
//   node scripts/token_boot.mjs
//
// Existe porque este caminho JÁ se perdeu uma vez sem ninguém notar: um merge
// restaurou uma versão antiga do index.tsx, a leitura do sessionStorage nunca
// foi ligada, e o operador continuou tendo de reabrir o link a cada recarga.
// O build passava, porque o tsc do projeto não checava arquivo nenhum.
//
// Compila o tokenCadastro.ts real e simula os três momentos: abrir o link,
// recarregar a página, e abrir uma aba nova.
// =====================================================================

import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'tokenboot-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
execSync(`npx esbuild services/tokenCadastro.ts --bundle --format=esm --outfile=${join(dir, 'tk.js')}`, { stdio: 'pipe' });

class Mem {
    constructor(){ this.m = new Map(); }
    getItem(k){ return this.m.has(k) ? this.m.get(k) : null; }
    setItem(k,v){ this.m.set(k, String(v)); }
    removeItem(k){ this.m.delete(k); }
}

const TOKEN = 'a'.repeat(64);
const BASE = 'https://exemplo.test/cadastro-externo';
const CHAVE = 'omniflow.cadastro.token';
const carregar = (n) => import(`${join(dir, 'tk.js')}?b=${n}`);

const falhas = [];
const ok = (nome, cond) => { console.log(`  ${cond ? 'ok   ' : 'FALHA'} ${nome}`); if (!cond) falhas.push(nome); };

globalThis.sessionStorage = new Mem();
let m = await carregar(1);
let r = m.resolverTokenNoBoot(`${BASE}?k=${TOKEN}`);
ok('abrindo o link: token passa a valer', m.temTokenCadastro());
ok('a URL devolvida não tem mais o ?k=', !r.url.includes('k=') && r.limpar === true);
ok('foi guardado na sessão da aba', sessionStorage.getItem(CHAVE) === TOKEN);

// O caso que estava quebrado.
m = await carregar(2);
ok('após F5 a memória começa vazia', !m.temTokenCadastro());
r = m.resolverTokenNoBoot(BASE);
ok('F5 sem ?k= recupera o token da sessão', m.temTokenCadastro());
ok('e não pede para limpar a URL de novo', r.limpar === false);
ok('o header volta correto', m.cabecalhoCadastro()['x-cadastro-token'] === TOKEN);

m = await carregar(3);
m.resolverTokenNoBoot(`${BASE}?k=${'b'.repeat(64)}`);
ok('token novo da URL sobrescreve o da sessão', sessionStorage.getItem(CHAVE) === 'b'.repeat(64));

globalThis.sessionStorage = new Mem();
m = await carregar(4);
m.resolverTokenNoBoot(BASE);
ok('aba nova sem ?k= fica sem token', !m.temTokenCadastro());

globalThis.sessionStorage = new Mem();
m = await carregar(5);
m.resolverTokenNoBoot(`${BASE}?k=`);
ok('?k= vazio não vira token', !m.temTokenCadastro());

console.log();
console.log(falhas.length ? `FALHOU: ${falhas.join(', ')}` : 'OK — o F5 não pede mais o link: o boot lê a sessão da aba.');
process.exit(falhas.length ? 1 : 0);
