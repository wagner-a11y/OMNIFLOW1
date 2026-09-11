import {
    ApoioFastDelivery, CamposBasicos, COLUNAS_OTM, CARROCERIA_PADRAO, CotacaoHistorico,
    ResultadoCotacao, abrirPlanilhaOtm, alertaDeVolume, camposBasicos, campo,
    coletaAjustada, dtsJaLancadas, montarCotacaoSuzano, proximoNumeroBase,
    VEICULO_CALCULADORA, type AlertaVolume,
} from './fastDelivery';
import { supabase } from './supabase';
import { MapaPlantas, PlantaOrigem, rotuloPlanta, traduzirPlanta } from './suzanoPlanta';
import { VEHICLE_CONFIGS } from '../constants';
import { estimateDistance, falhouRota } from './geminiService';

// ============================================================================
// DEMAIS PLANTAS — as outras operações da Suzano.
//
// MESMO Excel do OTM, MESMO de-para de equipamento (veículo + carroceria),
// MESMA prévia. Tudo isso vem de services/fastDelivery.ts e não é copiado aqui:
// o parser, a leitura dos campos, o alerta de volume e o de-para são os mesmos
// objetos. Corrigir a leitura do peso lá conserta as duas telas.
//
// O QUE MUDA, e só isto:
//
//   1. ORIGEM. No Fast a carga sai do OPL de Guarulhos, sempre — origem fixa.
//      Aqui ela sai da própria planta, e a planta vem na coluna "ID Origem"
//      como código (`FAB_MOG_1110`). O de-para de planta traduz para cidade/UF.
//
//   2. VALOR DO TERCEIRO EM CASCATA. No Fast todo destino tem preço de tabela.
//      Aqui não: são milhares de destinos. Então o valor vem, nesta ordem, da
//      tabela, do piso ANTT (sob demanda) ou da mão do operador.
//
//   3. PROTEÇÃO DE MARGEM. Sem tabela, o valor é digitado — e um dígito a menos
//      vira prejuízo. A linha avisa quando o número não faz sentido.
// ============================================================================

/** Marcador da operação. Separa das cargas do Fast no histórico e nos números. */
export const OPERACAO_DEMAIS_PLANTAS = 'DEMAIS_PLANTAS';

/**
 * O dicionário do Fast MAIS a coluna de origem.
 *
 * Acrescentar aqui, e não em COLUNAS_OTM, é o que impede o Fast de passar a
 * reclamar de "ID Origem" — coluna que ele nunca usou e de que não precisa.
 */
export const COLUNAS_DEMAIS_PLANTAS: Record<string, string[]> = {
    ...COLUNAS_OTM,
    idOrigem: ['ID Origem', 'IDOrigem', 'Id Origem', 'Origem'],
};

/**
 * De onde saiu o valor pago ao terceiro. Não é decoração: é o que a tela mostra
 * para o operador saber se aquele número foi consultado, calculado ou digitado
 * — e o que distingue "ainda não definido" de "definido como zero".
 */
export type FonteValor = 'tabela' | 'antt' | 'manual';

export type MotivoPendenciaDP = 'planta' | 'equipamento' | 'valor' | 'recebido';

/**
 * Margem acima disto é suspeita de erro de digitação, não de bom negócio.
 *
 * O caso real é o dígito que falta: 2.000 virando 200 faz a margem saltar para
 * 90%. Ninguém acerta 90% num frete de terceiro — quando esse número aparece, é
 * quase sempre um zero perdido. AVISA, não impede: há carga boa e há operador
 * que sabe o que está fazendo.
 */
export const MARGEM_SUSPEITA_ALTA = 60;

export interface AlertaMargem {
    nivel: 'erro' | 'suspeita';
    texto: string;
}

