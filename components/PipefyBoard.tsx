import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Clock, AlertTriangle, RefreshCw, Calendar, Layers, MapPin, Hash, WifiOff } from 'lucide-react';
import { getPipefyBoard, PipefyBoardCard } from '../services/pipefy';

const POLL_MS = 30000; // leitura a cada 30s

// Ordem das fases de preparação (Visão 1). "Motorista Não encontrado" é o bloco de alerta (separado).
const PHASE_ORDER = ['Cotações Fechadas', 'Motoristas em Contratação', 'GR', 'Motorista Contratado', 'Na Coleta', 'Faturamento', 'Pgto Adiantamento'];
const ALERT_PHASE = 'Motorista Não encontrado';

// "DD/MM/YYYY HH:mm" (formato do Pipefy) -> Date local. Retorna null se não parsear.
const parseColeta = (s: string): Date | null => {
    const m = (s || '').match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
    if (!m) return null;
    return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] || 0), Number(m[5] || 0));
};

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

// Tempo parado na fase, a partir do "desde" (ISO). Formata d/h/min.
const fmtElapsed = (desde: string | null, now: number): string => {
    if (!desde) return '—';
    const ms = now - new Date(desde).getTime();
    if (ms < 0 || isNaN(ms)) return '—';
    const min = Math.floor(ms / 60000), h = Math.floor(min / 60), d = Math.floor(h / 24);
    if (d >= 1) return `${d}d ${h % 24}h`;
    if (h >= 1) return `${h}h ${min % 60}min`;
    return `${min}min`;
};
// Escalonamento de cor pelo tempo parado: >48h vermelho, >24h âmbar, senão neutro.
const elapsedClass = (desde: string | null, now: number): string => {
    if (!desde) return 'bg-slate-100 text-slate-500';
    const h = (now - new Date(desde).getTime()) / 3600000;
    if (h > 48) return 'bg-red-100 text-red-700';
    if (h > 24) return 'bg-amber-100 text-amber-700';
    return 'bg-emerald-100 text-emerald-700';
};

const CardItem: React.FC<{ c: PipefyBoardCard; now: number; showFase?: boolean }> = ({ c, now, showFase }) => (
    <div className="bg-white border border-[#e5e7eb] rounded-lg px-3 py-2.5 flex items-center justify-between gap-3 hover:border-blue-100 transition-colors">
        <div className="min-w-0">
            <p className="text-sm font-medium text-[#111827] truncate">{c.cliente || '(sem cliente)'}</p>
            <p className="text-[11px] font-normal text-[#6b7280] truncate flex items-center gap-1"><MapPin className="w-3 h-3 shrink-0 text-slate-300" /> {c.rota || '—'}</p>
            <div className="flex items-center gap-2 mt-0.5">
                {c.referencia && <span className="text-[10px] font-medium text-[#6b7280] inline-flex items-center gap-0.5"><Hash className="w-2.5 h-2.5" /> {c.referencia}</span>}
                {showFase && <span className="text-[10px] font-medium text-blue-600 uppercase tracking-tight">{c.faseNome}</span>}
            </div>
        </div>
        <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold ${elapsedClass(c.desde, now)}`} title="Tempo parado nesta fase">
            <Clock className="w-3 h-3" /> {fmtElapsed(c.desde, now)}
        </span>
    </div>
);

const Bloco: React.FC<{ titulo: string; cards: PipefyBoardCard[]; now: number; showFase?: boolean; alerta?: boolean }> = ({ titulo, cards, now, showFase, alerta }) => (
    <div className={`rounded-xl border p-4 ${alerta ? 'border-red-200 bg-red-50/40' : 'border-[#e5e7eb] bg-[#f9fafb]'}`}>
        <div className="flex items-center justify-between mb-3">
            <h3 className={`text-[11px] font-medium uppercase tracking-widest flex items-center gap-1.5 ${alerta ? 'text-red-600' : 'text-[#6b7280]'}`}>
                {alerta && <AlertTriangle className="w-3.5 h-3.5" />} {titulo}
            </h3>
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${alerta ? 'bg-red-100 text-red-700' : 'bg-white border border-[#e5e7eb] text-[#6b7280]'}`}>{cards.length}</span>
        </div>
        {cards.length === 0
            ? <p className="text-xs text-[#9ca3af]">Nenhuma carga.</p>
            : <div className="space-y-2">{cards.map(c => <CardItem key={c.id} c={c} now={now} showFase={showFase} />)}</div>}
    </div>
);

