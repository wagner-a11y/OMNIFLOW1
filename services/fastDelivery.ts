import * as XLSX from 'xlsx';
import { supabase } from './supabase';

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

export interface ApoioFastDelivery {
    /** codigo_otm -> tipo_veiculo */
    equipamentos: Map<string, string>;
    /** "DESTINO|VEICULO" -> preço */
    precos: Map<string, PrecoTabela>;
    /** Destinos que existem na tabela, para dizer se a cidade é conhecida. */
    destinos: Set<string>;
}

export async function carregarApoio(): Promise<ApoioFastDelivery> {
    const [eq, pr] = await Promise.all([
        supabase.from('fast_delivery_equipamento').select('codigo_otm, tipo_veiculo'),
        supabase.from('fast_delivery_tabela').select('destino, tipo_veiculo, nosso_frete, a_pagar, sobra, km, pedagio'),
    ]);
    if (eq.error) throw new Error(`Não consegui ler o de-para de equipamento: ${eq.error.message}`);
    if (pr.error) throw new Error(`Não consegui ler a tabela de preço: ${pr.error.message}`);

    const equipamentos = new Map<string, string>();
    for (const r of eq.data ?? []) equipamentos.set(String(r.codigo_otm).trim(), String(r.tipo_veiculo));

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
    return { equipamentos, precos, destinos };
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
        const tipoVeiculo = apoio.equipamentos.get(codigoEquipamento) ?? null;

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
            placa: limparPlaca(pegar(l, mapa, 'placa')),
            motorista: String(pegar(l, mapa, 'motorista') ?? '').trim(),
            cpfMotorista: String(pegar(l, mapa, 'cpfMotorista') ?? '').trim(),
            peso: numero(pegar(l, mapa, 'peso')),
            volume: numero(pegar(l, mapa, 'volume')),
            valorRecebido,
            valorAPagar,
            km: preco?.km ?? null,
            pedagio: preco?.pedagio ?? null,
            margem,
            margemPercent,
            pendencias,
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

/**
 * Implemento fixo: no Fast Delivery é sempre baú. "Baú" é a grafia canônica —
 * 569 cotações usam assim, contra um punhado de "BAU"/"Bau" soltos.
 */
export const CARROCERIA_FIXA = 'Baú';

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
    const { data, error } = await supabase
        .from('freight_calculations')
        .select('id, client_reference, proposal_number')
        .eq('operacao', OPERACAO)
        .in('client_reference', dts);
    if (error) throw new Error(`Não consegui checar as DTs já lançadas: ${error.message}`);
    for (const r of data ?? []) {
        if (r.client_reference) jaTem.set(String(r.client_reference), String(r.proposal_number ?? r.id));
    }
    return jaTem;
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
            carroceria_tipo_operacao: CARROCERIA_FIXA,
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
            created_by: autor.id ?? null,
            created_by_name: autor.name ?? null,
        };

        const { error } = await supabase.from('freight_calculations').insert([linha]);
        if (error) resultados.push({ dt: l.referencia, ok: false, erro: error.message });
        else resultados.push({ dt: l.referencia, ok: true, id, proposta });
    }
    return resultados;
}
