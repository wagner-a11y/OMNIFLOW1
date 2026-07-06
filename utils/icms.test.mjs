// Teste da tabela de ICMS (regras 1-6) + simulação da trava manual.
// Roda com: npx tsx utils/icms.test.mjs
import { getIcmsRate, getStandardIcmsRules } from './icms.ts';

let pass = 0, fail = 0;
const check = (label, got, want) => {
    const ok = got === want;
    console.log(`${ok ? 'OK  ' : 'FAIL'} | ${label} => ${got}${ok ? '' : `  (esperado ${want})`}`);
    ok ? pass++ : fail++;
};

// ---- PARTE 1: casos pedidos pelo usuário ----
check('MG->SP, pagador MG (isento)', getIcmsRate('MG', 'SP', {}, true), 0);
check('MG->SP, pagador de outro estado (12%)', getIcmsRate('MG', 'SP', {}, false), 12);
check('RS->ES (7%)', getIcmsRate('RS', 'ES', {}, false), 7);
check('ES->RS (12%, 7% e so destino ES)', getIcmsRate('ES', 'RS', {}, false), 12);
check('SP->RJ (12%)', getIcmsRate('SP', 'RJ', {}, false), 12);
check('SP->BA (7%)', getIcmsRate('SP', 'BA', {}, false), 7);
check('BA->SP (12%, origem fora S/SE)', getIcmsRate('BA', 'SP', {}, false), 12);
check('BA->RJ (12%)', getIcmsRate('BA', 'RJ', {}, false), 12);
check('PE->PE (isento)', getIcmsRate('PE', 'PE', {}, false), 0);

// ---- Cobertura extra das regras ----
check('PR->PR (isento mesmo estado)', getIcmsRate('PR', 'PR', {}, false), 0);
check('MG->MG (isento mesmo estado)', getIcmsRate('MG', 'MG', {}, false), 0);
check('MG->BA, pagador MG (isento, qualquer destino)', getIcmsRate('MG', 'BA', {}, true), 0);
check('MG->BA, pagador nao-MG (7%, S/SE->resto)', getIcmsRate('MG', 'BA', {}, false), 7);
check('PR->ES (7%, destino ES rota S/SE)', getIcmsRate('PR', 'ES', {}, false), 7);
check('MT->PR (12%, origem fora S/SE)', getIcmsRate('MT', 'PR', {}, false), 12);

// ---- Tabela de mesmo estado (origem === destino) ----
check('PE->PE (isento)', getIcmsRate('PE', 'PE', {}, false), 0);
check('PR->PR (isento)', getIcmsRate('PR', 'PR', {}, false), 0);
check('MG->MG (isento)', getIcmsRate('MG', 'MG', {}, false), 0);
check('SC->SC (17%)', getIcmsRate('SC', 'SC', {}, false), 17);
check('RJ->RJ (22%)', getIcmsRate('RJ', 'RJ', {}, false), 22);
check('SP->SP (mesmo estado comum, 12%)', getIcmsRate('SP', 'SP', {}, false), 12);
check('RS->RS (mesmo estado comum, 12%)', getIcmsRate('RS', 'RS', {}, false), 12);
check('ES->ES (mesmo estado, 12% e nao 7% do destino ES)', getIcmsRate('ES', 'ES', {}, false), 12);
check('BA->BA (mesmo estado comum, 12%)', getIcmsRate('BA', 'BA', {}, false), 12);

// ---- Prioridade: isencao vence override manual da matriz da config ----
check('PE->PE vence override 20.5 da matriz (isento)', getIcmsRate('PE', 'PE', { 'PE-PE': 20.5 }, false), 0);
check('MG->SP pagador MG vence override 12 (isento)', getIcmsRate('MG', 'SP', { 'MG-SP': 12 }, true), 0);
check('override manual da config aplica quando nao ha isencao', getIcmsRate('SP', 'RJ', { 'SP-RJ': 5 }, false), 5);

// ---- Matriz padrao coerente com getIcmsRate ----
const m = getStandardIcmsRules();
check('matriz: PE-PE = 0', m['PE-PE'], 0);
check('matriz: SC-SC = 17', m['SC-SC'], 17);
check('matriz: RJ-RJ = 22', m['RJ-RJ'], 22);
check('matriz: SP-SP = 12', m['SP-SP'], 12);
check('matriz: SP-BA = 7', m['SP-BA'], 7);
check('matriz: SP-RJ = 12', m['SP-RJ'], 12);
check('matriz tem 729 pares', Object.keys(m).length, 729);

// ---- PARTE 2: simulacao da trava do ICMS (mesma logica do useEffect do App) ----
// Modelo do estado da tela: loadedRoute = ref da rota da cotacao salva recem-aberta (null = nova/edicao).
const uf = s => (s.match(/\b([A-Z]{2})\b/) || [])[1] || null;
function autoRecompute(f) {
    if (f.icmsManual) return;                     // manual nunca e sobrescrito
    const routeKey = `${f.origin}|${f.destination}|${f.pagadorMg}`;
    if (f.loadedRoute !== null && f.loadedRoute === routeKey) return; // rota salva inalterada: preserva
    f.loadedRoute = null;                         // a partir daqui e edicao do usuario: recalcula
    const o = uf(f.origin), d = uf(f.destination);
    if (o && d) f.icms = String(getIcmsRate(o, d, {}, o === 'MG' && f.pagadorMg));
}
// loadQuote/duplicate/reset do App:
const loadQuote = (q) => ({ origin: q.origin, destination: q.destination, pagadorMg: q.pagadorMg || false, icmsManual: q.icmsManual || false, icms: q.icms, loadedRoute: `${q.origin}|${q.destination}|${q.pagadorMg || false}` });

// Nova cotacao: digita rota SP->RJ, automatico aplica 12.
const nova = { origin: 'Sao Paulo, SP', destination: 'Rio de Janeiro, RJ', pagadorMg: false, icmsManual: false, icms: '12', loadedRoute: null };
autoRecompute(nova);
check('trava: nova cotacao aplica automatico (12)', nova.icms, '12');

// Operador zera o ICMS na mao -> marca manual; automatico nao sobrescreve mais (nem mudando rota).
nova.icms = '0'; nova.icmsManual = true;
autoRecompute(nova);
nova.origin = 'Curitiba, PR'; nova.destination = 'Salvador, BA'; // muda rota
autoRecompute(nova);
check('trava: manual nao e sobrescrito nem ao mudar a rota', nova.icms, '0');

// Cotacao salva MANUAL: reabre e continua no valor da mao.
const salvaManual = loadQuote({ origin: 'Sao Paulo, SP', destination: 'Rio de Janeiro, RJ', pagadorMg: false, icmsManual: true, icms: '0' });
autoRecompute(salvaManual);
check('trava: cotacao salva manual reabre no valor da mao (0)', salvaManual.icms, '0');

// Cotacao salva NAO manual (ICMS antigo 18): reabrir preserva 18 (nao recalcula o passado)...
const salvaAuto = loadQuote({ origin: 'Sao Paulo, SP', destination: 'Sao Paulo, SP', pagadorMg: false, icmsManual: false, icms: '18' });
autoRecompute(salvaAuto);
check('trava: cotacao salva reabre preservando ICMS antigo (18)', salvaAuto.icms, '18');
// ...mas ao mudar o destino, recalcula pela rota nova (SP->RJ = 12).
salvaAuto.destination = 'Rio de Janeiro, RJ';
autoRecompute(salvaAuto);
check('trava: mudar destino na cotacao salva recalcula pela rota nova (12)', salvaAuto.icms, '12');

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
