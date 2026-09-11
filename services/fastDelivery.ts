import * as XLSX from 'xlsx';
import { supabase } from './supabase';
import { IMPLEMENTO_OPTIONS } from '../constants';
import { createPipefyCard } from './pipefy';
import { createRamperCard } from './ramper';

// ============================================================================
// FAST DELIVERY — leitura do Excel do OTM e montagem da prévia (Bloco 2).
//
// Cada linha do Excel é um frete. O valor RECEBIDO vem do OTM; o valor A PAGAR
// ao terceiro vem da NOSSA tabela de preço, cruzando destino × tipo de veículo.
// A margem é a diferença.
//
// Nada é gravado aqui. Este bloco só lê, cruza e mostra — a gravação é o
// Bloco 3. E o que não casar não vira número: vira pendência em destaque, para
// alguém resolver antes de qualquer cotação existir.
// ============================================================================

// ----------------------------------------------------------------------------
// CONFIGURAÇÃO AJUSTÁVEL
// ----------------------------------------------------------------------------

/** Origem da operação. Fixa: todo frete Fast Delivery sai de Guarulhos. */
export const ORIGEM_FIXA = 'GUARULHOS';

/**
 * Nomes de coluna aceitos no Excel do OTM, por campo. O cabeçalho vem nomeado,
 * mas exportação de planilha muda acentuação e maiúscula com facilidade — a
 * comparação é feita normalizada, e a primeira que casar vence.
 */
export const COLUNAS_OTM: Record<string, string[]> = {
    referencia: ['DT SAP', 'DT', 'DTSAP'],
    dataColeta: ['Data Coleta', 'Data de Coleta', 'DataColeta'],
    cidadeDestino: ['Cidade de Destino', 'Cidade Destino', 'Cidade'],
    uf: ['UF', 'UF Destino'],
    cliente: ['Nome Destino', 'Cliente', 'Destinatario'],
    tipoEquipamento: ['Tipo Equipamento', 'Tipo de Equipamento', 'Equipamento'],
    placa: ['Placa Veículo', 'Placa Veiculo', 'Placa'],
    motorista: ['Nome Motorista', 'Motorista'],
    cpfMotorista: ['CPF do motorista', 'CPF Motorista', 'CPF'],
    peso: ['Peso', 'Peso (kg)', 'Peso Kg'],
    volume: ['Volume M³', 'Volume M3', 'Volume', 'M³'],
    custoFrete: ['Custo Frete', 'Custo do Frete', 'Valor Frete'],
};

/** O Excel traz a placa prefixada pela operação: "SUZANO.BXC7J79". */
export const PREFIXO_PLACA = /^SUZANO\./i;

// ----------------------------------------------------------------------------

/** MESMA regra da fast_delivery_normaliza() do banco. Não pode divergir. */
export const normalizarDestino = (s: string): string =>
    (s || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toUpperCase()
        .replace(/\(\s*\d+\s*\)/g, '')
        .replace(/\s+/g, ' ')
        .trim();

/**
 * Normaliza o nome da coluna para comparação, PRESERVANDO o "%".
 *
 * O "%" não é decoração: o Excel do OTM tem "Peso" (o peso real, em kg) e
 * "% Peso" (a ocupação, em porcentagem) lado a lado. Removendo a pontuação,
 * as duas viravam "PESO" e a segunda sobrescrevia a primeira no mapa — a tela
 * mostrava 37 kg onde o frete pesava 739,84 kg. Um caractere de diferença
 * separava o peso do percentual.
 */
const normalizarCabecalho = (s: string): string =>
    (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9%]/g, '');

/**
 * Número vindo de PLANILHA. Aceita o número puro do XLSX, "1.234,56", "R$ ..."
 * e valor com unidade colada ("2.056,53 KG").
 *
 * O ponto sozinho é ambíguo: em "2.056" é milhar, em "739.84" é decimal. A
 * regra é a do formato pt-BR — ponto só é separador de milhar quando vem
 * seguido de exatamente três dígitos. Chutar errado aqui multiplica ou divide
 * o peso por mil.
 */
export function numero(v: unknown): number | null {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;

    // Fora dígitos, separadores e sinal, o resto é rótulo: "KG", "R$", "un".
    let t = String(v).replace(/[^0-9.,-]/g, '').trim();
    if (!t || t === '-') return null;

    const temVirgula = t.includes(',');
    if (temVirgula) {
        // pt-BR clássico: ponto é milhar, vírgula é decimal.
        t = t.replace(/\./g, '').replace(',', '.');
    } else {
        // Só pontos: milhar apenas quando cada um é seguido de 3 dígitos.
        const soMilhar = /^-?\d{1,3}(\.\d{3})+$/.test(t);
        if (soMilhar) t = t.replace(/\./g, '');
    }
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
}

/**
 * Número vindo do BANCO. Formato diferente do da planilha: o PostgREST devolve
 * `numeric` como string ISO ("900.00"), com ponto DECIMAL. Passar isso pelo
 * `numero()` acima — que trata ponto como separador de milhar — multiplicaria
 * o valor por cem. Dois formatos, dois conversores.
 */
export function numeroDb(v: unknown): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

/** Data do XLSX vem como serial ou texto. Devolve ISO, ou null se não der. */
export function data(v: unknown): string | null {
    if (v === null || v === undefined || v === '') return null;
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'number') {
        // Serial do Excel: dias desde 30/12/1899.
        const ms = Math.round((v - 25569) * 86400 * 1000);
        const d = new Date(ms);
        return Number.isFinite(d.getTime()) ? d.toISOString() : null;
    }
    const d = new Date(String(v));
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/** "0001434504" -> "1434504". A referência do OTM vem com zeros à esquerda. */
export const semZerosAEsquerda = (s: unknown): string =>
    String(s ?? '').trim().replace(/^0+/, '') || String(s ?? '').trim();

/** "SUZANO.BXC7J79" -> "BXC7J79". Vazia continua vazia. */
export const limparPlaca = (s: unknown): string =>
    String(s ?? '').trim().replace(PREFIXO_PLACA, '').toUpperCase();

// ----------------------------------------------------------------------------
// Tabelas de apoio (Bloco 1)
// ----------------------------------------------------------------------------

export interface PrecoTabela {
    destino: string;
    tipo_veiculo: string;
    nosso_frete: number | null;
    a_pagar: number | null;
    sobra: number | null;
    km: number | null;
    pedagio: number | null;
}

/**
 * O que um código do OTM significa: que veículo é, e com que carroceria.
 *
 * Os dois campos têm pesos MUITO diferentes e é bom não confundir:
 *   tipo_veiculo — cruza com a tabela de preço. Mexe no dinheiro.
 *   carroceria   — não cruza com nada. Viaja para a cotação e para o Pipefy,
 *                  para o veículo certo aparecer na doca. Não toca no valor.
 *
 * `carroceria` é null quando o código foi classificado antes desta coluna
 * existir. Null é "ninguém decidiu ainda", e é diferente de "Baú".
 */
