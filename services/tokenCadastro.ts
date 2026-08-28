// ============================================================================
// Token do link de cadastro externo — lado do navegador.
//
// A tela aberta por /cadastro-externo?k=<token> não tem sessão de usuário. O
// que ela apresenta às Edge Functions é este token, no header x-cadastro-token.
// Do outro lado quem confere é supabase/functions/_shared/porta.ts.
//
// O token NÃO está no bundle: chega pela URL, em quem abriu o link. Guardá-lo
// no código seria publicá-lo em todo deploy.
//
// FICA SÓ EM MEMÓRIA. Nada de localStorage/sessionStorage: fechou a aba, some.
// Um segredo que sobrevive ao fechamento da aba é um segredo esquecido no
// computador de quem usou o link — e esses computadores não são nossos.
//
// TEMPORÁRIO: não há rastro de quem cadastrou. A evolução planejada é login
// individual com auditoria; quando ela chegar, este arquivo sai inteiro.
// ============================================================================

let token: string | null = null;

/** Guarda o token da URL. Chamado uma vez, na entrada da tela externa. */
export function definirTokenCadastro(t: string | null): void {
    token = t && t.trim() ? t.trim() : null;
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
