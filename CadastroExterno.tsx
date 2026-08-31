import React, { useState } from 'react';
import { Truck, Link2, ShieldAlert, IdCard, RotateCcw, LogOut } from 'lucide-react';
import CadastroVeiculo from './components/CadastroVeiculo';
import CadastroConjunto from './components/CadastroConjunto';
import { esquecerTokenCadastro, temTokenCadastro } from './services/tokenCadastro';

// ============================================================================
// CadastroExterno — as telas de cadastro por LINK, sem login.
//
// Aberta em /cadastro-externo?k=<token>, fora do App: quem entra por aqui não
// atravessa o OmniFlow. Não há barra lateral, não há como chegar em cotação,
// faturamento, CRM, histórico ou configurações. Se o link vazar, o estrago
// possível é o cadastro — e nada além dele.
//
// Esse contorno é de ROTA, e rota do navegador não protege dado nenhum. Quem
// protege é a Edge Function: sem o token no header x-cadastro-token, ela recusa
// (ver supabase/functions/_shared/porta.ts). A tela aqui é a conveniência; a
// trava é do outro lado.
//
// AS TELAS SÃO AS MESMAS de dentro do sistema, importadas como estão. Isso é
// deliberado: uma cópia adaptada seria um segundo caminho de gravação, que
// envelheceria à parte e um dia gravaria diferente do original — incluindo a
// conferência dos campos críticos antes de gravar, que é a etapa que não pode
// ser pulada. Reusando o componente, não existe versão "sem conferência".
//
// ----------------------------------------------------------------------------
// SOLUÇÃO TEMPORÁRIA, DECIDIDA COM CONSCIÊNCIA DO QUE CUSTA.
//
// O link é um segredo compartilhado: todo mundo usa o mesmo. O cadastro chega
// no Datamex SEM saber quem da operação o fez — não há rastro por pessoa, e não
// há como revogar o acesso de um sem revogar o de todos.
//
// A evolução planejada é login individual com auditoria de quem cadastrou o
// quê. Quando ela chegar, some esta tela, some services/tokenCadastro.ts, some
// o caminho do link em _shared/porta.ts e some o secret CADASTRO_EXTERNO_TOKEN.
// ============================================================================

