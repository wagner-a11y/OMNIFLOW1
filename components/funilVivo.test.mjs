import { COLUNAS_ABERTAS, STATUS_DO_REALIZADO, doMes, apareceNaColuna, somarRealizado } from './funilVivo.ts';

let ok = 0, falhas = 0;
const eq = (nome, achado, esperado) => {
    const a = JSON.stringify(achado), e = JSON.stringify(esperado);
    if (a === e) { ok++; } else { falhas++; console.error(`FALHOU: ${nome}\n  esperado: ${e}\n  achado:   ${a}`); }
};

/** Data local, do jeito que o board lê (getFullYear/getMonth são locais). */
const ts = (ano, mes, dia, h = 12) => new Date(ano, mes - 1, dia, h).getTime();
const q = (status, ano, mes, dia, valor = 0) => ({ status, createdAt: ts(ano, mes, dia), totalFreight: valor });

// ---------- doMes ----------
eq('doMes: dentro do mês', doMes(q('pending', 2026, 9, 15), 2026, 9), true);
eq('doMes: mês anterior', doMes(q('pending', 2026, 8, 31), 2026, 9), false);
eq('doMes: mês seguinte', doMes(q('pending', 2026, 10, 1), 2026, 9), false);
eq('doMes: mesmo mês, outro ano', doMes(q('pending', 2025, 9, 15), 2026, 9), false);
eq('doMes: primeiro instante do mês', doMes({ ...q('pending', 2026, 9, 1), createdAt: ts(2026, 9, 1, 0) }, 2026, 9), true);
eq('doMes: último instante do mês', doMes({ ...q('pending', 2026, 9, 30), createdAt: new Date(2026, 8, 30, 23, 59, 59).getTime() }, 2026, 9), true);

// ---------- colunas abertas ignoram o mês ----------
for (const col of COLUNAS_ABERTAS) {
    eq(`aberta ${col}: mês passado aparece`, apareceNaColuna(q(col, 2026, 8, 10), col, 2026, 9), true);
    eq(`aberta ${col}: mês corrente aparece`, apareceNaColuna(q(col, 2026, 9, 10), col, 2026, 9), true);
    eq(`aberta ${col}: ano passado aparece`, apareceNaColuna(q(col, 2025, 3, 10), col, 2026, 9), true);
}
eq('COLUNAS_ABERTAS é exatamente o combinado', COLUNAS_ABERTAS, ['pending', 'respondida', 'aprovada', 'carregando']);

// ---------- colunas de desfecho seguem mensais ----------
for (const col of ['won', 'lost']) {
    eq(`desfecho ${col}: mês corrente aparece`, apareceNaColuna(q(col, 2026, 9, 10), col, 2026, 9), true);
    eq(`desfecho ${col}: mês passado NÃO aparece`, apareceNaColuna(q(col, 2026, 8, 10), col, 2026, 9), false);
    eq(`desfecho ${col}: mês seguinte NÃO aparece`, apareceNaColuna(q(col, 2026, 10, 2), col, 2026, 9), false);
}

// ---------- o Realizado NÃO pode inflar ----------
const base = [
    q('aprovada',   2026, 9, 5, 1000),   // conta
    q('carregando', 2026, 9, 6, 2000),   // conta
    q('won',        2026, 9, 7, 3000),   // conta
    q('em_operacao',2026, 9, 8, 500),    // conta (legado)
    q('pending',    2026, 9, 9, 9999),   // NÃO conta: em aberto
    q('respondida', 2026, 9, 9, 8888),   // NÃO conta: em aberto
    q('lost',       2026, 9, 9, 7777),   // NÃO conta: perdida
    q('spot_simulated', 2026, 9, 9, 6666), // NÃO conta: simulação
    q('aprovada',   2026, 8, 5, 50000),  // NÃO conta: outro mês
    q('won',        2026, 10, 5, 40000), // NÃO conta: outro mês
    q('carregando', 2025, 9, 5, 30000),  // NÃO conta: outro ano
];
eq('realizado soma só os 4 status do mês', somarRealizado(base, 2026, 9), 1000 + 2000 + 3000 + 500);
eq('realizado do mês vazio é zero', somarRealizado(base, 2026, 7), 0);
eq('realizado do mês anterior isolado', somarRealizado(base, 2026, 8), 50000);
eq('realizado ignora totalFreight ausente', somarRealizado([{ status: 'won', createdAt: ts(2026, 9, 1) }], 2026, 9), 0);
eq('STATUS_DO_REALIZADO é exatamente o de antes', STATUS_DO_REALIZADO, ['aprovada', 'carregando', 'won', 'em_operacao']);

// ---------- EQUIVALÊNCIA com a regra ANTIGA (a conta da meta não mudou) ----------
// Regra antiga: filtrava TUDO por mês, empilhava em colunas (status desconhecido
// caía em pending) e somava cols.aprovada + carregando + won + em_operacao.
const realizadoAntigo = (quotes, ano, mes) => {
    const cols = { pending: [], respondida: [], aprovada: [], carregando: [], em_operacao: [], won: [], lost: [], spot_simulated: [] };
    quotes.filter(x => doMes(x, ano, mes)).forEach(x => {
        if (cols[x.status]) cols[x.status].push(x); else cols.pending.push(x);
    });
    return [...cols.aprovada, ...cols.carregando, ...cols.won, ...cols.em_operacao]
        .reduce((a, c) => a + (c.totalFreight || 0), 0);
};
const STATUS = ['pending', 'respondida', 'aprovada', 'carregando', 'won', 'lost', 'em_operacao', 'spot_simulated', 'status_que_nao_existe'];
let sementes = 0;
for (let i = 0; i < 400; i++) {
    const n = i % 13;
    const amostra = Array.from({ length: n }, (_, j) => {
        const st = STATUS[(i * 7 + j * 3) % STATUS.length];
        const mes = 1 + ((i + j) % 12);
        const ano = 2025 + ((i + j) % 2);
        return q(st, ano, mes, 1 + ((i + j) % 28), (i * 13 + j * 7) % 5000);
    });
    for (const mes of [1, 6, 9, 12]) {
        eq(`equivalência i=${i} mes=${mes}`, somarRealizado(amostra, 2026, mes), realizadoAntigo(amostra, 2026, mes));
        sementes++;
    }
}

console.log(`${ok} ok, ${falhas} falhas (incluindo ${sementes} comparações contra a regra antiga)`);
process.exit(falhas === 0 ? 0 : 1);
