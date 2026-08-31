import React, { useState } from 'react';
import { AlertTriangle, CheckCircle, Loader2, Search, UserCheck } from 'lucide-react';
import {
    FormPessoaFisicaNova, FormPessoaJuridicaNova,
    PessoaFisicaNova, PessoaJuridicaNova, PF_NOVA_VAZIA, PJ_NOVA_VAZIA,
    pfNovaOk, pjNovaOk,
} from './FormPessoaNova';
import {
    TipoPessoa, buscarPessoaJuridica, buscarProprietario,
    cadastrarPessoaJuridica, formatarDocumento, tipoDoDocumento,
} from '../services/cadastroVeiculo';
import { cadastrarProprietarioPF } from '../services/cadastroMotorista';

// ============================================================================
// Cadastro de PROPRIETÁRIO, sozinho — sem veículo e sem conjunto.
//
// Existe porque nem todo cadastro de dono acontece junto com um veículo: às
// vezes o proprietário chega antes, ou é corrigido depois.
//
// REUSA os mesmos formulários do conjunto (FormPessoaNova) e os mesmos serviços
// de gravação. Não há segunda versão para envelhecer à parte — foi a duplicação
// que produziu os bugs desta semana. Quem mexer nas regras de contato, endereço
// ou RNTRC mexe aqui e no conjunto ao mesmo tempo.
//
// O que esta tela NÃO faz: motorista. Quem dirige precisa da CNH inteira e vai
// para Cadastro Pessoa, que já existe e já cobre inclusive o motorista que
// TAMBÉM é dono do veículo (tem o marcador de proprietário e o RNTRC).
// ============================================================================

const soDigitos = (s: string) => (s || '').replace(/\D/g, '');

interface Props {
    /** Rótulo do caminho alternativo, que muda entre o sistema e o link. */
    ondeCadastrarMotorista?: string;
}

