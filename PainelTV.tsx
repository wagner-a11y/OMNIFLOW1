import React, { useEffect, useState, useCallback, useRef } from 'react';

// PainelTV — tela pública (sem login) pra exibir o faturamento do mês numa TV.
// Lê de um endpoint PÚBLICO (get-faturamento-publico) que exige um token secreto
// passado na URL: /painel-tv?k=<token>. O token NÃO fica no bundle — vem da URL.
// Atualiza por polling (o cron atualiza o cache a cada 2 min no servidor).

interface Pendencia {
    nroConhecimento: string;
    valor: number;
    statusSefaz: string;
    tomador: string;
}

/** Um dia da semana corrente, como o servidor manda (domingo -> sábado). */
interface DiaSemana {
    dia: string;      // 'YYYY-MM-DD' em America/Sao_Paulo — TEXTO, nunca Date
    valor: number;
    ctes: number;
    hoje: boolean;    // quem decide é o servidor: a TV não sabe se o relógio dela está certo
    futuro: boolean;  // dia que ainda não chegou -> barra vazia
}

interface Dados {
    total: number | null;
    ctes: number | null;
    totalHoje: number | null;
    // Dois números: faturamento autorizado e valor travado (pendências não transmitidas/rejeitadas).
    faturamentoAutorizado?: number | null;
    valorTravado?: number | null;
    pendencias?: Pendencia[];
    status: string;
    atualizadoEm: string;       // última tentativa (ok ou erro)
    sucessoEm?: string | null;  // última coleta BEM-SUCEDIDA
    /**
     * Os 7 dias da semana corrente. OPCIONAL de propósito: enquanto a Edge
     * Function nova não estiver publicada, o endpoint responde sem este campo e
     * o painel segue exatamente como era, sem o gráfico e sem erro.
     */
    semana?: DiaSemana[];
}

const STALE_MIN = 15; // acima disso sem coleta bem-sucedida, o painel se marca desatualizado

