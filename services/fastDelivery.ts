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

const normalizarCabecalho = (s: string): string =>
    (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Número vindo de planilha: aceita 1.234,56, R$ e o número puro do XLSX. */
export function numero(v: unknown): number | null {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const t = String(v).replace(/R\$/gi, '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
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
    const porNormalizado = new Map<string, string>();
    for (const c of cabecalhos) porNormalizado.set(normalizarCabecalho(c), c);

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
