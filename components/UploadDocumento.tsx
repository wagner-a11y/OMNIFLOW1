import React from 'react';
import { CheckCircle2, FileUp, Loader2 } from 'lucide-react';

// ============================================================================
// UploadDocumento — botão de anexo de documento (imagem ou PDF).
//
// Extraído do UploadSmall que vivia dentro de components/HiringInfoModal.tsx.
// Aquele modal é código morto (não é importado em lugar nenhum e nem entra no
// bundle), então o componente foi movido para cá em vez de duplicado.
// ============================================================================

export interface UploadDocumentoProps {
    label: string;
    /** Preenchido = já anexado; muda o rótulo e o ícone. */
    anexado?: boolean;
    carregando?: boolean;
    onSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
    /** `sm` mantém o tamanho original; `md` é o da tela de cadastro. */
    tamanho?: 'sm' | 'md';
}

export const UploadDocumento: React.FC<UploadDocumentoProps> = ({
    label, anexado, carregando, onSelect, tamanho = 'md',
}) => {
    const md = tamanho === 'md';
    return (
        <label
            className={`cursor-pointer flex items-center justify-center gap-2 rounded-lg border transition-colors ${md ? 'px-5 py-3 text-xs font-medium' : 'p-1 text-[10px] font-bold'
                } ${carregando
                    ? 'bg-[#f3f4f6] border-[#e5e7eb] text-[#9ca3af] cursor-wait'
                    : anexado
                        ? 'bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100'
                        : 'bg-white border-[#e5e7eb] text-[#111827] hover:bg-[#f9fafb]'}`}
        >
            <input
                type="file"
                className="hidden"
                accept="image/*,application/pdf"
                onChange={onSelect}
                disabled={carregando}
            />
            {carregando
                ? <Loader2 className={md ? 'w-4 h-4 animate-spin' : 'w-3 h-3 animate-spin'} />
                : anexado
                    ? <CheckCircle2 className={md ? 'w-4 h-4' : 'w-3 h-3'} strokeWidth={1.75} />
                    : <FileUp className={md ? 'w-4 h-4' : 'w-3 h-3'} strokeWidth={1.75} />}
            {carregando ? 'Lendo…' : anexado ? `${label} anexada` : `Anexar ${label}`}
        </label>
    );
};

export default UploadDocumento;