const CadastroProprietario: React.FC<Props> = ({
    ondeCadastrarMotorista = 'Cadastro Pessoa',
}) => {
    const [doc, setDoc] = useState('');
    const [buscando, setBuscando] = useState(false);
    const [erro, setErro] = useState<string | null>(null);
    /** Achado no Datamex: não há o que cadastrar, só confirmar. */
    const [existente, setExistente] = useState<{ codPessoa: string; nome: string; tipo: TipoPessoa } | null>(null);
    const [pf, setPf] = useState<PessoaFisicaNova | null>(null);
    const [pj, setPj] = useState<PessoaJuridicaNova | null>(null);
    const [gravando, setGravando] = useState(false);
    const [gravado, setGravado] = useState<{ codPessoa: string; nome: string; aviso?: string } | null>(null);

    const tipo: TipoPessoa = tipoDoDocumento(doc);

    const limpar = () => {
        setExistente(null); setPf(null); setPj(null); setErro(null); setGravado(null);
    };

    const procurar = async () => {
        const d = soDigitos(doc);
        if (tipo === 'indefinido') {
            setErro('Informe um CPF (11 dígitos) ou um CNPJ (14 dígitos).');
            return;
        }
        setBuscando(true); limpar();
        try {
            if (tipo === 'fisica') {
                const r = await buscarProprietario(d);
                if (r.error) { setErro(r.error); return; }
                if (r.codPessoa) {
                    setExistente({ codPessoa: r.codPessoa, nome: r.nome || '', tipo: 'fisica' });
                    return;
                }
                setPf(PF_NOVA_VAZIA);
                return;
            }
            const r = await buscarPessoaJuridica(d);
            if (r.error) { setErro(r.error); return; }
            if (r.existe && r.codPessoa) {
                setExistente({ codPessoa: r.codPessoa, nome: r.razaoSocial || r.nomeFantasia || '', tipo: 'juridica' });
                return;
            }
            setPj(PJ_NOVA_VAZIA);
        } catch (e) {
            setErro((e as Error).message);
        } finally {
            setBuscando(false);
        }
    };

    /** Grava de verdade. Diferente do conjunto, aqui não há cascata para esperar. */
    const gravar = async () => {
        setGravando(true); setErro(null);
        try {
            if (pf) {
                const r = await cadastrarProprietarioPF({
                    cpf: soDigitos(doc), nome: pf.nome, sobrenome: pf.sobrenome,
                    rntrc: pf.rntrc, celular: pf.celular,
                    dataNascimento: pf.dataNascimento, endereco: pf.endereco,
                });
                if (r.error) { setErro(r.error); return; }
                setGravado({
                    codPessoa: r.codPessoa ?? '', nome: `${pf.nome} ${pf.sobrenome}`.trim(),
                    aviso: r.aviso,
                });
                setPf(null);
                return;
            }
            if (pj) {
                const r = await cadastrarPessoaJuridica({
                    cnpj: soDigitos(doc), razaoSocial: pj.razaoSocial, nomeFantasia: pj.nomeFantasia,
                    rntrc: pj.rntrc, enquadramento: pj.enquadramento, celular: pj.celular,
                    endereco: {
                        cep: pj.endereco.cep, logradouro: pj.endereco.logradouro,
                        numero: pj.endereco.numero, complemento: pj.endereco.complemento,
                        bairro: pj.endereco.bairro,
                        // `cidade` é o NOME e o código vai em codIBGE — inverso do veículo.
                        cidade: pj.endereco.municipioNome, codIBGE: pj.endereco.cidade,
                        estado: pj.endereco.estado,
                    },
                });
                if (r.error) { setErro(r.error); return; }
                setGravado({ codPessoa: r.codPessoa ?? '', nome: pj.razaoSocial, aviso: r.aviso });
                setPj(null);
            }
        } catch (e) {
            setErro((e as Error).message);
        } finally {
            setGravando(false);
        }
    };

    const podeGravar = (pf && pfNovaOk(pf)) || (pj && pjNovaOk(pj));

    return (
        <div className="space-y-5 animate-fade-in-up">
            <div className="bg-white border border-[#e5e7eb] rounded-xl p-6 space-y-4">
                <div className="flex items-center gap-2">
                    <UserCheck className="w-4 h-4 text-[#6b7280]" strokeWidth={1.75} />
                    <h3 className="text-sm font-semibold text-[#111827]">Proprietário do veículo</h3>
                </div>
                <p className="text-xs font-medium text-[#6b7280]">
                    Pessoa ou empresa dona do veículo. Se ela também dirige, cadastre em{' '}
                    <strong className="text-[#111827]">{ondeCadastrarMotorista}</strong> — lá o
                    motorista pode ser marcado como proprietário.
                </p>

                <div className="flex flex-wrap items-end gap-3">
                    <div className="flex flex-col">
                        <label className="text-[10px] font-medium uppercase text-[#6b7280] mb-1.5">
                            CPF ou CNPJ<span className="text-red-500 ml-0.5">*</span>
                            {tipo !== 'indefinido' && (
                                <span className="ml-1 normal-case text-[#1d6fb8] font-semibold">
                                    · {tipo === 'fisica' ? 'pessoa física' : 'empresa'}
                                </span>
                            )}
                        </label>
                        <input value={doc}
                            onChange={e => { setDoc(formatarDocumento(e.target.value)); limpar(); }}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); procurar(); } }}
                            placeholder="000.000.000-00"
                            className="w-56 px-3 py-2.5 rounded-lg text-sm font-semibold outline-none border bg-[#f9fafb] border-[#e5e7eb] focus:border-[#1d6fb8] transition-colors" />
                    </div>
                    <button type="button" onClick={procurar} disabled={buscando || tipo === 'indefinido'}
                        className="px-4 py-2.5 rounded-lg text-xs font-semibold text-white bg-[#1d6fb8] hover:bg-[#175a94] disabled:bg-[#e5e7eb] disabled:text-[#9ca3af] transition-colors flex items-center gap-2">
                        {buscando ? <><Loader2 className="w-4 h-4 animate-spin" /> Buscando…</> : <><Search className="w-4 h-4" strokeWidth={1.75} /> Buscar</>}
                    </button>
                </div>

                {/* Já existe: não se altera cadastro alheio. O PUT do Bsoft apaga
                    grupos em silêncio, então quem já está lá fica como está. */}
                {existente && (
                    <div className="bg-emerald-50 border border-emerald-300 text-emerald-900 px-4 py-3 rounded-lg flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" strokeWidth={1.75} />
                        <div>
                            <p className="text-xs font-semibold">{existente.nome} — código {existente.codPessoa}</p>
                            <p className="text-xs font-medium opacity-90 mt-0.5">
                                Já cadastrado no Datamex. Não alterei nada: confira lá se o grupo de
                                proprietários, o RNTRC, o telefone e o endereço estão preenchidos.
                            </p>
                        </div>
                    </div>
                )}

                {erro && (
                    <div className="bg-amber-50 border border-amber-300 text-amber-900 px-4 py-2.5 rounded-lg flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" strokeWidth={1.75} />
                        <p className="text-xs font-medium">{erro}</p>
                    </div>
                )}

                {gravado && (
                    <div className="bg-emerald-50 border border-emerald-300 text-emerald-900 px-4 py-3 rounded-lg flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" strokeWidth={1.75} />
                        <div>
                            <p className="text-xs font-semibold">
                                {gravado.nome} cadastrado — código {gravado.codPessoa}
                            </p>
                            {gravado.aviso && (
                                <p className="text-xs font-medium text-amber-800 mt-1">{gravado.aviso}</p>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {(pf || pj) && (
                <div className="bg-white border-2 border-amber-300 rounded-xl p-6 space-y-1">
                    <p className="text-xs font-semibold text-[#92400e] mb-3">
                        {pf ? 'Não existe pessoa física com esse CPF no Datamex.' : 'Empresa não encontrada no Datamex.'}
                    </p>

                    {pf && (
                        <FormPessoaFisicaNova valor={pf} onChange={setPf}
                            avisoMotorista={<>
                                Quem dirige precisa da CNH inteira — registro, categoria, validade e
                                toxicológico. Cadastre em <strong className="text-[#111827]">{ondeCadastrarMotorista}</strong>,
                                marcando que a pessoa também é dona do veículo.
                            </>} />
                    )}
                    {pj && <FormPessoaJuridicaNova valor={pj} onChange={setPj} />}

                    <div className="pt-5">
                        <button type="button" onClick={gravar} disabled={!podeGravar || gravando}
                            className="px-5 py-3 rounded-lg text-sm font-semibold text-white bg-[#1d6fb8] hover:bg-[#175a94] disabled:bg-[#e5e7eb] disabled:text-[#9ca3af] disabled:cursor-not-allowed transition-colors flex items-center gap-2">
                            {gravando ? <><Loader2 className="w-4 h-4 animate-spin" /> Gravando…</> : 'Cadastrar proprietário'}
                        </button>
                        {!podeGravar && !gravando && (
                            <p className="text-[11px] font-medium text-[#92400e] mt-2">
                                Faltam campos obrigatórios. Telefone, endereço e RNTRC são exigidos
                                pelo CT-e — sem eles a emissão para depois.
                            </p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default CadastroProprietario;
