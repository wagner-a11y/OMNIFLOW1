// Testes do parsing do payload do Gmail. Roda: npx tsx <este arquivo>.
import { base64UrlParaBase64, decodificarTexto, header, corpoEmTexto, htmlParaTexto, arquivosDaMensagem, recebidoEm, achatar } from './gmailPayload.ts';

let pass = 0, fail = 0;
const eq = (label, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    console.log(`${ok ? 'OK  ' : 'FAIL'} | ${label} => ${JSON.stringify(got)}${ok ? '' : `  (esperado ${JSON.stringify(want)})`}`);
    ok ? pass++ : fail++;
};
const b64url = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// ---- base64url -> base64 ----
eq('troca - por +', base64UrlParaBase64('a-b'), 'a-b'.replace('-', '+') + '=');
eq('troca _ por /', base64UrlParaBase64('a_b'), 'a/b=');
eq('padding de 2', base64UrlParaBase64('ab'), 'ab==');
eq('sem padding quando multiplo de 4', base64UrlParaBase64('abcd'), 'abcd');

// ---- texto com acento (o caso que quebra se decodificar errado) ----
eq('decodifica UTF-8 com acento', decodificarTexto(b64url('cotação para São Paulo')), 'cotação para São Paulo');
eq('data vazia', decodificarTexto(''), '');
eq('data corrompida nao quebra', decodificarTexto('!!!nao-e-base64!!!'), '');

// ---- headers ----
const msg = {
    id: 'm1', threadId: 't1', internalDate: '1790700000000',
    payload: {
        mimeType: 'multipart/mixed',
        headers: [{ name: 'From', value: 'cliente@x.com' }, { name: 'SUBJECT', value: 'Frete SP x RJ' }],
        parts: [
            { mimeType: 'text/plain', body: { data: b64url('Segue planilha em anexo.'), size: 24 } },
            { mimeType: 'text/html', body: { data: b64url('<p>Segue planilha em anexo.</p>'), size: 30 } },
            { mimeType: 'image/png', filename: 'print.png', partId: '2', body: { attachmentId: 'att1', size: 1000 } },
            { mimeType: 'application/pdf', filename: 'cotacao.pdf', body: { attachmentId: 'att2', size: 2000 } },
            { mimeType: 'application/zip', filename: 'coisa.zip', body: { attachmentId: 'att3', size: 500 } },
        ],
    },
};
eq('header From', header(msg, 'From'), 'cliente@x.com');
eq('header e case-insensitive', header(msg, 'subject'), 'Frete SP x RJ');
eq('header ausente', header(msg, 'Cc'), '');
eq('recebidoEm vira ISO', recebidoEm(msg), new Date(1790700000000).toISOString());

// ---- corpo: prefere text/plain e NAO soma as duas versoes ----
eq('corpo usa text/plain', corpoEmTexto(msg), 'Segue planilha em anexo.');
// </p> e <br> viram quebras; o que nao pode e sobrar espaco no inicio da linha.
eq('so HTML: converte', corpoEmTexto({ payload: { mimeType: 'text/html', body: { data: b64url('<p>Oi</p><br><div>Frete</div>') } } }), 'Oi\n\nFrete');
eq('nao sobra espaco no inicio da linha', corpoEmTexto({ payload: { mimeType: 'text/html', body: { data: b64url('<div>Origem: SP</div><div>  Destino: RJ</div>') } } }), 'Origem: SP\nDestino: RJ');
eq('sem corpo', corpoEmTexto({ payload: { mimeType: 'application/pdf' } }), '');

// ---- html -> texto ----
eq('tira script/style', htmlParaTexto('<style>x{}</style><script>y()</script><p>Frete SP</p>'), 'Frete SP');
eq('entidades', htmlParaTexto('<p>R$&nbsp;1.000 &amp; carga</p>'), 'R$ 1.000 & carga');

// ---- arquivos: imagem colada + anexo, ZIP fora ----
const r = arquivosDaMensagem(msg);
eq('pegou a imagem e o pdf, ignorou o zip', r.arquivos.map(a => a.nome), ['print.png', 'cotacao.pdf']);
eq('contou 1 ignorado', r.ignorados, 1);
eq('guardou o attachmentId', r.arquivos[0].attachmentId, 'att1');
eq('html NAO entra como arquivo', r.arquivos.some(a => a.mimeType.includes('html')), false);

// ---- limites: o e-mail com muitos prints nao pode estourar a chamada ----
const muitos = {
    payload: {
        mimeType: 'multipart/mixed',
        parts: Array.from({ length: 10 }, (_, i) => ({
            mimeType: 'image/png', filename: `p${i}.png`, body: { attachmentId: `a${i}`, size: 1000 },
        })),
    },
};
eq('teto de arquivos respeitado', arquivosDaMensagem(muitos, 6).arquivos.length, 6);
eq('sobra contabilizada', arquivosDaMensagem(muitos, 6).ignorados, 4);
const pesados = {
    payload: {
        mimeType: 'multipart/mixed',
        parts: Array.from({ length: 5 }, (_, i) => ({
            mimeType: 'image/png', filename: `g${i}.png`, body: { attachmentId: `b${i}`, size: 3 * 1024 * 1024 },
        })),
    },
};
eq('teto de BYTES respeitado (6MB)', arquivosDaMensagem(pesados).arquivos.length, 2);

// ---- defensivo ----
eq('mensagem vazia nao quebra', corpoEmTexto({}), '');
eq('sem payload nao quebra', arquivosDaMensagem({}).arquivos, []);
eq('achatar de undefined', achatar(undefined), []);

console.log(`\n${pass} ok, ${fail} falhas`);
process.exit(fail ? 1 : 0);