export interface LinhaDemaisPlantas extends CamposBasicos {
    /** Código cru da coluna "ID Origem". */
    codigoPlanta: string;
    /** Traduzido pelo de-para. null = planta não cadastrada. */
    planta: PlantaOrigem | null;
    /** "Cidade, UF" da origem — o formato que o Qualp entende. Vazio se não resolvida. */
    origem: string;
    tipoVeiculo: string | null;
    carroceria: string | null;
    carroceriaEfetiva: string;
    avisoCarroceria?: string | null;
    /** O que se paga ao terceiro. null = ainda não definido. */
    valorAPagar: number | null;
    fonteValor: FonteValor | null;
    /**
     * Distância da rota. Vem da tabela de preço quando o destino está nela, ou
     * do Qualp quando o piso ANTT é calculado. null = ninguém mediu ainda.
     */
    km: number | null;
    /** Piso calculado, guardado para a tela mostrar de onde saiu o número. */
    pisoAntt?: number | null;
    margem: number | null;
    margemPercent: number | null;
    pendencias: Array<{ motivo: MotivoPendenciaDP; texto: string }>;
    alertaVolume?: AlertaVolume | null;
    alertaMargem?: AlertaMargem | null;
    jaLancada?: string | null;
    repetidaNoArquivo?: boolean;
}

/**
 * O valor digitado faz sentido?
 *
 * Devolve null quando não há o que julgar (falta um dos dois números) — que é
 * diferente de "está tudo bem". Inventar alerta a partir de dado ausente seria
 * pior do que não avisar.
 */
export function avaliarMargem(recebido: number | null, aPagar: number | null): AlertaMargem | null {
    if (recebido === null || aPagar === null) return null;
    const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    // Pagar mais do que se recebe é prejuízo direto. Pode ser decisão
    // consciente (carga de retorno, cliente estratégico), por isso avisa.
    if (aPagar > recebido) {
        return {
            nivel: 'erro',
            texto: `A pagar ${brl(aPagar)} é MAIOR que o recebido ${brl(recebido)} — prejuízo de ${brl(aPagar - recebido)}.`,
        };
    }
    if (aPagar === recebido) {
        return { nivel: 'erro', texto: 'A pagar igual ao recebido — margem zero.' };
    }
    if (!recebido) return null;

    const percent = ((recebido - aPagar) / recebido) * 100;
    if (percent > MARGEM_SUSPEITA_ALTA) {
        return {
            nivel: 'suspeita',
            texto: `Margem de ${percent.toFixed(0)}% é alta demais para frete de terceiro — confira se não falta um dígito em ${brl(aPagar)}.`,
        };
    }
    return null;
}

/** Recalcula margem e alerta depois que o valor do terceiro muda. */
function comValor(
    linha: LinhaDemaisPlantas,
    valorAPagar: number | null,
    fonteValor: FonteValor | null,
): LinhaDemaisPlantas {
    const recebido = linha.valorRecebido;
    const margem = recebido !== null && valorAPagar !== null ? recebido - valorAPagar : null;
    const margemPercent = margem !== null && recebido ? (margem / recebido) * 100 : null;

    // A pendência de valor SAI quando o valor entra, e volta se ele for
    // apagado. Recalcular a lista inteira aqui evita o estado em que a linha
    // tem valor e continua marcada como pendente.
    const pendencias = linha.pendencias.filter(p => p.motivo !== 'valor');
    if (valorAPagar === null) {
        pendencias.push({
            motivo: 'valor',
            texto: 'Sem valor do terceiro — informe à mão ou calcule o piso ANTT.',
        });
    }

    return {
        ...linha,
        valorAPagar,
        fonteValor,
        margem,
        margemPercent,
        pendencias,
        alertaMargem: avaliarMargem(recebido, valorAPagar),
    };
}

/** Define o valor do terceiro à mão. `null` limpa e devolve a linha à pendência. */
export function definirValorManual(linha: LinhaDemaisPlantas, valor: number | null): LinhaDemaisPlantas {
    return comValor(linha, valor, valor === null ? null : 'manual');
}

export interface ResultadoLeituraDP {
    linhas: LinhaDemaisPlantas[];
    colunasFaltando: string[];
    totalLinhas: number;
}

