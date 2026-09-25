// Testes da semana BRT. Roda: npx tsx <este arquivo> (ou via esbuild+node).
// O que se testa aqui é o FUSO: a Edge Function roda em UTC e o painel é BRT.
import { hojeYMD, dowBRT, addDias, semanaCorrente } from './semana.ts';

let pass = 0, fail = 0;
const eq = (label, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    console.log(`${ok ? 'OK  ' : 'FAIL'} | ${label} => ${JSON.stringify(got)}${ok ? '' : `  (esperado ${JSON.stringify(want)})`}`);
    ok ? pass++ : fail++;
};

// ---- addDias: aritmetica de calendario, com viradas ----
eq('dia simples', addDias('2026-09-20', 1), '2026-09-21');
eq('vira o mes', addDias('2026-09-30', 1), '2026-10-01');
eq('volta o mes', addDias('2026-10-01', -1), '2026-09-30');
eq('vira o ano', addDias('2026-12-31', 1), '2027-01-01');
eq('fevereiro bissexto', addDias('2028-02-28', 1), '2028-02-29');
eq('fevereiro comum', addDias('2026-02-28', 1), '2026-03-01');

// ---- O CASO QUE MOTIVOU O CUIDADO ----
// Sabado 26/09/2026, 22:00 BRT == domingo 27/09 01:00 UTC.
// Se o codigo usasse getDay() do UTC, a semana pularia para a de 27/09 tres
// horas antes da hora, no meio do expediente de sabado.
const sabado22hBRT = new Date('2026-09-27T01:00:00Z');
eq('sabado 22h BRT: o dia ainda e 26', hojeYMD(sabado22hBRT), '2026-09-26');
eq('sabado 22h BRT: dow = 6 (sabado)', dowBRT(sabado22hBRT), 6);
eq('sabado 22h BRT: semana e a de 20/09',
    semanaCorrente(sabado22hBRT),
    ['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26']);
// Prova do contraste: o UTC desse instante JA e domingo 27.
eq('(contraste) o instante em UTC ja e 27', sabado22hBRT.toISOString().slice(0, 10), '2026-09-27');

// Domingo 00:30 BRT == domingo 03:30 UTC: primeiro dia da semana nova.
const domingo0030BRT = new Date('2026-09-27T03:30:00Z');
eq('domingo 00:30 BRT: dow = 0', dowBRT(domingo0030BRT), 0);
eq('domingo 00:30 BRT: semana comeca em 27',
    semanaCorrente(domingo0030BRT)[0], '2026-09-27');

// Domingo 20:00 BRT == segunda 23:00 UTC? nao: 27/09 23:00 UTC = domingo 20h BRT.
const domingo20hBRT = new Date('2026-09-27T23:00:00Z');
eq('domingo 20h BRT: ainda domingo 27', hojeYMD(domingo20hBRT), '2026-09-27');
eq('domingo 20h BRT: dow = 0', dowBRT(domingo20hBRT), 0);

// ---- A SEMANA QUE ATRAVESSA A VIRADA DE MES (o motivo da tabela) ----
const quinta01out = new Date('2026-10-01T15:00:00Z'); // 12h BRT
eq('semana de 27/09 a 03/10 atravessa o mes',
    semanaCorrente(quinta01out),
    ['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03']);

// ---- Sempre 7 dias, sempre domingo primeiro ----
for (const iso of ['2026-01-01T12:00:00Z', '2026-06-15T12:00:00Z', '2026-12-31T23:59:00Z', '2027-03-01T02:00:00Z']) {
    const s = semanaCorrente(new Date(iso));
    eq(`${iso}: 7 dias, domingo primeiro, sequencia continua`,
        [s.length, dowBRT(new Date(s[0] + 'T15:00:00Z')), addDias(s[0], 6) === s[6]],
        [7, 0, true]);
}

console.log(`\n${pass} ok, ${fail} falhas`);
process.exit(fail ? 1 : 0);