export interface EquipamentoDePara {
    tipo_veiculo: string;
    carroceria: string | null;
}

export interface ApoioFastDelivery {
    /** codigo_otm -> veículo + carroceria */
    equipamentos: Map<string, EquipamentoDePara>;
    /** tipo_veiculo -> capacidade em m³. Vem do banco, ajustável sem deploy. */
    capacidades: Map<string, number>;
    /** Fração da capacidade a partir da qual se avisa. 0.90 = acima de 90%. */
    limiarVolume: number;
    /** "DESTINO|VEICULO" -> preço */
    precos: Map<string, PrecoTabela>;
    /** Destinos que existem na tabela, para dizer se a cidade é conhecida. */
    destinos: Set<string>;
}

export async function carregarApoio(): Promise<ApoioFastDelivery> {
    const [eq, pr, cap, cfg] = await Promise.all([
        supabase.from('fast_delivery_equipamento').select('codigo_otm, tipo_veiculo, carroceria'),
        supabase.from('fast_delivery_tabela').select('destino, tipo_veiculo, nosso_frete, a_pagar, sobra, km, pedagio'),
        supabase.from('fast_delivery_capacidade').select('tipo_veiculo, capacidade_m3'),
        supabase.from('fast_delivery_config').select('chave, valor').eq('chave', 'limiar_volume_alerta').maybeSingle(),
    ]);
    if (eq.error) throw new Error(`Não consegui ler o de-para de equipamento: ${eq.error.message}`);
    if (pr.error) throw new Error(`Não consegui ler a tabela de preço: ${pr.error.message}`);
    // Capacidade e limiar são do ALERTA, não da cotação: se faltarem, a prévia
    // continua funcionando e apenas não avisa. Derrubar a tela inteira por causa
    // de um aviso seria trocar um incômodo por uma parada.
    const capacidades = new Map<string, number>();
    for (const r of cap.data ?? []) capacidades.set(String(r.tipo_veiculo), numeroDb(r.capacidade_m3) ?? 0);
    const limiarVolume = numeroDb(cfg.data?.valor) ?? LIMIAR_VOLUME_PADRAO;

    const equipamentos = new Map<string, EquipamentoDePara>();
    for (const r of eq.data ?? []) {
        equipamentos.set(String(r.codigo_otm).trim(), {
            tipo_veiculo: String(r.tipo_veiculo),
            // Vazio do banco vira null, não "": a tela pergunta "está definida?"
            // e string vazia responderia que sim.
            carroceria: r.carroceria ? String(r.carroceria) : null,
        });
    }

    const precos = new Map<string, PrecoTabela>();
    const destinos = new Set<string>();
    for (const r of (pr.data ?? []) as Record<string, unknown>[]) {
        // PostgREST devolve `numeric` como STRING. Sem converter aqui, a soma
        // dos totais viraria concatenação ("0" + "900.00") e o valor apareceria
        // sem formatação na tela. Converte-se uma vez, na fronteira.
        const linha: PrecoTabela = {
            destino: String(r.destino),
            tipo_veiculo: String(r.tipo_veiculo),
            nosso_frete: numeroDb(r.nosso_frete),
            a_pagar: numeroDb(r.a_pagar),
            sobra: numeroDb(r.sobra),
            km: numeroDb(r.km),
            pedagio: numeroDb(r.pedagio),
        };
        precos.set(`${linha.destino}|${linha.tipo_veiculo}`, linha);
        destinos.add(linha.destino);
    }
    return { equipamentos, precos, destinos, capacidades, limiarVolume };
}

/**
 * Só vale se a tabela `fast_delivery_config` estiver vazia ou ilegível. O
 * número de verdade mora no banco; este é o que evita `undefined` virar
 * comparação silenciosamente falsa e o alerta simplesmente nunca aparecer.
 */
const LIMIAR_VOLUME_PADRAO = 0.90;

export interface AlertaVolume {
    volumeCarga: number;
    capacidade: number;
    tipoVeiculo: string;
    /** Quanto da capacidade a carga ocupa. 1.05 = 105%, já não cabe. */
    ocupacao: number;
    texto: string;
}

/**
 * A carga cabe no veículo?
 *
 * AVISO, nunca bloqueio: quem conhece a carga é o operador, e há carga que
 * passa da conta e entra assim mesmo. Por isso o retorno é um alerta, e não uma
 * pendência — pendência impede de cotar, e não é isso que se quer aqui.
 *
 * Devolve null quando NÃO HÁ COMO COMPARAR, que é diferente de "cabe":
 *   - o OTM não mandou volume
 *   - o código de equipamento ainda não foi classificado (sem tipo, sem capacidade)
 *   - o tipo não tem capacidade cadastrada
 * Nesses casos a linha segue normal, sem aviso — inventar um alerta a partir de
 * dado que não existe seria pior que não avisar.
 */
export function alertaDeVolume(
    volumeCarga: number | null,
    tipoVeiculo: string | null,
    apoio: ApoioFastDelivery,
): AlertaVolume | null {
    if (volumeCarga === null || !Number.isFinite(volumeCarga) || volumeCarga <= 0) return null;
    if (!tipoVeiculo) return null;
    const capacidade = apoio.capacidades.get(tipoVeiculo);
    if (!capacidade || capacidade <= 0) return null;

    const limiar = apoio.limiarVolume > 0 ? apoio.limiarVolume : LIMIAR_VOLUME_PADRAO;
    if (volumeCarga <= capacidade * limiar) return null;

    const ocupacao = volumeCarga / capacidade;
    const m3 = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
    return {
        volumeCarga, capacidade, tipoVeiculo, ocupacao,
        texto: volumeCarga > capacidade
            ? `carga ${m3(volumeCarga)} m³ > ${tipoVeiculo} ${m3(capacidade)} m³, pode não caber`
            : `carga ${m3(volumeCarga)} m³ ocupa ${Math.round(ocupacao * 100)}% do ${tipoVeiculo} (${m3(capacidade)} m³)`,
    };
}

/**
 * Tipos de veículo que EXISTEM na tabela de preço.
 *
 * A lista sai dos preços cadastrados, não de uma constante: classificar um
 * código como um tipo que a tabela não tem produziria uma linha que nunca cota
 * — o de-para ficaria "resolvido" e a cotação continuaria impossível, agora sem
 * dizer por quê. Melhor não deixar escolher.
 */
