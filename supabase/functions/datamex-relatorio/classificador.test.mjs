// Testes do classificador Bsoft (contrato novo). Roda: npx tsx <este arquivo>
import { classifySefaz, agregar, parseValor, dentroDoPeriodo, validarContrato } from './classificador.ts';

let pass = 0, fail = 0;
const eq = (label, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    console.log(`${ok ? 'OK  ' : 'FAIL'} | ${label} => ${JSON.stringify(got)}${ok ? '' : `  (esperado ${JSON.stringify(want)})`}`);
    ok ? pass++ : fail++;
};

// ---- classifySefaz ----
eq('100 Autorizado', classifySefaz('100 - Autorizado o uso do CT-e'), 'AUTORIZADO');
eq('101 Cancelamento', classifySefaz('101 - Cancelamento de CT-e homologado'), 'CANCELADO');
eq('rejeição 481', classifySefaz('481 - Rejeição: ...'), 'PENDENTE');
eq('rejeição 531', classifySefaz('531 - Rejeição: ...'), 'PENDENTE');
eq('rejeição 717', classifySefaz('717 - Rejeição: ...'), 'PENDENTE');
eq('rejeição 217', classifySefaz('217 - Rejeicao: ...'), 'PENDENTE');
eq('status vazio', classifySefaz(''), 'PENDENTE');
eq('nulo', classifySefaz(null), 'PENDENTE');
eq('Não Transmitido', classifySefaz('Não Transmitido'), 'PENDENTE');
eq('110 Denegado', classifySefaz('110 - Uso Denegado'), 'DENEGADO');
eq('301 Denegado', classifySefaz('301 - Uso Denegado'), 'DENEGADO');

// ---- validarContrato ----
const base = { id: '1', data_emissao: '2026-07-08', nroConhecimento: '51869', valor_frete: '10.00', tipo_cte: 'Normal', status_sefaz: '100 - Autorizado', substituiCTe: '0' };
eq('contrato ok', validarContrato([base]).ok, true);
eq('contrato: array vazio', validarContrato([]).ok, false);
eq('contrato: não-array', validarContrato({}).ok, false);
{ const semStatus = { ...base }; delete semStatus.status_sefaz;
  const r = validarContrato([semStatus]); eq('contrato: campo status_sefaz ausente -> falha', r.ok, false); }
{ const semSub = { ...base }; delete semSub.substituiCTe;
  eq('contrato: campo substituiCTe ausente -> falha', validarContrato([semSub]).ok, false); }
{ // status vazio em massa (>3) -> falha
  const vazios = Array.from({ length: 5 }, (_, i) => ({ ...base, id: String(i), status_sefaz: '' }));
  eq('contrato: 5 status vazios -> falha', validarContrato(vazios).ok, false);
  const poucos = [base, { ...base, id: '2', status_sefaz: '' }]; // 1 vazio (punhado) -> ok
  eq('contrato: 1 status vazio -> ok', validarContrato(poucos).ok, true); }

// ---- parseValor / período ----
eq('valor ponto', parseValor('2552.41'), 2552.41);
eq('valor invalido', parseValor('xxx'), null);
eq('dentro do mês', dentroDoPeriodo('2026-07-08 15:34:36', '2026-07-01', '2026-07-09'), true);
eq('mês anterior fora', dentroDoPeriodo('2026-06-30 23:59:59', '2026-07-01', '2026-07-09'), false);

// ---- agregar: substituição por id COM CADEIA + armadilha do substituto morto ----
const S = (o) => ({ tipo_cte: 'Normal', status_sefaz: '100 - Autorizado', protocoloCTe: 'P', substituiCTe: '0', data_emissao: '2026-07-08 10:00:00', ...o });
const regs = [
    S({ id: '10', nroConhecimento: '51000', valor_frete: '1000.00' }),                                  // autorizado normal
    // Substituído 51852 (id 20) <- substituto 51853 (id 21, AUTORIZADO): exclui o 20
    S({ id: '20', nroConhecimento: '51852', valor_frete: '6440.64', tipo_cte: 'Substituído' }),
    S({ id: '21', nroConhecimento: '51853', valor_frete: '12881.28', tipo_cte: 'Substituição', substituiCTe: '20' }),
    // Substituído 51851 (id 30) <- substituto 51854 (id 31, NÃO TRANSMITIDO): mantém o 30
    S({ id: '30', nroConhecimento: '51851', valor_frete: '6440.64', tipo_cte: 'Substituído' }),
    S({ id: '31', nroConhecimento: '51854', valor_frete: '6440.64', tipo_cte: 'Substituição', substituiCTe: '30', status_sefaz: 'Não Transmitido', protocoloCTe: '' }),
    // CADEIA: id 40 <- 41 (aut) <- 42 (aut). Mantém só o 42.
    S({ id: '40', nroConhecimento: '51200', valor_frete: '500.00', tipo_cte: 'Substituído' }),
    S({ id: '41', nroConhecimento: '51201', valor_frete: '500.00', tipo_cte: 'Substituição', substituiCTe: '40' }),
    S({ id: '42', nroConhecimento: '51202', valor_frete: '500.00', tipo_cte: 'Substituição', substituiCTe: '41' }),
    // Cancelado (fora)
    S({ id: '50', nroConhecimento: '51300', valor_frete: '9999.99', status_sefaz: '101 - Cancelamento de CT-e homologado' }),
    // Rejeição -> travado
    S({ id: '60', nroConhecimento: '51400', valor_frete: '777.00', status_sefaz: '481 - Rejeição: ...', protocoloCTe: '' }),
];
const r = agregar(regs, '2026-07-01', '2026-07-09', '2026-07-08');
// autorizado = 1000 (id10) + 12881.28 (id21) + 6440.64 (id30 mantido) + 500 (id42) = 20821.92
eq('agregar: faturamento com substituição/cadeia', r.faturamentoAutorizado, 20821.92);
eq('agregar: 51851 (id30) preservado -> conta',
   r.substituidosExcluidos.includes('30'), false);
eq('agregar: excluídos = 20,40,41 (substitutos autorizados)',
   [...r.substituidosExcluidos].sort(), ['20', '40', '41']);
eq('agregar: cancelado fora', r.canceladoCount, 1);
// travado = 51854 Não Transmitido (6440.64, substituto morto do 51851) + rejeição 481 (777)
eq('agregar: travado (não transmitido + rejeição)', r.valorTravado, 7217.64);
// Sentinela: id31 é Não Transmitido (não é 100 -> não gera "autorizado_sem_protocolo");
// id60 é rejeição sem protocolo. Nenhum "autorizado sem protocolo" aqui (todos os 100 têm 'P').
eq('agregar: divergências de protocolo (nenhuma esperada)', r.divergencias.length, 0);

// Sentinela dispara: status 100 SEM protocolo, e protocolo COM rejeição.
const r2 = agregar([
    S({ id: '1', nroConhecimento: '51001', valor_frete: '10.00', protocoloCTe: '' }),                   // 100 sem protocolo
    S({ id: '2', nroConhecimento: '51002', valor_frete: '10.00', status_sefaz: '481 - Rejeição', protocoloCTe: 'X' }), // protocolo com rejeição
], '2026-07-01', '2026-07-09', '2026-07-08');
eq('sentinela: 2 divergências', r2.divergencias.length, 2);
eq('sentinela: valor NÃO muda (100 sem protocolo ainda soma)', r2.faturamentoAutorizado, 10);

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