const POLL_MS = 30_000; // relê o cache a cada 30s (cron grava a cada 2 min)
const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-faturamento-publico`;

const formatCur = (v: number) =>
    v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Valor curto para caber em cima da barra e ser lido de longe: "12,5 mil",
// "1,2 mi". Na parede, "R$ 12.480,00" em fonte pequena não se lê.
const formatCompacto = (v: number): string => {
    if (v >= 1_000_000) return `${(v / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
    if (v >= 1_000) return `${(v / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
    return v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
};

// Rótulos por POSIÇÃO: a semana vem sempre domingo -> sábado do servidor, então
// o índice já diz o dia. Derivar o nome da data no cliente exigiria Date e
// reabriria o problema de fuso justo na ponta que não controlamos (o relógio da TV).
const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** "2026-09-18" -> "18". Corte de texto: sem Date, sem fuso. */
const diaDoMes = (ymd: string): string => ymd.slice(8, 10);

// Som de caixa registradora (arquivo real do Pixabay, royalty-free) servido em
// /coin.mp3 (pasta public). Carregado e tocado pelo AudioContext.
const SOM_URL = '/coin.mp3';

const PainelTV: React.FC = () => {
    const token = new URLSearchParams(window.location.search).get('k') || '';
    const [dados, setDados] = useState<Dados | null>(null);
    const [erro, setErro] = useState<string | null>(null);
    const [tick, setTick] = useState(0); // força recalcular o "há X min"
    const [ultimaLeitura, setUltimaLeitura] = useState<Date | null>(null); // prova de vida: quando a TV releu

    // --- Som de "novo CTe" (arquivo real tocado via AudioContext) ---
    const audioCtxRef = useRef<AudioContext | null>(null);
    const audioBufferRef = useRef<AudioBuffer | null>(null); // /coin.mp3 decodificado
    const somLigadoRef = useRef(true);
    const prevCtesRef = useRef<number | null>(null);  // ctes da leitura anterior (detecção)
    const prevTotalRef = useRef<number | null>(null); // total anterior (p/ calcular o +R$)
    const [somAtivado, setSomAtivado] = useState(false); // usuário liberou o AudioContext?
    const [somLigado, setSomLigado] = useState(true);    // toggle on/off
    const [animar, setAnimar] = useState(false);         // animação de "dinheiro entrando"
    const [delta, setDelta] = useState<number | null>(null); // quanto subiu (R$)
    useEffect(() => { somLigadoRef.current = somLigado; }, [somLigado]);

    // Toca o arquivo de caixa registradora (se já decodificado e o som ligado).
    const tocarSom = useCallback(() => {
        const ctx = audioCtxRef.current;
        const buf = audioBufferRef.current;
        if (!ctx || !buf || !somLigadoRef.current) return;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        src.start();
    }, []);

    // Libera o AudioContext (precisa de gesto do usuário), baixa+decodifica o
    // /coin.mp3 e dá um preview do som.
    const ativarSom = async () => {
        try {
            if (!audioCtxRef.current) {
                const AC = window.AudioContext || (window as any).webkitAudioContext;
                audioCtxRef.current = new AC();
            }
            const ctx = audioCtxRef.current;
            await ctx.resume();
            setSomAtivado(true);
            setSomLigado(true);
            somLigadoRef.current = true;
            if (!audioBufferRef.current) {
                const res = await fetch(SOM_URL);
                const arr = await res.arrayBuffer();
                audioBufferRef.current = await ctx.decodeAudioData(arr);
            }
            tocarSom(); // confirma que o som funciona
        } catch { /* sem Web Audio / falha ao carregar: ignora */ }
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

    // Staleness: a TV usa a última coleta BEM-SUCEDIDA (sucessoEm). Desatualizado =
    // sem sucesso conhecido, OU última tentativa com erro, OU passou de STALE_MIN.
    // Painel congelado mostrando número velho como se fosse atual é pior que errado.
    const stale = (() => {
        void tick; // recomputa a cada 30s
        const okMs = dados?.sucessoEm ? new Date(dados.sucessoEm).getTime() : null;
        const ageMin = okMs != null ? Math.floor((Date.now() - okMs) / 60000) : null;
        const desatualizado = okMs == null || dados?.status === 'erro' || (ageMin != null && ageMin > STALE_MIN);
        const horaSucesso = okMs != null ? new Date(okMs).toLocaleTimeString('pt-BR') : '—';
        const textoIdade = ageMin == null ? 'sem coleta bem-sucedida'
            : ageMin <= 0 ? 'agora há pouco' : ageMin === 1 ? 'há 1 min' : `há ${ageMin} min`;
        return { desatualizado, ageMin, horaSucesso, textoIdade };
    })();

    const hoje = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' });

    return (
        <div className="relative isolate min-h-screen w-full bg-gradient-to-br from-[#0b3a5e] via-[#0d4f7a] to-[#10643f] text-white flex flex-col items-center justify-center p-10 select-none overflow-hidden">
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

            {/* ------------------------------------------------------------------
                MARCA D'ÁGUA — o símbolo da OmniCargo ao fundo.

                `-z-10` com `isolate` no container: o negativo pinta ACIMA do
                gradiente e ABAIXO do conteúdo, e o `isolate` é o que garante
                isso — sem ele, o z negativo fugiria para o stacking context da
                página e a logo sumiria atrás do próprio fundo.

                É só o SÍMBOLO, sem o letreiro: `logo-simbolo.png` foi
                recortado de `logo-full.png` — o `logo-icon.jpg` é o mesmo
                desenho, mas em JPG com fundo BRANCO, que sobre o gradiente
                escuro viraria um quadrado branco. O recorte preserva a
                transparência do PNG.

                `brightness-0 invert` transforma o símbolo (azul, cinza e
                laranja) em silhueta branca. Sobre o gradiente azul-escuro, as
                cores originais em baixa opacidade sumiriam ou sujariam o fundo;
                a silhueta lê como marca d'água e não briga com o número, que é
                o que a TV existe para mostrar.

                `w-[min(92vh,92vw)]`: o símbolo é quadrado e a TV é 16:9,
                então quem limita é a ALTURA — medir só por vw estouraria a
                tela. A 92vh ele quase encosta em cima e embaixo; passar de
                100vh faz o `overflow-hidden` do container cortar as bordas.

                Opacidade baixa e `pointer-events-none`: é fundo, não interface.
               ------------------------------------------------------------------ */}
            <img src="/logo-simbolo.png" alt=""
                aria-hidden="true"
                className="pointer-events-none select-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 -z-10 w-[min(92vh,92vw)] opacity-[0.07] brightness-0 invert" />

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

            {/* Banner de DESATUALIZADO — precisa ser visto na parede. Só aparece quando há dado
                mas ele está velho/coleta falhando (não na tela de carregando/erro de token). */}
            {dados && stale.desatualizado && (
                <div className="absolute top-0 left-0 right-0 z-30 bg-red-600 text-white px-6 py-3 flex items-center justify-center gap-4 shadow-lg animate-pulse">
                    <span className="text-2xl md:text-3xl">⚠️</span>
                    <span className="text-lg md:text-2xl font-bold uppercase tracking-wide">
                        Painel desatualizado — última atualização {stale.textoIdade}
                        {dados.status === 'erro' ? ' · coleta falhando' : ''}
                    </span>
                </div>
            )}

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

                    {/* Destaque secundário: valor travado (CTe pendente/rejeitado, não faturado). */}
                    {dados.valorTravado != null && dados.valorTravado > 0 && (
                        <p className="mt-5 text-2xl md:text-3xl font-medium text-amber-300/90 flex items-center gap-3">
                            <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400" />
                            R$ {formatCur(dados.valorTravado)} <span className="text-white/50">travado</span>
                            {dados.pendencias && dados.pendencias.length > 0 && (
                                <span className="text-white/40 text-lg md:text-xl">· {dados.pendencias.length} CTe(s) pendente(s)</span>
                            )}
                        </p>
                    )}
                    <div className="mt-12 flex items-center gap-3 text-lg">
                        <span className={`w-3 h-3 rounded-full ${stale.desatualizado ? 'bg-red-400' : 'bg-emerald-400 animate-pulse'}`} />
                        <span className={stale.desatualizado ? 'text-red-300 font-medium' : 'text-white/50'}>
                            {stale.desatualizado
                                ? `desatualizado — última coleta OK ${stale.horaSucesso} (${stale.textoIdade})`
                                : `atualizado ${stale.horaSucesso} (${stale.textoIdade})`}
                        </span>
                        {ultimaLeitura && (
                            <span className="text-white/40 text-sm ml-2">· tela sincronizada {ultimaLeitura.toLocaleTimeString('pt-BR')}</span>
                        )}
                    </div>
                    {/* ------------------------------------------------------------------
                        GRÁFICO DA SEMANA — domingo a sábado, faixa horizontal.

                        Fica ABAIXO do bloco de status de propósito: o número do
                        mês é o que se lê do fundo da sala e não pode encolher.
                        O gráfico é a segunda leitura, de quem se aproxima.

                        Sem lib de gráfico: são sete divs com `height` em
                        porcentagem. Uma dependência nova para desenhar retângulo
                        custaria bundle e manutenção pelo mesmo resultado.

                        A ESCALA é relativa à MAIOR barra da semana (= 100% da
                        altura), não a um teto fixo: assim a forma da semana
                        aparece igual numa semana de R$ 50 mil e numa de R$ 500 mil.
                        Semana inteira zerada -> todas vazias, sem divisão por zero.
                       ------------------------------------------------------------------ */}
                    {dados.semana && dados.semana.length === 7 && (() => {
                        const maxValor = Math.max(...dados.semana.map(d => d.valor), 0);
                        return (
                            <div className="mt-10 w-[70vw] max-w-[1600px]">
                                <div className="flex items-baseline justify-between mb-2">
                                    <p className="text-sm md:text-base font-medium uppercase tracking-[0.2em] text-white/40">
                                        Esta semana
                                    </p>
                                    <p className="text-sm md:text-base font-medium text-white/40">
                                        R$ {formatCur(dados.semana.reduce((a, d) => a + d.valor, 0))}
                                    </p>
                                </div>
                                <div className="flex items-end justify-between gap-[1.2vw] h-[18vh]">
                                    {dados.semana.map((d, i) => {
                                        // Piso de 2% para o dia que faturou pouco não virar uma
                                        // linha invisível: a barra existindo comunica "houve CTe".
                                        const pct = maxValor > 0 && d.valor > 0
                                            ? Math.max(2, (d.valor / maxValor) * 100)
                                            : 0;
                                        return (
                                            <div key={d.dia} className="flex-1 h-full flex flex-col justify-end items-center gap-[0.6vh]">
                                                {/* valor acima da barra; dia sem faturamento não escreve nada */}
                                                <span className={`font-semibold leading-none whitespace-nowrap ${d.hoje ? 'text-emerald-200' : 'text-white/55'}`}
                                                    style={{ fontSize: 'clamp(0.6rem, 1.15vw, 1.35rem)' }}>
                                                    {d.valor > 0 ? formatCompacto(d.valor) : ''}
                                                </span>
                                                {/* a barra */}
                                                <div className="w-full flex-1 flex flex-col justify-end">
                                                    <div
                                                        className={
                                                            d.futuro
                                                                ? 'w-full rounded-t-md border border-dashed border-white/15'
                                                                : d.hoje
                                                                    ? 'w-full rounded-t-md bg-emerald-300 shadow-[0_0_25px_rgba(52,211,153,0.55)]'
                                                                    : d.valor > 0
                                                                        ? 'w-full rounded-t-md bg-emerald-400/55'
                                                                        : 'w-full rounded-t-md bg-white/10'
                                                        }
                                                        style={{
                                                            // Futuro e dia vazio ficam com um toco de 4% só para a
                                                            // coluna existir visualmente — a semana tem sempre 7.
                                                            height: d.futuro || d.valor === 0 ? '4%' : `${pct}%`,
                                                            transition: 'height 0.8s ease',
                                                        }}
                                                    />
                                                </div>
                                                {/* rótulo do dia */}
                                                <span className={`leading-none whitespace-nowrap ${d.hoje ? 'text-emerald-200 font-bold' : 'text-white/45 font-medium'}`}
                                                    style={{ fontSize: 'clamp(0.65rem, 1.25vw, 1.5rem)' }}>
                                                    {DIAS_SEMANA[i]} {diaDoMes(d.dia)}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })()}

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
