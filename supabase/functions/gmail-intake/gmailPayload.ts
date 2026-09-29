// Leitura do payload de uma mensagem do Gmail. PURO (sem I/O), como o
// classificador.ts: é a parte que erra em silêncio, então é a parte que o teste
// alcança.
//
// O e-mail de cotação raramente traz o dado no texto. Ele vem num print colado
// no corpo, ou numa planilha anexa, e o texto só diz "segue em anexo". Por isso
// aqui não se extrai "o corpo": extrai-se o corpo E as imagens E os anexos, que
// vão juntos numa única chamada ao Gemini.

/** Uma parte do MIME, como o Gmail devolve em messages.get?format=full. */
export interface GmailPart {
    partId?: string;
    mimeType?: string;
    filename?: string;
    headers?: Array<{ name?: string; value?: string }>;
    body?: { size?: number; data?: string; attachmentId?: string };
    parts?: GmailPart[];
}

export interface GmailMessage {
    id?: string;
    threadId?: string;
    internalDate?: string;          // epoch ms, em texto
    payload?: GmailPart;
}

/** Anexo/imagem a buscar e mandar ao Gemini. `data` vem depois, se for attachmentId. */
export interface Arquivo {
    nome: string;
    mimeType: string;
    /** Conteúdo já embutido no payload (partes pequenas vêm assim). */
    data?: string;
    /** Quando o conteúdo mora fora, buscado por messages/{id}/attachments/{attachmentId}. */
    attachmentId?: string;
    tamanho: number;
}

/**
 * base64url (o que o Gmail usa) -> base64 padrão (o que o Gemini espera).
 *
 * Não é preciosismo: '-' e '_' no lugar de '+' e '/' fazem o binário chegar
 * corrompido, e a falha aparece como "o modelo não entendeu a imagem", que
 * manda procurar no lugar errado.
 */
export const base64UrlParaBase64 = (s: string): string => {
    const t = (s || '').replace(/-/g, '+').replace(/_/g, '/');
    const resto = t.length % 4;
    return resto ? t + '='.repeat(4 - resto) : t;
};

/** Decodifica o corpo textual de uma parte (base64url -> texto UTF-8). */
export function decodificarTexto(data?: string): string {
    if (!data) return '';
    try {
        const bin = atob(base64UrlParaBase64(data));
        const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
        return new TextDecoder('utf-8').decode(bytes);
    } catch {
        return '';
    }
}

/** Valor de um header do e-mail, sem diferenciar maiúsculas. */
export function header(msg: GmailMessage, nome: string): string {
    const hs = msg?.payload?.headers || [];
    const alvo = nome.toLowerCase();
    return hs.find(h => (h?.name || '').toLowerCase() === alvo)?.value || '';
}

/** Todas as partes da árvore MIME, achatadas. */
export function achatar(part?: GmailPart): GmailPart[] {
    if (!part) return [];
    return [part, ...(part.parts || []).flatMap(achatar)];
}

/** Tira as tags de um corpo HTML e devolve texto legível. */
export function htmlParaTexto(html: string): string {
    return (html || '')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"')
        .replace(/[ \t]+/g, ' ')
        // Cada linha limpa nas pontas: sem isso, "</p><br><div>" deixa um espaço
        // solto no começo da linha seguinte e o texto chega sujo na extração.
        .split('\n').map(l => l.trim()).join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * O corpo em texto. Prefere text/plain; se só houver HTML, converte.
 *
 * Nada de concatenar os dois: quase todo e-mail traz as duas versões do MESMO
 * conteúdo, e somar as duas dobraria o texto e confundiria a extração.
 */
export function corpoEmTexto(msg: GmailMessage): string {
    const partes = achatar(msg?.payload);
    const plain = partes.find(p => (p.mimeType || '').startsWith('text/plain') && p.body?.data);
    if (plain) return decodificarTexto(plain.body!.data).trim();
    const html = partes.find(p => (p.mimeType || '').startsWith('text/html') && p.body?.data);
    if (html) return htmlParaTexto(decodificarTexto(html.body!.data));
    return '';
}

/** Tipos que o Gemini lê. O resto é ignorado (e registrado como ignorado). */
export const MIME_ACEITOS = [
    'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/heic',
    'application/pdf',
    'text/csv', 'text/plain',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

const aceito = (mime: string) => MIME_ACEITOS.includes((mime || '').toLowerCase().split(';')[0].trim());

/**
 * Imagens coladas no corpo + anexos, na ordem em que aparecem.
 *
 * `maxArquivos` e `maxBytes` existem porque a requisição ao Gemini tem limite e
 * base64 infla ~33%: uma thread com dez prints estouraria a chamada inteira e o
 * e-mail ficaria sem extração NENHUMA. Melhor mandar os primeiros e registrar
 * que sobrou coisa do que perder tudo.
 */
export function arquivosDaMensagem(
    msg: GmailMessage,
    maxArquivos = 6,
    maxBytes = 6 * 1024 * 1024,
): { arquivos: Arquivo[]; ignorados: number } {
    const candidatos = achatar(msg?.payload).filter(p => {
        const tem = !!(p.body?.attachmentId || p.body?.data);
        const ehAnexoOuImagem = !!p.filename || (p.mimeType || '').startsWith('image/');
        return tem && ehAnexoOuImagem && !(p.mimeType || '').startsWith('text/html');
    });

    const arquivos: Arquivo[] = [];
    let bytes = 0;
    let ignorados = 0;
    for (const p of candidatos) {
        const mime = (p.mimeType || 'application/octet-stream').split(';')[0].trim();
        const tam = Number(p.body?.size || 0);
        if (!aceito(mime) || arquivos.length >= maxArquivos || bytes + tam > maxBytes) { ignorados++; continue; }
        arquivos.push({
            nome: p.filename || `${mime.replace('/', '_')}-${p.partId || arquivos.length}`,
            mimeType: mime,
            data: p.body?.data,
            attachmentId: p.body?.attachmentId,
            tamanho: tam,
        });
        bytes += tam;
    }
    return { arquivos, ignorados };
}

/** internalDate (epoch ms em texto) -> ISO. Null quando não veio. */
export function recebidoEm(msg: GmailMessage): string | null {
    const ms = Number(msg?.internalDate);
    return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}
