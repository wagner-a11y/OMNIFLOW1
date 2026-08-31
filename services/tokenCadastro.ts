// ============================================================================
// Token do link de cadastro externo — lado do navegador.
//
// A tela aberta por /cadastro-externo?k=<token> não tem sessão de usuário. O
// que ela apresenta às Edge Functions é este token, no header x-cadastro-token.
// Do outro lado quem confere é supabase/functions/_shared/porta.ts.
//
// O token NÃO está no bundle: chega pela URL, com quem abriu o link. Guardá-lo
// no código seria publicá-lo em todo deploy. E NÃO VOLTA para a URL depois de
// lido — sai da barra de endereços para não vazar em print, em ombro alheio ou
// no histórico do navegador.
//
// ----------------------------------------------------------------------------
// ONDE ELE FICA, E POR QUE MUDOU
//
// Era uma variável de módulo. Sobrevive à navegação dentro da tela, mas morre
// em qualquer RECARGA — e o operador recarregava, porque não havia botão de
// "fazer outro cadastro": terminar um e começar o próximo passava por F5 ou por
// reabrir o link. Como o token já tinha saído da URL, ele sumia, e a tela
// pedia o link de novo. O gargalo de 31/08/2026.
//
// Agora vive no sessionStorage, com a variável como espelho em memória:
//   - sobrevive a recarga E a navegação, DENTRO da mesma aba;
//   - some ao fechar a aba, sem deixar rastro no disco;
//   - não é compartilhado com outras abas — cada aba precisa do próprio link.
//
// localStorage resolveria o mesmo e é o que NÃO se quer: sobreviveria a
// reinicialização do computador e deixaria o segredo guardado numa máquina que
// não é nossa, à espera de alguém.
//
// Sobre o risco: sessionStorage é legível por JavaScript da mesma origem, então
// um XSS o lê. Mas um XSS também lê a variável de módulo — não há regressão de
// segurança aqui, só de duração, e a duração agora é a da aba.
//
// TEMPORÁRIO: não há rastro de quem cadastrou. A evolução planejada é login
// individual com auditoria; quando ela chegar, este arquivo sai inteiro.
// ============================================================================

const CHAVE = 'omniflow.cadastro.token';

/** Espelho em memória: evita ler o storage a cada chamada de header. */
let token: string | null = null;

/** sessionStorage pode não existir (modo restrito). Nunca derruba a tela por isso. */
function storage(): Storage | null {
    try {
        return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
    } catch {
        return null;
    }
}

/**
 * Guarda o token da URL. Chamado uma vez, na entrada da tela externa.
 *
 * `null` LIMPA — é como a tela some com o token ao encerrar a sessão.
 */
export function definirTokenCadastro(t: string | null): void {
    token = t && t.trim() ? t.trim() : null;
    const s = storage();
    if (!s) return;
    try {
        if (token) s.setItem(CHAVE, token);
        else s.removeItem(CHAVE);
    } catch { /* aba em modo restrito: fica só em memória, como antes */ }
}

/**
 * Recupera o token guardado nesta aba, se houver.
 *
 * É o que faz o operador sobreviver a um F5 sem reabrir o link. Devolve `true`
 * quando achou algo, para quem chama saber se ainda precisa do `?k=`.
 */
export function recuperarTokenDaSessao(): boolean {
    if (token) return true;
    const s = storage();
    if (!s) return false;
    try {
        const guardado = s.getItem(CHAVE);
        if (guardado && guardado.trim()) { token = guardado.trim(); return true; }
    } catch { /* segue sem token */ }
    return false;
}

/**
 * Resolve o token na ENTRADA da tela, na ordem que importa:
 *   1. o `?k=` da URL — quem acabou de abrir o link;
 *   2. o sessionStorage — quem já estava cadastrando nesta aba e recarregou.
 *
 * A ordem não é detalhe: um link novo, com token trocado, tem de prevalecer
 * sobre o que a aba guardou. É assim que trocar o secret e reenviar o link surte
 * efeito sem pedir para o operador fechar a aba.
 *
 * Devolve a URL já SEM o `?k=`, para quem chama limpar a barra de endereços.
 * O link continua valendo (o token já está guardado), mas para de aparecer em
 * print, em ombro alheio e no histórico.
 *
 * Está aqui, e não solta no index.tsx, porque um bloco solto se perde: foi
 * exatamente o que aconteceu em 31/08 — um merge restaurou a versão antiga do
 * index.tsx, a leitura do sessionStorage nunca chegou a ser ligada, e o F5
 * continuou perdendo o token. Como função nomeada, ela é testável e some do
 * lugar errado com barulho, não em silêncio.
 */
export function resolverTokenNoBoot(href: string): { limpar: boolean; url: string } {
    const url = new URL(href);
    const daUrl = url.searchParams.get('k');
    if (daUrl && daUrl.trim()) {
        definirTokenCadastro(daUrl);
        url.searchParams.delete('k');
        return { limpar: true, url: url.pathname + url.search + url.hash };
    }
    // Sem `?k=`: pode ser um F5 de quem já estava cadastrando nesta aba.
    recuperarTokenDaSessao();
    return { limpar: false, url: url.pathname + url.search + url.hash };
}

/** Encerra a sessão do link nesta aba. */
export function esquecerTokenCadastro(): void {
    definirTokenCadastro(null);
}

export function temTokenCadastro(): boolean {
    return token !== null;
}

/**
 * Header a mandar nas chamadas de Edge Function.
 *
 * Vazio quando não há token — é o caso do OmniFlow normal, onde quem autentica
 * é a sessão do usuário. Os dois caminhos nunca competem.
 */
export function cabecalhoCadastro(): Record<string, string> {
    return token ? { 'x-cadastro-token': token } : {};
}
