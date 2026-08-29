import { supabase } from './supabase';
import { cabecalhoCadastro } from './tokenCadastro';

// ============================================================================
// Cadastro de motorista no Bsoft — Fase 2.
//
// A leitura da CNH reusa a Edge Function process-document (a mesma que já
// existia, com o prompt ampliado). O cadastro em si vai pela cadastrar-motorista.
// Nenhuma credencial do Bsoft passa pelo front.
// ============================================================================

/** Campos da CNH que a IA devolve e o operador confere na tela. */
export interface DadosCNH {
    tipo_documento?: string;
    nome: string;
    sobrenome: string;
    cpf: string;
    rg: string;
    orgao_expedidor_rg: string;
    uf_rg: string;
    /** Não costuma estar na CNH — digitação manual, opcional. */
    data_emissao_rg: string;
    nome_mae: string;
    nome_pai: string;
    sexo: string;
    data_nascimento: string;
    registro_cnh: string;
    codigo_seguranca: string;
    protocolo: string;
    categoria: string;
    orgao_expedidor_cnh: string;
    data_validade: string;
    data_expedicao: string;
    data_primeira_habilitacao: string;
    data_validade_toxicologico: string;
    /** Local de nascimento, quando o modelo da CNH traz. Alimenta a UF de naturalidade. */
    naturalidade_municipio: string;
    naturalidade_uf: string;
    /** UF do órgão emissor — o que sobra quando a CNH não traz naturalidade. */
    uf_emissao_cnh: string;
}

/**
 * Campos que o Bsoft exige na pessoa física e que NÃO estão na CNH.
 * Vêm com padrão preenchido, menos o RNTRC, que é digitação do operador.
 */
export interface DadosFiscais {
    estado_civil: string;
    nacionalidade: string;
    /** Município de nascimento (texto livre — a API não pede código aqui). */
    naturalidade: string;
    uf_naturalidade: string;
    matricula_inss: string;
    /**
     * Registro do TRANSPORTADOR, não do condutor. Só é pedido — e só é
     * obrigatório — quando o motorista também é dono do veículo.
     */
    rntrc: string;
    /** Motorista que também é proprietário do veículo. Mexe em grupo e RNTRC. */
    proprietario: boolean;
    /** Só é enviado quando proprietário — a API o exige nesse caso. */
    dependentes_irrf: string;
    /** Obrigatório no Bsoft. Vai com máscara: "(00) 00000-0000". */
    celular: string;
}

/** Endereço da pessoa — sub-recurso do cadastro no Bsoft. */
export interface DadosEndereco {
    cep: string;
    logradouro: string;
    numero: string;
    complemento: string;
    bairro: string;
    /** Código IBGE de 7 dígitos, resolvido pela busca de CEP. Vazio = não conferido. */
    cidade: string;
    /**
     * NOME do município. O POST de endereço quer o nome no campo `cidade` e o
     * código num campo separado (`codIBGE`) — ao contrário do POST de veículo,
     * onde `cidade` É o código. Confundir os dois faz o Datamex gravar o
     * endereço sem município nem estado, e sem eles o CT-e não emite.
     */
    municipioNome: string;
    /** Sigla da UF. */
    estado: string;
    /** Só para a tela mostrar "Porto Alegre, RS" — não vai para a API. */
    municipioRotulo: string;
}

export const FISCAIS_PADRAO: DadosFiscais = {
    estado_civil: 'S',
    // O exemplo oficial da API usa "Brasil", não "Brasileira".
    nacionalidade: 'Brasil',
    naturalidade: '',
    uf_naturalidade: '',
    celular: '',
    // O TMS oferece "Ignorar Validação" para quem não tem matrícula; o zerado é o
    // equivalente aceito pela API.
    matricula_inss: '0.000.000.000-0',
    rntrc: '',
    // Padrão é só condutor: é o caso comum, e não pede RNTRC.
    proprietario: false,
    dependentes_irrf: '0',
};

