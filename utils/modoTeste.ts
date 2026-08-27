// ============================================================================
// MODO DE TESTE — ANDAIME, NÃO É FUNCIONALIDADE.
//
// Serve para exercitar a CASCATA do cadastro de conjunto (ordem de gravação,
// detecção de cavalo, proprietário por peça, vinculação) sem precisar de CNH e
// CRLV em mãos. A leitura por OCR já foi validada à parte; o que falta provar é
// a orquestração, e ela não depende de documento.
//
// A GRAVAÇÃO CONTINUA REAL. Nada aqui simula chamada: o que for gravado entra
// mesmo no Datamex e precisa ser apagado depois. Simular a gravação provaria
// que o mock funciona, não que a integração funciona.
//
// POR QUE TRAVADO POR HOST, e não por variável de ambiente: variável se esquece
// de configurar, e o custo do esquecimento aqui é um botão de dados falsos na
// tela que a operação usa para cadastrar gente de verdade. Com a checagem de
// host, mesmo que isto seja mergeado por engano o modo não liga em produção.
//
// REMOVER ANTES DO MERGE DEFINITIVO. Este arquivo, o botão que o chama e as
// props `dadosTeste` dos componentes existem só enquanto a Fase 3C está sendo
// validada.
// ============================================================================

/** Domínios de produção do OmniFlow. Em qualquer um deles o modo fica desligado. */
const HOSTS_PRODUCAO = [
    'omniflow-gestao-inteligente.vercel.app',
    'omniflow-gestao-inteligente-wagners-projects-ec70e6ed.vercel.app',
    'omniflow-gestao-inteligente-git-main-wagners-projects-ec70e6ed.vercel.app',
];

/** Só liga fora de produção: preview de branch e desenvolvimento local. */
export const MODO_TESTE_DISPONIVEL =
    typeof window !== 'undefined' && !HOSTS_PRODUCAO.includes(window.location.hostname);

/** Dígitos verificadores de CPF, para gerar um número que a API não recuse. */
function comDigitosCpf(base9: string): string {
    const dv = (base: string) => {
        const soma = base.split('').reduce((a, d, i) => a + Number(d) * (base.length + 1 - i), 0);
        const r = 11 - (soma % 11);
        return r >= 10 ? '0' : String(r);
    };
    const d1 = dv(base9);
    return base9 + d1 + dv(base9 + d1);
}

export interface DadosTestePeca {
    placa: string;
    chassi: string;
    renavam: string;
    modelo: string;
    categoriaVeiculo: string;
    marcaVeiculo: string;
    tipoRodado: string;
    tipoCarroceria: string;
    capM3: string;
    tara: string;
    capacidadeCarga: string;
    quantidadeEixos: string;
    cor: string;
    anoModelo: string;
    anoFabricacao: string;
    descricao: string;
    /** Documento do proprietário desta peça, já mascarado. */
    documentoProprietario: string;
}

export interface DadosTesteConjunto {
    cpf: string;
    nome: string;
    sobrenome: string;
    cavalo: DadosTestePeca;
    carreta: DadosTestePeca;
}

/**
 * Monta um conjunto coerente e IRREPETÍVEL: o sufixo vem do relógio, então cada
 * clique gera CPF, placas e chassis novos. Sem isso o segundo teste bateria na
 * anti-duplicação e não exercitaria a cascata até o fim.
 */
export function gerarConjuntoTeste(): DadosTesteConjunto {
    const agora = String(Date.now());
    const seis = agora.slice(-6);
    const quatro = agora.slice(-4);
    const tres = agora.slice(-3);

    return {
        cpf: comDigitosCpf(`9${seis}${agora.slice(-8, -6)}`.slice(0, 9)),
        nome: 'TESTE',
        sobrenome: `OMNIFLOW APAGAR ${quatro}`,
        cavalo: {
            // Cavalo mecânico Mercedes: é o que faz a tela abrir os implementos.
            placa: `TST-${quatro}`,
            chassi: `9TESTCAVALO${seis}`,
            renavam: `1${seis}${tres}`,
            modelo: 'ATEGO 2426 TESTE',
            categoriaVeiculo: '1',      // CAVALO
            marcaVeiculo: '9',          // MERCEDES BENZ na categoria CAVALO
            tipoRodado: '03',           // Cavalo Mecanico
            tipoCarroceria: '00',       // Nao aplicavel
            capM3: '1',
            tara: '8500', capacidadeCarga: '20000', quantidadeEixos: '3',
            cor: 'Branco', anoModelo: '2020', anoFabricacao: '2020',
            descricao: `TESTE OMNIFLOW APAGAR CAVALO ${quatro}`,
            documentoProprietario: '',  // vazio: assume o motorista da tela
        },
        carreta: {
            placa: `TSR-${quatro}`,
            chassi: `9TESTCARRET${seis}`,
            renavam: `2${seis}${tres}`,
            modelo: 'SR GRANELEIRA TESTE',
            categoriaVeiculo: '3',      // CARRETA
            marcaVeiculo: '20',         // RANDON na categoria CARRETA
            tipoRodado: '00',           // Nao aplicavel (semi-reboque)
            tipoCarroceria: '03',       // Graneleira
            capM3: '45',
            tara: '6200', capacidadeCarga: '30000', quantidadeEixos: '3',
            cor: 'Vermelho', anoModelo: '2019', anoFabricacao: '2019',
            descricao: `TESTE OMNIFLOW APAGAR CARRETA ${quatro}`,
            // ALUTRANS, que JÁ EXISTE no Datamex (11292). Assim o teste exercita
            // "dono diferente do motorista" pelo caminho de buscar-e-vincular,
            // sem criar uma empresa nova a cada rodada. Trocar por um CNPJ
            // inexistente aqui na tela testa o outro caminho, o do mini-cadastro.
            documentoProprietario: '51.955.925/0001-27',
        },
    };
}

/** Endereço de teste — CEP real, para a busca do ViaCEP funcionar de verdade. */
export const ENDERECO_TESTE = {
    cep: '12070-450',
    numero: '100',
    complemento: '',
};
