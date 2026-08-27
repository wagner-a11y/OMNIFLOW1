#!/usr/bin/env node
// =====================================================================
// Prova de quem vê o quê na barra lateral.
//
//   node scripts/menu_papeis.mjs
//
// Roda o montarMenu() DE VERDADE com os dois papéis e confere item a item
// contra as decisões tomadas. Não relê o App.tsx com regex: executa o módulo,
// então uma trava removida por engano derruba o teste.
//
// Compila menuLateral.ts na hora (o projeto não tem runner de TS).
// =====================================================================

import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'menu-'));
let montarMenu;
try {
    execSync(`npx tsc menuLateral.ts --outDir ${dir} --module es2020 --target es2020 --moduleResolution bundler`, { stdio: 'pipe' });
    ({ montarMenu } = await import(join(dir, 'menuLateral.js')));
} finally {
    process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
}

const CTX = {
    painelTvToken: 'token-de-teste',
    emergenciaLigada: false,
    mostrarAcoesComercial: true,
    mostrarNegociacoes: true,
};

const achatar = (m) => {
    const out = [];
    for (const s of m.secoes) {
        for (const it of s.itens) {
            out.push({ secao: s.titulo, label: it.label, sub: null });
            for (const f of it.filhos || []) out.push({ secao: s.titulo, label: f.label, sub: it.label });
        }
    }
    for (const it of m.soltos) out.push({ secao: '(solto)', label: it.label, sub: null });
    return out;
};

const menus = {
    master: montarMenu({ ...CTX, master: true }),
    operador: montarMenu({ ...CTX, master: false }),
};

for (const [papel, m] of Object.entries(menus)) {
    console.log(`\n${'='.repeat(56)}\n  BARRA LATERAL — ${papel.toUpperCase()}\n${'='.repeat(56)}`);
    for (const s of m.secoes) {
        console.log(`  ▸ ${s.titulo}`);
        for (const it of s.itens) {
            console.log(`      ${it.label}${it.filhos ? '' : it.href ? '  (link)' : it.acao ? '  (modal)' : ''}`);
            for (const f of it.filhos || []) console.log(`          ${f.label}`);
        }
    }
    for (const it of m.soltos) console.log(`  · ${it.label}`);
    const semSecao = ['Comercial', 'Operacional', 'Cadastros', 'Configurações']
        .filter(t => !m.secoes.some(s => s.titulo === t));
    if (semSecao.length) console.log(`  [não aparece: ${semSecao.join(', ')}]`);
}

// ---------------------------------------------------------------------
// As decisões, em forma de asserção.
// ---------------------------------------------------------------------
const SO_MASTER = ['Meu CRM', 'Lixeira', 'Modo emergência', 'Configurações do sistema', 'Trocar senha'];
const DE_TODOS = [
    'Nova Cotação', 'Dashboard', 'Histórico', 'Painel TV',
    'Minha Carteira', 'Contato Diário · Análise', 'Contato Diário · Registrar',
    'Acompanhamento PPFY', 'Fast Delivery',
    'Cadastro Pessoa', 'Cadastro Veículo', 'Cadastro Conjunto',
];

const rotulos = Object.fromEntries(
    Object.entries(menus).map(([p, m]) => [p, new Set(achatar(m).map(x => x.label))]),
);
const erros = [];

for (const l of SO_MASTER) {
    if (!rotulos.master.has(l)) erros.push(`"${l}" sumiu do menu do master`);
    if (rotulos.operador.has(l)) erros.push(`VAZAMENTO: operador está vendo "${l}"`);
}
for (const l of DE_TODOS) {
    if (!rotulos.master.has(l)) erros.push(`"${l}" sumiu do menu do master`);
    if (!rotulos.operador.has(l)) erros.push(`"${l}" devia ser de todos e o operador não vê`);
}

// A seção Configurações só tem item de master: para o operador não pode sobrar título.
if (menus.operador.secoes.some(s => s.titulo === 'Configurações')) {
    erros.push('VAZAMENTO: operador está vendo a seção Configurações');
}
// Renomeações pedidas.
for (const velho of ['Acompanhamento', 'Cadastro Rápido']) {
    if (rotulos.master.has(velho)) erros.push(`rótulo antigo ainda no menu: "${velho}"`);
}
// Sem token do Painel TV, o item não pode aparecer nem para o master.
const semTv = montarMenu({ ...CTX, master: true, painelTvToken: null });
if (achatar(semTv).some(x => x.label === 'Painel TV')) {
    erros.push('Painel TV apareceu sem token — o link abriria quebrado');
}
// Emergência ligada precisa mudar o rótulo e marcar destaque.
const ligada = montarMenu({ ...CTX, master: true, emergenciaLigada: true });
const emg = ligada.secoes.flatMap(s => s.itens).find(i => i.id === 'emergencia');
if (emg?.label !== 'Emergência LIGADA' || !emg?.destaque) {
    erros.push('estado de emergência ligada não chega no item do menu');
}

console.log(`\n${'='.repeat(56)}`);
if (erros.length) {
    console.log('FALHOU:');
    for (const e of erros) console.log('  -', e);
    process.exit(1);
}
console.log(`OK — ${SO_MASTER.length} itens de master invisíveis ao operador,`);
console.log(`     ${DE_TODOS.length} itens visíveis aos dois, seção Configurações oculta ao operador,`);
console.log('     rótulos antigos removidos, Painel TV depende de token, emergência reflete o estado.');
