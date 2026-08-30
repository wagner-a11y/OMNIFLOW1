import { supabase } from './supabase';
import {
    DadosCNH, DadosEndereco, DadosFiscais, cadastrarMotorista, cadastrarProprietarioPF,
} from './cadastroMotorista';
import { VeiculoParaGravar, cadastrarPessoaJuridica, cadastrarVeiculo } from './cadastroVeiculo';
import { cabecalhoCadastro } from './tokenCadastro';

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

/**
 * Quem é o dono de uma peça. O ponto é que o proprietário PODE AINDA NÃO
 * EXISTIR no Datamex quando o operador está preenchendo — ele é resolvido na
 * hora de gravar, não antes. Exigir que já existisse era o que travava a tela.
 *
 *   motorista  -> o motorista desta mesma tela, que a cascata cria no passo 1
 *   existente  -> alguém já cadastrado, achado pela busca
 *   novaPJ     -> empresa que a cascata cria antes dos veículos
 *   novaPF     -> pessoa física SEM CNH, criada antes dos veículos
 *
 * `novaPF` é o caso do caminhão no nome de quem não dirige — a mãe do
 * motorista, tipicamente. A API sempre aceitou pessoa física sem CNH (provado
 * em 29/08/2026: POST com cpf, nome, sobrenome, grupos, matriculaINSS, RNTRC,
 * dependentesIRRF e tipoTransportadora devolveu 201, e o veículo criado com ela
 * como proprietária foi aceito). Quem exigia CNH era a nossa tela, que só tinha
 * formulário de motorista.
 */
export type RefProprietario =
    | { tipo: 'motorista' }
    | { tipo: 'existente'; codPessoa: string; nome: string }
    | {
        tipo: 'novaPJ';
        cnpj: string; razaoSocial: string; nomeFantasia: string;
        rntrc: string; enquadramento: string;
        /** Exigidos pelo CT-e. A empresa nascia sem os dois até 30/08/2026. */
        celular: string;
        endereco: DadosEndereco;
    }
    | {
        tipo: 'novaPF';
        cpf: string; nome: string; sobrenome: string;
        /**
         * Obrigatório NA TELA, ainda que a API aceite sem: proprietário que
         * responde perante a ANTT precisa de RNTRC, e um cadastro sem ele volta
         * como pendência na emissão do CT-e.
         */
        rntrc: string;
        celular: string;
        /**
         * A API grava "0000-00-00" quando não recebe data — `null` e campo
         * omitido dão no mesmo. Data zerada é inválida, não é ausência, então o
         * nascimento é pedido em vez de deduzido.
         */
        dataNascimento: string;
        endereco: DadosEndereco;
    };

