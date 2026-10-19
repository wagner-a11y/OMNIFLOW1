import { criarCoalescedor } from './coalescer.ts';

let ok = 0, falhas = 0;
const eq = (nome, achado, esperado) => {
    const a = JSON.stringify(achado), e = JSON.stringify(esperado);
    if (a === e) { ok++; } else { falhas++; console.error(`FALHOU: ${nome}\n  esperado: ${e}\n  achado:   ${a}`); }
};

// Relógio falso: agenda callbacks e só os dispara quando o tempo "avança".
// Mesma semântica de setTimeout (one-shot), mas determinístico.
function relogioFalso() {
    let agora = 0, proximoId = 1;
    const tarefas = new Map(); // id -> { quando, fn }
    return {
        agendador: {
            set: (fn, ms) => { const id = proximoId++; tarefas.set(id, { quando: agora + ms, fn }); return id; },
            clear: (id) => { tarefas.delete(id); },
        },
        avancar: (ms) => {
            const alvo = agora + ms;
            // Dispara, em ordem de tempo, tudo que vence até o alvo.
            let guarda = 0;
            while (true) {
                let prox = null;
                for (const [id, t] of tarefas) if (t.quando <= alvo && (prox === null || t.quando < prox.t.quando)) prox = { id, t };
                if (!prox) break;
                agora = prox.t.quando;
                tarefas.delete(prox.id);
                prox.t.fn();
                if (++guarda > 10000) throw new Error('loop do relógio falso');
            }
            agora = alvo;
        },
    };
}

// ---------- 1) rajada na mesma janela => UMA execução ----------
{
    const r = relogioFalso();
    let n = 0;
    const c = criarCoalescedor(() => { n++; }, 1500, r.agendador);
    for (let i = 0; i < 50; i++) c.disparar(); // 50 eventos "ao mesmo tempo"
    eq('rajada: nada executa antes da janela', n, 0);
    r.avancar(1499);
    eq('rajada: ainda não executou em 1499ms', n, 0);
    r.avancar(1);
    eq('rajada: UMA execução ao fechar a janela (50 eventos -> 1)', n, 1);
}

// ---------- 2) novo disparo após a janela => nova execução ----------
{
    const r = relogioFalso();
    let n = 0;
    const c = criarCoalescedor(() => { n++; }, 1500, r.agendador);
    c.disparar(); r.avancar(1500);
    eq('janela 1 executou', n, 1);
    c.disparar(); r.avancar(1500);
    eq('janela 2 executou (total 2)', n, 2);
}

// ---------- 3) cancelar impede a execução pendente ----------
{
    const r = relogioFalso();
    let n = 0;
    const c = criarCoalescedor(() => { n++; }, 1500, r.agendador);
    c.disparar();
    c.cancelar();
    r.avancar(5000);
    eq('cancelar: pendente não executa', n, 0);
}

// ---------- 4) rajada LONGA e contínua => trailing throttle, não trava ----------
// Prova que o Histórico não fica parado numa importação longa: dispara a cada
// janela, uma vez por janela — muitas menos vezes que o nº de eventos.
{
    const r = relogioFalso();
    let n = 0;
    const c = criarCoalescedor(() => { n++; }, 1000, r.agendador);
    // 100 eventos espalhados ao longo de ~5s (um a cada 50ms).
    for (let i = 0; i < 100; i++) { c.disparar(); r.avancar(50); }
    // Em ~5s com janela de 1s, esperam-se ~5 execuções (não 100, nem 0).
    const dentroDoEsperado = n >= 4 && n <= 6;
    eq('rajada longa: coalesce para ~1 por janela (4..6), não 100', dentroDoEsperado, true);
    eq('rajada longa: executou pelo menos uma vez (tela não trava)', n >= 1, true);
}

// ---------- 5) um disparo isolado executa dentro da janela ----------
{
    const r = relogioFalso();
    let n = 0;
    const c = criarCoalescedor(() => { n++; }, 1500, r.agendador);
    c.disparar();
    r.avancar(1500);
    eq('disparo isolado: executa (ao vivo, latência = janela)', n, 1);
}

console.log(`${ok} ok, ${falhas} falhas`);
if (falhas > 0) process.exit(1);
