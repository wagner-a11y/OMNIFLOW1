import React, { useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { buscarCep, formatarCep } from '../services/cep';
import {
    DadosEndereco, ENDERECO_VAZIO, celularValido, formatarCelular,
} from '../services/cadastroMotorista';
import { ENQUADRAMENTOS } from '../services/cadastroVeiculo';

// ============================================================================
// Formulários de PESSOA NOVA que vai ser proprietária de veículo.
//
// Estavam dentro do BlocoVeiculoCRLV, o que os prendia ao cadastro de veículo.
// Saíram para cá porque agora servem a dois lugares: o bloco do conjunto e a
// tela de "cadastrar só o proprietário".
//
// UM CÓDIGO SÓ, de propósito. Uma segunda versão envelheceria à parte, e foi
// exatamente isso que produziu os dois bugs desta semana — os campos duplicados
// e a tela branca. Quem mexer aqui mexe nos dois lugares ao mesmo tempo, que é o
// que se quer.
//
// Componentes CONTROLADOS: o estado mora em quem usa. No conjunto ele alimenta
// a referência que a cascata resolve na hora de gravar; na tela avulsa ele é o
// próprio formulário. Guardar estado aqui dentro obrigaria os dois a adivinhar
// quando ele mudou.
// ============================================================================

export interface PessoaFisicaNova {
    /** Quem dirige vai para o cadastro completo, com CNH — que não cabe aqui. */
    ehMotorista: boolean;
    nome: string;
    sobrenome: string;
    rntrc: string;
    celular: string;
    dataNascimento: string;
    endereco: DadosEndereco;
}

export interface PessoaJuridicaNova {
    razaoSocial: string;
    nomeFantasia: string;
    rntrc: string;
    enquadramento: string;
    celular: string;
    endereco: DadosEndereco;
}

export const PF_NOVA_VAZIA: PessoaFisicaNova = {
    ehMotorista: false, nome: '', sobrenome: '', rntrc: '',
    celular: '', dataNascimento: '', endereco: ENDERECO_VAZIO,
};

export const PJ_NOVA_VAZIA: PessoaJuridicaNova = {
    razaoSocial: '', nomeFantasia: '', rntrc: '', enquadramento: '',
    celular: '', endereco: ENDERECO_VAZIO,
};

/**
 * Endereço completo o bastante para o CT-e.
 *
 * `cidade` é o código IBGE, que só existe quando o CEP foi buscado — é o que
 * impede mandar município no chute. Digitado à mão ele não tem código, e sem
 * código o Datamex grava endereço sem município nem estado.
 */
export const enderecoOk = (e: DadosEndereco): boolean =>
    !!e.cep.trim() && !!e.logradouro.trim() && !!e.numero.trim()
    && !!e.bairro.trim() && !!e.cidade.trim();

/** Pessoa física pronta para gravar. Nascimento entra porque a API não aceita vazio. */
export const pfNovaOk = (p: PessoaFisicaNova): boolean =>
    !p.ehMotorista && !!p.nome.trim() && !!p.rntrc.trim()
    && celularValido(p.celular) && !!p.dataNascimento.trim() && enderecoOk(p.endereco);

export const pjNovaOk = (p: PessoaJuridicaNova): boolean =>
    !!p.razaoSocial.trim() && !!p.nomeFantasia.trim() && !!p.rntrc.trim()
    && celularValido(p.celular) && enderecoOk(p.endereco);

const soDigitos = (s: string) => (s || '').replace(/\D/g, '');
const classeNormal = 'w-full px-3 py-2.5 rounded-lg text-sm font-medium outline-none border bg-[#f9fafb] border-[#e5e7eb] focus:border-[#1d6fb8] transition-colors';
const classeCampo = (ok: boolean) =>
    `w-full px-3 py-2.5 rounded-lg text-sm font-semibold outline-none border-2 transition-colors ${ok
        ? 'bg-white border-emerald-300' : 'bg-amber-50 border-amber-400'}`;

/** Bloco de endereço com busca de CEP. Igual para pessoa física e empresa. */
const BlocoEndereco: React.FC<{
    titulo: string;
    valor: DadosEndereco;
    onChange: (e: DadosEndereco) => void;
}> = ({ titulo, valor, onChange }) => {
    const [buscando, setBuscando] = useState(false);
    const [erro, setErro] = useState<string | null>(null);

    const procurar = async () => {
        setBuscando(true); setErro(null);
        try {
            const achado = await buscarCep(valor.cep);
            onChange({
                ...valor,
                cep: achado.cep,
                logradouro: achado.logradouro || valor.logradouro,
                bairro: achado.bairro || valor.bairro,
                cidade: String(achado.municipio.codigo),
                municipioNome: achado.municipio.nome,
                estado: achado.municipio.uf,
                municipioRotulo: achado.municipio.rotulo,
            });
        } catch (e) {
            setErro((e as Error).message);
            // Não limpa o que já foi digitado: o operador completa à mão.
            onChange({ ...valor, cidade: '', estado: '', municipioRotulo: '' });
        } finally {
            setBuscando(false);
        }
    };

    const set = (campo: keyof DadosEndereco, v: string) => onChange({ ...valor, [campo]: v });

    return (
        <>
            <p className="text-[11px] font-semibold text-[#92400e] mt-4 mb-1.5">{titulo}</p>
            <div className="flex flex-wrap items-end gap-2">
                <input value={valor.cep} placeholder="CEP"
                    onChange={e => set('cep', formatarCep(e.target.value))}
                    onBlur={() => { if (soDigitos(valor.cep).length === 8 && !valor.cidade) procurar(); }}
                    className={`w-36 ${classeCampo(!!valor.cidade)}`} />
                <button type="button" onClick={procurar}
                    disabled={buscando || soDigitos(valor.cep).length !== 8}
                    className="px-3 py-2.5 rounded-lg text-xs font-semibold text-white bg-[#1d6fb8] hover:bg-[#175a94] disabled:bg-[#e5e7eb] disabled:text-[#9ca3af] transition-colors flex items-center gap-1.5">
                    {buscando ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Buscando…</> : <><Search className="w-3.5 h-3.5" strokeWidth={1.75} /> Buscar CEP</>}
                </button>
                {valor.municipioRotulo && (
                    <span className="text-[11px] font-medium text-emerald-700 pb-2.5">{valor.municipioRotulo}</span>
                )}
            </div>
            {erro && <p className="text-[11px] font-medium text-amber-700 mt-1.5">{erro}</p>}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                <input value={valor.logradouro} placeholder="Endereço"
                    onChange={e => set('logradouro', e.target.value)} className={classeNormal} />
                <input value={valor.numero} placeholder="Número"
                    onChange={e => set('numero', e.target.value)} className={classeNormal} />
                <input value={valor.bairro} placeholder="Bairro"
                    onChange={e => set('bairro', e.target.value)} className={classeNormal} />
                <input value={valor.complemento} placeholder="Complemento (opcional)"
                    onChange={e => set('complemento', e.target.value)} className={classeNormal} />
            </div>
            <p className="text-[10px] font-medium text-[#6b7280] mt-2">
                O município vem da busca de CEP — digitado à mão ele não tem código IBGE,
                e sem código o endereço não é enviado.
            </p>
        </>
    );
};

/**
 * Pessoa física nova. A pergunta "é motorista?" vem primeiro porque separa dois
 * cadastros diferentes: quem dirige precisa da CNH inteira e vai para a tela
 * completa; quem só é dono precisa de muito menos, e nada de CNH.
 *
 * Nenhum campo de CNH é gravado em branco. Uma habilitação vazia afirmaria no
 * Datamex que a pessoa tem CNH sem número, indistinguível de erro de digitação.
 */
export const FormPessoaFisicaNova: React.FC<{
    valor: PessoaFisicaNova;
    onChange: (p: PessoaFisicaNova) => void;
    /** Texto do caminho alternativo quando a pessoa dirige. Varia por tela. */
    avisoMotorista: React.ReactNode;
}> = ({ valor, onChange, avisoMotorista }) => {
    const set = <K extends keyof PessoaFisicaNova>(campo: K, v: PessoaFisicaNova[K]) =>
        onChange({ ...valor, [campo]: v });

    return (
        <>
            <p className="text-[11px] font-semibold text-[#92400e] mb-1.5">Essa pessoa é motorista?</p>
            <div className="flex gap-2 mb-3">
                {([[false, 'Não — só é dona do veículo'], [true, 'Sim, ela dirige']] as Array<[boolean, string]>).map(([v, rotulo]) => (
                    <button key={String(v)} type="button" onClick={() => set('ehMotorista', v)}
                        className={`px-3 py-2 rounded-lg text-xs font-semibold border-2 transition-colors ${valor.ehMotorista === v
                            ? 'bg-[#eff6ff] border-[#1d6fb8] text-[#1d6fb8]'
                            : 'bg-white border-[#e5e7eb] text-[#6b7280] hover:border-[#1d6fb8]'}`}>
                        {rotulo}
                    </button>
                ))}
            </div>

            {valor.ehMotorista ? (
                <div className="bg-white border border-[#e5e7eb] rounded-lg px-3 py-2.5">
                    <p className="text-[11px] font-medium text-[#6b7280]">{avisoMotorista}</p>
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <input value={valor.nome} placeholder="Nome"
                            onChange={e => set('nome', e.target.value)} className={classeCampo(!!valor.nome)} />
                        <input value={valor.sobrenome} placeholder="Sobrenome"
                            onChange={e => set('sobrenome', e.target.value)} className={classeNormal} />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                        <div>
                            <label className="text-[10px] font-medium uppercase text-[#92400e] mb-1.5 block">
                                Celular<span className="text-red-500 ml-0.5">*</span>
                            </label>
                            <input value={valor.celular} placeholder="(11) 90000-0000"
                                onChange={e => set('celular', formatarCelular(e.target.value))}
                                className={classeCampo(celularValido(valor.celular))} />
                            <p className="text-[10px] font-medium text-[#92400e] mt-1">
                                DDD + 9 dígitos. O CT-e exige contato do proprietário.
                            </p>
                        </div>
                        <div>
                            <label className="text-[10px] font-medium uppercase text-[#92400e] mb-1.5 block">
                                Nascimento<span className="text-red-500 ml-0.5">*</span>
                            </label>
                            <input type="date" value={valor.dataNascimento}
                                onChange={e => set('dataNascimento', e.target.value)}
                                className={classeCampo(!!valor.dataNascimento)} />
                            <p className="text-[10px] font-medium text-[#92400e] mt-1">
                                Sem isto o Datamex grava 00/00/0000, que é data inválida.
                            </p>
                        </div>
                    </div>

                    <div className="mt-3">
                        <input value={valor.rntrc} placeholder="RNTRC"
                            onChange={e => set('rntrc', e.target.value)}
                            className={`md:w-64 ${classeCampo(!!valor.rntrc)}`} />
                        <p className="text-[10px] font-medium text-[#92400e] mt-1">
                            Obrigatório aqui. A API aceitaria sem, mas proprietário sem RNTRC
                            volta como pendência na emissão do CT-e.
                        </p>
                    </div>

                    <BlocoEndereco titulo="Endereço" valor={valor.endereco}
                        onChange={e => set('endereco', e)} />
                </>
            )}
        </>
    );
};

/** Empresa nova. Até 30/08/2026 nascia com cinco campos e sem endereço nenhum. */
export const FormPessoaJuridicaNova: React.FC<{
    valor: PessoaJuridicaNova;
    onChange: (p: PessoaJuridicaNova) => void;
}> = ({ valor, onChange }) => {
    const set = <K extends keyof PessoaJuridicaNova>(campo: K, v: PessoaJuridicaNova[K]) =>
        onChange({ ...valor, [campo]: v });

    return (
        <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input value={valor.razaoSocial} placeholder="Razão social"
                    onChange={e => set('razaoSocial', e.target.value)} className={classeCampo(!!valor.razaoSocial)} />
                <input value={valor.nomeFantasia} placeholder="Nome fantasia"
                    onChange={e => set('nomeFantasia', e.target.value)} className={classeCampo(!!valor.nomeFantasia)} />
                <div>
                    <input value={valor.rntrc} placeholder="RNTRC"
                        onChange={e => set('rntrc', e.target.value)} className={classeCampo(!!valor.rntrc)} />
                    <p className="text-[10px] font-medium text-[#92400e] mt-1">
                        Não vem no CRLV. Sem ele o cadastro não grava.
                    </p>
                </div>
                <select value={valor.enquadramento}
                    onChange={e => set('enquadramento', e.target.value)} className={classeNormal}>
                    {ENQUADRAMENTOS.map(o => <option key={o.valor} value={o.valor}>{o.label}</option>)}
                </select>
            </div>

            <div className="mt-3">
                <label className="text-[10px] font-medium uppercase text-[#92400e] mb-1.5 block">
                    Celular<span className="text-red-500 ml-0.5">*</span>
                </label>
                <input value={valor.celular} placeholder="(11) 90000-0000"
                    onChange={e => set('celular', formatarCelular(e.target.value))}
                    className={`md:w-56 ${classeCampo(celularValido(valor.celular))}`} />
            </div>

            <BlocoEndereco titulo="Endereço da empresa" valor={valor.endereco}
                onChange={e => set('endereco', e)} />
        </>
    );
};
