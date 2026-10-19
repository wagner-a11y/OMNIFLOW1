// Coalescedor de rajadas: junta muitos disparos numa única execução.
//
// Por que existe: a subscription de realtime de `freight_calculations` relia o
// Histórico (getFreightCalculations) a CADA evento, para CADA usuário conectado.
// Um Bid em Lote, a importação Suzano ou o cron do gmail-intake inserem N linhas
// de uma vez -> N eventos -> N releituras da maior tabela, em todos os clientes.
//
// Este coalescedor garante NO MÁXIMO uma execução por janela: o primeiro disparo
// agenda `fn` para daqui a `janelaMs`; qualquer disparo dentro da janela é
// absorvido (não agenda outra). A execução SEMPRE acontece dentro de `janelaMs`
// após o primeiro disparo da rajada — ou seja, o Histórico/funil continua ao
// vivo, com latência máxima = janelaMs (1-2s), em vez de reler a cada evento.
//
// É um "trailing throttle" (não um debounce que reinicia o timer): numa rajada
// contínua ele dispara a intervalos regulares de `janelaMs` em vez de nunca,
// então uma importação longa não deixa a tela parada.

export type Agendador = {
    set: (fn: () => void, ms: number) => number;
    clear: (id: number) => void;
};

// Agendador padrão: usa o relógio do ambiente (window/globalThis).
const agendadorPadrao: Agendador = {
    set: (fn, ms) => (globalThis.setTimeout(fn, ms) as unknown) as number,
    clear: (id) => globalThis.clearTimeout(id as unknown as ReturnType<typeof setTimeout>),
};

export type Coalescedor = {
    /** Pede uma execução. Se já há uma agendada nesta janela, é absorvido. */
    disparar: () => void;
    /** Cancela a execução pendente (usar no cleanup do efeito). */
    cancelar: () => void;
};

export function criarCoalescedor(
    fn: () => void,
    janelaMs: number,
    agendador: Agendador = agendadorPadrao,
): Coalescedor {
    let pendente: number | null = null;

    const disparar = () => {
        if (pendente !== null) return; // já agendado nesta janela -> absorve
        pendente = agendador.set(() => {
            pendente = null;
            fn();
        }, janelaMs);
    };

    const cancelar = () => {
        if (pendente !== null) {
            agendador.clear(pendente);
            pendente = null;
        }
    };

    return { disparar, cancelar };
}
