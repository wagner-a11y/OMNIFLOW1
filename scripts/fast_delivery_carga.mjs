#!/usr/bin/env node
// =====================================================================
// Carregador da tabela de preço Fast Delivery.
//
//   node scripts/fast_delivery_carga.mjs "FAST Delivery - ... .csv" > carga.sql
//
// Lê o CSV exportado da planilha e IMPRIME o SQL de carga. Não executa nada:
// quem aplica é você, depois de ler o que saiu. Preço é o dado que define
// quanto se paga a terceiro — um script que escreve direto no banco a partir
// de uma planilha é rápido de rodar e difícil de conferir.
//
// FORMATO REAL DO ARQUIVO (medido em 27/08/2026):
//   linha 0  título da planilha
//   linha 1  Origem,Destino,Viagens/mês,KM,Pedágio,FIORINO,,,VAN,,,...
//   linha 2  ,,,,,Nosso Frete,A pagar,Sobra,  (repetido por veículo)
//   linha 3+ dados
//
// Duas colunas antes do KM (Origem e Viagens/mês) que não existiam no desenho
// inicial. Se a planilha mudar de forma, ajuste COLUNAS aqui — é o único lugar.
// =====================================================================

import { readFileSync } from 'node:fs';

const VEICULOS = ['FIORINO', 'VAN', '3/4', 'TOCO', 'TRUCK', 'CARRETA'];
const COLUNAS = {
    origem: 0,
    destino: 1,
    // Viagens/mês (col 2) é ignorada de propósito: não entra na precificação.
    km: 3,
    pedagio: 4,
    primeiroVeiculo: 5,   // daí em diante, 3 colunas por veículo
    linhasDeCabecalho: 3,
};

/** CSV com aspas: "7,67" tem vírgula dentro e não pode virar duas colunas. */
function lerCsv(texto) {
    const linhas = [];
    let campo = '', linha = [], aspas = false;
    for (let i = 0; i < texto.length; i++) {
        const c = texto[i];
        if (aspas) {
            if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
            else if (c === '"') aspas = false;
            else campo += c;
        } else if (c === '"') aspas = true;
        else if (c === ',') { linha.push(campo); campo = ''; }
        else if (c === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = ''; }
        else if (c !== '\r') campo += c;
    }
    if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
    return linhas;
}

