// Redeploy trigger: 2026-02-18 v2

import React, { useState, useEffect, useMemo, useRef } from 'react';
import jsPDF from 'jspdf';
import {
    LayoutDashboard, Calculator, History, Settings, LogOut, Truck, Map as MapIcon, DollarSign, Package, Scale, FileText, TrendingUp, AlertCircle, CheckCircle2, XCircle, ChevronRight, Search, Filter, ArrowUpDown, Save, Trash2, Edit3, Copy as ClipboardCopy, ThumbsUp, ThumbsDown, Plus, Upload, Users, Percent, Key, UserCircle, X, RotateCcw, FileDown, PlusCircle, Target, Info, Activity, Layers, ShieldCheck, ArrowRightLeft, CreditCard, Wrench, Lock, User as UserIcon, UserCheck, ImageIcon, Download, AlertTriangle, Clock, Hash, PieChart, Calendar, ChevronDown, Check, Zap, Award, ArrowDown, BarChart3, CheckCircle, List, ArrowRight, Sparkles, Send
} from 'lucide-react';
import { CRMBoard } from './components/CRMBoard';
import { WonInfoModal } from './components/WonInfoModal';
import { VehicleType, FreightCalculation, Customer, FederalTaxes, QuoteStatus, ANTTCoefficients, User, UserRole, Disponibilidade, ExtraCostItem } from './types';
import { VEHICLE_CONFIGS, INITIAL_CUSTOMERS } from './constants';
import { ANTT_CARGO_TYPES, computeANTTFloor, vehicleHasANTT } from './utils/antt';
import { estimateDistance, estimateMultiRoute, parseRequest, compileReportText } from './services/geminiService';
import { createRamperCard } from './services/ramper';
import { RouteMap, MapErrorBoundary } from './components/RouteMap';
import { getIcmsRate, getUF, getStandardIcmsRules } from './utils/icms';
import {
    getProfile,
    getProfiles,
    createUserAccount,
    deleteUserAccount,
    resetUserPassword,
    getCustomers,
    createCustomer,
    deleteCustomer,
    updateCustomer,
    getFreightCalculations,
    createFreightCalculation,
    updateFreightCalculation,
    deleteFreightCalculation,
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

// Veículos utilitários: frete base = KM × tarifa fixa (ignoram a tabela ANTT).
const UTILITARIO_KM_RATES: Record<string, number> = {
    [VehicleType.Fiorino]: 2.40,
    [VehicleType.Van]: 3.20,
    [VehicleType.HR_VUC]: 4.00,
};

const App: React.FC = () => {
    // Estados de Autenticação (sessão nativa do Supabase Auth)
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true); // enquanto restaura a sessão
    // Definição de senha (convite/recuperação): usuário chega pelo link do e-mail e cria a senha.
    const [recoveryMode, setRecoveryMode] = useState(false);
    const [newPassword, setNewPassword] = useState('');
    const [savingPassword, setSavingPassword] = useState(false);
    const [showChangePassword, setShowChangePassword] = useState(false);
    const [loginSubmitting, setLoginSubmitting] = useState(false);
    const [users, setUsers] = useState<User[]>([]); // perfis (tela de gestão do master)
    const [loginForm, setLoginForm] = useState({ username: '', password: '' }); // username = e-mail

    // Estados Globais
    const [appLogo, setAppLogo] = useState<string | null>(() => localStorage.getItem('flow_app_logo'));
    const [history, setHistory] = useState<FreightCalculation[]>([]);
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [fedTaxes, setFedTaxes] = useState<FederalTaxes>({ pis: 0.65, cofins: 3.0, csll: 1.08, irpj: 1.2, insurancePolicyRate: 0.035 });
    const [vehicleConfigs, setVehicleConfigs] = useState<Record<string, ANTTCoefficients & { factor?: number; axles?: number; capacity?: number; consumption?: number }>>(VEHICLE_CONFIGS);
    const [spotStats, setSpotStats] = useState({ simulated: 0, converted: 0 });

    const [activeTab, setActiveTab] = useState<'new' | 'history' | 'dashboard' | 'crm'>('dashboard');
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
    const [selectedMonth, setSelectedMonth] = useState<string>(new Date().toISOString().slice(0, 7));
    // Relatório diário (só master): período + resultado calculado do banco (determinístico).
    const [reportPreset, setReportPreset] = useState<'hoje' | 'ontem' | '7d' | '30d' | 'mes'>('hoje');
    const [dailyReport, setDailyReport] = useState<any>(null);
    const [reportText, setReportText] = useState('');
    const [reportTextLoading, setReportTextLoading] = useState(false);

    // Estados de Edição de Clientes
    const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
    const [customerFilePreview, setCustomerFilePreview] = useState<string | null>(null);

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
    const [extraCosts, setExtraCosts] = useState<string>('0');
    const [extraCostsDescription, setExtraCostsDescription] = useState('');
    const [otherCosts, setOtherCosts] = useState<ExtraCostItem[]>([]);
    const [goodsValue, setGoodsValue] = useState<string>('0');
    const [insurancePercent, setInsurancePercent] = useState<string>('0.2');
    const [profitMargin, setProfitMargin] = useState<string>('15');
    const [icmsPercent, setIcmsPercent] = useState<string>('12');
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

    // Solicitante (lista editável, persistida em localStorage por enquanto)
    const [solicitante, setSolicitante] = useState('');
    const [solicitantes, setSolicitantes] = useState<string[]>(() => {
        try { return JSON.parse(localStorage.getItem('flow_solicitantes') || '[]'); } catch { return []; }
    });
    const [showSolicitanteManager, setShowSolicitanteManager] = useState(false);
    const [newSolicitanteName, setNewSolicitanteName] = useState('');

    // Modal pós-salvar (Mandar pro Ramper / Nova Cotação / Ver Histórico)
    const [showPostSaveModal, setShowPostSaveModal] = useState(false);
    const [ramperSending, setRamperSending] = useState(false);

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
            const historyData = await getFreightCalculations();
            setHistory(historyData);
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
        localStorage.setItem('flow_solicitantes', JSON.stringify(solicitantes));
    }, [solicitantes]);

    useEffect(() => {
        if (toast) {
            const timer = setTimeout(() => setToast(null), 4000);
            return () => clearTimeout(timer);
        }
    }, [toast]);

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



    useEffect(() => {
        const orgUF = getUF(origin);
        const dstUF = getUF(destination);
        if (orgUF && dstUF) {
            const rate = getIcmsRate(orgUF, dstUF, fedTaxes.icmsRates);
            setIcmsPercent(rate.toString());
        }
    }, [origin, destination, fedTaxes.icmsRates]);

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

        setReportText('');
        setDailyReport({ label, total, prevTotal, variation, totalValue, prevValue, avgSec, topClients, topVehicles, topRoutes, operators, insights, generatedAt: now });
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
    });

    // Fallback de última instância (se a própria chamada à função falhar) — texto-modelo no cliente.
    const buildReportTemplateClient = (s: any): string => {
        const lines: string[] = [];
        lines.push(`📊 Relatório de cotações — ${s.label || 'período'}`);
        lines.push(`• Cotações: ${s.total ?? 0}${typeof s.variation === 'number' ? ` (${s.variation > 0 ? '+' : ''}${s.variation}% vs período anterior)` : ''}`);
        if (s.totalValue) lines.push(`• Valor cotado: ${s.totalValue}`);
        if (s.avgTime && s.avgTime !== '—') lines.push(`• Tempo médio de montagem: ${s.avgTime}`);
        if (s.topClients?.length) lines.push(`• Clientes que mais cotaram: ${s.topClients.slice(0, 3).map((c: any) => `${c.name} (${c.count}${c.value ? ` · ${c.value}` : ''})`).join(', ')}`);
        if (s.topVehicles?.length) lines.push(`• Veículos cotados: ${s.topVehicles.slice(0, 4).map((v: any) => `${v.name} (${v.count})`).join(', ')}`);
        if (s.topRoutes?.length) lines.push(`• Rotas mais quentes: ${s.topRoutes.slice(0, 3).map((rt: any) => `${rt.name} (${rt.count})`).join('; ')}`);
        if (s.topOperators?.length) lines.push(`• Destaque do time: ${s.topOperators[0].name} (${s.topOperators[0].count} cotações)`);
        if (s.insights?.length) { lines.push(''); lines.push('⚠️ Atenção:'); s.insights.slice(0, 4).forEach((i: string) => lines.push(`• ${i}`)); }
        return lines.join('\n');
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
            setSelectedWonQuote(quote);
            setIsWonModalOpen(true);
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
        if (result.success) {
            setHistory(prev => prev.map(h => h.id === selectedWonQuote.id ? updatedQuote : h));
            setIsWonModalOpen(false);
            setSelectedWonQuote(null);
            setShowCelebration(true);
            setTimeout(() => setShowCelebration(false), 4000);
            showFeedback('Carga confirmada e enviada para operação!');

            // If we were on 'new' or 'crm', maybe move to history or operations?
            // The prompt doesn't specify, but history seems safe.
            resetForm();
            setActiveTab('history');
        } else {
            console.error('Detailed Save Error:', result.error);
            showFeedback(`Erro ao salvar carga: ${result.error || 'Erro desconhecido'}`, 'error');
        }
    };

    // Indica se o veículo selecionado possui tabela ANTT (piso mínimo aplicável).
    const hasAntt = vehicleHasANTT(vehicleType);

    // Piso mínimo ANTT (Tabela A) = (km × CCD) + CC, conforme tipo de carga e eixos do veículo.
    // Retorna null quando não aplicável (veículo sem ANTT, eixos/carga sem coeficiente).
    const anttFloor = useMemo(() => {
        if (!hasAntt) return null;
        const axles = vehicleConfigs[vehicleType]?.axles;
        const dist = parseFloat(distanceKm.replace(',', '.')) || 0;
        return computeANTTFloor(cargoType, axles, dist);
    }, [hasAntt, vehicleType, cargoType, distanceKm, vehicleConfigs]);

    // Veículos utilitários (Fiorino/Van/HR-VUC): frete base = KM × tarifa fixa, ignorando a tabela ANTT.
    const utilitarioRate = UTILITARIO_KM_RATES[vehicleType];
    const isUtilitario = utilitarioRate !== undefined;
    const utilitarioFreight = useMemo(() => {
        if (!isUtilitario) return null;
        const dist = parseFloat(distanceKm.replace(',', '.')) || 0;
        return dist * utilitarioRate;
    }, [isUtilitario, utilitarioRate, distanceKm]);

    // Valor numérico de referência para persistência e para o botão "Aderir ao Preço Base".
    const suggestedFreightANTT = anttFloor ?? utilitarioFreight ?? 0;

    // Utilitários: o frete base é puramente KM × tarifa — preenche automaticamente o Preço Base.
    useEffect(() => {
        if (isUtilitario && utilitarioFreight !== null) {
            setBaseFreight(maskCurrency(utilitarioFreight));
        }
    }, [isUtilitario, utilitarioFreight]);

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

        const directCostsSelling = bf + t + totalEc + adValoremSelling;
        const priceWithMargin = marginDivisor > 0 ? directCostsSelling / marginDivisor : directCostsSelling;
        const finalFreight = icmsDivisor > 0 ? priceWithMargin / icmsDivisor : priceWithMargin;
        const icmsAmount = finalFreight * (icmsP / 100);
        const fedTaxesAmount = finalFreight * (totalFedTaxPercent / 100);
        const realDirectCosts = bf + t + totalEc + adValoremCost;
        const realProfitAmount = finalFreight - icmsAmount - fedTaxesAmount - realDirectCosts;
        const realMarginPercent = finalFreight > 0 ? (realProfitAmount / finalFreight) * 100 : 0;
        return { directCosts: directCostsSelling, realDirectCosts, priceAfterMargin: priceWithMargin, finalFreight, icmsAmount, fedTaxesAmount, adValoremSelling, adValoremCost, realProfitAmount, realMarginPercent };
    }, [baseFreight, tolls, extraCosts, otherCosts, goodsValue, insurancePercent, profitMargin, icmsPercent, fedTaxes]);

    const handleFetchDistance = async (overrideVehicle?: string) => {
        if (!origin || !destination) return;
        // overrideVehicle só é considerado quando for string (chamadas via onBlur/onClick passam um evento).
        const vt = (typeof overrideVehicle === 'string' && overrideVehicle) ? overrideVehicle : vehicleType;
        setLoadingDistance(true);
        try {
            const config = vehicleConfigs[vt];
            const result = await estimateDistance(origin, destination, vt, config?.axles);
            if (result.error) {
                console.warn('Distance estimation failed:', result.error, result.details);
                const detailStr = result.details?.google ? ` (Google: ${result.details.google})` : '';
                showFeedback(`Erro no KM: ${result.error}${detailStr}`, 'error');
                setDistanceKm('0'); // Reset to 0 on error to avoid confusion
            } else {
                setDistanceKm(result.km.toString());
                setOrigin(result.originNormalized);
                setDestination(result.destinationNormalized);
                setTolls(maskCurrency(result.estimatedTolls));
                showFeedback("Rota sincronizada!");
            }
        } catch (err: any) {
            console.error(err);
            showFeedback(`Falha na conexão: ${err.message}`, 'error');
        } finally { setLoadingDistance(false); }
    };

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

    const saveQuote = async (status: QuoteStatus, bypassMarginCheck = false, stayOnForm = false) => {
        // Gate de margem: ao comprometer a cotação (fechar/salvar em pauta) com margem
        // abaixo do limiar configurado, exige confirmação no modal antes de prosseguir.
        if (!bypassMarginCheck && (status === 'won' || status === 'pending') && calcData.realMarginPercent < marginThreshold) {
            setPendingSaveStatus(status);
            setPendingStayOnForm(stayOnForm);
            setShowMarginModal(true);
            return;
        }

        setIsTimerRunning(false);
        const quoteId = editingId || generateId();
        const existingQuote = history.find(h => h.id === editingId);
        const createdDate = existingQuote?.createdAt ? existingQuote.createdAt : Date.now();

        const data: FreightCalculation = {
            id: quoteId,
            proposalNumber: editingId ? (history.find(h => h.id === editingId)?.proposalNumber || '') : `CT-${new Date().getFullYear()}-${(history.length + 1).toString().padStart(4, '0')}`,
            clientReference, origin, destination, destinations: destinations.map(d => (d || '').trim()).filter(Boolean), distanceKm: parseFloat(distanceKm.replace(',', '.')) || 0, vehicleType: vehicleType as VehicleType, merchandiseType, weight: parseFloat(weight.replace(',', '.')) || 0,
            customerId: selectedCustomerId, suggestedFreight: suggestedFreightANTT, solicitante,
            baseFreight: num(baseFreight),
            tolls: num(tolls), extraCosts: num(extraCosts), extraCostsDescription, goodsValue: num(goodsValue), insurancePercent: parseFloat(insurancePercent.replace(',', '.')) || 0, adValorem: calcData.adValoremSelling, profitMargin: parseFloat(profitMargin.replace(',', '.')) || 0, icmsPercent: parseFloat(icmsPercent.replace(',', '.')) || 0,
            pisPercent: fedTaxes.pis, cofinsPercent: fedTaxes.cofins, csllPercent: fedTaxes.csll, irpjPercent: fedTaxes.irpj,
            totalFreight: calcData.finalFreight, createdAt: createdDate, disponibilidade, status, updatedBy: currentUser?.id, updatedByName: currentUser?.name,
            // Autoria imutável: na criação grava o usuário atual; na edição preserva o autor original.
            createdBy: editingId ? existingQuote?.createdBy : currentUser?.id,
            createdByName: editingId ? existingQuote?.createdByName : currentUser?.name,
            realProfit: calcData.realProfitAmount, realMarginPercent: calcData.realMarginPercent,
            elaborationSeconds: elapsedSeconds,
            otherCosts
        };

        if (status === 'won') {
            setSelectedWonQuote(data);
            setIsWonModalOpen(true);
            return;
        }

        try {
            if (editingId) {
                const result = await updateFreightCalculation(data);
                if (result.success) {
                    setHistory(prev => prev.map(h => h.id === editingId ? data : h));
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
                    setHistory(prev => [data, ...prev]);
                    if (stayOnForm) {
                        // Mantém o formulário na tela e entra em modo edição do registro recém-criado
                        setEditingId(quoteId);
                        showFeedback("Cotação enviada e sinalizada no CRM.");
                    } else {
                        showFeedback("Salvo com sucesso!");
                        setEditingId(null); setShowPostSaveModal(true);
                    }
                } else {
                    showFeedback(`Erro ao salvar no banco: ${result.error}`, "error");
                }
            }
        } catch (error) {
            console.error("Exception in saveQuote:", error);
            showFeedback("Erro inesperado ao salvar.", "error");
        }
    };

    const loadQuote = (quote: FreightCalculation) => {
        setOrigin(quote.origin); setDestination(quote.destination); setDestinations(quote.destinations || []); setShowMap(false); setRouteGeometry(null); setClientReference(quote.clientReference || ''); setDistanceKm(quote.distanceKm.toString());
        setVehicleType(quote.vehicleType); setWeight(quote.weight.toString()); setSelectedCustomerId(quote.customerId); setBaseFreight(maskCurrency(quote.baseFreight));
        setTolls(maskCurrency(quote.tolls)); setExtraCosts(maskCurrency(quote.extraCosts || 0)); setExtraCostsDescription(quote.extraCostsDescription || '');
        setGoodsValue(maskCurrency(quote.goodsValue)); setInsurancePercent(quote.insurancePercent.toString()); setProfitMargin(quote.profitMargin.toString());
        setIcmsPercent(quote.icmsPercent.toString()); setEditingId(quote.id); setDisponibilidade(quote.disponibilidade || "Imediato");
        setMerchandiseType(quote.merchandiseType || '');
        setSolicitante(quote.solicitante || '');
        setOtherCosts(quote.otherCosts || []);
        setElapsedSeconds(quote.elaborationSeconds || 0); setIsTimerRunning(false);
        setActiveTab('new'); showFeedback("Editando...");
    };

    const resetForm = () => {
        setOrigin(''); setDestination(''); setDestinations([]); setShowMap(false); setRouteGeometry(null); setClientReference(''); setDistanceKm('0'); setBaseFreight('0'); setTolls('0'); setExtraCosts('0');
        setExtraCostsDescription(''); setGoodsValue('0'); setWeight('0'); setSelectedCustomerId(''); setEditingId(null);
        setDisponibilidade("Imediato"); setMerchandiseType(''); setCargoType('Carga geral'); setOtherCosts([]);
        setSolicitante('');
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
        saveQuote('pending', false, true);
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
        if (tipoCarga) setMerchandiseType(tipoCarga);

        const pesoNum = parseFloat(pesoRaw.replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.'));
        if (pesoRaw && !isNaN(pesoNum)) setWeight(String(pesoNum));

        const valorNum = parseFloat(valorRaw.replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.'));
        if (valorRaw && !isNaN(valorNum)) setGoodsValue(maskCurrency(valorNum));

        let dispLabel = '';
        if (disp.includes('imediato')) { setDisponibilidade('Imediato'); dispLabel = 'Imediato'; }
        else if (disp.includes('agendad') || disp.includes('program')) { setDisponibilidade('Conforme programação'); dispLabel = 'Conforme programação'; }

        if (sol) {
            setSolicitantes(prev => prev.includes(sol) ? prev : [...prev, sol]);
            setSolicitante(sol);
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
    const handleSendToRamper = async () => {
        const customerName = customers.find(c => c.id === selectedCustomerId)?.name || '';
        // O Ramper exige uma organização (ou pessoa). Sem cliente, o card não pode ser criado.
        if (!customerName && !solicitante) {
            showFeedback('Selecione um cliente (ou solicitante) na cotação antes de mandar pro Ramper.', 'error');
            return;
        }
        setRamperSending(true);
        try {
            // Título: "[REF] - Cotação de Frete SPOT - origem x destino" (omite o prefixo se não houver Ref).
            const refPart = clientReference.trim() ? `${clientReference.trim()} - ` : '';
            const title = `${refPart}Cotação de Frete SPOT - ${origin || '—'} x ${destination || '—'}`;
            const res = await createRamperCard({
                title,
                value: calcData.finalFreight,
                basePrice: num(baseFreight), // vai na nota do card (campo history)
                organizationName: customerName || solicitante, // garante uma organização
                personName: solicitante,
                stageName: 'Cotações',
            });
            if (res?.error) {
                console.error('Ramper error:', res.error);
                showFeedback(`Falha ao criar card no Ramper: ${res.error}`, 'error');
            } else {
                showFeedback('Card criado no Ramper');
                setShowPostSaveModal(false);
                resetForm();
                setActiveTab('history');
            }
        } catch (e: any) {
            console.error('Ramper exception:', e);
            showFeedback('Falha ao criar card no Ramper, verifique a conexão', 'error');
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
                        { id: 'crm', icon: List, label: 'CRM' }
                    ].filter(item => !item.adminOnly || currentUser.role === 'master').map(item => (
                        <button key={item.id} onClick={() => { setActiveTab(item.id as any); if (item.id !== 'history' && item.id !== 'dashboard') resetForm(); }} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${activeTab === item.id ? 'bg-[#eff6ff] text-[#1d6fb8]' : 'text-[#6b7280] hover:bg-[#f9fafb] hover:text-[#111827]'}`}>
                            <item.icon className="w-[18px] h-[18px]" strokeWidth={1.75} />
                            <span className="font-medium text-sm">{item.label}</span>
                        </button>
                    ))}
                </nav>
                <div className="p-3 mt-auto space-y-1 border-t border-[#e5e7eb]">
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
                    {activeTab === 'crm' && (
                        <div className="h-full animate-fade-in">
                            <CRMBoard
                                quotes={history}
                                onUpdateStatus={handleCRMStatusUpdate}
                                customers={customers}
                                systemConfig={fedTaxes}
                            />
                        </div>
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
                                            <div className="lg:col-span-3">
                                                <input type="text" className="w-full px-6 py-4 bg-[#f9fafb] rounded-lg font-medium border border-[#e5e7eb] focus:border-[#1d6fb8] outline-none" value={origin} onChange={e => { startTimer(); setOrigin(e.target.value); }} onBlur={() => { if (destinations.length === 0) handleFetchDistance(); }} placeholder="Origem / Coleta (Cidade, UF)" />
                                            </div>
                                            <div className="lg:col-span-3">
                                                <input type="text" className="w-full px-6 py-4 bg-[#f9fafb] rounded-lg font-medium border border-[#e5e7eb] focus:border-[#1d6fb8] outline-none" value={destination} onChange={e => { startTimer(); setDestination(e.target.value); }} onBlur={() => { if (destinations.length === 0) handleFetchDistance(); }} placeholder={destinations.length ? 'Destino 1 (Cidade, UF)' : 'Destino (Cidade, UF)'} />
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

                                        {/* Alerta de Histórico */}
                                        {historicalAlert}
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7 gap-4">
                                            <div className="relative"><Hash className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" /><input type="text" className="w-full pl-10 pr-4 py-4 bg-blue-50/50 rounded-lg font-medium border-2 border-blue-100 focus:border-blue-300 outline-none" value={clientReference} onChange={e => setClientReference(e.target.value)} placeholder="Ref Cliente" /></div>
                                            <div className="relative md:col-span-2">
                                                <Truck className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
                                                <select className="w-full pl-10 pr-4 py-4 bg-[#f9fafb] rounded-lg font-medium outline-none border border-[#e5e7eb] focus:border-[#1d6fb8] transition-all appearance-none" value={vehicleType} onChange={e => {
                                                    const v = e.target.value;
                                                    setVehicleType(v);
                                                    // O pedágio depende dos eixos: se já há rota definida, recalcula com o novo veículo.
                                                    if (origin && destination && (parseFloat(distanceKm.replace(',', '.')) || 0) > 0 && !loadingDistance) {
                                                        handleFetchDistance(v);
                                                    }
                                                }}>
                                                    {Object.keys(vehicleConfigs).map(v => <option key={v} value={v}>{v}</option>)}
                                                </select>
                                                <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300 pointer-events-none" />
                                            </div>
                                            <div className="relative col-span-1 md:col-span-2"><Package className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" /><input type="text" className="w-full pl-10 pr-4 py-4 bg-[#f9fafb] rounded-lg font-medium border border-[#e5e7eb] focus:border-[#1d6fb8] outline-none" value={merchandiseType} onChange={e => setMerchandiseType(e.target.value)} placeholder="Tipo da Mercadoria" /></div>
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
                                                <button
                                                    onClick={handleFetchDistance}
                                                    disabled={loadingDistance}
                                                    className={`absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-white rounded-xl shadow-sm transition-all border border-[#e5e7eb] ${loadingDistance ? 'opacity-50 cursor-not-allowed' : 'text-blue-500 hover:bg-blue-50'}`}
                                                    title="Recalcular Distância"
                                                >
                                                    <RotateCcw className={`w-3 h-3 ${loadingDistance ? 'animate-spin' : ''}`} />
                                                </button>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
                                            <div className="lg:col-span-2">
                                                <select className="w-full p-4 bg-[#f9fafb] rounded-lg font-medium outline-none border border-[#e5e7eb] focus:border-[#1d6fb8] transition-all" value={selectedCustomerId} onChange={e => setSelectedCustomerId(e.target.value)}><option value="">Selecione Cliente...</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                                            </div>
                                            <div className="lg:col-span-2 flex items-center gap-2">
                                                <select className="flex-1 min-w-0 p-4 bg-[#f9fafb] rounded-lg font-medium outline-none border border-[#e5e7eb] focus:border-[#1d6fb8] transition-all" value={solicitante} onChange={e => setSolicitante(e.target.value)}>
                                                    <option value="">Solicitante...</option>
                                                    {solicitantes.map(s => <option key={s} value={s}>{s}</option>)}
                                                </select>
                                                <button type="button" onClick={() => setShowSolicitanteManager(true)} title="Gerenciar solicitantes" className="shrink-0 p-3 bg-white border border-[#e5e7eb] rounded-lg text-[#6b7280] hover:bg-[#f9fafb] hover:text-[#111827] transition-colors">
                                                    <Users className="w-4 h-4" strokeWidth={1.75} />
                                                </button>
                                            </div>
                                            <div className="lg:col-span-2">
                                                <select className="w-full p-4 bg-[#f9fafb] rounded-lg font-medium outline-none border border-[#e5e7eb] focus:border-[#1d6fb8] transition-all" value={disponibilidade} onChange={e => setDisponibilidade(e.target.value as Disponibilidade)}><option value="Imediato">Imediato</option><option value="Conforme programação">Programado</option></select>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="bg-white p-8 rounded-xl shadow-sm border hover:shadow-sm transition-all relative">
                                        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
                                            <div className="flex flex-col">
                                                <div className="flex justify-between mb-2"><span className="text-[10px] font-medium uppercase text-blue-600">Preço Base</span></div>
                                                <input type="text" className="w-full p-4 rounded-xl font-medium text-[#111827] bg-[#f9fafb] focus:bg-white outline-none border border-[#e5e7eb] focus:border-[#1d6fb8] transition-all" value={maskCurrency(baseFreight)} onChange={e => { startTimer(); setBaseFreight(maskCurrency(e.target.value)); }} />
                                            </div>
                                            <div className="flex flex-col">
                                                <div className="flex justify-between mb-2"><span className="text-[10px] font-medium text-[#6b7280] uppercase">Pedágio</span></div>
                                                <input type="text" className="w-full p-4 bg-[#f9fafb] rounded-xl font-medium border border-[#e5e7eb] focus:border-[#1d6fb8] outline-none transition-all" value={maskCurrency(tolls)} onChange={e => setTolls(maskCurrency(e.target.value))} />
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
                                                <div className="flex justify-between mb-2"><span className="text-[10px] font-medium text-[#6b7280] uppercase">ICMS Destino (%)</span></div>
                                                <input type="text" className="w-full p-4 bg-[#f9fafb] rounded-xl font-medium border border-[#e5e7eb] focus:border-[#1d6fb8] outline-none transition-all" value={icmsPercent} onChange={e => setIcmsPercent(e.target.value)} />
                                            </div>
                                        </div>

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
                                                    {(parseFloat(distanceKm.replace(',', '.')) || 0).toLocaleString('pt-BR')} km × R$ {utilitarioRate.toFixed(2).replace('.', ',')}/km
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

                                            <div className="grid grid-cols-2 gap-2 w-full mt-4">
                                                <button onClick={() => saveQuote('won')} className="bg-emerald-600 text-white py-2.5 rounded-lg font-medium text-xs flex items-center justify-center gap-1.5 hover:bg-emerald-700 transition-colors">
                                                    <ThumbsUp className="w-3.5 h-3.5" strokeWidth={1.75} /> Fechado
                                                </button>
                                                <button onClick={() => saveQuote('lost')} className="bg-white border border-[#e5e7eb] text-red-600 py-2.5 rounded-lg font-medium text-xs flex items-center justify-center gap-1.5 hover:bg-red-50 transition-colors">
                                                    <ThumbsDown className="w-3.5 h-3.5" strokeWidth={1.75} /> Perdido
                                                </button>
                                                <button onClick={() => saveQuote('pending')} className="bg-white border border-[#e5e7eb] text-[#111827] py-2.5 rounded-lg font-medium text-xs hover:bg-[#f9fafb] flex items-center justify-center gap-1.5 transition-colors">
                                                    <Save className="w-3.5 h-3.5" strokeWidth={1.75} /> Salvar
                                                </button>
                                                <button onClick={handleCopyQuoteText} className="bg-white border border-[#e5e7eb] text-[#111827] py-2.5 rounded-lg font-medium text-xs hover:bg-[#f9fafb] flex items-center justify-center gap-1.5 transition-colors">
                                                    <ClipboardCopy className="w-3.5 h-3.5" strokeWidth={1.75} /> Copiar
                                                </button>
                                                <button onClick={handleQuickSend} className="col-span-2 bg-[#1d6fb8] text-white py-2.5 rounded-lg font-medium text-xs hover:bg-[#1a5f9e] flex items-center justify-center gap-1.5 transition-colors">
                                                    <Zap className="w-3.5 h-3.5" strokeWidth={1.75} /> Envio Rápido (Copiar + CRM)
                                                </button>
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
                                                    {h.updatedByName?.charAt(0) || 'A'}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-[9px] font-medium text-[#111827] uppercase truncate">{h.updatedByName || 'Admin'}</p>
                                                    <p className="text-[7px] font-medium text-[#6b7280] uppercase tracking-tighter">Responsável</p>
                                                </div>
                                            </div>
                                            <div className="w-28 text-right">
                                                <p className={`text-xs font-medium ${realMargin < 15 ? 'text-red-500' : 'text-emerald-600'}`}>{realMargin.toFixed(1)}%</p>
                                                <p className="text-[8px] font-medium text-[#6b7280] uppercase">Lucro: R$ {formatCur(profitValue)}</p>
                                            </div>
                                            <div className="w-32 text-right"><p className="text-base font-medium text-[#111827]">R$ {formatCur(h.totalFreight)}</p></div>
                                            <div className="w-20 flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-all">
                                                <button onClick={() => loadQuote(h)} className="p-2 text-blue-500 hover:bg-blue-50 rounded-lg">
                                                    <Edit3 className="w-4 h-4" />
                                                </button>
                                                {currentUser.role === 'master' && (
                                                    <button onClick={async () => { if (await deleteFreightCalculation(h.id)) setHistory(prev => prev.filter(i => i.id !== h.id)); }} className="p-2 text-red-400 hover:bg-red-50 rounded-lg">
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
                </div>
            </main >

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
                    <div className="bg-white w-full max-w-sm rounded-xl border border-[#e5e7eb] shadow-sm p-6 text-center">
                        <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-emerald-50 flex items-center justify-center">
                            <CheckCircle className="w-6 h-6 text-emerald-600" strokeWidth={1.75} />
                        </div>
                        <h3 className="text-base font-medium text-[#111827]">Cotação salva com sucesso</h3>
                        <p className="text-sm font-normal text-[#6b7280] mt-1 mb-6">O que deseja fazer agora?</p>
                        <div className="space-y-3">
                            <button
                                onClick={handleSendToRamper}
                                disabled={ramperSending}
                                className="w-full py-2.5 bg-[#1d6fb8] text-white rounded-lg font-medium text-sm hover:bg-[#1a5f9e] transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                            >
                                <Send className="w-4 h-4" strokeWidth={1.75} /> {ramperSending ? 'Enviando...' : 'Mandar pro Ramper'}
                            </button>
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

            {/* Gerenciador de solicitantes (lista editável em localStorage) */}
            {showSolicitanteManager && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[120] flex items-center justify-center p-6 animate-fade-in">
                    <div className="bg-white w-full max-w-sm rounded-xl border border-[#e5e7eb] shadow-sm overflow-hidden">
                        <div className="p-5 border-b border-[#e5e7eb] flex items-center justify-between">
                            <h3 className="text-base font-medium text-[#111827]">Solicitantes</h3>
                            <button onClick={() => { setShowSolicitanteManager(false); setNewSolicitanteName(''); }} className="p-1.5 text-[#6b7280] hover:bg-[#f9fafb] rounded-md transition-colors">
                                <X className="w-4 h-4" strokeWidth={1.75} />
                            </button>
                        </div>
                        <div className="p-5 space-y-4">
                            <div className="flex items-center gap-2">
                                <input
                                    type="text"
                                    value={newSolicitanteName}
                                    onChange={e => setNewSolicitanteName(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') {
                                            const name = newSolicitanteName.trim();
                                            if (name && !solicitantes.includes(name)) { setSolicitantes(prev => [...prev, name]); setNewSolicitanteName(''); }
                                        }
                                    }}
                                    placeholder="Nome do solicitante"
                                    className="flex-1 px-4 py-2.5 bg-[#f9fafb] border border-[#e5e7eb] rounded-lg text-sm font-normal text-[#111827] outline-none focus:border-[#1d6fb8] transition-colors"
                                />
                                <button
                                    onClick={() => {
                                        const name = newSolicitanteName.trim();
                                        if (name && !solicitantes.includes(name)) { setSolicitantes(prev => [...prev, name]); setNewSolicitanteName(''); }
                                    }}
                                    className="shrink-0 px-4 py-2.5 bg-[#1d6fb8] text-white rounded-lg text-sm font-medium hover:bg-[#1a5f9e] transition-colors flex items-center gap-1"
                                >
                                    <Plus className="w-4 h-4" strokeWidth={1.75} /> Add
                                </button>
                            </div>
                            {solicitantes.length === 0 ? (
                                <p className="text-xs font-normal text-[#6b7280] text-center py-4">Nenhum solicitante cadastrado.</p>
                            ) : (
                                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                                    {solicitantes.map(s => (
                                        <div key={s} className="flex items-center justify-between bg-[#f9fafb] border border-[#e5e7eb] rounded-lg px-3 py-2">
                                            <span className="text-sm font-normal text-[#111827] truncate">{s}</span>
                                            <button
                                                onClick={() => { setSolicitantes(prev => prev.filter(x => x !== s)); if (solicitante === s) setSolicitante(''); }}
                                                className="shrink-0 p-1.5 text-[#6b7280] hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                                            >
                                                <Trash2 className="w-4 h-4" strokeWidth={1.75} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
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
                                                    </div>

                                                    <div className="flex gap-3">
                                                        <button onClick={async () => {
                                                            if (newCustomerName) {
                                                                const logoFinal = customerFilePreview || newCustomerLogo;
                                                                if (editingCustomer) {
                                                                    const updated = await updateCustomer({ ...editingCustomer, name: newCustomerName, logoUrl: logoFinal });
                                                                    if (updated) {
                                                                        setCustomers(customers.map(c => c.id === editingCustomer.id ? { ...c, name: newCustomerName, logoUrl: logoFinal } : c));
                                                                        showFeedback("Cliente atualizado!");
                                                                    }
                                                                } else {
                                                                    const created = await createCustomer({ id: Date.now().toString(), name: newCustomerName, logoUrl: logoFinal });
                                                                    if (created) {
                                                                        setCustomers([created, ...customers]);
                                                                        showFeedback("Cliente cadastrado!");
                                                                    }
                                                                }
                                                                setNewCustomerName('');
                                                                setNewCustomerLogo('');
                                                                setCustomerFilePreview(null);
                                                                setEditingCustomer(null);
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
                                                                <p className="text-[9px] font-medium text-slate-300 uppercase">Cliente Cadastrado</p>
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                                                            <button onClick={() => {
                                                                setEditingCustomer(c);
                                                                setNewCustomerName(c.name);
                                                                setNewCustomerLogo(c.logoUrl || '');
                                                                setCustomerFilePreview(null);
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
                                                            <select className="w-full p-3 bg-white rounded-xl font-medium text-[#111827] border" value={config.calcMode} onChange={e => handleUpdateVehicleConfig(key, { ...config, calcMode: e.target.value as 'KM' | 'ANTT' })}>
                                                                <option value="KM">KM (Fator)</option>
                                                                <option value="ANTT">ANTT (Fixo+Var)</option>
                                                            </select>
                                                        </div>
                                                        {config.calcMode === 'KM' ? (
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
                                            {/* User Creation Form */}
                                            <div className="bg-[#f9fafb] p-8 rounded-xl border border-[#e5e7eb] shadow-sm">
                                                <div className="flex items-center gap-3 mb-6">
                                                    <Users className="w-5 h-5 text-blue-600" />
                                                    <h3 className="font-medium text-[#111827] uppercase text-xs">Cadastrar Novo Usuário</h3>
                                                </div>
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                                                    <div>
                                                        <label className="text-[9px] font-medium text-[#6b7280] uppercase block mb-2">Nome Completo</label>
                                                        <input type="text" id="new-user-name" className="w-full p-4 bg-white rounded-lg font-medium text-[#111827] border border-[#e5e7eb] outline-none focus:border-[#1d6fb8] transition-all" placeholder="Ex: João Silva" />
                                                    </div>
                                                    <div>
                                                        <label className="text-[9px] font-medium text-[#6b7280] uppercase block mb-2">E-mail (login)</label>
                                                        <input type="email" id="new-user-email" className="w-full p-4 bg-white rounded-lg font-medium text-[#111827] border border-[#e5e7eb] outline-none focus:border-[#1d6fb8] transition-all" placeholder="ex: joao@empresa.com" />
                                                    </div>
                                                    <div>
                                                        <label className="text-[9px] font-medium text-[#6b7280] uppercase block mb-2">Senha inicial</label>
                                                        <input type="text" id="new-user-password" className="w-full p-4 bg-white rounded-lg font-medium text-[#111827] border border-[#e5e7eb] outline-none focus:border-[#1d6fb8] transition-all" placeholder="mín. 6 caracteres" />
                                                    </div>
                                                    <div>
                                                        <label className="text-[9px] font-medium text-[#6b7280] uppercase block mb-2">Perfil</label>
                                                        <select id="new-user-role" className="w-full p-4 bg-white rounded-lg font-medium text-[#111827] border border-[#e5e7eb] outline-none focus:border-[#1d6fb8] transition-all">
                                                            <option value="operador">Operador</option>
                                                            <option value="master">Master</option>
                                                        </select>
                                                    </div>
                                                </div>
                                                <p className="text-[10px] font-normal text-[#6b7280] mb-3">Você define a senha inicial e repassa ao usuário. Ele entra com o e-mail + essa senha e troca depois em "Trocar senha".</p>
                                                <button
                                                    onClick={async () => {
                                                        const nameEl = document.getElementById('new-user-name') as HTMLInputElement;
                                                        const emailEl = document.getElementById('new-user-email') as HTMLInputElement;
                                                        const passwordEl = document.getElementById('new-user-password') as HTMLInputElement;
                                                        const roleEl = document.getElementById('new-user-role') as HTMLSelectElement;
                                                        if (!nameEl.value.trim() || !emailEl.value.trim() || !passwordEl.value.trim()) {
                                                            showFeedback('Preencha nome, e-mail e senha inicial.', 'error');
                                                            return;
                                                        }
                                                        if (passwordEl.value.trim().length < 6) {
                                                            showFeedback('A senha inicial deve ter ao menos 6 caracteres.', 'error');
                                                            return;
                                                        }
                                                        showFeedback('Criando usuário...', 'info');
                                                        const res = await createUserAccount({
                                                            email: emailEl.value.trim(),
                                                            name: nameEl.value.trim(),
                                                            role: roleEl.value,
                                                            password: passwordEl.value.trim(),
                                                        });
                                                        if (res?.error) {
                                                            showFeedback(`Erro ao cadastrar: ${res.error}`, 'error');
                                                        } else {
                                                            nameEl.value = ''; emailEl.value = ''; passwordEl.value = '';
                                                            getProfiles().then(setUsers);
                                                            showFeedback('Usuário criado! Repasse o e-mail e a senha inicial.');
                                                        }
                                                    }}
                                                    className="w-full py-5 bg-blue-600 text-white rounded-lg font-medium uppercase text-xs shadow-sm shadow-blue-200 hover:bg-blue-700 transition-all flex items-center justify-center gap-2"
                                                >
                                                    <Save className="w-4 h-4" /> Cadastrar Usuário
                                                </button>
                                            </div>

                                            {/* Users List */}
                                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                                {users.map(u => (
                                                    <div key={u.id} className="p-5 bg-white rounded-xl border border-[#e5e7eb] flex items-center justify-between group hover:border-blue-100 transition-all shadow-sm">
                                                        <div className="flex items-center gap-4">
                                                            <div className="w-12 h-12 rounded-lg bg-blue-50 flex items-center justify-center">
                                                                <span className="font-medium text-blue-400 text-sm">{u.name.charAt(0)}</span>
                                                            </div>
                                                            <div>
                                                                <p className="font-medium text-[#111827] text-xs uppercase tracking-tight">{u.name}</p>
                                                                <p className="text-[9px] font-medium text-slate-300 uppercase">@{u.username} • {u.role === 'master' ? 'Master' : 'Operador'}</p>
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                                                            {currentUser.role === 'master' && (
                                                                <button title="Redefinir senha" onClick={async () => {
                                                                    const np = prompt(`Nova senha para ${u.name} (mín. 6 caracteres):`);
                                                                    if (np === null) return;
                                                                    if (np.trim().length < 6) { showFeedback('Senha muito curta (mín. 6).', 'error'); return; }
                                                                    const res = await resetUserPassword(u.id, np.trim());
                                                                    if (res?.error) { showFeedback(`Erro ao redefinir: ${res.error}`, 'error'); }
                                                                    else { showFeedback(`Senha de ${u.name} redefinida. Repasse a nova senha.`); }
                                                                }} className="p-2 text-[#6b7280] hover:bg-[#f9fafb] hover:text-[#1d6fb8] rounded-lg">
                                                                    <Key className="w-4 h-4" />
                                                                </button>
                                                            )}
                                                            {currentUser.role === 'master' && u.id !== currentUser.id && (
                                                                <button title="Remover usuário" onClick={async () => {
                                                                    if (!confirm(`Remover o usuário ${u.name}? Esta ação apaga o acesso dele.`)) return;
                                                                    const res = await deleteUserAccount(u.id);
                                                                    if (res?.error) { showFeedback(`Erro ao remover: ${res.error}`, 'error'); }
                                                                    else { setUsers(users.filter(i => i.id !== u.id)); showFeedback('Usuário removido!'); }
                                                                }} className="p-2 text-red-300 hover:bg-red-50 rounded-lg">
                                                                    <Trash2 className="w-4 h-4" />
                                                                </button>
                                                            )}
                                                        </div>
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
                    <div className="fixed inset-0 pointer-events-none z-[2000] flex items-center justify-center overflow-hidden">
                        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm"></div>
                        {[...Array(50)].map((_, i) => (
                            <div key={i} className="confetti" style={{ left: `${Math.random() * 100}vw`, animationDelay: `${Math.random() * 2}s`, backgroundColor: ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00bcd4', '#e91e63'][Math.floor(Math.random() * 7)], width: `${Math.random() * 10 + 5}px`, height: `${Math.random() * 20 + 10}px` }} />
                        ))}
                        <div className="bg-white p-12 rounded-xl shadow-sm text-center celebration-text relative z-10 border border-[#e5e7eb]">
                            <div className="text-7xl mb-6">🎉 💸 🚚</div>
                            <h1 className="text-4xl font-medium text-emerald-600 mb-2 tracking-tight">Venda Fechada!</h1>
                            <p className="text-[#6b7280] font-normal text-sm mt-2">Parabéns pelo excelente trabalho</p>
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
