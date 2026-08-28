// ============================================================================
// porta.ts — quem tem direito de chamar as funções de CADASTRO.
//
// Compartilhado pelas funções que criam pessoa/veículo no Datamex e pela que
// lê documento (OCR). Todas gravam ou custam dinheiro; nenhuma pode aceitar
// chamada anônima.
//
// O PROBLEMA QUE ISTO RESOLVE, medido em 28/08/2026:
//   curl -H "Authorization: Bearer <ANON_KEY>" .../cadastrar-veiculo -d '{}'
//   -> HTTP 400 "Placa inválida..."
// Ou seja: a função ACEITOU a chamada e só parou na validação de campo. A anon
// key é pública — vai no bundle JS de produção, é obrigatória para o supabase-js
// funcionar. Qualquer pessoa com o DevTools aberto podia criar veículo no
// Datamex sem login nenhum. O gateway exige "um JWT válido", e a anon key É um
// JWT válido do projeto; ela nunca foi uma credencial.
//
// A REGRA AQUI: passa quem é
//   (a) usuário LOGADO de verdade  — claim role = "authenticated", ou
//   (b) portador do TOKEN do link externo — header x-cadastro-token.
// A anon key sozinha deixa de passar.
//
// Por que dá para ler o claim sem conferir assinatura: o gateway do Supabase
// roda com verify_jwt ligado (provado: sem Authorization a resposta é 401 antes
// de entrar na função). Então todo JWT que chega até aqui JÁ teve a assinatura
// verificada pelo projeto. O que falta é só distinguir anon de authenticated —
// e isso é leitura de claim, não validação de confiança.
//
// ----------------------------------------------------------------------------
// TEMPORÁRIO, E DE PROPÓSITO.
//
// O caminho (b) não tem rastro de usuário: o link é um segredo compartilhado,
// então o Datamex registra o cadastro sem saber QUEM da operação o fez. Foi
// decisão consciente para destravar o time agora.
//
// A evolução planejada é login individual com auditoria de quem cadastrou o
// quê. Quando ela chegar, este arquivo perde o caminho (b) e o secret
// CADASTRO_EXTERNO_TOKEN é apagado.
//
// Enquanto isso valer: trocar o secret revoga TODOS os links de uma vez.
// ============================================================================

/** Comparação em tempo ~constante (evita timing trivial). */
function safeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

/** Papel declarado no JWT que o gateway já validou. "anon" para a chave pública. */
function papelDoJwt(req: Request): string {
    const bruto = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    const partes = bruto.split('.');
    if (partes.length !== 3) return '';
    try {
        // base64url -> base64, com o padding que o atob exige.
        let b64 = partes[1].replace(/-/g, '+').replace(/_/g, '/');
        while (b64.length % 4) b64 += '=';
        const payload = JSON.parse(atob(b64));
        return typeof payload?.role === 'string' ? payload.role : '';
    } catch {
        return '';
    }
}

export type Entrada =
    | { ok: true; via: 'sessao' | 'link' }
    | { ok: false; status: number; erro: string };

/**
 * Decide se a requisição entra.
 *
 * FECHADO POR FALTA: se o secret do link não estiver configurado, o caminho do
 * link simplesmente não existe — nunca vira "deixa passar". Um segredo ausente
 * não pode ser mais permissivo que um segredo presente.
 */
export function conferirPorta(req: Request): Entrada {
    if (papelDoJwt(req) === 'authenticated') return { ok: true, via: 'sessao' };

    const esperado = Deno.env.get('CADASTRO_EXTERNO_TOKEN') || '';
    const recebido = req.headers.get('x-cadastro-token') || '';
    // Token curto demais é erro de configuração, não credencial: barra sempre.
    if (esperado.length >= 32 && recebido && safeEqual(recebido, esperado)) {
        return { ok: true, via: 'link' };
    }

    // A mesma resposta para "sem token", "token errado" e "só anon key": quem
    // está tentando adivinhar não aprende em qual dos casos caiu.
    return { ok: false, status: 401, erro: 'Acesso não autorizado a esta função.' };
}

/** Cabeçalhos de CORS com o header do token liberado. */
export const HEADER_TOKEN = 'x-cadastro-token';
