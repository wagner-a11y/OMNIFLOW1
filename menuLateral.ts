// ============================================================================
// Barra lateral — QUEM VÊ O QUÊ.
//
// Mora fora do App.tsx de propósito. A trava de papel é a parte da barra
// lateral que precisa ser conferível, e dentro de 5 mil linhas de JSX ela não
// era: dava para ler, não para EXECUTAR. Aqui é uma função pura, que o teste
// scripts/menu_papeis.mjs roda de verdade com os dois papéis.
//
// Ícones ficam no App.tsx (mapa por id). Este módulo não conhece React nem
// lucide — é o que permite rodá-lo no node sem montar a árvore inteira.
//
// A trava é ITEM A ITEM (`master: true`), nunca só na seção: esconder o título
// não protegeria nada. Uma seção some quando não sobra item para o usuário.
//
// E isto é trava de TELA. Quem protege o dado é a RLS do banco, que exige
// public.is_master() para escrever nas tabelas cd_*.
// ============================================================================

/** Ações que abrem um modal em vez de trocar de tela. O App liga cada uma à sua função. */
export type AcaoMenu = 'emergencia' | 'config-sistema' | 'trocar-senha';

export interface ItemMenu {
    /** Vira `activeTab`, ou identifica o item quando ele é ação/link. */
    id: string;
    label: string;
    /** Só master vê. */
    master?: boolean;
    /** Abre em nova aba, em vez de trocar de tela. */
    href?: string;
    /** Abre um modal, em vez de trocar de tela. */
    acao?: AcaoMenu;
    /** Pinta o item (emergência ligada). */
    destaque?: boolean;
    /** Subgrupo recolhível — um nível só. */
    filhos?: ItemMenu[];
}

export interface SecaoMenu {
    id: string;
    titulo: string;
    itens: ItemMenu[];
}

export interface ContextoMenu {
    master: boolean;
    /** Sem token não há Painel TV para abrir: o item nem entra. */
    painelTvToken?: string | null;
    emergenciaLigada: boolean;
    mostrarAcoesComercial: boolean;
    mostrarNegociacoes: boolean;
}

/**
 * Monta a barra lateral JÁ FILTRADA para o papel recebido.
 *
 * Devolver a lista pronta, em vez de deixar o filtro no JSX, é o que garante
 * que a tela não tem como mostrar item de master a quem não é: não existe
 * caminho no App que pule este filtro.
 */
export function montarMenu(ctx: ContextoMenu): { secoes: SecaoMenu[]; soltos: ItemMenu[] } {
    const acoesComercial: ItemMenu[] = ctx.mostrarAcoesComercial ? [{
        id: 'acoes-comercial',
        label: 'Ações do Comercial',
        // Todos VEEM. Quem não é master abre "Minha Carteira" em modo consulta —
        // a trava de edição é dentro da tela, não aqui.
        filhos: [
            { id: 'contato-diario', label: 'Minha Carteira' },
            { id: 'cd-cobranca', label: 'Contato Diário · Análise' },
            { id: 'cd-registro', label: 'Contato Diário · Registrar' },
            ...(ctx.mostrarNegociacoes
                ? [{ id: 'negocios', label: 'Acompanhamento de Negociações' }]
                : []),
        ],
    }] : [];

    const painelTv: ItemMenu[] = ctx.painelTvToken ? [{
        id: 'painel-tv',
        label: 'Painel TV',
        href: `https://omniflow-1-gamma.vercel.app/painel-tv?k=${ctx.painelTvToken}`,
    }] : [];

    const secoes: SecaoMenu[] = [
        {
            id: 'comercial', titulo: 'Comercial', itens: [
                { id: 'prospeccao', label: 'Meu CRM', master: true },
                { id: 'new', label: 'Nova Cotação' },
                { id: 'dashboard', label: 'Dashboard' },
                ...acoesComercial,
                ...painelTv,
                { id: 'history', label: 'Histórico' },
            ],
        },
        {
            id: 'operacional', titulo: 'Operacional', itens: [
                { id: 'tracking', label: 'Acompanhamento PPFY' },
                { id: 'fast-delivery', label: 'Fast Delivery' },
            ],
        },
        {
            id: 'cadastros', titulo: 'Cadastros', itens: [
                // "Cadastro Pessoa" é o motorista, e já cobre o motorista que
                // TAMBÉM é dono (tem o marcador de proprietário e o RNTRC).
                { id: 'cadastro-motorista', label: 'Cadastro Motorista' },
                // Só o dono: pessoa física sem CNH ou empresa. Quem dirige vai
                // no item de cima.
                { id: 'cadastro-proprietario', label: 'Cadastro Proprietário' },
                { id: 'cadastro-veiculo', label: 'Cadastro Veículo' },
                { id: 'cadastro-conjunto', label: 'Cadastro Conjunto' },
            ],
        },
        {
            id: 'config', titulo: 'Configurações', itens: [
                {
                    id: 'emergencia', master: true, acao: 'emergencia',
                    label: ctx.emergenciaLigada ? 'Emergência LIGADA' : 'Modo emergência',
                    destaque: ctx.emergenciaLigada,
                },
                { id: 'config-sistema', label: 'Configurações do sistema', master: true, acao: 'config-sistema' },
                { id: 'trocar-senha', label: 'Trocar senha', master: true, acao: 'trocar-senha' },
            ],
        },
    ];

    const soltos: ItemMenu[] = [
        { id: 'trash', label: 'Lixeira', master: true },
    ];

    const visivel = (it: ItemMenu) => !it.master || ctx.master;

    return {
        secoes: secoes
            .map(s => ({
                ...s,
                itens: s.itens
                    .filter(visivel)
                    .map(it => (it.filhos ? { ...it, filhos: it.filhos.filter(visivel) } : it))
                    // Subgrupo que ficou sem filho nenhum não vira título vazio.
                    .filter(it => !it.filhos || it.filhos.length > 0),
            }))
            .filter(s => s.itens.length > 0),
        soltos: soltos.filter(visivel),
    };
}
