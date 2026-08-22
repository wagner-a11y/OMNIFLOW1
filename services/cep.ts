import { Municipio, carregarMunicipios } from '../utils/municipios';

// ============================================================================
// Busca de CEP — ViaCEP, direto do front.
//
// O ViaCEP é público e sem credencial, então não há motivo para atravessar uma
// Edge Function: seria um salto a mais para o mesmo dado, e nenhum segredo é
// envolvido.
//
// VALIDAÇÃO CRUZADA: o ViaCEP devolve o código IBGE do município, que é
// exatamente o que o Bsoft quer no campo `cidade` do endereço. Em vez de
// confiar nesse número direto, casamos ele com data/municipios-ibge.json (a
// mesma base que já trava o autocomplete da cotação). Se os dois não baterem,
// falhamos em voz alta em vez de mandar um código que ninguém conferiu — um
// município errado aqui vira endereço errado no cadastro do motorista.
// ============================================================================

export interface EnderecoCep {
    /** Já no formato que o Bsoft exige: "00000-000", com hífen. */
    cep: string;
    logradouro: string;
    bairro: string;
    /** Município conferido contra a base do IBGE — traz nome, UF e código. */
    municipio: Municipio;
    /** ViaCEP às vezes traz complemento genérico ("de 100 ao fim"); é sugestão. */
    complementoSugerido: string;
}

export const soDigitosCep = (s: string): string => (s || '').replace(/\D/g, '').slice(0, 8);

/** Máscara progressiva: "90010" -> "90010", "900100" -> "90010-0". */
export const formatarCep = (s: string): string => {
    const d = soDigitosCep(s);
    return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
};

interface RespostaViaCep {
    cep?: string; logradouro?: string; complemento?: string; bairro?: string;
    localidade?: string; uf?: string; ibge?: string; erro?: boolean | string;
}

/**
 * Busca o CEP e devolve o endereço com o município já validado.
 * Lança Error com mensagem pronta para a tela — quem chama só exibe.
 */
export async function buscarCep(cepBruto: string): Promise<EnderecoCep> {
    const d = soDigitosCep(cepBruto);
    if (d.length !== 8) throw new Error('O CEP precisa ter 8 dígitos.');

    let resposta: Response;
    try {
        resposta = await fetch(`https://viacep.com.br/ws/${d}/json/`);
    } catch {
        throw new Error('Não consegui falar com o ViaCEP. Confira a conexão ou preencha o endereço à mão.');
    }
    if (!resposta.ok) throw new Error(`O ViaCEP respondeu HTTP ${resposta.status}. Tente de novo ou preencha à mão.`);

    let dados: RespostaViaCep;
    try { dados = await resposta.json(); } catch { throw new Error('O ViaCEP devolveu uma resposta que não consegui ler.'); }

    // CEP inexistente vem como {erro: true} (ou "true"), com HTTP 200.
    if (dados.erro === true || dados.erro === 'true') {
        throw new Error(`O CEP ${formatarCep(d)} não existe na base dos Correios. Confira o número.`);
    }

    const lista = await carregarMunicipios();
    const codigo = Number(dados.ibge);
    const municipio = codigo ? lista.find(m => m.codigo === codigo) ?? null : null;

    if (!municipio) {
        throw new Error(
            `O ViaCEP achou o CEP (${dados.localidade ?? '?'}/${dados.uf ?? '?'}), mas o código IBGE ` +
            `${dados.ibge ?? 'vazio'} não existe na tabela de municípios. Preencha o endereço à mão.`,
        );
    }
    // Divergência de UF entre as duas fontes: alguma das duas está errada, e não
    // dá para saber qual. Melhor parar do que escolher no chute.
    if (dados.uf && municipio.uf !== dados.uf) {
        throw new Error(
            `Divergência entre as fontes: o ViaCEP diz ${dados.localidade}/${dados.uf} e o código IBGE ` +
            `${dados.ibge} é de ${municipio.rotulo}. Preencha o endereço à mão.`,
        );
    }

    return {
        cep: formatarCep(d),
        logradouro: dados.logradouro || '',
        bairro: dados.bairro || '',
        municipio,
        complementoSugerido: dados.complemento || '',
    };
}
