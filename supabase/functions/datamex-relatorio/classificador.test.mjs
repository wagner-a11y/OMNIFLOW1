// Teste do classificador Bsoft + agregação. Roda com: npx tsx <este arquivo>
import { classifySefaz, agregar, parseValor, dentroDoPeriodo } from './classificador.ts';

let pass = 0, fail = 0;
const eq = (label, got, want) => {
    const ok = got === want;
    console.log(`${ok ? 'OK  ' : 'FAIL'} | ${label} => ${got}${ok ? '' : `  (esperado ${want})`}`);
    ok ? pass++ : fail++;
};

// ---- classifySefaz: casos exigidos ----
eq('100 Autorizado', classifySefaz('100 - Autorizado o uso do CT-e'), 'AUTORIZADO');
eq('101 Cancelamento', classifySefaz('101 - Cancelamento de CT-e homologado'), 'CANCELADO');
eq('rejeição 481', classifySefaz('481 - Rejeição: Falha no reconhecimento da autoria'), 'PENDENTE');
eq('rejeição 531', classifySefaz('531 - Rejeição: total da NF difere do somatório'), 'PENDENTE');
eq('rejeição 717', classifySefaz('717 - Rejeição: XML da área de dados com codificação inválida'), 'PENDENTE');
eq('rejeição 217', classifySefaz('217 - Rejeição: CT-e não consta na base de dados da SEFAZ'), 'PENDENTE');
eq('status vazio', classifySefaz(''), 'PENDENTE');
eq('status nulo', classifySefaz(null), 'PENDENTE');
eq('status undefined', classifySefaz(undefined), 'PENDENTE');

// ---- classifySefaz: cobertura extra ----
eq('110 Denegado', classifySefaz('110 - Uso Denegado'), 'DENEGADO');
eq('301 Denegado emitente', classifySefaz('301 - Uso Denegado: Irregularidade fiscal do emitente'), 'DENEGADO');
eq('302 Denegado destinatario', classifySefaz('302 - Uso Denegado: Irregularidade fiscal do destinatário'), 'DENEGADO');
eq('texto Denegado sem codigo', classifySefaz('Uso Denegado'), 'DENEGADO');
eq('texto Cancelamento sem 101', classifySefaz('Evento de Cancelamento registrado'), 'CANCELADO');
eq('desconhecido vira pendente', classifySefaz('999 - Status inexistente'), 'PENDENTE');

// ---- parseValor: defensivo ----
eq('valor string ponto', parseValor('2552.41'), 2552.41);
eq('valor string virgula', parseValor('2552,41'), 2552.41);
eq('valor numero', parseValor(10), 10);
eq('valor invalido -> null', parseValor('abc'), null);
eq('valor vazio -> null', parseValor(''), null);
eq('valor undefined -> null', parseValor(undefined), null);

// ---- dentroDoPeriodo: corte por data ----
eq('dentro do mes', dentroDoPeriodo('2026-07-08 15:34:36', '2026-07-01', '2026-07-08'), true);
eq('mes anterior fora', dentroDoPeriodo('2026-06-30 23:59:59', '2026-07-01', '2026-07-08'), false);
eq('depois do fim fora', dentroDoPeriodo('2026-07-09 00:00:01', '2026-07-01', '2026-07-08'), false);
eq('data malformada fora', dentroDoPeriodo('sem data', '2026-07-01', '2026-07-08'), false);

// ---- agregar: soma autorizado, trava pendente, descarta cancelado/denegado/CTRC<1000/fora do periodo ----
const registros = [
    { nroConhecimento: '51869', data_emissao: '2026-07-08 15:34:36', valor_frete: '2552.41', statusSefaz: '100 - Autorizado o uso do CT-e', tomador: 'ARAUCO' },
    { nroConhecimento: '51870', data_emissao: '2026-07-08 16:00:00', valor_frete: '1000.00', statusSefaz: '100 - Autorizado o uso do CT-e', tomador: 'CLIENTE B' },
    { nroConhecimento: '51804', data_emissao: '2026-07-08 09:00:00', valor_frete: '4089.98', statusSefaz: '481 - Rejeição: Falha', tomador: 'CLIENTE C' },       // travado
    { nroConhecimento: '51805', data_emissao: '2026-07-08 09:10:00', valor_frete: '500.00',  statusSefaz: '', tomador: 'CLIENTE D' },                              // vazio -> travado
    { nroConhecimento: '51900', data_emissao: '2026-07-08 10:00:00', valor_frete: '9999.99', statusSefaz: '101 - Cancelamento de CT-e homologado', tomador: 'X' }, // cancelado -> fora
    { nroConhecimento: '51901', data_emissao: '2026-07-08 10:00:00', valor_frete: '8888.88', statusSefaz: '110 - Uso Denegado', tomador: 'Y' },                    // denegado -> fora
    { nroConhecimento: '22',    data_emissao: '2026-07-08 11:00:00', valor_frete: '7777.77', statusSefaz: '100 - Autorizado o uso do CT-e', tomador: 'Americanas' },// CTRC<1000 -> fora
    { nroConhecimento: '51999', data_emissao: '2026-06-30 23:00:00', valor_frete: '1234.56', statusSefaz: '100 - Autorizado o uso do CT-e', tomador: 'mes anterior' }, // fora do periodo
    { nroConhecimento: '51555', data_emissao: '2026-07-08 12:00:00', valor_frete: 'xxx',     statusSefaz: '100 - Autorizado o uso do CT-e', tomador: 'malformado' },  // valor invalido -> pendente(0)
];
const r = agregar(registros, '2026-07-01', '2026-07-08', '2026-07-08');
eq('agregar: autorizado = 3552.41', r.faturamentoAutorizado, 3552.41);   // 2552.41 + 1000.00 (7777.77 caiu por CTRC<1000; 1234.56 fora do periodo; xxx malformado)
eq('agregar: autorizado hoje = 3552.41', r.autorizadoHoje, 3552.41);
eq('agregar: autorizadoCount = 2', r.autorizadoCount, 2);
eq('agregar: travado = 4589.98', r.valorTravado, 4589.98);               // 4089.98 (rejeicao) + 500.00 (vazio)
eq('agregar: pendencias = 3', r.pendencias.length, 3);                   // 2 travados + 1 malformado(0)
eq('agregar: descartados = 2', r.descartados, 2);                        // CTRC<1000 (nro 22) + mes anterior (51999). Cancelado/denegado nao contam como descartados.

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
