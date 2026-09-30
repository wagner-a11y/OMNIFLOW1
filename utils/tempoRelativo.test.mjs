import { haQuantoTempo } from './tempoRelativo.ts';

let ok = 0, falhas = 0;
const eq = (nome, achado, esperado) => {
    if (achado === esperado) ok++;
    else { falhas++; console.error(`FALHOU: ${nome}\n  esperado: ${esperado}\n  achado:   ${achado}`); }
};

const AGORA = new Date('2026-09-30T12:00:00Z').getTime();
const atras = (ms) => new Date(AGORA - ms).toISOString();
const SEG = 1000, MIN = 60 * SEG, H = 60 * MIN, D = 24 * H;

eq('nulo', haQuantoTempo(null, AGORA), 'nunca');
eq('indefinido', haQuantoTempo(undefined, AGORA), 'nunca');
eq('vazio', haQuantoTempo('', AGORA), 'nunca');
eq('lixo não vira NaN', haQuantoTempo('nao-e-data', AGORA), 'nunca');

eq('0 s', haQuantoTempo(atras(0), AGORA), 'agora há pouco');
eq('59 s', haQuantoTempo(atras(59 * SEG), AGORA), 'agora há pouco');
eq('relógio adiantado não vira negativo', haQuantoTempo(atras(-30 * SEG), AGORA), 'agora há pouco');

eq('60 s vira 1 min', haQuantoTempo(atras(60 * SEG), AGORA), 'há 1 min');
eq('2 min', haQuantoTempo(atras(2 * MIN), AGORA), 'há 2 min');
eq('59 min', haQuantoTempo(atras(59 * MIN), AGORA), 'há 59 min');

eq('60 min vira 1 h', haQuantoTempo(atras(60 * MIN), AGORA), 'há 1 h');
eq('2 h', haQuantoTempo(atras(2 * H), AGORA), 'há 2 h');
eq('23 h', haQuantoTempo(atras(23 * H), AGORA), 'há 23 h');

eq('24 h vira 1 dia', haQuantoTempo(atras(24 * H), AGORA), 'há 1 dia');
eq('3 dias', haQuantoTempo(atras(3 * D), AGORA), 'há 3 dias');
eq('30 dias', haQuantoTempo(atras(30 * D), AGORA), 'há 30 dias');

// O caso que importa de verdade: com o cron de 1 min, "há 2 min" é normal e
// "há 5 h" é o robô parado. Os dois precisam ser distinguíveis na tela.
eq('cron saudável', haQuantoTempo(atras(2 * MIN), AGORA), 'há 2 min');
eq('cron parado', haQuantoTempo(atras(5 * H), AGORA), 'há 5 h');

console.log(`${ok} ok, ${falhas} falhas`);
process.exit(falhas === 0 ? 0 : 1);
