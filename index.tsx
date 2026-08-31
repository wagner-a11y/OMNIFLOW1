
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import PainelTV from './PainelTV';
import CadastroExterno from './CadastroExterno';
import { resolverTokenNoBoot } from './services/tokenCadastro';
import './index.css';

// Rotas públicas, que NÃO passam pelo App nem pelo login:
//   /painel-tv         painel de faturamento (só leitura)
//   /cadastro-externo  cadastro de veículo/conjunto (GRAVA no Datamex)
// Tudo o mais cai no App normal, com autenticação.
const rota = window.location.pathname.replace(/\/+$/, '');
const isPainelTV = rota === '/painel-tv';
const isCadastroExterno = rota === '/cadastro-externo';

// O token é resolvido ANTES de qualquer render, porque a primeira coisa que a
// tela faz é perguntar se ele existe. A regra inteira mora em
// resolverTokenNoBoot: URL primeiro, sessão da aba depois.
if (isCadastroExterno) {
    const { limpar, url } = resolverTokenNoBoot(window.location.href);
    if (limpar) window.history.replaceState({}, '', url);
}

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(
        <React.StrictMode>
            {isPainelTV ? <PainelTV /> : isCadastroExterno ? <CadastroExterno /> : <App />}
        </React.StrictMode>
    );
}