const CadastroExterno: React.FC = () => {
    const [aba, setAba] = useState<'veiculo' | 'conjunto'>('veiculo');
    /**
     * Muda a cada "fazer outro cadastro" e força o React a remontar a tela do
     * zero — formulário limpo, sem recarregar a página.
     *
     * É a correção do gargalo de verdade: não havia como recomeçar, então o
     * operador dava F5 ou reabria o link, e o token (já retirado da URL, e até
     * então só em memória) sumia junto. Guardar o token na sessão da aba
     * resolveu o sintoma; este botão remove o motivo de recarregar.
     */
    const [sessaoForm, setSessaoForm] = useState(0);
    /** Confirmação do encerrar: sair apaga o token e exige o link de novo. */
    const [confirmandoSaida, setConfirmandoSaida] = useState(false);

    // Sem token na URL não adianta desenhar a tela: toda gravação vai voltar 401.
    // Melhor dizer isso na entrada do que deixar a pessoa preencher um CRLV
    // inteiro para descobrir no fim.
    if (!temTokenCadastro()) {
        return (
            <div className="min-h-screen bg-[#f8f9fa] flex items-center justify-center p-6">
                <div className="bg-white border border-[#e5e7eb] rounded-xl p-8 max-w-md text-center space-y-3">
                    <ShieldAlert className="w-10 h-10 text-amber-500 mx-auto" strokeWidth={1.5} />
                    <h1 className="text-lg font-medium text-[#111827]">Link incompleto</h1>
                    <p className="text-sm text-[#6b7280]">
                        Este endereço precisa do código de acesso. Use o link completo que
                        foi enviado a você — ele termina com <code className="text-[#111827]">?k=…</code>.
                    </p>
                </div>
            </div>
        );
    }

    const Aba: React.FC<{ id: 'veiculo' | 'conjunto'; icone: any; texto: string }> = ({ id, icone: Icone, texto }) => (
        <button
            onClick={() => setAba(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${aba === id
                ? 'bg-[#1d6fb8] text-white'
                : 'bg-white border border-[#e5e7eb] text-[#6b7280] hover:bg-[#f9fafb]'}`}
        >
            <Icone className="w-4 h-4" strokeWidth={1.75} />
            {texto}
        </button>
    );

    return (
        <div className="min-h-screen bg-[#f8f9fa]">
            <header className="bg-white border-b border-[#e5e7eb] px-6 py-4 sticky top-0 z-40">
                <div className="max-w-5xl mx-auto flex flex-wrap items-center gap-4">
                    <h1 className="text-lg font-medium tracking-tight leading-none text-[#111827]">
                        Omni<span className="text-[#1d6fb8]">Flow</span>
                        <span className="ml-3 text-sm font-normal text-[#6b7280]">Cadastro</span>
                    </h1>
                    <div className="flex gap-2 ml-auto">
                        <Aba id="veiculo" icone={Truck} texto="Veículo" />
                        <Aba id="conjunto" icone={Link2} texto="Conjunto" />
                    </div>
                </div>
            </header>

            <div className="max-w-5xl mx-auto px-6 py-6">
                {/* O aviso é honesto e serve ao operador: sem rastro por pessoa, quem
                    confere o que foi gravado é quem gravou, na hora. */}
                <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-6">
                    <IdCard className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" strokeWidth={1.75} />
                    <p className="text-[12px] text-amber-900 leading-relaxed">
                        Acesso por link, sem login. O cadastro é gravado no Datamex <strong>sem
                        identificar quem o fez</strong> — confira os dados na tela de revisão antes
                        de gravar. Não repasse este link.
                    </p>
                </div>

                {/* Mesmos componentes de dentro do sistema. `autor` vem vazio porque não
                    há usuário: é exatamente a informação que este modelo não tem. */}
                {/* A `key` inclui a aba E a sessão: trocar de aba ou pedir outro
                    cadastro monta um formulário novo, sem resíduo do anterior. */}
                {aba === 'veiculo'
                    ? <CadastroVeiculo key={`v-${sessaoForm}`} autor={{}} />
                    : <CadastroConjunto key={`c-${sessaoForm}`} autor={{}} />}

                <div className="mt-8 pt-5 border-t border-[#e5e7eb] flex flex-wrap items-center gap-3">
                    <button type="button"
                        onClick={() => { setSessaoForm(n => n + 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                        className="px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#1d6fb8] hover:bg-[#175a94] transition-colors flex items-center gap-2">
                        <RotateCcw className="w-4 h-4" strokeWidth={1.75} />
                        Fazer outro cadastro
                    </button>
                    <span className="text-[11px] font-medium text-[#6b7280]">
                        Limpa o formulário e mantém a sessão — não precisa abrir o link de novo.
                    </span>

                    <button type="button" onClick={() => setConfirmandoSaida(true)}
                        className="ml-auto text-xs font-semibold text-[#6b7280] hover:text-red-600 transition-colors flex items-center gap-1.5">
                        <LogOut className="w-3.5 h-3.5" strokeWidth={1.75} />
                        Encerrar
                    </button>
                </div>
            </div>

            {/* Encerrar de propósito, para quem usou um computador compartilhado
                e não quer deixar a sessão aberta esperando o próximo. */}
            {confirmandoSaida && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
                    onClick={() => setConfirmandoSaida(false)}>
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4" onClick={e => e.stopPropagation()}>
                        <h3 className="text-lg font-semibold text-[#111827]">Encerrar o acesso?</h3>
                        <p className="text-sm text-[#6b7280]">
                            O código de acesso é esquecido nesta aba. Para cadastrar de novo será
                            preciso abrir o link outra vez.
                        </p>
                        <div className="flex gap-2">
                            <button onClick={() => setConfirmandoSaida(false)}
                                className="flex-1 py-2.5 rounded-lg text-sm font-medium text-[#6b7280] bg-[#f9fafb] border border-[#e5e7eb] hover:bg-[#f3f4f6] transition-colors">
                                Continuar cadastrando
                            </button>
                            <button onClick={() => { esquecerTokenCadastro(); window.location.reload(); }}
                                className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white bg-red-600 hover:bg-red-700 transition-colors">
                                Encerrar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CadastroExterno;
