import React, { useEffect, useState, useCallback, useRef } from 'react';

// PainelTV — tela pública (sem login) pra exibir o faturamento do mês numa TV.
// Lê de um endpoint PÚBLICO (get-faturamento-publico) que exige um token secreto
// passado na URL: /painel-tv?k=<token>. O token NÃO fica no bundle — vem da URL.
// Atualiza por polling (o cron atualiza o cache a cada 2 min no servidor).

interface Dados {
    total: number | null;
    ctes: number | null;
    totalHoje: number | null;
    status: string;
    atualizadoEm: string;
}

const POLL_MS = 30_000; // relê o cache a cada 30s (cron grava a cada 2 min)
const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-faturamento-publico`;

const formatCur = (v: number) =>
    v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const PainelTV: React.FC = () => {
    const token = new URLSearchParams(window.location.search).get('k') || '';
    const [dados, setDados] = useState<Dados | null>(null);
    const [erro, setErro] = useState<string | null>(null);
    const [tick, setTick] = useState(0); // força recalcular o "há X min"
    const [ultimaLeitura, setUltimaLeitura] = useState<Date | null>(null); // prova de vida: quando a TV releu

    // --- Som de "novo CTe" (Web Audio API, sem arquivo externo) ---
    const audioCtxRef = useRef<AudioContext | null>(null);
    const somLigadoRef = useRef(true);
    const prevCtesRef = useRef<number | null>(null); // ctes da leitura anterior (detecção)
    const [somAtivado, setSomAtivado] = useState(false); // usuário liberou o AudioContext?
    const [somLigado, setSomLigado] = useState(true);    // toggle on/off
    useEffect(() => { somLigadoRef.current = somLigado; }, [somLigado]);

    // "ding-ding-ding-DING" ascendente (C5→E5→G5→C6), sine + envelope de ganho
    // (ataque/decay suaves p/ não estalar). Não toca se o áudio não foi liberado
    // ou se o toggle está off.
    const tocarSom = useCallback(() => {
        const ctx = audioCtxRef.current;
        if (!ctx || !somLigadoRef.current) return;
        const now = ctx.currentTime;
        const notas = [
            { freq: 523.25, start: 0.00, dur: 0.08, vol: 0.25 }, // C5
            { freq: 659.25, start: 0.06, dur: 0.08, vol: 0.25 }, // E5
            { freq: 783.99, start: 0.12, dur: 0.12, vol: 0.28 }, // G5
            { freq: 1046.50, start: 0.18, dur: 0.20, vol: 0.32 }, // C6 (fade out suave)
        ];
        for (const n of notas) {
            const osc = ctx.createOscillator();
            const g = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = n.freq;
            const t0 = now + n.start;
            const t1 = t0 + n.dur;
            g.gain.setValueAtTime(0.0001, t0);
            g.gain.exponentialRampToValueAtTime(n.vol, t0 + 0.012); // ataque sem clique
            g.gain.exponentialRampToValueAtTime(0.0001, t1);        // release/fade
            osc.connect(g); g.connect(ctx.destination);
            osc.start(t0); osc.stop(t1 + 0.03);
        }
    }, []);

    // Libera o AudioContext (precisa de gesto do usuário) e dá um preview do som.
    const ativarSom = () => {
        try {
            if (!audioCtxRef.current) {
                const AC = window.AudioContext || (window as any).webkitAudioContext;
                audioCtxRef.current = new AC();
            }
            audioCtxRef.current.resume();
            setSomAtivado(true);
            setSomLigado(true);
            somLigadoRef.current = true;
            tocarSom(); // confirma que o som funciona
        } catch { /* navegador sem Web Audio: ignora */ }
    };

    // Detecção de CTe novo: ctes subiu vs a leitura anterior -> toca o som.
    // Ignora a 1ª leitura (prev null) e quedas (ex.: restauração de teste).
    useEffect(() => {
        if (!dados || dados.ctes == null) return;
        const prev = prevCtesRef.current;
        prevCtesRef.current = dados.ctes;
        if (prev != null && dados.ctes > prev) tocarSom();
    }, [dados, tocarSom]);

    const buscar = useCallback(async () => {
        if (!token) { setErro('Link sem token. Use o endereço completo do painel.'); return; }
        try {
            // cache-bust (_=timestamp) + no-store: garante que a TV nunca segure
            // valor velho do cache do navegador — sempre relê o estado mais recente.
            const res = await fetch(`${FN_URL}?k=${encodeURIComponent(token)}&_=${Date.now()}`, { cache: 'no-store' });
            if (res.status === 403) { setErro('Acesso negado (token inválido).'); return; }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const j = await res.json();
            setDados(j);
            setUltimaLeitura(new Date());
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
        <div className="relative min-h-screen w-full bg-gradient-to-br from-[#0b3a5e] via-[#0d4f7a] to-[#10643f] text-white flex flex-col items-center justify-center p-10 select-none">
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
                        R$ {dados.totalHoje != null ? formatCur(dados.totalHoje) : '0,00'} <span className="text-white/50">emitidos hoje</span>
                    </p>
                    <div className="mt-12 flex items-center gap-3 text-white/50 text-lg">
                        <span className={`w-3 h-3 rounded-full ${dados.status === 'erro' ? 'bg-amber-400' : 'bg-emerald-400 animate-pulse'}`} />
                        <span>{dados.status === 'erro' ? 'última leitura falhou — exibindo o último valor' : relativo}</span>
                        {ultimaLeitura && (
                            <span className="text-white/40 text-sm ml-2">· tela sincronizada {ultimaLeitura.toLocaleTimeString('pt-BR')}</span>
                        )}
                    </div>
                    {/* Canto inferior direito: total de CTes do mês (discreto) */}
                    {dados.ctes != null && (
                        <div className="absolute bottom-6 right-8 text-white/40 text-base md:text-lg font-medium">
                            {dados.ctes.toLocaleString('pt-BR')} CTes no mês
                        </div>
                    )}
                </>
            )}

            {/* Canto inferior esquerdo: controle de som (sempre visível) */}
            <div className="absolute bottom-6 left-8">
                {!somAtivado ? (
                    <button onClick={ativarSom} className="flex items-center gap-2 text-white/60 hover:text-white text-base md:text-lg font-medium border border-white/25 rounded-lg px-3 py-1.5 transition-colors">
                        🔔 Ativar som
                    </button>
                ) : (
                    <button onClick={() => setSomLigado(s => !s)} className="flex items-center gap-2 text-white/40 hover:text-white/80 text-base md:text-lg font-medium transition-colors">
                        <span className={`w-2.5 h-2.5 rounded-full ${somLigado ? 'bg-emerald-400' : 'bg-white/30'}`} />
                        Som: {somLigado ? 'on' : 'off'}
                    </button>
                )}
            </div>
        </div>
    );
};

export default PainelTV;