/**
 * Lê o Excel e monta a prévia. NÃO grava nada e NÃO consulta rota — nenhum
 * token do Qualp é gasto aqui. O piso ANTT só sai por botão, linha a linha.
 */
export function lerExcelDemaisPlantas(
    buffer: ArrayBuffer,
    apoio: ApoioFastDelivery,
    plantas: MapaPlantas,
): ResultadoLeituraDP {
    const { bruto, mapa, faltando } = abrirPlanilhaOtm(buffer, COLUNAS_DEMAIS_PLANTAS);
    if (!bruto.length) return { linhas: [], colunasFaltando: [], totalLinhas: 0 };

    const linhas = bruto.map((l, i) => {
        const base = camposBasicos(l, mapa, i);
        const pendencias: LinhaDemaisPlantas['pendencias'] = [];

        // ---- origem ----
        const codigoPlanta = String(campo(l, mapa, 'idOrigem') ?? '').trim();
        const planta = traduzirPlanta(plantas, codigoPlanta);
        if (!planta) {
            pendencias.push({
                motivo: 'planta',
                texto: codigoPlanta
                    ? `Planta ${codigoPlanta} não cadastrada — classifique a origem antes de cotar.`
                    : 'Sem código de planta na planilha (coluna "ID Origem").',
            });
        }

        // ---- veículo e carroceria: o MESMO de-para do Fast ----
        const equipamento = apoio.equipamentos.get(base.codigoEquipamento) ?? null;
        const tipoVeiculo = equipamento?.tipo_veiculo ?? null;
        const carroceria = equipamento?.carroceria ?? null;
        if (!tipoVeiculo) {
            pendencias.push({
                motivo: 'equipamento',
                texto: base.codigoEquipamento
                    ? `Equipamento ${base.codigoEquipamento} não reconhecido — classifique antes de cotar.`
                    : 'Sem código de equipamento na planilha.',
            });
        }

        if (base.valorRecebido === null) {
            pendencias.push({ motivo: 'recebido', texto: 'Sem "Custo Frete" na planilha — não dá para calcular margem.' });
        }

        // ---- valor do terceiro, passo 1 da cascata: a tabela ----
        // Só acha se o destino estiver cadastrado para aquele veículo. Na maior
        // parte das Demais Plantas não vai achar, e isso é o esperado — não é
        // pendência de destino como no Fast, é o caso normal desta operação.
        const preco = tipoVeiculo
            ? apoio.precos.get(`${base.destinoNormalizado}|${tipoVeiculo}`) ?? null
            : null;

        const linha: LinhaDemaisPlantas = {
            ...base,
            codigoPlanta,
            planta,
            origem: planta ? rotuloPlanta(planta) : '',
            tipoVeiculo,
            carroceria,
            carroceriaEfetiva: carroceria ?? CARROCERIA_PADRAO,
            avisoCarroceria: carroceria || !tipoVeiculo || !base.codigoEquipamento
                ? null
                : `Código ${base.codigoEquipamento} não tem carroceria definida — vai como ${CARROCERIA_PADRAO}.`,
            valorAPagar: null,
            fonteValor: null,
            km: preco?.km ?? null,
            margem: null,
            margemPercent: null,
            pendencias,
            alertaVolume: alertaDeVolume(base.volume, tipoVeiculo, apoio),
        };

        // comValor fecha a conta e acrescenta a pendência de valor quando falta.
        return comValor(linha, preco?.a_pagar ?? null, preco?.a_pagar != null ? 'tabela' : null);
    });

    return { linhas, colunasFaltando: faltando, totalLinhas: bruto.length };
}

/**
 * Eixos do veículo, para o piso ANTT.
 *
 * Passa pelo vocabulário da calculadora (VEICULO_CALCULADORA) antes de olhar
 * VEHICLE_CONFIGS: a tabela de preço fala "CARRETA", a calculadora fala
 * "Carreta Simples", e é lá que os eixos estão cadastrados.
 */