export const PipefyBoard: React.FC = () => {
    const [cards, setCards] = useState<PipefyBoardCard[] | null>(null);
    const [view, setView] = useState<'fase' | 'coleta'>('fase');
    const [loading, setLoading] = useState(false);
    const [now, setNow] = useState(Date.now());
    const [lastOk, setLastOk] = useState<number | null>(null);
    const [stale, setStale] = useState(false); // última leitura falhou (mantém estado anterior)
    const mounted = useRef(true);

    const load = async () => {
        setLoading(true);
        const res = await getPipefyBoard();
        if (!mounted.current) return;
        setLoading(false);
        setNow(Date.now());
        if (res === null) { setStale(true); return; } // fail-soft: mantém o último estado
        setCards(res); setLastOk(Date.now()); setStale(false);
    };

    useEffect(() => {
        mounted.current = true;
        load();
        const t = setInterval(load, POLL_MS);
        return () => { mounted.current = false; clearInterval(t); };
    }, []);

    const total = cards?.length || 0;

    // Visão 1: agrupa por fase (na ordem) + bloco de alerta.
    const porFase = useMemo(() => {
        const g: Record<string, PipefyBoardCard[]> = {};
        (cards || []).forEach(c => { (g[c.faseNome] = g[c.faseNome] || []).push(c); });
        return g;
    }, [cards]);

    // Visão 2: agrupa pela data de coleta.
    const porColeta = useMemo(() => {
        const today = startOfDay(new Date()).getTime();
        const buckets: Record<string, PipefyBoardCard[]> = { Atrasada: [], Hoje: [], 'Amanhã': [], 'Depois de amanhã': [], Futuras: [], 'Sem data': [] };
        (cards || []).forEach(c => {
            const d = parseColeta(c.coleta);
            if (!d) { buckets['Sem data'].push(c); return; }
            const diff = Math.round((startOfDay(d).getTime() - today) / 86400000);
            if (diff < 0) buckets.Atrasada.push(c);
            else if (diff === 0) buckets.Hoje.push(c);
            else if (diff === 1) buckets['Amanhã'].push(c);
            else if (diff === 2) buckets['Depois de amanhã'].push(c);
            else buckets.Futuras.push(c);
        });
        return buckets;
    }, [cards]);

    return (
        <div className="h-full animate-fade-in p-2">
            {/* Cabeçalho */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                <div className="flex items-center gap-3">
                    <h2 className="text-lg font-medium text-[#111827]">Acompanhamento</h2>
                    <span className="px-3 py-1 rounded-full bg-[#eff6ff] text-[#1d6fb8] text-sm font-semibold">{total} em andamento</span>
                    {stale && <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600" title="O Pipefy não respondeu na última leitura; mostrando o último estado."><WifiOff className="w-3.5 h-3.5" /> sem atualizar</span>}
                </div>
                <div className="flex items-center gap-2">
                    <div className="flex bg-[#f3f4f6] rounded-lg p-0.5">
                        <button onClick={() => setView('fase')} className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors ${view === 'fase' ? 'bg-white text-[#1d6fb8] shadow-sm' : 'text-[#6b7280]'}`}><Layers className="w-3.5 h-3.5" /> Por fase</button>
                        <button onClick={() => setView('coleta')} className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors ${view === 'coleta' ? 'bg-white text-[#1d6fb8] shadow-sm' : 'text-[#6b7280]'}`}><Calendar className="w-3.5 h-3.5" /> Por data de coleta</button>
                    </div>
                    <button onClick={load} disabled={loading} className="p-2 bg-white border border-[#e5e7eb] rounded-lg text-[#6b7280] hover:bg-[#f9fafb] disabled:opacity-50" title="Atualizar agora">
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {cards === null ? (
                <div className="flex items-center justify-center h-64 text-[#9ca3af] text-sm gap-2"><RefreshCw className="w-4 h-4 animate-spin" /> Carregando do Pipefy…</div>
            ) : view === 'fase' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {PHASE_ORDER.map(f => <Bloco key={f} titulo={f} cards={porFase[f] || []} now={now} />)}
                    {(porFase[ALERT_PHASE]?.length || 0) > 0 && <Bloco titulo={ALERT_PHASE} cards={porFase[ALERT_PHASE]} now={now} alerta />}
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {(['Atrasada', 'Hoje', 'Amanhã', 'Depois de amanhã', 'Futuras', 'Sem data'] as const).map(b => {
                        const list = porColeta[b] || [];
                        if ((b === 'Atrasada' || b === 'Sem data') && list.length === 0) return null; // só mostra esses extras se houver
                        return <Bloco key={b} titulo={b} cards={list} now={now} showFase alerta={b === 'Atrasada'} />;
                    })}
                </div>
            )}
        </div>
    );
};
