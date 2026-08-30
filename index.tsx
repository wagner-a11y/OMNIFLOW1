
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import PainelTV from './PainelTV';
import CadastroExterno from './CadastroExterno';
import { definirTokenCadastro } from './services/tokenCadastro';
import './index.css';

// Rotas públicas, que NÃO passam pelo App nem pelo login:
//   /painel-tv         painel de faturamento (só leitura)
//   /cadastro-externo  cadastro de veículo/conjunto (GRAVA no Datamex)
// Tudo o mais cai no App normal, com autenticação.
const rota = window.location.pathname.replace(/\/+$/, '');
const isPainelTV = rota === '/painel-tv';
const isCadastroExterno = rota === '/cadastro-externo';

// O token do cadastro sai da URL e vai para a memória ANTES de qualquer render,
// porque a primeira coisa que a tela faz é perguntar se ele existe.
//
// E some da barra de endereço em seguida: o link continua valendo (o token já
// está guardado), mas para de aparecer em print de tela, em ombro alheio e no
// histórico do navegador. Não é proteção — quem tem o link tem o token —, é
// deixar de espalhá-lo de graça.
if (isCadastroExterno) {
    const url = new URL(window.location.href);
    definirTokenCadastro(url.searchParams.get('k'));
    if (url.searchParams.has('k')) {
        url.searchParams.delete('k');
        window.history.replaceState({}, '', url.pathname + url.search + url.hash);
    }
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
