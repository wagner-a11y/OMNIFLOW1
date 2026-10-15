/**
 * Stub do cliente Supabase para rodar testes em node.
 *
 * services/supabase.ts lê `import.meta.env`, que só existe sob o Vite: em node
 * o acesso estoura e QUALQUER teste que importe a cadeia de services morria na
 * carga do módulo — é por isso que services/fastDelivery.valorManual.test.mjs
 * nunca rodou. Com este stub o código REAL fica testável sem browser e sem
 * tocar em banco.
 *
 * As respostas vêm de `globalThis.__SUPABASE_FIXTURES__`, um mapa
 * tabela -> linha (ou lista). Tabela sem fixture devolve `null`, que é o que o
 * Supabase devolveria para "não achei" — então o teste exercita o caminho real
 * de ausência em vez de um erro de mock.
 */
type Fixtures = Record<string, unknown>;
const fixtures = (): Fixtures => ((globalThis as any).__SUPABASE_FIXTURES__ ?? {});

const escreveu = (op: string, tabela: string, valores: unknown) => {
    const g = globalThis as any;
    (g.__SUPABASE_WRITES__ ??= []).push({ op, tabela, valores });
};

const consulta = (tabela: string) => {
    const resultado = () => {
        const v = fixtures()[tabela];
        return { data: v === undefined ? null : v, error: null };
    };
    const chain: any = {
        select: () => chain,
        // Escritas: registram o que seria gravado em
        // `globalThis.__SUPABASE_WRITES__` e devolvem sucesso. Registrar em vez
        // de estourar é o que permite testar um caminho que grava DEPOIS de
        // fazer o que interessa — o envio do card grava o pipefy_card_id no fim.
        update: (valores: unknown) => { escreveu('update', tabela, valores); return chain; },
        insert: (valores: unknown) => { escreveu('insert', tabela, valores); return chain; },
        upsert: (valores: unknown) => { escreveu('upsert', tabela, valores); return chain; },
        delete: () => { escreveu('delete', tabela, null); return chain; },
        eq: () => chain,
        in: () => chain,
        is: () => chain,
        not: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => resultado(),
        single: async () => resultado(),
        // `await` direto na consulta (sem maybeSingle) também funciona.
        then: (ok: any, err: any) => Promise.resolve(resultado()).then(ok, err),
    };
    return chain;
};

export const supabase = {
    from: (tabela: string) => consulta(tabela),
    functions: {
        invoke: async () => {
            throw new Error('supabase.functions.invoke() num teste: o stub nao chama Edge Function.');
        },
    },
    auth: { getSession: async () => ({ data: { session: null }, error: null }) },
    storage: { from: () => ({}) },
    channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
    removeChannel: () => undefined,
} as any;
