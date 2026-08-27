// Redeploy trigger: 2026-02-18 v2

import React, { useState, useEffect, useMemo, useRef } from 'react';
import jsPDF from 'jspdf';
import {
    LayoutDashboard, Calculator, History, Settings, LogOut, Truck, Map as MapIcon, DollarSign, Package, Scale, FileText, TrendingUp, AlertCircle, CheckCircle2, XCircle, ChevronRight, Search, Filter, ArrowUpDown, Save, Trash2, Edit3, Copy as ClipboardCopy, CopyPlus, ThumbsUp, ThumbsDown, Plus, Upload, Users, Percent, Key, UserCircle, X, RotateCcw, FileDown, PlusCircle, Target, Info, Activity, Layers, ShieldCheck, ArrowRightLeft, CreditCard, Wrench, Lock, User as UserIcon, UserCheck, ImageIcon, Download, AlertTriangle, Clock, Hash, PieChart, Calendar, ChevronDown, Check, Zap, Award, ArrowDown, BarChart3, CheckCircle, List, ArrowRight, Sparkles, Send, Tv, IdCard
} from 'lucide-react';
import { CRMBoard } from './components/CRMBoard';
import { ProspeccaoBoard } from './components/ProspeccaoBoard';
import { CarteiraBoard } from './components/CarteiraBoard';
import { RegistroContatoBoard } from './components/RegistroContatoBoard';
import { PainelCobrancaBoard } from './components/PainelCobrancaBoard';
import { NegociacoesBoard } from './components/NegociacoesBoard';

// Interruptor do submenu "Ações do Comercial". REVELADO (true) — visível pro time.
// A trava por papel é mantida: operador vê só "Contato Diário · Registrar";
// master vê os 3 (Minha Carteira, Análise, Registrar). Voltar a ocultar = false.
const MOSTRAR_ACOES_COMERCIAL = true;
// Acompanhamento de Negociações (Camada 1). NASCE OCULTO (false): não aparece no menu E o
// gatilho automático de entrada (no "Mandar pro Ramper") fica dormente — o envio se comporta
// idêntico a hoje. Revelar = true (exige a migração neg_ aplicada). Reversível.
// Acompanhamento de Negociações (Camada 1). LIBERADO (true) — visível pro time (todos os papéis,
// transparência: veem todas, editam só as próprias; dono em destaque). O gatilho automático de
// entrada no "Mandar pro Ramper" fica ativo. Tabelas neg_ e RLS já aplicadas. Voltar a ocultar = false.
const MOSTRAR_NEGOCIACOES = true;

// ============================================================================
// CHAVE DE EMERGÊNCIA DO QUALP — estado vem do banco (emergencia_config), não
// mais de constante em código. Só o master liga/desliga, e a trava é de
// SERVIDOR: a policy de UPDATE exige public.is_master().
//
// Nasceu do incidente de 04/08/2026, em que ligar e desligar exigia deploy.
// Comportamento quando LIGADA (só rota simples), idêntico ao que rodou naquele
// dia: bloqueio do Qualp desligado, piso pela Tabela A local, pedágio manual,
// banner amarelo persistente e cotação marcada origem_dados='contingencia'.
// ============================================================================

// Link direto pro card no Pipefy: usa a URL exata salva (pipefyCardUrl) e, no fallback,
// monta o deep-link universal pelo id (open-cards/<id>). null = carga sem card no Pipefy.
const pipefyCardLink = (q?: { pipefyCardUrl?: string; pipefyCardId?: string }): string | null =>
    q?.pipefyCardUrl || (q?.pipefyCardId ? `https://app.pipefy.com/open-cards/${q.pipefyCardId}` : null);

// Próximo número de proposta = MAIOR número existente + 1. Não usa history.length (que conta
// duplicados/apagados e por isso colidia). Só afeta a PRÓXIMA criação — NÃO renumera as antigas.
const nextProposalNumber = (hist: { proposalNumber?: string }[]): string => {
    const maxN = hist.reduce((mx, h) => {
        const m = /(\d+)\s*$/.exec(h.proposalNumber || '');
        const n = m ? parseInt(m[1], 10) : 0;
        return n > mx ? n : mx;
    }, 0);
    return `CT-${new Date().getFullYear()}-${(maxN + 1).toString().padStart(4, '0')}`;
};

import { WonInfoModal } from './components/WonInfoModal';
import { VehicleType, FreightCalculation, Customer, FederalTaxes, QuoteStatus, ANTTCoefficients, User, UserRole, Disponibilidade, ExtraCostItem } from './types';
import { VEHICLE_CONFIGS, INITIAL_CUSTOMERS } from './constants';
import { ANTT_CARGO_TYPES, CARGA_CONFERIR_PISO, computeANTTFloor } from './utils/antt';
import MunicipioAutocomplete, { useMunicipios } from './components/MunicipioAutocomplete';
import CadastroMotorista from './components/CadastroMotorista';
import FastDelivery from './components/FastDelivery';
import { normalizar, resolverMunicipio } from './utils/municipios';
import { definirEmergencia, lerEmergencia, EstadoEmergencia } from './services/emergencia';
import { estimateDistance, estimateMultiRoute, parseRequest, compileReportText } from './services/geminiService';
import { createRamperCard } from './services/ramper';
import { createNegociacaoFromRamper } from './services/negociacoes';
import { buildQuoteChanges, registrarAlteracao, getAlteracoes, AlteracaoCotacao } from './services/auditoria';
import { createPipefyCard } from './services/pipefy';
import { PipefyAutocomplete } from './components/PipefyAutocomplete';
import { PipefyBoard } from './components/PipefyBoard';
import { RouteMap, MapErrorBoundary } from './components/RouteMap';
import { getIcmsRate, getUF, getStandardIcmsRules } from './utils/icms';
import {
    getProfile,
    getProfiles,
    createUserAccount,
    deleteUserAccount,
    resetUserPassword,
    setUserActive,
    finishPasswordChange,
    getCustomers,
    createCustomer,
    deleteCustomer,
    updateCustomer,
    getFreightCalculations,
    createFreightCalculation,
    updateFreightCalculation,
    deleteFreightCalculation,
    getDeletedFreightCalculations,
    restoreFreightCalculation,
    permanentlyDeleteFreightCalculation,
    purgeOldTrash,
    getFaturamentoCache,
    FaturamentoCache,
    getPainelTvToken,
    getSystemConfig,
    updateSystemConfig,
    getVehicleConfigs,
    upsertVehicleConfig,
    deleteVehicleConfig
} from './services/database';
import { supabase } from './services/supabase';

const DefaultLogo: React.FC<{ className?: string }> = ({ className }) => (
    <svg viewBox="0 0 100 100" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M50 10C27.9 10 10 27.9 10 50C10 72.1 27.9 90 50 90C63.1 90 74.6 83.7 81.8 74" stroke="#344a5e" strokeWidth="12" strokeLinecap="round" />
        <path d="M50 30C39 30 30 39 30 50C30 61 39 70 50 70C54 70 57.6 68.8 60.7 66.8" stroke="#1d6fb8" strokeWidth="8" strokeLinecap="round" />
        <circle cx="50" cy="50" r="8" fill="#f37021" />
    </svg>
);

// Opções de mercadoria — grafia IDÊNTICA à do campo tipo_de_mercadoria do Pipefy (espelho exato).
// "Tintas, Vernizes, Solvente e derivados" é UM valor único (as vírgulas fazem parte do nome).
// "Cargas Diversas" é a opção quando nada encaixa.
const MERCADORIA_OPTIONS = [
    'Amido', 'Andaimes', 'Autopeças', 'Artigos de Higiene e Limpeza', 'Bebidas em Geral', 'Cargas Diversas',
    'Defensivos Agrícolas e Fertilizantes', 'Ferramentas Manuais ou Elétricas', 'Máquinas e Equipamentos',
    'Papel em Bobinas', 'Papel e derivados diversos', 'Pallet Vazio', 'Pneus', 'Produtos Alimentícios',
    'Tintas, Vernizes, Solvente e derivados', 'Transformadores',
];
// Casa um texto (ex.: vindo da importação inteligente) com uma das 16 opções, ignorando caixa/acento.
// Sem correspondência, retorna '' (operador escolhe; "Cargas Diversas" é o curinga manual).
const matchMercadoriaOption = (v: string): string => {
        const norm = (s: string) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
    const n = norm(v);
    return MERCADORIA_OPTIONS.find(o => norm(o) === n) || '';
};

// Opções de Implemento — grafia IDÊNTICA ao campo "Implemento" (qual_o_tipo_de_carreta) do Pipefy.
const IMPLEMENTO_OPTIONS = ['Sider', 'Baú', 'Grade Baixa', 'Graneleiro', 'N/A', 'Prancha'];

// Insights determinísticos (sempre do banco; a IA nunca calcula número). Mesma fonte pro dashboard e
// pro relatório do WhatsApp. REGRA: "carga fechada" = cotação enviada pro Pipefy (tem card / pipefy_sent_at).
const VOLUME_RELEVANTE = 5; // mínimo de cotações p/ um solicitante entrar nos rankings de conversão
const computeDashboardInsights = (history: FreightCalculation[], customers: Customer[], now: number) => {
    const DAY = 86400000;
    const d = new Date(now); d.setHours(0, 0, 0, 0); const today0 = d.getTime();
    const win30 = now - 30 * DAY;
    const custName = (id: string) => customers.find(c => c.id === id)?.name || 'Sem cliente';
    const isFechada = (h: any) => !!(h.pipefyCardId || h.pipefySentAt); // enviada pro Pipefy
    const tsOf = (h: any) => Number(h.createdAt) || 0;

    // Números do dia (hoje)
    const hojeArr = history.filter(h => tsOf(h) >= today0);
    const hojeCotadas = hojeArr.length;
    const hojeFechadas = hojeArr.filter(isFechada).length;
    const hoje = { cotadas: hojeCotadas, fechadas: hojeFechadas, conversao: hojeCotadas ? Math.round(hojeFechadas / hojeCotadas * 100) : 0 };

    // Clientes ativos nos últimos 30 dias que NÃO cotaram hoje (pro comercial saber quem chamar)
    const byClient = new Map<string, { last: number; today: number; c30: number }>();
    history.forEach(h => {
        if (!h.customerId) return;
        const t = tsOf(h);
        const cur = byClient.get(h.customerId) || { last: 0, today: 0, c30: 0 };
        if (t > cur.last) cur.last = t;
        if (t >= today0) cur.today++;
        if (t >= win30) cur.c30++;
        byClient.set(h.customerId, cur);
    });
    const naoCotaramHoje: { name: string; dias: number }[] = [];
    byClient.forEach((v, id) => { if (v.c30 > 0 && v.today === 0) naoCotaramHoje.push({ name: custName(id), dias: Math.floor((now - v.last) / DAY) }); });
    naoCotaramHoje.sort((a, b) => b.dias - a.dias); // mais parado primeiro

    // Conversão por solicitante (últimos 30 dias): fechadas / cotadas
    const last30 = history.filter(h => tsOf(h) >= win30);
    const solMap = new Map<string, { cotadas: number; fechadas: number }>();
    last30.forEach(h => {
        const s = (h.solicitante || '').trim(); if (!s) return;
        const cur = solMap.get(s) || { cotadas: 0, fechadas: 0 };
        cur.cotadas++; if (isFechada(h)) cur.fechadas++;
        solMap.set(s, cur);
    });
    const rankingSolicitantes = Array.from(solMap.entries())
        .map(([nome, v]) => ({ nome, cotadas: v.cotadas, fechadas: v.fechadas, conv: v.cotadas ? Math.round(v.fechadas / v.cotadas * 100) : 0 }))
        .sort((a, b) => b.cotadas - a.cotadas);
    const relevantes = rankingSolicitantes.filter(s => s.cotadas >= VOLUME_RELEVANTE);
    const melhorAderencia = relevantes.length ? [...relevantes].sort((a, b) => b.conv - a.conv || b.cotadas - a.cotadas)[0] : null;
    const cotaMuitoFechaPouco = relevantes.length ? [...relevantes].sort((a, b) => a.conv - b.conv || b.cotadas - a.cotadas)[0] : null;

    return { hoje, naoCotaramHoje, rankingSolicitantes, melhorAderencia, cotaMuitoFechaPouco, minVolume: VOLUME_RELEVANTE };
};