export function eixosDoVeiculo(tipoVeiculo: string | null): number | null {
    if (!tipoVeiculo) return null;
    const nome = VEICULO_CALCULADORA[tipoVeiculo] ?? tipoVeiculo;
    return VEHICLE_CONFIGS[nome]?.axles ?? null;
}

export interface ResultadoPiso {
    ok?: true;
    km?: number;
    piso?: number;
    /** Mensagem para a tela quando não deu. */
    erro?: string;
    /** Rota dentro do mesmo município: não é falha, é caso sem cálculo automático. */
    urbano?: boolean;
}

/**
 * Calcula o piso mínimo ANTT da rota, SOB DEMANDA.
 *
 * CONSOME TOKEN DO QUALP — por isso só é chamada pelo botão da linha, nunca na
 * leitura da planilha. Uma planilha de 70 linhas processada automaticamente
 * gastaria 70 consultas sem ninguém pedir.
 *
 * O piso vem calculado pela própria qualp-rota, com a resolução ANTT vigente;
 * não se recalcula aqui para não existirem duas versões do mesmo número.
 */
export async function calcularPisoAntt(linha: LinhaDemaisPlantas): Promise<ResultadoPiso> {
    if (!linha.planta) return { erro: 'Origem não resolvida — cadastre a planta antes.' };
    if (!linha.tipoVeiculo) return { erro: 'Veículo não classificado — classifique o código antes.' };
    const destino = `${linha.cidadeOriginal}${linha.uf ? `, ${linha.uf}` : ''}`;
    if (!linha.cidadeOriginal) return { erro: 'Sem cidade de destino na planilha.' };

    const eixos = eixosDoVeiculo(linha.tipoVeiculo);
    const r = await estimateDistance(
        linha.origem,
        destino,
        VEICULO_CALCULADORA[linha.tipoVeiculo] ?? linha.tipoVeiculo,
        eixos ?? undefined,
        'Carga geral',
    );

    if (falhouRota(r)) {
        return { erro: r.mensagem, urbano: !!r.urbano };
    }
    if (r.pisoAntt == null) {
        // Km serve, piso não veio: devolve o km para a tela mostrar, e deixa
        // claro que o número do piso não existe — em vez de mandar zero.
        return { km: r.km, erro: 'O Qualp não devolveu piso ANTT para esta rota. Informe o valor à mão.' };
    }
    return { ok: true, km: r.km, piso: r.pisoAntt };
}

/** Aplica o piso calculado como valor do terceiro. */
export function aplicarPiso(linha: LinhaDemaisPlantas, km: number, piso: number): LinhaDemaisPlantas {
    return { ...comValor(linha, piso, 'antt'), km, pisoAntt: piso };
}

/**
 * A linha pode virar cotação?
 *
 * Duas condições, e as duas viram pendência quando faltam: origem resolvida
 * (sem ela não há rota nem ANTT) e valor do terceiro definido (sem ele não há
 * o que pagar). O alerta de margem NÃO entra aqui — ele avisa, não impede.
 */
export function prontaParaCotar(linha: LinhaDemaisPlantas): boolean {
    return !linha.pendencias.length;
}

// ============================================================================
// GRAVAÇÃO
//
// Reusa a MESMA montagem do Fast (montarCotacaoSuzano) e a MESMA série de
// propostas. O que diferencia é o marcador `operacao` e a origem, que aqui sai
// da planta em vez de ser fixa.
// ============================================================================

/**
 * Cria as cotações das Demais Plantas.
 *
 * Uma por vez, de propósito: assim uma falha isolada não derruba o resto e o
 * relato diz exatamente qual entrou e qual não. NÃO reverte o que já entrou —
 * sem delete seguro, desfazer às cegas seria pior.
 */
