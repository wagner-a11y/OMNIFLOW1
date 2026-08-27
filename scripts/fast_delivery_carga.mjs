#!/usr/bin/env node
// =====================================================================
// Carregador da tabela de preço Fast Delivery.
//
// Lê a planilha COLADA (TSV — copiar do Excel e colar já vem separado por
// tabulação) e imprime o SQL de carga. Não executa nada: quem aplica é você,
// depois de ler o que saiu.
//
//   pbpaste | node scripts/fast_delivery_carga.mjs > carga.sql
//
// FORMATO ESPERADO — uma linha por destino, cabeçalho na primeira linha:
//   DESTINO  KM  PEDAGIO  FIORINO_NOSSO  FIORINO_PAGAR  FIORINO_SOBRA  VAN_...
// A ordem dos veículos é a de VEICULOS abaixo; ajuste se a planilha mudar.
//
// POR QUE GERA SQL EM VEZ DE GRAVAR: preço é dado que a operação usa para
// pagar terceiro. Um script que escreve direto no banco a partir de um colar
// de planilha é rápido de rodar e difícil de conferir. Assim você lê o
// resultado antes de qualquer coisa entrar.
// =====================================================================

const VEICULOS = ['FIORINO', 'VAN', '3/4', 'TOCO', 'TRUCK', 'CARRETA'];

/** MESMA regra da fast_delivery_normaliza() do banco. */
const normalizar = (s) =>
    (s || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toUpperCase()
        .replace(/\(\s*\d+\s*\)/g, '')     // "São Paulo (2)" -> "São Paulo"
        .replace(/\s+/g, ' ')
        .trim();

/** "1.234,56" e "R$ 1.234,56" viram 1234.56. Vazio vira null. */
const num = (s) => {
    const limpo = String(s ?? '').replace(/R\$/gi, '').replace(/\./g, '').replace(',', '.').trim();
    if (!limpo || limpo === '-') return null;
    const n = Number(limpo);
    return Number.isFinite(n) ? n : null;
};

const sql = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const sqlNum = (v) => (v === null ? 'NULL' : String(v));

const entrada = await new Promise((resolve) => {
    let b = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => (b += d));
    process.stdin.on('end', () => resolve(b));
});

const linhas = entrada.split(/\r?\n/).filter((l) => l.trim());
if (linhas.length < 2) {
    console.error('Nada para carregar. Cole a planilha (TSV) na entrada padrão.');
    process.exit(1);
}

// Primeira linha é cabeçalho.
const dados = linhas.slice(1);
const porDestino = new Map();
const avisos = [];

for (const [i, linha] of dados.entries()) {
    const c = linha.split('\t');
    const original = (c[0] || '').trim();
    if (!original) continue;
    const destino = normalizar(original);
    const km = num(c[1]);
    const pedagio = num(c[2]);

    const precos = VEICULOS.map((tipo, k) => ({
        tipo,
        nosso_frete: num(c[3 + k * 3]),
        a_pagar: num(c[4 + k * 3]),
        sobra: num(c[5 + k * 3]),
    })).filter((p) => p.nosso_frete !== null || p.a_pagar !== null || p.sobra !== null);

    if (porDestino.has(destino)) {
        // "(2)" é a mesma cidade. Só avisa se os valores divergirem — aí não é
        // repetição, é conflito, e alguém precisa decidir qual vale.
        const antes = porDestino.get(destino);
        const igual = JSON.stringify(antes.precos) === JSON.stringify(precos)
            && antes.km === km && antes.pedagio === pedagio;
        avisos.push(igual
            ? `linha ${i + 2}: "${original}" repete ${destino} com os mesmos valores — mantida uma só`
            : `linha ${i + 2}: "${original}" repete ${destino} com valores DIFERENTES — MANTIDA A PRIMEIRA, confira`);
        continue;
    }
    porDestino.set(destino, { destino, original, km, pedagio, precos });
}

const out = [];
out.push('-- Carga da tabela de preço Fast Delivery.');
out.push(`-- ${porDestino.size} destinos.`);
out.push('-- Reexecutável: atualiza o que já existe em vez de duplicar.');
out.push('BEGIN;');
for (const d of porDestino.values()) {
    out.push('');
    out.push(`-- ${d.original}`);
    out.push(`INSERT INTO public.fast_delivery_destino (origem, destino, destino_original, km, pedagio)`);
    out.push(`VALUES ('GUARULHOS', ${sql(d.destino)}, ${sql(d.original)}, ${sqlNum(d.km)}, ${sqlNum(d.pedagio)})`);
    out.push(`ON CONFLICT (origem, destino) DO UPDATE SET`);
    out.push(`  destino_original = EXCLUDED.destino_original, km = EXCLUDED.km,`);
    out.push(`  pedagio = EXCLUDED.pedagio, atualizado_em = now();`);
    for (const p of d.precos) {
        out.push(`INSERT INTO public.fast_delivery_preco (destino_id, tipo_veiculo, nosso_frete, a_pagar, sobra)`);
        out.push(`SELECT id, ${sql(p.tipo)}, ${sqlNum(p.nosso_frete)}, ${sqlNum(p.a_pagar)}, ${sqlNum(p.sobra)}`);
        out.push(`FROM public.fast_delivery_destino WHERE origem='GUARULHOS' AND destino=${sql(d.destino)}`);
        out.push(`ON CONFLICT (destino_id, tipo_veiculo) DO UPDATE SET`);
        out.push(`  nosso_frete = EXCLUDED.nosso_frete, a_pagar = EXCLUDED.a_pagar,`);
        out.push(`  sobra = EXCLUDED.sobra, atualizado_em = now();`);
    }
}
out.push('');
out.push('COMMIT;');

console.log(out.join('\n'));
if (avisos.length) {
    console.error('\n-- AVISOS (leia antes de aplicar):');
    for (const a of avisos) console.error(`--   ${a}`);
}
console.error(`\n-- ${porDestino.size} destinos, ${[...porDestino.values()].reduce((s, d) => s + d.precos.length, 0)} preços.`);
