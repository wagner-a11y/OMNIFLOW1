
import React, { useState, useEffect, useMemo } from 'react';
import jsPDF from 'jspdf';
import {
    LayoutDashboard, Calculator, History, Settings, LogOut, Truck, Map as MapIcon, DollarSign, Package, Scale, FileText, TrendingUp, AlertCircle, CheckCircle2, XCircle, ChevronRight, Search, Filter, ArrowUpDown, Save, Trash2, Edit3, Copy as ClipboardCopy, ThumbsUp, ThumbsDown, Plus, Upload, Users, Percent, Key, UserCircle, X, RotateCcw, FileDown, PlusCircle, Target, Info, Activity, Layers, ShieldCheck, ArrowRightLeft, CreditCard, Wrench, Lock, User as UserIcon, UserCheck, ImageIcon, Download, AlertTriangle, Clock, Hash, PieChart, Calendar, ChevronDown, Check, Zap, Award, ArrowDown, BarChart3, CheckCircle
} from 'lucide-react';
import { VehicleType, FreightCalculation, Customer, FederalTaxes, QuoteStatus, ANTTCoefficients, User, UserRole, Disponibilidade } from './types';
import { VEHICLE_CONFIGS, INITIAL_CUSTOMERS } from './constants';
import { estimateDistance } from './services/geminiService';
import {
    getUsers,
    createUser,
    deleteUser,
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

const DefaultLogo: React.FC<{ className?: string }> = ({ className }) => (
    <svg viewBox="0 0 100 100" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M50 10C27.9 10 10 27.9 10 50C10 72.1 27.9 90 50 90C63.1 90 74.6 83.7 81.8 74" stroke="#344a5e" strokeWidth="12" strokeLinecap="round" />
        <path d="M50 30C39 30 30 39 30 50C30 61 39 70 50 70C54 70 57.6 68.8 60.7 66.8" stroke="#005a9c" strokeWidth="8" strokeLinecap="round" />
        <circle cx="50" cy="50" r="8" fill="#f37021" />
    </svg>
);

const App: React.FC = () => {
    // Estados de Autenticação
    const [currentUser, setCurrentUser] = useState<User | null>(() => {
        const saved = localStorage.getItem('flow_current_user');
        return saved ? JSON.parse(saved) : null;
    });
    const [users, setUsers] = useState<User[]>([]);
    const [loginForm, setLoginForm] = useState({ username: '', password: '' });

    // Estados Globais
    const [appLogo, setAppLogo] = useState<string | null>(() => localStorage.getItem('flow_app_logo'));
    const [history, setHistory] = useState<FreightCalculation[]>([]);
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [fedTaxes, setFedTaxes] = useState<FederalTaxes>({ pis: 0.65, cofins: 3.0, csll: 1.08, irpj: 1.2, insurancePolicyRate: 0.035 });
    const [vehicleConfigs, setVehicleConfigs] = useState<Record<string, ANTTCoefficients & { factor?: number; axles?: number; capacity?: number; consumption?: number }>>(VEHICLE_CONFIGS);

    const [activeTab, setActiveTab] = useState<'new' | 'history' | 'reverse' | 'dashboard'>('dashboard');
    const [configTab, setConfigTab] = useState<'financial' | 'customers' | 'fleet' | 'users' | 'identity'>('financial');
    const [searchQuery, setSearchQuery] = useState('');
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'info' | 'error' } | null>(null);
    const [showConfigModal, setShowConfigModal] = useState(false);
    const [newCustomerName, setNewCustomerName] = useState('');
    const [newCustomerLogo, setNewCustomerLogo] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [showCelebration, setShowCelebration] = useState(false);
    const [selectedMonth, setSelectedMonth] = useState<string>(new Date().toISOString().slice(0, 7));

    // Estados de Edição de Clientes
    const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
    const [customerFilePreview, setCustomerFilePreview] = useState<string | null>(null);

    // Form State
    const [origin, setOrigin] = useState('');
    const [destination, setDestination] = useState('');
    const [clientReference, setClientReference] = useState('');
    const [distanceKm, setDistanceKm] = useState<string>('0');
    const [vehicleType, setVehicleType] = useState<string>(Object.keys(vehicleConfigs)[0] || "Truck");
    const [weight, setWeight] = useState<string>('0');
    const [selectedCustomerId, setSelectedCustomerId] = useState('');
    const [baseFreight, setBaseFreight] = useState<string>('0');
    const [tolls, setTolls] = useState<string>('0');
    const [extraCosts, setExtraCosts] = useState<string>('0');
    const [extraCostsDescription, setExtraCostsDescription] = useState('');
    const [goodsValue, setGoodsValue] = useState<string>('0');
    const [insurancePercent, setInsurancePercent] = useState<string>('0.2');
    const [profitMargin, setProfitMargin] = useState<string>('15');
    const [icmsPercent, setIcmsPercent] = useState<string>('12');
    const [targetFreightClient, setTargetFreightClient] = useState<string>('0');
    const [loadingDistance, setLoadingDistance] = useState(false);
    const [disponibilidade, setDisponibilidade] = useState<Disponibilidade>("Imediato");

    // Novo estado para usuários e veículos
    const [newUserForm, setNewUserForm] = useState<Partial<User>>({ name: '', username: '', password: '', role: 'operador' });
    const [newVehicleName, setNewVehicleName] = useState('');

    useEffect(() => {
        loadAllData();
    }, []);

    const loadAllData = async () => {
        try {
            const usersData = await getUsers();
            setUsers(usersData);
            const customersData = await getCustomers();
            setCustomers(customersData.length > 0 ? customersData : INITIAL_CUSTOMERS);
            const historyData = await getFreightCalculations();
            setHistory(historyData);
            const configData = await getSystemConfig();
            if (configData) setFedTaxes(configData);
            const vehiclesData = await getVehicleConfigs();
            setVehicleConfigs(Object.keys(vehiclesData).length > 0 ? vehiclesData : VEHICLE_CONFIGS);
        } catch (error) {
            console.error('Erro ao carregar dados:', error);
            showFeedback('Erro ao carregar dados do banco.', 'error');
        }
    };

    const num = (s: string | number) => typeof s === 'string' ? (parseFloat(s.replace(',', '.')) || 0) : s;

    useEffect(() => {
        if (appLogo) localStorage.setItem('flow_app_logo', appLogo);
        else localStorage.removeItem('flow_app_logo');
    }, [appLogo]);

    useEffect(() => {
        if (currentUser) localStorage.setItem('flow_current_user', JSON.stringify(currentUser));
        else localStorage.removeItem('flow_current_user');
    }, [currentUser]);

    useEffect(() => {
        if (toast) {
            const timer = setTimeout(() => setToast(null), 4000);
            return () => clearTimeout(timer);
        }
    }, [toast]);

    const handleLogin = (e: React.FormEvent) => {
        e.preventDefault();
        const user = users.find(u => u.username === loginForm.username && u.password === loginForm.password);
        if (user) {
            setCurrentUser(user);
            showFeedback(`Bem-vindo, ${user.name}!`);
        } else {
            showFeedback("Usuário ou senha incorretos.", "error");
        }
    };

    const handleLogout = () => {
        setCurrentUser(null);
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
            const route = `${h.origin.split(',')[0]} ➝ ${h.destination.split(',')[0]}`;
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

    const suggestedFreightANTT = useMemo(() => {
        const config = vehicleConfigs[vehicleType];
        const dist = parseFloat(distanceKm.replace(',', '.')) || 0;
        if (!config || dist === 0) return 0;
        if (config.factor && config.factor > 0) return dist * 2 * config.factor;
        return (dist * config.variable) + config.fixed;
    }, [vehicleType, distanceKm, vehicleConfigs]);

    const calcData = useMemo(() => {
        const gv = parseFloat(goodsValue.replace(',', '.')) || 0;
        const ip = parseFloat(insurancePercent.replace(',', '.')) || 0;
        const pm = parseFloat(profitMargin.replace(',', '.')) || 0;
        const icmsP = parseFloat(icmsPercent.replace(',', '.')) || 0;
        const tfc = parseFloat(targetFreightClient.replace(',', '.')) || 0;
        const t = parseFloat(tolls.replace(',', '.')) || 0;
        const bf = parseFloat(baseFreight.replace(',', '.')) || 0;
        const ec = parseFloat(extraCosts.replace(',', '.')) || 0;

        const adValoremSelling = gv * (ip / 100);
        const adValoremCost = gv * (fedTaxes.insurancePolicyRate / 100);
        const totalFedTaxPercent = (fedTaxes.pis + fedTaxes.cofins + fedTaxes.csll + fedTaxes.irpj);
        const icmsDivisor = (1 - (icmsP / 100));
        const marginDivisor = (1 - (pm / 100));

        if (activeTab === 'reverse' && tfc > 0) {
            const finalFreight = tfc;
            const icmsAmount = finalFreight * (icmsP / 100);
            const fedTaxesAmount = finalFreight * (totalFedTaxPercent / 100);
            const netRevenue = finalFreight - icmsAmount - fedTaxesAmount;
            const maxDirectCosts = netRevenue * marginDivisor;
            const buyerPower = maxDirectCosts - t - ec - adValoremSelling;
            const realDirectCosts = buyerPower + t + ec + adValoremCost;
            const realProfitAmount = netRevenue - realDirectCosts;
            const realMarginPercent = finalFreight > 0 ? (realProfitAmount / finalFreight) * 100 : 0;
            return { directCosts: buyerPower + t + ec + adValoremSelling, realDirectCosts, priceAfterMargin: maxDirectCosts, finalFreight, icmsAmount, fedTaxesAmount, adValoremSelling, adValoremCost, realProfitAmount, realMarginPercent, buyerPower: Math.max(0, buyerPower) };
        }

        const directCostsSelling = bf + t + ec + adValoremSelling;
        const priceWithMargin = marginDivisor > 0 ? directCostsSelling / marginDivisor : directCostsSelling;
        const finalFreight = icmsDivisor > 0 ? priceWithMargin / icmsDivisor : priceWithMargin;
        const icmsAmount = finalFreight * (icmsP / 100);
        const fedTaxesAmount = finalFreight * (totalFedTaxPercent / 100);
        const realDirectCosts = bf + t + ec + adValoremCost;
        const realProfitAmount = finalFreight - icmsAmount - fedTaxesAmount - realDirectCosts;
        const realMarginPercent = finalFreight > 0 ? (realProfitAmount / finalFreight) * 100 : 0;
        return { directCosts: directCostsSelling, realDirectCosts, priceAfterMargin: priceWithMargin, finalFreight, icmsAmount, fedTaxesAmount, adValoremSelling, adValoremCost, realProfitAmount, realMarginPercent, buyerPower: 0 };
    }, [baseFreight, tolls, extraCosts, goodsValue, insurancePercent, profitMargin, icmsPercent, fedTaxes, activeTab, targetFreightClient]);

    const handleFetchDistance = async () => {
        if (!origin || !destination) return;
        setLoadingDistance(true);
        try {
            const config = vehicleConfigs[vehicleType];
            const result = await estimateDistance(origin, destination, vehicleType, config?.axles);
            setDistanceKm(result.km.toString()); setOrigin(result.originNormalized); setDestination(result.destinationNormalized); setTolls(result.estimatedTolls.toString());
            showFeedback("Rota sincronizada!");
        } catch (err) { console.error(err); } finally { setLoadingDistance(false); }
    };

    const historicalAlert = useMemo(() => {
        if (!origin || !destination) return null;
        const matches = history.filter(h =>
            h.origin.toLowerCase().includes(origin.toLowerCase()) &&
            h.destination.toLowerCase().includes(destination.toLowerCase())
        );
        if (matches.length === 0) return null;
        const checkWon = matches.some(h => h.status === 'won');
        return (
            <div className={`col-span-1 md:col-span-2 px-6 py-3 rounded-xl flex items-center gap-3 animate-fade-in ${checkWon ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                {checkWon ? <CheckCircle className="w-4 h-4" /> : <Info className="w-4 h-4" />}
                <span className="text-[10px] font-black uppercase">
                    Histórico Encontrado: {matches.length} cotações anteriores ({checkWon ? 'JÁ ATENDEMOS' : 'NUNCA FECHAMOS'})
                </span>
            </div>
        );
    }, [origin, destination, history]);

    const generateId = () => crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);

    const saveQuote = async (status: QuoteStatus) => {
        const quoteId = editingId || generateId();
        const createdDate = editingId ? (history.find(h => h.id === editingId)?.createdAt || Date.now()) : Date.now();
        const data: FreightCalculation = {
            id: quoteId,
            proposalNumber: editingId ? (history.find(h => h.id === editingId)?.proposalNumber || '') : `CT-${new Date().getFullYear()}-${(history.length + 1).toString().padStart(4, '0')}`,
            clientReference, origin, destination, distanceKm: parseFloat(distanceKm.replace(',', '.')) || 0, vehicleType: vehicleType as VehicleType, merchandiseType: '', weight: parseFloat(weight.replace(',', '.')) || 0,
            customerId: selectedCustomerId, suggestedFreight: suggestedFreightANTT,
            baseFreight: activeTab === 'reverse' ? calcData.buyerPower : (parseFloat(baseFreight.replace(',', '.')) || 0),
            tolls: parseFloat(tolls.replace(',', '.')) || 0, extraCosts: parseFloat(extraCosts.replace(',', '.')) || 0, extraCostsDescription, goodsValue: parseFloat(goodsValue.replace(',', '.')) || 0, insurancePercent: parseFloat(insurancePercent.replace(',', '.')) || 0, adValorem: calcData.adValoremSelling, profitMargin: parseFloat(profitMargin.replace(',', '.')) || 0, icmsPercent: parseFloat(icmsPercent.replace(',', '.')) || 0,
            pisPercent: fedTaxes.pis, cofinsPercent: fedTaxes.cofins, csllPercent: fedTaxes.csll, irpjPercent: fedTaxes.irpj,
            totalFreight: calcData.finalFreight, createdAt: createdDate, disponibilidade, status, updatedBy: currentUser?.id, updatedByName: currentUser?.name,
            realProfit: calcData.realProfitAmount, realMarginPercent: calcData.realMarginPercent
        };
        try {
            if (editingId) {
                if (await updateFreightCalculation(data)) {
                    setHistory(prev => prev.map(h => h.id === editingId ? data : h));
                    showFeedback("Atualizado!");
                    if (status === 'won') { setShowCelebration(true); setTimeout(() => setShowCelebration(false), 4000); }
                }
            } else {
                if (await createFreightCalculation(data)) {
                    setHistory(prev => [data, ...prev]);
                    showFeedback("Salvo!");
                    if (status === 'won') { setShowCelebration(true); setTimeout(() => setShowCelebration(false), 4000); }
                }
            }
            setEditingId(null); resetForm(); setActiveTab('history');
        } catch (error) { showFeedback("Erro ao salvar.", "error"); }
    };

    const loadQuote = (quote: FreightCalculation) => {
        setOrigin(quote.origin); setDestination(quote.destination); setClientReference(quote.clientReference || ''); setDistanceKm(quote.distanceKm.toString());
        setVehicleType(quote.vehicleType); setWeight(quote.weight.toString()); setSelectedCustomerId(quote.customerId); setBaseFreight(quote.baseFreight.toString());
        setTolls(quote.tolls.toString()); setExtraCosts((quote.extraCosts || 0).toString()); setExtraCostsDescription(quote.extraCostsDescription || '');
        setGoodsValue(quote.goodsValue.toString()); setInsurancePercent(quote.insurancePercent.toString()); setProfitMargin(quote.profitMargin.toString());
        setIcmsPercent(quote.icmsPercent.toString()); setEditingId(quote.id); setDisponibilidade(quote.disponibilidade || "Imediato");
        setActiveTab('new'); showFeedback("Editando...");
    };

    const resetForm = () => {
        setOrigin(''); setDestination(''); setClientReference(''); setDistanceKm('0'); setBaseFreight('0'); setTolls('0'); setExtraCosts('0');
        setExtraCostsDescription(''); setGoodsValue('0'); setWeight('0'); setSelectedCustomerId(''); setTargetFreightClient('0'); setEditingId(null);
        setDisponibilidade("Imediato");
    };

    const handleCopyQuoteText = () => {
        const val = activeTab === 'reverse' ? (calcData.buyerPower + num(tolls)) : calcData.finalFreight;
        const text = `Cotação de Frete:
Veículo: ${vehicleType}
Valor: R$ ${formatCur(val)} All In.
Disponibilidade: ${disponibilidade}`;
        navigator.clipboard.writeText(text).then(() => showFeedback("Copiado!"));
    };

    const generatePDF = async () => {
        const doc = new jsPDF();
        const primaryColor = "#005a9c"; // OmniCargo Blue
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
            doc.text(`•   Qtd: 01 viagem`, indent + 80, currentY); currentY += spacing;
            doc.text(`•   Prazo Coleta: ${disponibilidade}`, indent, currentY); currentY += spacing + 3;

            // 2. Valor
            doc.setFont("helvetica", "bold");
            doc.text("2. Valor do Serviço", 15, currentY); currentY += spacing + 1;
            doc.setFont("helvetica", "normal");

            const freightVal = activeTab === 'reverse' ? (calcData.buyerPower + num(tolls)) : calcData.finalFreight;
            const formattedVal = freightVal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

            doc.setFont("helvetica", "bold");
            doc.text(`Valor Total: R$ ${formattedVal}`, indent, currentY); currentY += spacing;
            doc.setFont("helvetica", "normal");
            doc.setFontSize(8);
            doc.text(`(CNPJ Recebedor: 51.653.821/0001-68)`, indent, currentY);
            doc.setFontSize(9);
            currentY += spacing + 3;

            // 3. Detalhes
            doc.setFont("helvetica", "bold");
            doc.text("3. Detalhes do Serviço", 15, currentY); currentY += spacing + 1;
            doc.setFont("helvetica", "normal");
            doc.text(`•   Incluso: Frete, pedágio${num(insurancePercent) > 0 ? ', seguro' : ''} e impostos. Modalidade: Rodoviário dedicado.`, indent, currentY); currentY += spacing + 3;

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

    if (!currentUser) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[#344a5e] p-6">
                <div className="bg-white w-full max-w-md rounded-[3rem] shadow-2xl p-12 space-y-10 border-8 border-white/10">
                    <div className="flex flex-col items-center">
                        <div className="w-24 h-24 bg-[#344a5e] p-4 rounded-[2rem] shadow-2xl mb-6 flex items-center justify-center overflow-hidden">
                            {appLogo ? <img src={appLogo} alt="Logo" className="w-full h-full object-contain" /> : <DefaultLogo className="w-full h-full brightness-0 invert" />}
                        </div>
                        <h1 className="text-4xl font-black text-[#344a5e] tracking-tighter text-center leading-none">OMNI<br />FLOW</h1>
                    </div>
                    <form onSubmit={handleLogin} className="space-y-6">
                        <input type="text" className="w-full px-6 py-5 bg-slate-50 rounded-2xl font-bold outline-none" placeholder="Usuário" value={loginForm.username} onChange={e => setLoginForm({ ...loginForm, username: e.target.value })} required />
                        <input type="password" className="w-full px-6 py-5 bg-slate-50 rounded-2xl font-bold outline-none" placeholder="Senha" value={loginForm.password} onChange={e => setLoginForm({ ...loginForm, password: e.target.value })} required />
                        <button type="submit" className="w-full py-5 bg-[#005a9c] text-white rounded-3xl font-black uppercase text-xs">Acessar</button>
                    </form>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex flex-col md:flex-row bg-[#f1f5f9]">
            <aside className="w-full md:w-64 bg-slate-800 text-white flex flex-col sticky top-0 md:h-screen z-10 shadow-2xl overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-b from-slate-800 to-slate-900 z-0"></div>
                <div className="p-8 flex flex-col items-center relative z-10">
                    <div className="w-20 h-20 bg-white p-3 rounded-[2rem] shadow-2xl mb-4 flex items-center justify-center overflow-hidden">
                        {appLogo ? <img src={appLogo} alt="Logo" className="w-full h-full object-contain" /> : <DefaultLogo className="w-full h-full text-[#344a5e]" />}
                    </div>
                    <h1 className="text-2xl font-black tracking-tighter text-center leading-none">OMNI<br /><span className="text-blue-400">FLOW</span></h1>
                </div>
                <nav className="flex-1 px-4 space-y-3 mt-6 relative z-10">
                    {[
                        { id: 'dashboard', icon: BarChart3, label: 'Visão Geral' },
                        { id: 'new', icon: PlusCircle, label: 'Cotação Venda' },
                        { id: 'reverse', icon: Target, label: 'Custo Ideal' },
                        { id: 'history', icon: History, label: 'Histórico' }
                    ].map(item => (
                        <button key={item.id} onClick={() => { setActiveTab(item.id as any); if (item.id !== 'history' && item.id !== 'dashboard') resetForm(); }} className={`w-full flex items-center gap-4 px-6 py-4 rounded-2xl transition-all ${activeTab === item.id ? 'bg-blue-600 text-white shadow-lg translate-x-2' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}>
                            <item.icon className="w-5 h-5" />
                            <span className="font-black uppercase text-[10px] tracking-wider">{item.label}</span>
                        </button>
                    ))}
                </nav>
                <div className="p-4 mt-auto space-y-3 relative z-10">
                    {currentUser.role === 'master' && (
                        <button onClick={() => setShowConfigModal(true)} className="w-full flex items-center gap-4 px-6 py-4 rounded-2xl text-slate-400 hover:text-white transition-all hover:bg-white/5">
                            <Settings className="w-5 h-5" />
                            <span className="font-black uppercase text-[10px] tracking-wider">Parâmetros</span>
                        </button>
                    )}
                    <div className="bg-slate-900/50 p-3 rounded-[1.5rem] flex items-center gap-4">
                        <div className="w-10 h-10 rounded-2xl bg-blue-600 flex items-center justify-center font-black text-xs">{currentUser.name.charAt(0)}</div>
                        <div className="flex-1 min-w-0"><p className="text-[10px] font-black truncate">{currentUser.name}</p></div>
                        <button onClick={handleLogout} className="p-2 text-slate-400 hover:text-red-400"><LogOut className="w-4 h-4" /></button>
                    </div>
                </div>
            </aside>

            <main className="flex-1 overflow-y-auto pb-20">
                <header className="bg-white border-b px-8 py-6 sticky top-0 z-10 flex justify-between items-center shadow-sm">
                    <h2 className="text-lg font-black text-[#344a5e] uppercase tracking-tight">
                        {editingId ? 'Editando Registro' : activeTab === 'dashboard' ? 'Visão Geral Executiva' : activeTab === 'new' ? 'Formação Comercial' : activeTab === 'reverse' ? 'Engenharia Reversa' : 'Histórico'}
                    </h2>
                    {activeTab === 'history' && (
                        <div className="relative w-72">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <input type="text" placeholder="Buscar..." className="w-full pl-10 pr-4 py-2.5 bg-slate-100 rounded-full text-xs font-bold outline-none" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                        </div>
                    )}
                </header>

                <div className="p-8 max-w-7xl mx-auto space-y-8">
                    {activeTab === 'dashboard' ? (
                        <div className="space-y-8 animate-fade-in-up">
                            {/* Filtro de Período */}
                            <div className="flex justify-between items-end bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100">
                                <div>
                                    <h3 className="text-sm font-black uppercase text-[#344a5e] flex items-center gap-2"><Calendar className="w-4 h-4 text-blue-500" /> Período Analítico</h3>
                                    <p className="text-[10px] font-bold text-slate-400 mt-1">Análise baseada na data de fechamento da proposta.</p>
                                </div>
                                <div className="flex items-center gap-4">
                                    <div className="text-right mr-2">
                                        <p className="text-[10px] font-black text-slate-400 uppercase">Cotações no mês</p>
                                        <p className="text-lg font-black text-[#344a5e]">{dashboardData.filteredCount}</p>
                                    </div>
                                    <input type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} className="bg-slate-50 border-2 border-slate-100 rounded-xl px-4 py-2 font-black text-[#344a5e] outline-none focus:border-blue-500 transition-colors uppercase text-xs" />
                                </div>
                            </div>

                            {/* Cards de KPIs Principais */}
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-6">
                                <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100 bg-gradient-to-br from-white to-emerald-50/30">
                                    <div className="flex justify-between items-start mb-4">
                                        <div className="p-3 bg-emerald-50 rounded-2xl text-emerald-600"><DollarSign className="w-6 h-6" /></div>
                                        <span className="text-[10px] font-black uppercase text-emerald-600 tracking-wider bg-emerald-100 px-2 py-1 rounded-lg">Faturamento</span>
                                    </div>
                                    <h3 className="text-2xl font-black text-[#344a5e]">R$ {formatCur(dashboardData.totalWon)}</h3>
                                    <p className="text-[9px] font-bold text-slate-400 mt-1">{dashboardData.countWon} Vendas Confirmadas</p>
                                </div>

                                <div className="bg-[#344a5e] p-6 rounded-[2rem] shadow-xl text-white">
                                    <div className="flex justify-between items-start mb-4">
                                        <div className="p-3 bg-white/10 rounded-2xl text-emerald-400"><TrendingUp className="w-6 h-6" /></div>
                                        <span className="text-[10px] font-black uppercase text-emerald-400 tracking-wider bg-white/5 px-2 py-1 rounded-lg">Lucro Real</span>
                                    </div>
                                    <h3 className="text-2xl font-black text-white">R$ {formatCur(dashboardData.totalProfit)}</h3>
                                    <p className="text-[9px] font-bold opacity-50 mt-1">Resultado Líquido do Mês</p>
                                </div>

                                <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100">
                                    <div className="flex justify-between items-start mb-4">
                                        <div className="p-3 bg-blue-50 rounded-2xl text-blue-600"><Activity className="w-6 h-6" /></div>
                                        <span className="text-[10px] font-black uppercase text-blue-600 tracking-wider bg-blue-50 px-2 py-1 rounded-lg">Margem Méd.</span>
                                    </div>
                                    <h3 className="text-2xl font-black text-[#344a5e]">{dashboardData.avgMargin.toFixed(1)}%</h3>
                                    <p className="text-[9px] font-bold text-slate-400 mt-1">Eficiência Operacional</p>
                                </div>

                                <div className="bg-white p-6 rounded-[2rem] shadow-sm border">
                                    <div className="flex justify-between items-start mb-4">
                                        <div className="p-3 bg-amber-50 rounded-2xl text-amber-600"><Clock className="w-6 h-6" /></div>
                                        <span className="text-[10px] font-black uppercase text-amber-600 tracking-wider bg-amber-50 px-2 py-1 rounded-lg">Em Pauta</span>
                                    </div>
                                    <h3 className="text-2xl font-black text-[#344a5e]">R$ {formatCur(dashboardData.totalPending)}</h3>
                                    <p className="text-[9px] font-bold text-slate-400 mt-1">{dashboardData.countPending} Propostas Pendentes</p>
                                </div>

                                <div className="bg-white p-6 rounded-[2rem] shadow-sm border">
                                    <div className="flex justify-between items-start mb-4">
                                        <div className="p-3 bg-slate-50 rounded-2xl text-slate-600"><Scale className="w-6 h-6" /></div>
                                        <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider bg-slate-50 px-2 py-1 rounded-lg">Volume</span>
                                    </div>
                                    <h3 className="text-xl font-black text-[#344a5e]">{(dashboardData.totalWeight / 1000).toFixed(1)} <span className="text-xs font-bold text-slate-400">Ton</span></h3>
                                    <p className="text-[9px] font-bold text-slate-400 mt-1">{dashboardData.totalKm.toLocaleString()} KM Rodados</p>
                                </div>

                                <div className="bg-white p-6 rounded-[2rem] shadow-sm border">
                                    <div className="flex justify-between items-start mb-4">
                                        <div className="p-3 bg-purple-50 rounded-2xl text-purple-600"><Zap className="w-6 h-6" /></div>
                                        <span className="text-[10px] font-black uppercase text-purple-600 tracking-wider bg-purple-50 px-2 py-1 rounded-lg">Conversão</span>
                                    </div>
                                    <h3 className="text-2xl font-black text-[#344a5e]">{dashboardData.filteredCount > 0 ? ((dashboardData.countWon / dashboardData.filteredCount) * 100).toFixed(1) : 0}%</h3>
                                    <p className="text-[9px] font-bold text-slate-400 mt-1">{dashboardData.countLost} Fretes Perdidos</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                                {/* Top Clientes */}
                                <div className="lg:col-span-2 bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-100 flex flex-col">
                                    <div className="flex items-center justify-between mb-8">
                                        <div className="flex items-center gap-3">
                                            <Award className="w-5 h-5 text-blue-600" />
                                            <h3 className="font-black uppercase text-[11px] text-slate-400 tracking-widest">Top 5 Clientes por Receita</h3>
                                        </div>
                                    </div>
                                    <div className="space-y-6 flex-1">
                                        {dashboardData.topClients.length > 0 ? dashboardData.topClients.map((client, idx) => (
                                            <div key={idx} className="flex items-center gap-6 group">
                                                <div className="w-12 h-12 rounded-2xl flex items-center justify-center font-black text-xs bg-slate-50 overflow-hidden border-2 border-slate-50 group-hover:border-blue-100 transition-all">
                                                    {client.logo ? <img src={client.logo} className="w-full h-full object-cover" /> : <div className="w-full h-full bg-blue-50 text-blue-400 flex items-center justify-center">{client.name.charAt(0)}</div>}
                                                </div>
                                                <div className="flex-1">
                                                    <div className="flex justify-between mb-2">
                                                        <span className="text-sm font-black text-[#344a5e]">{client.name}</span>
                                                        <span className="text-sm font-black text-[#005a9c]">R$ {formatCur(client.value)}</span>
                                                    </div>
                                                    <div className="h-2.5 w-full bg-slate-50 rounded-full overflow-hidden">
                                                        <div className="h-full bg-blue-500 rounded-full transition-all duration-1000" style={{ width: `${(client.value / dashboardData.totalWon) * 100}%` }}></div>
                                                    </div>
                                                </div>
                                            </div>
                                        )) : (
                                            <div className="h-full flex flex-col items-center justify-center text-slate-300 gap-4">
                                                <Users className="w-12 h-12 opacity-20" />
                                                <p className="font-black uppercase text-[10px] tracking-widest">Nenhum dado no período</p>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Status e Conversão */}
                                <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-100 flex flex-col items-center">
                                    <div className="flex items-center justify-between w-full mb-8">
                                        <div className="flex items-center gap-3">
                                            <PieChart className="w-5 h-5 text-purple-600" />
                                            <h3 className="font-black uppercase text-[11px] text-slate-400 tracking-widest">Status das Propostas</h3>
                                        </div>
                                    </div>
                                    <div className="relative h-56 w-56 mx-auto mb-8 rounded-full flex items-center justify-center shadow-inner" style={{
                                        background: dashboardData.filteredCount > 0
                                            ? `conic-gradient(#10b981 0% ${((dashboardData.countWon / dashboardData.filteredCount) * 100)}%, #ef4444 ${((dashboardData.countWon / dashboardData.filteredCount) * 100)}% ${((dashboardData.countWon + dashboardData.countLost) / dashboardData.filteredCount * 100)}%, #f59e0b ${((dashboardData.countWon + dashboardData.countLost) / dashboardData.filteredCount * 100)}% 100%)`
                                            : '#f1f5f9'
                                    }}>
                                        <div className="absolute inset-5 bg-white rounded-full flex flex-col items-center justify-center shadow-xl">
                                            <span className="text-4xl font-black text-[#344a5e]">{dashboardData.filteredCount}</span>
                                            <span className="text-[10px] font-black text-slate-300 uppercase">Total</span>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-3 gap-2 w-full mt-auto">
                                        <div className="text-center">
                                            <div className="w-2 h-2 rounded-full bg-emerald-500 mx-auto mb-1"></div>
                                            <p className="text-[9px] font-black text-slate-400 uppercase">Ganhos</p>
                                            <p className="text-xs font-black text-[#344a5e]">{dashboardData.countWon}</p>
                                        </div>
                                        <div className="text-center">
                                            <div className="w-2 h-2 rounded-full bg-red-500 mx-auto mb-1"></div>
                                            <p className="text-[9px] font-black text-slate-400 uppercase">Perdas</p>
                                            <p className="text-xs font-black text-[#344a5e]">{dashboardData.countLost}</p>
                                        </div>
                                        <div className="text-center">
                                            <div className="w-2 h-2 rounded-full bg-amber-400 mx-auto mb-1"></div>
                                            <p className="text-[9px] font-black text-slate-400 uppercase">Pauta</p>
                                            <p className="text-xs font-black text-[#344a5e]">{dashboardData.countPending}</p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                                {/* Top Equipamentos */}
                                <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-100">
                                    <div className="flex items-center gap-3 mb-6">
                                        <Truck className="w-5 h-5 text-amber-500" />
                                        <h3 className="font-black uppercase text-[11px] text-slate-400 tracking-widest">Faturamento por Equipamento</h3>
                                    </div>
                                    <div className="space-y-4">
                                        {dashboardData.topVehicles.map((v, i) => (
                                            <div key={i} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl hover:bg-amber-50 transition-colors">
                                                <span className="text-xs font-black text-[#344a5e] uppercase">{v.name}</span>
                                                <span className="text-xs font-black text-amber-600">R$ {formatCur(v.value)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Top Rotas */}
                                <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-100">
                                    <div className="flex items-center gap-3 mb-6">
                                        <MapIcon className="w-5 h-5 text-purple-500" />
                                        <h3 className="font-black uppercase text-[11px] text-slate-400 tracking-widest">Rotas mais Ativas (Ganhos)</h3>
                                    </div>
                                    <div className="space-y-4">
                                        {dashboardData.topRoutes.map((r, i) => (
                                            <div key={i} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl hover:bg-purple-50 transition-colors">
                                                <span className="text-xs font-black text-[#344a5e] uppercase">{r.name}</span>
                                                <span className="text-xs font-black text-purple-600">R$ {formatCur(r.value)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : activeTab !== 'history' ? (
                        <div className="space-y-8 animate-fade-in-up">
                            <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                                <div className="lg:col-span-3 bg-white p-8 rounded-[2.5rem] shadow-sm border space-y-6">
                                    <div className="flex items-center justify-between mb-4">
                                        <div className="flex items-center gap-3"><Package className="w-5 h-5 text-blue-600" /><h3 className="font-black uppercase text-[11px] text-slate-400">Rota & Equipamento</h3></div>
                                        {parseFloat(distanceKm) > 0 && (
                                            <div className="flex items-center gap-2 px-4 py-1.5 bg-blue-50 rounded-full border border-blue-100 animate-fade-in">
                                                <MapIcon className="w-3 h-3 text-blue-500" />
                                                <span className="text-[10px] font-black text-blue-600 uppercase">{(parseFloat(distanceKm) || 0).toLocaleString()} KM Sugeridos</span>
                                            </div>
                                        )}
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <input type="text" className="w-full px-6 py-4 bg-slate-50 rounded-2xl font-bold border-2 border-transparent focus:border-blue-200 outline-none" value={origin} onChange={e => setOrigin(e.target.value)} onBlur={handleFetchDistance} placeholder="Origem (Cidade, UF)" />
                                        <input type="text" className="w-full px-6 py-4 bg-slate-50 rounded-2xl font-bold border-2 border-transparent focus:border-blue-200 outline-none" value={destination} onChange={e => setDestination(e.target.value)} onBlur={handleFetchDistance} placeholder="Destino (Cidade, UF)" />
                                    </div>
                                    {/* Alerta de Histórico */}
                                    {/* Alerta de Histórico */}
                                    {historicalAlert}
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                                        <div className="relative"><Hash className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" /><input type="text" className="w-full pl-10 pr-4 py-4 bg-blue-50/50 rounded-2xl font-bold border-2 border-blue-100 focus:border-blue-300 outline-none" value={clientReference} onChange={e => setClientReference(e.target.value)} placeholder="Ref Cliente" /></div>
                                        <select className="p-4 bg-slate-50 rounded-2xl font-bold outline-none border-2 border-transparent focus:border-blue-100 transition-all" value={vehicleType} onChange={e => setVehicleType(e.target.value)}>{Object.keys(vehicleConfigs).map(v => <option key={v} value={v}>{v}</option>)}</select>
                                        <div className="relative">
                                            <Scale className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
                                            <input type="text" className="w-full pl-10 pr-4 py-4 bg-slate-50 rounded-2xl font-bold outline-none border-2 border-transparent focus:border-blue-100 transition-all" value={weight} onChange={e => setWeight(e.target.value)} placeholder="Peso KG" />
                                        </div>
                                        <div className="relative">
                                            <MapIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
                                            <input type="text" className="w-full pl-10 pr-12 py-4 bg-slate-50 rounded-2xl font-bold outline-none border-2 border-transparent focus:border-blue-100 transition-all" value={distanceKm} onChange={e => setDistanceKm(e.target.value)} placeholder="KM" />
                                            <button onClick={handleFetchDistance} className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-white text-blue-500 rounded-xl shadow-sm hover:bg-blue-50 transition-all border border-slate-100" title="Recalcular Distância"><RotateCcw className="w-3 h-3" /></button>
                                        </div>
                                        <select className="p-4 bg-slate-50 rounded-2xl font-bold outline-none border-2 border-transparent focus:border-blue-100 transition-all" value={selectedCustomerId} onChange={e => setSelectedCustomerId(e.target.value)}><option value="">Selecione Cliente...</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                                        <select className="p-4 bg-slate-50 rounded-2xl font-bold outline-none border-2 border-transparent focus:border-blue-100 transition-all" value={disponibilidade} onChange={e => setDisponibilidade(e.target.value as Disponibilidade)}><option value="Imediato">Imediato</option><option value="Conforme programação">Programado</option></select>
                                    </div>
                                </div>
                                <div className="lg:col-span-1 bg-[#344a5e] p-8 rounded-[2rem] shadow-xl text-center flex flex-col items-center justify-center text-white relative group overflow-hidden">
                                    <Scale className="w-6 h-6 text-emerald-400 mb-3" />
                                    <h4 className="text-[10px] font-black uppercase text-slate-400">Referência ANTT</h4>
                                    <p className="text-3xl font-black mb-4">R$ {formatCur(suggestedFreightANTT)}</p>
                                    <button
                                        onClick={() => {
                                            setBaseFreight(suggestedFreightANTT.toString());
                                            showFeedback("Valor ANTT aplicado ao preço base!");
                                        }}
                                        className="w-full py-2 bg-white/10 hover:bg-emerald-500 rounded-xl text-[9px] font-black uppercase transition-all flex items-center justify-center gap-2 border border-white/10 hover:border-transparent group-hover:scale-105"
                                    >
                                        <Check className="w-3 h-3" /> Aderir ao Preço Base
                                    </button>
                                </div>
                            </div>

                            <div className="bg-white p-10 rounded-[2.5rem] shadow-sm border grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-6 hover:shadow-xl transition-all relative">
                                <div className="lg:col-span-1 flex flex-col">
                                    <div className="flex justify-between mb-2"><span className="text-[10px] font-black uppercase text-blue-600">{activeTab === 'reverse' ? 'Alvo Cliente' : 'Preço Base'}</span></div>
                                    {activeTab === 'reverse' ? (
                                        <input type="text" className="w-full p-4 rounded-xl font-black border-2 bg-blue-50 text-blue-600 border-blue-200 transition-all" placeholder="Alvo Cliente" value={targetFreightClient} onChange={e => setTargetFreightClient(e.target.value)} />
                                    ) : (
                                        <input type="text" className="w-full p-4 rounded-xl font-black text-[#344a5e] bg-slate-100 focus:bg-white outline-none border-2 border-transparent focus:border-blue-100 transition-all" value={baseFreight} onChange={e => setBaseFreight(e.target.value)} />
                                    )}
                                </div>
                                <div className="lg:col-span-1 flex flex-col">
                                    <div className="flex justify-between mb-2"><span className="text-[10px] font-black text-slate-400 uppercase">Pedágio</span></div>
                                    <input type="text" className="w-full p-4 bg-slate-50 rounded-xl font-bold border-2 border-transparent focus:border-slate-100 outline-none transition-all" value={tolls} onChange={e => setTolls(e.target.value)} />
                                </div>
                                <div className="lg:col-span-1 flex flex-col">
                                    <div className="flex justify-between mb-2"><span className="text-[10px] font-black text-slate-400 uppercase">Valor Mercadoria</span></div>
                                    <input type="text" className="w-full p-4 bg-slate-50 rounded-xl font-bold border-2 border-transparent focus:border-slate-100 outline-none transition-all" value={goodsValue} onChange={e => setGoodsValue(e.target.value)} placeholder="R$ 0,00" />
                                </div>
                                <div className="lg:col-span-1 flex flex-col">
                                    <div className="flex justify-between mb-2"><span className="text-[10px] font-black text-slate-400 uppercase">Ad Val (%)</span></div>
                                    <input type="text" className="w-full p-4 bg-slate-50 rounded-xl font-bold border-2 border-transparent focus:border-slate-100 outline-none transition-all" value={insurancePercent} onChange={e => setInsurancePercent(e.target.value)} />
                                </div>
                                <div className="lg:col-span-1 flex flex-col">
                                    <div className="flex justify-between mb-2"><span className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">Margem de Lucro (%)</span></div>
                                    <input type="text" className="w-full p-4 bg-slate-50 rounded-xl font-bold border-2 border-transparent focus:border-slate-100 outline-none transition-all" value={profitMargin} onChange={e => setProfitMargin(e.target.value)} />
                                </div>
                                <div className="lg:col-span-1 flex flex-col">
                                    <div className="flex justify-between mb-2"><span className="text-[10px] font-black text-slate-400 uppercase">ICMS Destino (%)</span></div>
                                    <input type="text" className="w-full p-4 bg-slate-50 rounded-xl font-bold border-2 border-transparent focus:border-slate-100 outline-none transition-all" value={icmsPercent} onChange={e => setIcmsPercent(e.target.value)} />
                                </div>
                            </div>

                            {/* Cards de Detalhamento Técnico */}
                            {/* Cards de Detalhamento Técnico - HIDDEN
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div className="bg-white p-6 rounded-[2rem] border-2 border-slate-50 shadow-sm relative overflow-hidden group">
                                    <h5 className="text-[10px] font-black text-slate-400 uppercase mb-4 flex items-center gap-2 relative z-10"><Percent className="w-3 h-3" /> Impostos (ICMS)</h5>
                                    <p className="text-2xl font-black text-[#344a5e]">R$ {formatCur(calcData.icmsAmount)}</p>
                                    <p className="text-[9px] font-bold text-slate-400 mt-1">Recolhimento Destino ({icmsPercent}%)</p>
                                </div>
                                <div className="bg-white p-6 rounded-[2rem] border-2 border-slate-50 shadow-sm">
                                    <h5 className="text-[10px] font-black text-slate-400 uppercase mb-4 flex items-center gap-2"><ShieldCheck className="w-3 h-3" /> Ad Valorem (Seguro)</h5>
                                    <div className="flex justify-between items-end">
                                        <div>
                                            <p className="text-2xl font-black text-[#344a5e]">R$ {formatCur(calcData.adValoremSelling)}</p>
                                            <p className="text-[9px] font-bold text-slate-400 mt-1">Taxa Comercial ({insurancePercent}%)</p>
                                        </div>
                                    </div>
                                </div>
                                <div className="bg-white p-6 rounded-[2rem] border-2 border-slate-50 shadow-sm bg-gradient-to-br from-white to-slate-50">
                                    <h5 className="text-[10px] font-black text-slate-400 uppercase mb-4 flex items-center gap-2"><DollarSign className="w-3 h-3" /> Lucro Bruto Real</h5>
                                    <p className="text-2xl font-black text-emerald-600">R$ {formatCur(calcData.realProfitAmount)}</p>
                                    <p className="text-[9px] font-bold text-slate-400 mt-1">Sobra Líquida da Operação</p>
                                </div>
                            </div>
                            */}


                            <div className={`p-12 rounded-[4rem] shadow-2xl text-white flex flex-col lg:flex-row items-center gap-12 relative overflow-hidden transition-all duration-500 border-8 border-white/5 ${activeTab === 'reverse' ? 'bg-[#344a5e]' : 'bg-[#005a9c]'}`}>
                                <div className="lg:w-48 text-center p-6 bg-white/10 rounded-[2.5rem] border border-white/20">
                                    <TrendingUp className="w-8 h-8 mx-auto mb-2 text-emerald-400" />
                                    <p className="text-4xl font-black">{calcData.realMarginPercent.toFixed(1)}%</p>
                                    <p className="text-[9px] font-bold opacity-40 uppercase">Margem Real</p>
                                </div>
                                <div className="flex-1 text-center">
                                    <p className="text-[11px] font-black opacity-50 uppercase tracking-[0.4em] mb-4">
                                        {activeTab === 'reverse' ? 'PODER DE COMPRA (FRETE BASE)' : 'FRETE FINAL AO CLIENTE'}
                                    </p>
                                    <p className="text-9xl font-black tracking-tighter drop-shadow-2xl">
                                        R$ {formatCur(activeTab === 'reverse' ? (calcData.buyerPower + num(tolls)) : calcData.finalFreight)}
                                    </p>
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full mt-8">
                                        <button onClick={() => saveQuote('won')} className="bg-emerald-500 py-6 rounded-[2rem] font-black uppercase text-[10px] flex items-center justify-center gap-2 hover:bg-emerald-600 shadow-lg transition-transform hover:scale-105">
                                            <ThumbsUp className="w-4 h-4" /> Fechado
                                        </button>
                                        <button onClick={() => saveQuote('lost')} className="bg-red-500 py-6 rounded-[2rem] font-black uppercase text-[10px] flex items-center justify-center gap-2 hover:bg-red-600 shadow-lg transition-transform hover:scale-105">
                                            <ThumbsDown className="w-4 h-4" /> Perdido
                                        </button>
                                        <button onClick={() => saveQuote('pending')} className="bg-white/10 py-6 rounded-[2rem] font-black uppercase text-[10px] hover:bg-white/20 border border-white/20 flex items-center justify-center gap-2">
                                            <Save className="w-4 h-4" /> Salvar
                                        </button>
                                        <button onClick={handleCopyQuoteText} className="bg-white py-6 rounded-[2rem] font-black uppercase text-[10px] text-[#005a9c] hover:bg-slate-100 flex items-center justify-center gap-2 shadow-lg">
                                            <ClipboardCopy className="w-4 h-4" /> Copiar
                                        </button>
                                        <button onClick={generatePDF} className="col-span-2 md:col-span-4 bg-slate-800 text-white py-4 rounded-[2rem] font-black uppercase text-[10px] hover:bg-slate-900 border border-slate-700 flex items-center justify-center gap-2 shadow-lg mt-2">
                                            <FileDown className="w-4 h-4 text-emerald-400" /> Gerar Proposta Comercial (PDF)
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Extrato Detalhado da Cotação */}
                            <div className="bg-[#344a5e] p-8 rounded-[2.5rem] shadow-xl text-white">
                                <div className="flex items-center gap-3 mb-8">
                                    <FileText className="w-5 h-5 text-blue-400" />
                                    <h3 className="font-black uppercase text-[11px] tracking-widest text-slate-400">Extrato Detalhado da Operação</h3>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-6">
                                    <div className="space-y-4">
                                        <div className="flex justify-between items-center py-3 border-b border-white/10">
                                            <span className="text-[10px] font-bold uppercase opacity-60">Frete Base / Poder de Compra</span>
                                            <span className="font-black text-sm">R$ {formatCur(activeTab === 'reverse' ? calcData.buyerPower : num(baseFreight))}</span>
                                        </div>
                                        <div className="flex justify-between items-center py-3 border-b border-white/10">
                                            <span className="text-[10px] font-bold uppercase opacity-60">Pedágio Programado</span>
                                            <span className="font-black text-sm text-blue-300">R$ {formatCur(num(tolls))}</span>
                                        </div>
                                        <div className="flex justify-between items-center py-3 border-b border-white/10">
                                            <span className="text-[10px] font-bold uppercase opacity-60">Seguro Ad Valorem ({insurancePercent}%)</span>
                                            <span className="font-black text-sm">R$ {formatCur(calcData.adValoremSelling)}</span>
                                        </div>
                                    </div>
                                    <div className="space-y-4">
                                        <div className="flex justify-between items-center py-3 border-b border-white/10">
                                            <span className="text-[10px] font-bold uppercase opacity-60">Impostos Federais (PIS/COFINS/CSLL)</span>
                                            <span className="font-black text-sm">R$ {formatCur(calcData.fedTaxesAmount)}</span>
                                        </div>
                                        <div className="flex justify-between items-center py-3 border-b border-white/10">
                                            <span className="text-[10px] font-bold uppercase opacity-60">ICMS Destino ({icmsPercent}%)</span>
                                            <span className="font-black text-sm">R$ {formatCur(calcData.icmsAmount)}</span>
                                        </div>
                                        <div className="flex justify-between items-center py-3 border-b border-white/10">
                                            <span className="text-[10px] font-bold uppercase opacity-60">Lucro Projetado (Remuneração)</span>
                                            <span className="font-black text-sm text-emerald-400">R$ {formatCur(calcData.realProfitAmount)} ({calcData.realMarginPercent.toFixed(1)}%)</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="mt-8 pt-6 border-t border-white/20 flex flex-wrap items-center justify-between gap-4">
                                    <div className="flex items-center gap-4">
                                        <div className="px-5 py-2 bg-white/10 rounded-xl border border-white/10">
                                            <p className="text-[8px] font-black uppercase opacity-40 leading-none mb-1">Custo Direto Total</p>
                                            <p className="text-sm font-black text-white">R$ {formatCur(calcData.realDirectCosts)}</p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-[9px] font-black uppercase text-slate-400 mb-1">Validação de Viabilidade</p>
                                        <div className="flex items-center gap-2">
                                            <div className={`w-3 h-3 rounded-full ${calcData.realMarginPercent >= 15 ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`}></div>
                                            <span className="text-xs font-black uppercase tracking-widest">
                                                {calcData.realMarginPercent >= 15 ? 'Margem Saudável' : 'Revisar Custo'}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                        </div>
                    ) : (
                        <div className="space-y-4 animate-fade-in-up">
                            <div className="flex items-center gap-4 px-4 mb-4">
                                <History className="w-8 h-8 text-[#344a5e]" />
                                <h1 className="text-3xl font-black text-[#344a5e] tracking-tight">Histórico de Cotações</h1>
                            </div>
                            <div className="bg-white p-5 rounded-[2rem] border shadow-sm flex items-center gap-8 px-12 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-6">
                                <span className="w-28">Status</span>
                                <span className="w-32">Data</span>
                                <span className="flex-1">Ref / Rota</span>
                                <span className="w-40">Identificação</span>
                                <span className="w-32 text-right">Rentabilidade</span>
                                <span className="w-40 text-right">Valor Final</span>
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
                                        <div key={h.id} className="bg-white h-24 px-12 rounded-[2rem] border shadow-sm flex items-center gap-8 group hover:border-blue-500 transition-all">
                                            <div className="w-28"><span className={`px-4 py-2 rounded-xl text-[9px] font-black text-white uppercase ${h.status === 'won' ? 'bg-emerald-500' : h.status === 'lost' ? 'bg-red-500' : 'bg-amber-400'}`}>{h.status === 'won' ? 'GANHO' : h.status === 'lost' ? 'PERDIDO' : 'PAUTA'}</span></div>
                                            <span className="w-32 text-xs font-bold text-slate-400">
                                                {(() => {
                                                    try {
                                                        const d = new Date(h.createdAt);
                                                        return isNaN(d.getTime()) ? 'Data Inválida' : d.toLocaleDateString();
                                                    } catch (e) { return '-'; }
                                                })()}
                                            </span>
                                            <div className="flex-1 min-w-0 flex flex-col justify-center">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-black text-[#344a5e] text-sm">{h.proposalNumber}</span>
                                                    {h.clientReference && <span className="bg-blue-50 text-blue-600 px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wide">{h.clientReference}</span>}
                                                </div>
                                                {customer && (
                                                    <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest mt-0.5">{customer.name}</p>
                                                )}
                                                <p className="text-[9px] font-bold text-slate-400 truncate uppercase mt-0.5">{h.origin.split(',')[0]} ➝ {h.destination.split(',')[0]} <span className="opacity-40">| {h.vehicleType}</span></p>
                                            </div>
                                            <div className="w-40 flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-xl bg-slate-50 flex items-center justify-center font-black text-xs text-[#344a5e] shadow-sm border border-slate-100">
                                                    {h.updatedByName?.charAt(0) || 'A'}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-[10px] font-black text-[#344a5e] uppercase truncate">{h.updatedByName || 'Admin'}</p>
                                                    <p className="text-[8px] font-bold text-slate-400 uppercase tracking-tighter">Responsável</p>
                                                </div>
                                            </div>
                                            <div className="w-32 text-right">
                                                <p className={`text-sm font-black ${realMargin < 15 ? 'text-red-500' : 'text-emerald-600'}`}>{realMargin.toFixed(1)}%</p>
                                                <p className="text-[9px] font-bold text-slate-400 uppercase">Lucro: R$ {formatCur(profitValue)}</p>
                                            </div>
                                            <div className="w-40 text-right"><p className="text-lg font-black text-[#344a5e]">R$ {formatCur(h.totalFreight)}</p></div>
                                            <div className="w-20 flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-all"><button onClick={() => loadQuote(h)} className="p-2 text-blue-500 hover:bg-blue-50 rounded-lg"><Edit3 className="w-4 h-4" /></button><button onClick={async () => { if (await deleteFreightCalculation(h.id)) setHistory(prev => prev.filter(i => i.id !== h.id)); }} className="p-2 text-red-400 hover:bg-red-50 rounded-lg"><Trash2 className="w-4 h-4" /></button></div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            </main>

            {/* Modal de Configurações */}
            {showConfigModal && (
                <div className="fixed inset-0 bg-[#1e293b]/80 backdrop-blur-md z-[100] flex items-center justify-center p-6">
                    <div className="bg-white w-full max-w-5xl h-[85vh] rounded-[3.5rem] shadow-2xl flex flex-col overflow-hidden">
                        <div className="p-8 border-b flex justify-between items-center bg-slate-50">
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-blue-600 rounded-2xl text-white shadow-lg"><Settings className="w-6 h-6 animate-spin-slow" /></div>
                                <div><h3 className="text-xl font-black text-[#344a5e] uppercase tracking-tighter">Painel de Parâmetros</h3><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Configurações globais do sistema</p></div>
                            </div>
                            <button onClick={() => setShowConfigModal(false)} className="w-12 h-12 rounded-2xl bg-white border-2 border-slate-100 flex items-center justify-center text-slate-400 hover:text-red-500 hover:border-red-100 transition-all"><X className="w-6 h-6" /></button>
                        </div>
                        <div className="flex-1 flex overflow-hidden">
                            <aside className="w-72 bg-slate-50 border-r p-6 space-y-3">
                                {[
                                    { id: 'customers', label: 'Clientes', icon: Users },
                                    { id: 'financial', label: 'Tributação', icon: Percent },
                                    { id: 'fleet', label: 'Frota/ANTT', icon: Truck },
                                    { id: 'identity', label: 'Marca', icon: ImageIcon }
                                ].map(tab => (
                                    <button key={tab.id} onClick={() => setConfigTab(tab.id as any)} className={`w-full flex items-center gap-4 px-6 py-4 rounded-2xl font-black uppercase text-[10px] transition-all ${configTab === tab.id ? 'bg-white text-blue-600 shadow-md translate-x-2' : 'text-slate-400 hover:bg-white/50'}`}>
                                        <tab.icon className="w-4 h-4" /> {tab.label}
                                    </button>
                                ))}
                            </aside>
                            <div className="flex-1 p-10 overflow-y-auto">
                                {configTab === 'customers' && (
                                    <div className="space-y-8">
                                        <div className="bg-slate-50 p-8 rounded-[2.5rem] border-2 border-slate-100 shadow-sm">
                                            <div className="flex items-center gap-3 mb-6">
                                                <div className="p-2 bg-blue-100 rounded-xl text-blue-600"><PlusCircle className="w-4 h-4" /></div>
                                                <h4 className="text-[11px] font-black uppercase text-slate-400 tracking-widest">{editingCustomer ? 'Editar Cliente' : 'Novo Cliente'}</h4>
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-end">
                                                <div className="space-y-4">
                                                    <div className="flex flex-col gap-2">
                                                        <label className="text-[10px] font-black text-slate-400 uppercase ml-2">Nome do Cliente</label>
                                                        <input type="text" className="w-full p-5 bg-white rounded-2xl font-bold outline-none border-2 border-slate-100 focus:border-blue-200 transition-all shadow-inner" placeholder="Ex: Logística Brasil" value={newCustomerName} onChange={e => setNewCustomerName(e.target.value)} />
                                                    </div>

                                                    <div className="flex items-center gap-4 p-4 bg-white rounded-2xl border-2 border-dashed border-slate-200">
                                                        <div className="w-16 h-16 bg-slate-50 rounded-xl flex items-center justify-center overflow-hidden border-2 border-white shadow-sm">
                                                            {(customerFilePreview || newCustomerLogo) ? (
                                                                <img src={customerFilePreview || newCustomerLogo} className="w-full h-full object-contain" />
                                                            ) : <ImageIcon className="w-6 h-6 text-slate-200" />}
                                                        </div>
                                                        <div className="flex-1">
                                                            <p className="text-[10px] font-black text-slate-400 uppercase mb-2">Logotipo do Cliente</p>
                                                            <label className="bg-slate-100 hover:bg-slate-200 px-4 py-2 rounded-lg text-slate-600 font-black uppercase text-[9px] cursor-pointer transition-colors inline-flex items-center gap-2">
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
                                                    }} className="flex-1 py-5 bg-blue-600 text-white rounded-2xl font-black uppercase text-xs shadow-lg shadow-blue-200 hover:bg-blue-700 transition-all flex items-center justify-center gap-2">
                                                        <Save className="w-4 h-4" /> {editingCustomer ? 'Salvar Alterações' : 'Cadastrar'}
                                                    </button>
                                                    {editingCustomer && (
                                                        <button onClick={() => {
                                                            setEditingCustomer(null);
                                                            setNewCustomerName('');
                                                            setNewCustomerLogo('');
                                                            setCustomerFilePreview(null);
                                                        }} className="px-6 bg-slate-200 text-slate-600 rounded-2xl font-black uppercase text-xs hover:bg-slate-300 transition-all">Cancelar</button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                            {customers.map(c => (
                                                <div key={c.id} className="p-5 bg-white rounded-[2rem] border-2 border-slate-50 flex items-center justify-between group hover:border-blue-100 transition-all shadow-sm">
                                                    <div className="flex items-center gap-4">
                                                        <div className="w-12 h-12 rounded-xl bg-slate-50 border flex items-center justify-center overflow-hidden">
                                                            {c.logoUrl ? <img src={c.logoUrl} className="w-full h-full object-contain" /> : <span className="font-black text-slate-300">{c.name.charAt(0)}</span>}
                                                        </div>
                                                        <div>
                                                            <p className="font-black text-[#344a5e] text-xs uppercase tracking-tight">{c.name}</p>
                                                            <p className="text-[9px] font-bold text-slate-300 uppercase">Cliente Cadastrado</p>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                                                        <button onClick={() => {
                                                            setEditingCustomer(c);
                                                            setNewCustomerName(c.name);
                                                            setNewCustomerLogo(c.logoUrl || '');
                                                            setCustomerFilePreview(null);
                                                        }} className="p-2 text-blue-400 hover:bg-blue-50 rounded-lg"><Edit3 className="w-4 h-4" /></button>
                                                        <button onClick={async () => { if (await deleteCustomer(c.id)) setCustomers(customers.filter(i => i.id !== c.id)); }} className="p-2 text-red-300 hover:bg-red-50 rounded-lg"><Trash2 className="w-4 h-4" /></button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                {configTab === 'financial' && (
                                    <div className="grid grid-cols-2 gap-8">{Object.entries(fedTaxes).map(([key, val]) => (
                                        <div key={key} className="bg-slate-50 p-6 rounded-[2.5rem] border shadow-sm">
                                            <label className="text-[10px] font-black text-slate-400 uppercase block mb-2">{key}</label>
                                            <input type="number" step="0.01" className="w-full p-4 bg-white rounded-2xl font-black text-2xl text-[#344a5e]" value={val} onChange={e => handleUpdateFedTaxes(key as any, Number(e.target.value))} />
                                        </div>
                                    ))}</div>
                                )}
                                {configTab === 'fleet' && (
                                    <div className="space-y-6">
                                        <div className="flex items-center justify-between mb-4">
                                            <h3 className="font-black text-[#344a5e]">Configuração de Frota e ANTT</h3>
                                            <button onClick={() => {
                                                const name = prompt("Nome do novo tipo de veículo:");
                                                if (name) handleUpdateVehicleConfig(name, { capacity: 10000, consumption: 2.5, factor: 1.5, fixed: 0, variable: 0 });
                                            }} className="px-4 py-2 bg-blue-100 text-blue-600 rounded-xl font-black text-[10px] uppercase hover:bg-blue-200 transition-colors">
                                                + Novo Veículo
                                            </button>
                                        </div>
                                        {Object.entries(vehicleConfigs).map(([key, config]) => (
                                            <div key={key} className="bg-slate-50 p-6 rounded-[2.5rem] border shadow-sm">
                                                <div className="flex justify-between items-center mb-4">
                                                    <h4 className="font-black text-[#344a5e] uppercase flex items-center gap-2"><Truck className="w-4 h-4 text-slate-400" /> {key}</h4>
                                                    <button onClick={() => handleDeleteVehicleConfig(key)} className="p-2 text-red-300 hover:bg-red-50 rounded-lg"><Trash2 className="w-4 h-4" /></button>
                                                </div>
                                                <div className="grid grid-cols-3 gap-4">
                                                    <div>
                                                        <label className="text-[9px] font-black text-slate-400 uppercase">Capacidade (KG)</label>
                                                        <input type="number" className="w-full p-3 bg-white rounded-xl font-bold text-[#344a5e] border" value={config.capacity} onChange={e => handleUpdateVehicleConfig(key, { ...config, capacity: Number(e.target.value) })} />
                                                    </div>
                                                    <div>
                                                        <label className="text-[9px] font-black text-slate-400 uppercase">Consumo (KM/L)</label>
                                                        <input type="number" step="0.1" className="w-full p-3 bg-white rounded-xl font-bold text-[#344a5e] border" value={config.consumption} onChange={e => handleUpdateVehicleConfig(key, { ...config, consumption: Number(e.target.value) })} />
                                                    </div>
                                                    <div>
                                                        <label className="text-[9px] font-black text-slate-400 uppercase">Fator ANTT</label>
                                                        <input type="number" step="0.01" className="w-full p-3 bg-white rounded-xl font-bold text-[#344a5e] border" value={config.factor || 1.2} onChange={e => handleUpdateVehicleConfig(key, { ...config, factor: Number(e.target.value) })} />
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {configTab === 'identity' && (
                                    <div className="bg-slate-50 p-12 rounded-[3.5rem] flex flex-col items-center gap-8 border">
                                        <div className="w-48 h-48 bg-white p-6 rounded-[3rem] shadow-2xl flex items-center justify-center overflow-hidden border-4 border-white">{appLogo ? <img src={appLogo} className="w-full h-full object-contain" /> : <DefaultLogo className="w-full h-full text-[#344a5e]" />}</div>
                                        <label className="bg-blue-600 px-10 py-5 rounded-2xl text-white font-black uppercase text-xs cursor-pointer"><ImageIcon className="w-5 h-5 inline mr-2" /> Alterar Logo<input type="file" className="hidden" onChange={handleLogoUpload} accept="image/*" /></label>
                                        <button onClick={() => setAppLogo(null)} className="text-red-400 font-black text-[10px] uppercase underline underline-offset-4">Resetar Padrão</button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {toast && (
                <div className="fixed bottom-12 left-1/2 -translate-x-1/2 z-[1000] animate-bounce-in">
                    <div className="bg-[#1e293b] text-white px-10 py-5 rounded-full shadow-2xl flex items-center gap-4 font-black uppercase text-[10px]">{toast.message}</div>
                </div>
            )}

            {showCelebration && (
                <div className="fixed inset-0 pointer-events-none z-[2000] flex items-center justify-center overflow-hidden">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm"></div>
                    {[...Array(50)].map((_, i) => (
                        <div key={i} className="confetti" style={{ left: `${Math.random() * 100}vw`, animationDelay: `${Math.random() * 2}s`, backgroundColor: ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00bcd4', '#e91e63'][Math.floor(Math.random() * 7)], width: `${Math.random() * 10 + 5}px`, height: `${Math.random() * 20 + 10}px` }} />
                    ))}
                    <div className="bg-white p-12 rounded-[3rem] shadow-2xl text-center celebration-text relative z-10 border-4 border-emerald-400 rotate-2">
                        <div className="text-7xl mb-6">🎉 💸 🚚</div>
                        <h1 className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-emerald-500 to-green-600 mb-2 uppercase tracking-tighter">Venda Fechada!</h1>
                        <p className="text-slate-400 font-bold uppercase tracking-widest text-xs mt-2">Parabéns pelo excelente trabalho</p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default App;
