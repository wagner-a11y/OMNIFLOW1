// Testes da camada HTTP/contrato (interpretarResposta + extrairRegistros).
// Roda: npx tsx <este arquivo>
import { interpretarResposta, extrairRegistros } from './fonteApiBsoft.ts';

let pass = 0, fail = 0;
const throws = (label, fn, reMatch) => {
    let ok = false, msg = '';
    try { fn(); } catch (e) { ok = true; msg = e.message; }
    if (ok && reMatch) ok = reMatch.test(msg);
    console.log(`${ok ? 'OK  ' : 'FAIL'} | ${label}${ok ? '' : `  (não lançou/erro divergente: ${msg})`}`);
    ok ? pass++ : fail++;
};
const eq = (label, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    console.log(`${ok ? 'OK  ' : 'FAIL'} | ${label}`);
    ok ? pass++ : fail++;
};

const jsonBody = JSON.stringify([{ id: '1', status_sefaz: '100' }]);

// 401 / 403 -> lança
throws('HTTP 401 lança (não autorizado)', () => interpretarResposta(401, 'application/json', jsonBody), /não autorizado|401/);
throws('HTTP 403 lança', () => interpretarResposta(403, 'application/json', jsonBody), /não autorizado|403/);
// 500 -> lança
throws('HTTP 500 lança (erro do servidor)', () => interpretarResposta(500, 'application/json', jsonBody), /servidor|500/);
throws('HTTP 502 lança', () => interpretarResposta(502, 'application/json', jsonBody), /servidor|502/);
// corpo HTML (mesmo com 200) -> lança
throws('corpo HTML com 200 lança', () => interpretarResposta(200, 'text/html', '<!DOCTYPE html><html><body>login</body></html>'), /HTML/);
throws('corpo <html> sem content-type lança', () => interpretarResposta(200, '', '<html><head></head></html>'), /HTML/);
// JSON inválido -> lança
throws('JSON inválido lança', () => interpretarResposta(200, 'application/json', 'isto não é json'), /não é JSON/);
// 200 JSON válido -> retorna o array
eq('200 JSON válido retorna dados', interpretarResposta(200, 'application/json', jsonBody), [{ id: '1', status_sefaz: '100' }]);

// extrairRegistros tolera envelopes
eq('extrai array puro', extrairRegistros([{ a: 1 }]), [{ a: 1 }]);
eq('extrai de {itens}', extrairRegistros({ itens: [{ a: 1 }] }), [{ a: 1 }]);
eq('extrai de {dados}', extrairRegistros({ dados: [{ a: 2 }] }), [{ a: 2 }]);
eq('sem array -> []', extrairRegistros({ foo: 'bar' }), []);

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
