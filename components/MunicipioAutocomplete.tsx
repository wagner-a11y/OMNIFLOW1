import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, MapPin } from 'lucide-react';
import { buscarMunicipios, carregarMunicipios, Municipio } from '../utils/municipios';

// ============================================================================
// Autocomplete de município (IBGE) — entrada TRAVADA.
//
// O campo só aceita um item escolhido da lista. Texto digitado que não vira
// seleção é descartado ao sair do campo. É isso que elimina por construção o
// caso "otiriba", em que o Qualp fazia correspondência aproximada e devolvia
// rota de outro lugar sem acusar erro.
//
// Só a ROTA SIMPLES usa este componente. Multi-parada segue com texto livre.
// ============================================================================

/** Carrega a base uma vez por sessão e devolve a lista (vazia enquanto carrega). */
export function useMunicipios(): { lista: Municipio[]; carregando: boolean; erro: boolean } {
    const [lista, setLista] = useState<Municipio[]>([]);
    const [carregando, setCarregando] = useState(true);
    const [erro, setErro] = useState(false);

    useEffect(() => {
        let vivo = true;
        carregarMunicipios()
            .then(l => { if (vivo) { setLista(l); setCarregando(false); } })
            .catch(() => { if (vivo) { setErro(true); setCarregando(false); } });
        return () => { vivo = false; };
    }, []);

    return { lista, carregando, erro };
}

interface Props {
    /** Texto canônico atual ("Cidade, UF") ou o valor legado de uma cotação salva. */
    valor: string;
    lista: Municipio[];
    /** Município já resolvido a partir de `valor`; null = valor não é município da lista. */
    resolvido: Municipio | null;
    /**
     * Recebe o município escolhido. O pai é quem decide o que fazer (guardar e,
     * se for o caso, consultar a rota) — e recebe o objeto, não depende de ler
     * o estado recém-atualizado.
     */
    onSelecionar: (m: Municipio) => void;
    placeholder?: string;
    disabled?: boolean;
}

const MunicipioAutocomplete: React.FC<Props> = ({
    valor, lista, resolvido, onSelecionar, placeholder, disabled,
}) => {
    const [texto, setTexto] = useState(valor);
    const [aberto, setAberto] = useState(false);
    const [destaque, setDestaque] = useState(0);
    const caixa = useRef<HTMLDivElement>(null);

    // Valor mudou por fora (carregar cotação, reset, promoção do legado): reflete no campo.
    useEffect(() => { setTexto(valor); }, [valor]);

    const sugestoes = useMemo(
        () => (aberto ? buscarMunicipios(lista, texto, 50) : []),
        [aberto, lista, texto],
    );

    const escolher = (m: Municipio) => {
        setTexto(m.rotulo);
        setAberto(false);
        onSelecionar(m);
    };

    // Sair do campo sem escolher NÃO deixa resíduo: volta pro último valor válido.
    const aoSair = () => {
        setAberto(false);
        setTexto(valor);
    };

    const aoTeclar = (e: React.KeyboardEvent) => {
        if (!aberto && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { setAberto(true); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); setDestaque(d => Math.min(d + 1, sugestoes.length - 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setDestaque(d => Math.max(d - 1, 0)); }
        else if (e.key === 'Enter') { e.preventDefault(); if (sugestoes[destaque]) escolher(sugestoes[destaque]); }
        else if (e.key === 'Escape') { aoSair(); }
    };

    // Valor preenchido que não é município da lista: cotação antiga com bairro ou
    // texto solto. Fica visível e bloqueia a consulta até o operador escolher.
    const invalido = !!valor.trim() && !resolvido;

    return (
        <div className="relative" ref={caixa}>
            <MapPin className={`absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none ${invalido ? 'text-amber-500' : 'text-slate-300'}`} strokeWidth={1.75} />
            <input
                type="text"
                disabled={disabled}
                className={`w-full pl-10 pr-4 py-4 rounded-lg font-medium border outline-none transition-all ${invalido
                    ? 'bg-amber-50 border-amber-300 focus:border-amber-500'
                    : 'bg-[#f9fafb] border-[#e5e7eb] focus:border-[#1d6fb8]'}`}
                value={texto}
                placeholder={placeholder}
                autoComplete="off"
                onChange={e => { setTexto(e.target.value); setAberto(true); setDestaque(0); }}
                onFocus={() => { if (texto) setAberto(true); }}
                onBlur={aoSair}
                onKeyDown={aoTeclar}
            />

            {invalido && !aberto && (
                <p className="text-[10px] font-medium text-amber-700 mt-1 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 shrink-0" strokeWidth={1.75} />
                    Escolha um município da lista
                </p>
            )}

            {aberto && (
                // onMouseDown com preventDefault: o clique escolhe o item ANTES do blur
                // do input, senão o campo reverte e a escolha se perde.
                <div
                    onMouseDown={e => e.preventDefault()}
                    className="absolute z-50 left-0 right-0 mt-1 max-h-72 overflow-y-auto bg-white border border-[#e5e7eb] rounded-lg shadow-lg"
                >
                    {sugestoes.length === 0 ? (
                        <p className="px-4 py-3 text-xs font-normal text-[#6b7280]">
                            {texto.trim() ? 'Nenhum município encontrado.' : 'Digite o nome do município.'}
                        </p>
                    ) : sugestoes.map((m, i) => (
                        <button
                            key={m.codigo}
                            onClick={() => escolher(m)}
                            onMouseEnter={() => setDestaque(i)}
                            className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${i === destaque ? 'bg-[#f3f4f6]' : 'bg-white'}`}
                        >
                            <span className="font-medium text-[#111827]">{m.nome}</span>
                            {/* A UF é o que separa homônimos: Viana ES e Viana MA saem
                                como duas linhas distintas e escolhíveis. */}
                            <span className="text-[#6b7280]">, {m.uf}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

export default MunicipioAutocomplete;
