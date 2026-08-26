import { supabase } from './supabase';
import {
    DadosCNH, DadosEndereco, DadosFiscais, cadastrarMotorista,
} from './cadastroMotorista';
import { VeiculoParaGravar, cadastrarVeiculo } from './cadastroVeiculo';

// ============================================================================
// Conjunto de veículos — Fase 3C.
//
// Orquestra o que as fases 2, 3A e 3B já sabem fazer, numa cascata só. Não há
// regra de negócio nova aqui: motorista, veículo e proprietário continuam
// sendo gravados pelas mesmas funções de sempre. O que este arquivo acrescenta
// é a ORDEM e, principalmente, o RELATO de onde parou quando algo falha.
//
// Por que o relato importa: não existe delete seguro nessa API. Se a terceira
// peça falhar, as duas primeiras já estão no Datamex e não dá para desfazer.
// Tentar reverter às cegas criaria um estrago maior que o do erro original.
// Então a cascata para no primeiro erro e devolve TUDO que já gravou, com os
// códigos, para o operador resolver com informação em vez de no escuro.
// ============================================================================

// ----------------------------------------------------------------------------
// CONFIGURAÇÃO AJUSTÁVEL
// ----------------------------------------------------------------------------

/**
 * Categorias que caracterizam veículo de tração com implemento. Quando o CRLV
 * do veículo principal cai numa destas, a tela abre os blocos de carreta.
 * Comparado sem acento e sem caixa.
 */
export const CATEGORIAS_COM_IMPLEMENTO = ['CAVALO'];

/** Quantos implementos a tela expõe. A API aceita 3 (central/carreta/quartoVeiculo). */
export const IMPLEMENTOS_VISIVEIS = 2;

// ----------------------------------------------------------------------------

export interface VinculoAtual {
    id: string;
    motorista: string;
    veiculo: string;
}

/** Vínculos que o motorista já tem — mostrados antes de gravar. */
export async function consultarVinculos(cpf: string): Promise<{ vinculos?: VinculoAtual[]; error?: string }> {
    return invocar('vincular-conjunto', { consultarCpf: cpf });
}

export interface PedidoVinculo {
    motoristaId: string;
    veiculo: string;
    central?: string;
    carreta?: string;
    quartoVeiculo?: string;
    /** "S" apaga TODOS os outros vínculos do motorista. Só com confirmação. */
    removerVinculacoes?: 'S' | 'N';
}

export async function vincularConjunto(v: PedidoVinculo): Promise<{ ok?: boolean; codVinculo?: string; removeuOutras?: boolean; error?: string }> {
    return invocar('vincular-conjunto', { vincular: v });
}

async function invocar(nome: string, body: unknown): Promise<any> {
    try {
        const { data, error } = await supabase.functions.invoke(nome, { body });
        if (error) {
            let msg = error.message;
            try {
                const b = await (error as any).context?.json?.();
                if (b?.error) msg = b.error;
            } catch { /* noop */ }
            return { error: msg };
        }
        return data;
    } catch (e) {
        return { error: (e as Error).message || 'Falha ao chamar a função.' };
    }
}

// ----------------------------------------------------------------------------
// A cascata
// ----------------------------------------------------------------------------

/** Uma peça do conjunto, do jeito que a tela monta. */
export interface PecaVeiculo {
    rotulo: string;
    form: VeiculoParaGravar;
    /** Placa normalizada — é por ela que a vinculação identifica o veículo. */
    placa: string;
}

export interface PedidoConjunto {
    /** Ausente quando o operador não cadastra motorista nesta sessão. */
    motorista?: {
        dados: DadosCNH;
        fiscais: DadosFiscais;
        endereco: DadosEndereco;
        anexo?: { base64: string; extensao: string };
    };
    /** Código de motorista já existente, quando não há cadastro novo. */
    motoristaIdExistente?: string;
    /** CPF do motorista — usado só para consultar vínculos. */
    motoristaCpf?: string;
    principal: PecaVeiculo;
    implementos: PecaVeiculo[];
    removerVinculacoes: 'S' | 'N';
}

export interface PassoResultado {
    passo: string;
    ok: boolean;
    codigo?: string;
    detalhe?: string;
}

export interface ResultadoConjunto {
    passos: PassoResultado[];
    /** Onde parou. Vazio = terminou tudo. */
    erro?: string;
    concluido: boolean;
}

/**
 * Executa a cascata na ordem das dependências:
 *   1) motorista  2) veículo principal  3) implementos  4) vinculação
 *
 * O proprietário de cada veículo já vem resolvido pela tela (busca ou
 * mini-cadastro da 3B), então aqui ele é só um id que acompanha o form.
 */
export async function gravarConjunto(p: PedidoConjunto): Promise<ResultadoConjunto> {
    const passos: PassoResultado[] = [];
    const parar = (erro: string): ResultadoConjunto => ({ passos, erro, concluido: false });

    // ---- 1. Motorista ----
    let motoristaId = p.motoristaIdExistente ?? '';
    if (p.motorista) {
        const r = await cadastrarMotorista(
            p.motorista.dados, p.motorista.fiscais, p.motorista.endereco, p.motorista.anexo,
        );
        if (r.error) {
            passos.push({ passo: 'Motorista', ok: false, detalhe: r.error });
            return parar(`Não consegui cadastrar o motorista: ${r.error}`);
        }
        motoristaId = r.codPessoa ?? '';
        passos.push({
            passo: 'Motorista', ok: true, codigo: motoristaId,
            detalhe: r.jaExistia ? 'já existia, reaproveitado' : 'criado',
        });
    }

    // ---- 2. Veículo principal ----
    const rp = await cadastrarVeiculo(p.principal.form);
    if (rp.error) {
        passos.push({ passo: `Veículo ${p.principal.placa}`, ok: false, detalhe: rp.error });
        return parar(`O veículo principal não entrou: ${rp.error}`);
    }
    passos.push({ passo: `Veículo ${p.principal.placa}`, ok: true, codigo: rp.codVeiculo });

    // ---- 3. Implementos, um a um e na ordem ----
    for (const imp of p.implementos) {
        const r = await cadastrarVeiculo(imp.form);
        if (r.error) {
            passos.push({ passo: `Implemento ${imp.placa}`, ok: false, detalhe: r.error });
            return parar(`O implemento ${imp.placa} não entrou: ${r.error}`);
        }
        passos.push({ passo: `Implemento ${imp.placa}`, ok: true, codigo: r.codVeiculo });
    }

    // ---- 4. Vinculação: exige motorista, então sem ele é pulada ----
    if (!motoristaId) {
        passos.push({
            passo: 'Vinculação', ok: true,
            detalhe: 'pulada — sem motorista definido, a API não permite vincular',
        });
        return { passos, concluido: true };
    }

    const [central, carreta, quarto] = p.implementos.map(i => i.placa);
    const rv = await vincularConjunto({
        motoristaId,
        veiculo: p.principal.placa,
        central, carreta, quartoVeiculo: quarto,
        removerVinculacoes: p.removerVinculacoes,
    });
    if (rv.error) {
        passos.push({ passo: 'Vinculação', ok: false, detalhe: rv.error });
        return parar(
            `Os veículos foram cadastrados, mas a vinculação falhou: ${rv.error}. ` +
            `Nada precisa ser recadastrado — só a amarração ficou pendente.`,
        );
    }
    passos.push({
        passo: 'Vinculação', ok: true, codigo: rv.codVinculo,
        detalhe: rv.removeuOutras ? 'vínculos anteriores removidos' : 'somada aos vínculos existentes',
    });

    return { passos, concluido: true };
}