export const ENDERECO_VAZIO: DadosEndereco = {
    cep: '', logradouro: '', numero: '', complemento: '',
    bairro: '', cidade: '', municipioNome: '', estado: '', municipioRotulo: '',
};

/**
 * Preenche a UF de naturalidade a partir do que a CNH deu: primeiro o local de
 * nascimento; se o documento não trouxer, a UF do órgão emissor como aproximação.
 * O operador confere e corrige — por isso é padrão, não verdade.
 */
export function fiscaisDaCnh(cnh: DadosCNH, atual: DadosFiscais): DadosFiscais {
    const novo = { ...atual };
    if (!novo.naturalidade && cnh.naturalidade_municipio) novo.naturalidade = cnh.naturalidade_municipio;
    if (!novo.uf_naturalidade) {
        const uf = (cnh.naturalidade_uf || cnh.uf_emissao_cnh || '').toUpperCase().slice(0, 2);
        if (uf) novo.uf_naturalidade = uf;
    }
    return novo;
}

/** Máscara de celular: "(51) 99999-9999". Aceita digitação parcial. */
export function formatarCelular(valor: string): string {
    const d = (valor || '').replace(/\D/g, '').slice(0, 11);
    if (d.length <= 2) return d.length ? `(${d}` : '';
    if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** 11 dígitos: 2 de DDD + 9 do número. É o que o Bsoft espera. */
export const celularValido = (valor: string): boolean => (valor || '').replace(/\D/g, '').length === 11;

export const ESTADOS_CIVIS: Array<{ valor: string; label: string }> = [
    { valor: 'S', label: 'Solteiro(a)' },
    { valor: 'C', label: 'Casado(a)' },
    { valor: 'D', label: 'Divorciado(a)' },
    { valor: 'V', label: 'Viúvo(a)' },
];

/**
 * `manual: true` = campo que NÃO vem na CNH e é preenchido à mão. A tela não o
 * marca como falha de leitura — senão pareceria que o OCR errou toda vez.
 */
export const CAMPOS_CNH: Array<{ chave: keyof DadosCNH; label: string; tipo?: 'date'; manual?: boolean }> = [
    { chave: 'nome', label: 'Nome' },
    { chave: 'sobrenome', label: 'Sobrenome' },
    { chave: 'cpf', label: 'CPF' },
    { chave: 'data_nascimento', label: 'Nascimento', tipo: 'date' },
    { chave: 'sexo', label: 'Sexo (M/F)' },
    { chave: 'nome_mae', label: 'Nome da mãe' },
    { chave: 'nome_pai', label: 'Nome do pai' },
    { chave: 'rg', label: 'RG (número)' },
    { chave: 'orgao_expedidor_rg', label: 'Órgão expedidor do RG' },
    { chave: 'uf_rg', label: 'UF do RG' },
    // A data de emissão do RG não está impressa na CNH.
    { chave: 'data_emissao_rg', label: 'Emissão do RG', tipo: 'date', manual: true },
    { chave: 'registro_cnh', label: 'Registro da CNH' },
    { chave: 'categoria', label: 'Categoria' },
    { chave: 'codigo_seguranca', label: 'Código de segurança' },
    { chave: 'protocolo', label: 'Protocolo' },
    { chave: 'orgao_expedidor_cnh', label: 'Órgão expedidor da CNH' },
    { chave: 'data_expedicao', label: 'Expedição', tipo: 'date' },
    { chave: 'data_validade', label: 'Validade', tipo: 'date' },
    { chave: 'data_primeira_habilitacao', label: '1ª habilitação', tipo: 'date' },
    // O exame toxicológico é documento à parte — não está impresso na CNH. Mesmo
    // assim a API do Bsoft o EXIGE (cnh.dtValidadeExameToxicologico): sem ele o
    // cadastro é recusado. Por isso é `manual` (não é falha de OCR) e obrigatório.
    { chave: 'data_validade_toxicologico', label: 'Validade do toxicológico', tipo: 'date', manual: true },
];

export const CNH_VAZIA: DadosCNH = {
    nome: '', sobrenome: '', cpf: '', rg: '', orgao_expedidor_rg: '', sexo: '',
    data_nascimento: '', registro_cnh: '', codigo_seguranca: '', protocolo: '',
    categoria: '', orgao_expedidor_cnh: '', data_validade: '', data_expedicao: '',
    data_primeira_habilitacao: '', data_validade_toxicologico: '',
    naturalidade_municipio: '', naturalidade_uf: '', uf_emissao_cnh: '',
    uf_rg: '', data_emissao_rg: '', nome_mae: '', nome_pai: '',
};

/** Normaliza o retorno da IA: null vira string vazia, e aceita chaves alternativas. */
export function daIaParaFormulario(bruto: Record<string, unknown>): DadosCNH {
    const t = (...chaves: string[]) => {
        for (const k of chaves) {
            const v = bruto[k];
            if (v !== null && v !== undefined && String(v).trim()) return String(v).trim();
        }
        return '';
    };
    return {
        tipo_documento: t('tipo_documento'),
        nome: t('nome', 'nome_completo'),
        sobrenome: t('sobrenome'),
        cpf: t('cpf'),
        rg: t('numero_rg', 'rg', 'documento_identidade'),
        orgao_expedidor_rg: t('orgao_expedidor_rg'),
        uf_rg: t('uf_rg').toUpperCase().slice(0, 2),
        data_emissao_rg: t('data_emissao_rg'),
        nome_mae: t('nome_mae', 'mae', 'filiacao_mae'),
        nome_pai: t('nome_pai', 'pai', 'filiacao_pai'),
        sexo: t('sexo').toUpperCase().slice(0, 1),
        data_nascimento: t('data_nascimento'),
        registro_cnh: t('registro_cnh', 'cnh_numero'),
        codigo_seguranca: t('codigo_seguranca', 'seguranca_cnh'),
        protocolo: t('protocolo', 'protocolo_cnh'),
        categoria: t('categoria'),
        orgao_expedidor_cnh: t('orgao_expedidor_cnh'),
        data_validade: t('data_validade'),
        data_expedicao: t('data_expedicao'),
        data_primeira_habilitacao: t('data_primeira_habilitacao'),
        data_validade_toxicologico: t('data_validade_toxicologico'),
        naturalidade_municipio: t('naturalidade_municipio'),
        naturalidade_uf: t('naturalidade_uf').toUpperCase().slice(0, 2),
        uf_emissao_cnh: t('uf_emissao_cnh').toUpperCase().slice(0, 2),
    };
}

export interface ResultadoCadastro {
    codPessoa?: string;
    codEndereco?: string | null;
    jaExistia?: boolean;
    anexado?: boolean;
    aviso?: string;
    error?: string;
}

/**
 * Cria (ou reaproveita) uma pessoa física que é SÓ PROPRIETÁRIA de veículo —
 * não dirige e não tem CNH. O caso concreto é o caminhão registrado no nome de
 * quem não é motorista, tipicamente a mãe ou o cônjuge.
 *
 * Nenhum campo de CNH é enviado. Isso é o oposto de enviá-los em branco: uma
 * CNH vazia afirmaria no Datamex que a pessoa tem habilitação sem número, e
 * depois ninguém saberia separar isso de um cadastro mal preenchido.
 *
 * O RNTRC é exigido pela TELA, não pela API. Proprietário que responde perante
 * a ANTT precisa dele, e o cadastro sem RNTRC só cobra o preço mais tarde, na
 * emissão do CT-e.
 */
export async function cadastrarProprietarioPF(p: {
    cpf: string;
    nome: string;
    sobrenome: string;
    rntrc: string;
    endereco: DadosEndereco;
}): Promise<ResultadoCadastro> {
    try {
        const { data, error } = await supabase.functions.invoke('cadastrar-motorista', {
            headers: cabecalhoCadastro(),
            body: {
                apenasProprietario: true,
                cpf: p.cpf,
                nome: p.nome,
                sobrenome: p.sobrenome,
                rntrc: p.rntrc,
                // Obrigatórios do grupo proprietariosVeiculos, medidos na API.
                matricula_inss: '0.000.000.000-0',
                dependentes_irrf: 0,
                // "T" = TAC, transportador autônomo de carga: é o enquadramento
                // da pessoa física dona de veículo.
                tipo_transportadora: 'T',
                endereco: {
                    cep: p.endereco.cep,
                    logradouro: p.endereco.logradouro,
                    numero: p.endereco.numero,
                    complemento: p.endereco.complemento,
                    bairro: p.endereco.bairro,
                    cidade: p.endereco.municipioNome,
                    codIBGE: p.endereco.cidade,
                    estado: p.endereco.estado,
                },
            },
        });
        if (error) {
            let msg = error.message;
            try { const b = await (error as any).context?.json?.(); if (b?.error) msg = b.error; } catch { /* noop */ }
            return { error: msg };
        }
        return data as ResultadoCadastro;
    } catch (e) {
        return { error: (e as Error).message || 'Falha ao cadastrar o proprietário.' };
    }
}

/** Cria (ou reaproveita) o motorista no Bsoft, com endereço e anexo. */
export async function cadastrarMotorista(
    dados: DadosCNH,
    fiscais: DadosFiscais,
    endereco: DadosEndereco,
    anexo?: { base64: string; extensao: string },
): Promise<ResultadoCadastro> {
    try {
        const { data, error } = await supabase.functions.invoke('cadastrar-motorista', {
            headers: cabecalhoCadastro(),
            body: {
                ...dados,
                ...fiscais,
                // Sem RNTRC quando não é proprietário: o back nem monta o campo.
                rntrc: fiscais.proprietario ? fiscais.rntrc : '',
                // `municipioRotulo` é só rótulo de tela; a API recebe o código IBGE.
                endereco: {
                    cep: endereco.cep,
                    logradouro: endereco.logradouro,
                    numero: endereco.numero,
                    complemento: endereco.complemento,
                    bairro: endereco.bairro,
                    // `cidade` é o NOME; o código vai à parte, em `codIBGE`.
                    cidade: endereco.municipioNome,
                    codIBGE: endereco.cidade,
                    estado: endereco.estado,
                },
                ...(anexo ? { arquivoBase64: anexo.base64, arquivoExtensao: anexo.extensao } : {}),
            },
        });
        if (error) {
            // invoke só expõe "non-2xx"; o motivo real vem no corpo.
            let msg = error.message;
            try { const b = await (error as any).context?.json?.(); if (b?.error) msg = b.error; } catch { /* noop */ }
            return { error: msg };
        }
        if (data?.error) return { error: data.error };
        return data as ResultadoCadastro;
    } catch (e) {
        return { error: (e as Error).message || 'Falha ao chamar o cadastro.' };
    }
}

/** Registra quem cadastrou e quando. Best-effort: nunca derruba o cadastro. */
export async function registrarLog(linha: {
    cpf?: string; nome?: string; codPessoa?: string;
    jaExistia?: boolean; anexado?: boolean; sucesso: boolean; erro?: string;
    autor: { id?: string; name?: string };
}): Promise<void> {
    if (!linha.autor.id) return;   // a RLS exige criado_por = auth.uid()
    try {
        await supabase.from('cadastro_log').insert([{
            tipo: 'motorista',
            cpf: linha.cpf || null,
            nome: linha.nome || null,
            cod_pessoa: linha.codPessoa || null,
            ja_existia: !!linha.jaExistia,
            anexado: !!linha.anexado,
            sucesso: linha.sucesso,
            erro: linha.erro || null,
            criado_por: linha.autor.id,
            criado_por_nome: linha.autor.name || null,
        }]);
    } catch (e) {
        console.error('cadastro_log (ignorado):', e);
    }
}
