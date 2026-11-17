// `npm test`: roda todas as suítes *.test.mjs, cada uma no seu processo (todas
// chamam process.exit). As que importam services/supabase precisam do stub
// de import.meta.env; ele vai em todas, porque não muda quem não o usa.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const PASTAS = ['utils', 'services', 'components'];
const suites = PASTAS.flatMap(p => readdirSync(p).filter(f => f.endsWith('.test.mjs')).map(f => join(p, f)));

const falhas = [];
for (const s of suites) {
    const r = spawnSync('npx', ['tsx', '--import', './scripts/testing/registerStub.mjs', s], { encoding: 'utf-8' });
    const ultima = (r.stdout || '').trim().split('\n').pop();
    const passou = r.status === 0;
    console.log(`${passou ? 'OK  ' : 'FAIL'} | ${s} :: ${ultima}`);
    if (!passou) { falhas.push(s); console.log(r.stdout, r.stderr); }
}
console.log(`\n${suites.length - falhas.length}/${suites.length} suítes ok`);
process.exit(falhas.length ? 1 : 0);
