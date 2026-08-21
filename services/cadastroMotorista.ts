import { supabase } from './supabase';

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
}

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
    { chave: 'rg', label: 'RG' },
    { chave: 'orgao_expedidor_rg', label: 'Órgão expedidor do RG' },
    { chave: 'registro_cnh', label: 'Registro da CNH' },
    { chave: 'categoria', label: 'Categoria' },
    { chave: 'codigo_seguranca', label: 'Código de segurança' },
    { chave: 'protocolo', label: 'Protocolo' },
    { chave: 'orgao_expedidor_cnh', label: 'Órgão expedidor da CNH' },
    { chave: 'data_expedicao', label: 'Expedição', tipo: 'date' },
    { chave: 'data_validade', label: 'Validade', tipo: 'date' },
    { chave: 'data_primeira_habilitacao', label: '1ª habilitação', tipo: 'date' },
    // O exame toxicológico é documento à parte — não está impresso na CNH.
    { chave: 'data_validade_toxicologico', label: 'Validade do toxicológico', tipo: 'date', manual: true },
];

export const CNH_VAZIA: DadosCNH = {
    nome: '', sobrenome: '', cpf: '', rg: '', orgao_expedidor_rg: '', sexo: '',
    data_nascimento: '', registro_cnh: '', codigo_seguranca: '', protocolo: '',
    categoria: '', orgao_expedidor_cnh: '', data_validade: '', data_expedicao: '',
    data_primeira_habilitacao: '', data_validade_toxicologico: '',
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
        rg: t('rg', 'documento_identidade'),
        orgao_expedidor_rg: t('orgao_expedidor_rg'),
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
    };
}

export interface ResultadoCadastro {
    codPessoa?: string;
    jaExistia?: boolean;
    anexado?: boolean;
    aviso?: string;
    error?: string;
}

/** Cria (ou reaproveita) o motorista no Bsoft. */
export async function cadastrarMotorista(
    dados: DadosCNH,
    anexo?: { base64: string; extensao: string },
): Promise<ResultadoCadastro> {
    try {
        const { data, error } = await supabase.functions.invoke('cadastrar-motorista', {
            body: {
                ...dados,
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