// Veículos utilitários: frete base = KM × tarifa fixa (ignoram a tabela ANTT).
const App: React.FC = () => {
    // Estados de Autenticação (sessão nativa do Supabase Auth)
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true); // enquanto restaura a sessão
    // Definição de senha (convite/recuperação): usuário chega pelo link do e-mail e cria a senha.
    const [recoveryMode, setRecoveryMode] = useState(false);
    const [newPassword, setNewPassword] = useState('');
    const [savingPassword, setSavingPassword] = useState(false);
    const [showChangePassword, setShowChangePassword] = useState(false);
    const [mustChangePwd, setMustChangePwd] = useState(false); // 1º acesso: troca obrigatória da senha temporária
    const [credMsg, setCredMsg] = useState<{ title: string; email: string; password: string } | null>(null); // mensagem copiável (login+senha)
    const [newUser, setNewUser] = useState({ name: '', email: '', role: 'operador' });
    const [loginSubmitting, setLoginSubmitting] = useState(false);
    const [users, setUsers] = useState<User[]>([]); // perfis (tela de gestão do master)
    const [loginForm, setLoginForm] = useState({ username: '', password: '' }); // username = e-mail

    // Estados Globais
    const [appLogo, setAppLogo] = useState<string | null>(() => localStorage.getItem('flow_app_logo'));
    const [history, setHistory] = useState<FreightCalculation[]>([]);
    const [trash, setTrash] = useState<FreightCalculation[]>([]);
    const [faturamento, setFaturamento] = useState<FaturamentoCache | null>(null);
    const [painelTvToken, setPainelTvToken] = useState<string | null>(null);
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [fedTaxes, setFedTaxes] = useState<FederalTaxes>({ pis: 0.65, cofins: 3.0, csll: 1.08, irpj: 1.2, insurancePolicyRate: 0.035 });
    const [vehicleConfigs, setVehicleConfigs] = useState<Record<string, ANTTCoefficients & { factor?: number; axles?: number; capacity?: number; consumption?: number }>>(VEHICLE_CONFIGS);
    const [spotStats, setSpotStats] = useState({ simulated: 0, converted: 0 });

    const [activeTab, setActiveTab] = useState<'new' | 'history' | 'dashboard' | 'crm' | 'tracking' | 'trash' | 'prospeccao' | 'contato-diario' | 'cd-registro' | 'cd-cobranca' | 'negocios' | 'cadastro-motorista' | 'fast-delivery'>('dashboard');
    const [acoesAbertas, setAcoesAbertas] = useState(true); // submenu "Ações do Comercial" aberto/fechado
    const [configTab, setConfigTab] = useState<'financial' | 'customers' | 'fleet' | 'users' | 'identity' | 'goals' | 'icms'>('financial');
    const [searchQuery, setSearchQuery] = useState('');
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'info' | 'error' } | null>(null);
    const [showConfigModal, setShowConfigModal] = useState(false);
    const [isWonModalOpen, setIsWonModalOpen] = useState(false);
    const [selectedWonQuote, setSelectedWonQuote] = useState<FreightCalculation | null>(null);
    const [newCustomerName, setNewCustomerName] = useState('');
    const [newCustomerLogo, setNewCustomerLogo] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [showCelebration, setShowCelebration] = useState(false);
    // Link do card recém-criado no Pipefy (botão "Abrir card no Pipefy" pós-envio).
    const [lastPipefyUrl, setLastPipefyUrl] = useState<string | null>(null);
    // Valor do frete fechado (herói da tela "Venda Fechada") + contagem elegante até ele.
    const [celebrationValue, setCelebrationValue] = useState(0);
    const [celebCount, setCelebCount] = useState(0);
    const [selectedMonth, setSelectedMonth] = useState<string>(new Date().toISOString().slice(0, 7));
    // Relatório diário (só master): período + resultado calculado do banco (determinístico).
    const [reportPreset, setReportPreset] = useState<'hoje' | 'ontem' | '7d' | '30d' | 'mes'>('hoje');
    const [dailyReport, setDailyReport] = useState<any>(null);
    const [reportText, setReportText] = useState('');
    const [reportTextLoading, setReportTextLoading] = useState(false);

    // Estados de Edição de Clientes
    const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
    const [customerFilePreview, setCustomerFilePreview] = useState<string | null>(null);
    // Vínculo Pipefy do cliente em edição (nome exibido + id do registro). Editável pra corrigir.
    const [newCustomerPipefyId, setNewCustomerPipefyId] = useState<string | undefined>(undefined);
    const [newCustomerPipefyName, setNewCustomerPipefyName] = useState('');

    // Form State
    const [origin, setOrigin] = useState('');
    const [destination, setDestination] = useState('');
    // Multidestino: destinos extras (destino 2..8). Vazio = destino único (comportamento atual).
    const [destinations, setDestinations] = useState<string[]>([]);
    const [showMap, setShowMap] = useState(false);
    const [routeLoading, setRouteLoading] = useState(false);
    const [routeGeometry, setRouteGeometry] = useState<{ polyline: string; stops: { lat: number; lng: number }[] } | null>(null);
    const [clientReference, setClientReference] = useState('');
    const [distanceKm, setDistanceKm] = useState<string>('0');
    const [vehicleType, setVehicleType] = useState<string>(Object.keys(vehicleConfigs)[0] || "Truck");
    const [weight, setWeight] = useState<string>('0');
    const [selectedCustomerId, setSelectedCustomerId] = useState('');
    const [baseFreight, setBaseFreight] = useState<string>('0');
    const [tolls, setTolls] = useState<string>('0');
    // --- Fonte única Qualp (rota simples). Multi-parada segue no Google (Fase 2). ---
    // Snapshot da última consulta ao Qualp. Só vale para o MESMO tipo de carga e
    // nº de eixos consultados: mudou depois, o piso está velho e some até recalcular.
    const [qualpRota, setQualpRota] = useState<{
        km: number; pedagioCheio: number; pedagioTag: number; piso: number | null;
        // Os quatro campos que definem o resultado. Se qualquer um mudar depois da
        // busca, o resultado na tela não corresponde mais ao que foi consultado.
        origem: string; destino: string; cargoType: string; eixos: number | undefined;
        resolucao: { nome: string; data: string | null; url: string | null } | null;
        confirmarPiso: boolean; idTransacao: string | null;
        // 'qualp' = veio de uma busca agora; 'salvo' = números gravados na cotação
        // reaberta. Os dois são invalidados pelos mesmos quatro campos — trocar o
        // veículo numa cotação antiga também deixa o pedágio velho sem valer.
        fonte: 'qualp' | 'salvo';
    } | null>(null);
    // Houve busca bem-sucedida e algum campo que suja o resultado mudou depois.
    // Conta como inválido: a cotação não fecha até buscar de novo.
    const [rotaDesatualizada, setRotaDesatualizada] = useState(false);
    // Falha bloqueante do Qualp: trava o fechamento da cotação de rota simples.
    const [qualpBloqueio, setQualpBloqueio] = useState<string | null>(null);
    // --- Chave de emergência (estado no banco, só master altera) ---
    const [emergencia, setEmergencia] = useState<EstadoEmergencia>({ ligada: false, alteradoPorNome: null, alteradoEm: null });
    const [showEmergenciaModal, setShowEmergenciaModal] = useState(false);
    const [salvandoEmergencia, setSalvandoEmergencia] = useState(false);
    // Sonda de recuperação: vira true quando o Qualp volta a responder com a
    // chave ligada. Só avisa — quem decide desligar é o master.
    const [qualpVoltou, setQualpVoltou] = useState(false);
    const emergenciaLigada = emergencia.ligada;
    const ehMaster = currentUser?.role === 'master';
    // Frete urbano (origem == destino): mensagem de orientação, não de erro.
    // Enquanto está preenchido, distância/pedágio/piso são manuais e a cotação fecha.
    const [freteUrbano, setFreteUrbano] = useState<string | null>(null);
    // --- Modo TABELADO: frete já fechado por contrato, lançado ao contrário ---
    // Não consulta o Qualp em momento nenhum (zero crédito). O operador informa o
    // valor final e a margem pretendida; a engine devolve quanto sobra pro motorista.
    const [modoTabelado, setModoTabelado] = useState(false);
    const [valorFinalTabelado, setValorFinalTabelado] = useState<string>('0');
    // ICMS do tabelado é manual: não usa a regra automática por estado.
    const [temIcmsTabelado, setTemIcmsTabelado] = useState(false);
    // Piso da cotação já salva: mantido como está até o operador mandar recalcular.
    // Antes/depois do recálculo de uma cotação salva, pra ninguém fechar achando
    // que o número é o antigo.
    const [recalcDiff, setRecalcDiff] = useState<{
        kmAntes: number; kmDepois: number; pedAntes: number; pedDepois: number;
        pisoAntes: number | null; pisoDepois: number | null;
    } | null>(null);
    // Pedágio é read-only enquanto vier do Qualp; o operador libera pra sobrescrever.
    const [pedagioLiberado, setPedagioLiberado] = useState(false);
    const [extraCosts, setExtraCosts] = useState<string>('0');
    const [extraCostsDescription, setExtraCostsDescription] = useState('');
    const [otherCosts, setOtherCosts] = useState<ExtraCostItem[]>([]);
    const [goodsValue, setGoodsValue] = useState<string>('0');
    const [insurancePercent, setInsurancePercent] = useState<string>('0.2');
    const [profitMargin, setProfitMargin] = useState<string>('15');
    const [icmsPercent, setIcmsPercent] = useState<string>('12');
    // Trava do ICMS manual: quando o operador digita o ICMS na mão, o automático para de sobrescrever.
    const [icmsManual, setIcmsManual] = useState(false);
    // Pagador é de MG? (só aparece quando a origem é MG; alimenta a isenção da regra 2)
    const [pagadorMg, setPagadorMg] = useState(false);
    // Rota (origem|destino|pagadorMg) da cotação salva recém-aberta. Enquanto a rota não mudar, o ICMS
    // salvo é preservado (não recalcula o passado). null = cotação nova/edição já iniciada -> recalcula normal.
    const loadedIcmsRouteRef = useRef<string | null>(null);
    // Assinatura (veículo|km) de uma cotação UTILITÁRIA salva recém-aberta: enquanto não mudar, o preço
    // base salvo é preservado (não sobrescreve com km×tarifa). Congela o base na reabertura, igual ao ICMS.
    const loadedUtilRef = useRef<string | null>(null);
    const [loadingDistance, setLoadingDistance] = useState(false);
    const [disponibilidade, setDisponibilidade] = useState<Disponibilidade>("Imediato");
    const [merchandiseType, setMerchandiseType] = useState('');
    const [cargoType, setCargoType] = useState<string>('Carga geral'); // Tipo de carga Tabela A (ANTT)
    const [newIcmsRate, setNewIcmsRate] = useState('');
    const [icmsSearch, setIcmsSearch] = useState('');
    const [icmsOriginFilter, setIcmsOriginFilter] = useState('');
    const [icmsDestFilter, setIcmsDestFilter] = useState('');

    // Cronômetro de elaboração (inicia ao digitar; persiste no registro)
    const [elapsedSeconds, setElapsedSeconds] = useState(0);
    const [isTimerRunning, setIsTimerRunning] = useState(false);

    // Modal de validação de margem (limiar configurável)
    const [showMarginModal, setShowMarginModal] = useState(false);
    const [pendingSaveStatus, setPendingSaveStatus] = useState<QuoteStatus | null>(null);
    const [pendingStayOnForm, setPendingStayOnForm] = useState(false);

    // Abrir composição de custo ao cliente (cópia/PDF)
    const [openCostToClient, setOpenCostToClient] = useState(false);

    // Solicitante: agora via autocomplete do Pipefy (nome + id do registro). Texto livre = sem id.
    const [solicitante, setSolicitante] = useState('');
    const [solicitantePipefyId, setSolicitantePipefyId] = useState<string | undefined>(undefined);
    // Implemento (espelha o select do Pipefy). Flui pra carga fechada e pro card como carroceriaTipoOperacao.
    const [implemento, setImplemento] = useState('');

    // Modal pós-salvar (Mandar pro Ramper / Nova Cotação / Ver Histórico)
    const [showPostSaveModal, setShowPostSaveModal] = useState(false);
    const [ramperSending, setRamperSending] = useState(false);
    // Trava anti-duplicação do salvar: estado (desabilita o botão) + ref (guarda de reentrância
    // síncrona, pega clique repetido antes do re-render). Ver saveQuote.
    const [savingQuote, setSavingQuote] = useState(false);
    const savingQuoteRef = useRef(false);
    // Anti-ruído da auditoria: guarda a assinatura do último diff gravado p/ não logar o MESMO
    // conjunto de mudanças duas vezes (double-save/re-render) numa janela curta.
    const lastAuditRef = useRef<{ sig: string; at: number } | null>(null);
    // Última cotação salva: fonte da verdade pro card do Ramper (data de criação + valores gravados).
    const [lastSavedQuote, setLastSavedQuote] = useState<FreightCalculation | null>(null);
    // Já mandou esta cotação pro Ramper nesta sessão? Só muda o rótulo do botão
    // (e exige confirmação extra), pra reenvio ser escolha e não acidente.
    const [enviadoRamper, setEnviadoRamper] = useState(false);
    // Modal do histórico de auditoria (só master): cotação alvo + registros carregados.
    const [auditQuote, setAuditQuote] = useState<FreightCalculation | null>(null);
    const [auditLog, setAuditLog] = useState<AlteracaoCotacao[] | null>(null);
    const abrirAuditoria = async (q: FreightCalculation) => { setAuditQuote(q); setAuditLog(null); setAuditLog(await getAlteracoes(q.id)); };

    // Importar Solicitação (leitura inteligente via Gemini)
    const [showImportModal, setShowImportModal] = useState(false);
    const [importText, setImportText] = useState('');
    const [importFile, setImportFile] = useState<{ name: string; base64: string; type: string } | null>(null);
    const [importLoading, setImportLoading] = useState(false);
    const [importSummary, setImportSummary] = useState<{ label: string; value: string; filled: boolean }[] | null>(null);

    // Novo estado para usuários e veículos
    const [newUserForm, setNewUserForm] = useState<Partial<User>>({ name: '', username: '', password: '', role: 'operador' });
    const [newVehicleName, setNewVehicleName] = useState('');

    // Carrega os dados só DEPOIS de autenticar (necessário p/ RLS: leitura exige sessão).
    useEffect(() => {
        if (currentUser?.id) loadAllData();
    }, [currentUser?.id]);

    // --- SESSÃO SUPABASE AUTH ---
    // Mantém "Carregando" até o perfil resolver (evita flash da tela de login no F5).
    // O getProfile é adiado com setTimeout(0) para NÃO rodar dentro do callback do
    // onAuthStateChange (evita o deadlock do lock interno do auth).
    useEffect(() => {
        let mounted = true;
        // Convite/recuperação: o link do e-mail traz type=invite|recovery no hash.
        const hash = window.location.hash || '';
        if (hash.includes('type=invite') || hash.includes('type=recovery')) setRecoveryMode(true);
        const resolveSession = (session: any) => {
            if (!session?.user) {
                if (mounted) { setCurrentUser(null); setAuthLoading(false); }
                return;
            }
            setTimeout(async () => {
                const profile = await getProfile(session.user.id);
                if (!mounted) return;
                // Usuário desativado: encerra a sessão e bloqueia o acesso (sem apagar nada).
                if (profile && profile.active === false) {
                    await supabase.auth.signOut();
                    setCurrentUser(null); setAuthLoading(false);
                    showFeedback('Acesso desativado. Fale com o administrador.', 'error');
                    return;
                }
                setMustChangePwd(!!profile?.must_change_password); // 1º acesso: força troca da senha temporária
                setCurrentUser({
                    id: session.user.id,
                    name: profile?.name || session.user.email || 'Usuário',
                    username: profile?.email || session.user.email || '',
                    role: (profile?.role as UserRole) || 'operador',
                });
                getProfiles().then(list => { if (mounted) setUsers(list); });
                setAuthLoading(false);
            }, 0);
        };
        supabase.auth.getSession().then(({ data }) => resolveSession(data.session));
        const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
            if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true);
            resolveSession(session);
        });
        return () => { mounted = false; sub.subscription.unsubscribe(); };
    }, []);

    // Define a senha do usuário convidado/recuperando e entra na plataforma.
    const handleSetPassword = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (newPassword.trim().length < 6) { showFeedback('A senha deve ter ao menos 6 caracteres.', 'error'); return; }
        setSavingPassword(true);
        try {
            const { error } = await supabase.auth.updateUser({ password: newPassword });
            if (error) { showFeedback(`Erro ao definir senha: ${error.message}`, 'error'); return; }
            setNewPassword('');
            setRecoveryMode(false);
            window.history.replaceState(null, '', window.location.pathname);
            showFeedback('Senha definida! Bem-vindo.');
        } finally {
            setSavingPassword(false);
        }
    };

    // Troca OBRIGATÓRIA no 1º acesso: troca a senha temporária e limpa a flag no perfil.
    const handleForcedPasswordChange = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (newPassword.trim().length < 6) { showFeedback('A senha deve ter ao menos 6 caracteres.', 'error'); return; }
        setSavingPassword(true);
        try {
            const { error } = await supabase.auth.updateUser({ password: newPassword });
            if (error) { showFeedback(`Erro ao definir senha: ${error.message}`, 'error'); return; }
            await finishPasswordChange();      // limpa must_change_password do próprio perfil
            setNewPassword('');
            setMustChangePwd(false);
            showFeedback('Senha definida! Você já pode usar o sistema.');
        } finally {
            setSavingPassword(false);
        }
    };

    // Troca de senha do usuário logado (ex.: trocar a senha temporária no 1º acesso).
    const handleChangePassword = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (newPassword.trim().length < 6) { showFeedback('A senha deve ter ao menos 6 caracteres.', 'error'); return; }
        setSavingPassword(true);
        try {
            const { error } = await supabase.auth.updateUser({ password: newPassword });
            if (error) { showFeedback(`Erro ao trocar senha: ${error.message}`, 'error'); return; }
            setNewPassword('');
            setShowChangePassword(false);
            showFeedback('Senha atualizada com sucesso!');
        } finally {
            setSavingPassword(false);
        }
    };

    const loadAllData = async () => {
        try {
            // profiles é carregado após a autenticação (RLS exige sessão) — ver applySession.
            const customersData = await getCustomers();
            setCustomers(customersData.length > 0 ? customersData : INITIAL_CUSTOMERS);
            // Limpeza automática da lixeira: ao abrir o sistema, apaga
            // definitivamente o que foi excluído em dias anteriores.
            const purged = await purgeOldTrash();
            if (purged > 0) console.log(`Lixeira: ${purged} cotação(ões) de dias anteriores removida(s) definitivamente.`);
            const historyData = await getFreightCalculations();
            setHistory(historyData);
            const trashData = await getDeletedFreightCalculations();
            setTrash(trashData);
            setFaturamento(await getFaturamentoCache());
            setPainelTvToken(await getPainelTvToken());
            const configData = await getSystemConfig();
            if (configData) {
                setFedTaxes(configData);
                if (configData.spotStats) setSpotStats(configData.spotStats);
            }
            const vehiclesData = await getVehicleConfigs();
            // Mescla defaults com o que vem do banco: garante que veículos novos (ex.: Bitruck)
            // apareçam mesmo quando o banco já tem configs; valores do banco têm prioridade.
            setVehicleConfigs({ ...VEHICLE_CONFIGS, ...vehiclesData });
        } catch (error) {
            console.error('Erro ao carregar dados:', error);
            showFeedback('Erro ao carregar dados do banco.', 'error');
        }
    };

    // --- REALTIME SUBSCRIPTIONS ---
    useEffect(() => {
        console.log('--- Real-Time Collaboration: Starting Subscriptions ---');

        const channel = supabase
            .channel('db-changes-unified')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'freight_calculations' }, (payload) => {
                console.log('Real-Time Update: freight_calculations', payload.eventType);
                getFreightCalculations().then(data => {
                    setHistory(data);
                    // Force refresh if editing to prevent stale data
                    if (editingId && payload.eventType === 'UPDATE' && (payload.new as any).id === editingId) {
                        showFeedback("Este registro foi alterado por outro usuário.");
                    }
                });
                // Mantém a lixeira em sincronia (soft delete/restore chegam como UPDATE).
                getDeletedFreightCalculations().then(setTrash);
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'customers' }, () => {
                console.log('Real-Time Update: customers');
                getCustomers().then(data => setCustomers(data.length > 0 ? data : INITIAL_CUSTOMERS));
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'system_config' }, () => {
                console.log('Real-Time Update: system_config');
                getSystemConfig().then(data => {
                    if (data) {
                        setFedTaxes(data);
                        if (data.spotStats) setSpotStats(data.spotStats);
                    }
                });
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
                console.log('Real-Time Update: profiles');
                getProfiles().then(setUsers);
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_configs' }, () => {
                console.log('Real-Time Update: vehicle_configs');
                getVehicleConfigs().then(data => setVehicleConfigs({ ...VEHICLE_CONFIGS, ...data }));
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'faturamento_cache' }, () => {
                console.log('Real-Time Update: faturamento_cache');
                getFaturamentoCache().then(setFaturamento);
            })
            .subscribe((status) => {
                console.log('Supabase Realtime Status:', status);
                if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    // Suppress frequent connection error alerts to avoid "every time" annoyance
                    // Intervalo mínimo entre alertas: 5 minutos.
                    const lastAlert = sessionStorage.getItem('last_connection_alert');
                    const now = Date.now();
                    if (!lastAlert || (now - parseInt(lastAlert)) > 300000) {
                        showFeedback('Erro na conexão em tempo real. Tentando reconectar...', 'error');
                        sessionStorage.setItem('last_connection_alert', now.toString());
                    }
                }
            });

        return () => {
            console.log('Cleaning up Real-Time subscriptions');
            supabase.removeChannel(channel);
        };
    }, []);

    // spotStats persistence moved to database service

    const num = (s: string | number | undefined | null) => {
        if (s === undefined || s === null) return 0;
        if (typeof s === 'number') return s;
        // Remove R$, whitespace, and dots used as thousands separators. Replace comma with dot for decimal.
        const clean = s.replace(/R\$\s?/, '').replace(/\./g, '').replace(',', '.').trim();
        return parseFloat(clean) || 0;
    };

    const maskCurrency = (val: string | number) => {
        let value = typeof val === 'number' ? val.toFixed(2) : val;
        value = value.replace(/\D/g, '');
        const numberValue = parseInt(value) / 100;
        if (isNaN(numberValue)) return 'R$ 0,00';
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL',
        }).format(numberValue);
    };

    useEffect(() => {
        if (appLogo) localStorage.setItem('flow_app_logo', appLogo);
        else localStorage.removeItem('flow_app_logo');
    }, [appLogo]);

    // Sessão é gerida pelo Supabase Auth (não persistimos o usuário em localStorage).

    useEffect(() => {
        if (toast) {
            const timer = setTimeout(() => setToast(null), 4000);
            return () => clearTimeout(timer);
        }
    }, [toast]);

    // Contagem elegante do valor do frete na tela "Venda Fechada": sobe de 0 ao valor com ease-out
    // suave (~1,1s). Sem exagero. Zera quando a tela fecha.
    useEffect(() => {
        if (!showCelebration || celebrationValue <= 0) { setCelebCount(showCelebration ? celebrationValue : 0); return; }
        let raf = 0;
        const dur = 1100, start = performance.now();
        const tick = (now: number) => {
            const t = Math.min(1, (now - start) / dur);
            const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
            setCelebCount(celebrationValue * eased);
            if (t < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [showCelebration, celebrationValue]);

    // Cronômetro: incrementa a cada segundo enquanto estiver rodando
    useEffect(() => {
        if (!isTimerRunning) return;
        const t = setInterval(() => setElapsedSeconds(s => s + 1), 1000);
        return () => clearInterval(t);
    }, [isTimerRunning]);

    // Inicia o cronômetro na primeira digitação de uma nova cotação
    const startTimer = () => {
        if (!isTimerRunning && !editingId) setIsTimerRunning(true);
    };

    const formatElapsed = (total: number) => {
        const s = Math.max(0, Math.floor(total || 0));
        const m = Math.floor(s / 60);
        const r = s % 60;
        return `${m.toString().padStart(2, '0')}:${r.toString().padStart(2, '0')}`;
    };

    // Limiar de margem para o modal de confirmação (configurável, padrão 15%)
    const marginThreshold = fedTaxes.marginThreshold ?? 15;

    // Rebaixamento de Ganha: uma cotação reaberta que já é Ganha está ligada à operação (Pipefy) e ao
    // faturamento. Rebaixá-la (pra Pauta OU pra Perdida) é AÇÃO só de master, sempre com confirmação.
    // O operador não rebaixa uma Ganha. Cotação em Pauta segue com os botões livres pra todos.
    const cotacaoGanhaReaberta = !!editingId && history.find(h => h.id === editingId)?.status === 'won';
    const podeRebaixarGanha = cotacaoGanhaReaberta && currentUser?.role === 'master';



    // ICMS automático: aplica a tabela por rota.
    // - Ajuste manual (icmsManual) nunca é sobrescrito pelo automático.
    // - Cotação salva recém-aberta: enquanto a rota (origem|destino|pagadorMg) não mudar, preserva o
    //   ICMS salvo (não recalcula o passado). Ao mudar origem/destino, recalcula pela rota nova.
    // - Modo tabelado: o ICMS é declarado à mão (checkbox + alíquota), então a
    //   regra automática por estado NÃO roda — senão sobrescreveria o que o
    //   operador digitou toda vez que a rota mudasse.
    useEffect(() => {
        if (icmsManual || modoTabelado) return;
        const routeKey = `${origin}|${destination}|${pagadorMg}`;
        if (loadedIcmsRouteRef.current !== null && loadedIcmsRouteRef.current === routeKey) return; // rota da cotação salva inalterada
        loadedIcmsRouteRef.current = null; // a partir daqui é edição do usuário: recalcula normalmente
        const orgUF = getUF(origin);
        const dstUF = getUF(destination);
        if (orgUF && dstUF) {
            const rate = getIcmsRate(orgUF, dstUF, fedTaxes.icmsRates, orgUF === 'MG' && pagadorMg);
            setIcmsPercent(rate.toString());
        }
    }, [origin, destination, fedTaxes.icmsRates, pagadorMg, icmsManual, modoTabelado]);

    // Login via Supabase Auth (e-mail + senha). A sessão e o papel são definidos pelo onAuthStateChange.
    const handleLogin = async (e?: React.FormEvent | React.MouseEvent) => {
        if (e) e.preventDefault();
        if (loginSubmitting) return;
        setLoginSubmitting(true);
        try {
            const { error } = await supabase.auth.signInWithPassword({
                email: loginForm.username.trim(),
                password: loginForm.password,
            });
            if (error) {
                console.warn('Login failed:', error.message);
                showFeedback("E-mail ou senha incorretos.", "error");
            } else {
                setLoginForm({ username: '', password: '' });
                showFeedback("Bem-vindo!");
            }
        } catch (err: any) {
            showFeedback(`Falha no login: ${err.message}`, "error");
        } finally {
            setLoginSubmitting(false);
        }
    };

    const handleLogout = async () => {
        await supabase.auth.signOut();
        setCurrentUser(null);
        setLoginForm({ username: '', password: '' });
        setShowConfigModal(false);
    };

    const formatCur = (val: number | undefined | null) => {
        if (val === undefined || val === null || isNaN(val)) return '0,00';
        return val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    const showFeedback = (message: string, type: 'success' | 'info' | 'error' = 'success') => setToast({ message, type });

    const handleUpdateFedTaxes = async (key: keyof FederalTaxes, value: number) => {
        const newTaxes = { ...fedTaxes, [key]: value };
        setFedTaxes(newTaxes);
        try {
            await updateSystemConfig(newTaxes);
            showFeedback("Imposto atualizado!");
        } catch (e) {
            showFeedback("Erro ao salvar imposto.", "error");
        }
    };

    const handleUpdateIcmsRates = async (rates: Record<string, number>) => {
        const updated = { ...fedTaxes, icmsRates: rates };
        setFedTaxes(updated);
        await updateSystemConfig(updated);
        showFeedback('Alíquotas ICMS atualizadas.', 'success');
    };

    const handleUpdateGoals = async (month: string, value: number) => {
        const currentGoals = fedTaxes.goals || {};
        const newGoals = { ...currentGoals, [month]: value };
        const newTaxes = { ...fedTaxes, goals: newGoals };
        setFedTaxes(newTaxes);
        try {
            await updateSystemConfig(newTaxes);
        } catch (e) {
            console.error(e);
            showFeedback("Erro ao salvar meta.", "error");
        }
    };

    const handleUpdateVehicleConfig = async (name: string, config: ANTTCoefficients & { factor?: number; axles?: number; capacity?: number; consumption?: number }) => {
        const newConfigs = { ...vehicleConfigs, [name]: config };
        setVehicleConfigs(newConfigs);
        try {
            await upsertVehicleConfig(name, config);
            showFeedback("Configuração de veículo salva!");
        } catch (e) {
            showFeedback("Erro ao salvar veículo.", "error");
        }
    };

    const handleDeleteVehicleConfig = async (name: string) => {
        const { [name]: removed, ...rest } = vehicleConfigs;
        setVehicleConfigs(rest);
        try {
            await deleteVehicleConfig(name);
            showFeedback("Veículo removido!");
        } catch (e) {
            showFeedback("Erro ao remover veículo.", "error");
        }
    };

    const filteredHistory = useMemo(() => {
        if (!searchQuery.trim()) return history;
        const q = searchQuery.toLowerCase();
        return history.filter(h => {
            const customerName = customers.find(c => c.id === h.customerId)?.name.toLowerCase() || '';
            return (
                h.proposalNumber.toLowerCase().includes(q) ||
                h.origin.toLowerCase().includes(q) ||
                h.destination.toLowerCase().includes(q) ||
                (h.clientReference && h.clientReference.toLowerCase().includes(q)) ||
                customerName.includes(q)
            );
        });
    }, [history, searchQuery, customers]);

    /* Lógica do Dashboard Analítico Multi-Filtro */
    // Insights determinísticos do dia/30d (mesma fonte do relatório do WhatsApp).
    const insights = useMemo(() => computeDashboardInsights(history, customers, Date.now()), [history, customers]);

    const dashboardData = useMemo(() => {
        const filteredHistory = history.filter(h => {
            const dateObj = h.updatedAt ? new Date(h.updatedAt) : new Date(h.createdAt);
            if (isNaN(dateObj.getTime())) return false;
            return dateObj.toISOString().slice(0, 7) === selectedMonth;
        });

        const wonQuotes = filteredHistory.filter(h => h.status === 'won');

        const totalWon = wonQuotes.reduce((acc, curr) => acc + (curr.totalFreight || 0), 0);
        const totalPending = filteredHistory.filter(h => h.status === 'pending').reduce((acc, curr) => acc + (curr.totalFreight || 0), 0);

        const countWon = wonQuotes.length;
        const countLost = filteredHistory.filter(h => h.status === 'lost').length;
        const countPending = filteredHistory.filter(h => h.status === 'pending').length;

        // Cálculos de Lucratividade
        let totalProfit = 0;
        let sumMargins = 0;
        let totalWeight = 0;
        let totalKm = 0;

        wonQuotes.forEach(h => {
            const icmsAmt = h.totalFreight * (h.icmsPercent / 100);
            const fedAmt = h.totalFreight * ((h.pisPercent + h.cofinsPercent + h.csllPercent + h.irpjPercent) / 100);
            const directCosts = h.baseFreight + h.tolls + (h.extraCosts || 0);
            const profit = h.totalFreight - icmsAmt - fedAmt - directCosts - (h.adValorem || 0);
            const margin = h.totalFreight > 0 ? (profit / h.totalFreight) * 100 : 0;

            totalProfit += profit;
            sumMargins += margin;
            totalWeight += (h.weight || 0);
            totalKm += (h.distanceKm || 0);
        });

        const avgMargin = countWon > 0 ? sumMargins / countWon : 0;

        // Agrupamento por Cliente
        const clientMap = new Map<string, number>();
        wonQuotes.filter(h => h.customerId).forEach(h => {
            clientMap.set(h.customerId, (clientMap.get(h.customerId) || 0) + h.totalFreight);
        });
        const topClients = Array.from(clientMap.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([id, value]) => {
                const customer = customers.find(c => c.id === id);
                return { name: customer?.name || 'Desconhecido', value, logo: customer?.logoUrl };
            });

        // Agrupamento por Veículo
        const vehicleMap = new Map<string, number>();
        wonQuotes.forEach(h => {
            vehicleMap.set(h.vehicleType, (vehicleMap.get(h.vehicleType) || 0) + h.totalFreight);
        });
        const topVehicles = Array.from(vehicleMap.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([name, value]) => ({ name, value }));

        // Melhores Rotas
        const routeMap = new Map<string, number>();
        wonQuotes.forEach(h => {
            const route = `${(h.origin || '').split(',')[0]} ➝ ${(h.destination || '').split(',')[0]}`;
            routeMap.set(route, (routeMap.get(route) || 0) + h.totalFreight);
        });
        const topRoutes = Array.from(routeMap.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([name, value]) => ({ name, value }));

        return {
            totalWon, totalPending,
            countWon, countLost, countPending,
            totalProfit, avgMargin, totalWeight, totalKm,
            topClients, topVehicles, topRoutes,
            filteredCount: filteredHistory.length
        };
    }, [history, customers, selectedMonth]);

    // ===== Relatório diário (números determinísticos, calculados do histórico) =====
    const formatMin = (sec: number) => {
        const s = Math.max(0, Math.round(sec || 0));
        const m = Math.floor(s / 60);
        const r = s % 60;
        return `${m}m ${r.toString().padStart(2, '0')}s`;
    };

    const getReportRange = (preset: string, now: number) => {
        const d = new Date(now);
        const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        const DAY = 86400000;
        let start: number, end: number, label: string;
        switch (preset) {
            case 'ontem': start = startOfDay - DAY; end = startOfDay; label = 'Ontem'; break;
            case '7d': end = now; start = now - 7 * DAY; label = 'Últimos 7 dias'; break;
            case '30d': end = now; start = now - 30 * DAY; label = 'Últimos 30 dias'; break;
            case 'mes': start = new Date(d.getFullYear(), d.getMonth(), 1).getTime(); end = now; label = 'Este mês'; break;
            case 'hoje': default: start = startOfDay; end = startOfDay + DAY; label = 'Hoje'; break;
        }
        return { start, end, prevStart: start - (end - start), prevEnd: start, label };
    };

    const generateReport = () => {
        const now = Date.now();
        const { start, end, prevStart, prevEnd, label } = getReportRange(reportPreset, now);
        const tsOf = (h: FreightCalculation) => Number(h.createdAt) || 0;
        const inRange = history.filter(h => { const t = tsOf(h); return t >= start && t < end; });
        const prevRange = history.filter(h => { const t = tsOf(h); return t >= prevStart && t < prevEnd; });
        const custName = (id: string) => customers.find(c => c.id === id)?.name || 'Sem cliente';

        // Top clientes (qtd de cotações + valor cotado no período)
        const clientMap = new Map<string, { count: number; value: number }>();
        inRange.forEach(h => {
            const k = h.customerId || '';
            const cur = clientMap.get(k) || { count: 0, value: 0 };
            cur.count += 1;
            cur.value += Number(h.totalFreight) || 0;
            clientMap.set(k, cur);
        });
        const topClients = Array.from(clientMap.entries()).map(([id, v]) => ({ name: custName(id), count: v.count, value: v.value }))
            .sort((a, b) => b.count - a.count).slice(0, 6);

        // Valor financeiro total cotado no período (soma do frete final). Não altera fórmula.
        const totalValue = inRange.reduce((a, h) => a + (Number(h.totalFreight) || 0), 0);
        const prevValue = prevRange.reduce((a, h) => a + (Number(h.totalFreight) || 0), 0);

        // Veículos cotados no período (ranking por tipo) + valor cotado por tipo
        const vehicleMap = new Map<string, { count: number; value: number }>();
        inRange.forEach(h => {
            const v = (h.vehicleType || '—').toString();
            const cur = vehicleMap.get(v) || { count: 0, value: 0 };
            cur.count += 1;
            cur.value += Number(h.totalFreight) || 0;
            vehicleMap.set(v, cur);
        });
        const topVehicles = Array.from(vehicleMap.entries()).map(([name, v]) => ({ name, count: v.count, value: v.value }))
            .sort((a, b) => b.count - a.count);

        // Rotas mais quentes (origem → destino final). Multidestino usa o último destino.
        const routeLabel = (h: any) => {
            const o = (h.origin || '').toString().trim();
            const ds = Array.isArray(h.destinations) && h.destinations.length ? h.destinations[h.destinations.length - 1] : h.destination;
            const d = (ds || '').toString().trim();
            return `${o || '—'} → ${d || '—'}`;
        };
        const routeMap = new Map<string, { count: number; value: number }>();
        inRange.forEach(h => {
            const r = routeLabel(h);
            const cur = routeMap.get(r) || { count: 0, value: 0 };
            cur.count += 1;
            cur.value += Number(h.totalFreight) || 0;
            routeMap.set(r, cur);
        });
        const topRoutes = Array.from(routeMap.entries()).map(([name, v]) => ({ name, count: v.count, value: v.value }))
            .sort((a, b) => b.count - a.count).slice(0, 6);

        // Ranking de operadores (quem mais cotou) + tempo médio por operador (só tempo > 0)
        const opMap = new Map<string, { count: number; timeSum: number; timed: number }>();
        inRange.forEach(h => {
            const op = h.createdByName || h.updatedByName || '—';
            const cur = opMap.get(op) || { count: 0, timeSum: 0, timed: 0 };
            cur.count += 1;
            const sec = Number(h.elaborationSeconds) || 0;
            if (sec > 0) { cur.timeSum += sec; cur.timed += 1; }
            opMap.set(op, cur);
        });
        const operators = Array.from(opMap.entries()).map(([name, v]) => ({ name, count: v.count, avgSec: v.timed > 0 ? v.timeSum / v.timed : 0, timed: v.timed }))
            .sort((a, b) => b.count - a.count);

        // Tempo médio geral (só cotações com tempo > 0)
        const timed = inRange.filter(h => (Number(h.elaborationSeconds) || 0) > 0);
        const avgSec = timed.length ? timed.reduce((a, h) => a + Number(h.elaborationSeconds), 0) / timed.length : 0;

        // Variação de volume vs período anterior
        const total = inRange.length;
        const prevTotal = prevRange.length;
        const variation = prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 100) : (total > 0 ? 100 : 0);

        // ---- Insights por regras (sem IA) ----
        const insights: string[] = [];

        // 1) Cliente recorrente (>=3 cotações no total) sem cotar há > 7 dias
        const histByClient = new Map<string, number[]>();
        history.forEach(h => { if (h.customerId) { const arr = histByClient.get(h.customerId) || []; arr.push(tsOf(h)); histByClient.set(h.customerId, arr); } });
        const sleeping: { name: string; days: number }[] = [];
        histByClient.forEach((times, id) => {
            if (times.length >= 3) {
                const last = Math.max(...times);
                const days = Math.floor((now - last) / 86400000);
                if (days > 7) sleeping.push({ name: custName(id), days });
            }
        });
        sleeping.sort((a, b) => b.days - a.days);
        sleeping.slice(0, 3).forEach(s => insights.push(`Cliente recorrente sem cotar há ${s.days} dias: ${s.name}.`));

        // 2) Variação de volume
        if (prevTotal > 0) {
            const dir = variation > 0 ? 'acima' : variation < 0 ? 'abaixo' : 'igual ao';
            insights.push(`Volume ${variation === 0 ? '' : Math.abs(variation) + '% '}${dir} do período anterior (${total} vs ${prevTotal}).`);
        }

        // 3) Operador com tempo médio acima/abaixo da média do time
        const timedOps = operators.filter(o => o.timed > 0);
        if (timedOps.length >= 2) {
            const teamAvg = timedOps.reduce((a, o) => a + o.avgSec, 0) / timedOps.length;
            timedOps.forEach(o => {
                const diff = teamAvg > 0 ? (o.avgSec - teamAvg) / teamAvg : 0;
                if (diff >= 0.25) insights.push(`${o.name} está com tempo médio ${Math.round(diff * 100)}% acima da média do time (${formatMin(o.avgSec)}).`);
                else if (diff <= -0.25) insights.push(`${o.name} está com tempo médio ${Math.round(Math.abs(diff) * 100)}% abaixo da média do time (${formatMin(o.avgSec)}).`);
            });
        }

        // Mesmas métricas determinísticas do dashboard (dia/30d) — pro relatório do WhatsApp.
        const painel = computeDashboardInsights(history, customers, now);

        setReportText('');
        setDailyReport({ label, total, prevTotal, variation, totalValue, prevValue, avgSec, topClients, topVehicles, topRoutes, operators, insights, painel, generatedAt: now });
    };

    // Resumo (números prontos) enviado à IA — ela só escreve o texto, não calcula.
    const buildReportSummary = (r: any) => ({
        label: r.label,
        total: r.total,
        prevTotal: r.prevTotal,
        variation: r.variation,
        totalValue: `R$ ${formatCur(r.totalValue || 0)}`,
        avgTime: r.avgSec > 0 ? formatMin(r.avgSec) : '—',
        topClients: r.topClients.slice(0, 5).map((c: any) => ({ name: c.name, count: c.count, value: `R$ ${formatCur(c.value || 0)}` })),
        topVehicles: (r.topVehicles || []).slice(0, 5).map((v: any) => ({ name: v.name, count: v.count })),
        topRoutes: (r.topRoutes || []).slice(0, 5).map((rt: any) => ({ name: rt.name, count: rt.count })),
        topOperators: r.operators.slice(0, 5).map((o: any) => ({ name: o.name, count: o.count, avgTime: o.timed > 0 ? formatMin(o.avgSec) : '—' })),
        insights: r.insights,
        // Painel do dia (mesma fonte do dashboard). Fechada = enviada pro Pipefy.
        hoje: r.painel ? { cotadas: r.painel.hoje.cotadas, fechadas: r.painel.hoje.fechadas, conversao: r.painel.hoje.conversao } : null,
        melhorAderencia: r.painel?.melhorAderencia ? { nome: r.painel.melhorAderencia.nome, conv: r.painel.melhorAderencia.conv, fechadas: r.painel.melhorAderencia.fechadas, cotadas: r.painel.melhorAderencia.cotadas } : null,
        cotaMuitoFechaPouco: r.painel?.cotaMuitoFechaPouco ? { nome: r.painel.cotaMuitoFechaPouco.nome, conv: r.painel.cotaMuitoFechaPouco.conv, cotadas: r.painel.cotaMuitoFechaPouco.cotadas } : null,
        naoCotaramHoje: (r.painel?.naoCotaramHoje || []).slice(0, 6).map((c: any) => c.name),
    });

    // Fallback de última instância (se a própria chamada à função falhar) — texto-modelo no cliente.
    // Mesma redação em frases corridas do fallback do servidor; números entram exatamente como vêm.
    const buildReportTemplateClient = (s: any): string => {
        const joinNat = (arr: string[]) => arr.length <= 1 ? (arr[0] || '') : arr.slice(0, -1).join(', ') + ' e ' + arr[arr.length - 1];
        const paras: string[] = [];
        paras.push(`📊 Relatório de cotações — ${s.label || 'período'}`);

        const abertura: string[] = [];
        let l1 = `Fechamos o período com ${s.total ?? 0} cotação(ões)`;
        if (typeof s.variation === 'number' && s.variation !== 0) l1 += `, ${Math.abs(s.variation)}% ${s.variation > 0 ? 'acima' : 'abaixo'} do período anterior`;
        else if (s.variation === 0) l1 += `, no mesmo ritmo do período anterior`;
        abertura.push(l1 + '.');
        if (s.totalValue) abertura.push(`No total, ${s.totalValue} em frete cotado.`);
        if (s.avgTime && s.avgTime !== '—') abertura.push(`O tempo médio pra montar uma cotação ficou em ${s.avgTime}.`);
        paras.push(abertura.join(' '));

        const mov: string[] = [];
        if (s.topClients?.length) mov.push(`Quem mais movimentou foi ${joinNat(s.topClients.slice(0, 3).map((c: any) => `${c.name} (${c.count}${c.value ? `, ${c.value}` : ''})`))}.`);
        if (s.topVehicles?.length) mov.push(`Nos veículos, a procura veio principalmente de ${joinNat(s.topVehicles.slice(0, 4).map((v: any) => `${v.name} (${v.count})`))}.`);
        if (s.topRoutes?.length) mov.push(`As rotas mais quentes foram ${joinNat(s.topRoutes.slice(0, 3).map((rt: any) => `${rt.name} (${rt.count})`))}.`);
        if (mov.length) paras.push(mov.join(' '));

        const dia: string[] = [];
        if (s.hoje) dia.push(`Hoje saíram ${s.hoje.cotadas} cotações e ${s.hoje.fechadas} fecharam, ${s.hoje.conversao}% de conversão.`);
        if (s.topOperators?.length) { const o = s.topOperators[0]; dia.push(`No volume, ${o.name} foi quem mais cotou (${o.count})${o.avgTime && o.avgTime !== '—' ? `, com média de ${o.avgTime} por cotação` : ''}.`); }
        if (s.melhorAderencia) dia.push(`Na conversão, ${s.melhorAderencia.nome} se destacou com ${s.melhorAderencia.conv}% (${s.melhorAderencia.fechadas}/${s.melhorAderencia.cotadas}).`);
        if (s.cotaMuitoFechaPouco) dia.push(`Vale acompanhar de perto ${s.cotaMuitoFechaPouco.nome}, que cotou bastante (${s.cotaMuitoFechaPouco.cotadas}) e fechou ${s.cotaMuitoFechaPouco.conv}% — pode ter algo travando o fechamento.`);
        if (s.naoCotaramHoje?.length) dia.push(`Ainda não cotaram hoje: ${s.naoCotaramHoje.slice(0, 5).join(', ')} — vale uma chamada.`);
        if (dia.length) paras.push(dia.join(' '));

        if (s.insights?.length) paras.push(`⚠️ De olho: ${s.insights.slice(0, 4).join(' ')}`);
        return paras.join('\n\n');
    };

    const handleCompileText = async () => {
        if (!dailyReport) return;
        setReportTextLoading(true);
        try {
            const summary = buildReportSummary(dailyReport);
            const res = await compileReportText(summary);
            if (res?.text) {
                setReportText(res.text);
                showFeedback(res.source === 'ai' ? 'Texto compilado pela IA!' : 'Texto gerado (modelo — IA indisponível).', res.source === 'ai' ? 'success' : 'info');
            } else {
                setReportText(buildReportTemplateClient(summary));
                showFeedback('Texto gerado (modelo — IA indisponível).', 'info');
            }
        } finally {
            setReportTextLoading(false);
        }
    };

    const handleCRMStatusUpdate = async (id: string, newStatus: QuoteStatus, lostData?: { reason: any; obs: string; fileUrl: string }) => {
        const quote = history.find(h => h.id === id);
        if (!quote) return;

        if (newStatus === 'won') {
            openWonModal(quote);
            return;
        }

        const updatedQuote: FreightCalculation = {
            ...quote,
            status: newStatus,
            lostReason: lostData?.reason,
            lostObs: lostData?.obs,
            lostFileUrl: lostData?.fileUrl,
            updatedAt: new Date().toISOString(),
            updatedBy: currentUser?.id,
            updatedByName: currentUser?.name
        };

        const result = await updateFreightCalculation(updatedQuote);
        if (result.success) {
            setHistory(prev => prev.map(h => h.id === id ? updatedQuote : h));
            showFeedback('Status atualizado!');
        } else {
            showFeedback(`Erro ao atualizar status: ${result.error}`, 'error');
        }
    };

    // Abre o formulário de Carga Ganha já com a ponte do Cliente resolvida: nome do cliente local
    // e, se já vinculado, o id do registro do Pipefy guardado no cadastro desse cliente (vínculo
    // automático). Sem vínculo, o operador confirma uma vez no autocomplete do modal.
    const openWonModal = (q: FreightCalculation) => {
        const cust = customers.find(c => c.id === q.customerId);
        setSelectedWonQuote({
            ...q,
            clienteNomeOperacao: q.clienteNomeOperacao || cust?.name || '',
            clientePipefyId: q.clientePipefyId || cust?.pipefyClientId,
        });
        setIsWonModalOpen(true);
    };

    const handleWonInfoSubmit = async (wonData: any) => {
        if (!selectedWonQuote) return;

        const updatedQuote: FreightCalculation = {
            ...selectedWonQuote,
            ...wonData,
            status: 'won',
            updatedAt: new Date().toISOString(),
            updatedBy: currentUser?.id,
            updatedByName: currentUser?.name,
            pipelineStage: 'Nova carga'
        };

        const result = await updateFreightCalculation(updatedQuote);
        if (!result.success) {
            console.error('Detailed Save Error:', result.error);
            showFeedback(`Erro ao salvar carga: ${result.error || 'Erro desconhecido'}`, 'error');
            return;
        }

        // Ponte do Cliente: se o operador confirmou/escolheu o registro do Pipefy aqui (clientePipefyId)
        // e o cadastro LOCAL desse cliente ainda não tinha esse id (ou tinha outro), aprende e guarda no
        // cadastro local — das próximas vezes vincula automático, sem perguntar. Nunca cria no Pipefy.
        if (wonData.clientePipefyId && selectedWonQuote.customerId) {
            const cust = customers.find(c => c.id === selectedWonQuote.customerId);
            if (cust && cust.pipefyClientId !== wonData.clientePipefyId) {
                const updatedCust = { ...cust, pipefyClientId: wonData.clientePipefyId };
                const ok = await updateCustomer(updatedCust);
                if (ok) setCustomers(prev => prev.map(c => c.id === cust.id ? updatedCust : c));
            }
        }

        // Operação salva no OmniFlow. Agora envia pro Pipefy (controle operacional), com trava de
        // duplicado: se já tem card, não manda de novo. Se o Pipefy falhar, a operação fica salva
        // mesmo assim e mostramos aviso — sem perder dado. (Ramper segue intacto, etapa comercial.)
        let finalQuote = updatedQuote;
        let pipefyMsg = '';
        if (selectedWonQuote.pipefyCardId) {
            pipefyMsg = ' (já estava na operação do Pipefy — não dupliquei o card)';
        } else {
            const q = selectedWonQuote;
            const dests = (q.destinations && q.destinations.length) ? q.destinations : (q.destination ? [q.destination] : []);
            const rota = [q.origin, ...dests].map(s => (s || '').trim()).filter(Boolean).join(' → ');
            // Observações = observações gerais + "Outras Necessidades" rotulado (pra não perder a info; o
            // select Outras Necessidades do Pipefy fica pra operação usar Compulog/Comprovei se precisar).
            const obs = [
                (wonData.observacoesGerais || '').trim(),
                (wonData.outrasNecessidades || '').trim() ? `Necessidades: ${(wonData.outrasNecessidades || '').trim()}` : '',
            ].filter(Boolean).join('\n');
            const pipefyRes = await createPipefyCard({
                rota,
                receita: Number(wonData.nossoFrete) || 0,
                freteTerceiro: Number(wonData.freteTerceiro) || 0,
                valorCarga: Number(wonData.valorCarga) || 0,
                peso: Number(wonData.pesoCargaOperacao) || undefined,
                veiculo: wonData.veiculoTipoOperacao || q.vehicleType,
                mercadoria: wonData.materialTipo || q.merchandiseType,
                implemento: wonData.carroceriaTipoOperacao,
                dataColeta: wonData.coletaDate,
                dataEntrega: wonData.entregaDate,
                dataFechamento: wonData.dataFechamento,
                localColeta: wonData.coletaEndereco,
                localEntrega: wonData.entregaEndereco,
                observacoes: obs,
                referencia: wonData.referenciaClienteOperacao || q.clientReference,  // -> "Solicitação (STE...)" (short_text)
                outrasNecessidades: wonData.outrasNecessidades,                      // texto livre -> Observações (rótulo)
                cliente: wonData.clienteNomeOperacao,                                // nome (título/resumo)
                clienteId: wonData.clientePipefyId,                                  // id escolhido -> conexão Cliente
                solicitante: wonData.solicitante,
                solicitanteId: wonData.solicitantePipefyId,                          // id escolhido -> conexão Solicitante
                mercadoriaNovaUsada: wonData.mercadoriaNovaUsada,                    // select Nova/Usada
                outrasNecessidadesSelect: wonData.outrasNecessidadesPipefy,          // select Compulog/Comprovei
                necessidadeGR: wonData.necessidadeGR,                                // checklist (lista dos marcados)
                titulo: [wonData.clienteNomeOperacao, rota].map(s => (s || '').trim()).filter(Boolean).join(' — '),
            });
            if (pipefyRes.ok && pipefyRes.cardId) {
                // Persiste a trava de duplicado + os ids escolhidos + os 3 campos espelhados + a URL do card.
                finalQuote = { ...updatedQuote, pipefyCardId: pipefyRes.cardId, pipefyCardUrl: pipefyRes.cardUrl || undefined, pipefySentAt: new Date().toISOString(), clientePipefyId: wonData.clientePipefyId, solicitantePipefyId: wonData.solicitantePipefyId };
                await updateFreightCalculation(finalQuote);
                setLastPipefyUrl(pipefyCardLink(finalQuote)); // botão "Abrir card no Pipefy" na celebração
                pipefyMsg = ' e enviada pro Pipefy';
            } else {
                pipefyMsg = ` — ⚠️ operação salva, mas falhou enviar pro Pipefy: ${pipefyRes.error || 'erro desconhecido'}`;
            }
        }

        setHistory(prev => prev.map(h => h.id === selectedWonQuote.id ? finalQuote : h));
        setIsWonModalOpen(false);
        setSelectedWonQuote(null);
        const pipefyFailed = pipefyMsg.includes('⚠️');
        if (!pipefyFailed) {
            setCelebrationValue(Number(wonData.nossoFrete) || finalQuote.totalFreight || 0);
            setShowCelebration(true);
            // A tela SEMPRE espera a interação (X/Fechar ou "Abrir card no Pipefy"); nunca some sozinha.
        }
        showFeedback(`Carga confirmada${pipefyMsg}!`, pipefyFailed ? 'error' : 'success');
        resetForm();
        setActiveTab('history');
    };

    // Modo de formação do preço base, vindo do CADASTRO do veículo (calc_mode):
    //   KM   -> preço base = km × factor  (utilitários)
    //   ANTT -> piso mínimo pela Tabela A (caminhões; padrão)
    //   FREE -> sem piso e sem tarifa     (Prancha, Aéreo)
    // Antes isso vinha de duas listas fixas no código chaveadas pelos nomes do
    // enum VehicleType — que não batem com os nomes gravados no banco. Por isso
    // utilitários e Prancha recebiam piso ANTT. Agora a fonte é uma só: o cadastro.
    const modoCalculo = vehicleConfigs[vehicleType]?.calcMode || 'ANTT';
    const hasAntt = modoCalculo === 'ANTT';

    // Estado da chave de emergência: lido na entrada e revisitado a cada minuto,
    // para que quem já está com a tela aberta veja o master ligar ou desligar sem
    // precisar recarregar.
    useEffect(() => {
        if (!currentUser) return;
        let vivo = true;
        const puxar = () => { lerEmergencia().then(e => { if (vivo) setEmergencia(e); }); };
        puxar();
        const t = setInterval(puxar, 60_000);
        return () => { vivo = false; clearInterval(t); };
    }, [currentUser]);

    // Sonda de recuperação: enquanto a chave está ligada, testa o Qualp de tempos
    // em tempos e avisa quando ele voltar. SÓ no master — se cada operador
    // sondasse, seriam N chamadas simultâneas. Enquanto o Qualp está fora a sonda
    // é gratuita (falha não consome consulta); ela custa exatamente uma consulta,
    // no instante em que ele volta, que é justamente quando queremos saber.
    useEffect(() => {
        if (!emergenciaLigada || !ehMaster || qualpVoltou) return;
        let vivo = true;
        const sondar = async () => {
            const r = await estimateDistance('São Paulo, SP', 'Rio de Janeiro, RJ', 'Truck', 5, 'Carga geral');
            if (vivo && !r.error) setQualpVoltou(true);
        };
        const t = setInterval(sondar, 5 * 60_000);
        return () => { vivo = false; clearInterval(t); };
    }, [emergenciaLigada, ehMaster, qualpVoltou]);

    // Liga/desliga. A recusa por não ser master vem do servidor (0 linhas na RLS),
    // não de checagem de tela.
    const alternarEmergencia = async (ligar: boolean) => {
        setSalvandoEmergencia(true);
        try {
            const r = await definirEmergencia(ligar, { id: currentUser?.id, name: currentUser?.name });
            if (!r.ok) { showFeedback(r.erro || 'Não foi possível alterar a chave.', 'error'); return; }
            setEmergencia(await lerEmergencia());
            setQualpVoltou(false);
            showFeedback(
                (ligar ? 'Modo emergência LIGADO.' : 'Modo emergência desligado — Qualp voltou a ser fonte única.')
                + (r.avisoLog ? ` ${r.avisoLog}` : ''),
                r.avisoLog ? 'error' : 'success',
            );
        } finally {
            setSalvandoEmergencia(false);
            setShowEmergenciaModal(false);
        }
    };

    // Rota multi-parada: continua no Google e na tabela ANTT local até a Fase 2.
    const isMultiRota = destinations.length > 0;

    // --- Município travado na lista do IBGE (só rota simples) ---
    const { lista: municipios } = useMunicipios();
    const origemMun = useMemo(() => resolverMunicipio(municipios, origin), [municipios, origin]);
    const destinoMun = useMemo(() => resolverMunicipio(municipios, destination), [municipios, destination]);
    // Rota simples só anda com origem E destino escolhidos da lista. É o que
    // impede consultar/salvar com texto que não é município.
    const municipiosOk = isMultiRota || (!!origemMun && !!destinoMun);

    // Promove o que já está gravado para o formato canônico: cotação antiga tem
    // "SÃO PAULO / SP", "blumenau-sc", "itajai / sc" — tudo resolve pro mesmo
    // município e vira "São Paulo, SP". O que não resolve (bairro, texto solto)
    // fica como está e o campo acusa, exigindo escolha.
    useEffect(() => {
        if (!municipios.length || isMultiRota) return;
        if (origemMun && origin !== origemMun.rotulo) setOrigin(origemMun.rotulo);
        if (destinoMun && destination !== destinoMun.rotulo) setDestination(destinoMun.rotulo);
    }, [municipios, isMultiRota, origemMun, destinoMun, origin, destination]);

    const eixosAtuais = vehicleConfigs[vehicleType]?.axles;

    // O resultado na tela corresponde ao que foi de fato consultado? Basta um dos
    // quatro campos que sujam (origem, destino, eixos, tipo de carga) mudar para
    // deixar de corresponder. Cliente, solicitante, ref, implemento e urgência não
    // entram aqui de propósito — não alteram rota nem pedágio nem piso.
    // Origem/destino comparados por MUNICÍPIO: a promoção de formato feita pelo
    // autocomplete ("SÃO PAULO / SP" -> "São Paulo, SP") não pode ser lida como
    // troca de rota e invalidar um resultado bom.
    const snapshotValido = !!qualpRota
        && normalizar(qualpRota.origem) === normalizar(origin)
        && normalizar(qualpRota.destino) === normalizar(destination)
        && qualpRota.cargoType === cargoType
        && qualpRota.eixos === eixosAtuais;

    // Frete urbano: mesmo município nos dois campos. Reconhecido na tela também
    // (não só pela resposta da função), para o estado se manter coerente enquanto
    // o operador digita — e para o aviso sumir sozinho ao trocar a rota.
    const rotaUrbana = !isMultiRota && !!origin.trim()
        && normalizar(origin) === normalizar(destination);

    // Deixou de ser urbana (trocou origem ou destino): o aviso sai da tela sozinho.
    useEffect(() => {
        if (!rotaUrbana && freteUrbano) setFreteUrbano(null);
    }, [rotaUrbana, freteUrbano]);

    // Piso mínimo ANTT.
    // - Multi-parada: (km × CCD) + CC da Tabela A local, como sempre foi.
    // - Rota simples: FONTE ÚNICA — o piso vem do Qualp, não é mais calculado aqui.
    // Retorna null quando não aplicável; null vira "—" na tela e nunca zero.
    const anttFloor = useMemo(() => {
        if (!hasAntt) return null;
        const dist = parseFloat(distanceKm.replace(',', '.')) || 0;
        // O Qualp calcula o piso sobre a distância ARREDONDADA ao inteiro
        // (4.244,669 -> 4.245). Os dois pontos que calculam o piso localmente
        // usam o mesmo arredondamento, para a mesma rota mostrar o mesmo piso
        // venha ele do Qualp ou daqui. Só a ENTRADA do cálculo é arredondada:
        // distanceKm continua fracionário no que é salvo e no custo por km.
        const distPiso = Math.round(dist);
        // Modo tabelado: o piso é INFORMATIVO, calculado sobre a distância que o
        // operador digitar. Sem distância digitada não mostra piso — com dist=0 o
        // cálculo devolveria só o CC (a parcela fixa), o que seria enganoso.
        if (modoTabelado) return dist > 0 ? computeANTTFloor(cargoType, eixosAtuais, distPiso) : null;
        if (isMultiRota) return computeANTTFloor(cargoType, eixosAtuais, dist);
        // Frete urbano: o Qualp não é consultado, então o piso sai da Tabela A
        // local sobre a distância que o operador digitar. É referência, não
        // imposição — o Preço Base continua livre.
        if (rotaUrbana) return computeANTTFloor(cargoType, eixosAtuais, distPiso);
        // Contingência: o piso volta a sair da Tabela A local, como era antes do
        // Qualp. Nunca fica em branco — cotação sem piso é pior que piso local.
        if (emergenciaLigada && !(snapshotValido && qualpRota!.fonte === 'qualp')) {
            return computeANTTFloor(cargoType, eixosAtuais, distPiso);
        }
        if (snapshotValido) return qualpRota!.piso;
        // Sem snapshot valido nao ha piso: invalidado vira "—", nunca numero velho.
        return null;
    }, [hasAntt, cargoType, distanceKm, eixosAtuais, isMultiRota, rotaUrbana, modoTabelado, emergenciaLigada, snapshotValido, qualpRota]);

    // Pedágio read-only só quando o número veio de uma busca agora. Cotação antiga
    // reaberta mantém o pedágio editável, como sempre foi.
    // Em contingência o pedágio é digitado à mão: nunca read-only.
    const pedagioDoQualp = !emergenciaLigada && !isMultiRota && snapshotValido && qualpRota!.fonte === 'qualp';
    const pedagioSobrescrito = pedagioDoQualp && Math.abs(num(tolls) - qualpRota!.pedagioCheio) > 0.005;

    // Cotação salva reaberta: números gravados, ainda correspondendo aos campos.
    const temNumerosSalvos = snapshotValido && qualpRota!.fonte === 'salvo';

    // Esta cotação de rota simples está fechando SEM o Qualp? É o que vai virar a
    // marca origem_dados='contingencia' no registro. Se o Qualp voltar e a busca
    // der certo antes de desligarem a flag, a cotação NÃO é marcada.
    const fechandoEmContingencia = emergenciaLigada && !isMultiRota
        && !(snapshotValido && qualpRota!.fonte === 'qualp');

    // Rota simples só fecha com resultado válido — de busca agora ou os números
    // salvos ainda coerentes. "Desatualizado" NÃO conta como válido.
    // Em contingência esse portão fica aberto: é o ponto da chave de emergência.
    // Frete urbano entra como exceção pontual: o Qualp não é consultado, os
    // números são manuais e a cotação FECHA — senão o aviso "preencha à mão"
    // viraria parede. O resto da rota simples segue bloqueante normal.
    // A emergência abre o mesmo portão, mas para toda a rota simples.
    // Tabelado tambem: nao consulta o Qualp, entao nao ha resultado dele a exigir.
    const resultadoRotaOk = isMultiRota || emergenciaLigada || rotaUrbana || modoTabelado || (snapshotValido && !rotaDesatualizada);

    // Sujou depois de uma busca boa: limpa o que veio do Qualp da tela para ninguém
    // ler número que não corresponde mais aos campos, e marca para nova busca.
    // Em contingência não roda: os números são digitados à mão e apagá-los seria
    // destruir o trabalho do operador.
    useEffect(() => {
        if (emergenciaLigada || isMultiRota || rotaUrbana || modoTabelado || !qualpRota || snapshotValido) return;
        setQualpRota(null);
        setRotaDesatualizada(true);
        setDistanceKm('0');
        setTolls('0');
        setPedagioLiberado(false);
        setRecalcDiff(null);
    }, [emergenciaLigada, isMultiRota, rotaUrbana, modoTabelado, qualpRota, snapshotValido]);

    // Utilitários (modo KM): frete base = KM × tarifa do cadastro, sem tabela ANTT.
    // A tarifa é o `factor` — o campo que a tela de Configurações rotula como
    // "Fator por KM (R$)". Tarifa zerada não conta como utilitário: sem número,
    // KM × 0 daria base zero, que é pior que não autopreencher.
    const isUtilitario = (modoCalculo === 'KM' || modoCalculo === 'KM_ROUND_TRIP')
        && (vehicleConfigs[vehicleType]?.factor || 0) > 0;
    const utilitarioRate = isUtilitario ? (vehicleConfigs[vehicleType]?.factor || 0) : undefined;
    // Utilitário vai e volta: quem dirige roda o DOBRO da distância da rota, e é
    // pelo rodado que recebe. O modo 'KM' puro (só ida) fica disponível no cadastro
    // para quem precisar, mas os utilitários usam KM_ROUND_TRIP.
    const fatorTrajeto = modoCalculo === 'KM_ROUND_TRIP' ? 2 : 1;
    const utilitarioFreight = useMemo(() => {
        if (!isUtilitario) return null;
        const dist = parseFloat(distanceKm.replace(',', '.')) || 0;
        return dist * fatorTrajeto * utilitarioRate!;
    }, [isUtilitario, utilitarioRate, fatorTrajeto, distanceKm]);

    // Valor numérico de referência para persistência e para o botão "Aderir ao Preço Base".
    const suggestedFreightANTT = anttFloor ?? utilitarioFreight ?? 0;

    // Utilitários: o frete base é puramente KM × tarifa — preenche automaticamente o Preço Base.
    // MAS numa cotação salva reaberta, o base salvo fica CONGELADO enquanto veículo/km não mudarem
    // (não sobrescreve o que foi salvo). Ao mudar veículo/km, volta a autopreencher.
    useEffect(() => {
        if (!isUtilitario || utilitarioFreight === null) return;
        const sig = `${vehicleType}|${distanceKm}|${modoCalculo}`;
        if (loadedUtilRef.current !== null && loadedUtilRef.current === sig) return; // cotação salva reaberta: preserva o base salvo
        loadedUtilRef.current = null; // a partir daqui é edição do usuário: autopreenche normalmente
        setBaseFreight(maskCurrency(utilitarioFreight));
    }, [isUtilitario, utilitarioFreight, vehicleType, distanceKm, modoCalculo]);

    const calcData = useMemo(() => {
        // Monetários: num() lida com "R$ 1.234,56", "42" cru e "42,00" de forma uniforme.
        // Percentuais (ip/pm/icmsP) usam parseFloat pois são strings sem máscara (ex.: "0.2").
        const gv = num(goodsValue);
        const ip = parseFloat(insurancePercent.replace(',', '.')) || 0;
        const pm = parseFloat(profitMargin.replace(',', '.')) || 0;
        const icmsP = parseFloat(icmsPercent.replace(',', '.')) || 0;
        const t = num(tolls);
        const bf = num(baseFreight);
        const ec = num(extraCosts);

        const adValoremSelling = gv * (ip / 100);
        const adValoremCost = gv * (fedTaxes.insurancePolicyRate / 100);
        const totalFedTaxPercent = (fedTaxes.pis + fedTaxes.cofins + fedTaxes.csll + fedTaxes.irpj);
        const icmsDivisor = (1 - (icmsP / 100));
        const marginDivisor = (1 - (pm / 100));

        const totalOtherCosts = otherCosts.reduce((acc, curr) => acc + curr.value, 0);
        const totalEc = ec + totalOtherCosts;

        // ---- MODO TABELADO: a MESMA equação, resolvida para a outra ponta ----
        // Ida (Calcular):  final = (motorista + t + ec + adV) / [(1-margem)(1-ICMS)]
        // Volta (Tabelado): motorista = final × (1-ICMS) × (1-margem) − t − ec − adV
        // Os divisores da ida viram multiplicadores. Não é conta paralela: é a
        // mesma equação isolando o outro termo, então o mesmo frete dá o mesmo
        // número nos dois modos (ida e volta fecham em R$ 0,00).
        // Os federais NÃO entram aqui porque não entram no gross-up da ida —
        // eles aparecem na margem REAL, calculada logo abaixo, igual no Calcular.
        const valorFinalDigitado = num(valorFinalTabelado);
        const priceWithMarginTab = valorFinalDigitado * icmsDivisor;
        const motoristaTabelado = (priceWithMarginTab * marginDivisor) - t - totalEc - adValoremSelling;

        // No tabelado o preço é dado e o motorista é derivado; no Calcular é o
        // contrário. Daqui para baixo a conta de impostos/lucro é a MESMA nos dois.
        const bfEfetivo = modoTabelado ? motoristaTabelado : bf;
        const directCostsSelling = bfEfetivo + t + totalEc + adValoremSelling;
        const priceWithMargin = modoTabelado
            ? priceWithMarginTab
            : (marginDivisor > 0 ? directCostsSelling / marginDivisor : directCostsSelling);
        const finalFreight = modoTabelado
            ? valorFinalDigitado
            : (icmsDivisor > 0 ? priceWithMargin / icmsDivisor : priceWithMargin);
        const icmsAmount = finalFreight * (icmsP / 100);
        const fedTaxesAmount = finalFreight * (totalFedTaxPercent / 100);
        const realDirectCosts = bfEfetivo + t + totalEc + adValoremCost;
        const realProfitAmount = finalFreight - icmsAmount - fedTaxesAmount - realDirectCosts;
        const realMarginPercent = finalFreight > 0 ? (realProfitAmount / finalFreight) * 100 : 0;
        return { directCosts: directCostsSelling, realDirectCosts, priceAfterMargin: priceWithMargin, finalFreight, icmsAmount, fedTaxesAmount, adValoremSelling, adValoremCost, realProfitAmount, realMarginPercent, motoristaTabelado };
    }, [baseFreight, tolls, extraCosts, otherCosts, goodsValue, insurancePercent, profitMargin, icmsPercent, fedTaxes, modoTabelado, valorFinalTabelado]);

    // Consulta a rota simples no Qualp (fonte única). `capturarDiff` liga o
    // antes/depois usado ao recalcular uma cotação já salva.
    // Só é chamada pelo botão "Buscar rota" (e pelo "Recalcular" de cotação salva).
    // Nada mais dispara consulta: preencher campo não gasta crédito.
    const consultarQualp = async (overrideVehicle?: string, capturarDiff = false) => {
        const org = origin, dst = destination;
        if (!org || !dst) return;
        if (loadingDistance) return;   // trava contra clique repetido em cima da mesma busca

        // Entrada travada: sem município escolhido da lista, não consulta. Evita
        // mandar texto solto que o Qualp resolveria por aproximação.
        if (!municipiosOk) {
            showFeedback('Escolha origem e destino na lista de municípios.', 'info');
            return;
        }
        // overrideVehicle só é considerado quando for string (o onClick passa um evento).
        const vt = (typeof overrideVehicle === 'string' && overrideVehicle) ? overrideVehicle : vehicleType;
        const config = vehicleConfigs[vt];

        const kmAntes = parseFloat(distanceKm.replace(',', '.')) || 0;
        const pedAntes = num(tolls);
        const pisoAntes = anttFloor;

        setLoadingDistance(true);
        try {
            const result = await estimateDistance(org, dst, vt, config?.axles, cargoType);

            if (result.error) {
                // Frete urbano (origem == destino): NÃO é falha do Qualp. Ele nem
                // chegou a ser consultado — distância zero é a resposta correta e o
                // caso ainda não tem cálculo automático. Orienta o preenchimento
                // manual em vez de acusar indisponibilidade, e deixa a cotação fechar.
                if (result.urbano) {
                    setQualpRota(null);
                    setQualpBloqueio(null);
                    setRotaDesatualizada(false);
                    setFreteUrbano(result.mensagem);
                    showFeedback(result.mensagem, 'info');
                    return;
                }
                // Fonte única: sem Qualp não há número confiável. NÃO cai pro Google
                // e NÃO zera o km — trava o fechamento até a consulta voltar.
                console.warn('Qualp bloqueou a rota:', result.error);
                setQualpRota(null);
                setFreteUrbano(null);
                setQualpBloqueio(result.mensagem || result.error);
                showFeedback(result.mensagem || `Qualp indisponível: ${result.error}`, 'error');
                return;
            }

            setQualpBloqueio(null);
            setDistanceKm(String(result.km));
            // O Qualp devolve o endereço em caixa baixa e sem acento ("sao paulo, sp").
            // Como o município já veio escolhido da lista, mantemos o texto canônico
            // do IBGE na tela; só aceitamos a versão do Qualp quando não há município
            // resolvido (multi-parada).
            if (!origemMun) setOrigin(result.originNormalized);
            if (!destinoMun) setDestination(result.destinationNormalized);
            setTolls(maskCurrency(result.estimatedTolls));
            setPedagioLiberado(false);   // volta a ser read-only a cada consulta nova
            setQualpRota({
                km: result.km,
                pedagioCheio: result.estimatedTolls,
                pedagioTag: result.tollsWithTag,
                piso: result.pisoAntt,
                // Guarda a combinação exata consultada: é contra ela que a tela
                // decide se o resultado ainda vale ou virou "desatualizado".
                origem: org,
                destino: dst,
                cargoType,
                eixos: config?.axles,
                resolucao: result.resolucaoAntt,
                confirmarPiso: result.confirmarPisoManualmente,
                idTransacao: result.idTransacao,
                fonte: 'qualp',
            });
            setRotaDesatualizada(false);

            if (capturarDiff) {
                setRecalcDiff({
                    kmAntes, kmDepois: result.km,
                    pedAntes, pedDepois: result.estimatedTolls,
                    pisoAntes, pisoDepois: result.pisoAntt,
                });
                showFeedback('Recalculado pelo Qualp — confira o antes/depois.');
            } else {
                setRecalcDiff(null);
                showFeedback('Rota sincronizada pelo Qualp!');
            }
        } catch (err: any) {
            console.error(err);
            setQualpRota(null);
            setQualpBloqueio(`Falha na conexão com o Qualp: ${err.message}`);
            showFeedback(`Falha na conexão: ${err.message}`, 'error');
        } finally { setLoadingDistance(false); }
    };

    const handleFetchDistance = (overrideVehicle?: string) => consultarQualp(overrideVehicle, false);

    // Cotação já salva: o número antigo fica como está até o operador pedir. Só
    // aqui o Qualp é consultado de novo, e o antes/depois aparece na tela.
    const recalcularPeloQualp = () => consultarQualp(undefined, true);

    // Recalcula a rota multi-parada (coleta + destino + destinos extras). A distância TOTAL
    // alimenta o cálculo (distanceKm); o pedágio e a otimização vêm do backend. Não mexe na fórmula.
    const fetchMultiRoute = async (optimize = false) => {
        const stops = [destination, ...destinations].map(d => (d || '').trim()).filter(Boolean);
        if (!origin.trim() || stops.length < 2) {
            showFeedback('Informe a coleta e ao menos 2 destinos para a rota.', 'info');
            return;
        }
        setRouteLoading(true);
        try {
            const axles = vehicleConfigs[vehicleType]?.axles;
            const res = await estimateMultiRoute(origin, stops, vehicleType, axles, optimize);
            if (res?.error || !res?.km) {
                showFeedback(`Erro na rota: ${res?.error || 'sem distância'}`, 'error');
                return;
            }
            // Otimização: reordena os destinos conforme a ordem dos intermediários (destino final fica fixo).
            if (optimize && Array.isArray(res.optimizedIntermediateOrder)) {
                const intermediates = stops.slice(0, -1);
                const last = stops[stops.length - 1];
                const reordered = [...res.optimizedIntermediateOrder.map((i: number) => intermediates[i]), last];
                setDestination(reordered[0]);
                setDestinations(reordered.slice(1));
                showFeedback('Ordem otimizada e rota recalculada!');
            } else {
                showFeedback('Rota recalculada!');
            }
            setDistanceKm(String(res.km));
            setTolls(maskCurrency(res.estimatedTolls || 0));
            setRouteGeometry({ polyline: res.polyline || '', stops: Array.isArray(res.stops) ? res.stops : [] });
        } catch (err: any) {
            showFeedback(`Falha na rota: ${err.message}`, 'error');
        } finally {
            setRouteLoading(false);
        }
    };

    const historicalAlert = useMemo(() => {
        if (!origin || !destination) return null;
        const routeMatches = history.filter(h =>
            h.origin.toLowerCase().includes(origin.toLowerCase()) &&
            h.destination.toLowerCase().includes(destination.toLowerCase())
        );
        if (routeMatches.length === 0) return null;
        const vehicleMatches = routeMatches.filter(h => h.vehicleType === vehicleType);
        const wonVehicle = vehicleMatches.filter(h => h.status === 'won');
        const checkWon = wonVehicle.length > 0 || routeMatches.some(h => h.status === 'won');
        const avgWonFreight = wonVehicle.length > 0 ? wonVehicle.reduce((a, h) => a + (h.totalFreight || 0), 0) / wonVehicle.length : 0;
        return (
            <div className={`col-span-1 md:col-span-2 px-6 py-3 rounded-xl flex items-center gap-3 animate-fade-in ${checkWon ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                {checkWon ? <CheckCircle className="w-4 h-4 shrink-0" /> : <Info className="w-4 h-4 shrink-0" />}
                <span className="text-[10px] font-medium uppercase">
                    Histórico desta rota: {routeMatches.length} cotação(ões)
                    {vehicleMatches.length > 0
                        ? ` • ${vehicleMatches.length} com ${vehicleType}`
                        : ` • nenhuma com ${vehicleType}`}
                    {wonVehicle.length > 0
                        ? ` • Já fechado com ${vehicleType} ~ R$ ${formatCur(avgWonFreight)}`
                        : (checkWon ? ' • Já atendemos esta rota' : ' • Nunca fechamos esta rota')}
                </span>
            </div>
        );
    }, [origin, destination, history, vehicleType]);

    const generateId = () => crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);

    // Devolve a cotação salva (ou null quando não salvou: guard, gate de margem,
    // erro, ou o caminho 'won' que só abre o modal). Aditivo — os chamadores
    // antigos ignoram o retorno; os botões novos encadeiam a integração nele.
    const saveQuote = async (statusArg: QuoteStatus, bypassMarginCheck = false, stayOnForm = false, keepStatus = false): Promise<FreightCalculation | null> => {
        // Fonte única: se o Qualp falhou depois do timeout + retry, a cotação de
        // rota simples NÃO fecha. Sem fallback pro Google — número velho numa
        // cotação é pior que cotação travada. Multi-parada não é afetada.
        // Em contingência este portão fica aberto: a falha do Qualp deixa de
        // impedir o fechamento (a cotação sai marcada como 'contingencia').
        if (!emergenciaLigada && !isMultiRota && qualpBloqueio) {
            showFeedback('Cotação travada: o Qualp não respondeu. Refaça a consulta da rota antes de salvar.', 'error');
            return null;
        }
        // Rota simples só salva com município escolhido da lista do IBGE.
        if (!municipiosOk) {
            showFeedback('Escolha origem e destino na lista de municípios antes de salvar.', 'error');
            return null;
        }
        // O botão "Buscar rota" não é brecha: sem resultado do Qualp válido, ou com
        // resultado marcado desatualizado, a cotação de rota simples não fecha.
        if (!resultadoRotaOk) {
            showFeedback(
                rotaDesatualizada
                    ? 'Resultado desatualizado: clique em "Buscar rota" de novo antes de salvar.'
                    : 'Clique em "Buscar rota" para trazer distância, pedágio e piso antes de salvar.',
                'error',
            );
            return null;
        }
        // Congela o status: "Salvar" (keepStatus) NÃO rebaixa uma cotação já comprometida.
        // Numa edição, preserva o status salvo (Ganha continua Ganha); em cotação nova, usa o
        // status pedido. Só ações explícitas (Fechado/Perdido/Voltar pra Pauta) mudam o status.
        const existingQuote = editingId ? history.find(h => h.id === editingId) : undefined;
        const status: QuoteStatus = (keepStatus && existingQuote) ? existingQuote.status : statusArg;
        const isEditandoExistente = keepStatus && !!existingQuote; // "Salvar/Envio" de cotação já salva

        // Gate de margem: nas ações de comprometer (won/pending), mas NÃO ao só re-salvar uma cotação
        // existente (edição não re-alerta). Cotação nova via Salvar/Envio ainda passa pelo gate.
        if (!bypassMarginCheck && !isEditandoExistente && (status === 'won' || status === 'pending') && calcData.realMarginPercent < marginThreshold) {
            setPendingSaveStatus(status);
            setPendingStayOnForm(stayOnForm);
            setShowMarginModal(true);
            return null;
        }

        // Camada 1 — guard de reentrância SÍNCRONO: pega o clique repetido antes do re-render
        // (o setSavingQuote/disabled só vale no próximo render; o ref já corta agora). Só aqui,
        // depois do gate de margem, pra não travar a confirmação do modal.
        if (savingQuoteRef.current) return null;

        setIsTimerRunning(false);
        const wasCreating = !editingId;   // decide create x update por valor capturado (editingId muda de forma assíncrona)
        const quoteId = editingId || generateId();
        const createdDate = existingQuote?.createdAt ? existingQuote.createdAt : Date.now();

        const data: FreightCalculation = {
            id: quoteId,
            proposalNumber: editingId ? (history.find(h => h.id === editingId)?.proposalNumber || '') : nextProposalNumber(history),
            clientReference, origin, destination, destinations: destinations.map(d => (d || '').trim()).filter(Boolean), distanceKm: parseFloat(distanceKm.replace(',', '.')) || 0, vehicleType: vehicleType as VehicleType, merchandiseType, weight: parseFloat(weight.replace(',', '.')) || 0,
            customerId: selectedCustomerId, suggestedFreight: suggestedFreightANTT, solicitante, solicitantePipefyId,
            carroceriaTipoOperacao: implemento || undefined,   // Implemento da calculadora -> flui pra carga fechada/card
            // Tabelado: baseFreight recebe o MOTORISTA derivado da engine invertida,
            // e totalFreight (abaixo, via calcData.finalFreight) é o valor final
            // digitado sem transformação — é o que o Ramper manda como `value` e o
            // Pipefy como `receita`. No modo Calcular nada muda.
            baseFreight: modoTabelado ? calcData.motoristaTabelado : num(baseFreight),
            tolls: num(tolls), extraCosts: num(extraCosts), extraCostsDescription, goodsValue: num(goodsValue), insurancePercent: parseFloat(insurancePercent.replace(',', '.')) || 0, adValorem: calcData.adValoremSelling, profitMargin: parseFloat(profitMargin.replace(',', '.')) || 0, icmsPercent: parseFloat(icmsPercent.replace(',', '.')) || 0,
            icmsManual, pagadorMg,
            pisPercent: fedTaxes.pis, cofinsPercent: fedTaxes.cofins, csllPercent: fedTaxes.csll, irpjPercent: fedTaxes.irpj,
            totalFreight: calcData.finalFreight, createdAt: createdDate, disponibilidade, status, updatedBy: currentUser?.id, updatedByName: currentUser?.name,
            // Autoria imutável: na criação grava o usuário atual; na edição preserva o autor original.
            createdBy: editingId ? existingQuote?.createdBy : currentUser?.id,
            createdByName: editingId ? existingQuote?.createdByName : currentUser?.name,
            realProfit: calcData.realProfitAmount, realMarginPercent: calcData.realMarginPercent,
            elaborationSeconds: elapsedSeconds,
            // Marca de auditoria: esta cotação fechou sem o Qualp (pedágio manual,
            // piso da tabela local). Preserva a marca de uma cotação que já era de
            // contingência, mesmo que agora esteja sendo reeditada com o Qualp de pé.
            origemDados: fechandoEmContingencia ? 'contingencia' : existingQuote?.origemDados,
            // Marca de controle: preço veio de tabela/contrato. Preserva a marca de
            // uma cotação que já era tabelada, mesmo reeditada no modo Calcular.
            tipoPrecificacao: modoTabelado ? 'tabelado' : existingQuote?.tipoPrecificacao,
            otherCosts
        };

        if (status === 'won') {
            openWonModal(data);   // abre modal (não grava aqui); não segura o guard
            return null;
        }

        // Ativa a trava (ref síncrono + estado que desabilita o botão).
        let salva: FreightCalculation | null = null;
        savingQuoteRef.current = true;
        setSavingQuote(true);
        // Camada 2 — editingId SÍNCRONO: se é criação, já entra em modo edição do id gerado, pra que
        // qualquer disparo seguinte vire UPDATE do mesmo registro, nunca um insert novo.
        if (wasCreating) setEditingId(quoteId);

        try {
            if (!wasCreating) {
                const result = await updateFreightCalculation(data);
                if (result.success) {
                    // Auditoria (Parte C): registra o diff antes/depois SÓ em edição, best-effort.
                    if (existingQuote) {
                        const nomeCli = (id?: string) => customers.find(c => c.id === id)?.name || '—';
                        const mudancas = buildQuoteChanges(existingQuote, data, nomeCli(existingQuote.customerId), nomeCli(data.customerId));
                        // Só grava se houve mudança E não é o mesmo diff recém-gravado (double-save em <8s).
                        const sig = `${data.id}|${JSON.stringify(mudancas)}`;
                        const nowMs = Date.now();
                        const dup = lastAuditRef.current && lastAuditRef.current.sig === sig && (nowMs - lastAuditRef.current.at) < 8000;
                        if (mudancas.length && !dup) {
                            lastAuditRef.current = { sig, at: nowMs };
                            registrarAlteracao(data, mudancas, { id: currentUser?.id, name: currentUser?.name });
                        }
                    }
                    setHistory(prev => prev.map(h => h.id === editingId ? data : h));
                    setLastSavedQuote(data);
                    salva = data;
                    if (stayOnForm) {
                        showFeedback("Cotação enviada e sinalizada no CRM.");
                    } else {
                        showFeedback("Atualizado!");
                        setEditingId(null); setShowPostSaveModal(true);
                    }
                } else {
                    showFeedback(`Erro ao atualizar no banco: ${result.error}`, "error");
                }
            } else {
                const result = await createFreightCalculation(data);
                if (result.success) {
                    // Camada 3 (no banco): se detectou idêntica recém-criada, não inseriu de novo.
                    if (result.duplicate) showFeedback("Cotação já havia sido salva — evitei duplicar.", "info");
                    else showFeedback(stayOnForm ? "Cotação enviada e sinalizada no CRM." : "Salvo com sucesso!");
                    const savedId = result.data?.id || quoteId;
                    setHistory(prev => prev.some(h => h.id === savedId) ? prev : [{ ...data, id: savedId }, ...prev]);
                    setLastSavedQuote({ ...data, id: savedId });
                    salva = { ...data, id: savedId };
                    if (stayOnForm) {
                        setEditingId(savedId);
                    } else {
                        setEditingId(null); setShowPostSaveModal(true);
                    }
                } else {
                    // Falhou a criação: desfaz o editingId síncrono pra não apontar pra um id inexistente.
                    setEditingId(null);
                    showFeedback(`Erro ao salvar no banco: ${result.error}`, "error");
                }
            }
        } catch (error) {
            if (wasCreating) setEditingId(null);
            console.error("Exception in saveQuote:", error);
            showFeedback("Erro inesperado ao salvar.", "error");
        } finally {
            savingQuoteRef.current = false;
            setSavingQuote(false);
        }
        return salva;
    };

    // ---- Botões Salvar / Pipefy / Ramper: a cotação é salva UMA vez ----
    // Garante que existe registro antes de integrar. Se esta sessão já salvou
    // (lastSavedQuote com o mesmo id de editingId), NÃO salva de novo: devolve o
    // registro existente e a integração roda sobre ele. Assim clicar Pipefy e
    // depois Ramper gera uma cotação só, com um proposal_number só.
    // Não cria caminho de save paralelo — encadeia no saveQuote de sempre, com a
    // trava de 3 camadas intacta.
    // Esta cotação já tem card na operação do Pipefy? Vem do histórico, que é
    // atualizado quando o card é criado — sobrevive a recarregar a tela.
    const idCotacaoAtual = editingId || lastSavedQuote?.id || null;
    const jaFoiPraPipefy = !!(idCotacaoAtual && history.find(h => h.id === idCotacaoAtual)?.pipefyCardId);

    const garantirSalva = async (): Promise<FreightCalculation | null> => {
        if (lastSavedQuote && editingId === lastSavedQuote.id) return lastSavedQuote;
        // stayOnForm = true: fica na tela, sem o modal pós-save que levava embora.
        return await saveQuote('pending', false, true, true);
    };

    // PIPEFY: salva (se preciso) e abre o modal de fechamento que já existe — o
    // Pipefy precisa dos 25 campos que só o modal coleta. O modal segue igual.
    const handleBotaoPipefy = async () => {
        const q = await garantirSalva();
        if (!q) return;   // guard/gate barrou: a mensagem já foi mostrada
        openWonModal(q);
    };

    // RAMPER: salva (se preciso), confirma e dispara, sem sair da tela.
    const handleBotaoRamper = async () => {
        const q = await garantirSalva();
        if (!q) return;
        const jaEnviou = enviadoRamper;
        const pergunta = jaEnviou
            ? 'Esta cotação já foi enviada ao Ramper. Enviar de novo criará outro card. Confirmar?'
            : 'Enviar esta cotação para o Ramper?';
        if (!window.confirm(pergunta)) return;
        const ok = await handleSendToRamper(q);
        if (ok) setEnviadoRamper(true);
    };

    const loadQuote = (quote: FreightCalculation) => {
        setOrigin(quote.origin); setDestination(quote.destination); setDestinations(quote.destinations || []); setShowMap(false); setRouteGeometry(null); setClientReference(quote.clientReference || ''); setDistanceKm(quote.distanceKm.toString());
        setVehicleType(quote.vehicleType); setWeight(quote.weight.toString()); setSelectedCustomerId(quote.customerId); setBaseFreight(maskCurrency(quote.baseFreight));
        setTolls(maskCurrency(quote.tolls)); setExtraCosts(maskCurrency(quote.extraCosts || 0)); setExtraCostsDescription(quote.extraCostsDescription || '');
        setGoodsValue(maskCurrency(quote.goodsValue)); setInsurancePercent(quote.insurancePercent.toString()); setProfitMargin(quote.profitMargin.toString());
        // ICMS preservado: restaura o valor salvo e a marca de manual. Enquanto a rota não mudar, o
        // automático não recalcula (não mexe no passado); mudar origem/destino recalcula pela rota nova.
        loadedIcmsRouteRef.current = `${quote.origin}|${quote.destination}|${quote.pagadorMg ?? false}`;
        // Congela o preço base de cotação utilitária salva (não sobrescreve com km×tarifa na reabertura).
        loadedUtilRef.current = `${quote.vehicleType}|${quote.distanceKm.toString()}`;
        setIcmsPercent(quote.icmsPercent.toString()); setIcmsManual(quote.icmsManual ?? false); setPagadorMg(quote.pagadorMg ?? false); setEditingId(quote.id); setDisponibilidade(quote.disponibilidade || "Imediato");
        setMerchandiseType(quote.merchandiseType || '');
        setSolicitante(quote.solicitante || ''); setSolicitantePipefyId(quote.solicitantePipefyId);
        setImplemento(quote.carroceriaTipoOperacao || '');
        setOtherCosts(quote.otherCosts || []);
        setElapsedSeconds(quote.elaborationSeconds || 0); setIsTimerRunning(false);
        // Cotação salva mantém km/pedágio/piso como foram gravados (podem ser do
        // Google, de antes da fonte única). Nada é reconsultado na abertura: só o
        // botão "Recalcular pelo Qualp" troca esses números, e aí mostra o antes/depois.
        // Os valores entram como snapshot de fonte 'salvo', preso à combinação em que
        // foram gravados — assim trocar veículo/carga/rota também os invalida.
        setQualpBloqueio(null); setRecalcDiff(null); setPedagioLiberado(false); setRotaDesatualizada(false);
        // Cotação tabelada reabre no modo tabelado, com o valor final que foi gravado.
        setEnviadoRamper(false);   // outra cotação: o envio anterior não conta
        const eraTabelada = quote.tipoPrecificacao === 'tabelado';
        setModoTabelado(eraTabelada);
        setValorFinalTabelado(eraTabelada ? maskCurrency(quote.totalFreight) : '0');
        setTemIcmsTabelado(eraTabelada && (quote.icmsPercent || 0) > 0);
        setQualpRota({
            km: quote.distanceKm, pedagioCheio: quote.tolls, pedagioTag: 0,
            piso: quote.suggestedFreight > 0 ? quote.suggestedFreight : null,
            origem: quote.origin, destino: quote.destination,
            cargoType, eixos: vehicleConfigs[quote.vehicleType]?.axles,
            resolucao: null, confirmarPiso: false, idTransacao: null, fonte: 'salvo',
        });
        setActiveTab('new'); showFeedback("Editando...");
    };

    // Duplica uma cotação como NOVA: copia todos os campos, mas zera id (editingId null -> created_by
    // passa a ser quem duplicou), cronômetro do zero e não salva nada. A original fica intacta;
    // a duplicada só vira registro quando o operador salvar. Não altera a fórmula de cálculo.
    const duplicateQuote = (quote: FreightCalculation) => {
        setOrigin(quote.origin); setDestination(quote.destination); setDestinations(quote.destinations ? [...quote.destinations] : []);
        setShowMap(false); setRouteGeometry(null); setClientReference(quote.clientReference || ''); setDistanceKm(quote.distanceKm.toString());
        setVehicleType(quote.vehicleType); setWeight(quote.weight.toString()); setSelectedCustomerId(quote.customerId); setBaseFreight(maskCurrency(quote.baseFreight));
        setTolls(maskCurrency(quote.tolls)); setExtraCosts(maskCurrency(quote.extraCosts || 0)); setExtraCostsDescription(quote.extraCostsDescription || '');
        setGoodsValue(maskCurrency(quote.goodsValue)); setInsurancePercent(quote.insurancePercent.toString()); setProfitMargin(quote.profitMargin.toString());
        // Duplicada é cotação NOVA: carrega o ICMS/pagador da origem. Sem rota travada (ref null), se não
        // for manual o automático reaplica a tabela nova sobre a rota copiada.
        loadedIcmsRouteRef.current = null;
        loadedUtilRef.current = null; // nova: autopreenche o base utilitário normalmente
        setIcmsPercent(quote.icmsPercent.toString()); setIcmsManual(quote.icmsManual ?? false); setPagadorMg(quote.pagadorMg ?? false); setDisponibilidade(quote.disponibilidade || "Imediato");
        setMerchandiseType(quote.merchandiseType || '');
        setSolicitante(quote.solicitante || ''); setSolicitantePipefyId(quote.solicitantePipefyId);
        setImplemento(quote.carroceriaTipoOperacao || '');
        setOtherCosts(quote.otherCosts ? quote.otherCosts.map(c => ({ ...c })) : []);
        setEditingId(null);                       // cotação NOVA, não edição
        setElapsedSeconds(0); setIsTimerRunning(false);  // cronômetro do zero
        setOpenCostToClient(false);
        // Duplicada herda os números da origem (podem ser do Google) como snapshot
        // 'salvo', preso à mesma combinação — mudar rota/veículo/carga invalida.
        setQualpBloqueio(null); setRecalcDiff(null); setPedagioLiberado(false); setRotaDesatualizada(false);
        // Cotação tabelada reabre no modo tabelado, com o valor final que foi gravado.
        setEnviadoRamper(false);   // outra cotação: o envio anterior não conta
        const eraTabelada = quote.tipoPrecificacao === 'tabelado';
        setModoTabelado(eraTabelada);
        setValorFinalTabelado(eraTabelada ? maskCurrency(quote.totalFreight) : '0');
        setTemIcmsTabelado(eraTabelada && (quote.icmsPercent || 0) > 0);
        setQualpRota({
            km: quote.distanceKm, pedagioCheio: quote.tolls, pedagioTag: 0,
            piso: quote.suggestedFreight > 0 ? quote.suggestedFreight : null,
            origem: quote.origin, destino: quote.destination,
            cargoType, eixos: vehicleConfigs[quote.vehicleType]?.axles,
            resolucao: null, confirmarPiso: false, idTransacao: null, fonte: 'salvo',
        });
        setActiveTab('new'); showFeedback("Cotação duplicada — ajuste e salve como nova.");
    };

    const resetForm = () => {
        setOrigin(''); setDestination(''); setDestinations([]); setShowMap(false); setRouteGeometry(null); setClientReference(''); setDistanceKm('0'); setBaseFreight('0'); setTolls('0'); setExtraCosts('0');
        setExtraCostsDescription(''); setGoodsValue('0'); setWeight('0'); setSelectedCustomerId(''); setEditingId(null);
        setDisponibilidade("Imediato"); setMerchandiseType(''); setCargoType('Carga geral'); setOtherCosts([]);
        setIcmsManual(false); setPagadorMg(false); loadedIcmsRouteRef.current = null; loadedUtilRef.current = null;   // nova cotação: destrava o automático, zera o pagador MG e as travas de congelamento
        setSolicitante(''); setSolicitantePipefyId(undefined); setImplemento('');
        setQualpRota(null); setQualpBloqueio(null); setRecalcDiff(null); setPedagioLiberado(false); setRotaDesatualizada(false);
        setModoTabelado(false); setValorFinalTabelado('0'); setTemIcmsTabelado(false);
        setEnviadoRamper(false);
        setIsTimerRunning(false); setElapsedSeconds(0); setOpenCostToClient(false);
    };

    // Itens da composição de custo cobrada do cliente (reusados na tela, na cópia e no PDF).
    // Seguro = ad valorem cobrado do cliente; impostos federais destacados separadamente do frete.
    const buildCompositionItems = () => {
        const items: { label: string; value: number }[] = [
            { label: 'Frete base', value: num(baseFreight) },
            { label: 'Pedágio', value: num(tolls) },
            { label: `Seguro Ad Valorem (${insurancePercent}%)`, value: calcData.adValoremSelling },
        ];
        otherCosts.forEach(c => items.push({ label: c.label, value: c.value }));
        items.push({ label: 'Impostos federais (PIS/COFINS/CSLL/IRPJ)', value: calcData.fedTaxesAmount });
        return items;
    };

    const buildCompositionLines = () => buildCompositionItems().map(i => `${i.label}: R$ ${formatCur(i.value)}`);

    const handleCopyQuoteText = () => {
        let text = `Segue cotação conforme solicitado:

Veículo: ${vehicleType}
Valor: R$ ${formatCur(calcData.finalFreight)}
Disponibilidade: ${disponibilidade}`;
        if (openCostToClient) {
            text += `\n\nComposição do valor:\n`
                + buildCompositionLines().map(l => `• ${l}`).join('\n')
                + `\n• Total: R$ ${formatCur(calcData.finalFreight)}`;
        }
        navigator.clipboard.writeText(text).then(() => showFeedback("Copiado!"));
    };

    // Envio rápido: copia o texto da cotação e sinaliza no CRM (salva como pendente),
    // permanecendo na tela sem resetar o formulário.
    const handleQuickSend = () => {
        handleCopyQuoteText();
        // keepStatus=true: numa cotação já salva, preserva o status (Ganha continua Ganha, não rebaixa).
        // Cotação nova entra como 'pending' normalmente.
        saveQuote('pending', false, true, true);
    };

    // ===== Importar Solicitação (leitura inteligente via Gemini) =====
    const fileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1] || '');
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });

    const openImportModal = () => {
        setImportText(''); setImportFile(null); setImportSummary(null); setImportLoading(false);
        setShowImportModal(true);
    };

    const handleImportFile = async (file: File | undefined) => {
        if (!file) return;
        try {
            const base64 = await fileToBase64(file);
            setImportFile({ name: file.name, base64, type: file.type });
            setImportText('');
        } catch {
            showFeedback('Falha ao ler o arquivo.', 'error');
        }
    };

    // Preenche os campos do formulário com o JSON interpretado. Não calcula nada.
    const applyParsedFields = (data: any) => {
        const norm = (v: any) => (v === null || v === undefined || String(v).trim() === '' || String(v).toLowerCase() === 'null') ? '' : String(v).trim();
        const origem = norm(data.origem);
        const destino = norm(data.destino);
        const tipoCarga = norm(data.tipoCarga);
        const pesoRaw = norm(data.peso);
        const valorRaw = norm(data.valorMercadoria);
        const disp = norm(data.disponibilidade).toLowerCase();
        const sol = norm(data.solicitante);
        const obs = norm(data.observacoes);

        if (origem) setOrigin(origem);
        if (destino) setDestination(destino);
        // Mercadoria agora é select (16 opções): só preenche se o texto lido casar com uma opção; senão deixa o operador escolher.
        if (tipoCarga) { const op = matchMercadoriaOption(tipoCarga); if (op) setMerchandiseType(op); }

        const pesoNum = parseFloat(pesoRaw.replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.'));
        if (pesoRaw && !isNaN(pesoNum)) setWeight(String(pesoNum));

        const valorNum = parseFloat(valorRaw.replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.'));
        if (valorRaw && !isNaN(valorNum)) setGoodsValue(maskCurrency(valorNum));

        let dispLabel = '';
        if (disp.includes('imediato')) { setDisponibilidade('Imediato'); dispLabel = 'Imediato'; }
        else if (disp.includes('agendad') || disp.includes('program')) { setDisponibilidade('Conforme programação'); dispLabel = 'Conforme programação'; }

        if (sol) {
            // Importação inteligente: preenche o solicitante como texto livre (sem id do Pipefy;
            // o operador pode confirmar o vínculo digitando e escolhendo no autocomplete).
            setSolicitante(sol);
            setSolicitantePipefyId(undefined);
        }

        // Resumo para conferência do operador.
        const blank = '— (em branco)';
        const summary = [
            { label: 'Origem', value: origem || blank, filled: !!origem },
            { label: 'Destino', value: destino || blank, filled: !!destino },
            { label: 'Tipo de Mercadoria', value: tipoCarga || blank, filled: !!tipoCarga },
            { label: 'Peso (kg)', value: (pesoRaw && !isNaN(pesoNum)) ? String(pesoNum) : blank, filled: !!(pesoRaw && !isNaN(pesoNum)) },
            { label: 'Valor da Mercadoria', value: (valorRaw && !isNaN(valorNum)) ? `R$ ${formatCur(valorNum)}` : blank, filled: !!(valorRaw && !isNaN(valorNum)) },
            { label: 'Disponibilidade', value: dispLabel || blank, filled: !!dispLabel },
            { label: 'Solicitante', value: sol || blank, filled: !!sol },
            { label: 'Observações', value: obs || blank, filled: !!obs },
        ];
        setImportSummary(summary);
    };

    const handleImportParse = async () => {
        if (!importFile && !importText.trim()) {
            showFeedback('Cole um texto ou anexe um arquivo.', 'info');
            return;
        }
        setImportLoading(true);
        try {
            const result = importFile
                ? await parseRequest({ fileBase64: importFile.base64, fileType: importFile.type })
                : await parseRequest({ content: importText.trim() });
            if (result?.error) {
                showFeedback(`Erro na leitura: ${result.error}`, 'error');
            } else {
                applyParsedFields(result);
                showFeedback('Solicitação interpretada! Confira os campos.');
            }
        } catch (e: any) {
            showFeedback(`Falha ao interpretar: ${e.message}`, 'error');
        } finally {
            setImportLoading(false);
        }
    };

    // Envia a cotação salva como card no Ramper Pipeline (etapa "Cotações"). Erro é exibido, nunca engolido.
    // `quoteOverride` deixa o botão passar a cotação recém-salva sem depender do
    // setState ter propagado. Devolve true quando o card foi criado.
    // Sempre PERMANECE na tela: o envio virou botão da tela de resultado, e o
    // operador pode querer mandar pro Pipefy também sem refazer nada.
    const handleSendToRamper = async (quoteOverride?: FreightCalculation): Promise<boolean> => {
        const customerName = customers.find(c => c.id === selectedCustomerId)?.name || '';
        // O Ramper exige uma organização (ou pessoa). Sem cliente, o card não pode ser criado.
        if (!customerName && !solicitante) {
            showFeedback('Selecione um cliente (ou solicitante) na cotação antes de mandar pro Ramper.', 'error');
            return false;
        }
        setRamperSending(true);
        try {
            // Título: "[REF] - Cotação de Frete SPOT - origem x destino" (omite o prefixo se não houver Ref).
            const refPart = clientReference.trim() ? `${clientReference.trim()} - ` : '';
            const title = `${refPart}Cotação de Frete SPOT - ${origin || '—'} x ${destination || '—'}`;

            // Campos personalizados do card: da cotação salva (lastSavedQuote), com fallback pro form atual.
            const q = quoteOverride ?? lastSavedQuote;
            const solicitanteVal = ((q?.solicitante ?? solicitante) || '').trim();
            const documentoVal = ((q?.clientReference ?? clientReference) || '').trim();
            // Tipo de Veículo = veículo + carroceria, no formato que o time usa (ex.: "Carreta Simples Sider").
            // Pula carroceria vazia ou "N/A".
            const veiculoVal = String(q?.vehicleType ?? vehicleType ?? '').trim();
            const carroceriaRaw = String(q?.carroceriaTipoOperacao ?? implemento ?? '').trim();
            const carroceriaVal = carroceriaRaw && carroceriaRaw.toUpperCase() !== 'N/A' ? carroceriaRaw : '';
            const tipoDeVeiculo = [veiculoVal, carroceriaVal].filter(Boolean).join(' ');
            // Valor da carga (número); só envia quando > 0, senão fica em branco no card.
            const valorCargaNum = Number(q?.goodsValue ?? num(goodsValue));
            // Data do card = data de criação da cotação (AAAA-MM-DD), sobrescreve o +7 padrão do Ramper.
            const createdMs = q?.createdAt ?? Date.now();
            const cd = new Date(createdMs);
            const closeIn = `${cd.getFullYear()}-${String(cd.getMonth() + 1).padStart(2, '0')}-${String(cd.getDate()).padStart(2, '0')}`;
            // Responsável do card = quem CRIOU o frete (createdBy). Resolve o e-mail pelo perfil (users);
            // se o criador for o próprio remetente, usa o e-mail dele. O casamento com o Ramper é na Edge Function.
            const criadorId = q?.createdBy || currentUser?.id;
            const criadorNome = q?.createdByName || users.find(u => u.id === criadorId)?.name || currentUser?.name || null;
            const responsavelEmail = (criadorId && users.find(u => u.id === criadorId)?.username)
                || (criadorId === currentUser?.id ? currentUser?.username : '') || '';

            const res = await createRamperCard({
                title,
                value: calcData.finalFreight,
                basePrice: num(baseFreight), // vai na nota do card (campo history)
                organizationName: customerName || solicitante, // garante uma organização
                personName: solicitante,
                stageName: 'Cotações',
                // Campos personalizados + data (vazio vira undefined -> não é enviado, fica em branco).
                solicitante: solicitanteVal || undefined,
                tipoDeVeiculo: tipoDeVeiculo || undefined,
                documento: documentoVal || undefined,
                valorCarga: valorCargaNum > 0 ? valorCargaNum : undefined,
                closeIn,
                responsavelEmail: responsavelEmail || undefined,
            });
            if (res?.error) {
                console.error('Ramper error:', res.error);
                showFeedback(`Falha ao criar card no Ramper: ${res.error}`, 'error');
                return false;
            } else {
                showFeedback('Card criado no Ramper');
                // Avisa quando o responsável não casou (card ficou com o padrão do Ramper). Não é erro.
                if (res?.responsavel && res.responsavel.email && !res.responsavel.casou) {
                    console.warn('Ramper: responsável não casou:', res.responsavel.email);
                    showFeedback(`Card criado, mas o responsável (${res.responsavel.email}) não casou no Ramper — ficou o padrão.`, 'info');
                }
                // Acompanhamento de Negociações (Camada 1): entra na lista quando vai pro Ramper.
                // Dormente enquanto MOSTRAR_NEGOCIACOES=false. Best-effort: nunca atrapalha o envio.
                if (MOSTRAR_NEGOCIACOES && currentUser) {
                    try {
                        const rr: any = (res as any)?.result;
                        const rampId = rr?.id ?? rr?.opportunity?.id ?? rr?.data?.id ?? rr?.get_item?.id ?? rr?.itens?.[0]?.id ?? null;
                        await createNegociacaoFromRamper({
                            cotacaoId: q?.id || editingId || '',
                            propostaNumero: q?.proposalNumber || null,
                            clienteNome: customerName || solicitanteVal || null,
                            rota: `${origin || '—'} x ${destination || '—'}`,
                            mercadoria: (q?.merchandiseType ?? merchandiseType) || null,
                            veiculo: veiculoVal || null,
                            valorCotado: Number(q?.totalFreight ?? calcData.finalFreight) || null,
                            ramperOpportunityId: rampId ? String(rampId) : null,
                            // Dono da negociação = quem CRIOU o frete (createdBy), não quem mandou pro Ramper.
                        }, criadorId || currentUser.id, criadorNome || currentUser.name);
                    } catch (e) { console.error('negociacao auto-entry:', e); }
                }
                return true;
            }
        } catch (e: any) {
            console.error('Ramper exception:', e);
            showFeedback('Falha ao criar card no Ramper, verifique a conexão', 'error');
            return false;
        } finally {
            setRamperSending(false);
        }
    };

    const generatePDF = async () => {
        const doc = new jsPDF();
        const primaryColor = "#1d6fb8"; // OmniCargo Blue
        const grayColor = "#64748b";

        showFeedback("Gerando PDF...");

        // Helper to load image
        const loadImage = (src: string): Promise<HTMLImageElement> => {
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.src = src;
                img.onload = () => resolve(img);
                img.onerror = reject;
            });
        };

        try {
            const [logoFull, logoIcon] = await Promise.all([
                loadImage('/logo-full.png').catch(() => null),
                loadImage('/logo-icon.jpg').catch(() => null)
            ]);

            // --- WATERMARK ---
            if (logoIcon) {
                // Set transparency
                (doc as any).saveGraphicsState();
                (doc as any).setGState(new (doc as any).GState({ opacity: 0.05 }));

                const pageWidth = doc.internal.pageSize.width;
                const pageHeight = doc.internal.pageSize.height;
                const imgWidth = 120;
                const imgHeight = 120;
                const x = (pageWidth - imgWidth) / 2;
                const y = (pageHeight - imgHeight) / 2;

                doc.addImage(logoIcon, 'JPEG', x, y, imgWidth, imgHeight);
                (doc as any).restoreGraphicsState();
            }

            // --- HEADER ---
            if (logoFull) {
                const logoRatio = logoFull.width / logoFull.height;
                const logoW = 50;
                const logoH = logoW / logoRatio;
                doc.addImage(logoFull, 'PNG', 15, 10, logoW, logoH);
            } else {
                doc.setFontSize(22);
                doc.setTextColor(primaryColor);
                doc.setFont("helvetica", "bold");
                doc.text("OmniCargo", 15, 20);
            }

            // Top Line
            doc.setDrawColor(200, 200, 200);
            doc.setLineWidth(0.5);
            doc.line(15, 30, 195, 30);

            // Orange accent line
            doc.setDrawColor(243, 112, 33);
            doc.setLineWidth(1);
            doc.line(15, 30, 45, 30);


            // --- INFO ---
            const customerName = customers.find(c => c.id === selectedCustomerId)?.name || "Cliente não informado";
            const todayStr = new Date().toLocaleDateString('pt-BR');
            const quoteNum = editingId ? (history.find(h => h.id === editingId)?.proposalNumber || "N/A") : "NOVA";

            doc.setFontSize(14);
            doc.setTextColor(0, 0, 0);
            doc.setFont("helvetica", "bold");
            doc.text("PROPOSTA COMERCIAL", 15, 42);

            doc.setFontSize(9);
            doc.setFont("helvetica", "bold");
            doc.text(`Para:`, 15, 52);
            doc.setFont("helvetica", "normal");
            doc.text(customerName, 25, 52);

            doc.setFont("helvetica", "bold");
            doc.text(`De:`, 15, 57);
            doc.setFont("helvetica", "normal");
            doc.text("Omnicargo Transportes", 25, 57);

            doc.setFont("helvetica", "bold");
            doc.text(`Data:`, 120, 52);
            doc.setFont("helvetica", "normal");
            doc.text(todayStr, 130, 52);

            doc.setFont("helvetica", "bold");
            doc.text(`Cotação:`, 120, 57);
            doc.setFont("helvetica", "normal");
            doc.text(quoteNum, 135, 57);

            doc.text("A Omnicargo Transportes tem o prazer de apresentar esta proposta para a realização dos serviços de transporte conforme descrito abaixo.", 15, 68);

            // --- SECTIONS (Compact Layout) ---
            let currentY = 80;
            const spacing = 5;
            const indent = 20;

            // 1. Objeto
            doc.setFont("helvetica", "bold");
            doc.text("1. Objeto da Proposta", 15, currentY); currentY += spacing + 1;
            doc.setFont("helvetica", "normal");

            doc.text(`•   Origem: ${origin || "A definir"}`, indent, currentY); currentY += spacing;
            doc.text(`•   Destino: ${destination || "A definir"}`, indent, currentY); currentY += spacing;
            doc.text(`•   Veículo: ${vehicleType}`, indent, currentY);
            doc.text(`•   Mercadoria: ${merchandiseType || "Geral"}`, indent + 80, currentY); currentY += spacing;
            doc.text(`•   Qtd: 01 viagem`, indent, currentY);
            doc.text(`•   Prazo Coleta: ${disponibilidade}`, indent + 80, currentY); currentY += spacing + 3;

            // 2. Valor
            doc.setFont("helvetica", "bold");
            doc.text("2. Valor do Serviço", 15, currentY); currentY += spacing + 1;
            doc.setFont("helvetica", "normal");

            const freightVal = calcData.finalFreight;
            const formattedVal = freightVal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

            doc.setFont("helvetica", "bold");
            doc.text(`Valor Total: R$ ${formattedVal}`, indent, currentY); currentY += spacing;
            doc.setFont("helvetica", "normal");
            doc.setFontSize(8);
            doc.text(`(CNPJ Recebedor: 51.653.821/0001-68)`, indent, currentY);
            doc.setFontSize(9);
            currentY += spacing + 3;

            // 2.1 Composição aberta ao cliente (opcional)
            if (openCostToClient) {
                doc.setFont("helvetica", "bold");
                doc.text("Composição do valor:", indent, currentY); currentY += spacing;
                doc.setFont("helvetica", "normal");
                doc.setFontSize(8);
                buildCompositionLines().forEach(line => {
                    doc.text(`-   ${line}`, indent + 2, currentY); currentY += spacing - 1;
                });
                doc.setFontSize(9);
                currentY += 3;
            }

            // 3. Detalhes
            doc.setFont("helvetica", "bold");
            doc.text("3. Detalhes do Serviço", 15, currentY); currentY += spacing + 1;
            doc.setFont("helvetica", "normal");

            let detailsText = `•   Incluso: Frete, pedágio${num(insurancePercent) > 0 ? ', seguro' : ''} e impostos.`;
            if (otherCosts.length > 0) {
                detailsText += " Adicionais inclusos: " + otherCosts.map(c => `${c.label} (R$ ${formatCur(c.value)})`).join(', ') + ".";
            }
            detailsText += " Modalidade: Rodoviário dedicado.";

            const splitDetails = doc.splitTextToSize(detailsText, 175);
            doc.text(splitDetails, indent, currentY);
            currentY += (splitDetails.length * spacing) + 3;

            // 4/5. Condições e Diferenciais
            doc.setFont("helvetica", "bold");
            doc.text("4. Condições e Diferenciais", 15, currentY); currentY += spacing + 1;
            doc.setFont("helvetica", "normal");
            doc.text(`•   Prazo conforme programação.`, indent, currentY); currentY += spacing;
            doc.text(`•   Monitoramento em tempo real e eficiência logística.`, indent, currentY); currentY += spacing + 6;

            // 6. Final
            doc.setFont("helvetica", "bold");
            doc.text("5. Considerações Finais", 15, currentY); currentY += spacing + 1;
            doc.setFont("helvetica", "normal");
            doc.text("Em caso de dúvidas, estamos à disposição.", indent, currentY); currentY += 12;

            // --- SIGNATURE ---
            doc.setFont("helvetica", "bold");
            doc.text(currentUser?.name || "Omnicargo Transportes", 15, currentY); currentY += 5;
            doc.setFont("helvetica", "normal");
            doc.setFontSize(8);
            doc.text("Omnicargo Transportes", 15, currentY); currentY += 4;

            const userEmail = currentUser?.username || "contato@omnicargo.com.br";
            const userPhone = "(27) 99730-9770";

            doc.setTextColor(primaryColor);
            doc.text(userEmail, 15, currentY);
            doc.setTextColor(0, 0, 0);
            doc.text(" | " + userPhone, 15 + doc.getTextWidth(userEmail) + 2, currentY);

            // --- FOOTER ---
            const pageHeight = doc.internal.pageSize.height;
            const footerY = pageHeight - 20;

            doc.setDrawColor(200, 200, 200);
            doc.line(15, footerY - 5, 195, footerY - 5);
            doc.setDrawColor(243, 112, 33);
            doc.line(170, footerY - 5, 195, footerY - 5);

            // Left: Phones
            if (logoFull) {
                // Try to render logo again small in footer or just text
                // Let's use text for cleaner footer as per request "make part of composition" - we used it on header. 
                // We can put the icon on the right
                if (logoIcon) {
                    doc.addImage(logoIcon, 'JPEG', 185, footerY - 2, 10, 10);
                }
            }

            doc.setFontSize(7);
            doc.setTextColor(grayColor);
            doc.text("Tel: +55 27 99730-9770 | +55 27 3207-1920", 15, footerY);
            doc.text("Email: contato@omnicargo.com.br", 15, footerY + 3);
            doc.text("End: Cândido Portinari, 27, Ed. River Center, Sl 401, Vitória - ES", 15, footerY + 6);
            doc.text("www.omnicargo.com.br", 15, footerY + 9);

            // OPEN POPUP
            const blob = doc.output('bloburl');
            window.open(blob, '_blank', 'width=800,height=1000');

        } catch (error) {
            console.error(error);
            showFeedback("Erro ao gerar PDF.", "error");
        }
    };

    const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => setAppLogo(reader.result as string);
            reader.readAsDataURL(file);
        }
    };

    if (recoveryMode) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[#f8f9fa] p-6">
                <div className="bg-white w-full max-w-md rounded-xl border border-[#e5e7eb] shadow-sm p-10 space-y-6">
                    <div className="flex flex-col items-center">
                        <div className="w-20 h-20 bg-[#f9fafb] border border-[#e5e7eb] p-4 rounded-xl mb-5 flex items-center justify-center overflow-hidden">
                            {appLogo ? <img src={appLogo} alt="Logo" className="w-full h-full object-contain" /> : <DefaultLogo className="w-full h-full" />}
                        </div>
                        <h1 className="text-xl font-medium text-[#111827] tracking-tight text-center">Defina sua senha</h1>
                        <p className="text-sm font-normal text-[#6b7280] text-center mt-1">Crie a senha de acesso à sua conta OmniFlow.</p>
                    </div>
                    <form onSubmit={handleSetPassword} className="space-y-4">
                        <input type="password" autoComplete="new-password" className="w-full px-4 py-3 bg-[#f9fafb] border border-[#e5e7eb] rounded-lg font-normal text-[#111827] outline-none focus:border-[#1d6fb8] transition-colors" placeholder="Nova senha (mín. 6 caracteres)" value={newPassword} onChange={e => setNewPassword(e.target.value)} required />
                        <button type="submit" disabled={savingPassword} className="w-full py-3 bg-[#1d6fb8] text-white rounded-lg font-medium text-sm cursor-pointer hover:bg-[#1a5f9e] active:scale-[0.99] transition-all disabled:opacity-50">
                            {savingPassword ? 'Salvando...' : 'Definir senha e entrar'}
                        </button>
                    </form>
                </div>
            </div>
        );
    }

    if (authLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[#f8f9fa]">
                <p className="text-sm font-normal text-[#6b7280]">Carregando...</p>
            </div>
        );
    }

    if (!currentUser) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[#f8f9fa] p-6">
                <div className="bg-white w-full max-w-md rounded-xl border border-[#e5e7eb] shadow-sm p-10 space-y-8">
                    <div className="flex flex-col items-center">
                        <div className="w-20 h-20 bg-[#f9fafb] border border-[#e5e7eb] p-4 rounded-xl mb-5 flex items-center justify-center overflow-hidden">
                            {appLogo ? <img src={appLogo} alt="Logo" className="w-full h-full object-contain" /> : <DefaultLogo className="w-full h-full" />}
                        </div>
                        <h1 className="text-2xl font-medium text-[#111827] tracking-tight text-center leading-none">OMNIFLOW</h1>
                    </div>
                    <form onSubmit={handleLogin} className="space-y-4">
                        <input type="email" autoComplete="email" className="w-full px-4 py-3 bg-[#f9fafb] border border-[#e5e7eb] rounded-lg font-normal text-[#111827] outline-none focus:border-[#1d6fb8] transition-colors" placeholder="E-mail" value={loginForm.username} onChange={e => setLoginForm({ ...loginForm, username: e.target.value })} required />
                        <input type="password" autoComplete="current-password" className="w-full px-4 py-3 bg-[#f9fafb] border border-[#e5e7eb] rounded-lg font-normal text-[#111827] outline-none focus:border-[#1d6fb8] transition-colors" placeholder="Senha" value={loginForm.password} onChange={e => setLoginForm({ ...loginForm, password: e.target.value })} required />
                        <button type="submit" onClick={handleLogin} className="w-full py-3 bg-[#1d6fb8] text-white rounded-lg font-medium text-sm cursor-pointer hover:bg-[#1a5f9e] active:scale-[0.99] transition-all disabled:opacity-50" disabled={loginSubmitting}>
                            {loginSubmitting ? 'Entrando...' : 'Acessar'}
                        </button>
                    </form>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex flex-col md:flex-row bg-[#f8f9fa]">
            <aside className="w-full md:w-64 bg-white border-r border-[#e5e7eb] text-[#111827] flex flex-col sticky top-0 md:h-screen z-10">
                <div className="p-6 flex items-center gap-3">
                    <div className="w-10 h-10 bg-[#f9fafb] border border-[#e5e7eb] p-1.5 rounded-lg flex items-center justify-center overflow-hidden">
                        {appLogo ? <img src={appLogo} alt="Logo" className="w-full h-full object-contain" /> : <DefaultLogo className="w-full h-full" />}
                    </div>
                    <h1 className="text-lg font-medium tracking-tight leading-none text-[#111827]">Omni<span className="text-[#1d6fb8]">Flow</span></h1>
                </div>
                <nav className="flex-1 px-3 space-y-1 mt-2">
                    {[
                        { id: 'dashboard', icon: BarChart3, label: 'Dashboard', adminOnly: true },
                        { id: 'new', icon: PlusCircle, label: 'Nova Cotação' },
                        { id: 'history', icon: History, label: 'Histórico' },
                        { id: 'tracking', icon: Activity, label: 'Acompanhamento' },
                        // Cadastro Rápido (Fase 2): visível a todos os usuários logados.
                        { id: 'cadastro-motorista', icon: IdCard, label: 'Cadastro Rápido' },
                        // Fast Delivery (Bloco 2): só prévia, nada é gravado ainda.
                        { id: 'fast-delivery', icon: Zap, label: 'Fast Delivery' },
                        { id: 'prospeccao', icon: Target, label: 'Meu CRM', adminOnly: true },
                        // Contato Diário migrou pro submenu "Ações do Comercial" (abaixo).
                        { id: 'trash', icon: Trash2, label: 'Lixeira', adminOnly: true },
                        // CRM ocultado: comercial migrou pro Ramper. Código/dados preservados.
                        // Reversível: basta descomentar a linha abaixo pra reativar o item de menu.
                        // { id: 'crm', icon: List, label: 'CRM' },
                    ].filter(item => !item.adminOnly || currentUser.role === 'master').map(item => (
                        <button key={item.id} onClick={() => { setActiveTab(item.id as any); if (item.id !== 'history' && item.id !== 'dashboard') resetForm(); }} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${activeTab === item.id ? 'bg-[#eff6ff] text-[#1d6fb8]' : 'text-[#6b7280] hover:bg-[#f9fafb] hover:text-[#111827]'}`}>
                            <item.icon className="w-[18px] h-[18px]" strokeWidth={1.75} />
                            <span className="font-medium text-sm">{item.label}</span>
                        </button>
                    ))}

                    {/* Submenu "Ações do Comercial" — OCULTO por padrão (MOSTRAR_ACOES_COMERCIAL=false).
                        Só reorganiza/renomeia itens; a trava por papel é preservada: os 3 de gestão
                        (master) e o Registrar (analista). Reversível: flip do interruptor pra revelar. */}
                    {MOSTRAR_ACOES_COMERCIAL && (() => {
                        const filhos = [
                            { id: 'contato-diario', icon: UserCheck, label: 'Minha Carteira', master: true },
                            { id: 'cd-cobranca', icon: PieChart, label: 'Contato Diário · Análise', master: true },
                            { id: 'cd-registro', icon: FileText, label: 'Contato Diário · Registrar', master: false },
                            // Acompanhamento de Negociações: transparência de time (todos veem), nasce OCULTO.
                            ...(MOSTRAR_NEGOCIACOES ? [{ id: 'negocios', icon: Activity, label: 'Acompanhamento de Negociações', master: false }] : []),
                        ].filter(f => !f.master || currentUser.role === 'master');
                        if (!filhos.length) return null;
                        return (
                            <div>
                                <button onClick={() => setAcoesAbertas(v => !v)} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[#6b7280] hover:bg-[#f9fafb] hover:text-[#111827] transition-colors">
                                    <Layers className="w-[18px] h-[18px]" strokeWidth={1.75} />
                                    <span className="font-medium text-sm flex-1 text-left">Ações do Comercial</span>
                                    <ChevronDown className={`w-4 h-4 transition-transform ${acoesAbertas ? '' : '-rotate-90'}`} strokeWidth={1.75} />
                                </button>
                                {acoesAbertas && (
                                    <div className="ml-4 pl-2 border-l border-[#e5e7eb] space-y-1 mt-1">
                                        {filhos.map(f => (
                                            <button key={f.id} onClick={() => { setActiveTab(f.id as any); resetForm(); }} className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${activeTab === f.id ? 'bg-[#eff6ff] text-[#1d6fb8]' : 'text-[#6b7280] hover:bg-[#f9fafb] hover:text-[#111827]'}`}>
                                                <f.icon className="w-4 h-4" strokeWidth={1.75} />
                                                <span className="font-medium text-[13px]">{f.label}</span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })()}

                    {/* Painel TV: abre o painel público em nova aba. Token vem do banco
                        (RLS só p/ logado), nunca do bundle. Visível só p/ master, como o Dashboard. */}
                    {currentUser.role === 'master' && painelTvToken && (
                        <a
                            href={`https://omniflow-1-gamma.vercel.app/painel-tv?k=${painelTvToken}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[#6b7280] hover:bg-[#f9fafb] hover:text-[#111827] transition-colors"
                        >
                            <Tv className="w-[18px] h-[18px]" strokeWidth={1.75} />
                            <span className="font-medium text-sm">Painel TV</span>
                        </a>
                    )}
                </nav>
                <div className="p-3 mt-auto space-y-1 border-t border-[#e5e7eb]">
                    {/* Chave de emergência: só master. Fica aqui por ser lugar fixo e de
                        um clique — é para usar com o Qualp fora do ar. O modal de
                        confirmação protege contra acionamento acidental, e a RLS
                        protege contra quem não é master chamar a API direto. */}
                    {currentUser.role === 'master' && (
                        <button
                            onClick={() => setShowEmergenciaModal(true)}
                            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${emergenciaLigada
                                ? 'bg-amber-100 text-amber-900 hover:bg-amber-200'
                                : 'text-[#6b7280] hover:bg-[#f9fafb] hover:text-[#111827]'}`}
                        >
                            <AlertTriangle className="w-[18px] h-[18px]" strokeWidth={1.75} />
                            <span className="font-medium text-sm flex-1 text-left">
                                {emergenciaLigada ? 'Emergência LIGADA' : 'Modo emergência'}
                            </span>
                            {emergenciaLigada && (
                                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0" />
                            )}
                        </button>
                    )}
                    {currentUser.role === 'master' && (
                        <button onClick={() => setShowConfigModal(true)} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[#6b7280] hover:bg-[#f9fafb] hover:text-[#111827] transition-colors">
                            <Settings className="w-[18px] h-[18px]" strokeWidth={1.75} />
                            <span className="font-medium text-sm">Configurações</span>
                        </button>
                    )}
                    <button onClick={() => { setNewPassword(''); setShowChangePassword(true); }} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[#6b7280] hover:bg-[#f9fafb] hover:text-[#111827] transition-colors">
                        <Lock className="w-[18px] h-[18px]" strokeWidth={1.75} />
                        <span className="font-medium text-sm">Trocar senha</span>
                    </button>
                    <div className="flex items-center gap-3 px-3 py-2">
                        <div className="w-8 h-8 rounded-full bg-[#1d6fb8] flex items-center justify-center font-medium text-xs text-white">{currentUser.name.charAt(0)}</div>
                        <div className="flex-1 min-w-0"><p className="text-sm font-medium text-[#111827] truncate">{currentUser.name}</p></div>
                        <button onClick={handleLogout} className="p-1.5 text-[#6b7280] hover:text-red-500 rounded-md hover:bg-[#f9fafb] transition-colors"><LogOut className="w-4 h-4" strokeWidth={1.75} /></button>
                    </div>
                </div>
            </aside>

            <main className="flex-1 overflow-y-auto pb-20 relative z-0">
                <header className="bg-white border-b border-[#e5e7eb] px-8 py-5 sticky top-0 z-40 flex justify-between items-center">
                    <h2 className="text-base font-medium text-[#111827]">
                        {editingId ? 'Editando Registro' :
                            activeTab === 'dashboard' ? 'Visão Geral Executiva' :
                                activeTab === 'crm' ? 'CRM' :
                                    activeTab === 'tracking' ? 'Acompanhamento de Cargas' :
                                        activeTab === 'prospeccao' ? 'Prospecção · Mini CRM' :
                                        activeTab === 'contato-diario' ? 'Contato Diário · Carteira' :
                                        activeTab === 'trash' ? 'Lixeira' :
                                        activeTab === 'cadastro-motorista' ? 'Cadastro Rápido · Motorista' :
                                        activeTab === 'fast-delivery' ? 'Fast Delivery · Prévia' :
                                            activeTab === 'new' ? 'Nova Cotação' : 'Histórico'}
                    </h2>
                    {activeTab === 'history' && (
                        <div className="relative w-72">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6b7280]" strokeWidth={1.75} />
                            <input type="text" placeholder="Buscar..." className="w-full pl-9 pr-4 py-2 bg-[#f9fafb] border border-[#e5e7eb] rounded-lg text-sm font-normal text-[#111827] outline-none focus:border-[#1d6fb8] transition-colors" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                        </div>
                    )}
                </header>

                <div className="p-8 max-w-7xl mx-auto space-y-8">
                    {/* Rota do CRM DESATIVADA (comercial migrou pro Ramper). Componente CRMBoard e dados
                        preservados. Reversível: troque `false` por `activeTab === 'crm'` pra reativar. */}
                    {false && (
                        <div className="h-full animate-fade-in">
                            <CRMBoard
                                quotes={history}
                                onUpdateStatus={handleCRMStatusUpdate}
                                customers={customers}
                                systemConfig={fedTaxes}
                            />
                        </div>
                    )}

                    {activeTab === 'tracking' && <PipefyBoard />}

                    {/* Cadastro Rápido — Motorista (Fase 2). Isolado: não toca em cotação,
                        faturamento nem Pipefy. Visível a todos os usuários logados. */}
                    {activeTab === 'fast-delivery' && (
                        <FastDelivery marginThreshold={marginThreshold} autor={{ id: currentUser.id, name: currentUser.name }} />
                    )}

                    {activeTab === 'cadastro-motorista' && (
                        <CadastroMotorista autor={{ id: currentUser.id, name: currentUser.name }} />
                    )}

                    {activeTab === 'prospeccao' && currentUser.role === 'master' && (
                        <ProspeccaoBoard currentUser={{ id: currentUser.id, name: currentUser.name }} onFeedback={showFeedback} />
                    )}

                    {activeTab === 'contato-diario' && currentUser.role === 'master' && (
                        <CarteiraBoard currentUser={{ id: currentUser.id, name: currentUser.name }} onFeedback={showFeedback} />
                    )}

                    {activeTab === 'cd-registro' && (
                        <RegistroContatoBoard currentUser={{ id: currentUser.id, name: currentUser.name }} onFeedback={showFeedback} />
                    )}

                    {activeTab === 'cd-cobranca' && currentUser.role === 'master' && (
                        <PainelCobrancaBoard currentUser={{ id: currentUser.id, name: currentUser.name }} onFeedback={showFeedback} />
                    )}

                    {/* Acompanhamento de Negociações: visível a todos os papéis (transparência de time). */}
                    {activeTab === 'negocios' && (
                        <NegociacoesBoard currentUser={{ id: currentUser.id, name: currentUser.name, role: currentUser.role }} onFeedback={showFeedback} />
                    )}

                    {activeTab === 'dashboard' && (
                        <div className="space-y-8 animate-fade-in-up">
                            {/* Filtro de Período */}
                            <div className="flex justify-between items-end bg-white p-6 rounded-xl shadow-sm border border-[#e5e7eb]">
                                <div>
                                    <h3 className="text-sm font-medium uppercase text-[#111827] flex items-center gap-2"><Calendar className="w-4 h-4 text-blue-500" /> Período Analítico</h3>
                                    <p className="text-[10px] font-medium text-[#6b7280] mt-1">Análise baseada na data de fechamento da proposta.</p>
                                </div>
                                <div className="flex items-center gap-4">
                                    <div className="text-right mr-2">
                                        <p className="text-[10px] font-medium text-[#6b7280] uppercase">Cotações no mês</p>
                                        <p className="text-lg font-medium text-[#111827]">{dashboardData.filteredCount}</p>
                                    </div>
                                    <input type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} className="bg-[#f9fafb] border border-[#e5e7eb] rounded-xl px-4 py-2 font-medium text-[#111827] outline-none focus:border-[#1d6fb8] transition-colors uppercase text-xs" />
                                </div>
                            </div>

                            {/* ===== Faturamento do mês (TMS) — atualizado a cada 2 min pelo cron, lido via realtime ===== */}
                            <div className="bg-gradient-to-br from-emerald-600 to-emerald-700 text-white p-6 rounded-2xl shadow-sm flex items-center justify-between gap-4">
                                <div>
                                    <p className="text-[11px] font-medium uppercase tracking-wider text-white/70 flex items-center gap-1.5"><DollarSign className="w-3.5 h-3.5" /> Faturamento do mês · TMS</p>
                                    <p className="text-4xl font-semibold mt-1 leading-none">{faturamento?.total != null ? `R$ ${formatCur(faturamento.total)}` : '—'}</p>
                                    <p className="text-[11px] font-medium text-white/70 mt-1.5">{faturamento?.ctes != null ? `${faturamento.ctes} CTes emitidos no mês` : 'aguardando primeira leitura'}</p>
                                </div>
                                <div className="text-right shrink-0">
                                    {faturamento?.status === 'erro' && (
                                        <p className="text-[10px] font-medium text-amber-200 mb-1 flex items-center justify-end gap-1"><AlertTriangle className="w-3 h-3" /> falha na última leitura</p>
                                    )}
                                    <p className="text-[10px] font-medium text-white/60 uppercase tracking-wider">Atualizado</p>
                                    <p className="text-sm font-medium mt-0.5">
                                        {faturamento?.atualizadoEm ? (() => {
                                            const ms = Date.now() - new Date(faturamento.atualizadoEm).getTime();
                                            const min = Math.floor(ms / 60000);
                                            const rel = min <= 0 ? 'agora há pouco' : min === 1 ? 'há 1 min' : `há ${min} min`;
                                            return rel;
                                        })() : '—'}
                                    </p>
                                    <p className="text-[10px] font-medium text-white/50 mt-0.5">{faturamento?.atualizadoEm ? new Date(faturamento.atualizadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}</p>
                                </div>
                            </div>

                            {/* ===== Painel do Dia & Insights (determinístico; mesma fonte do relatório) ===== */}
                            <div className="space-y-5">
                                {/* Números do dia em destaque */}
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                    <div className="bg-gradient-to-br from-[#1d6fb8] to-[#155a99] text-white p-5 rounded-2xl shadow-sm">
                                        <p className="text-[11px] font-medium uppercase tracking-wider text-white/70">Cotações hoje</p>
                                        <p className="text-4xl font-semibold mt-1 leading-none">{insights.hoje.cotadas}</p>
                                    </div>
                                    <div className="bg-white border border-[#e5e7eb] p-5 rounded-2xl shadow-sm">
                                        <p className="text-[11px] font-medium uppercase tracking-wider text-[#6b7280] flex items-center gap-1.5"><Send className="w-3.5 h-3.5 text-emerald-500" /> Fechadas hoje</p>
                                        <p className="text-4xl font-semibold mt-1 leading-none text-[#111827]">{insights.hoje.fechadas}</p>
                                        <p className="text-[10px] font-medium text-[#9ca3af] mt-1">enviadas pro Pipefy</p>
                                    </div>
                                    <div className="bg-white border border-[#e5e7eb] p-5 rounded-2xl shadow-sm">
                                        <p className="text-[11px] font-medium uppercase tracking-wider text-[#6b7280]">Conversão hoje</p>
                                        <p className="text-4xl font-semibold mt-1 leading-none text-emerald-600">{insights.hoje.conversao}%</p>
                                        <p className="text-[10px] font-medium text-[#9ca3af] mt-1">fechadas ÷ cotadas</p>
                                    </div>
                                </div>

                                {/* Alertas / rankings de aderência */}
                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                                    {/* Melhor aderência */}
                                    <div className="bg-white border border-[#e5e7eb] rounded-2xl p-5 shadow-sm flex flex-col">
                                        <p className="text-[11px] font-medium uppercase tracking-wider text-emerald-600 flex items-center gap-1.5 mb-3"><Award className="w-4 h-4" /> Melhor aderência</p>
                                        {insights.melhorAderencia ? (
                                            <div className="mt-auto">
                                                <p className="text-sm font-semibold text-[#111827] truncate" title={insights.melhorAderencia.nome}>{insights.melhorAderencia.nome}</p>
                                                <div className="flex items-baseline gap-2 mt-1">
                                                    <span className="text-3xl font-semibold text-emerald-600 leading-none">{insights.melhorAderencia.conv}%</span>
                                                    <span className="text-[11px] font-medium text-[#6b7280]">{insights.melhorAderencia.fechadas}/{insights.melhorAderencia.cotadas} fechadas</span>
                                                </div>
                                            </div>
                                        ) : <p className="text-xs text-[#9ca3af] mt-auto">Sem solicitante com volume relevante (≥{insights.minVolume} cotações) nos últimos 30 dias.</p>}
                                    </div>
                                    {/* Cota muito e fecha pouco */}
                                    <div className="bg-white border border-amber-100 rounded-2xl p-5 shadow-sm flex flex-col">
                                        <p className="text-[11px] font-medium uppercase tracking-wider text-amber-600 flex items-center gap-1.5 mb-3"><AlertTriangle className="w-4 h-4" /> Cota muito e fecha pouco</p>
                                        {insights.cotaMuitoFechaPouco ? (
                                            <div className="mt-auto">
                                                <p className="text-sm font-semibold text-[#111827] truncate" title={insights.cotaMuitoFechaPouco.nome}>{insights.cotaMuitoFechaPouco.nome}</p>
                                                <div className="flex items-baseline gap-2 mt-1">
                                                    <span className="text-3xl font-semibold text-amber-600 leading-none">{insights.cotaMuitoFechaPouco.conv}%</span>
                                                    <span className="text-[11px] font-medium text-[#6b7280]">{insights.cotaMuitoFechaPouco.cotadas} cotadas · {insights.cotaMuitoFechaPouco.fechadas} fechadas</span>
                                                </div>
                                            </div>
                                        ) : <p className="text-xs text-[#9ca3af] mt-auto">Sem volume relevante pra avaliar nos últimos 30 dias.</p>}
                                    </div>
                                    {/* Clientes que não cotaram hoje */}
                                    <div className="bg-white border border-[#e5e7eb] rounded-2xl p-5 shadow-sm">
                                        <div className="flex items-center justify-between mb-3">
                                            <p className="text-[11px] font-medium uppercase tracking-wider text-[#6b7280] flex items-center gap-1.5"><Users className="w-4 h-4 text-[#1d6fb8]" /> Não cotaram hoje</p>
                                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#eff6ff] text-[#1d6fb8]">{insights.naoCotaramHoje.length}</span>
                                        </div>
                                        {insights.naoCotaramHoje.length === 0 ? (
                                            <p className="text-xs text-[#9ca3af]">Todos os clientes ativos já cotaram hoje. 🎉</p>
                                        ) : (
                                            <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                                                {insights.naoCotaramHoje.slice(0, 8).map((c, i) => (
                                                    <span key={i} className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[#f9fafb] border border-[#e5e7eb] text-[11px] font-medium text-[#111827] max-w-full">
                                                        <span className="truncate max-w-[120px]">{c.name}</span>
                                                        <span className="text-[#9ca3af]">{c.dias}d</span>
                                                    </span>
                                                ))}
                                                {insights.naoCotaramHoje.length > 8 && <span className="text-[11px] font-medium text-[#9ca3af] px-1 py-1">+{insights.naoCotaramHoje.length - 8}</span>}
                                            </div>
                                        )}
                                        <p className="text-[10px] font-medium text-[#9ca3af] mt-2">Ativos nos últimos 30 dias · pra saber quem chamar</p>
                                    </div>
                                </div>

                                {/* Ranking de solicitantes (gráfico comparativo: cotadas x fechadas, 30d) */}
                                {insights.rankingSolicitantes.length > 0 && (
                                    <div className="bg-white border border-[#e5e7eb] rounded-2xl p-5 shadow-sm">
                                        <div className="flex items-center justify-between mb-4">
                                            <p className="text-sm font-medium text-[#111827] flex items-center gap-2"><BarChart3 className="w-4 h-4 text-[#1d6fb8]" /> Solicitantes — cotadas x fechadas (30 dias)</p>
                                            <span className="text-[10px] font-medium text-[#9ca3af] uppercase">fechada = enviada pro Pipefy</span>
                                        </div>
                                        <div className="space-y-2.5">
                                            {insights.rankingSolicitantes.slice(0, 8).map((s, i) => {
                                                const max = insights.rankingSolicitantes[0].cotadas || 1;
                                                return (
                                                    <div key={i} className="flex items-center gap-3">
                                                        <span className="w-40 shrink-0 truncate text-xs font-medium text-[#111827]" title={s.nome}>{s.nome}</span>
                                                        <div className="flex-1 h-5 bg-[#f3f4f6] rounded-full overflow-hidden relative">
                                                            <div className="h-full bg-[#dbeafe] rounded-full" style={{ width: `${Math.max(6, (s.cotadas / max) * 100)}%` }} title={`${s.cotadas} cotadas`}>
                                                                <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${s.cotadas ? (s.fechadas / s.cotadas) * 100 : 0}%` }} title={`${s.fechadas} fechadas`}></div>
                                                            </div>
                                                        </div>
                                                        <span className="w-24 shrink-0 text-right text-[11px] font-medium text-[#6b7280]">{s.fechadas}/{s.cotadas} · {s.conv}%</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* ===== Relatório Diário (só master) ===== */}
                            <div className="bg-white p-6 rounded-xl shadow-sm border border-[#e5e7eb] space-y-5">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <h3 className="text-sm font-medium text-[#111827] flex items-center gap-2"><FileText className="w-4 h-4 text-[#1d6fb8]" strokeWidth={1.75} /> Relatório Diário</h3>
                                    <div className="flex flex-wrap items-center gap-2">
                                        {([['hoje', 'Hoje'], ['ontem', 'Ontem'], ['7d', '7 dias'], ['30d', '30 dias'], ['mes', 'Mês']] as const).map(([val, lbl]) => (
                                            <button key={val} onClick={() => setReportPreset(val)} className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${reportPreset === val ? 'bg-[#eff6ff] border-[#bfdbfe] text-[#1d6fb8]' : 'bg-white border-[#e5e7eb] text-[#6b7280] hover:bg-[#f9fafb]'}`}>{lbl}</button>
                                        ))}
                                        <button onClick={generateReport} className="px-4 py-1.5 bg-[#1d6fb8] text-white rounded-lg text-xs font-medium hover:bg-[#1a5f9e] transition-colors flex items-center gap-1.5">
                                            <BarChart3 className="w-3.5 h-3.5" strokeWidth={1.75} /> Gerar relatório
                                        </button>
                                    </div>
                                </div>

                                {!dailyReport ? (
                                    <p className="text-sm font-normal text-[#6b7280]">Escolha o período e clique em "Gerar relatório". Os números são calculados direto do banco.</p>
                                ) : (
                                    <div className="space-y-5">
                                        <p className="text-[11px] font-normal text-[#6b7280]">Período: <span className="font-medium text-[#111827]">{dailyReport.label}</span></p>

                                        {/* KPIs do relatório */}
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                                            <div className="bg-[#f9fafb] border border-[#e5e7eb] rounded-lg p-4">
                                                <p className="text-[10px] font-medium text-[#6b7280] uppercase">Cotações no período</p>
                                                <p className="text-2xl font-medium text-[#111827]">{dailyReport.total}</p>
                                            </div>
                                            <div className="bg-[#f9fafb] border border-[#e5e7eb] rounded-lg p-4">
                                                <p className="text-[10px] font-medium text-[#6b7280] uppercase">Valor cotado no período</p>
                                                <p className="text-2xl font-medium text-[#1d6fb8]">R$ {formatCur(dailyReport.totalValue || 0)}</p>
                                                {(dailyReport.prevValue || 0) > 0 && <p className="text-[10px] font-normal text-[#6b7280] mt-0.5">antes: R$ {formatCur(dailyReport.prevValue)}</p>}
                                            </div>
                                            <div className="bg-[#f9fafb] border border-[#e5e7eb] rounded-lg p-4">
                                                <p className="text-[10px] font-medium text-[#6b7280] uppercase">Variação vs anterior</p>
                                                <p className={`text-2xl font-medium ${dailyReport.variation > 0 ? 'text-emerald-600' : dailyReport.variation < 0 ? 'text-red-600' : 'text-[#111827]'}`}>
                                                    {dailyReport.variation > 0 ? '+' : ''}{dailyReport.variation}% <span className="text-xs font-normal text-[#6b7280]">({dailyReport.prevTotal} antes)</span>
                                                </p>
                                            </div>
                                            <div className="bg-[#f9fafb] border border-[#e5e7eb] rounded-lg p-4">
                                                <p className="text-[10px] font-medium text-[#6b7280] uppercase">Tempo médio de montagem</p>
                                                <p className="text-2xl font-medium text-[#111827]">{dailyReport.avgSec > 0 ? formatMin(dailyReport.avgSec) : '—'}</p>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                                            {/* Top clientes (gráfico de barras) */}
                                            <div>
                                                <p className="text-[11px] font-medium text-[#6b7280] uppercase mb-2">Clientes que mais cotaram</p>
                                                {dailyReport.topClients.length === 0 ? <p className="text-xs text-[#9ca3af]">Sem cotações no período.</p> : (
                                                    <div className="space-y-2">
                                                        {dailyReport.topClients.map((c: any, i: number) => {
                                                            const max = dailyReport.topClients[0].count || 1;
                                                            return (
                                                                <div key={i} className="flex items-center gap-2">
                                                                    <span className="w-28 truncate text-xs font-medium text-[#111827]">{c.name}</span>
                                                                    <div className="flex-1 h-4 bg-[#f3f4f6] rounded-full overflow-hidden">
                                                                        <div className="h-full bg-[#1d6fb8] rounded-full" style={{ width: `${Math.max(8, (c.count / max) * 100)}%` }}></div>
                                                                    </div>
                                                                    <span className="w-6 text-right text-xs font-medium text-[#111827]">{c.count}</span>
                                                                    <span className="w-24 text-right text-[11px] font-medium text-[#1d6fb8]">R$ {formatCur(c.value || 0)}</span>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>

                                            {/* Ranking de operadores */}
                                            <div>
                                                <p className="text-[11px] font-medium text-[#6b7280] uppercase mb-2">Operador que mais cotou</p>
                                                {dailyReport.operators.length === 0 ? <p className="text-xs text-[#9ca3af]">Sem cotações no período.</p> : (
                                                    <div className="space-y-1.5">
                                                        {dailyReport.operators.map((o: any, i: number) => (
                                                            <div key={i} className="flex items-center justify-between bg-[#f9fafb] border border-[#e5e7eb] rounded-lg px-3 py-2">
                                                                <span className="text-xs font-medium text-[#111827] truncate">{i + 1}. {o.name}</span>
                                                                <span className="text-[11px] font-normal text-[#6b7280]">{o.count} cot. · {o.timed > 0 ? formatMin(o.avgSec) : '—'}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                                            {/* Veículos cotados (gráfico de barras) */}
                                            <div>
                                                <p className="text-[11px] font-medium text-[#6b7280] uppercase mb-2">Veículos cotados</p>
                                                {(!dailyReport.topVehicles || dailyReport.topVehicles.length === 0) ? <p className="text-xs text-[#9ca3af]">Sem cotações no período.</p> : (
                                                    <div className="space-y-2">
                                                        {dailyReport.topVehicles.map((v: any, i: number) => {
                                                            const max = dailyReport.topVehicles[0].count || 1;
                                                            return (
                                                                <div key={i} className="flex items-center gap-2">
                                                                    <span className="w-32 truncate text-xs font-medium text-[#111827]">{v.name}</span>
                                                                    <div className="flex-1 h-4 bg-[#f3f4f6] rounded-full overflow-hidden">
                                                                        <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.max(8, (v.count / max) * 100)}%` }}></div>
                                                                    </div>
                                                                    <span className="w-6 text-right text-xs font-medium text-[#111827]">{v.count}</span>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>

                                            {/* Rotas mais quentes */}
                                            <div>
                                                <p className="text-[11px] font-medium text-[#6b7280] uppercase mb-2">Rotas mais quentes</p>
                                                {(!dailyReport.topRoutes || dailyReport.topRoutes.length === 0) ? <p className="text-xs text-[#9ca3af]">Sem cotações no período.</p> : (
                                                    <div className="space-y-1.5">
                                                        {dailyReport.topRoutes.map((rt: any, i: number) => (
                                                            <div key={i} className="flex items-center justify-between gap-2 bg-[#f9fafb] border border-[#e5e7eb] rounded-lg px-3 py-2">
                                                                <span className="text-xs font-medium text-[#111827] truncate" title={rt.name}>{i + 1}. {rt.name}</span>
                                                                <span className="text-[11px] font-normal text-[#6b7280] whitespace-nowrap">{rt.count} cot. · R$ {formatCur(rt.value || 0)}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* Avisos e insights (por regras) */}
                                        {dailyReport.insights.length > 0 && (
                                            <div className="bg-amber-50 border border-amber-100 rounded-lg p-4">
                                                <p className="text-[11px] font-medium text-amber-700 uppercase mb-2 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" strokeWidth={1.75} /> Avisos e insights</p>
                                                <ul className="space-y-1">
                                                    {dailyReport.insights.map((ins: string, i: number) => (
                                                        <li key={i} className="text-xs font-normal text-[#111827]">• {ins}</li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}

                                        {/* Camada de IA: texto pro grupo (com fallback no servidor) */}
                                        <div className="pt-4 border-t border-[#e5e7eb]">
                                            <div className="flex items-center justify-between gap-3 mb-2">
                                                <p className="text-[11px] font-medium text-[#6b7280] uppercase">Texto pro grupo (WhatsApp)</p>
                                                <button onClick={handleCompileText} disabled={reportTextLoading} className="px-4 py-2 bg-[#1d6fb8] text-white rounded-lg text-xs font-medium hover:bg-[#1a5f9e] transition-colors disabled:opacity-50 flex items-center gap-1.5">
                                                    <Sparkles className="w-3.5 h-3.5" strokeWidth={1.75} /> {reportTextLoading ? 'Compilando...' : 'Compilar texto pro grupo'}
                                                </button>
                                            </div>
                                            {reportText && (
                                                <div className="space-y-2">
                                                    <textarea readOnly value={reportText} rows={8} className="w-full px-4 py-3 bg-[#f9fafb] border border-[#e5e7eb] rounded-lg text-sm font-normal text-[#111827] outline-none resize-none" />
                                                    <button onClick={() => navigator.clipboard.writeText(reportText).then(() => showFeedback('Texto copiado!'))} className="px-4 py-2 bg-white border border-[#e5e7eb] text-[#111827] rounded-lg text-xs font-medium hover:bg-[#f9fafb] transition-colors flex items-center gap-1.5">
                                                        <ClipboardCopy className="w-3.5 h-3.5" strokeWidth={1.75} /> Copiar
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Cards de KPIs Principais */}
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-6">
                                <div className="bg-white p-6 rounded-xl shadow-sm border border-[#e5e7eb]">
                                    <div className="flex justify-between items-start mb-4">
                                        <div className="p-3 bg-emerald-50 rounded-lg text-emerald-600"><DollarSign className="w-6 h-6" /></div>
                                        <span className="text-[10px] font-medium uppercase text-emerald-600 tracking-wider bg-emerald-100 px-2 py-1 rounded-lg">Faturamento</span>
                                    </div>
                                    <h3 className="text-2xl font-medium text-[#111827]">R$ {formatCur(dashboardData.totalWon)}</h3>
                                    <p className="text-[9px] font-medium text-[#6b7280] mt-1">{dashboardData.countWon} Vendas Confirmadas</p>
                                </div>

                                <div className="bg-white p-6 rounded-xl shadow-sm border border-[#e5e7eb]">
                                    <div className="flex justify-between items-start mb-4">
                                        <div className="p-3 bg-emerald-50 rounded-lg text-emerald-600"><TrendingUp className="w-6 h-6" /></div>
                                        <span className="text-[10px] font-medium uppercase text-emerald-600 tracking-wider bg-emerald-50 px-2 py-1 rounded-lg">Lucro Real</span>
                                    </div>
                                    <h3 className="text-2xl font-medium text-[#111827]">R$ {formatCur(dashboardData.totalProfit)}</h3>
                                    <p className="text-[9px] font-medium text-[#6b7280] mt-1">Resultado Líquido do Mês</p>
                                </div>

                                <div className="bg-white p-6 rounded-xl shadow-sm border border-[#e5e7eb]">
                                    <div className="flex justify-between items-start mb-4">
                                        <div className="p-3 bg-blue-50 rounded-lg text-blue-600"><Activity className="w-6 h-6" /></div>
                                        <span className="text-[10px] font-medium uppercase text-blue-600 tracking-wider bg-blue-50 px-2 py-1 rounded-lg">Margem Méd.</span>
                                    </div>
                                    <h3 className="text-2xl font-medium text-[#111827]">{dashboardData.avgMargin.toFixed(1)}%</h3>
                                    <p className="text-[9px] font-medium text-[#6b7280] mt-1">Eficiência Operacional</p>
                                </div>

                                <div className="bg-white p-6 rounded-xl shadow-sm border">
                                    <div className="flex justify-between items-start mb-4">
                                        <div className="p-3 bg-amber-50 rounded-lg text-amber-600"><Clock className="w-6 h-6" /></div>
                                        <span className="text-[10px] font-medium uppercase text-amber-600 tracking-wider bg-amber-50 px-2 py-1 rounded-lg">Em Pauta</span>
                                    </div>
                                    <h3 className="text-2xl font-medium text-[#111827]">R$ {formatCur(dashboardData.totalPending)}</h3>
                                    <p className="text-[9px] font-medium text-[#6b7280] mt-1">{dashboardData.countPending} Propostas Pendentes</p>
                                </div>

                                <div className="bg-white p-6 rounded-xl shadow-sm border">
                                    <div className="flex justify-between items-start mb-4">
                                        <div className="p-3 bg-[#f9fafb] rounded-lg text-[#111827]"><Scale className="w-6 h-6" /></div>
                                        <span className="text-[10px] font-medium uppercase text-[#6b7280] tracking-wider bg-[#f9fafb] px-2 py-1 rounded-lg">Volume</span>
                                    </div>
                                    <h3 className="text-xl font-medium text-[#111827]">{(dashboardData.totalWeight / 1000).toFixed(1)} <span className="text-xs font-medium text-[#6b7280]">Ton</span></h3>
                                    <p className="text-[9px] font-medium text-[#6b7280] mt-1">{dashboardData.totalKm.toLocaleString()} KM Rodados</p>
                                </div>

                                <div className="bg-white p-6 rounded-xl shadow-sm border">
                                    <div className="flex justify-between items-start mb-4">
                                        <div className="p-3 bg-purple-50 rounded-lg text-purple-600"><Zap className="w-6 h-6" /></div>
                                        <span className="text-[10px] font-medium uppercase text-purple-600 tracking-wider bg-purple-50 px-2 py-1 rounded-lg">Conversão</span>
                                    </div>
                                    <h3 className="text-2xl font-medium text-[#111827]">{dashboardData.filteredCount > 0 ? ((dashboardData.countWon / dashboardData.filteredCount) * 100).toFixed(1) : 0}%</h3>
                                    <p className="text-[9px] font-medium text-[#6b7280] mt-1">{dashboardData.countLost} Fretes Perdidos</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                                {/* Top Clientes */}
                                <div className="lg:col-span-2 bg-white p-8 rounded-xl shadow-sm border border-[#e5e7eb] flex flex-col">
                                    <div className="flex items-center justify-between mb-8">
                                        <div className="flex items-center gap-3">
                                            <Award className="w-5 h-5 text-blue-600" />
                                            <h3 className="font-medium uppercase text-[11px] text-[#6b7280] tracking-widest">Top 5 Clientes por Receita</h3>
                                        </div>
                                    </div>
                                    <div className="space-y-6 flex-1">
                                        {dashboardData.topClients.length > 0 ? dashboardData.topClients.map((client, idx) => (
                                            <div key={idx} className="flex items-center gap-6 group">
                                                <div className="w-12 h-12 rounded-lg flex items-center justify-center font-medium text-xs bg-[#f9fafb] overflow-hidden border border-[#e5e7eb] group-hover:border-blue-100 transition-all">
                                                    {client.logo ? <img src={client.logo} className="w-full h-full object-cover" /> : <div className="w-full h-full bg-blue-50 text-blue-400 flex items-center justify-center">{client.name.charAt(0)}</div>}
                                                </div>
                                                <div className="flex-1">
                                                    <div className="flex justify-between mb-2">
                                                        <span className="text-sm font-medium text-[#111827]">{client.name}</span>
                                                        <span className="text-sm font-medium text-[#1d6fb8]">R$ {formatCur(client.value)}</span>
                                                    </div>
                                                    <div className="h-2.5 w-full bg-[#f9fafb] rounded-full overflow-hidden">
                                                        <div className="h-full bg-blue-500 rounded-full transition-all duration-1000" style={{ width: `${(client.value / dashboardData.totalWon) * 100}%` }}></div>
                                                    </div>
                                                </div>
                                            </div>
                                        )) : (
                                            <div className="h-full flex flex-col items-center justify-center text-slate-300 gap-4">
                                                <Users className="w-12 h-12 opacity-20" />
                                                <p className="font-medium uppercase text-[10px] tracking-widest">Nenhum dado no período</p>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Status e Conversão */}
                                <div className="bg-white p-8 rounded-xl shadow-sm border border-[#e5e7eb] flex flex-col items-center">
                                    <div className="flex items-center justify-between w-full mb-8">
                                        <div className="flex items-center gap-3">
                                            <PieChart className="w-5 h-5 text-purple-600" />
                                            <h3 className="font-medium uppercase text-[11px] text-[#6b7280] tracking-widest">Status das Propostas</h3>
                                        </div>
                                    </div>
                                    <div className="relative h-56 w-56 mx-auto mb-8 rounded-full flex items-center justify-center shadow-inner" style={{
                                        background: dashboardData.filteredCount > 0
                                            ? `conic-gradient(#10b981 0% ${((dashboardData.countWon / dashboardData.filteredCount) * 100)}%, #ef4444 ${((dashboardData.countWon / dashboardData.filteredCount) * 100)}% ${((dashboardData.countWon + dashboardData.countLost) / dashboardData.filteredCount * 100)}%, #f59e0b ${((dashboardData.countWon + dashboardData.countLost) / dashboardData.filteredCount * 100)}% 100%)`
                                            : '#f1f5f9'
                                    }}>
                                        <div className="absolute inset-5 bg-white rounded-full flex flex-col items-center justify-center shadow-sm">
                                            <span className="text-4xl font-medium text-[#111827]">{dashboardData.filteredCount}</span>
                                            <span className="text-[10px] font-medium text-slate-300 uppercase">Total</span>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-3 gap-2 w-full mt-auto">
                                        <div className="text-center">
                                            <div className="w-2 h-2 rounded-full bg-emerald-500 mx-auto mb-1"></div>
                                            <p className="text-[9px] font-medium text-[#6b7280] uppercase">Ganhos</p>
                                            <p className="text-xs font-medium text-[#111827]">{dashboardData.countWon}</p>
                                        </div>
                                        <div className="text-center">
                                            <div className="w-2 h-2 rounded-full bg-red-500 mx-auto mb-1"></div>
                                            <p className="text-[9px] font-medium text-[#6b7280] uppercase">Perdas</p>
                                            <p className="text-xs font-medium text-[#111827]">{dashboardData.countLost}</p>
                                        </div>
                                        <div className="text-center">
                                            <div className="w-2 h-2 rounded-full bg-amber-400 mx-auto mb-1"></div>
                                            <p className="text-[9px] font-medium text-[#6b7280] uppercase">Pauta</p>
                                            <p className="text-xs font-medium text-[#111827]">{dashboardData.countPending}</p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                                {/* Top Equipamentos */}
                                <div className="bg-white p-8 rounded-xl shadow-sm border border-[#e5e7eb]">
                                    <div className="flex items-center gap-3 mb-6">
                                        <Truck className="w-5 h-5 text-amber-500" />
                                        <h3 className="font-medium uppercase text-[11px] text-[#6b7280] tracking-widest">Faturamento por Equipamento</h3>
                                    </div>
                                    <div className="space-y-4">
                                        {dashboardData.topVehicles.map((v, i) => (
                                            <div key={i} className="flex items-center justify-between p-4 bg-[#f9fafb] rounded-lg hover:bg-amber-50 transition-colors">
                                                <span className="text-xs font-medium text-[#111827] uppercase">{v.name}</span>
                                                <span className="text-xs font-medium text-amber-600">R$ {formatCur(v.value)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Top Rotas */}
                                <div className="bg-white p-8 rounded-xl shadow-sm border border-[#e5e7eb]">
                                    <div className="flex items-center gap-3 mb-6">
                                        <MapIcon className="w-5 h-5 text-purple-500" />
                                        <h3 className="font-medium uppercase text-[11px] text-[#6b7280] tracking-widest">Rotas mais Ativas (Ganhos)</h3>
                                    </div>
                                    <div className="space-y-4">
                                        {dashboardData.topRoutes.map((r, i) => (
                                            <div key={i} className="flex items-center justify-between p-4 bg-[#f9fafb] rounded-lg hover:bg-purple-50 transition-colors">
                                                <span className="text-xs font-medium text-[#111827] uppercase">{r.name}</span>
                                                <span className="text-xs font-medium text-purple-600">R$ {formatCur(r.value)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'new' && (
                        <div className="space-y-8 animate-fade-in-up">
                            <div className="flex justify-end">
                                <button
                                    onClick={openImportModal}
                                    className="flex items-center gap-2 px-4 py-2.5 bg-white border border-[#e5e7eb] rounded-lg text-sm font-medium text-[#111827] hover:bg-[#f9fafb] transition-colors"
                                    title="Ler uma solicitação (e-mail/mensagem/arquivo) e preencher os campos automaticamente"
                                >
                                    <Sparkles className="w-4 h-4 text-[#1d6fb8]" strokeWidth={1.75} /> Importar Solicitação
                                </button>
                            </div>
                            <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                                <div className="lg:col-span-3 space-y-8">
                                    <div className="bg-white p-8 rounded-xl shadow-sm border space-y-6">
                                        <div className="flex items-center justify-between mb-4">
                                            <div className="flex items-center gap-3"><Package className="w-5 h-5 text-blue-600" /><h3 className="font-medium uppercase text-[11px] text-[#6b7280]">Rota & Equipamento</h3></div>
                                            <div className="flex items-center gap-2">
                                                {(isTimerRunning || elapsedSeconds > 0) && (
                                                    <div className={`flex items-center gap-2 px-4 py-1.5 rounded-full border animate-fade-in ${isTimerRunning ? 'bg-emerald-50 border-emerald-100' : 'bg-[#f9fafb] border-slate-100'}`} title="Tempo de elaboração da cotação">
                                                        <Clock className={`w-3 h-3 ${isTimerRunning ? 'text-emerald-500 animate-pulse' : 'text-[#6b7280]'}`} />
                                                        <span className={`text-[10px] font-medium uppercase tabular-nums ${isTimerRunning ? 'text-emerald-600' : 'text-[#6b7280]'}`}>{formatElapsed(elapsedSeconds)}</span>
                                                    </div>
                                                )}
                                                {parseFloat(distanceKm) > 0 && (
                                                    <div className="flex items-center gap-2 px-4 py-1.5 bg-blue-50 rounded-full border border-blue-100 animate-fade-in">
                                                        <MapIcon className="w-3 h-3 text-blue-500" />
                                                        <span className="text-[10px] font-medium text-blue-600 uppercase">{(parseFloat(distanceKm) || 0).toLocaleString()} KM Sugeridos</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 lg:grid-cols-6 gap-4">
                                            {/* Rota simples: município travado na lista do IBGE. Multi-parada
                                                segue com texto livre até a Fase 2. */}
                                            <div className="lg:col-span-3">
                                                {isMultiRota ? (
                                                    <input type="text" className="w-full px-6 py-4 bg-[#f9fafb] rounded-lg font-medium border border-[#e5e7eb] focus:border-[#1d6fb8] outline-none" value={origin} onChange={e => { startTimer(); setOrigin(e.target.value); }} placeholder="Origem / Coleta (Cidade, UF)" />
                                                ) : (
                                                    <MunicipioAutocomplete
                                                        valor={origin}
                                                        lista={municipios}
                                                        resolvido={origemMun}
                                                        placeholder="Origem / Coleta (Cidade, UF)"
                                                        // Escolher município NÃO consulta: quem dispara é o botão "Buscar rota".
                                                        onSelecionar={m => { startTimer(); setOrigin(m.rotulo); }}
                                                    />
                                                )}
                                            </div>
                                            <div className="lg:col-span-3">
                                                {isMultiRota ? (
                                                    <input type="text" className="w-full px-6 py-4 bg-[#f9fafb] rounded-lg font-medium border border-[#e5e7eb] focus:border-[#1d6fb8] outline-none" value={destination} onChange={e => { startTimer(); setDestination(e.target.value); }} placeholder="Destino 1 (Cidade, UF)" />
                                                ) : (
                                                    <MunicipioAutocomplete
                                                        valor={destination}
                                                        lista={municipios}
                                                        resolvido={destinoMun}
                                                        placeholder="Destino (Cidade, UF)"
                                                        // Escolher município NÃO consulta: quem dispara é o botão "Buscar rota".
                                                        onSelecionar={m => { startTimer(); setDestination(m.rotulo); }}
                                                    />
                                                )}
                                            </div>
                                        </div>

                                        {/* Multidestino: destinos extras (2..8), reordenáveis + otimizar + mapa */}
                                        <div className="space-y-2">
                                            {destinations.map((d, i) => (
                                                <div key={i} className="flex items-center gap-2">
                                                    <span className="shrink-0 w-7 h-7 rounded-full bg-[#eff6ff] text-[#1d6fb8] text-xs font-medium flex items-center justify-center">{i + 2}</span>
                                                    <input type="text" className="flex-1 min-w-0 px-4 py-3 bg-[#f9fafb] rounded-lg font-medium border border-[#e5e7eb] focus:border-[#1d6fb8] outline-none" value={d} onChange={e => { startTimer(); setDestinations(prev => prev.map((x, j) => j === i ? e.target.value : x)); }} placeholder={`Destino ${i + 2} (Cidade, UF)`} />
                                                    <button type="button" title="Subir" disabled={i === 0} onClick={() => setDestinations(prev => { const a = [...prev]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; return a; })} className="shrink-0 p-2 text-[#6b7280] hover:bg-[#f9fafb] rounded-lg disabled:opacity-30"><ArrowDown className="w-4 h-4 rotate-180" strokeWidth={1.75} /></button>
                                                    <button type="button" title="Descer" disabled={i === destinations.length - 1} onClick={() => setDestinations(prev => { const a = [...prev]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; return a; })} className="shrink-0 p-2 text-[#6b7280] hover:bg-[#f9fafb] rounded-lg disabled:opacity-30"><ArrowDown className="w-4 h-4" strokeWidth={1.75} /></button>
                                                    <button type="button" title="Remover destino" onClick={() => setDestinations(prev => prev.filter((_, j) => j !== i))} className="shrink-0 p-2 text-[#6b7280] hover:text-red-500 hover:bg-red-50 rounded-lg"><Trash2 className="w-4 h-4" strokeWidth={1.75} /></button>
                                                </div>
                                            ))}
                                            <div className="flex flex-wrap items-center gap-2">
                                                {destinations.length < 7 && (
                                                    <button type="button" onClick={() => setDestinations(prev => [...prev, ''])} className="flex items-center gap-1.5 px-3 py-2 bg-white border border-[#e5e7eb] rounded-lg text-xs font-medium text-[#111827] hover:bg-[#f9fafb] transition-colors">
                                                        <Plus className="w-3.5 h-3.5 text-[#1d6fb8]" strokeWidth={1.75} /> Adicionar destino
                                                    </button>
                                                )}
                                                {destinations.length > 0 && (
                                                    <>
                                                        <button type="button" disabled={routeLoading} onClick={() => fetchMultiRoute(false)} className="flex items-center gap-1.5 px-3 py-2 bg-white border border-[#e5e7eb] rounded-lg text-xs font-medium text-[#111827] hover:bg-[#f9fafb] transition-colors disabled:opacity-50">
                                                            <RotateCcw className={`w-3.5 h-3.5 ${routeLoading ? 'animate-spin' : ''}`} strokeWidth={1.75} /> {routeLoading ? 'Calculando...' : 'Recalcular rota'}
                                                        </button>
                                                        <button type="button" disabled={routeLoading} onClick={() => fetchMultiRoute(true)} className="flex items-center gap-1.5 px-3 py-2 bg-white border border-[#e5e7eb] rounded-lg text-xs font-medium text-[#111827] hover:bg-[#f9fafb] transition-colors disabled:opacity-50">
                                                            <Zap className="w-3.5 h-3.5 text-[#1d6fb8]" strokeWidth={1.75} /> Otimizar ordem
                                                        </button>
                                                        <button type="button" onClick={async () => { if (!showMap && !routeGeometry) { await fetchMultiRoute(false); } setShowMap(v => !v); }} className="flex items-center gap-1.5 px-3 py-2 bg-white border border-[#e5e7eb] rounded-lg text-xs font-medium text-[#111827] hover:bg-[#f9fafb] transition-colors">
                                                            <MapIcon className="w-3.5 h-3.5 text-[#1d6fb8]" strokeWidth={1.75} /> {showMap ? 'Ocultar rota' : 'Ver rota'}
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                            {showMap && destinations.length > 0 && (
                                                <MapErrorBoundary>
                                                    <RouteMap polyline={routeGeometry?.polyline} stops={routeGeometry?.stops} />
                                                </MapErrorBoundary>
                                            )}
                                        </div>

                                        {/* Contingência — amarelo, deliberadamente diferente do vermelho:
                                            aqui a cotação FECHA, só que sem o Qualp. O operador precisa
                                            saber que os números não vieram da fonte única. */}
                                        {fechandoEmContingencia && (
                                            <div className="col-span-1 md:col-span-2 bg-amber-50 border border-amber-300 text-amber-900 px-6 py-3 rounded-xl flex items-start gap-3">
                                                <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" strokeWidth={1.75} />
                                                <div className="flex-1">
                                                    <p className="text-sm font-semibold">
                                                        Modo emergência ligado — Qualp desativado, piso pela tabela local, pedágio manual.
                                                    </p>
                                                    <p className="text-xs font-medium opacity-90 mt-0.5">
                                                        Confira os valores antes de fechar. Esta cotação fica marcada para auditoria.
                                                        {emergencia.alteradoPorNome ? ` Acionado por ${emergencia.alteradoPorNome}.` : ''}
                                                    </p>
                                                    {qualpVoltou && ehMaster && (
                                                        <div className="mt-2 flex flex-wrap items-center gap-2">
                                                            <span className="text-xs font-semibold text-emerald-800">
                                                                O Qualp voltou a responder. Deseja desligar o modo emergência?
                                                            </span>
                                                            <button
                                                                onClick={() => alternarEmergencia(false)}
                                                                disabled={salvandoEmergencia}
                                                                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-[11px] font-semibold transition-colors"
                                                            >
                                                                Desligar agora
                                                            </button>
                                                            <button
                                                                onClick={() => setQualpVoltou(false)}
                                                                className="px-3 py-1.5 text-[11px] font-medium text-amber-800 underline"
                                                            >
                                                                agora não
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )}

                                        {/* Frete urbano — AZUL, tom de orientação. Não é falha: o Qualp nem
                                            foi consultado, porque distância zero é a resposta certa para o
                                            mesmo município. A cotação fecha normalmente com os números à mão. */}
                                        {rotaUrbana && freteUrbano && (
                                            <div className="col-span-1 md:col-span-2 bg-blue-50 border border-blue-200 text-blue-900 px-6 py-3 rounded-xl flex items-start gap-3">
                                                <Info className="w-5 h-5 shrink-0 mt-0.5 text-blue-600" strokeWidth={1.75} />
                                                <div className="flex-1">
                                                    <p className="text-sm font-semibold">Frete dentro do mesmo município</p>
                                                    <p className="text-xs font-medium opacity-90 mt-0.5">
                                                        Ainda não é cotado automaticamente. Preencha distância e pedágio à mão —
                                                        o piso ANTT é calculado pela tabela local sobre a distância que você informar.
                                                    </p>
                                                </div>
                                            </div>
                                        )}

                                        {/* Bloqueio do Qualp — mesmo padrão de alerta do Painel TV: barra
                                            vermelha, impossível de não ver. Enquanto estiver aqui, a cotação
                                            de rota simples não fecha e não há fallback pro Google.
                                            Em contingência não aparece: quem manda é o banner amarelo. */}
                                        {!emergenciaLigada && !isMultiRota && qualpBloqueio && (
                                            <div className="col-span-1 md:col-span-2 bg-red-600 text-white px-6 py-3 rounded-xl flex items-center gap-4 shadow-lg animate-pulse">
                                                <span className="text-2xl shrink-0">⚠️</span>
                                                <div className="flex-1">
                                                    <p className="text-sm font-bold uppercase tracking-wide">Cotação travada — Qualp indisponível</p>
                                                    <p className="text-xs font-medium opacity-90 mt-0.5">{qualpBloqueio}</p>
                                                </div>
                                                <button
                                                    onClick={() => handleFetchDistance()}
                                                    disabled={loadingDistance}
                                                    className="shrink-0 px-4 py-2 bg-white/15 hover:bg-white/25 disabled:opacity-50 rounded-lg text-xs font-semibold transition-colors"
                                                >
                                                    {loadingDistance ? 'Consultando…' : 'Tentar de novo'}
                                                </button>
                                            </div>
                                        )}

                                        {/* Antes/depois do recálculo de uma cotação salva: ninguém fecha
                                            achando que o número continua sendo o antigo. */}
                                        {recalcDiff && (
                                            <div className="col-span-1 md:col-span-2 bg-blue-50 border border-blue-200 text-blue-900 px-6 py-3 rounded-xl flex items-start gap-3">
                                                <Info className="w-4 h-4 shrink-0 mt-0.5" />
                                                <div className="flex-1">
                                                    <p className="text-[10px] font-semibold uppercase tracking-wide mb-1">Recalculado pelo Qualp</p>
                                                    <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs font-medium">
                                                        <span>KM: era {recalcDiff.kmAntes.toLocaleString('pt-BR')} → virou <strong>{recalcDiff.kmDepois.toLocaleString('pt-BR')}</strong></span>
                                                        <span>Pedágio: era R$ {formatCur(recalcDiff.pedAntes)} → virou <strong>R$ {formatCur(recalcDiff.pedDepois)}</strong></span>
                                                        <span>Piso ANTT: era {recalcDiff.pisoAntes !== null ? `R$ ${formatCur(recalcDiff.pisoAntes)}` : '—'} → virou <strong>{recalcDiff.pisoDepois !== null ? `R$ ${formatCur(recalcDiff.pisoDepois)}` : '—'}</strong></span>
                                                    </div>
                                                </div>
                                                <button onClick={() => setRecalcDiff(null)} className="shrink-0 text-blue-400 hover:text-blue-700 text-lg leading-none">×</button>
                                            </div>
                                        )}

                                        {/* Alerta de Histórico */}
                                        {historicalAlert}
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7 gap-4">
                                            <div className="relative"><Hash className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" /><input type="text" className="w-full pl-10 pr-4 py-4 bg-blue-50/50 rounded-lg font-medium border-2 border-blue-100 focus:border-blue-300 outline-none" value={clientReference} onChange={e => setClientReference(e.target.value)} placeholder="Ref Cliente" /></div>
                                            <div className="relative md:col-span-2">
                                                <Truck className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
                                                {/* Trocar o veículo muda o nº de eixos, que muda pedágio e piso — mas
                                                    NÃO consulta sozinho. O resultado na tela é invalidado e o operador
                                                    decide quando buscar de novo. */}
                                                <select className="w-full pl-10 pr-4 py-4 bg-[#f9fafb] rounded-lg font-medium outline-none border border-[#e5e7eb] focus:border-[#1d6fb8] transition-all appearance-none" value={vehicleType} onChange={e => setVehicleType(e.target.value)}>
                                                    {Object.keys(vehicleConfigs).map(v => <option key={v} value={v}>{v}</option>)}
                                                </select>
                                                <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300 pointer-events-none" />
                                            </div>
                                            <div className="relative col-span-1 md:col-span-2"><Package className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300 pointer-events-none z-10" /><ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300 pointer-events-none" /><select className="w-full pl-10 pr-10 py-4 bg-[#f9fafb] rounded-lg font-medium border border-[#e5e7eb] focus:border-[#1d6fb8] outline-none appearance-none cursor-pointer" value={merchandiseType} onChange={e => setMerchandiseType(e.target.value)}><option value="">Tipo da Mercadoria</option>{MERCADORIA_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}</select></div>
                                            <div className="relative">
                                                <Scale className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
                                                <input type="text" className="w-full pl-10 pr-4 py-4 bg-[#f9fafb] rounded-lg font-medium outline-none border border-[#e5e7eb] focus:border-[#1d6fb8] transition-all" value={weight} onChange={e => setWeight(e.target.value)} placeholder="Peso KG" />
                                            </div>
                                            <div className="relative">
                                                <MapIcon className={`absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 ${loadingDistance ? 'text-blue-500 animate-pulse' : 'text-slate-300'}`} />
                                                <input
                                                    type="text"
                                                    className={`w-full pl-10 pr-12 py-4 rounded-lg font-medium outline-none border-2 transition-all ${loadingDistance ? 'bg-blue-50 border-blue-200 text-blue-400' : 'bg-[#f9fafb] border-transparent focus:border-[#1d6fb8]'}`}
                                                    value={loadingDistance ? "Calculando..." : distanceKm}
                                                    onChange={e => setDistanceKm(e.target.value)}
                                                    placeholder="KM"
                                                    disabled={loadingDistance}
                                                />
                                                {/* Na rota simples o único gatilho é o botão "Buscar rota" abaixo —
                                                    dois controles pra mesma coisa só confundiriam. */}
                                                {isMultiRota && (
                                                    <button
                                                        onClick={handleFetchDistance}
                                                        disabled={loadingDistance}
                                                        className={`absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-white rounded-xl shadow-sm transition-all border border-[#e5e7eb] ${loadingDistance ? 'opacity-50 cursor-not-allowed' : 'text-blue-500 hover:bg-blue-50'}`}
                                                        title="Recalcular Distância"
                                                    >
                                                        <RotateCcw className={`w-3 h-3 ${loadingDistance ? 'animate-spin' : ''}`} />
                                                    </button>
                                                )}
                                            </div>
                                        </div>

                                        {/* Buscar rota — único gatilho da consulta ao Qualp na rota simples.
                                            Nada consulta sozinho: preencher campo não gasta crédito. */}
                                        {!isMultiRota && (
                                            <div className={`flex flex-wrap items-center gap-3 px-4 py-3 rounded-xl border ${rotaDesatualizada
                                                ? 'bg-amber-50 border-amber-300'
                                                : 'bg-[#f9fafb] border-[#e5e7eb]'}`}>
                                                {rotaDesatualizada ? (
                                                    <>
                                                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" strokeWidth={1.75} />
                                                        <span className="text-xs font-medium text-amber-800 flex-1 min-w-[12rem]">
                                                            Desatualizado — rota, eixos ou tipo de carga mudaram. Busque de novo.
                                                        </span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <Info className="w-4 h-4 text-[#6b7280] shrink-0" strokeWidth={1.75} />
                                                        <span className="text-xs font-normal text-[#6b7280] flex-1 min-w-[12rem]">
                                                            {rotaUrbana
                                                                ? 'Mesmo município: preencha distância e pedágio à mão. Não há consulta ao Qualp.'
                                                                : snapshotValido
                                                                    ? `Distância, pedágio e piso do Qualp${qualpRota?.idTransacao ? ` · consulta ${qualpRota.idTransacao}` : ''}.`
                                                                    : temNumerosSalvos
                                                                        ? 'KM, pedágio e piso são os valores salvos desta cotação.'
                                                                        : !municipiosOk
                                                                            ? 'Escolha origem e destino na lista para liberar a busca.'
                                                                            : 'Pronto para buscar distância, pedágio e piso ANTT.'}
                                                        </span>
                                                    </>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => (temNumerosSalvos ? recalcularPeloQualp() : handleFetchDistance())}
                                                    // Só habilita com município escolhido dos dois lados. E fica travado
                                                    // durante a consulta, pra clique repetido não disparar uma segunda
                                                    // chamada em cima da primeira (cada uma é crédito).
                                                    // Urbano não tem o que buscar: o Qualp não é consultado.
                                                    disabled={!municipiosOk || loadingDistance || rotaUrbana}
                                                    className={`shrink-0 px-5 py-2.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-2 ${!municipiosOk || loadingDistance || rotaUrbana
                                                        ? 'bg-[#f3f4f6] text-[#9ca3af] border border-[#e5e7eb] cursor-not-allowed'
                                                        : rotaDesatualizada
                                                            ? 'bg-amber-600 hover:bg-amber-700 text-white'
                                                            : 'bg-[#1d6fb8] hover:bg-[#175a94] text-white'}`}
                                                >
                                                    {loadingDistance
                                                        ? <><RotateCcw className="w-3.5 h-3.5 animate-spin" strokeWidth={1.75} /> Consultando…</>
                                                        : <><Search className="w-3.5 h-3.5" strokeWidth={1.75} />
                                                            {temNumerosSalvos ? 'Recalcular pelo Qualp' : (snapshotValido || rotaDesatualizada) ? 'Buscar de novo' : 'Buscar rota'}</>}
                                                </button>
                                            </div>
                                        )}

                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                            <div>
                                                {/* Cliente: base LOCAL (alimenta dashboard/Ramper/PDF/logo). O vínculo com o Pipefy
                                                    fica no cadastro do cliente e é resolvido no fechamento da carga. */}
                                                <select className="w-full p-4 bg-[#f9fafb] rounded-lg font-medium outline-none border border-[#e5e7eb] focus:border-[#1d6fb8] transition-all" value={selectedCustomerId} onChange={e => setSelectedCustomerId(e.target.value)}><option value="">Selecione Cliente...</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                                            </div>
                                            <div>
                                                {/* Solicitante: autocomplete do Pipefy (nome + id). Texto livre = sem id (fail-soft). */}
                                                <PipefyAutocomplete tipo="solicitante" value={solicitante} selectedId={solicitantePipefyId}
                                                    onChangeText={name => { setSolicitante(name); setSolicitantePipefyId(undefined); }}
                                                    onPick={rec => { setSolicitante(rec.title); setSolicitantePipefyId(rec.id); }}
                                                    placeholder="Solicitante..."
                                                    className="w-full p-4 pr-16 bg-[#f9fafb] rounded-lg font-medium outline-none border border-[#e5e7eb] focus:border-[#1d6fb8] transition-all" />
                                            </div>
                                            <div>
                                                {/* Implemento: espelha o select do Pipefy; flui pra carga fechada e pro card. */}
                                                <select className="w-full p-4 bg-[#f9fafb] rounded-lg font-medium outline-none border border-[#e5e7eb] focus:border-[#1d6fb8] transition-all" value={implemento} onChange={e => setImplemento(e.target.value)}>
                                                    <option value="">Implemento...</option>
                                                    {IMPLEMENTO_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                                                </select>
                                            </div>
                                            <div>
                                                <select className="w-full p-4 bg-[#f9fafb] rounded-lg font-medium outline-none border border-[#e5e7eb] focus:border-[#1d6fb8] transition-all" value={disponibilidade} onChange={e => setDisponibilidade(e.target.value as Disponibilidade)}><option value="Imediato">Imediato</option><option value="Conforme programação">Programado</option></select>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="bg-white p-8 rounded-xl shadow-sm border hover:shadow-sm transition-all relative">
                                        {/* Toggle Calcular / Tabelado. "Calcular" é o fluxo de sempre
                                            (custos → valor final). "Tabelado" é o reverso, para frete já
                                            fechado por contrato: valor final → quanto sobra pro motorista.
                                            O tabelado não consulta o Qualp em momento nenhum. */}
                                        <div className="flex items-center gap-1 p-1 bg-[#f3f4f6] rounded-xl w-fit mb-6">
                                            {([false, true] as const).map(tab => (
                                                <button
                                                    key={String(tab)}
                                                    type="button"
                                                    onClick={() => setModoTabelado(tab)}
                                                    className={`px-5 py-2 rounded-lg text-xs font-semibold transition-colors ${modoTabelado === tab
                                                        ? 'bg-white text-[#111827] shadow-sm'
                                                        : 'text-[#6b7280] hover:text-[#111827]'}`}
                                                >
                                                    {tab ? 'Tabelado' : 'Calcular'}
                                                </button>
                                            ))}
                                        </div>

                                        {modoTabelado && (
                                            <div className="mb-6 space-y-4">
                                                <div className="px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl flex items-start gap-3">
                                                    <Info className="w-4 h-4 shrink-0 mt-0.5 text-blue-600" strokeWidth={1.75} />
                                                    <p className="text-xs font-medium text-blue-900">
                                                        Frete já fechado: informe o valor final e a margem pretendida.
                                                        O sistema calcula quanto sobra para o motorista. Não consulta o Qualp.
                                                    </p>
                                                </div>
                                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                                    <div className="flex flex-col">
                                                        <span className="text-[10px] font-medium uppercase text-blue-600 mb-2">Valor final do frete</span>
                                                        <input
                                                            type="text"
                                                            className="w-full p-4 rounded-xl font-medium text-[#111827] bg-[#f9fafb] focus:bg-white outline-none border border-[#e5e7eb] focus:border-[#1d6fb8] transition-all"
                                                            value={maskCurrency(valorFinalTabelado)}
                                                            onChange={e => { startTimer(); setValorFinalTabelado(maskCurrency(e.target.value)); }}
                                                        />
                                                    </div>
                                                    <div className="flex flex-col">
                                                        <span className="text-[10px] font-medium uppercase text-[#6b7280] mb-2">Distância (km) — opcional</span>
                                                        <input
                                                            type="text"
                                                            className="w-full p-4 rounded-xl font-medium bg-[#f9fafb] outline-none border border-[#e5e7eb] focus:border-[#1d6fb8] transition-all"
                                                            value={distanceKm}
                                                            onChange={e => setDistanceKm(e.target.value)}
                                                            placeholder="só para o piso ANTT"
                                                        />
                                                    </div>
                                                    <div className="flex flex-col">
                                                        <span className="text-[10px] font-medium uppercase text-[#6b7280] mb-2">ICMS</span>
                                                        <div className="flex items-center gap-2">
                                                            <label className="flex items-center gap-2 px-3 py-4 bg-[#f9fafb] border border-[#e5e7eb] rounded-xl cursor-pointer shrink-0">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={temIcmsTabelado}
                                                                    onChange={e => {
                                                                        setTemIcmsTabelado(e.target.checked);
                                                                        // Desmarcar zera a alíquota: sem ICMS, sem desconto.
                                                                        if (!e.target.checked) setIcmsPercent('0');
                                                                        else if (num(icmsPercent) === 0) setIcmsPercent('12');
                                                                    }}
                                                                    className="w-4 h-4 accent-[#1d6fb8]"
                                                                />
                                                                <span className="text-xs font-medium text-[#111827]">Tem ICMS</span>
                                                            </label>
                                                            <input
                                                                type="text"
                                                                disabled={!temIcmsTabelado}
                                                                className={`w-full p-4 rounded-xl font-medium outline-none border transition-all ${temIcmsTabelado
                                                                    ? 'bg-[#f9fafb] border-[#e5e7eb] focus:border-[#1d6fb8]'
                                                                    : 'bg-[#f3f4f6] border-[#e5e7eb] text-[#9ca3af] cursor-not-allowed'}`}
                                                                value={icmsPercent}
                                                                onChange={e => setIcmsPercent(e.target.value)}
                                                                placeholder="%"
                                                            />
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Resultado: o motorista e as duas margens lado a lado. */}
                                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                                    <div className="p-5 bg-[#111827] rounded-xl">
                                                        <p className="text-[10px] font-medium uppercase text-white/60 mb-1">Sobra pro motorista</p>
                                                        <p className="text-2xl font-semibold text-white">R$ {formatCur(calcData.motoristaTabelado)}</p>
                                                        <p className="text-[10px] font-normal text-white/50 mt-1">teto do frete do motorista</p>
                                                    </div>
                                                    <div className="p-5 bg-[#f9fafb] border border-[#e5e7eb] rounded-xl">
                                                        <p className="text-[10px] font-medium uppercase text-[#6b7280] mb-1">Margem pretendida</p>
                                                        <p className="text-2xl font-semibold text-[#111827]">{(parseFloat(profitMargin.replace(',', '.')) || 0).toFixed(2)}%</p>
                                                    </div>
                                                    <div className="p-5 bg-[#f9fafb] border border-[#e5e7eb] rounded-xl">
                                                        <p className="text-[10px] font-medium uppercase text-[#6b7280] mb-1">Margem real</p>
                                                        <p className={`text-2xl font-semibold ${calcData.realMarginPercent < marginThreshold ? 'text-amber-600' : 'text-emerald-600'}`}>
                                                            {calcData.realMarginPercent.toFixed(2)}%
                                                        </p>
                                                        <p className="text-[10px] font-normal text-[#6b7280] mt-1">já com federais e ad valorem</p>
                                                    </div>
                                                </div>

                                                {/* Piso ANTT informativo: só aparece com distância digitada.
                                                    Não bloqueia — o operador vê e decide. */}
                                                {anttFloor !== null && (
                                                    <div className="px-4 py-3 bg-[#f9fafb] border border-[#e5e7eb] rounded-xl flex flex-wrap items-center gap-x-6 gap-y-1">
                                                        <span className="text-[10px] font-medium uppercase text-[#6b7280]">Piso ANTT (referência)</span>
                                                        <span className="text-sm font-semibold text-[#111827]">R$ {formatCur(anttFloor)}</span>
                                                        <span className="text-[11px] font-normal text-[#6b7280]">
                                                            {cargoType} · {eixosAtuais ?? '?'} eixos · {Math.round(parseFloat(distanceKm.replace(',', '.')) || 0)} km · Resolução 6.084
                                                        </span>
                                                        {calcData.motoristaTabelado < anttFloor && (
                                                            <span className="text-[11px] font-semibold text-amber-700 flex items-center gap-1">
                                                                <AlertTriangle className="w-3 h-3" strokeWidth={1.75} />
                                                                motorista abaixo do piso
                                                            </span>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
                                            <div className="flex flex-col">
                                                <div className="flex justify-between mb-2"><span className="text-[10px] font-medium uppercase text-blue-600">{modoTabelado ? 'Preço Base (motorista)' : 'Preço Base'}</span></div>
                                                {/* No tabelado o Preço Base é RESULTADO (o motorista derivado),
                                                    não entrada: quem manda é o valor final. Fica read-only para
                                                    não dar a impressão de que digitar aqui muda a conta. */}
                                                <input
                                                    type="text"
                                                    readOnly={modoTabelado}
                                                    title={modoTabelado ? 'Calculado a partir do valor final e da margem pretendida.' : undefined}
                                                    className={`w-full p-4 rounded-xl font-medium outline-none border transition-all ${modoTabelado
                                                        ? 'bg-[#f3f4f6] border-[#e5e7eb] text-[#6b7280] cursor-not-allowed'
                                                        : 'text-[#111827] bg-[#f9fafb] focus:bg-white border-[#e5e7eb] focus:border-[#1d6fb8]'}`}
                                                    value={modoTabelado ? maskCurrency(calcData.motoristaTabelado) : maskCurrency(baseFreight)}
                                                    onChange={e => { startTimer(); setBaseFreight(maskCurrency(e.target.value)); }}
                                                />
                                            </div>
                                            <div className="flex flex-col">
                                                {/* Pedágio da rota simples vem do Qualp e é read-only. Qualquer
                                                    operador pode sobrescrever, mas com aviso na tela — e a mudança
                                                    entra na auditoria (campo 'tolls' já é diffado no salvar). */}
                                                <div className="flex justify-between items-center mb-2">
                                                    <span className="text-[10px] font-medium text-[#6b7280] uppercase">Pedágio</span>
                                                    {pedagioDoQualp && (
                                                        pedagioLiberado ? (
                                                            <button
                                                                onClick={() => { setTolls(maskCurrency(qualpRota!.pedagioCheio)); setPedagioLiberado(false); }}
                                                                className="text-[10px] font-medium text-[#6b7280] hover:text-[#111827] underline"
                                                            >
                                                                voltar ao Qualp
                                                            </button>
                                                        ) : (
                                                            <button
                                                                onClick={() => setPedagioLiberado(true)}
                                                                className="text-[10px] font-medium text-[#6b7280] hover:text-[#111827] underline"
                                                            >
                                                                sobrescrever
                                                            </button>
                                                        )
                                                    )}
                                                </div>
                                                <input
                                                    type="text"
                                                    readOnly={pedagioDoQualp && !pedagioLiberado}
                                                    title={pedagioDoQualp && !pedagioLiberado ? 'Pedágio do Qualp (tarifa cheia). Use "sobrescrever" para editar.' : undefined}
                                                    className={`w-full p-4 rounded-xl font-medium border outline-none transition-all ${pedagioDoQualp && !pedagioLiberado
                                                        ? 'bg-[#f3f4f6] border-[#e5e7eb] text-[#6b7280] cursor-not-allowed'
                                                        : 'bg-[#f9fafb] border-[#e5e7eb] focus:border-[#1d6fb8]'}`}
                                                    value={maskCurrency(tolls)}
                                                    onChange={e => setTolls(maskCurrency(e.target.value))}
                                                />
                                                {pedagioSobrescrito && (
                                                    <p className="text-[10px] font-medium text-amber-700 mt-1 flex items-center gap-1">
                                                        <AlertTriangle className="w-3 h-3 shrink-0" strokeWidth={1.75} />
                                                        Sobrescrito — Qualp: R$ {formatCur(qualpRota!.pedagioCheio)}
                                                    </p>
                                                )}
                                                {pedagioDoQualp && !pedagioSobrescrito && qualpRota!.pedagioTag > 0 && (
                                                    <p className="text-[10px] font-normal text-[#6b7280] mt-1">
                                                        Tarifa cheia • com tag seria R$ {formatCur(qualpRota!.pedagioTag)}
                                                    </p>
                                                )}
                                            </div>
                                            <div className="flex flex-col">
                                                <div className="flex justify-between mb-2"><span className="text-[10px] font-medium text-[#6b7280] uppercase">Valor Mercadoria</span></div>
                                                <input type="text" className="w-full p-4 bg-[#f9fafb] rounded-xl font-medium border border-[#e5e7eb] focus:border-[#1d6fb8] outline-none transition-all" value={maskCurrency(goodsValue)} onChange={e => { startTimer(); setGoodsValue(maskCurrency(e.target.value)); }} placeholder="R$ 0,00" />
                                            </div>
                                            <div className="flex flex-col">
                                                <div className="flex justify-between mb-2"><span className="text-[10px] font-medium text-[#6b7280] uppercase">Ad Val (%)</span></div>
                                                <input type="text" className="w-full p-4 bg-[#f9fafb] rounded-xl font-medium border border-[#e5e7eb] focus:border-[#1d6fb8] outline-none transition-all" value={insurancePercent} onChange={e => setInsurancePercent(e.target.value)} />
                                            </div>
                                            <div className="flex flex-col">
                                                <div className="flex justify-between mb-2"><span className="text-[10px] font-medium text-[#6b7280] uppercase tracking-tighter">Margem de Lucro (%)</span></div>
                                                <input type="text" className="w-full p-4 bg-[#f9fafb] rounded-xl font-medium border border-[#e5e7eb] focus:border-[#1d6fb8] outline-none transition-all" value={profitMargin} onChange={e => setProfitMargin(e.target.value)} />
                                            </div>
                                            <div className="flex flex-col">
                                                <div className="flex justify-between mb-2">
                                                    <span className="text-[10px] font-medium text-[#6b7280] uppercase">ICMS Destino (%)</span>
                                                    {icmsManual && <span className="text-[9px] font-medium text-amber-600 uppercase" title="ICMS ajustado manualmente — o automático não sobrescreve">Manual</span>}
                                                </div>
                                                {/* Alterar na mão marca a trava: o valor digitado vence o automático e fica salvo assim. */}
                                                <input type="text" className="w-full p-4 bg-[#f9fafb] rounded-xl font-medium border border-[#e5e7eb] focus:border-[#1d6fb8] outline-none transition-all" value={icmsPercent} onChange={e => { setIcmsPercent(e.target.value); setIcmsManual(true); }} />
                                            </div>
                                        </div>

                                        {/* Pagador de MG: só aparece quando a origem é MG. Alimenta a isenção da regra 2 (origem MG + pagador MG = isento). */}
                                        {getUF(origin) === 'MG' && (
                                            <div className="mb-8 -mt-2 flex flex-wrap items-center gap-3 bg-amber-50/60 border border-amber-100 rounded-xl p-4">
                                                <span className="text-[11px] font-medium uppercase text-amber-700">O pagador é de MG?</span>
                                                <div className="flex gap-2">
                                                    <button type="button" onClick={() => setPagadorMg(true)} className={`px-4 py-2 rounded-lg text-[11px] font-medium uppercase transition-all border ${pagadorMg ? 'bg-amber-600 text-white border-amber-600' : 'bg-white text-[#6b7280] border-[#e5e7eb] hover:border-amber-200'}`}>Sim</button>
                                                    <button type="button" onClick={() => setPagadorMg(false)} className={`px-4 py-2 rounded-lg text-[11px] font-medium uppercase transition-all border ${!pagadorMg ? 'bg-amber-600 text-white border-amber-600' : 'bg-white text-[#6b7280] border-[#e5e7eb] hover:border-amber-200'}`}>Não</button>
                                                </div>
                                                <span className="text-[10px] font-normal text-amber-600/80">Origem MG + pagador de MG = ICMS isento (0%).</span>
                                            </div>
                                        )}

                                        {/* Advanced Extra Costs Management */}
                                        <div className="pt-8 border-t border-slate-100 border-dashed animate-in fade-in slide-in-from-top-4 duration-700">
                                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-6">
                                                <div>
                                                    <h4 className="text-sm font-medium text-[#111827] uppercase tracking-wider flex items-center gap-2">
                                                        <PlusCircle className="w-5 h-5 text-blue-500" /> Custos Adicionais Específicos
                                                    </h4>
                                                    <p className="text-[10px] font-medium text-[#6b7280] mt-1 uppercase tracking-tight">Batedor, Descarga, Licenças, Agenciamento...</p>
                                                </div>
                                                <div className="flex flex-wrap gap-2">
                                                    {['Batedor', 'Descarga', 'Licenças', 'Agenciamento', 'Outros'].map(cat => (
                                                        <button
                                                            key={cat}
                                                            onClick={() => {
                                                                const id = Date.now().toString();
                                                                setOtherCosts(prev => [...prev, { id, label: cat, value: 0 }]);
                                                            }}
                                                            className="px-4 py-2 bg-[#f9fafb] hover:bg-blue-600 hover:text-white rounded-full text-[10px] font-medium uppercase transition-all shadow-sm border border-[#e5e7eb] flex items-center gap-2 group"
                                                        >
                                                            <Plus className="w-3 h-3 text-blue-400 group-hover:text-white" /> {cat}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>

                                            {otherCosts.length > 0 ? (
                                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                                    {otherCosts.map((cost, idx) => (
                                                        <div key={cost.id} className="bg-[#f9fafb]/50 p-4 rounded-lg border border-[#e5e7eb] flex items-center gap-4 group animate-in zoom-in-95 duration-300">
                                                            <div className="flex-1">
                                                                <div className="flex justify-between mb-1">
                                                                    <input
                                                                        type="text"
                                                                        className="bg-transparent text-[10px] font-medium uppercase text-[#6b7280] outline-none w-full"
                                                                        value={cost.label}
                                                                        onChange={(e) => {
                                                                            const newCosts = [...otherCosts];
                                                                            newCosts[idx].label = e.target.value;
                                                                            setOtherCosts(newCosts);
                                                                        }}
                                                                    />
                                                                </div>
                                                                <div className="relative">
                                                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-medium text-[#6b7280]">R$</span>
                                                                    <input
                                                                        type="text"
                                                                        className="w-full pl-8 pr-4 py-2 bg-white rounded-xl font-medium text-[#111827] outline-none border border-[#e5e7eb] focus:border-[#1d6fb8] transition-all text-sm"
                                                                        placeholder="R$ 0,00"
                                                                        value={maskCurrency(cost.value)}
                                                                        onChange={(e) => {
                                                                            const newCosts = [...otherCosts];
                                                                            newCosts[idx].value = num(maskCurrency(e.target.value));
                                                                            setOtherCosts(newCosts);
                                                                        }}
                                                                    />
                                                                </div>
                                                            </div>
                                                            <button
                                                                onClick={() => setOtherCosts(prev => prev.filter(c => c.id !== cost.id))}
                                                                className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                                                            >
                                                                <Trash2 className="w-4 h-4" />
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <div className="py-6 flex flex-col items-center justify-center text-slate-300 border-2 border-dashed border-slate-100 rounded-lg opacity-60">
                                                    <p className="text-[9px] font-medium uppercase tracking-widest">Nenhum custo adicional inserido</p>
                                                </div>
                                            )}

                                            <div className="mt-4 pt-4 border-t border-slate-100 flex justify-between items-center px-4">
                                                <span className="text-[10px] font-medium text-[#6b7280] uppercase tracking-widest">Total Adicionais:</span>
                                                <span className="text-lg font-medium text-blue-600">R$ {formatCur(otherCosts.reduce((acc, c) => acc + c.value, 0))}</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Extrato Detalhado da Cotação moved inside main column */}
                                    <div className="bg-white border border-[#e5e7eb] p-6 rounded-xl">
                                        <div className="flex items-center gap-2 mb-6">
                                            <FileText className="w-4 h-4 text-[#6b7280]" strokeWidth={1.75} />
                                            <h3 className="font-medium text-sm text-[#111827]">Extrato Detalhado da Operação</h3>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12">
                                            <div>
                                                <div className="flex justify-between items-center py-3 border-b border-[#f3f4f6]">
                                                    <span className="text-xs font-normal text-[#6b7280]">Frete Base / Poder de Compra</span>
                                                    <span className="font-medium text-sm text-[#111827]">R$ {formatCur(num(baseFreight))}</span>
                                                </div>
                                                <div className="flex justify-between items-center py-3 border-b border-[#f3f4f6]">
                                                    <span className="text-xs font-normal text-[#6b7280]">Pedágio Programado</span>
                                                    <span className="font-medium text-sm text-[#111827]">R$ {formatCur(num(tolls))}</span>
                                                </div>
                                                <div className="flex justify-between items-center py-3 border-b border-[#f3f4f6]">
                                                    <span className="text-xs font-normal text-[#6b7280]">Seguro Ad Valorem ({insurancePercent}%)</span>
                                                    <span className="font-medium text-sm text-[#111827]">R$ {formatCur(calcData.adValoremSelling)}</span>
                                                </div>
                                            </div>
                                            <div>
                                                <div className="flex justify-between items-center py-3 border-b border-[#f3f4f6]">
                                                    <span className="text-xs font-normal text-[#6b7280]">Impostos Federais (PIS/COFINS/CSLL)</span>
                                                    <span className="font-medium text-sm text-[#111827]">R$ {formatCur(calcData.fedTaxesAmount)}</span>
                                                </div>
                                                <div className="flex justify-between items-center py-3 border-b border-[#f3f4f6]">
                                                    <span className="text-xs font-normal text-[#6b7280]">ICMS Destino ({icmsPercent}%)</span>
                                                    <span className="font-medium text-sm text-[#111827]">R$ {formatCur(calcData.icmsAmount)}</span>
                                                </div>
                                                <div className="flex justify-between items-center py-3 border-b border-[#f3f4f6]">
                                                    <span className="text-xs font-normal text-[#6b7280]">Lucro Projetado (Remuneração)</span>
                                                    <span className="font-medium text-sm text-emerald-600">R$ {formatCur(calcData.realProfitAmount)} ({calcData.realMarginPercent.toFixed(1)}%)</span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="mt-6 pt-5 border-t border-[#e5e7eb] flex flex-wrap items-center justify-between gap-4">
                                            <div className="px-4 py-2 bg-[#f9fafb] rounded-lg border border-[#e5e7eb]">
                                                <p className="text-[10px] font-normal text-[#6b7280] leading-none mb-1">Custo Direto Total</p>
                                                <p className="text-sm font-medium text-[#111827]">R$ {formatCur(calcData.realDirectCosts)}</p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-[10px] font-normal text-[#6b7280] mb-1">Validação de Viabilidade</p>
                                                <div className="flex items-center gap-2 justify-end">
                                                    <div className={`w-2 h-2 rounded-full ${calcData.realMarginPercent >= marginThreshold ? 'bg-emerald-500' : 'bg-red-500'}`}></div>
                                                    <span className={`text-xs font-medium ${calcData.realMarginPercent >= marginThreshold ? 'text-emerald-600' : 'text-red-600'}`}>
                                                        {calcData.realMarginPercent >= marginThreshold ? 'Margem Saudável' : 'Revisar Custo'}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="lg:col-span-1 space-y-8">
                                    <div className="bg-white border border-[#e5e7eb] p-6 rounded-xl flex flex-col gap-3">
                                        <h4 className="text-xs font-normal text-[#6b7280] text-center">
                                            {hasAntt ? 'Piso Mínimo ANTT (Tabela A)' : isUtilitario ? 'Frete Base (KM)' : 'Referência'}
                                        </h4>
                                        {hasAntt ? (
                                            <>
                                                <div>
                                                    <label className="text-[11px] font-normal text-[#6b7280] block mb-1">Tipo de carga</label>
                                                    <div className="relative">
                                                        <select
                                                            value={cargoType}
                                                            onChange={e => setCargoType(e.target.value)}
                                                            className="w-full pl-3 pr-8 py-2.5 bg-[#f9fafb] border border-[#e5e7eb] rounded-lg text-sm font-normal text-[#111827] outline-none focus:border-[#1d6fb8] transition-colors appearance-none"
                                                        >
                                                            {ANTT_CARGO_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                                        </select>
                                                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6b7280] pointer-events-none" strokeWidth={1.75} />
                                                    </div>
                                                </div>
                                                <p className="text-2xl font-medium text-[#111827] text-center">
                                                    {anttFloor !== null ? `R$ ${formatCur(anttFloor)}` : '—'}
                                                </p>
                                                {/* Granel pressurizada é o único tipo em que a fonte do piso (Qualp)
                                                    diverge da Tabela A local. Aviso discreto: o operador confere e,
                                                    se precisar, sobrescreve o preço base como já faz hoje. */}
                                                {cargoType === CARGA_CONFERIR_PISO && anttFloor !== null && (
                                                    <p className="text-[11px] font-normal text-amber-700 text-center flex items-center justify-center gap-1.5">
                                                        <AlertTriangle className="w-3 h-3 shrink-0" strokeWidth={1.75} />
                                                        Confirmar piso manualmente
                                                    </p>
                                                )}
                                                {anttFloor !== null ? (
                                                    <button
                                                        onClick={() => {
                                                            setBaseFreight(maskCurrency(anttFloor));
                                                            showFeedback("Piso ANTT aplicado ao preço base!");
                                                        }}
                                                        className="w-full py-2.5 bg-white border border-[#e5e7eb] hover:bg-[#f9fafb] text-[#111827] rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-2"
                                                    >
                                                        <Check className="w-3.5 h-3.5" strokeWidth={1.75} /> Aderir ao Preço Base
                                                    </button>
                                                ) : rotaDesatualizada ? (
                                                    <p className="text-[11px] font-normal text-amber-700 text-center">
                                                        Desatualizado — clique em “Buscar rota” de novo.
                                                    </p>
                                                ) : !isMultiRota ? (
                                                    <p className="text-[11px] font-normal text-[#6b7280] text-center">
                                                        Clique em “Buscar rota” para trazer o piso do Qualp.
                                                    </p>
                                                ) : (
                                                    <p className="text-[11px] font-normal text-[#6b7280] text-center">
                                                        Sem coeficiente para {vehicleConfigs[vehicleType]?.axles ?? '?'} eixos nesta carga.
                                                    </p>
                                                )}
                                            </>
                                        ) : isUtilitario ? (
                                            <>
                                                <p className="text-2xl font-medium text-[#111827] text-center">
                                                    R$ {formatCur(utilitarioFreight ?? 0)}
                                                </p>
                                                <p className="text-[11px] font-normal text-[#6b7280] text-center">
                                                    {fatorTrajeto === 2 ? (
                                                        <>
                                                            {(parseFloat(distanceKm.replace(',', '.')) || 0).toLocaleString('pt-BR')} km ida e volta ={' '}
                                                            {((parseFloat(distanceKm.replace(',', '.')) || 0) * 2).toLocaleString('pt-BR')} km rodados × R$ {utilitarioRate!.toFixed(2).replace('.', ',')}/km
                                                        </>
                                                    ) : (
                                                        <>
                                                            {(parseFloat(distanceKm.replace(',', '.')) || 0).toLocaleString('pt-BR')} km × R$ {utilitarioRate!.toFixed(2).replace('.', ',')}/km
                                                        </>
                                                    )}
                                                </p>
                                                <button
                                                    onClick={() => {
                                                        setBaseFreight(maskCurrency(utilitarioFreight ?? 0));
                                                        showFeedback("Frete base (KM) aplicado ao preço base!");
                                                    }}
                                                    className="w-full py-2.5 bg-white border border-[#e5e7eb] hover:bg-[#f9fafb] text-[#111827] rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-2"
                                                >
                                                    <Check className="w-3.5 h-3.5" strokeWidth={1.75} /> Aderir ao Preço Base
                                                </button>
                                            </>
                                        ) : (
                                            <>
                                                <p className="text-2xl font-medium text-[#111827] text-center">—</p>
                                                <p className="text-[11px] font-normal text-[#6b7280] text-center">Veículo sem tabela ANTT (preço livre)</p>
                                            </>
                                        )}
                                    </div>

                                    {/* Final Freight Summary - Side Column */}
                                    <div className="bg-white border border-[#e5e7eb] p-6 rounded-xl flex flex-col gap-5">
                                        <div className="w-full text-center p-4 bg-[#f9fafb] rounded-lg border border-[#e5e7eb]">
                                            <p className="text-2xl font-medium text-[#111827]">{calcData.realMarginPercent.toFixed(1)}%</p>
                                            <p className="text-[11px] font-normal text-[#6b7280]">Margem Real</p>
                                            <div className="mt-2 h-1.5 w-full bg-[#e5e7eb] rounded-full overflow-hidden">
                                                <div className={`h-full rounded-full transition-all ${calcData.realMarginPercent >= marginThreshold ? 'bg-emerald-500' : calcData.realMarginPercent > 0 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${Math.max(0, Math.min(100, calcData.realMarginPercent))}%` }}></div>
                                            </div>
                                        </div>
                                        <div className="text-center w-full">
                                            <p className="text-xs font-normal text-[#6b7280] mb-1">Frete Final</p>
                                            <p className="text-3xl font-medium tracking-tight text-[#111827]">
                                                R$ {formatCur(calcData.finalFreight)}
                                            </p>

                                            <div className="flex flex-col gap-2 mt-4 mb-4">
                                                <div className="flex items-center justify-between bg-[#f9fafb] border border-[#e5e7eb] px-3 py-2 rounded-lg">
                                                    <span className="text-[11px] font-normal text-[#6b7280]">R$ / Ton (Cobrar)</span>
                                                    <span className="text-sm font-medium text-[#111827]">
                                                        R$ {formatCur((parseFloat(weight.replace('.', '').replace(',', '.')) / 1000) > 0 ? calcData.finalFreight / (parseFloat(weight.replace('.', '').replace(',', '.')) / 1000) : 0)}
                                                    </span>
                                                </div>
                                                <div className="flex items-center justify-between bg-[#f9fafb] border border-[#e5e7eb] px-3 py-2 rounded-lg">
                                                    <span className="text-[11px] font-normal text-[#6b7280]">R$ / Ton (Pagar)</span>
                                                    <span className="text-sm font-medium text-[#111827]">
                                                        R$ {formatCur((parseFloat(weight.replace('.', '').replace(',', '.')) / 1000) > 0 ? num(baseFreight) / (parseFloat(weight.replace('.', '').replace(',', '.')) / 1000) : 0)}
                                                    </span>
                                                </div>
                                            </div>
                                            {/* Toggle: abrir composição de custo ao cliente */}
                                            <button
                                                onClick={() => setOpenCostToClient(v => !v)}
                                                className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border transition-colors ${openCostToClient ? 'bg-[#eff6ff] border-[#bfdbfe]' : 'bg-white border-[#e5e7eb] hover:bg-[#f9fafb]'}`}
                                                title="Inclui a composição detalhada do custo na cópia e no PDF"
                                            >
                                                <span className="flex items-center gap-2 text-xs font-medium text-[#111827]">
                                                    <Layers className="w-3.5 h-3.5 text-[#1d6fb8]" strokeWidth={1.75} /> Abrir composição ao cliente
                                                </span>
                                                <span className={`w-8 h-4 rounded-full relative transition-all ${openCostToClient ? 'bg-[#1d6fb8]' : 'bg-[#e5e7eb]'}`}>
                                                    <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${openCostToClient ? 'left-4' : 'left-0.5'}`}></span>
                                                </span>
                                            </button>

                                            {/* Composição cobrada do cliente (exibida ao ativar o toggle) */}
                                            {openCostToClient && (
                                                <div className="mt-3 text-left bg-[#f9fafb] border border-[#e5e7eb] rounded-lg p-3 animate-fade-in-up">
                                                    {buildCompositionItems().map((item, i) => (
                                                        <div key={i} className="flex items-center justify-between py-1.5 border-b border-[#e5e7eb] last:border-0">
                                                            <span className="text-[11px] font-normal text-[#6b7280]">{item.label}</span>
                                                            <span className="text-xs font-medium text-[#111827]">R$ {formatCur(item.value)}</span>
                                                        </div>
                                                    ))}
                                                    <div className="flex items-center justify-between pt-2 mt-1 border-t border-[#e5e7eb]">
                                                        <span className="text-xs font-medium text-[#111827]">Total</span>
                                                        <span className="text-sm font-medium text-[#1d6fb8]">R$ {formatCur(calcData.finalFreight)}</span>
                                                    </div>
                                                </div>
                                            )}

                                            {/* Salvar · Pipefy · Ramper — os três agem NESTA tela. A cotação é
                                                salva uma única vez: o primeiro botão que salva cria o registro,
                                                os demais reconhecem que já está salva e só disparam a integração
                                                sobre o mesmo id. Depois de enviar, o operador permanece aqui e
                                                pode mandar pro outro destino também. */}
                                            <div className="grid grid-cols-3 gap-2 w-full mt-4">
                                                <button
                                                    onClick={() => saveQuote('pending', false, false, true)}
                                                    disabled={savingQuote}
                                                    className="bg-white border border-[#e5e7eb] text-[#111827] py-2.5 rounded-lg font-medium text-xs hover:bg-[#f9fafb] flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    <Save className="w-3.5 h-3.5" strokeWidth={1.75} /> {savingQuote ? 'Salvando...' : 'Salvar'}
                                                </button>
                                                {/* Pipefy: salva se preciso e abre o modal de fechamento, que
                                                    continua existindo — é dele que saem os 25 campos do card. */}
                                                <button
                                                    onClick={handleBotaoPipefy}
                                                    disabled={savingQuote}
                                                    title={jaFoiPraPipefy ? 'Esta cotação já tem card na operação do Pipefy' : 'Salva e abre o fechamento da carga'}
                                                    className={`py-2.5 rounded-lg font-medium text-xs flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${jaFoiPraPipefy
                                                        ? 'bg-emerald-50 border border-emerald-300 text-emerald-700 hover:bg-emerald-100'
                                                        : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}
                                                >
                                                    {jaFoiPraPipefy
                                                        ? <><CheckCircle className="w-3.5 h-3.5" strokeWidth={1.75} /> No Pipefy</>
                                                        : <><ThumbsUp className="w-3.5 h-3.5" strokeWidth={1.75} /> Pipefy</>}
                                                </button>
                                                {/* Ramper: salva se preciso, confirma e dispara sem sair da tela. */}
                                                <button
                                                    onClick={handleBotaoRamper}
                                                    disabled={savingQuote || ramperSending}
                                                    title={enviadoRamper ? 'Já enviado nesta sessão — reenviar cria outro card' : 'Salva e envia a cotação pro Ramper'}
                                                    className={`py-2.5 rounded-lg font-medium text-xs flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${enviadoRamper
                                                        ? 'bg-blue-50 border border-blue-300 text-[#1d6fb8] hover:bg-blue-100'
                                                        : 'bg-[#1d6fb8] text-white hover:bg-[#1a5f9e]'}`}
                                                >
                                                    {ramperSending
                                                        ? <>Enviando...</>
                                                        : enviadoRamper
                                                            ? <><CheckCircle className="w-3.5 h-3.5" strokeWidth={1.75} /> Reenviar</>
                                                            : <><Send className="w-3.5 h-3.5" strokeWidth={1.75} /> Ramper</>}
                                                </button>
                                            </div>

                                            <div className="grid grid-cols-2 gap-2 w-full mt-2">
                                                {/* Perdido: livre em cotação de Pauta. Se já é Ganha, marcar Perdida é rebaixamento
                                                    (mexe em faturamento/Pipefy) -> só master, com confirmação; operador fica bloqueado. */}
                                                <button
                                                    onClick={() => {
                                                        if (cotacaoGanhaReaberta) {
                                                            if (podeRebaixarGanha && window.confirm('Esta cotação está GANHA (ligada à operação no Pipefy e ao faturamento). Marcar como Perdida é um rebaixamento que pode gerar inconsistência. Confirmar?')) saveQuote('lost', true);
                                                        } else {
                                                            saveQuote('lost');
                                                        }
                                                    }}
                                                    disabled={savingQuote || (cotacaoGanhaReaberta && !podeRebaixarGanha)}
                                                    title={cotacaoGanhaReaberta && !podeRebaixarGanha ? 'Só o gestor pode rebaixar uma cotação Ganha' : undefined}
                                                    className="bg-white border border-[#e5e7eb] text-red-600 py-2.5 rounded-lg font-medium text-xs flex items-center justify-center gap-1.5 hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                                                    <ThumbsDown className="w-3.5 h-3.5" strokeWidth={1.75} /> Perdido
                                                </button>
                                                <button onClick={handleCopyQuoteText} className="bg-white border border-[#e5e7eb] text-[#111827] py-2.5 rounded-lg font-medium text-xs hover:bg-[#f9fafb] flex items-center justify-center gap-1.5 transition-colors">
                                                    <ClipboardCopy className="w-3.5 h-3.5" strokeWidth={1.75} /> Copiar
                                                </button>
                                                <button onClick={handleQuickSend} className="col-span-2 bg-[#1d6fb8] text-white py-2.5 rounded-lg font-medium text-xs hover:bg-[#1a5f9e] flex items-center justify-center gap-1.5 transition-colors">
                                                    <Zap className="w-3.5 h-3.5" strokeWidth={1.75} /> Envio Rápido (Copiar + CRM)
                                                </button>
                                                {/* Rebaixar Ganha->Pauta: AÇÃO EXPLÍCITA e consciente (Ganha está ligada à operação/faturamento).
                                                    Só master, só quando a cotação reaberta já é Ganha. Salvar edição NUNCA rebaixa. */}
                                                {podeRebaixarGanha && (
                                                    <button
                                                        disabled={savingQuote}
                                                        onClick={() => { if (window.confirm('Esta cotação está GANHA (ligada à operação no Pipefy e ao faturamento). Voltar pra Pauta pode gerar inconsistência. Confirmar o rebaixamento?')) saveQuote('pending', true); }}
                                                        className="col-span-2 bg-amber-50 border border-amber-300 text-amber-700 py-2.5 rounded-lg font-medium text-xs hover:bg-amber-100 flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                                                        <ThumbsDown className="w-3.5 h-3.5" strokeWidth={1.75} /> Voltar pra Pauta (rebaixar Ganha)
                                                    </button>
                                                )}
                                                <button onClick={generatePDF} className="col-span-2 bg-white border border-[#e5e7eb] text-[#111827] py-2.5 rounded-lg font-medium text-xs hover:bg-[#f9fafb] flex items-center justify-center gap-1.5 transition-colors">
                                                    <FileDown className="w-3.5 h-3.5 text-[#1d6fb8]" strokeWidth={1.75} /> PDF Comercial
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                        </div>
                    )}

                    {activeTab === 'history' && (
                        <div className="space-y-4 animate-fade-in-up">
                            <div className="flex items-center gap-4 px-4 mb-4">
                                <History className="w-8 h-8 text-[#111827]" />
                                <h1 className="text-3xl font-medium text-[#111827] tracking-tight">Histórico de Cotações</h1>
                            </div>
                            <div className="bg-white p-4 rounded-xl border shadow-sm flex items-center gap-6 px-10 text-[9px] font-medium text-[#6b7280] uppercase tracking-widest mb-4">
                                <span className="w-24">Status</span>
                                <span className="w-28">Data</span>
                                <span className="flex-1">Ref / Rota</span>
                                <span className="w-32">Identificação</span>
                                <span className="w-28 text-right">Rentabilidade</span>
                                <span className="w-32 text-right">Valor Final</span>
                                <span className="w-20"></span>
                            </div>
                            <div className="space-y-3">
                                {filteredHistory.map(h => {
                                    // Uso de valores persistidos ou cálculo de fallback para compatibilidade
                                    const realMargin = h.realMarginPercent !== undefined ? h.realMarginPercent : (
                                        (() => {
                                            const icmsAmt = h.totalFreight * (h.icmsPercent / 100);
                                            const fedAmt = h.totalFreight * ((h.pisPercent + h.cofinsPercent + h.csllPercent + h.irpjPercent) / 100);
                                            const directCosts = h.baseFreight + h.tolls + (h.extraCosts || 0);
                                            const netProfit = h.totalFreight - icmsAmt - fedAmt - directCosts - (h.adValorem || 0);
                                            return h.totalFreight > 0 ? (netProfit / h.totalFreight) * 100 : 0;
                                        })()
                                    );
                                    const profitValue = h.realProfit !== undefined ? h.realProfit : (
                                        (() => {
                                            const icmsAmt = h.totalFreight * (h.icmsPercent / 100);
                                            const fedAmt = h.totalFreight * ((h.pisPercent + h.cofinsPercent + h.csllPercent + h.irpjPercent) / 100);
                                            const directCosts = h.baseFreight + h.tolls + (h.extraCosts || 0);
                                            return h.totalFreight - icmsAmt - fedAmt - directCosts - (h.adValorem || 0);
                                        })()
                                    );

                                    const customer = customers.find(c => c.id === h.customerId);

                                    return (
                                        <div key={h.id} className="bg-white h-20 px-10 rounded-xl border shadow-sm flex items-center gap-6 group hover:border-blue-500 transition-all">
                                            <div className="w-24"><span className={`px-3 py-1.5 rounded-lg text-[8px] font-medium text-white uppercase ${h.status === 'won' ? 'bg-emerald-500' : h.status === 'lost' ? 'bg-red-500' : 'bg-amber-400'}`}>{h.status === 'won' ? 'GANHO' : h.status === 'lost' ? 'PERDIDO' : 'PAUTA'}</span></div>
                                            <span className="w-28 text-[10px] font-medium text-[#6b7280]">
                                                {(() => {
                                                    if (!h.createdAt || h.createdAt === 0) return 'S/ Data';
                                                    const d = new Date(h.createdAt);
                                                    return isNaN(d.getTime()) ? 'Data Inválida' : d.toLocaleDateString();
                                                })()}
                                            </span>
                                            <div className="flex-1 min-w-0 flex flex-col justify-center">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-medium text-[#111827] text-xs">{h.proposalNumber}</span>
                                                    {h.clientReference && <span className="bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded text-[8px] font-medium uppercase tracking-wide">{h.clientReference}</span>}
                                                </div>
                                                {customer && (
                                                    <p className="text-[9px] font-medium text-blue-600 uppercase tracking-widest mt-0.5 truncate">{customer.name} {h.merchandiseType && <span className="text-slate-300 ml-1">| {h.merchandiseType}</span>}</p>
                                                )}
                                                <p className="text-[8px] font-medium text-[#6b7280] truncate uppercase mt-0.5">{(h.origin || '').split(',')[0]} ➝ {(h.destination || '').split(',')[0]} <span className="opacity-40">| {h.vehicleType}</span></p>
                                            </div>
                                            <div className="w-32 flex items-center gap-2">
                                                <div className="w-7 h-7 rounded-lg bg-[#f9fafb] flex items-center justify-center font-medium text-[10px] text-[#111827] shadow-sm border border-[#e5e7eb]">
                                                    {h.createdByName?.charAt(0) || 'A'}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    {/* Responsável = CRIADOR (createdByName), imutável. "editado por" mostra o último editor sem virar dono. */}
                                                    <p className="text-[9px] font-medium text-[#111827] uppercase truncate">{h.createdByName || 'Admin'}</p>
                                                    <p className="text-[7px] font-medium text-[#6b7280] uppercase tracking-tighter">Responsável</p>
                                                    {h.updatedByName && h.updatedByName !== h.createdByName && (
                                                        <p className="text-[7px] font-medium text-[#9ca3af] tracking-tight truncate">editado por {h.updatedByName}</p>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="w-28 text-right">
                                                <p className={`text-xs font-medium ${realMargin < 15 ? 'text-red-500' : 'text-emerald-600'}`}>{realMargin.toFixed(1)}%</p>
                                                <p className="text-[8px] font-medium text-[#6b7280] uppercase">Lucro: R$ {formatCur(profitValue)}</p>
                                            </div>
                                            <div className="w-32 text-right"><p className="text-base font-medium text-[#111827]">R$ {formatCur(h.totalFreight)}</p></div>
                                            <div className="w-40 flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-all">
                                                {/* Abrir card no Pipefy (cargas já enviadas) — visível a todos; usa URL salva ou open-cards/<id>. */}
                                                {pipefyCardLink(h) && (
                                                    <a href={pipefyCardLink(h)!} target="_blank" rel="noopener noreferrer" title="Abrir card no Pipefy" className="p-2 text-violet-600 hover:bg-violet-50 rounded-lg">
                                                        <Send className="w-4 h-4" />
                                                    </a>
                                                )}
                                                <button onClick={() => loadQuote(h)} title="Editar" className="p-2 text-blue-500 hover:bg-blue-50 rounded-lg">
                                                    <Edit3 className="w-4 h-4" />
                                                </button>
                                                <button onClick={() => duplicateQuote(h)} title="Duplicar como nova cotação" className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg">
                                                    <CopyPlus className="w-4 h-4" />
                                                </button>
                                                {/* Histórico de alterações (auditoria): só master. Abre modal com quem mexeu e o antes/depois. */}
                                                {currentUser.role === 'master' && (
                                                    <button onClick={() => abrirAuditoria(h)} title="Histórico de alterações" className="p-2 text-[#6b7280] hover:bg-[#f9fafb] rounded-lg">
                                                        <Clock className="w-4 h-4" />
                                                    </button>
                                                )}
                                                {/* Apagar (soft delete/lixeira): master apaga qualquer uma; operador só as PRÓPRIAS e
                                                    NÃO-Ganha (Ganha = Pipefy/faturamento, só master). O guard na função é a trava real. */}
                                                {(currentUser.role === 'master' || (h.status !== 'won' && h.createdBy === currentUser.id)) && (
                                                    <button onClick={async () => {
                                                        const r = await deleteFreightCalculation(h.id, { id: currentUser.id, name: currentUser.name, role: currentUser.role });
                                                        if (r.ok) {
                                                            setHistory(prev => prev.filter(i => i.id !== h.id));
                                                            setTrash(prev => [{ ...h, deletedAt: new Date().toISOString(), deletedBy: currentUser.id, deletedByName: currentUser.name }, ...prev]);
                                                            showFeedback('Cotação movida para a lixeira.');
                                                        } else {
                                                            const msg = r.motivo === 'ganha_so_master' ? 'Cotação Ganha só o gestor apaga.'
                                                                : r.motivo === 'nao_e_dona' ? 'Você só pode apagar cotações que criou.'
                                                                : 'Não foi possível mover para a lixeira.';
                                                            showFeedback(msg, 'error');
                                                        }
                                                    }} title="Mover para a lixeira" className="p-2 text-red-400 hover:bg-red-50 rounded-lg">
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {activeTab === 'trash' && (
                        <div className="space-y-4 animate-fade-in-up">
                            <div className="flex items-center gap-4 px-4 mb-2">
                                <Trash2 className="w-8 h-8 text-[#111827]" />
                                <div>
                                    <h1 className="text-3xl font-medium text-[#111827] tracking-tight">Lixeira</h1>
                                    <p className="text-[11px] font-medium text-[#6b7280] mt-1">Cotações movidas para a lixeira são apagadas definitivamente na abertura do dia seguinte.</p>
                                </div>
                            </div>

                            {trash.length === 0 ? (
                                <div className="bg-white p-12 rounded-xl border shadow-sm flex flex-col items-center justify-center text-center">
                                    <Trash2 className="w-10 h-10 text-[#d1d5db] mb-3" strokeWidth={1.5} />
                                    <p className="text-sm font-medium text-[#6b7280]">A lixeira está vazia.</p>
                                </div>
                            ) : (
                                <>
                                    <div className="bg-white p-4 rounded-xl border shadow-sm flex items-center gap-6 px-10 text-[9px] font-medium text-[#6b7280] uppercase tracking-widest mb-4">
                                        <span className="w-24">Status</span>
                                        <span className="w-32">Excluída em</span>
                                        <span className="flex-1">Ref / Rota</span>
                                        <span className="w-32 text-right">Valor Final</span>
                                        <span className="w-28"></span>
                                    </div>
                                    <div className="space-y-3">
                                        {trash.map(h => {
                                            const customer = customers.find(c => c.id === h.customerId);
                                            return (
                                                <div key={h.id} className="bg-white h-20 px-10 rounded-xl border shadow-sm flex items-center gap-6 group hover:border-blue-500 transition-all">
                                                    <div className="w-24"><span className={`px-3 py-1.5 rounded-lg text-[8px] font-medium text-white uppercase ${h.status === 'won' ? 'bg-emerald-500' : h.status === 'lost' ? 'bg-red-500' : 'bg-amber-400'}`}>{h.status === 'won' ? 'GANHO' : h.status === 'lost' ? 'PERDIDO' : 'PAUTA'}</span></div>
                                                    <div className="w-40 flex flex-col">
                                                        <span className="text-[10px] font-medium text-[#6b7280]">
                                                            {(() => {
                                                                if (!h.deletedAt) return '—';
                                                                const d = new Date(h.deletedAt);
                                                                return isNaN(d.getTime()) ? '—' : d.toLocaleString();
                                                            })()}
                                                        </span>
                                                        {/* Quem apagou (relatório de apagadas). Em branco nas apagadas antes deste registro. */}
                                                        <span className="text-[9px] font-medium text-[#9ca3af] uppercase tracking-wide truncate">
                                                            {h.deletedByName ? `por ${h.deletedByName}` : 'por —'}
                                                        </span>
                                                    </div>
                                                    <div className="flex-1 min-w-0 flex flex-col justify-center">
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-medium text-[#111827] text-xs">{h.proposalNumber}</span>
                                                            {h.clientReference && <span className="bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded text-[8px] font-medium uppercase tracking-wide">{h.clientReference}</span>}
                                                        </div>
                                                        {customer && (
                                                            <p className="text-[9px] font-medium text-blue-600 uppercase tracking-widest mt-0.5 truncate">{customer.name}</p>
                                                        )}
                                                        <p className="text-[8px] font-medium text-[#6b7280] truncate uppercase mt-0.5">{(h.origin || '').split(',')[0]} ➝ {(h.destination || '').split(',')[0]} <span className="opacity-40">| {h.vehicleType}</span></p>
                                                    </div>
                                                    <div className="w-32 text-right"><p className="text-base font-medium text-[#111827]">R$ {formatCur(h.totalFreight)}</p></div>
                                                    <div className="w-28 flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-all">
                                                        <button onClick={async () => {
                                                            if (await restoreFreightCalculation(h.id)) {
                                                                setTrash(prev => prev.filter(i => i.id !== h.id));
                                                                setHistory(prev => [{ ...h, deletedAt: undefined }, ...prev]);
                                                                showFeedback('Cotação restaurada.');
                                                            }
                                                        }} title="Restaurar para o Histórico" className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg">
                                                            <RotateCcw className="w-4 h-4" />
                                                        </button>
                                                        <button onClick={async () => {
                                                            if (!confirm(`Excluir DEFINITIVAMENTE a cotação ${h.proposalNumber}? Esta ação não pode ser desfeita.`)) return;
                                                            if (await permanentlyDeleteFreightCalculation(h.id)) {
                                                                setTrash(prev => prev.filter(i => i.id !== h.id));
                                                                showFeedback('Cotação excluída definitivamente.');
                                                            }
                                                        }} title="Excluir definitivamente" className="p-2 text-red-500 hover:bg-red-50 rounded-lg">
                                                            <Trash2 className="w-4 h-4" />
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </div>
            </main >

            {/* Modal: Histórico de alterações (auditoria) — só master (o ícone só aparece pra master) */}
            {auditQuote && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { setAuditQuote(null); setAuditLog(null); }}>
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-3 p-6 border-b border-[#f3f4f6]">
                            <Clock className="w-5 h-5 text-[#1d6fb8]" />
                            <div className="flex-1">
                                <h3 className="text-lg font-semibold text-[#111827]">Histórico de alterações</h3>
                                <p className="text-xs text-[#6b7280]">{auditQuote.proposalNumber} · {(auditQuote.origin || '—').split(',')[0]} → {(auditQuote.destination || '—').split(',')[0]}</p>
                            </div>
                            <button onClick={() => { setAuditQuote(null); setAuditLog(null); }} className="p-1.5 text-[#6b7280] hover:bg-[#f9fafb] rounded-lg"><X className="w-4 h-4" /></button>
                        </div>
                        <div className="p-6 overflow-y-auto space-y-4">
                            {auditLog === null ? (
                                <p className="text-sm text-[#6b7280]">Carregando…</p>
                            ) : auditLog.length === 0 ? (
                                <p className="text-sm text-[#6b7280]">Nenhuma alteração registrada nesta cotação. (A auditoria registra edições feitas a partir de agora; criação e visualização não entram.)</p>
                            ) : auditLog.map(a => (
                                <div key={a.id} className="border border-[#e5e7eb] rounded-xl p-4">
                                    <div className="flex items-center gap-2 flex-wrap mb-2">
                                        <span className="text-sm font-medium text-[#111827]">{a.alteradoPorNome || 'Usuário'}</span>
                                        <span className="text-xs text-[#9ca3af]">{new Date(a.alteradoEm).toLocaleString('pt-BR')}</span>
                                        {a.statusNoMomento && (
                                            <span className={`text-[9px] uppercase font-medium px-1.5 py-0.5 rounded ${a.statusNoMomento === 'won' ? 'bg-emerald-100 text-emerald-700' : a.statusNoMomento === 'lost' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                                                {a.statusNoMomento === 'won' ? 'era Ganha' : a.statusNoMomento === 'lost' ? 'era Perdida' : 'em Pauta'}
                                            </span>
                                        )}
                                    </div>
                                    <div className="space-y-1">
                                        {a.mudancas.map((c, i) => (
                                            <div key={i} className="text-xs flex flex-wrap items-center gap-2">
                                                <span className="font-medium text-[#6b7280] w-32 shrink-0">{c.label}</span>
                                                <span className="text-red-600 line-through">{String(c.de)}</span>
                                                <ArrowRight className="w-3 h-3 text-[#9ca3af]" />
                                                <span className="text-emerald-700 font-medium">{String(c.para)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Modal de Validação de Margem */}
            {/* Modal: Trocar senha (usuário logado) */}
            {showChangePassword && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[120] flex items-center justify-center p-6 animate-fade-in">
                    <div className="bg-white w-full max-w-sm rounded-xl border border-[#e5e7eb] shadow-sm p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-base font-medium text-[#111827]">Trocar senha</h3>
                            <button onClick={() => { setShowChangePassword(false); setNewPassword(''); }} className="p-1.5 text-[#6b7280] hover:bg-[#f9fafb] rounded-md transition-colors">
                                <X className="w-4 h-4" strokeWidth={1.75} />
                            </button>
                        </div>
                        <form onSubmit={handleChangePassword} className="space-y-4">
                            <input type="password" autoComplete="new-password" className="w-full px-4 py-3 bg-[#f9fafb] border border-[#e5e7eb] rounded-lg font-normal text-[#111827] outline-none focus:border-[#1d6fb8] transition-colors" placeholder="Nova senha (mín. 6 caracteres)" value={newPassword} onChange={e => setNewPassword(e.target.value)} required />
                            <button type="submit" disabled={savingPassword} className="w-full py-2.5 bg-[#1d6fb8] text-white rounded-lg font-medium text-sm hover:bg-[#1a5f9e] transition-colors disabled:opacity-50">
                                {savingPassword ? 'Salvando...' : 'Salvar nova senha'}
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {/* Modal OBRIGATÓRIO: troca da senha temporária no 1º acesso (não fecha sem trocar) */}
            {currentUser && mustChangePwd && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-6">
                    <div className="bg-white w-full max-w-sm rounded-xl border border-[#e5e7eb] shadow-lg p-6">
                        <div className="flex items-center gap-2 mb-2">
                            <Key className="w-5 h-5 text-[#1d6fb8]" />
                            <h3 className="text-base font-medium text-[#111827]">Defina sua senha</h3>
                        </div>
                        <p className="text-xs font-normal text-[#6b7280] mb-4">Primeiro acesso: troque a senha temporária por uma sua para continuar.</p>
                        <form onSubmit={handleForcedPasswordChange} className="space-y-3">
                            <input type="password" autoComplete="new-password" className="w-full px-4 py-3 bg-[#f9fafb] border border-[#e5e7eb] rounded-lg font-normal text-[#111827] outline-none focus:border-[#1d6fb8] transition-colors" placeholder="Nova senha (mín. 6 caracteres)" value={newPassword} onChange={e => setNewPassword(e.target.value)} required />
                            <button type="submit" disabled={savingPassword} className="w-full py-2.5 bg-[#1d6fb8] text-white rounded-lg font-medium text-sm hover:bg-[#1a5f9e] transition-colors disabled:opacity-50">
                                {savingPassword ? 'Salvando...' : 'Salvar e continuar'}
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {/* Modal: credenciais prontas pra copiar (criar usuário / redefinir senha) */}
            {credMsg && (() => {
                const texto = `Acesso ao OmniFlow:\nLogin: ${credMsg.email}\nSenha temporária: ${credMsg.password}\n\nNo primeiro acesso o sistema vai pedir pra você trocar a senha.`;
                return (
                    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[130] flex items-center justify-center p-6 animate-fade-in">
                        <div className="bg-white w-full max-w-md rounded-xl border border-[#e5e7eb] shadow-sm p-6">
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="text-base font-medium text-[#111827]">{credMsg.title} ✅</h3>
                                <button onClick={() => setCredMsg(null)} className="p-1.5 text-[#6b7280] hover:bg-[#f9fafb] rounded-md"><X className="w-4 h-4" /></button>
                            </div>
                            <p className="text-xs font-normal text-[#6b7280] mb-2">Copie e mande pro usuário por fora (WhatsApp/mensagem). Não enviamos e-mail.</p>
                            <textarea readOnly value={texto} rows={5} className="w-full px-4 py-3 bg-[#f9fafb] border border-[#e5e7eb] rounded-lg text-sm font-normal text-[#111827] outline-none resize-none" />
                            <div className="flex gap-2 mt-3">
                                <button onClick={() => navigator.clipboard.writeText(texto).then(() => showFeedback('Mensagem copiada!'))} className="flex-1 px-4 py-2.5 bg-[#1d6fb8] text-white rounded-lg text-sm font-medium hover:bg-[#1a5f9e] transition-colors flex items-center justify-center gap-1.5">
                                    <ClipboardCopy className="w-4 h-4" /> Copiar mensagem
                                </button>
                                <button onClick={() => setCredMsg(null)} className="px-4 py-2.5 bg-white border border-[#e5e7eb] text-[#111827] rounded-lg text-sm font-medium hover:bg-[#f9fafb]">Fechar</button>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* Modal: Importar Solicitação (leitura inteligente via Gemini) */}
            {showImportModal && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[120] flex items-center justify-center p-6 animate-fade-in">
                    <div className="bg-white w-full max-w-lg rounded-xl border border-[#e5e7eb] shadow-sm overflow-hidden">
                        <div className="p-5 border-b border-[#e5e7eb] flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Sparkles className="w-5 h-5 text-[#1d6fb8]" strokeWidth={1.75} />
                                <h3 className="text-base font-medium text-[#111827]">Importar Solicitação</h3>
                            </div>
                            <button onClick={() => setShowImportModal(false)} className="p-1.5 text-[#6b7280] hover:bg-[#f9fafb] rounded-md transition-colors">
                                <X className="w-4 h-4" strokeWidth={1.75} />
                            </button>
                        </div>

                        {!importSummary ? (
                            <div className="p-5 space-y-4">
                                <p className="text-sm font-normal text-[#6b7280]">
                                    Anexe um arquivo (JPG, PNG ou PDF) <span className="font-medium">ou</span> cole o texto do e-mail/mensagem. A IA vai extrair os dados e preencher os campos.
                                </p>

                                <label className={`flex items-center justify-center gap-2 w-full px-4 py-6 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${importFile ? 'border-[#1d6fb8] bg-[#eff6ff]' : 'border-[#e5e7eb] hover:bg-[#f9fafb]'}`}>
                                    <Upload className="w-4 h-4 text-[#6b7280]" strokeWidth={1.75} />
                                    <span className="text-sm font-medium text-[#111827] truncate">
                                        {importFile ? importFile.name : 'Selecionar arquivo (JPG/PNG/PDF)'}
                                    </span>
                                    <input type="file" accept="image/png,image/jpeg,application/pdf" className="hidden" onChange={e => handleImportFile(e.target.files?.[0])} />
                                </label>

                                <div className="flex items-center gap-3">
                                    <div className="flex-1 h-px bg-[#e5e7eb]"></div>
                                    <span className="text-[11px] font-medium text-[#6b7280] uppercase">ou</span>
                                    <div className="flex-1 h-px bg-[#e5e7eb]"></div>
                                </div>

                                <textarea
                                    value={importText}
                                    onChange={e => { setImportText(e.target.value); if (e.target.value) setImportFile(null); }}
                                    placeholder="Cole aqui o conteúdo do e-mail ou mensagem..."
                                    rows={6}
                                    className="w-full px-4 py-3 bg-[#f9fafb] border border-[#e5e7eb] rounded-lg text-sm font-normal text-[#111827] outline-none focus:border-[#1d6fb8] transition-colors resize-none"
                                />

                                <div className="flex justify-end gap-3 pt-1">
                                    <button onClick={() => setShowImportModal(false)} className="px-4 py-2.5 bg-white border border-[#e5e7eb] text-[#111827] rounded-lg text-sm font-medium hover:bg-[#f9fafb] transition-colors">
                                        Cancelar
                                    </button>
                                    <button
                                        onClick={handleImportParse}
                                        disabled={importLoading || (!importFile && !importText.trim())}
                                        className="px-4 py-2.5 bg-[#1d6fb8] text-white rounded-lg text-sm font-medium hover:bg-[#1a5f9e] transition-colors disabled:opacity-50 flex items-center gap-2"
                                    >
                                        <Sparkles className="w-4 h-4" strokeWidth={1.75} />
                                        {importLoading ? 'Interpretando...' : 'Interpretar'}
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="p-5 space-y-4">
                                <p className="text-sm font-normal text-[#6b7280]">
                                    Campos preenchidos. Confira antes de continuar — os que ficaram em branco podem ser preenchidos manualmente.
                                </p>
                                <div className="space-y-1.5 max-h-72 overflow-y-auto">
                                    {importSummary.map((item, i) => (
                                        <div key={i} className="flex items-center justify-between bg-[#f9fafb] border border-[#e5e7eb] rounded-lg px-3 py-2 gap-3">
                                            <span className="text-[11px] font-medium text-[#6b7280] shrink-0">{item.label}</span>
                                            <span className={`text-xs text-right truncate ${item.filled ? 'font-medium text-[#111827]' : 'font-normal text-[#9ca3af] italic'}`}>{item.value}</span>
                                        </div>
                                    ))}
                                </div>
                                <div className="flex justify-end gap-3 pt-1">
                                    <button onClick={() => { setImportSummary(null); setImportText(''); setImportFile(null); }} className="px-4 py-2.5 bg-white border border-[#e5e7eb] text-[#111827] rounded-lg text-sm font-medium hover:bg-[#f9fafb] transition-colors">
                                        Importar outra
                                    </button>
                                    <button onClick={() => setShowImportModal(false)} className="px-4 py-2.5 bg-[#1d6fb8] text-white rounded-lg text-sm font-medium hover:bg-[#1a5f9e] transition-colors flex items-center gap-2">
                                        <Check className="w-4 h-4" strokeWidth={1.75} /> Concluir
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Modal pós-salvar: Nova Cotação ou Ver Histórico */}
            {showPostSaveModal && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[120] flex items-center justify-center p-6 animate-fade-in">
                    <div className="relative bg-white w-full max-w-sm rounded-xl border border-[#e5e7eb] shadow-sm p-6 text-center">
                        {/* Fechar: volta pra calculadora com a cotação ABERTA (restaura editingId p/ não duplicar no próximo Salvar). */}
                        <button
                            onClick={() => { setShowPostSaveModal(false); if (lastSavedQuote) setEditingId(lastSavedQuote.id); }}
                            title="Fechar e continuar na calculadora"
                            className="absolute top-3 right-3 p-1.5 text-[#9ca3af] hover:text-[#111827] hover:bg-[#f9fafb] rounded-lg transition-colors"
                        >
                            <X className="w-4 h-4" strokeWidth={2} />
                        </button>
                        <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-emerald-50 flex items-center justify-center">
                            <CheckCircle className="w-6 h-6 text-emerald-600" strokeWidth={1.75} />
                        </div>
                        <h3 className="text-base font-medium text-[#111827]">Cotação salva com sucesso</h3>
                        <p className="text-sm font-normal text-[#6b7280] mt-1 mb-6">O que deseja fazer agora?</p>
                        {/* O envio pro Ramper saiu daqui: agora é botão na própria tela de
                            resultado, junto de Salvar e Pipefy. Aqui ficam só as saídas. */}
                        <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                                <button
                                    onClick={() => { setShowPostSaveModal(false); resetForm(); setActiveTab('new'); }}
                                    className="py-2.5 bg-white border border-[#e5e7eb] text-[#111827] rounded-lg font-medium text-sm hover:bg-[#f9fafb] transition-colors flex items-center justify-center gap-2"
                                >
                                    <PlusCircle className="w-4 h-4" strokeWidth={1.75} /> Nova Cotação
                                </button>
                                <button
                                    onClick={() => { setShowPostSaveModal(false); resetForm(); setActiveTab('history'); }}
                                    className="py-2.5 bg-white border border-[#e5e7eb] text-[#111827] rounded-lg font-medium text-sm hover:bg-[#f9fafb] transition-colors flex items-center justify-center gap-2"
                                >
                                    <History className="w-4 h-4" strokeWidth={1.75} /> Ver Histórico
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {showMarginModal && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[110] flex items-center justify-center p-6 animate-fade-in">
                    <div className="bg-white w-full max-w-md rounded-xl shadow-sm overflow-hidden">
                        <div className="p-6 bg-red-50 border-b border-red-100 flex items-center gap-3">
                            <div className="p-2.5 bg-red-100 rounded-lg text-red-600"><AlertTriangle className="w-6 h-6" strokeWidth={1.75} /></div>
                            <div>
                                <h3 className="text-base font-medium text-red-900 leading-none">Margem abaixo do limiar</h3>
                                <p className="text-xs font-normal text-red-600 mt-1">Confirmação necessária</p>
                            </div>
                        </div>
                        <div className="p-8 space-y-6">
                            <div className="flex items-center justify-around gap-4">
                                <div className="text-center">
                                    <p className="text-[9px] font-medium text-[#6b7280] uppercase tracking-widest mb-1">Margem desta cotação</p>
                                    <p className="text-3xl font-medium text-red-500">{calcData.realMarginPercent.toFixed(1)}%</p>
                                </div>
                                <ArrowRight className="w-5 h-5 text-slate-300" />
                                <div className="text-center">
                                    <p className="text-[9px] font-medium text-[#6b7280] uppercase tracking-widest mb-1">Limiar mínimo</p>
                                    <p className="text-3xl font-medium text-[#111827]">{marginThreshold.toFixed(1)}%</p>
                                </div>
                            </div>
                            <p className="text-xs font-medium text-[#6b7280] text-center leading-relaxed">
                                Esta cotação está com a margem real abaixo do mínimo configurado. Deseja prosseguir mesmo assim?
                            </p>
                            <div className="grid grid-cols-2 gap-3 pt-2">
                                <button
                                    onClick={() => { setShowMarginModal(false); setPendingSaveStatus(null); setPendingStayOnForm(false); }}
                                    className="py-4 bg-[#f9fafb] text-[#111827] rounded-lg font-medium uppercase text-[10px] hover:bg-[#f3f4f6] transition-all"
                                >
                                    Revisar Custo
                                </button>
                                <button
                                    onClick={() => { const s = pendingSaveStatus; const stay = pendingStayOnForm; setShowMarginModal(false); setPendingSaveStatus(null); setPendingStayOnForm(false); if (s) saveQuote(s, true, stay); }}
                                    className="py-4 bg-red-500 text-white rounded-lg font-medium uppercase text-[10px] hover:bg-red-600 transition-all shadow-sm shadow-red-200"
                                >
                                    Prosseguir Assim
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Confirmação da chave de emergência — acionar sem confirmar é fácil
                demais para uma chave que permite cotar sem piso e pedágio do Qualp. */}
            {showEmergenciaModal && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[110] flex items-center justify-center p-6">
                    <div className="bg-white w-full max-w-lg rounded-2xl shadow-lg overflow-hidden">
                        <div className={`px-8 py-5 flex items-center gap-3 ${emergenciaLigada ? 'bg-emerald-50' : 'bg-amber-50'}`}>
                            <AlertTriangle className={`w-6 h-6 ${emergenciaLigada ? 'text-emerald-600' : 'text-amber-600'}`} strokeWidth={1.75} />
                            <h3 className="text-lg font-semibold text-[#111827]">
                                {emergenciaLigada ? 'Desligar o modo emergência?' : 'Ligar o modo emergência?'}
                            </h3>
                        </div>
                        <div className="px-8 py-6 space-y-3">
                            {emergenciaLigada ? (
                                <>
                                    <p className="text-sm text-[#374151]">
                                        O Qualp volta a ser fonte única: distância, pedágio e piso ANTT passam a vir dele,
                                        e a cotação de rota simples volta a travar se ele falhar.
                                    </p>
                                    <p className="text-xs text-[#6b7280]">
                                        Confirme que o Qualp está respondendo antes de desligar.
                                    </p>
                                </>
                            ) : (
                                <>
                                    <p className="text-sm font-medium text-[#111827]">
                                        Isso vai permitir cotar sem o piso e o pedágio do Qualp. Tem certeza?
                                    </p>
                                    <ul className="text-xs text-[#6b7280] space-y-1 list-disc pl-4">
                                        <li>O piso ANTT passa a vir da tabela local, não do Qualp.</li>
                                        <li>O pedágio fica manual — o operador digita a estimativa.</li>
                                        <li>Toda cotação fechada assim fica marcada para auditoria.</li>
                                        <li>Vale para todos os usuários, na hora.</li>
                                    </ul>
                                </>
                            )}
                            <p className="text-[11px] text-[#6b7280] pt-1">
                                Este acionamento fica registrado no seu nome, com data e hora.
                            </p>
                        </div>
                        <div className="px-8 py-5 bg-[#f9fafb] flex justify-end gap-3">
                            <button
                                onClick={() => setShowEmergenciaModal(false)}
                                disabled={salvandoEmergencia}
                                className="px-5 py-2.5 rounded-lg text-sm font-medium text-[#6b7280] hover:bg-white transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={() => alternarEmergencia(!emergenciaLigada)}
                                disabled={salvandoEmergencia}
                                className={`px-5 py-2.5 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-50 ${emergenciaLigada ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-amber-600 hover:bg-amber-700'}`}
                            >
                                {salvandoEmergencia ? 'Aplicando…' : emergenciaLigada ? 'Sim, desligar' : 'Sim, ligar emergência'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal de Configurações */}
            {
                showConfigModal && (
                    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100] flex items-center justify-center p-6">
                        <div className="bg-white w-full max-w-5xl h-[85vh] rounded-[3.5rem] shadow-sm flex flex-col overflow-hidden">
                            <div className="p-8 border-b flex justify-between items-center bg-[#f9fafb]">
                                <div className="flex items-center gap-4">
                                    <div className="p-3 bg-blue-600 rounded-lg text-white shadow-sm"><Settings className="w-6 h-6 animate-spin-slow" /></div>
                                    <div><h3 className="text-xl font-medium text-[#111827] uppercase tracking-tighter">Painel de Parâmetros</h3><p className="text-[10px] font-medium text-[#6b7280] uppercase tracking-widest">Configurações globais do sistema</p></div>
                                </div>
                                <button onClick={() => setShowConfigModal(false)} className="w-12 h-12 rounded-lg bg-white border border-[#e5e7eb] flex items-center justify-center text-[#6b7280] hover:text-red-500 hover:border-red-100 transition-all"><X className="w-6 h-6" /></button>
                            </div>
                            <div className="flex-1 flex overflow-hidden">
                                <aside className="w-72 bg-[#f9fafb] border-r p-6 space-y-3">
                                    {[
                                        { id: 'customers', label: 'Clientes', icon: Users },
                                        { id: 'financial', label: 'Tributação', icon: Percent },
                                        { id: 'goals', label: 'Metas', icon: Target },
                                        { id: 'fleet', label: 'Frota/ANTT', icon: Truck },
                                        { id: 'icms', label: 'Regras ICMS', icon: FileText },
                                        { id: 'identity', label: 'Marca', icon: ImageIcon },
                                        { id: 'users', label: 'Usuários', icon: Users }
                                    ].map(tab => (
                                        <button key={tab.id} onClick={() => setConfigTab(tab.id as any)} className={`w-full flex items-center gap-4 px-6 py-4 rounded-lg font-medium uppercase text-[10px] transition-all ${configTab === tab.id ? 'bg-white text-blue-600 shadow-md translate-x-2' : 'text-[#6b7280] hover:bg-white/50'}`}>
                                            <tab.icon className="w-4 h-4" /> {tab.label}
                                        </button>
                                    ))}
                                </aside>
                                <div className="flex-1 p-10 overflow-y-auto">
                                    {configTab === 'customers' && (
                                        <div className="space-y-8">
                                            <div className="bg-[#f9fafb] p-8 rounded-xl border border-[#e5e7eb] shadow-sm">
                                                <div className="flex items-center gap-3 mb-6">
                                                    <div className="p-2 bg-blue-100 rounded-xl text-blue-600"><PlusCircle className="w-4 h-4" /></div>
                                                    <h4 className="text-[11px] font-medium uppercase text-[#6b7280] tracking-widest">{editingCustomer ? 'Editar Cliente' : 'Novo Cliente'}</h4>
                                                </div>

                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-end">
                                                    <div className="space-y-4">
                                                        <div className="flex flex-col gap-2">
                                                            <label className="text-[10px] font-medium text-[#6b7280] uppercase ml-2">Nome do Cliente</label>
                                                            <input type="text" className="w-full p-5 bg-white rounded-lg font-medium outline-none border border-[#e5e7eb] focus:border-[#1d6fb8] transition-all shadow-inner" placeholder="Ex: Logística Brasil" value={newCustomerName} onChange={e => setNewCustomerName(e.target.value)} />
                                                        </div>

                                                        <div className="flex items-center gap-4 p-4 bg-white rounded-lg border-2 border-dashed border-slate-200">
                                                            <div className="w-16 h-16 bg-[#f9fafb] rounded-xl flex items-center justify-center overflow-hidden border-2 border-white shadow-sm">
                                                                {(customerFilePreview || newCustomerLogo) ? (
                                                                    <img src={customerFilePreview || newCustomerLogo} className="w-full h-full object-contain" />
                                                                ) : <ImageIcon className="w-6 h-6 text-slate-200" />}
                                                            </div>
                                                            <div className="flex-1">
                                                                <p className="text-[10px] font-medium text-[#6b7280] uppercase mb-2">Logotipo do Cliente</p>
                                                                <label className="bg-[#f9fafb] hover:bg-[#f3f4f6] px-4 py-2 rounded-lg text-[#111827] font-medium uppercase text-[9px] cursor-pointer transition-colors inline-flex items-center gap-2">
                                                                    <Download className="w-3 h-3" /> Escolher Imagem
                                                                    <input type="file" className="hidden" accept="image/*" onChange={(e) => {
                                                                        const file = e.target.files?.[0];
                                                                        if (file) {
                                                                            const reader = new FileReader();
                                                                            reader.onloadend = () => {
                                                                                setCustomerFilePreview(reader.result as string);
                                                                                setNewCustomerLogo(reader.result as string);
                                                                            };
                                                                            reader.readAsDataURL(file);
                                                                        }
                                                                    }} />
                                                                </label>
                                                            </div>
                                                        </div>

                                                        <div className="flex flex-col gap-2">
                                                            <label className="text-[10px] font-medium text-[#6b7280] uppercase ml-2">Vínculo no Pipefy (tabela Clientes)</label>
                                                            <div className="flex items-center gap-2">
                                                                <div className="flex-1">
                                                                    <PipefyAutocomplete tipo="cliente" value={newCustomerPipefyName} selectedId={newCustomerPipefyId}
                                                                        onChangeText={name => { setNewCustomerPipefyName(name); setNewCustomerPipefyId(undefined); }}
                                                                        onPick={rec => { setNewCustomerPipefyName(rec.title); setNewCustomerPipefyId(rec.id); }}
                                                                        placeholder="Buscar cliente no Pipefy (opcional)"
                                                                        className="w-full p-5 pr-16 bg-white rounded-lg font-medium outline-none border border-[#e5e7eb] focus:border-[#1d6fb8] transition-all shadow-inner" />
                                                                </div>
                                                                {(newCustomerPipefyId || newCustomerPipefyName) && (
                                                                    <button type="button" title="Remover vínculo" onClick={() => { setNewCustomerPipefyId(undefined); setNewCustomerPipefyName(''); }} className="shrink-0 p-3 bg-white border border-[#e5e7eb] rounded-lg text-[#6b7280] hover:bg-[#f9fafb] hover:text-red-500 transition-colors"><X className="w-4 h-4" /></button>
                                                                )}
                                                            </div>
                                                            <p className="text-[9px] font-normal text-[#9ca3af] ml-2">Opcional. Vincula o card de operação automaticamente. Sem vínculo, o operador confirma no fechamento.</p>
                                                        </div>
                                                    </div>

                                                    <div className="flex gap-3">
                                                        <button onClick={async () => {
                                                            if (newCustomerName) {
                                                                const logoFinal = customerFilePreview || newCustomerLogo;
                                                                if (editingCustomer) {
                                                                    const updated = await updateCustomer({ ...editingCustomer, name: newCustomerName, logoUrl: logoFinal, pipefyClientId: newCustomerPipefyId });
                                                                    if (updated) {
                                                                        setCustomers(customers.map(c => c.id === editingCustomer.id ? { ...c, name: newCustomerName, logoUrl: logoFinal, pipefyClientId: newCustomerPipefyId } : c));
                                                                        showFeedback("Cliente atualizado!");
                                                                    }
                                                                } else {
                                                                    const created = await createCustomer({ id: Date.now().toString(), name: newCustomerName, logoUrl: logoFinal, pipefyClientId: newCustomerPipefyId });
                                                                    if (created) {
                                                                        setCustomers([created, ...customers]);
                                                                        showFeedback("Cliente cadastrado!");
                                                                    }
                                                                }
                                                                setNewCustomerName('');
                                                                setNewCustomerLogo('');
                                                                setCustomerFilePreview(null);
                                                                setEditingCustomer(null);
                                                                setNewCustomerPipefyId(undefined);
                                                                setNewCustomerPipefyName('');
                                                            }
                                                        }} className="flex-1 py-5 bg-blue-600 text-white rounded-lg font-medium uppercase text-xs shadow-sm shadow-blue-200 hover:bg-blue-700 transition-all flex items-center justify-center gap-2">
                                                            <Save className="w-4 h-4" /> {editingCustomer ? 'Salvar Alterações' : 'Cadastrar'}
                                                        </button>
                                                        {editingCustomer && (
                                                            <button onClick={() => {
                                                                setEditingCustomer(null);
                                                                setNewCustomerName('');
                                                                setNewCustomerLogo('');
                                                                setCustomerFilePreview(null);
                                                                setNewCustomerPipefyId(undefined);
                                                                setNewCustomerPipefyName('');
                                                            }} className="px-6 bg-slate-200 text-[#111827] rounded-lg font-medium uppercase text-xs hover:bg-slate-300 transition-all">Cancelar</button>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                                {customers.map(c => (
                                                    <div key={c.id} className="p-5 bg-white rounded-xl border border-[#e5e7eb] flex items-center justify-between group hover:border-blue-100 transition-all shadow-sm">
                                                        <div className="flex items-center gap-4">
                                                            <div className="w-12 h-12 rounded-xl bg-[#f9fafb] border flex items-center justify-center overflow-hidden">
                                                                {c.logoUrl ? <img src={c.logoUrl} className="w-full h-full object-contain" /> : <span className="font-medium text-slate-300">{c.name.charAt(0)}</span>}
                                                            </div>
                                                            <div>
                                                                <p className="font-medium text-[#111827] text-xs uppercase tracking-tight">{c.name}</p>
                                                                <p className={`text-[9px] font-medium uppercase ${c.pipefyClientId ? 'text-emerald-500' : 'text-slate-300'}`}>{c.pipefyClientId ? '🔗 Vinculado ao Pipefy' : 'Sem vínculo Pipefy'}</p>
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                                                            <button onClick={() => {
                                                                setEditingCustomer(c);
                                                                setNewCustomerName(c.name);
                                                                setNewCustomerLogo(c.logoUrl || '');
                                                                setCustomerFilePreview(null);
                                                                setNewCustomerPipefyId(c.pipefyClientId);
                                                                setNewCustomerPipefyName(c.pipefyClientId ? c.name : '');
                                                            }} className="p-2 text-blue-400 hover:bg-blue-50 rounded-lg"><Edit3 className="w-4 h-4" /></button>
                                                            {currentUser.role === 'master' && (
                                                                <button onClick={async () => { if (await deleteCustomer(c.id)) setCustomers(customers.filter(i => i.id !== c.id)); }} className="p-2 text-red-300 hover:bg-red-50 rounded-lg">
                                                                    <Trash2 className="w-4 h-4" />
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    {configTab === 'financial' && (
                                        <div className="grid grid-cols-2 gap-8">{Object.entries(fedTaxes).filter(([k, v]) => typeof v === 'number').map(([key, val]) => {
                                            const labels: Record<string, string> = {
                                                pis: 'PIS (%)', cofins: 'COFINS (%)', csll: 'CSLL (%)', irpj: 'IRPJ (%)',
                                                insurancePolicyRate: 'Taxa Apólice / Ad Valorem Custo (%)',
                                                marginThreshold: 'Limiar Mínimo de Margem (%)'
                                            };
                                            const isThreshold = key === 'marginThreshold';
                                            return (
                                                <div key={key} className={`p-6 rounded-xl border shadow-sm ${isThreshold ? 'bg-blue-50/60 border-blue-100' : 'bg-[#f9fafb]'}`}>
                                                    <label className="text-[10px] font-medium text-[#6b7280] uppercase block mb-2">{labels[key] || key}</label>
                                                    <input type="number" step="0.01" className={`w-full p-4 bg-white rounded-lg font-medium text-2xl ${isThreshold ? 'text-blue-600' : 'text-[#111827]'}`} value={val as number} onChange={e => handleUpdateFedTaxes(key as any, Number(e.target.value))} />
                                                    {isThreshold && <p className="text-[9px] font-medium text-blue-400 mt-2 uppercase tracking-tight">Abaixo disso, fechar/salvar exige confirmação.</p>}
                                                </div>
                                            );
                                        })}</div>
                                    )}
                                    {configTab === 'goals' && (
                                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                                            {Array.from({ length: 12 }, (_, i) => {
                                                const date = new Date(new Date().getFullYear(), i, 1);
                                                const monthKey = `${date.getFullYear()}-${String(i + 1).padStart(2, '0')}`;
                                                const label = date.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
                                                return (
                                                    <div key={monthKey} className="bg-[#f9fafb] p-6 rounded-xl border shadow-sm">
                                                        <label className="text-[10px] font-medium text-[#6b7280] uppercase block mb-2 capitalize">{label}</label>
                                                        <input
                                                            type="number"
                                                            className="w-full p-3 bg-white rounded-xl font-medium text-lg text-[#111827]"
                                                            value={fedTaxes.goals?.[monthKey] || ''}
                                                            onChange={e => handleUpdateGoals(monthKey, Number(e.target.value))}
                                                            placeholder="R$ 0,00"
                                                        />
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                    {configTab === 'fleet' && (
                                        <div className="space-y-6">
                                            <div className="flex items-center justify-between mb-4">
                                                <h3 className="font-medium text-[#111827]">Configuração de Frota e ANTT</h3>
                                                <button onClick={() => {
                                                    const name = prompt("Nome do novo tipo de veículo:");
                                                    if (name) handleUpdateVehicleConfig(name, { capacity: 10000, axles: 2, factor: 0, fixed: 0, variable: 0, calcMode: 'ANTT' });
                                                }} className="px-4 py-2 bg-blue-100 text-blue-600 rounded-xl font-medium text-[10px] uppercase hover:bg-blue-200 transition-colors">
                                                    + Novo Veículo
                                                </button>
                                            </div>
                                            {Object.entries(vehicleConfigs).map(([key, config]) => (
                                                <div key={key} className="bg-[#f9fafb] p-6 rounded-xl border shadow-sm">
                                                    <div className="flex justify-between items-center mb-4">
                                                        <h4 className="font-medium text-[#111827] uppercase flex items-center gap-2"><Truck className="w-4 h-4 text-[#6b7280]" /> {key}</h4>
                                                        {currentUser.role === 'master' && (
                                                            <button onClick={() => handleDeleteVehicleConfig(key)} className="p-2 text-red-300 hover:bg-red-50 rounded-lg">
                                                                <Trash2 className="w-4 h-4" />
                                                            </button>
                                                        )}
                                                    </div>
                                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                                                        <div>
                                                            <label className="text-[9px] font-medium text-[#6b7280] uppercase tracking-tighter">Capacidade (KG)</label>
                                                            <input type="number" className="w-full p-3 bg-white rounded-xl font-medium text-[#111827] border" value={config.capacity} onChange={e => handleUpdateVehicleConfig(key, { ...config, capacity: Number(e.target.value) })} />
                                                        </div>
                                                        <div>
                                                            <label className="text-[9px] font-medium text-[#6b7280] uppercase tracking-tighter">Qtd. Eixos</label>
                                                            <input type="number" className="w-full p-3 bg-white rounded-xl font-medium text-[#111827] border" value={config.axles || 2} onChange={e => handleUpdateVehicleConfig(key, { ...config, axles: Number(e.target.value) })} />
                                                        </div>
                                                        <div>
                                                            <label className="text-[9px] font-medium text-[#6b7280] uppercase tracking-tighter">Modo Cálculo</label>
                                                            <select className="w-full p-3 bg-white rounded-xl font-medium text-[#111827] border" value={config.calcMode} onChange={e => handleUpdateVehicleConfig(key, { ...config, calcMode: e.target.value as 'KM' | 'KM_ROUND_TRIP' | 'ANTT' | 'FREE' })}>
                                                                <option value="KM_ROUND_TRIP">KM ida e volta (Fator)</option>
                                                                <option value="KM">KM só ida (Fator)</option>
                                                                <option value="ANTT">ANTT (Fixo+Var)</option>
                                                                <option value="FREE">Preço livre (sem piso)</option>
                                                            </select>
                                                        </div>
                                                        {(config.calcMode === 'KM' || config.calcMode === 'KM_ROUND_TRIP') ? (
                                                            <div>
                                                                <label className="text-[9px] font-medium text-[#6b7280] uppercase tracking-tighter">Fator por KM (R$)</label>
                                                                <input type="number" step="0.01" className="w-full p-3 bg-white rounded-xl font-medium text-[#111827] border" value={config.factor} onChange={e => handleUpdateVehicleConfig(key, { ...config, factor: Number(e.target.value) })} />
                                                            </div>
                                                        ) : (
                                                            <>
                                                                <div>
                                                                    <label className="text-[9px] font-medium text-[#6b7280] uppercase tracking-tighter">Custo Fixo (R$)</label>
                                                                    <input type="number" step="1" className="w-full p-3 bg-white rounded-xl font-medium text-[#111827] border" value={config.fixed} onChange={e => handleUpdateVehicleConfig(key, { ...config, fixed: Number(e.target.value) })} />
                                                                </div>
                                                                <div className="col-span-1">
                                                                    <label className="text-[9px] font-medium text-[#6b7280] uppercase tracking-tighter">Custo Var / KM (R$)</label>
                                                                    <input type="number" step="0.01" className="w-full p-3 bg-white rounded-xl font-medium text-[#111827] border" value={config.variable} onChange={e => handleUpdateVehicleConfig(key, { ...config, variable: Number(e.target.value) })} />
                                                                </div>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {configTab === 'icms' && (
                                        <div className="space-y-8">
                                            {/* ICMS Controls & Standard Toggle */}
                                            <div className="bg-[#f9fafb] p-8 rounded-xl border border-[#e5e7eb] shadow-sm">
                                                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
                                                    <div className="flex items-center gap-4">
                                                        <div className="p-3 bg-blue-100 rounded-lg text-blue-600 shadow-sm"><Percent className="w-5 h-5" /></div>
                                                        <div>
                                                            <h4 className="text-[13px] font-medium uppercase text-slate-700 tracking-wider">Gestão de Alíquotas ICMS</h4>
                                                            <p className="text-[10px] font-medium text-[#6b7280] uppercase">Matriz Completa TOTVS 2026 + Ajustes Manuais</p>
                                                        </div>
                                                    </div>
                                                    <div className="flex gap-4">
                                                        <button
                                                            onClick={() => {
                                                                if (confirm('Deseja restaurar TODAS as alíquotas para o padrão TOTVS 2026? Isso removerá seus ajustes manuais.')) {
                                                                    const standardRules = getStandardIcmsRules();
                                                                    handleUpdateIcmsRates(standardRules);
                                                                    showFeedback("Tabela TOTVS 2026 restaurada com sucesso!");
                                                                }
                                                            }}
                                                            className="px-6 py-4 bg-white border border-[#e5e7eb] text-[#6b7280] hover:border-blue-100 hover:text-blue-600 rounded-lg font-medium text-[10px] uppercase transition-all flex items-center gap-2 shadow-sm"
                                                        >
                                                            <RotateCcw className="w-4 h-4" /> Restaurar Padrão
                                                        </button>
                                                    </div>
                                                </div>

                                                {/* Matrix Filters */}
                                                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                                    <div className="flex flex-col gap-2">
                                                        <label className="text-[9px] font-medium text-[#6b7280] uppercase ml-2">Busca (Ex: SP-RJ)</label>
                                                        <input
                                                            type="text"
                                                            className="w-full p-4 bg-white rounded-xl font-medium border border-[#e5e7eb] focus:border-[#1d6fb8] outline-none uppercase text-xs"
                                                            placeholder="BUSCAR PAR..."
                                                            value={icmsSearch}
                                                            onChange={e => setIcmsSearch(e.target.value)}
                                                        />
                                                    </div>
                                                    <div className="flex flex-col gap-2">
                                                        <label className="text-[9px] font-medium text-[#6b7280] uppercase ml-2">Origem</label>
                                                        <input
                                                            type="text"
                                                            maxLength={2}
                                                            className="w-full p-4 bg-white rounded-xl font-medium border border-[#e5e7eb] focus:border-[#1d6fb8] outline-none uppercase text-xs"
                                                            placeholder="UF"
                                                            value={icmsOriginFilter}
                                                            onChange={e => setIcmsOriginFilter(e.target.value.toUpperCase())}
                                                        />
                                                    </div>
                                                    <div className="flex flex-col gap-2">
                                                        <label className="text-[9px] font-medium text-[#6b7280] uppercase ml-2">Destino</label>
                                                        <input
                                                            type="text"
                                                            maxLength={2}
                                                            className="w-full p-4 bg-white rounded-xl font-medium border border-[#e5e7eb] focus:border-[#1d6fb8] outline-none uppercase text-xs"
                                                            placeholder="UF"
                                                            value={icmsDestFilter}
                                                            onChange={e => setIcmsDestFilter(e.target.value.toUpperCase())}
                                                        />
                                                    </div>
                                                    <div className="flex items-end">
                                                        <button
                                                            onClick={() => { setIcmsSearch(''); setIcmsOriginFilter(''); setIcmsDestFilter(''); }}
                                                            className="w-full p-4 bg-[#f9fafb] text-[#6b7280] hover:text-[#111827] rounded-xl font-medium uppercase text-[10px] transition-all"
                                                        >
                                                            Limpar Filtros
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Matrix Listing */}
                                            <div className="space-y-4">
                                                <div className="flex items-center justify-between px-4">
                                                    <h4 className="text-[10px] font-medium text-[#6b7280] uppercase tracking-widest">Alíquotas e Ajustes Manuais</h4>
                                                    <span className="text-[10px] font-medium text-slate-300 uppercase">Mostrando pares filtrados</span>
                                                </div>

                                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 max-h-[500px] overflow-y-auto p-2 scrollbar-hide">
                                                    {Object.entries(fedTaxes.icmsRates || {})
                                                        .filter(([pair]) => {
                                                            const [o, d] = pair.split('-');
                                                            const matchesSearch = pair.includes(icmsSearch.toUpperCase());
                                                            const matchesOrigin = icmsOriginFilter ? o === icmsOriginFilter : true;
                                                            const matchesDest = icmsDestFilter ? d === icmsDestFilter : true;
                                                            return matchesSearch && matchesOrigin && matchesDest;
                                                        })
                                                        .sort(([a], [b]) => a.localeCompare(b))
                                                        .slice(0, 100) // Performance optimization for UI
                                                        .map(([pair, rate]) => {
                                                            const [org, dst] = pair.split('-');
                                                            return (
                                                                <div key={pair} className="bg-white p-4 rounded-lg border border-[#e5e7eb] flex items-center justify-between hover:border-blue-200 transition-all shadow-sm group">
                                                                    <div className="flex flex-col">
                                                                        <div className="flex items-center gap-1.5 mb-1">
                                                                            <span className="font-medium text-[10px] text-[#6b7280]">{org}</span>
                                                                            <ArrowRight className="w-2.5 h-2.5 text-slate-300" />
                                                                            <span className="font-medium text-[10px] text-blue-500">{dst}</span>
                                                                        </div>
                                                                        <div className="flex items-center gap-2">
                                                                            <input
                                                                                type="number"
                                                                                className="w-16 bg-[#f9fafb] border-none p-1 rounded font-medium text-sm text-[#111827] focus:bg-white focus:ring-1 focus:ring-blue-400 outline-none"
                                                                                value={rate}
                                                                                onChange={(e) => {
                                                                                    const val = Number(e.target.value);
                                                                                    const updated = { ...(fedTaxes.icmsRates || {}), [pair]: val };
                                                                                    handleUpdateIcmsRates(updated);
                                                                                }}
                                                                            />
                                                                            <span className="text-[10px] font-medium text-slate-300">%</span>
                                                                        </div>
                                                                    </div>
                                                                    <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                                                                        <div className="p-1.5 bg-blue-50 text-blue-400 rounded-lg"><Edit3 className="w-3.5 h-3.5" /></div>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                </div>
                                                {Object.keys(fedTaxes.icmsRates || {}).length === 0 && (
                                                    <div className="p-10 border-2 border-dashed border-slate-100 rounded-xl text-center">
                                                        <button
                                                            onClick={() => {
                                                                const standardRules = getStandardIcmsRules();
                                                                handleUpdateIcmsRates(standardRules);
                                                            }}
                                                            className="text-blue-500 font-medium uppercase text-xs hover:underline"
                                                        >
                                                            Clique para inicializar a tabela TOTVS 2026
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {configTab === 'identity' && (
                                        <div className="bg-[#f9fafb] p-12 rounded-[3.5rem] flex flex-col items-center gap-8 border">
                                            <div className="w-48 h-48 bg-white p-6 rounded-xl shadow-sm flex items-center justify-center overflow-hidden border-4 border-white">{appLogo ? <img src={appLogo} className="w-full h-full object-contain" /> : <DefaultLogo className="w-full h-full text-[#111827]" />}</div>
                                            <label className="bg-blue-600 px-10 py-5 rounded-lg text-white font-medium uppercase text-xs cursor-pointer"><ImageIcon className="w-5 h-5 inline mr-2" /> Alterar Logo<input type="file" className="hidden" onChange={handleLogoUpload} accept="image/*" /></label>
                                            <button onClick={() => setAppLogo(null)} className="text-red-400 font-medium text-[10px] uppercase underline underline-offset-4">Resetar Padrão</button>
                                        </div>
                                    )}
                                    {configTab === 'users' && (
                                        <div className="space-y-8">
                                            {/* Criar usuário: o sistema gera a senha temporária forte; nada de e-mail. */}
                                            <div className="bg-[#f9fafb] p-8 rounded-xl border border-[#e5e7eb] shadow-sm">
                                                <div className="flex items-center gap-3 mb-6">
                                                    <Users className="w-5 h-5 text-blue-600" />
                                                    <h3 className="font-medium text-[#111827] uppercase text-xs">Criar Novo Usuário</h3>
                                                </div>
                                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                                                    <div>
                                                        <label className="text-[9px] font-medium text-[#6b7280] uppercase block mb-2">Nome Completo</label>
                                                        <input type="text" value={newUser.name} onChange={e => setNewUser({ ...newUser, name: e.target.value })} className="w-full p-4 bg-white rounded-lg font-medium text-[#111827] border border-[#e5e7eb] outline-none focus:border-[#1d6fb8] transition-all" placeholder="Ex: João Silva" />
                                                    </div>
                                                    <div>
                                                        <label className="text-[9px] font-medium text-[#6b7280] uppercase block mb-2">E-mail (login)</label>
                                                        <input type="email" value={newUser.email} onChange={e => setNewUser({ ...newUser, email: e.target.value })} className="w-full p-4 bg-white rounded-lg font-medium text-[#111827] border border-[#e5e7eb] outline-none focus:border-[#1d6fb8] transition-all" placeholder="ex: joao@empresa.com" />
                                                    </div>
                                                    <div>
                                                        <label className="text-[9px] font-medium text-[#6b7280] uppercase block mb-2">Perfil</label>
                                                        <select value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value })} className="w-full p-4 bg-white rounded-lg font-medium text-[#111827] border border-[#e5e7eb] outline-none focus:border-[#1d6fb8] transition-all">
                                                            <option value="operador">Operador</option>
                                                            <option value="master">Master</option>
                                                        </select>
                                                    </div>
                                                </div>
                                                <p className="text-[10px] font-normal text-[#6b7280] mb-3">O sistema gera uma senha temporária forte e mostra a mensagem pronta pra você repassar ao usuário. No 1º acesso ele é obrigado a trocar a senha. Nenhum e-mail é enviado.</p>
                                                <button
                                                    onClick={async () => {
                                                        const name = newUser.name.trim(), email = newUser.email.trim();
                                                        if (!name || !email) { showFeedback('Preencha nome e e-mail.', 'error'); return; }
                                                        showFeedback('Criando usuário...', 'info');
                                                        const res = await createUserAccount({ email, name, role: newUser.role });
                                                        if (res?.error) { showFeedback(`Erro ao criar: ${res.error}`, 'error'); return; }
                                                        setNewUser({ name: '', email: '', role: 'operador' });
                                                        getProfiles().then(setUsers);
                                                        setCredMsg({ title: 'Usuário criado', email, password: res.tempPassword });
                                                    }}
                                                    className="w-full py-5 bg-blue-600 text-white rounded-lg font-medium uppercase text-xs shadow-sm shadow-blue-200 hover:bg-blue-700 transition-all flex items-center justify-center gap-2"
                                                >
                                                    <Save className="w-4 h-4" /> Criar Usuário
                                                </button>
                                            </div>

                                            {/* Lista de usuários: nome, e-mail, papel, status; ações de senha e ativar/desativar */}
                                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                                {users.map(u => (
                                                    <div key={u.id} className={`p-5 bg-white rounded-xl border flex items-center justify-between group transition-all shadow-sm ${u.active === false ? 'border-red-100 opacity-70' : 'border-[#e5e7eb] hover:border-blue-100'}`}>
                                                        <div className="flex items-center gap-4 min-w-0">
                                                            <div className={`w-12 h-12 rounded-lg flex items-center justify-center shrink-0 ${u.active === false ? 'bg-red-50' : 'bg-blue-50'}`}>
                                                                <span className={`font-medium text-sm ${u.active === false ? 'text-red-300' : 'text-blue-400'}`}>{u.name.charAt(0)}</span>
                                                            </div>
                                                            <div className="min-w-0">
                                                                <p className="font-medium text-[#111827] text-xs uppercase tracking-tight truncate">{u.name}</p>
                                                                <p className="text-[9px] font-medium text-slate-400 truncate">{u.username}</p>
                                                                <p className="text-[9px] font-medium uppercase mt-0.5">
                                                                    <span className="text-slate-400">{u.role === 'master' ? 'Master' : 'Operador'}</span>
                                                                    <span className={`ml-1.5 ${u.active === false ? 'text-red-500' : 'text-emerald-500'}`}>• {u.active === false ? 'Inativo' : 'Ativo'}</span>
                                                                </p>
                                                            </div>
                                                        </div>
                                                        {currentUser.role === 'master' && (
                                                            <div className="flex items-center gap-1 shrink-0">
                                                                <button title="Redefinir senha (gera nova temporária)" onClick={async () => {
                                                                    if (!confirm(`Gerar nova senha temporária para ${u.name}?`)) return;
                                                                    showFeedback('Redefinindo...', 'info');
                                                                    const res = await resetUserPassword(u.id);
                                                                    if (res?.error) { showFeedback(`Erro ao redefinir: ${res.error}`, 'error'); }
                                                                    else { getProfiles().then(setUsers); setCredMsg({ title: 'Senha redefinida', email: u.username, password: res.tempPassword }); }
                                                                }} className="p-2 text-[#6b7280] hover:bg-[#f9fafb] hover:text-[#1d6fb8] rounded-lg">
                                                                    <Key className="w-4 h-4" />
                                                                </button>
                                                                {u.id !== currentUser.id && (
                                                                    <button title={u.active === false ? 'Reativar usuário' : 'Desativar usuário'} onClick={async () => {
                                                                        const novo = u.active === false;
                                                                        if (!confirm(`${novo ? 'Reativar' : 'Desativar'} o usuário ${u.name}?`)) return;
                                                                        const res = await setUserActive(u.id, novo);
                                                                        if (res?.error) { showFeedback(`Erro: ${res.error}`, 'error'); }
                                                                        else { setUsers(users.map(i => i.id === u.id ? { ...i, active: novo } : i)); showFeedback(novo ? 'Usuário reativado.' : 'Usuário desativado.'); }
                                                                    }} className={`p-2 rounded-lg ${u.active === false ? 'text-emerald-500 hover:bg-emerald-50' : 'text-amber-500 hover:bg-amber-50'}`}>
                                                                        {u.active === false ? <UserCheck className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                                                                    </button>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    {configTab === 'goals' && (
                                        <div className="bg-[#f9fafb] p-6 rounded-xl border shadow-sm space-y-4">
                                            <h3 className="font-medium text-[#111827] mb-4">Metas Mensais (R$)</h3>
                                            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                                {Array.from({ length: 12 }).map((_, i) => {
                                                    const year = new Date().getFullYear();
                                                    const monthStr = (i + 1).toString().padStart(2, '0');
                                                    const key = `${year}-${monthStr}`;
                                                    const monthName = new Date(year, i).toLocaleString('pt-BR', { month: 'long' });

                                                    return (
                                                        <div key={key}>
                                                            <label className="text-[10px] font-medium text-[#6b7280] uppercase block mb-1 capitalize">{monthName}</label>
                                                            <input
                                                                type="number"
                                                                className="w-full p-3 bg-white rounded-xl font-medium text-[#111827] border"
                                                                value={fedTaxes.goals?.[key] || ''}
                                                                placeholder="0,00"
                                                                onChange={e => {
                                                                    const val = Number(e.target.value);
                                                                    const newGoals = { ...fedTaxes.goals, [key]: val };
                                                                    setFedTaxes({ ...fedTaxes, goals: newGoals });
                                                                    updateSystemConfig({ ...fedTaxes, goals: newGoals });
                                                                }}
                                                            />
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }

            {
                toast && (
                    <div className="fixed bottom-6 right-6 z-[1000] max-w-xs animate-fade-in-up pointer-events-none">
                        <div className={`px-4 py-3 rounded-xl shadow-sm flex items-center gap-2 text-[11px] font-medium leading-snug ${toast.type === 'error' ? 'bg-red-600/95 text-white' :
                            toast.type === 'info' ? 'bg-slate-700/95 text-white' :
                                'bg-emerald-600/95 text-white'
                            }`}>{toast.message}</div>
                    </div>
                )
            }

            {
                showCelebration && (
                    <div className="fixed inset-0 z-[2000] flex items-center justify-center overflow-hidden p-4">
                        {/* Fundo sóbrio: escurece e desfoca o app, entrada suave */}
                        <style>{`
                            @keyframes vf-backdrop { from { opacity: 0 } to { opacity: 1 } }
                            @keyframes vf-card { 0% { opacity: 0; transform: translateY(14px) scale(.985) } 100% { opacity: 1; transform: translateY(0) scale(1) } }
                            @keyframes vf-line { from { transform: scaleX(0) } to { transform: scaleX(1) } }
                        `}</style>
                        <div className="absolute inset-0 bg-[#0b1a2b]/55 backdrop-blur-md" style={{ animation: 'vf-backdrop .4s ease-out both' }} onClick={() => setShowCelebration(false)} />
                        <div className="relative z-10 w-full max-w-md bg-white rounded-2xl border border-[#e5e7eb] shadow-[0_20px_60px_-15px_rgba(11,26,43,0.35)] px-10 py-12 text-center pointer-events-auto"
                            style={{ animation: 'vf-card .55s cubic-bezier(0.22,1,0.36,1) both' }} onClick={e => e.stopPropagation()}>
                            {/* Fechar: sempre disponível, volta pra calculadora (independe de ter card no Pipefy). */}
                            <button
                                onClick={() => setShowCelebration(false)}
                                title="Fechar e voltar pra calculadora"
                                className="absolute top-3.5 right-3.5 p-1.5 text-[#9ca3af] hover:text-[#111827] hover:bg-[#f3f4f6] rounded-lg transition-colors">
                                <X className="w-4 h-4" strokeWidth={2} />
                            </button>
                            {/* Selo discreto de conclusão */}
                            <div className="w-12 h-12 mx-auto rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center mb-6">
                                <Check className="w-6 h-6 text-emerald-600" strokeWidth={2.25} />
                            </div>
                            <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-[#9ca3af] mb-2">Negócio fechado</p>
                            <h1 className="text-2xl md:text-[1.75rem] font-medium text-[#111827] tracking-tight">Mais um frete fechado!</h1>

                            {/* Divisor fino que "cresce" na entrada */}
                            <div className="mx-auto mt-6 mb-7 h-px w-16 bg-[#e5e7eb] origin-center" style={{ animation: 'vf-line .6s .25s cubic-bezier(0.22,1,0.36,1) both' }} />

                            {/* Herói: o valor do frete, com a contagem elegante */}
                            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-[#9ca3af] mb-1.5">Valor do frete</p>
                            <p className="font-semibold text-[#1d6fb8] leading-none tracking-tight tabular-nums" style={{ fontSize: 'clamp(2.75rem, 8vw, 4.5rem)' }}>
                                <span className="text-[#9ca3af] align-top font-medium" style={{ fontSize: '0.36em' }}>R$ </span>{formatCur(celebCount)}
                            </p>

                            {lastPipefyUrl && (
                                <div className="mt-9 flex flex-col items-center gap-3">
                                    <a href={lastPipefyUrl} target="_blank" rel="noopener noreferrer"
                                        onClick={() => { setShowCelebration(false); }}
                                        className="inline-flex items-center gap-2 bg-[#1d6fb8] text-white px-6 py-3 rounded-lg font-medium text-sm hover:bg-[#1a5f9e] transition-colors">
                                        <Send className="w-4 h-4" strokeWidth={1.75} /> Abrir card no Pipefy
                                    </a>
                                    <button onClick={() => setShowCelebration(false)} className="text-xs font-medium text-[#6b7280] hover:text-[#111827] transition-colors">Fechar</button>
                                </div>
                            )}
                        </div>
                    </div>
                )
            }
            {isWonModalOpen && selectedWonQuote && (
                <WonInfoModal
                    isOpen={isWonModalOpen}
                    onClose={() => {
                        setIsWonModalOpen(false);
                        setSelectedWonQuote(null);
                    }}
                    onSubmit={handleWonInfoSubmit}
                    quote={selectedWonQuote}
                    customers={customers}
                />
            )}
        </div >
    );
};

export default App;
