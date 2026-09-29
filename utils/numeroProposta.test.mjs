// Testes da numeração das duas séries. Roda: npx tsx <este arquivo>.
import { maiorSequencial, proximoNumero, ehNumeroDeEmail, PREFIXO_MANUAL, PREFIXO_EMAIL } from './numeroProposta.ts';

let pass = 0, fail = 0;
const eq = (label, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    console.log(`${ok ? 'OK  ' : 'FAIL'} | ${label} => ${JSON.stringify(got)}${ok ? '' : `  (esperado ${JSON.stringify(want)})`}`);
    ok ? pass++ : fail++;
};

// O caso que motivou a separação: as duas séries no mesmo histórico.
const misto = ['CT-2026-0005', 'EM-2026-0800', 'CT-2026-0007', 'EM-2026-0801', 'CT-2025-0900'];

console.log('--- as series NAO se contaminam ---');
eq('serie manual ignora a de e-mail', proximoNumero(misto, PREFIXO_MANUAL, 2026), 'CT-2026-0008');
eq('serie de e-mail ignora a manual', proximoNumero(misto, PREFIXO_EMAIL, 2026), 'EM-2026-0802');
eq('EM-0800 NAO empurra o CT', maiorSequencial(misto, PREFIXO_MANUAL, 2026), 7);

console.log('\n--- contador por ANO ---');
eq('2025 nao empurra 2026', proximoNumero(['CT-2025-0900'], PREFIXO_MANUAL, 2026), 'CT-2026-0001');
eq('conta dentro do ano certo', proximoNumero(misto, PREFIXO_MANUAL, 2025), 'CT-2025-0901');

console.log('\n--- vazio e lixo ---');
eq('historico vazio', proximoNumero([], PREFIXO_MANUAL, 2026), 'CT-2026-0001');
eq('so nulos', proximoNumero([null, undefined, ''], PREFIXO_MANUAL, 2026), 'CT-2026-0001');
eq('numero fora do padrao nao conta', proximoNumero(['COTACAO 9999', 'xpto-2026-5000'], PREFIXO_MANUAL, 2026), 'CT-2026-0001');
eq('espacos nas pontas', maiorSequencial(['  CT-2026-0042  '], PREFIXO_MANUAL, 2026), 42);
eq('prefixo parecido nao casa', maiorSequencial(['XCT-2026-0900'], PREFIXO_MANUAL, 2026), 0);
eq('sufixo depois do numero nao casa', maiorSequencial(['CT-2026-0900-B'], PREFIXO_MANUAL, 2026), 0);

console.log('\n--- padding e virada de milhar ---');
eq('padding de 4', proximoNumero(['CT-2026-0001'], PREFIXO_MANUAL, 2026), 'CT-2026-0002');
eq('passa de 9999 sem truncar', proximoNumero(['CT-2026-9999'], PREFIXO_MANUAL, 2026), 'CT-2026-10000');

console.log('\n--- reconhecer origem pelo numero ---');
eq('EM e de e-mail', ehNumeroDeEmail('EM-2026-0001'), true);
eq('CT nao e', ehNumeroDeEmail('CT-2026-0001'), false);
eq('nulo nao e', ehNumeroDeEmail(null), false);

console.log(`\n${pass} ok, ${fail} falhas`);
process.exit(fail ? 1 : 0);
