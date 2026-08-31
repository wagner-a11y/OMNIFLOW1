import { supabase } from './supabase';
import { cabecalhoCadastro } from './tokenCadastro';

// ============================================================================
// Cadastro de veículo no Bsoft — Fase 3A.
//
// A leitura do CRLV reusa a process-document; a tradução dos códigos vive em
// services/traducaoVeiculo.ts; a gravação vai pela Edge Function
// cadastrar-veiculo. Nenhuma credencial do Bsoft passa pelo front.
// ============================================================================

// ----------------------------------------------------------------------------
// CONFIGURAÇÃO AJUSTÁVEL — mexer aqui, não espalhado pelo código.
// ----------------------------------------------------------------------------

/**
 * capM3 sugerido por tipo de carroceria (código do MDF-e).
 *
 * É SUGESTÃO, não verdade: o campo aparece como crítico na tela e o operador
 * confirma antes de gravar. Carroceria sem entrada aqui deixa o campo VAZIO de
 * propósito — chutar volume seria pior do que pedir para o operador preencher.
 *
 * A API recusa capM3 igual a zero (HTTP 422), então não existe valor 0 nesta
 * tabela: o cavalo mecânico, que não tem volume próprio, vai com 1.
 */
export const CAPM3_POR_CARROCERIA: Record<string, number> = {
    '02': 90,   // Fechada/Baú
    '05': 90,   // Sider
    '03': 45,   // Graneleira
    '01': 45,   // Aberta
    '04': 80,   // Porta Container
    '00': 1,    // Não aplicável (cavalo mecânico) — mínimo, porque zero é recusado
};

/**
 * Grupo de frota. O padrão é FROTA DE TERCEIROS porque é o que a operação
 * cadastra em quase 100% dos casos — frota própria é exceção rara.
 *
 * A escolha também tem efeito técnico: FROTA PROPRIA está configurada no
 * Datamex para criar equipamento no módulo de manutenção, e nesse grupo a API
 * exige um `tipoEquipamento` REAL — recusa o "0" com 422 "Tipo do equipamento
 * inválido". FROTA DE TERCEIROS aceita "0" (sem classificação), que é o mesmo
 * que a tela oficial do Datamex grava. Medido em 27/08/2026, isolando grupo de
 * categoria: cavalo com grupo 2 passa, carreta com grupo 1 falha.
 */
export const GRUPO_PADRAO = '2';   // 1 = FROTA PROPRIA, 2 = FROTA DE TERCEIROS

/** Frota própria: o grupo que pode exigir vínculo com equipamento de manutenção. */
export const GRUPO_FROTA_PROPRIA = '1';

/**
 * Campos que o operador precisa OLHAR antes de gravar. São os de maior impacto
 * (classificação e volume) somados aos de maior risco de erro de leitura
 * (placa e chassi, que ninguém corrige depois sem refazer o cadastro).
 */
export const CAMPOS_CRITICOS = ['categoriaVeiculo', 'tipoCarroceria', 'capM3', 'placa', 'chassi'] as const;
export type CampoCritico = typeof CAMPOS_CRITICOS[number];

// ----------------------------------------------------------------------------

/** O que a tela monta e manda para a Edge Function. */
export interface VeiculoParaGravar {
    descricao: string;
    /**
     * Modelo do veículo, texto livre (vai em `modeloVeiculo`). Vem da parte
     * DEPOIS da barra em "MARCA/MODELO" do CRLV — "VW/CONSTELLATION" tem marca
     * VW e modelo CONSTELLATION. Não confundir com `marcaVeiculo`, que é código
     * de dicionário. Modelo vazio trava a emissão de CT-e.
     */
    modelo: string;
    placa: string;
    chassi: string;
    renavam: string;
    anoModelo: string;
    anoFabricacao: string;
    cor: string;
    estado: string;
    cidade: string;
    categoriaVeiculo: string;
    marcaVeiculo: string;
    grupoVeiculo: string;
    tara: string;
    capM3: string;
    capacidadeCarga: string;
    quantidadeEixos: string;
    tipoRodado: string;
    tipoCarroceria: string;
    proprietarioId: string;
}

export const VEICULO_VAZIO: VeiculoParaGravar = {
    descricao: '', modelo: '', placa: '', chassi: '', renavam: '', anoModelo: '', anoFabricacao: '',
    cor: '', estado: '', cidade: '', categoriaVeiculo: '', marcaVeiculo: '',
    grupoVeiculo: GRUPO_PADRAO, tara: '', capM3: '', capacidadeCarga: '',
    quantidadeEixos: '', tipoRodado: '', tipoCarroceria: '', proprietarioId: '',
};

/**
 * Máscara de placa: mostra o hífen na 4ª posição, que é o que a API exige.
 * Aceita a digitação parcial e serve os dois padrões (ABC-1234 e ABC-1D23).
 */
export function formatarPlaca(valor: string): string {
    const p = (valor || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 7);
    return p.length > 3 ? `${p.slice(0, 3)}-${p.slice(3)}` : p;
}