export function tiposDaTabela(apoio: ApoioFastDelivery): string[] {
    const tipos = new Set<string>();
    for (const p of apoio.precos.values()) tipos.add(p.tipo_veiculo);
    return Array.from(tipos).sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

/**
 * Carrocerias que o master pode escolher.
 *
 * Vem de constants.ts, a MESMA lista do select de Implemento da cotação normal
 * e do campo "Implemento" do Pipefy. Não é lista nova: se fosse, o valor
 * gravado aqui chegaria no card e não casaria com opção nenhuma — o campo sairia
 * vazio, sem erro. O banco repete a lista numa CHECK, para a trava não ser só
 * de tela.
 *
 * Diferente de `tiposDaTabela()`, esta lista NÃO sai da tabela de preço: a
 * carroceria não cruza com preço, então não há preço para consultar.
 */
export const CARROCERIAS = IMPLEMENTO_OPTIONS;

/**
 * Carroceria usada quando o código do OTM ainda não tem a dele.
 *
 * "Baú" é o que a operação vinha mandando em TODA cotação Fast Delivery, e é a
 * grafia canônica — 569 cotações usam assim, contra um punhado de "BAU"/"Bau"
 * soltos. Mantido como padrão para não travar o lançamento dos códigos que já
 * estavam classificados antes desta coluna existir.
 *
 * Mas NÃO é silencioso: a linha que cai aqui mostra o aviso de que a carroceria
 * não foi definida (ver `avisoCarroceria` em LinhaPrevia), e o código aparece
 * na lista de pendentes para o master completar. O padrão existe para não parar
 * a operação, não para esconder que falta uma decisão.
 */
export const CARROCERIA_PADRAO = 'Baú';

/**
 * Códigos já classificados que ainda não têm carroceria.
 *
 * São os anteriores a esta coluna: têm veículo, cotam normalmente, e por isso
 * mesmo não aparecem em pendência nenhuma — passariam despercebidos para sempre
 * mandando "Baú". Esta lista é o que os traz à tona para o master completar.
 */
export function codigosSemCarroceria(apoio: ApoioFastDelivery): Array<{ codigo: string; tipoVeiculo: string }> {
    const faltando: Array<{ codigo: string; tipoVeiculo: string }> = [];
    for (const [codigo, eq] of apoio.equipamentos) {
        if (!eq.carroceria) faltando.push({ codigo, tipoVeiculo: eq.tipo_veiculo });
    }
    return faltando.sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR'));
}

/**
 * Grava o de-para de um código do OTM. Permanente: da próxima vez que o código
 * aparecer, a linha já nasce reconhecida.
 *
 * Só master grava — e quem impede é a RLS (`is_master()` em
 * fast_delivery_equipamento), não a tela. Esconder o botão é conveniência;
 * a trava é do servidor, e foi simulada em 29/08/2026: operador recebe 42501
 * no INSERT e zero linhas no UPDATE/DELETE.
 *
 * ON CONFLICT no código: o mesmo código classificado duas vezes ATUALIZA em vez
 * de duplicar. A chave primária já garante isso, mas sem o upsert o segundo
 * clique viraria erro de chave duplicada na cara do operador.
 */
export async function classificarEquipamento(
    codigoOtm: string,
    tipoVeiculo: string,
    carroceria: string,
    apoio: ApoioFastDelivery,
): Promise<{ ok?: true; error?: string }> {
    const codigo = String(codigoOtm ?? '').trim();
    if (!codigo) return { error: 'Código do OTM vazio.' };

    // Recusa aqui também, não só na lista da tela: um tipo fora da tabela de
    // preço nunca vai cotar, e gravá-lo esconderia o problema.
    if (!tiposDaTabela(apoio).includes(tipoVeiculo)) {
        return { error: `"${tipoVeiculo}" não existe na tabela de preço. Cadastre o preço desse veículo antes.` };
    }

    // Carroceria é OBRIGATÓRIA na classificação, mesmo não valendo dinheiro:
    // gravar sem ela recriaria, código a código, o problema que esta coluna
    // existe para resolver. Já os códigos antigos, gravados antes da coluna,
    // continuam válidos com carroceria nula — não é o mesmo caso.
    if (!carroceria) return { error: 'Escolha a carroceria.' };
    if (!CARROCERIAS.includes(carroceria)) {
        // A CHECK do banco recusaria também; aqui a mensagem é legível.
        return { error: `"${carroceria}" não é uma carroceria conhecida do Pipefy.` };
    }

    const { error } = await supabase
        .from('fast_delivery_equipamento')
        .upsert(
            {
                codigo_otm: codigo,
                tipo_veiculo: tipoVeiculo,
                carroceria,
                observacao: 'classificado na tela',
            },
            { onConflict: 'codigo_otm' },
        );

    if (error) {
        // A RLS devolve o erro do Postgres; traduz para quem está na tela.
        if (/row-level security|permission denied/i.test(error.message)) {
            return { error: 'Só o master pode classificar códigos de equipamento.' };
        }
        if (/carroceria_valida|check constraint/i.test(error.message)) {
            return { error: `O banco recusou a carroceria "${carroceria}". Escolha uma da lista.` };
        }
        return { error: error.message };
    }
    return { ok: true };
}

// ----------------------------------------------------------------------------
// A prévia
// ----------------------------------------------------------------------------

export type MotivoPendencia = 'equipamento' | 'destino' | 'veiculo' | 'valor';

export interface LinhaPrevia {
    linhaExcel: number;
    referencia: string;
    dataColeta: string | null;
    cliente: string;
    cidadeOriginal: string;
    uf: string;
    destinoNormalizado: string;
    codigoEquipamento: string;
    tipoVeiculo: string | null;
    /**
     * A carroceria DO DE-PARA daquele código. null = o código ainda não tem
     * carroceria definida (ou nem foi classificado). É o dado cru, para a tela
     * saber se há decisão humana por trás.
     */
    carroceria: string | null;
    /**
     * A que REALMENTE vai para a cotação e para o Pipefy: a do de-para, ou o
     * padrão quando não há. Separada da de cima de propósito — quem grava usa
     * esta, quem avisa o operador olha aquela.
     */
    carroceriaEfetiva: string;
    /**
     * Texto do aviso quando a carroceria caiu no padrão. null = veio do de-para.
     * NÃO é pendência: a linha continua lançável. Sem isto, o "Baú" de antes
     * voltaria calado, que é o defeito que esta mudança corrige.
     */
    avisoCarroceria?: string | null;
    placa: string;
    motorista: string;
    cpfMotorista: string;
    peso: number | null;
    volume: number | null;
    /** Do OTM. */
    valorRecebido: number | null;
    /** Da NOSSA tabela. null = sem preço, e aí não há margem. */
    valorAPagar: number | null;
    km: number | null;
    pedagio: number | null;
    margem: number | null;
    margemPercent: number | null;
    /** Vazio = linha pronta. Com item = precisa de gente antes de virar cotação. */
    pendencias: Array<{ motivo: MotivoPendencia; texto: string }>;
    /**
     * Carga perto ou acima da capacidade do veículo. null = cabe, ou não há
     * como comparar (sem volume, ou veículo ainda não classificado).
     * NÃO impede de cotar — é aviso.
     */
    alertaVolume?: AlertaVolume | null;
    /** Número da proposta, quando esta DT já virou cotação antes. */
    jaLancada?: string | null;
    /** A MESMA DT apareceu antes NESTE arquivo. Só a primeira ocorrência vale. */
    repetidaNoArquivo?: boolean;
}

function pegar(linha: Record<string, unknown>, mapa: Record<string, string>, campo: string): unknown {
    const chave = mapa[campo];
    return chave ? linha[chave] : undefined;
}

/**
 * Casa os nomes de coluna do arquivo com os que esperamos, comparando
 * normalizado. Devolve campo -> nome real da coluna no arquivo.
 */
export function mapearColunas(cabecalhos: string[]): { mapa: Record<string, string>; faltando: string[] } {
    // A PRIMEIRA coluna com um dado nome vence. Se o arquivo trouxer duas que
    // normalizem igual, sobrescrever silenciosamente é o que causou o bug do
    // peso — melhor ficar com a primeira e previsível do que com a última.
    const porNormalizado = new Map<string, string>();
    for (const c of cabecalhos) {
        const n = normalizarCabecalho(c);
        if (!porNormalizado.has(n)) porNormalizado.set(n, c);
    }

    const mapa: Record<string, string> = {};
    const faltando: string[] = [];
    for (const [campo, candidatos] of Object.entries(COLUNAS_OTM)) {
        const achou = candidatos.map(normalizarCabecalho).find((n) => porNormalizado.has(n));
        if (achou) mapa[campo] = porNormalizado.get(achou)!;
        else faltando.push(candidatos[0]);
    }
    return { mapa, faltando };
}

export interface ResultadoLeitura {
    linhas: LinhaPrevia[];
    colunasFaltando: string[];
    totalLinhas: number;
}

/** Lê o .xlsx e monta a prévia. Não grava nada. */
export function lerExcelOtm(buffer: ArrayBuffer, apoio: ApoioFastDelivery): ResultadoLeitura {
    const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
    const aba = wb.Sheets[wb.SheetNames[0]];
    const bruto = XLSX.utils.sheet_to_json<Record<string, unknown>>(aba, { defval: '' });
    if (!bruto.length) return { linhas: [], colunasFaltando: [], totalLinhas: 0 };

    const { mapa, faltando } = mapearColunas(Object.keys(bruto[0]));

    const linhas = bruto.map((l, i) => {
        const pendencias: LinhaPrevia['pendencias'] = [];

        const cidade = String(pegar(l, mapa, 'cidadeDestino') ?? '').trim();
        const uf = String(pegar(l, mapa, 'uf') ?? '').trim().toUpperCase();
        const destinoNormalizado = normalizarDestino(cidade);

        const codigoEquipamento = String(pegar(l, mapa, 'tipoEquipamento') ?? '').trim();
        const equipamento = apoio.equipamentos.get(codigoEquipamento) ?? null;
        const tipoVeiculo = equipamento?.tipo_veiculo ?? null;

        // Carroceria: a do código, ou o padrão. O padrão NÃO passa calado —
        // vira aviso na linha, porque foi exatamente o "Baú" silencioso que
        // mandou carro errado para o cliente.
        const carroceria = equipamento?.carroceria ?? null;
        const carroceriaEfetiva = carroceria ?? CARROCERIA_PADRAO;
        const avisoCarroceria = carroceria
            ? null
            : codigoEquipamento && tipoVeiculo
                // Código classificado, mas de antes da carroceria existir. Cota
                // normalmente e o master completa quando puder.
                ? `Código ${codigoEquipamento} não tem carroceria definida — vai como ${CARROCERIA_PADRAO}.`
                // Sem código ou sem de-para: já é pendência de equipamento, e
                // repetir o aviso aqui só empilharia ruído sobre o mesmo fato.
                : null;

        // Equipamento sem de-para: não dá para escolher veículo, e sem veículo
        // não há preço. Classificar é decisão humana — nunca palpite.
        if (!tipoVeiculo) {
            pendencias.push({
                motivo: 'equipamento',
                texto: codigoEquipamento
                    ? `Equipamento ${codigoEquipamento} não reconhecido — classifique antes de cotar.`
                    : 'Sem código de equipamento na planilha.',
            });
        }

        const volumeCarga = numero(pegar(l, mapa, 'volume'));

        const preco = tipoVeiculo ? apoio.precos.get(`${destinoNormalizado}|${tipoVeiculo}`) ?? null : null;
        if (tipoVeiculo && !preco) {
            // Separa os dois casos: cidade desconhecida é diferente de cidade
            // conhecida que não atende aquele veículo.
            pendencias.push(
                apoio.destinos.has(destinoNormalizado)
                    ? {
                        motivo: 'veiculo',
                        texto: `${destinoNormalizado} não tem preço para ${tipoVeiculo} — informe o valor a pagar à mão.`,
                    }
                    : {
                        motivo: 'destino',
                        texto: `Destino ${cidade || '(vazio)'} não está na tabela de preço — informe o valor a pagar à mão.`,
                    },
            );
        }

        const valorRecebido = numero(pegar(l, mapa, 'custoFrete'));
        if (valorRecebido === null) {
            pendencias.push({ motivo: 'valor', texto: 'Sem "Custo Frete" na planilha — não dá para calcular margem.' });
        }

        const valorAPagar = preco?.a_pagar ?? null;
        const margem = valorRecebido !== null && valorAPagar !== null ? valorRecebido - valorAPagar : null;
        const margemPercent = margem !== null && valorRecebido ? (margem / valorRecebido) * 100 : null;

        return {
            linhaExcel: i + 2,   // +1 do cabeçalho, +1 porque planilha começa em 1
            referencia: semZerosAEsquerda(pegar(l, mapa, 'referencia')),
            dataColeta: data(pegar(l, mapa, 'dataColeta')),
            cliente: String(pegar(l, mapa, 'cliente') ?? '').trim(),
            cidadeOriginal: cidade,
            uf,
            destinoNormalizado,
            codigoEquipamento,
            tipoVeiculo,
            carroceria,
            carroceriaEfetiva,
            avisoCarroceria,
            placa: limparPlaca(pegar(l, mapa, 'placa')),
            motorista: String(pegar(l, mapa, 'motorista') ?? '').trim(),
            cpfMotorista: String(pegar(l, mapa, 'cpfMotorista') ?? '').trim(),
            peso: numero(pegar(l, mapa, 'peso')),
            volume: volumeCarga,
            valorRecebido,
            valorAPagar,
            km: preco?.km ?? null,
            pedagio: preco?.pedagio ?? null,
            margem,
            margemPercent,
            pendencias,
            // Calculado por último: depende do volume lido E do tipo resolvido.
            alertaVolume: alertaDeVolume(volumeCarga, tipoVeiculo, apoio),
        } as LinhaPrevia;
    });

    return { linhas, colunasFaltando: faltando, totalLinhas: bruto.length };
}

/**
 * Cor da margem. Reusa a MESMA regra da cotação (App.tsx): verde a partir do
 * limiar configurado, âmbar entre zero e ele, vermelho em zero ou negativo.
 * O limiar vem do system_config, não é número novo.
 */
export function corDaMargem(percent: number | null, limiar: number): 'verde' | 'ambar' | 'vermelho' | 'neutro' {
    if (percent === null) return 'neutro';
    if (percent >= limiar) return 'verde';
    if (percent > 0) return 'ambar';
    return 'vermelho';
}

// ============================================================================
// GRAVAÇÃO (Bloco 3)
//
// Reusa a tabela de cotação que já existe (freight_calculations), marcada com
// operacao='FAST_DELIVERY'. Nada de estrutura paralela.
// ============================================================================

/** Marcador da operação. É por ele que a anti-duplicação por DT se orienta. */
export const OPERACAO = 'FAST_DELIVERY';

/** Cliente fixo da operação — existe no OmniFlow, nunca é criado aqui. */
export const CLIENTE_SUZANO_FAST = '1785874539063';

/** Solicitante fixo, em todas as cotações da operação. */
export const SOLICITANTE_FIXO = 'Operação Fast Delivery';

/** Mercadoria fixa da operação. Valor que já existe no histórico de cotações. */
export const MERCADORIA_FIXA = 'Papel e derivados diversos';

// O IMPLEMENTO NÃO É MAIS FIXO — não procure a constante aqui.
//
// Era CARROCERIA_FIXA = 'Baú', em toda cotação Fast Delivery. Mas o código do
// OTM diz qual carreta é — 10910 pode ser Sider e 10920 Grade Baixa —, e o
// "Baú" fixo mandava o carro errado para o cliente. Agora sai do de-para do
// código (LinhaPrevia.carroceriaEfetiva); CARROCERIA_PADRAO, lá em cima, só
// entra quando o código ainda não tem a sua, e com aviso na tela.
//
// Nada disso toca em preço: o valor continua saindo de destino × tipo_veiculo.

/**
 * Id do registro "Operação Fast Delivery" na tabela Solicitantes DO PIPEFY.
 *
 * Os campos "Cliente" e "Solicitante da Carga" do card são CONEXÕES: eles se
 * preenchem pelo id do registro, não pelo nome. Mandar só o texto deixa os dois
 * vazios — foi exatamente o que aconteceu. O id do cliente vem da tabela
 * `customers` (pipefy_client_id), que é a nossa fonte; o do solicitante não tem
 * onde morar do nosso lado, então fica aqui, confirmado por busca em 27/08/2026.
 */
export const SOLICITANTE_PIPEFY_ID = '1425645566';

/**
 * Coleta gravada UMA HORA ANTES do que o OTM informa, para o veículo se
 * apresentar com folga. Vale para todas, sem exceção.
 *
 * A subtração é feita no instante (milissegundos), então a virada de dia se
 * resolve sozinha: 00:30 do dia 5 vira 23:30 do dia 4, com a data junto.
 */
export const ANTECIPACAO_COLETA_MS = 60 * 60 * 1000;

/**
 * Devolve "AAAA-MM-DDTHH:mm" — hora LOCAL, sem fuso.
 *
 * Não é firula de formato, são dois erros de uma vez:
 *  1. o campo "Coleta" da tela é <input type="datetime-local">, que RECUSA
 *     valor com fuso ("...+00:00") e aparece vazio — foi o que aconteceu;
 *  2. toISOString() converte para UTC, então 00:30 em Brasília virava 03:30 e
 *     a coleta ficava três horas adiantada no banco.
 * É também o formato que a cotação normal grava, vindo do mesmo input.
 */
export function coletaAjustada(iso: string | null): string | null {
    if (!iso) return null;
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return null;
    const m = new Date(d.getTime() - ANTECIPACAO_COLETA_MS);
    const z = (n: number) => String(n).padStart(2, '0');
    return `${m.getFullYear()}-${z(m.getMonth() + 1)}-${z(m.getDate())}T${z(m.getHours())}:${z(m.getMinutes())}`;
}

/**
 * CONFIG AJUSTÁVEL — de-para do veículo do Fast Delivery para o vocabulário da
 * CALCULADORA (vehicle_configs). São listas diferentes: a tabela de preço fala
 * "TRUCK", a calculadora grava "truck"; "VAN" vira "Van". Sem esta ponte a
 * cotação nasce com um tipo que a calculadora não reconhece e o campo aparece
 * vazio na tela.
 *
 * CARRETA é o único ambíguo: a calculadora tem "Carreta Simples", "carreta ls",
 * "Carreta 4º eixo" e "vanderleia", e a tabela de preço tem uma CARRETA só, com
 * um preço só. Fica em "Carreta Simples" por ser a leitura neutra — se a
 * operação for majoritariamente LS, é esta linha que muda.
 */
export const VEICULO_CALCULADORA: Record<string, string> = {
    FIORINO: 'Fiorino',
    VAN: 'Van',
    '3/4': '3/4',
    TOCO: 'toco',
    TRUCK: 'truck',
    CARRETA: 'Carreta Simples',
};

/**
 * Status com que a cotação nasce. 'pending' de propósito: são fretes vindos do
 * OTM que ainda não passaram pelo fechamento do OmniFlow, e nascer como 'won'
 * inflaria o painel de ganhos sem ninguém ter decidido isso.
 */
export const STATUS_INICIAL = 'pending';

/**
 * Id do cliente na tabela Clientes do Pipefy. Lido de `customers`, que é onde o
 * OmniFlow guarda esse vínculo — não fica fixo no código para não descolar do
 * dia em que o cadastro for reapontado.
 */
export async function clientePipefyId(): Promise<string | null> {
    const { data } = await supabase
        .from('customers')
        .select('pipefy_client_id')
        .eq('id', CLIENTE_SUZANO_FAST)
        .maybeSingle();
    const id = data?.pipefy_client_id;
    return id ? String(id) : null;
}

/** DTs desta operação que já viraram cotação. Consulta em bloco, não uma a uma. */
export async function dtsJaLancadas(dts: string[]): Promise<Map<string, string>> {
    const jaTem = new Map<string, string>();
    if (!dts.length) return jaTem;
    // Procura pela DT em QUALQUER cotação do cliente da operação, não só nas
    // marcadas. Uma cotação Fast Delivery que perdeu o marcador (por ter sido
    // salva pelo fluxo normal) continuaria invisível aqui, e a DT seria lançada
    // duas vezes — foi o que aconteceu com as DTs 1429723 e 1429725.
    const { data, error } = await supabase
        .from('freight_calculations')
        .select('id, client_reference, proposal_number, operacao')
        .eq('customer_id', CLIENTE_SUZANO_FAST)
        .in('client_reference', dts);
    if (error) throw new Error(`Não consegui checar as DTs já lançadas: ${error.message}`);
    for (const r of data ?? []) {
        if (r.client_reference) jaTem.set(String(r.client_reference), String(r.proposal_number ?? r.id));
    }
    return jaTem;
}

/**
 * Marca cada linha com o que já se sabe sobre a DT dela, ANTES de gravar:
 * se já virou cotação antes, e se repete outra linha do mesmo arquivo.
 *
 * Roda no upload, e não só na hora de gravar, porque descobrir que metade do
 * lote já estava lançada DEPOIS de mandar criar é tarde: o operador precisa ver
 * isso enquanto ainda está decidindo.
 */
export async function marcarJaLancadas(linhas: LinhaPrevia[]): Promise<LinhaPrevia[]> {
    const dts = linhas.map(l => l.referencia).filter(Boolean);
    const jaTem = await dtsJaLancadas(dts);
    const vistas = new Set<string>();
    return linhas.map((l) => {
        // Repetida = a segunda em diante. A primeira segue lançável.
        const repetida = !!l.referencia && vistas.has(l.referencia);
        if (l.referencia) vistas.add(l.referencia);
        return {
            ...l,
            jaLancada: (l.referencia && jaTem.get(l.referencia)) || null,
            repetidaNoArquivo: repetida,
        };
    });
}

/** Próximo número de proposta, no formato CT-AAAA-NNNN que o projeto já usa. */
async function proximoNumeroBase(): Promise<number> {
    const { data } = await supabase
        .from('freight_calculations')
        .select('proposal_number')
        .like('proposal_number', 'CT-%')
        .order('proposal_number', { ascending: false })
        .limit(1);
    const ultimo = data?.[0]?.proposal_number as string | undefined;
    const n = ultimo ? Number(String(ultimo).split('-')[2]) : 0;
    return Number.isFinite(n) ? n : 0;
}

export interface ResultadoCotacao {
    dt: string;
    ok: boolean;
    id?: string;
    proposta?: string;
    jaExistia?: boolean;
    erro?: string;
}

/**
 * Cria as cotações em lote. Uma por vez, de propósito: assim uma falha isolada
 * não derruba o resto e o relato diz exatamente qual entrou e qual não.
 * NÃO reverte o que já entrou — sem delete seguro, desfazer às cegas seria pior.
 */
export async function criarCotacoesFastDelivery(
    linhas: LinhaPrevia[],
    autor: { id?: string; name?: string },
): Promise<ResultadoCotacao[]> {
    const prontas = linhas.filter(l => !l.pendencias.length);
    const jaTem = await dtsJaLancadas(prontas.map(l => l.referencia));
    let seq = await proximoNumeroBase();
    const ano = new Date().getFullYear();
    const resultados: ResultadoCotacao[] = [];

    for (const l of prontas) {
        // Anti-duplicação por DT: a mesma planilha reenviada não relança nada.
        const existente = jaTem.get(l.referencia);
        if (existente) {
            resultados.push({ dt: l.referencia, ok: true, jaExistia: true, proposta: existente });
            continue;
        }

        seq += 1;
        const proposta = `CT-${ano}-${String(seq).padStart(4, '0')}`;
        const id = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

        const linha = {
            id,
            proposal_number: proposta,
            client_reference: l.referencia,
            customer_id: CLIENTE_SUZANO_FAST,
            solicitante: SOLICITANTE_FIXO,
            cliente_nome_operacao: l.cliente || null,
            origin: ORIGEM_FIXA,
            destination: `${l.cidadeOriginal}${l.uf ? `/${l.uf}` : ''}`,
            // A calculadora usa outro vocabulário; sem a ponte o campo fica vazio
            // na tela de cotação.
            vehicle_type: (l.tipoVeiculo && VEICULO_CALCULADORA[l.tipoVeiculo]) || l.tipoVeiculo || '',
            veiculo_tipo_operacao: l.tipoVeiculo ?? null,
            merchandise_type: MERCADORIA_FIXA,
            // Do de-para do código do OTM, não mais "Baú" para todo mundo.
            carroceria_tipo_operacao: l.carroceriaEfetiva,
            // Uma hora antes do OTM, por decisão da operação.
            coleta_date: coletaAjustada(l.dataColeta),
            peso_carga_operacao: l.peso,
            // Só o volume na observação — peso já tem campo próprio, e motorista
            // e placa são ignorados por decisão do Wagner.
            observacoes_gerais: l.volume !== null ? `Volume: ${l.volume} m³` : null,
            nosso_frete: l.valorRecebido,
            frete_terceiro: l.valorAPagar,
            operacao: OPERACAO,
            status: STATUS_INICIAL,
            /**
             * TABELADO — e este campo é o que impede o Qualp.
             *
             * A cotação Fast Delivery nasce PRONTA: o valor final é o que o OTM
             * paga, não algo a calcular. O OmniFlow já tem exatamente esse modo
             * ('tabelado', frete fechado por contrato) e ele curto-circuita a
             * consulta de rota — sem ele, abrir a cotação dispara o Qualp e a
             * engine refaz o preço por cima, mostrando "Frete Final" inflado e
             * "Desatualizado". Zero token do Qualp é gasto nesta operação.
             */
            tipo_precificacao: 'tabelado',
            // Obrigatórios da tabela. O preço aqui é contratado: não há engine de
            // custo por trás, então imposto e seguro ficam zerados e o total é o
            // que o OTM paga.
            distance_km: l.km ?? 0,
            weight: l.peso ?? 0,
            base_freight: l.valorAPagar ?? 0,
            /**
             * ZERO, e não o pedágio da tabela. O `a_pagar` já é o valor cheio
             * acertado com o terceiro — o pedágio está dentro dele. Lançar o
             * pedágio à parte contaria duas vezes e quebraria a identidade que
             * mantém a engine tabelada coerente:
             *     final × (1 − margem%) = a pagar
             */
            tolls: 0,
            goods_value: 0,
            insurance_percent: 0,
            ad_valorem: 0,
            profit_margin: l.margemPercent ?? 0,
            icms_percent: 0, pis_percent: 0, cofins_percent: 0, csll_percent: 0, irpj_percent: 0,
            total_freight: l.valorRecebido ?? 0,
            real_profit: l.margem,
            real_margin_percent: l.margemPercent,
            /**
             * QUANDO a cotação nasceu — e isto faltava.
             *
             * O fluxo normal sempre gravou (services/database.ts), o Fast
             * Delivery nunca: o insert passava created_by e created_by_name e
             * pulava a data. A coluna é bigint com epoch em MILISSEGUNDOS, não
             * timestamptz — o resto do sistema lê com Number(), e um ISO aqui
             * viraria NaN.
             *
             * Sem isto o histórico não tem por onde ordenar "mais recentes
             * primeiro". As cotações já criadas continuam sem — para elas o
             * histórico cai no instante embutido no id (ver instanteDaCotacao).
             */
            created_at: Date.now(),
            created_by: autor.id ?? null,
            created_by_name: autor.name ?? null,
        };

        const { error } = await supabase.from('freight_calculations').insert([linha]);
        if (error) {
            resultados.push({ dt: l.referencia, ok: false, erro: error.message });
        } else {
            // Registra a DT como lançada JÁ, dentro do laço. Sem isto, a mesma DT
            // repetida no mesmo arquivo criava duas cotações: a segunda consultava
            // um mapa montado antes da primeira existir.
            jaTem.set(l.referencia, proposta);
            resultados.push({ dt: l.referencia, ok: true, id, proposta });
        }
    }
    return resultados;
}

// ============================================================================
// HISTÓRICO E ENVIO
//
// Lê as cotações Fast Delivery que JÁ EXISTEM e reenvia o que faltou. Não cria
// cotação, não calcula preço, não consulta rota — zero token do Qualp.
//
// O QUE MUDOU AQUI, E POR QUÊ. Até agora o envio ao Pipefy e ao Ramper só
// existia na memória da tela: `createPipefyCard` era chamado e o "✓ enviado"
// vivia num useState. Recarregar a página apagava esse conhecimento, e o mesmo
// frete virava um segundo card — sem erro, sem aviso.
//
// Agora o envio é GRAVADO na própria cotação, e a trava consulta o BANCO antes
// de mandar. É por isso que a trava sobrevive ao F5: ela não pergunta à tela, e
// sim à linha.
// ============================================================================

/**
 * Instante em que a cotação nasceu, em epoch ms.
 *
 * `created_at` é a fonte, mas as cotações Fast Delivery criadas ANTES desta
 * leva não a têm — o insert nunca a preenchia. Para essas, o instante é
 * recuperado do próprio id, que nasce de `${Date.now()}${aleatório}`: os 13
 * primeiros dígitos são o milissegundo.
 *
 * Devolve 0 quando nenhum dos dois serve. Zero ordena por último, que é o lugar
 * certo para uma linha cuja data ninguém sabe — melhor do que inventar "hoje" e
 * jogá-la para o topo.
 */
export function instanteDaCotacao(createdAt: unknown, id: unknown): number {
    const n = numeroDb(createdAt);
    if (n && n > 0) return n;
    const digitos = String(id ?? '').replace(/\D/g, '').slice(0, 13);
    return digitos.length === 13 ? Number(digitos) : 0;
}

/** Uma carga já lançada, como o histórico a enxerga. */
export interface CotacaoHistorico {
    id: string;
    proposta: string;
    dt: string;
    /** epoch ms. Ver instanteDaCotacao — 0 = data desconhecida. */
    criadaEm: number;
    destino: string;
    cliente: string;
    tipoVeiculo: string | null;
    carroceria: string | null;
    peso: number | null;
    coletaEm: string | null;
    observacoes: string | null;
    valorRecebido: number | null;
    valorAPagar: number | null;
    margem: number | null;
    margemPercent: number | null;
    /** Preenchido = já foi. É a trava, e mora no banco. */
    pipefySentAt: string | null;
    pipefyCardId: string | null;
    pipefyCardUrl: string | null;
    ramperSentAt: string | null;
}

/** Colunas que o histórico lê. Explícitas: `select('*')` traria 60+ campos. */
const COLUNAS_HISTORICO =
    'id, proposal_number, client_reference, created_at, destination, cliente_nome_operacao, ' +
    'veiculo_tipo_operacao, carroceria_tipo_operacao, peso_carga_operacao, coleta_date, ' +
    'observacoes_gerais, nosso_frete, frete_terceiro, real_profit, real_margin_percent, ' +
    'pipefy_card_id, pipefy_sent_at, pipefy_card_url, ramper_sent_at';

function linhaParaHistorico(r: Record<string, unknown>): CotacaoHistorico {
    const recebido = numeroDb(r.nosso_frete);
    const pagar = numeroDb(r.frete_terceiro);
    // A margem gravada é a verdade — foi calculada quando a cotação nasceu.
    // Só se ela faltar é que se recalcula a partir dos dois valores; e se nem
    // eles existirem, fica null. Nada é inventado para preencher a coluna.
    const margem = numeroDb(r.real_profit) ?? (recebido !== null && pagar !== null ? recebido - pagar : null);
    const margemPercent = numeroDb(r.real_margin_percent)
        ?? (margem !== null && recebido ? (margem / recebido) * 100 : null);
    return {
        id: String(r.id),
        proposta: String(r.proposal_number ?? ''),
        dt: String(r.client_reference ?? ''),
        criadaEm: instanteDaCotacao(r.created_at, r.id),
        destino: String(r.destination ?? ''),
        cliente: String(r.cliente_nome_operacao ?? ''),
        tipoVeiculo: r.veiculo_tipo_operacao ? String(r.veiculo_tipo_operacao) : null,
        carroceria: r.carroceria_tipo_operacao ? String(r.carroceria_tipo_operacao) : null,
        peso: numeroDb(r.peso_carga_operacao),
        coletaEm: r.coleta_date ? String(r.coleta_date) : null,
        observacoes: r.observacoes_gerais ? String(r.observacoes_gerais) : null,
        valorRecebido: recebido,
        valorAPagar: pagar,
        margem,
        margemPercent,
        pipefySentAt: r.pipefy_sent_at ? String(r.pipefy_sent_at) : null,
        pipefyCardId: r.pipefy_card_id ? String(r.pipefy_card_id) : null,
        pipefyCardUrl: r.pipefy_card_url ? String(r.pipefy_card_url) : null,
        ramperSentAt: r.ramper_sent_at ? String(r.ramper_sent_at) : null,
    };
}

/** Quantas cargas o histórico traz. O mesmo teto que o histórico geral usa. */
export const LIMITE_HISTORICO = 500;

/**
 * As cargas Fast Delivery já lançadas, mais recentes primeiro.
 *
 * Fora da lixeira: `deleted_at is null`, a mesma regra do histórico geral —
 * cotação mandada para a lixeira não deve reaparecer aqui como se estivesse
 * viva, muito menos com botão de reenviar.
 *
 * A ORDENAÇÃO É FEITA AQUI, não no banco, e isso é deliberado: `created_at`
 * está vazio nas cotações antigas desta operação, então `order by created_at`
 * as jogaria todas para o mesmo lugar. Ordenar por `criadaEm` — que cai no id
 * quando a data falta — põe cada uma no seu lugar. O `order` no servidor fica
 * só para decidir QUAIS 500 vêm quando houver mais que isso.
 */
export async function carregarHistoricoFastDelivery(): Promise<CotacaoHistorico[]> {
    const { data, error } = await supabase
        .from('freight_calculations')
        .select(COLUNAS_HISTORICO)
        .eq('operacao', OPERACAO)
        .is('deleted_at', null)
        .order('id', { ascending: false })
        .limit(LIMITE_HISTORICO);
    if (error) throw new Error(`Não consegui ler o histórico: ${error.message}`);
    return ((data ?? []) as unknown as Record<string, unknown>[])
        .map(linhaParaHistorico)
        .sort((a, b) => b.criadaEm - a.criadaEm);
}

export interface ResultadoEnvio {
    ok?: true;
    /** Já estava enviada no banco — nada foi mandado de novo. */
    jaEnviado?: true;
    erro?: string;
}

/**
 * O estado de envio DA LINHA, lido do banco agora.
 *
 * É a pergunta que a tela não sabia fazer. Consultar antes de mandar é o que
 * impede o card duplicado depois de um F5, de outra aba ou de outra máquina —
 * casos em que o `useState` da tela está limpo e não sabe de nada.
 */
async function envioAtual(cotacaoId: string): Promise<{ pipefy: boolean; ramper: boolean } | { erro: string }> {
    const { data, error } = await supabase
        .from('freight_calculations')
        .select('pipefy_card_id, pipefy_sent_at, ramper_sent_at')
        .eq('id', cotacaoId)
        .maybeSingle();
    if (error) return { erro: `Não consegui conferir se já foi enviada: ${error.message}` };
    if (!data) return { erro: 'Cotação não encontrada — recarregue o histórico.' };
    return {
        // Card id OU data: o fluxo normal grava os dois, mas basta um para a
        // carga já ter card lá. Exigir os dois deixaria passar duplicata.
        pipefy: !!(data.pipefy_card_id || data.pipefy_sent_at),
        ramper: !!data.ramper_sent_at,
    };
}

/**
 * Manda a carga para o Pipefy e REGISTRA o envio.
 *
 * Mesma chamada que a prévia já fazia (`createPipefyCard`), mesmos campos,
 * mesmos ids de conexão — não há caminho novo para o Pipefy aqui. O que é novo
 * são as duas pontas: conferir o banco antes e gravar nele depois.
 *
 * LIMITE HONESTO: a conferência e a gravação são dois passos, então dois
 * cliques verdadeiramente simultâneos (duas abas, dois computadores) ainda
 * poderiam gerar dois cards. A tela desabilita o botão enquanto envia, o que
 * cobre o clique repetido; e o caso que motivou isto — recarregar a página e
 * mandar de novo — fica resolvido. Travar de verdade exigiria reservar a linha
 * ANTES de chamar o Pipefy, e aí uma falha de rede marcaria como enviada uma
 * carga sem card, que é um estado pior de consertar.
 */
export async function enviarCargaAoPipefy(c: CotacaoHistorico): Promise<ResultadoEnvio> {
    const estado = await envioAtual(c.id);
    if ('erro' in estado) return { erro: estado.erro };
    if (estado.pipefy) return { ok: true, jaEnviado: true };

    const idCliente = await clientePipefyId();
    const res = await createPipefyCard({
        titulo: 'Suzano Fast',
        rota: `${ORIGEM_FIXA} > ${c.destino}`,
        receita: c.valorRecebido ?? 0,
        freteTerceiro: c.valorAPagar ?? 0,
        valorCarga: 0,
        peso: c.peso ?? undefined,
        veiculo: c.tipoVeiculo ?? undefined,
        mercadoria: MERCADORIA_FIXA,
        implemento: c.carroceria ?? CARROCERIA_PADRAO,
        dataColeta: c.coletaEm ?? undefined,
        localEntrega: c.cliente || undefined,
        referencia: c.dt,
        cliente: 'Suzano Fast',
        clienteId: idCliente ?? undefined,
        solicitante: SOLICITANTE_FIXO,
        solicitanteId: SOLICITANTE_PIPEFY_ID,
        observacoes: c.observacoes ?? undefined,
    });
    if (res?.error) return { erro: res.error };

    // O card existe. A gravação abaixo pode falhar — e se falhar, o histórico
    // continuará oferecendo o botão. Por isso o erro diz o que aconteceu de
    // verdade: o card FOI criado. Esconder isso faria o operador clicar de novo.
    const { error } = await supabase
        .from('freight_calculations')
        .update({
            pipefy_card_id: res.cardId ?? null,
            pipefy_card_url: res.cardUrl ?? null,
            pipefy_sent_at: new Date().toISOString(),
        })
        .eq('id', c.id);
    if (error) {
        return { erro: `Card criado no Pipefy, mas não consegui registrar o envio: ${error.message}. Não mande de novo.` };
    }
    return { ok: true };
}

/**
 * Manda a carga para o Ramper e REGISTRA o envio. Espelha a do Pipefy,
 * inclusive no limite de concorrência descrito lá.
 */
export async function enviarCargaAoRamper(c: CotacaoHistorico): Promise<ResultadoEnvio> {
    const estado = await envioAtual(c.id);
    if ('erro' in estado) return { erro: estado.erro };
    if (estado.ramper) return { ok: true, jaEnviado: true };

    const res = await createRamperCard({
        title: `${c.proposta} · ${c.destino}`,
        value: c.valorRecebido ?? 0,
        organizationName: 'Suzano Fast',
        solicitante: SOLICITANTE_FIXO,
        tipoDeVeiculo: c.tipoVeiculo ?? undefined,
        documento: c.dt,
        responsavelEmail: undefined,
    });
    if (res?.error) return { erro: res.error };

    // O Ramper devolve o id em lugares diferentes conforme a rota da API. A
    // mesma leitura que o fluxo normal já faz — e o id é opcional: se não vier,
    // o envio continua registrado pela data, que é o que trava a duplicação.
    const cru = (res as Record<string, unknown>)?.result as Record<string, unknown> | undefined;
    const bruto = cru?.id
        ?? (cru?.opportunity as Record<string, unknown> | undefined)?.id
        ?? (cru?.data as Record<string, unknown> | undefined)?.id
        ?? null;

    const { error } = await supabase
        .from('freight_calculations')
        .update({
            ramper_sent_at: new Date().toISOString(),
            ramper_opportunity_id: bruto ? String(bruto) : null,
        })
        .eq('id', c.id);
    if (error) {
        return { erro: `Card criado no Ramper, mas não consegui registrar o envio: ${error.message}. Não mande de novo.` };
    }
    return { ok: true };
}
