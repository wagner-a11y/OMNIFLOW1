import { supabase } from './supabase';
import { carregarMunicipios, resolverMunicipio, type Municipio } from '../utils/municipios';

// ============================================================================
// DE-PARA DE PLANTA — o código de origem do OTM vira cidade/UF.
//
// A operação Demais Plantas tira a carga da própria planta, então a origem vem
// da planilha. Só que o OTM manda `FAB_MOG_1110` na coluna "ID Origem", e isso
// não é lugar nenhum: é código de sistema. A tradução é cadastro, igual ao
// de-para de equipamento — o master diz uma vez, e vale para sempre.
//
// Mora num módulo próprio, e não dentro de services/fastDelivery.ts, porque não
// pertence à tela Fast: o Fast tem origem fixa (o OPL de Guarulhos) e nunca vai
// consultar isto. Quem usa é a tela nova, e um dia qualquer outra operação que
// leia o mesmo Excel.
// ============================================================================

/** Uma planta traduzida. */
export interface PlantaOrigem {
    codigo: string;
    cidade: string;
    uf: string;
    /** Código do IBGE. null = cadastrada sem casar com a base oficial. */
    codIbge: number | null;
}

/**
 * O texto canônico "Cidade, UF" — o MESMO formato que o resto do sistema manda
 * para o Qualp (ver utils/municipios.ts). Não se inventa formato aqui: origem e
 * destino precisam falar a mesma língua para a rota casar.
 */
export const rotuloPlanta = (p: PlantaOrigem): string => `${p.cidade}, ${p.uf}`;

/** codigo_planta -> planta. */
export type MapaPlantas = Map<string, PlantaOrigem>;

export async function carregarPlantas(): Promise<MapaPlantas> {
    const { data, error } = await supabase
        .from('fast_delivery_planta')
        .select('codigo_planta, cidade, uf, cod_ibge');
    if (error) throw new Error(`Não consegui ler o de-para de planta: ${error.message}`);
    const mapa: MapaPlantas = new Map();
    for (const r of data ?? []) {
        const codigo = String(r.codigo_planta).trim();
        mapa.set(codigo, {
            codigo,
            cidade: String(r.cidade),
            uf: String(r.uf).toUpperCase(),
            codIbge: r.cod_ibge === null || r.cod_ibge === undefined ? null : Number(r.cod_ibge),
        });
    }
    return mapa;
}

/**
 * Traduz o código da planilha. null = planta desconhecida.
 *
 * O código NÃO é normalizado antes de procurar, de propósito: é chave de
 * sistema, não texto humano. Se o OTM passar a mandar `fab_mog_1110` em
 * minúsculas, isso é um código NOVO e tem de aparecer como pendência — casar
 * por aproximação esconderia uma mudança de contrato do arquivo.
 */
export function traduzirPlanta(plantas: MapaPlantas, codigo: string): PlantaOrigem | null {
    return plantas.get(String(codigo ?? '').trim()) ?? null;
}

/** Plantas cadastradas, em ordem, para a tela de gestão. */
export function listarPlantas(plantas: MapaPlantas): PlantaOrigem[] {
    return Array.from(plantas.values())
        .sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR'));
}

/**
 * Busca no IBGE para o master escolher a cidade.
 *
 * Reusa utils/municipios.ts — a base oficial já carregada sob demanda, sem
 * chamada externa e sem gastar Qualp. A tela não digita cidade livre: escolhe
 * da lista, e é isso que garante que `cod_ibge` e a grafia saiam certos.
 */
export async function municipiosParaEscolha(): Promise<Municipio[]> {
    return carregarMunicipios();
}

/** Casa um texto livre com a base do IBGE. Usado ao pré-preencher a tela. */
export function casarComIbge(lista: Municipio[], texto: string): Municipio | null {
    return resolverMunicipio(lista, texto);
}

/**
 * Grava a tradução de uma planta. Permanente: da próxima vez que o código
 * aparecer na planilha, a linha já nasce com a origem resolvida.
 *
 * Só master grava, e quem impede é a RLS (`is_master()` em
 * fast_delivery_planta), não a tela. Classificar planta não é cosmético: a
 * origem define a distância, e a distância define o piso ANTT.
 *
 * ON CONFLICT no código: classificar a mesma planta duas vezes ATUALIZA em vez
 * de estourar erro de chave duplicada na cara do operador.
 */
export async function classificarPlanta(
    codigoPlanta: string,
    municipio: Municipio,
): Promise<{ ok?: true; error?: string }> {
    const codigo = String(codigoPlanta ?? '').trim();
    if (!codigo) return { error: 'Código da planta vazio.' };
    if (!municipio?.nome || !municipio?.uf) return { error: 'Escolha a cidade na lista.' };

    const { error } = await supabase
        .from('fast_delivery_planta')
        .upsert(
            {
                codigo_planta: codigo,
                cidade: municipio.nome,
                uf: municipio.uf,
                cod_ibge: municipio.codigo,
                observacao: 'classificada na tela',
            },
            { onConflict: 'codigo_planta' },
        );

    if (error) {
        // A RLS devolve o erro do Postgres; traduz para quem está na tela.
        if (/row-level security|permission denied/i.test(error.message)) {
            return { error: 'Só o master pode classificar a origem de uma planta.' };
        }
        if (/uf_valida|check constraint/i.test(error.message)) {
            return { error: 'UF inválida — escolha a cidade na lista, não digite à mão.' };
        }
        return { error: error.message };
    }
    return { ok: true };
}
