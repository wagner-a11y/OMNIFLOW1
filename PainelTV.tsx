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

// "Tinido" de moeda: transiente de ruído filtrado (o "chink" do impacto) +
// parciais inarmônicos. Centrado em ~2–3 kHz (faixa que alto-falante de TV
// reproduz bem; em 3–5 kHz o som some na TV) e mais alto.
function playCoin(ctx: AudioContext, when: number, vol: number, center: number) {
    const dur = 0.13;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = center; bp.Q.value = 4;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, when);
    ng.gain.exponentialRampToValueAtTime(vol * 0.9, when + 0.002);
    ng.gain.exponentialRampToValueAtTime(0.0001, when + 0.1);
    noise.connect(bp); bp.connect(ng); ng.connect(ctx.destination);
    noise.start(when); noise.stop(when + dur);
    [1, 1.34, 1.78].forEach((mult, i) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine'; osc.frequency.value = center * mult;
        g.gain.setValueAtTime(0.0001, when);
        g.gain.exponentialRampToValueAtTime(vol * (0.7 - i * 0.18), when + 0.003);
        g.gain.exponentialRampToValueAtTime(0.0001, when + 0.12);
        osc.connect(g); g.connect(ctx.destination);
        osc.start(when); osc.stop(when + 0.15);
    });
}

const PainelTV: React.FC = () => {
    const token = new URLSearchParams(window.location.search).get('k') || '';
    const [dados, setDados] = useState<Dados | null>(null);
    const [erro, setErro] = useState<string | null>(null);
    const [tick, setTick] = useState(0); // força recalcular o "há X min"
    const [ultimaLeitura, setUltimaLeitura] = useState<Date | null>(null); // prova de vida: quando a TV releu

    // --- Som de "novo CTe" (Web Audio API, sem arquivo externo) ---
    const audioCtxRef = useRef<AudioContext | null>(null);
    const somLigadoRef = useRef(true);
    const prevCtesRef = useRef<number | null>(null);  // ctes da leitura anterior (detecção)
    const prevTotalRef = useRef<number | null>(null); // total anterior (p/ calcular o +R$)
    const [somAtivado, setSomAtivado] = useState(false); // usuário liberou o AudioContext?
    const [somLigado, setSomLigado] = useState(true);    // toggle on/off
    const [animar, setAnimar] = useState(false);         // animação de "dinheiro entrando"
    const [delta, setDelta] = useState<number | null>(null); // quanto subiu (R$)
    useEffect(() => { somLigadoRef.current = somLigado; }, [somLigado]);

    // "Dinheiro recebido": moedas tilintando — 3 tinidos rápidos em ~2–3 kHz
    // (audível na TV), mais alto, sem o sininho fraco de antes.
    const tocarSom = useCallback(() => {
        const ctx = audioCtxRef.current;
        if (!ctx || !somLigadoRef.current) return;
        const now = ctx.currentTime;
        playCoin(ctx, now + 0.00, 0.55, 2400); // tinido 1
        playCoin(ctx, now + 0.08, 0.50, 2750); // tinido 2 (um pouco mais agudo)
        playCoin(ctx, now + 0.16, 0.45, 2550); // tinido 3 (fecha)
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

    // Detecção de CTe novo: ctes subiu vs a leitura anterior -> som + animação.
    // Ignora a 1ª leitura (prev null) e quedas (ex.: restauração de teste).
    useEffect(() => {
        if (!dados || dados.ctes == null) return;
        const prevCtes = prevCtesRef.current;
        const prevTotal = prevTotalRef.current;
        prevCtesRef.current = dados.ctes;
        prevTotalRef.current = dados.total;
        if (prevCtes != null && dados.ctes > prevCtes) {
            const d = (dados.total != null && prevTotal != null) ? dados.total - prevTotal : null;
            setDelta(d != null && d > 0 ? d : null);
            setAnimar(true);
            tocarSom();
        }
    }, [dados, tocarSom]);

    // Desliga a animação depois de ~2.6s.
    useEffect(() => {
        if (!animar) return;
        const t = setTimeout(() => setAnimar(false), 2600);
        return () => clearTimeout(t);
    }, [animar]);

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
        <div className="relative min-h-screen w-full bg-gradient-to-br from-[#0b3a5e] via-[#0d4f7a] to-[#10643f] text-white flex flex-col items-center justify-center p-10 select-none overflow-hidden">
            <style>{`
                @keyframes tv-money-up {
                    0%   { transform: translateY(0) scale(.5); opacity: 0; }
                    12%  { opacity: 1; }
                    100% { transform: translateY(-78vh) scale(1.2) rotate(10deg); opacity: 0; }
                }
                @keyframes tv-badge {
                    0%   { transform: translate(-50%, 24px) scale(.6); opacity: 0; }
                    18%  { transform: translate(-50%, 0) scale(1.12); opacity: 1; }
                    70%  { opacity: 1; }
                    100% { transform: translate(-50%, -70px) scale(1); opacity: 0; }
                }
                @keyframes tv-pop { 0% { transform: scale(1); } 35% { transform: scale(1.05); } 100% { transform: scale(1); } }
            `}</style>

            {/* Animação "dinheiro entrando" — chuva de notas + badge +R$ */}
            {animar && (
                <div className="pointer-events-none absolute inset-0 overflow-hidden z-20">
                    {['8%', '23%', '39%', '57%', '73%', '90%'].map((left, i) => (
                        <span key={i} className="absolute text-6xl md:text-8xl" style={{ left, bottom: '10%', animation: `tv-money-up 2.4s ease-out ${i * 0.1}s forwards` }}>
                            {i % 2 === 0 ? '💵' : '💰'}
                        </span>
                    ))}
                    <div className="absolute left-1/2 top-[30%] -translate-x-1/2 text-emerald-300 font-bold whitespace-nowrap drop-shadow-[0_0_25px_rgba(52,211,153,0.6)]"
                        style={{ fontSize: 'clamp(2rem, 6vw, 5rem)', animation: 'tv-badge 2.4s ease-out forwards' }}>
                        {delta != null ? `+ R$ ${formatCur(delta)}` : 'Novo CTe! 💰'}
                    </div>
                </div>
            )}

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
                    <p className="font-semibold leading-none tracking-tight" style={{
                        fontSize: 'clamp(3rem, 12vw, 11rem)',
                        transition: 'text-shadow 0.8s ease',
                        textShadow: animar ? '0 0 55px rgba(52,211,153,0.85)' : '0 0 0 rgba(0,0,0,0)',
                        animation: animar ? 'tv-pop 0.6s ease-out' : 'none',
                    }}>
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
