import React, { useState, useRef, useEffect } from 'react';
import { Link2, Loader2 } from 'lucide-react';
import { searchPipefyRecords } from '../services/pipefy';

// Campo com autocomplete dos cadastros do Pipefy (Clientes/Solicitantes). Busca server-side,
// debounce, assíncrona e FAIL-SOFT: se o Pipefy estiver lento/fora, retorna lista vazia e o
// operador digita livre normalmente — nunca trava a tela. Escolher um item guarda nome + id;
// digitar livre (sem escolher) limpa o id. Só leitura; nunca cria/altera nada no Pipefy.
export const PipefyAutocomplete: React.FC<{
    tipo: 'cliente' | 'solicitante';
    value: string;
    selectedId?: string;
    onChangeText: (name: string) => void;
    onPick: (rec: { id: string; title: string }) => void;
    placeholder?: string;
    required?: boolean;
    className?: string;
}> = ({ tipo, value, selectedId, onChangeText, onPick, placeholder, required, className }) => {
    const [results, setResults] = useState<{ id: string; title: string }[]>([]);
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const debRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const boxRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const onDoc = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
        document.addEventListener('mousedown', onDoc);
        return () => { document.removeEventListener('mousedown', onDoc); if (debRef.current) clearTimeout(debRef.current); };
    }, []);

    const handleType = (v: string) => {
        onChangeText(v); // atualiza o nome e limpa o id no pai (digitou livre)
        if (debRef.current) clearTimeout(debRef.current);
        if (v.trim().length < 2) { setResults([]); setOpen(false); setLoading(false); return; }
        setLoading(true); setOpen(true);
        debRef.current = setTimeout(async () => {
            const r = await searchPipefyRecords(tipo, v.trim()); // fail-soft: [] em caso de erro
            setResults(r); setLoading(false); setOpen(true);
        }, 350);
    };

    return (
        <div className="relative" ref={boxRef}>
            <input type="text" value={value} required={required} placeholder={placeholder} autoComplete="off"
                onChange={e => handleType(e.target.value)}
                onFocus={() => { if (results.length) setOpen(true); }}
                className={className || 'w-full px-3 py-2 pr-16 border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none'} />
            {selectedId
                ? <span className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600" title={`Vinculado ao cadastro do Pipefy (id ${selectedId})`}><Link2 className="w-3 h-3" /> vinculado</span>
                : (loading && <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 animate-spin" />)}
            {open && (loading || results.length > 0) && (
                <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                    {loading && <div className="px-3 py-2 text-xs text-gray-400">Buscando no Pipefy…</div>}
                    {!loading && results.map(r => (
                        <button key={r.id} type="button" onClick={() => { onPick(r); setOpen(false); }}
                            className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-emerald-50 flex items-center gap-2">
                            <Link2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" /> {r.title}
                        </button>
                    ))}
                    {!loading && results.length === 0 && value.trim().length >= 2 && (
                        <div className="px-3 py-2 text-xs text-gray-400">Nenhum no cadastro do Pipefy — segue como texto livre (sem vínculo).</div>
                    )}
                </div>
            )}
        </div>
    );
};