/** Mesma regra do servidor — a tela não deixa chegar lá o que já sabe ser inválido. */
export function placaValida(valor: string): boolean {
    const p = (valor || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    return /^[A-Z]{3}[0-9]{4}$/.test(p) || /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/.test(p);
}

export interface ResultadoVeiculo {
    codVeiculo?: string;
    placa?: string;
    jaExistia?: boolean;
    error?: string;
}

/** Grava o veículo. A Edge Function revalida tudo do lado do servidor. */
export async function cadastrarVeiculo(v: VeiculoParaGravar): Promise<ResultadoVeiculo> {
    try {
        const { data, error } = await supabase.functions.invoke('cadastrar-veiculo', { body: v, headers: cabecalhoCadastro() });
        if (error) {
            // invoke só expõe "non-2xx"; o motivo real vem no corpo.
            let msg = error.message;
            try {
                const b = await (error as any).context?.json?.();
                if (b?.error) msg = b.error;
            } catch { /* noop */ }
            return { error: msg };
        }
        if (data?.error) return data as ResultadoVeiculo;
        return data as ResultadoVeiculo;
    } catch (e) {
        return { error: (e as Error).message || 'Falha ao chamar o cadastro de veículo.' };
    }
}

/** Busca a pessoa física pelo CPF, para escolher o proprietário. */
export async function buscarProprietario(cpf: string): Promise<{ codPessoa?: string; nome?: string; error?: string }> {
    try {
        const { data, error } = await supabase.functions.invoke('cadastrar-motorista', {
            headers: cabecalhoCadastro(),
            body: { consultarCpf: cpf },
        });
        if (error) {
            let msg = error.message;
            try {
                const b = await (error as any).context?.json?.();
                if (b?.error) msg = b.error;
            } catch { /* noop */ }
            return { error: msg };
        }
        return data as { codPessoa?: string; nome?: string; error?: string };
    } catch (e) {
        return { error: (e as Error).message || 'Falha ao consultar o CPF.' };
    }
}

// ----------------------------------------------------------------------------
// Proprietário — Fase 3B. O DOCUMENTO decide o caminho, não o operador:
// 11 dígitos = pessoa física, 14 = pessoa jurídica. Nada de escolher tipo numa
// aba e errar; o CRLV já diz quem é.
// ----------------------------------------------------------------------------

export type TipoPessoa = 'fisica' | 'juridica' | 'indefinido';

export function tipoDoDocumento(doc: string): TipoPessoa {
    const d = (doc || '').replace(/\D/g, '');
    if (d.length === 11) return 'fisica';
    if (d.length === 14) return 'juridica';
    return 'indefinido';
}

/** Máscara que muda sozinha conforme o documento cresce. */
export function formatarDocumento(valor: string): string {
    const d = (valor || '').replace(/\D/g, '').slice(0, 14);
    if (d.length <= 11) {
        return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2')
            .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
    }
    return d.replace(/(\d{2})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d)/, '$1/$2').replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}

export interface PessoaJuridica {
    existe?: boolean;
    codPessoa?: string;
    cnpj?: string;
    razaoSocial?: string;
    nomeFantasia?: string;
    jaExistia?: boolean;
    aviso?: string;
    error?: string;
}

/** Consulta a empresa pelo CNPJ. Só leitura. */
export async function buscarPessoaJuridica(cnpj: string): Promise<PessoaJuridica> {
    return chamarFuncao('buscar-pessoa-juridica', { cnpj });
}

/** Cria a empresa proprietária. Só usada quando a busca não achou. */
export async function cadastrarPessoaJuridica(dados: {
    cnpj: string; razaoSocial: string; nomeFantasia: string;
    rntrc: string; enquadramento?: string;
    /** DDD + 9 dígitos, com máscara. O CT-e exige contato do proprietário. */
    celular?: string;
    /** Endereço completo. Sem ele o CT-e não emite — a empresa nascia sem. */
    endereco?: {
        cep: string; logradouro: string; numero: string; complemento: string;
        bairro: string; cidade: string; codIBGE: string; estado: string;
    };
    inscricaoEstadual?: string;
    inscricaoMunicipal?: string;
}): Promise<PessoaJuridica> {
    return chamarFuncao('cadastrar-pessoa-juridica', dados);
}

/** invoke só expõe "non-2xx"; o motivo real vem no corpo. */
async function chamarFuncao(nome: string, body: Record<string, unknown>): Promise<PessoaJuridica> {
    try {
        const { data, error } = await supabase.functions.invoke(nome, { body, headers: cabecalhoCadastro() });
        if (error) {
            let msg = error.message;
            try {
                const b = await (error as any).context?.json?.();
                if (b?.error) msg = b.error;
            } catch { /* noop */ }
            return { error: msg };
        }
        return data as PessoaJuridica;
    } catch (e) {
        return { error: (e as Error).message || 'Falha ao consultar a empresa.' };
    }
}

/** Enquadramentos aceitos pela API (opcional no cadastro). */
export const ENQUADRAMENTOS: Array<{ valor: string; label: string }> = [
    { valor: '', label: '— não informar —' },
    { valor: 's', label: 'Optante pelo Simples' },
    { valor: 'g', label: 'Lucro Geral' },
    { valor: 'r', label: 'Lucro Geral - Real' },
    { valor: 'p', label: 'Lucro Geral - Presumido' },
    { valor: 'm', label: 'MEI - Microempreendedor' },
];