/** Texto curto do dono, para o resumo de conferência. */
export function descreverProprietario(r: RefProprietario | null, nomeMotorista: string): string {
    if (!r) return '—';
    if (r.tipo === 'motorista') return `${nomeMotorista || 'o motorista'} (motorista desta tela)`;
    if (r.tipo === 'existente') return `${r.nome} — código ${r.codPessoa}`;
    if (r.tipo === 'novaPF') return `${r.nome} ${r.sobrenome} (pessoa nova, será cadastrada)`.trim();
    return `${r.razaoSocial} (empresa nova, será cadastrada)`;
}

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
        const { data, error } = await supabase.functions.invoke(nome, { body, headers: cabecalhoCadastro() });
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
    /** Dono desta peça. Resolvido em código só na hora de gravar. */
    ref: RefProprietario | null;
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
 * Executa a cascata na ordem das DEPENDÊNCIAS:
 *   1) motorista            -> vira o proprietarioId de quem for {tipo:'motorista'}
 *   2) empresas novas       -> uma por CNPJ, mesmo que várias peças apontem para ela
 *   3) veículo principal    -> com o dono já resolvido
 *   4) implementos          -> cada um com o SEU dono
 *   5) vinculação           -> exige o motorista
 *
 * O proprietário NÃO precisa existir no Datamex quando o operador preenche a
 * tela: ele é uma referência, e só vira id aqui dentro. Era exigir a existência
 * antecipada que travava o caso mais comum de todos — o motorista ser o dono do
 * próprio caminhão.
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

    // ---- 2. Empresas novas, uma vez por CNPJ ----
    // Duas carretas do mesmo terceiro não podem virar dois cadastros. A própria
    // cadastrar-pessoa-juridica também protege disso, mas resolver aqui evita a
    // ida e volta e deixa o relato mais limpo.
    const pecas = [p.principal, ...p.implementos];
    const porCnpj = new Map<string, string>();
    for (const peca of pecas) {
        const ref = peca.ref;
        if (ref?.tipo !== 'novaPJ') continue;
        const cnpj = ref.cnpj.replace(/\D/g, '');
        if (porCnpj.has(cnpj)) continue;

        const r = await cadastrarPessoaJuridica({
            cnpj, razaoSocial: ref.razaoSocial, nomeFantasia: ref.nomeFantasia,
            rntrc: ref.rntrc, enquadramento: ref.enquadramento,
            celular: ref.celular,
            endereco: {
                cep: ref.endereco.cep, logradouro: ref.endereco.logradouro,
                numero: ref.endereco.numero, complemento: ref.endereco.complemento,
                bairro: ref.endereco.bairro,
                // `cidade` é o NOME e o código vai em codIBGE — inverso do veículo.
                cidade: ref.endereco.municipioNome, codIBGE: ref.endereco.cidade,
                estado: ref.endereco.estado,
            },
        });
        if (r.error || !r.codPessoa) {
            passos.push({ passo: `Empresa ${ref.razaoSocial}`, ok: false, detalhe: r.error });
            return parar(`Não consegui cadastrar a empresa ${ref.razaoSocial}: ${r.error ?? 'sem código de retorno'}`);
        }
        porCnpj.set(cnpj, r.codPessoa);
        passos.push({
            passo: `Empresa ${ref.razaoSocial}`, ok: true, codigo: r.codPessoa,
            detalhe: r.jaExistia ? 'já existia, reaproveitada' : 'criada',
        });
    }

    // ---- 2b. Pessoas físicas novas (proprietárias sem CNH), uma por CPF ----
    // Mesmo lugar da cascata que as empresas: antes dos veículos, porque o
    // veículo precisa do código do dono. Duas carretas da mesma pessoa não
    // podem virar dois cadastros.
    const porCpf = new Map<string, string>();
    for (const peca of pecas) {
        const ref = peca.ref;
        if (ref?.tipo !== 'novaPF') continue;
        const cpf = ref.cpf.replace(/\D/g, '');
        if (porCpf.has(cpf)) continue;

        const nomeCompleto = `${ref.nome} ${ref.sobrenome}`.trim();
        const r = await cadastrarProprietarioPF({
            cpf, nome: ref.nome, sobrenome: ref.sobrenome,
            rntrc: ref.rntrc, celular: ref.celular,
            dataNascimento: ref.dataNascimento, endereco: ref.endereco,
        });
        if (r.error || !r.codPessoa) {
            passos.push({ passo: `Proprietário ${nomeCompleto}`, ok: false, detalhe: r.error });
            return parar(`Não consegui cadastrar o proprietário ${nomeCompleto}: ${r.error ?? 'sem código de retorno'}`);
        }
        porCpf.set(cpf, r.codPessoa);
        passos.push({
            passo: `Proprietário ${nomeCompleto}`, ok: true, codigo: r.codPessoa,
            detalhe: r.jaExistia ? 'já existia, reaproveitado' : 'criado sem CNH (só proprietário)',
        });
    }

    /** Referência -> id de verdade. Só falha se a tela deixou passar algo incompleto. */
    const resolver = (ref: RefProprietario | null): string | null => {
        if (!ref) return null;
        if (ref.tipo === 'existente') return ref.codPessoa;
        if (ref.tipo === 'motorista') return motoristaId || null;
        if (ref.tipo === 'novaPF') return porCpf.get(ref.cpf.replace(/\D/g, '')) ?? null;
        return porCnpj.get(ref.cnpj.replace(/\D/g, '')) ?? null;
    };

    // ---- 3. Veículo principal ----
    const donoPrincipal = resolver(p.principal.ref);
    if (!donoPrincipal) {
        return parar('O veículo principal ficou sem proprietário resolvido. Nada foi gravado além do que está acima.');
    }
    const rp = await cadastrarVeiculo({ ...p.principal.form, proprietarioId: donoPrincipal });
    if (rp.error) {
        passos.push({ passo: `Veículo ${p.principal.placa}`, ok: false, detalhe: rp.error });
        return parar(`O veículo principal não entrou: ${rp.error}`);
    }
    passos.push({ passo: `Veículo ${p.principal.placa}`, ok: true, codigo: rp.codVeiculo });

    // ---- 4. Implementos, um a um, cada um com o dono dele ----
    for (const imp of p.implementos) {
        const dono = resolver(imp.ref);
        if (!dono) return parar(`O implemento ${imp.placa} ficou sem proprietário resolvido.`);
        const r = await cadastrarVeiculo({ ...imp.form, proprietarioId: dono });
        if (r.error) {
            passos.push({ passo: `Implemento ${imp.placa}`, ok: false, detalhe: r.error });
            return parar(`O implemento ${imp.placa} não entrou: ${r.error}`);
        }
        passos.push({ passo: `Implemento ${imp.placa}`, ok: true, codigo: r.codVeiculo });
    }

    // ---- 5. Vinculação: exige motorista, então sem ele é pulada ----
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
