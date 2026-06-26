import React, { useEffect, useState, useCallback } from 'react';

// PainelTV — tela pública (sem login) pra exibir o faturamento do mês numa TV.
// Lê de um endpoint PÚBLICO (get-faturamento-publico) que exige um token secreto
// passado na URL: /painel-tv?k=<token>. O token NÃO fica no bundle — vem da URL.
// Atualiza por polling (o cron atualiza o cache a cada 2 min no servidor).

interface Dados {
    total: number | null;
    ctes: number | null;
    status: string;
    atualizadoEm: string;
}

const POLL_MS = 60_000; // relê o cache a cada 1 min (cron grava a cada 2 min)
const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-faturamento-publico`;

const formatCur = (v: number) =>
    v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const PainelTV: React.FC = () => {
    const token = new URLSearchParams(window.location.search).get('k') || '';
    const [dados, setDados] = useState<Dados | null>(null);
    const [erro, setErro] = useState<string | null>(null);
    const [tick, setTick] = useState(0); // força recalcular o "há X min"

    const buscar = useCallback(async () => {
        if (!token) { setErro('Link sem token. Use o endereço completo do painel.'); return; }
        try {
            const res = await fetch(`${FN_URL}?k=${encodeURIComponent(token)}`);
            if (res.status === 403) { setErro('Acesso negado (token inválido).'); return; }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const j = await res.json();
            setDados(j);
            setErro(null);
        } catch {
            // Falha de rede: mantém o último valor na tela (fail-soft), sem apagar.
            setErro(prev => prev ?? null);
        }
    }, [token]);

    useEffect(() => {
        buscar();
        const id = setInterval(buscar, POLL_MS);
        return () => clearInterval(id);
    }, [buscar]);

    // Relógio leve só pra atualizar o "há X min" sem refazer fetch.
    useEffect(() => {
        const id = setInterval(() => setTick(t => t + 1), 30_000);
        return () => clearInterval(id);
    }, []);

    const relativo = (() => {
        if (!dados?.atualizadoEm) return '';
        void tick;
        const min = Math.floor((Date.now() - new Date(dados.atualizadoEm).getTime()) / 60000);
        return min <= 0 ? 'atualizado agora há pouco' : min === 1 ? 'atualizado há 1 min' : `atualizado há ${min} min`;
    })();

    const hoje = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' });

    return (
        <div className="min-h-screen w-full bg-gradient-to-br from-[#0b3a5e] via-[#0d4f7a] to-[#10643f] text-white flex flex-col items-center justify-center p-10 select-none">
            <div className="flex items-center gap-3 mb-10 opacity-80">
                <span className="text-2xl font-semibold tracking-tight">Omni<span className="text-emerald-300">Flow</span></span>
                <span className="text-lg font-medium text-white/60">· Faturamento {hoje}</span>
            </div>

            {erro ? (
                <div className="text-center">
                    <p className="text-3xl font-medium text-amber-200">{erro}</p>
                </div>
            ) : !dados ? (
                <p className="text-3xl font-medium text-white/60 animate-pulse">Carregando…</p>
            ) : (
                <>
                    <p className="text-xl md:text-2xl font-medium uppercase tracking-[0.2em] text-white/60 mb-4">Faturamento do mês</p>
                    <p className="font-semibold leading-none tracking-tight" style={{ fontSize: 'clamp(3rem, 12vw, 11rem)' }}>
                        <span className="text-white/60 align-top" style={{ fontSize: '0.4em' }}>R$ </span>
                        {dados.total != null ? formatCur(dados.total) : '—'}
                    </p>
                    <p className="mt-8 text-3xl md:text-5xl font-medium text-emerald-200">
                        {dados.ctes != null ? `${dados.ctes.toLocaleString('pt-BR')} CTes emitidos` : ''}
                    </p>
                    <div className="mt-12 flex items-center gap-3 text-white/50 text-lg">
                        <span className={`w-3 h-3 rounded-full ${dados.status === 'erro' ? 'bg-amber-400' : 'bg-emerald-400 animate-pulse'}`} />
                        <span>{dados.status === 'erro' ? 'última leitura falhou — exibindo o último valor' : relativo}</span>
                    </div>
                </>
            )}
        </div>
    );
};

export default PainelTV;
