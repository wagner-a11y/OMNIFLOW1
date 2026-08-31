import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

// ============================================================================
// GuardaDeTela — impede que um erro de JavaScript vire tela branca.
//
// Sem isto, qualquer exceção durante o render desmonta a árvore inteira do
// React e o operador fica olhando para uma página em branco, com todo o
// preenchimento perdido. Foi o que aconteceu em 31/08/2026: buscar um CNPJ que
// não existia lia `pjNova.endereco.cep` num objeto sem `endereco`, e o CRLV
// inteiro que já tinha sido conferido ia junto.
//
// O que este componente faz é conter o estrago: mostra o que aconteceu, oferece
// tentar de novo SEM recarregar a página, e deixa claro que os dados ainda
// estão ali. O que ele NÃO faz é consertar o erro — cada crash continua sendo
// um bug para corrigir, e a mensagem traz o texto do erro justamente para que
// ele seja reportado em vez de silenciado.
//
// LIMITE HONESTO: `resetKey` remonta o filho, e remontar zera o estado interno
// dele. Isso recupera a TELA, não necessariamente cada campo digitado. Guardar
// o preenchimento a salvo de um crash exigiria estado fora do componente, que é
// outra mudança. Por isso o texto não promete o que não pode cumprir.
//
// Error boundary precisa ser classe: não existe equivalente em hook.
// ============================================================================

interface Props {
    children: React.ReactNode;
    /** Nome da tela, para a mensagem dizer onde foi. */
    onde?: string;
}

interface Estado {
    erro: Error | null;
    /** Muda a cada "tentar de novo" e força a remontagem do filho. */
    tentativa: number;
}

export class GuardaDeTela extends React.Component<Props, Estado> {
    state: Estado = { erro: null, tentativa: 0 };

    static getDerivedStateFromError(erro: Error): Partial<Estado> {
        return { erro };
    }

    componentDidCatch(erro: Error, info: React.ErrorInfo) {
        // Vai para o console para quem for investigar. Não sobe para serviço
        // nenhum: não há coletor de erro no projeto, e inventar um envio
        // silencioso de dados de tela seria pior que não ter.
        console.error(`--- ERRO NA TELA${this.props.onde ? ` (${this.props.onde})` : ''} ---`, erro, info.componentStack);
    }

    render() {
        if (!this.state.erro) {
            return <React.Fragment key={this.state.tentativa}>{this.props.children}</React.Fragment>;
        }

        return (
            <div className="bg-white border-2 border-red-300 rounded-xl p-6 space-y-4">
                <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" strokeWidth={1.75} />
                    <div className="min-w-0">
                        <p className="text-sm font-semibold text-red-900">
                            Algo quebrou nesta tela{this.props.onde ? ` (${this.props.onde})` : ''}.
                        </p>
                        <p className="text-xs font-medium text-red-800 mt-1">
                            Nada foi gravado por causa disso. Clique em tentar de novo — se voltar a
                            quebrar, avise com o texto abaixo, que diz onde foi o erro.
                        </p>
                        <pre className="mt-3 text-[11px] font-mono text-red-900 bg-red-50 border border-red-200 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">
                            {this.state.erro.message || String(this.state.erro)}
                        </pre>
                    </div>
                </div>
                <button type="button"
                    onClick={() => this.setState(s => ({ erro: null, tentativa: s.tentativa + 1 }))}
                    className="px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#1d6fb8] hover:bg-[#175a94] transition-colors flex items-center gap-2">
                    <RotateCcw className="w-4 h-4" strokeWidth={1.75} />
                    Tentar de novo
                </button>
            </div>
        );
    }
}

export default GuardaDeTela;