/** MESMA regra da fast_delivery_normaliza() do banco. */
const normalizar = (s) =>
    (s || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toUpperCase()
        .replace(/\(\s*\d+\s*\)/g, '')     // "SAO PAULO (2)" -> "SAO PAULO"
        .replace(/\s+/g, ' ')
        .trim();

/**
 * "R$ 1.500" -> 1500. Célula VAZIA -> null, nunca zero: vazio significa "não
 * atende esse veículo" ou "sem pedágio informado", e zero significaria custo
 * zero confirmado. São coisas diferentes e o banco precisa distinguir.
 */
const num = (s) => {
    const limpo = String(s ?? '').replace(/R\$/gi, '').replace(/\./g, '').replace(',', '.').trim();
    if (!limpo || limpo === '-') return null;
    const n = Number(limpo);
    return Number.isFinite(n) ? n : null;
};

const sql = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const sqlNum = (v) => (v === null ? 'NULL' : String(v));

const caminho = process.argv[2];
if (!caminho) {
    console.error('Uso: node scripts/fast_delivery_carga.mjs <arquivo.csv>');
    process.exit(1);
}

const linhas = lerCsv(readFileSync(caminho, 'utf8')).slice(COLUNAS.linhasDeCabecalho);
const porDestino = new Map();
const avisos = [];
let semVeiculo = 0;

for (const [i, c] of linhas.entries()) {
    const original = (c[COLUNAS.destino] || '').trim();
    if (!original) continue;
    const destino = normalizar(original);
    const origem = normalizar(c[COLUNAS.origem]) || 'GUARULHOS';
    const km = num(c[COLUNAS.km]);
    const pedagio = num(c[COLUNAS.pedagio]);

    // Veículo sem nenhum dos três valores não vira linha: a consulta devolve
    // vazio e a tela diz "não atende", em vez de cotar por R$ 0,00.
    const precos = VEICULOS.map((tipo, k) => {
        const b = COLUNAS.primeiroVeiculo + k * 3;
        return { tipo, nosso_frete: num(c[b]), a_pagar: num(c[b + 1]), sobra: num(c[b + 2]) };
    }).filter((p) => {
        const tem = p.nosso_frete !== null || p.a_pagar !== null || p.sobra !== null;
        if (!tem) semVeiculo++;
        return tem;
    });

    if (porDestino.has(destino)) {
        const antes = porDestino.get(destino);
        const igual = JSON.stringify(antes.precos) === JSON.stringify(precos)
            && antes.km === km && antes.pedagio === pedagio;
        avisos.push(igual
            ? `linha ${i + COLUNAS.linhasDeCabecalho + 1}: "${original}" repete ${destino} com os MESMOS valores — mantida uma só`
            : `linha ${i + COLUNAS.linhasDeCabecalho + 1}: "${original}" repete ${destino} com valores DIFERENTES — MANTIDA A PRIMEIRA, confira`);
        continue;
    }
    porDestino.set(destino, { origem, destino, original, km, pedagio, precos });
}

const out = [];
out.push('-- Carga da tabela de preço Fast Delivery.');
out.push(`-- ${porDestino.size} destinos, gerado de: ${caminho}`);
out.push('-- Reexecutável: atualiza o que já existe em vez de duplicar.');
out.push('BEGIN;');
for (const d of porDestino.values()) {
    out.push('');
    out.push(`-- ${d.original}`);
    out.push(`INSERT INTO public.fast_delivery_destino (origem, destino, destino_original, km, pedagio)`);
    out.push(`VALUES (${sql(d.origem)}, ${sql(d.destino)}, ${sql(d.original)}, ${sqlNum(d.km)}, ${sqlNum(d.pedagio)})`);
    out.push(`ON CONFLICT (origem, destino) DO UPDATE SET`);
    out.push(`  destino_original = EXCLUDED.destino_original, km = EXCLUDED.km,`);
    out.push(`  pedagio = EXCLUDED.pedagio, atualizado_em = now();`);
    for (const p of d.precos) {
        out.push(`INSERT INTO public.fast_delivery_preco (destino_id, tipo_veiculo, nosso_frete, a_pagar, sobra)`);
        out.push(`SELECT id, ${sql(p.tipo)}, ${sqlNum(p.nosso_frete)}, ${sqlNum(p.a_pagar)}, ${sqlNum(p.sobra)}`);
        out.push(`FROM public.fast_delivery_destino WHERE origem=${sql(d.origem)} AND destino=${sql(d.destino)}`);
        out.push(`ON CONFLICT (destino_id, tipo_veiculo) DO UPDATE SET`);
        out.push(`  nosso_frete = EXCLUDED.nosso_frete, a_pagar = EXCLUDED.a_pagar,`);
        out.push(`  sobra = EXCLUDED.sobra, atualizado_em = now();`);
    }
}
out.push('');
out.push('COMMIT;');
console.log(out.join('\n'));

const totalPrecos = [...porDestino.values()].reduce((s, d) => s + d.precos.length, 0);
console.error(`\n-- ${linhas.filter((c) => (c[COLUNAS.destino] || '').trim()).length} linhas -> ${porDestino.size} destinos, ${totalPrecos} preços`);
console.error(`-- ${semVeiculo} combinações destino×veículo sem valor: NÃO viraram linha (consulta devolve vazio, não zero)`);
if (avisos.length) {
    console.error('-- AVISOS:');
    for (const a of avisos) console.error(`--   ${a}`);
}