export async function criarCotacoesDemaisPlantas(
    linhas: LinhaDemaisPlantas[],
    autor: { id?: string; name?: string },
): Promise<ResultadoCotacao[]> {
    // Só as prontas. Uma linha sem origem resolvida ou sem valor do terceiro
    // não vira cotação — é a mesma regra da pendência, aplicada de novo aqui
    // para o caso de alguém chamar isto sem passar pela tela.
    const prontas = linhas.filter(l => !l.pendencias.length);
    const jaTem = await dtsJaLancadas(prontas.map(l => l.referencia));
    let seq = await proximoNumeroBase();
    const ano = new Date().getFullYear();
    const resultados: ResultadoCotacao[] = [];

    for (const l of prontas) {
        // Anti-duplicação por DT. A consulta é por cliente, não por operação:
        // a mesma DT não pode virar cotação duas vezes nem mesmo se aparecer
        // numa planilha do Fast e noutra das Demais Plantas.
        const existente = jaTem.get(l.referencia);
        if (existente) {
            resultados.push({ dt: l.referencia, ok: true, jaExistia: true, proposta: existente });
            continue;
        }

        seq += 1;
        const proposta = `CT-${ano}-${String(seq).padStart(4, '0')}`;
        const id = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

        const linha = montarCotacaoSuzano({
            id,
            proposta,
            dt: l.referencia,
            // A ORIGEM É A DIFERENÇA. Sai da planta traduzida, no formato
            // canônico "Cidade, UF" — o mesmo que foi usado para a rota.
            origem: l.origem,
            destino: `${l.cidadeOriginal}${l.uf ? `/${l.uf}` : ''}`,
            clienteLocal: l.cliente,
            tipoVeiculo: l.tipoVeiculo,
            carroceria: l.carroceriaEfetiva,
            coletaEm: coletaAjustada(l.dataColeta),
            peso: l.peso,
            observacoes: l.volume !== null ? `Volume: ${l.volume} m³` : null,
            valorRecebido: l.valorRecebido,
            // O que o operador definiu: da tabela, do piso ANTT ou da mão dele.
            valorAPagar: l.valorAPagar,
            km: l.km,
            margem: l.margem,
            margemPercent: l.margemPercent,
            operacao: OPERACAO_DEMAIS_PLANTAS,
            autor,
        });

        const { error } = await supabase.from('freight_calculations').insert([linha]);
        if (error) {
            resultados.push({ dt: l.referencia, ok: false, erro: error.message });
        } else {
            // Registra a DT como lançada JÁ, dentro do laço: sem isto, a mesma
            // DT repetida no mesmo arquivo criaria duas cotações — a segunda
            // consultaria um mapa montado antes de a primeira existir.
            jaTem.set(l.referencia, proposta);
            resultados.push({ dt: l.referencia, ok: true, id, proposta });
        }
    }
    return resultados;
}

/**
 * A carga recém-criada, no formato que o envio entende.
 *
 * Prévia e histórico usam a MESMA função de envio (enviarCargaAoPipefy /
 * enviarCargaAoRamper), com a trava que consulta o banco antes de mandar. Esta
 * conversão é o que permite isso sem duplicar a montagem do card.
 */
export function comoCargaEnviavel(
    l: LinhaDemaisPlantas,
    cotacaoId: string,
    proposta: string,
): CotacaoHistorico {
    return {
        id: cotacaoId,
        proposta,
        dt: l.referencia,
        criadaEm: Date.now(),
        // A origem REAL da planta — não a do Fast.
        origem: l.origem,
        destino: `${l.cidadeOriginal}${l.uf ? `/${l.uf}` : ''}`,
        operacao: OPERACAO_DEMAIS_PLANTAS,
        cliente: l.cliente,
        tipoVeiculo: l.tipoVeiculo,
        carroceria: l.carroceriaEfetiva,
        peso: l.peso,
        coletaEm: coletaAjustada(l.dataColeta),
        observacoes: l.volume !== null ? `Volume: ${l.volume} m³` : null,
        valorRecebido: l.valorRecebido,
        valorAPagar: l.valorAPagar,
        margem: l.margem,
        margemPercent: l.margemPercent,
        pipefySentAt: null, pipefyCardId: null, pipefyCardUrl: null, ramperSentAt: null,
    };
}
