
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import PainelTV from './PainelTV';
import './index.css';

// Rota pública da TV: /painel-tv renderiza o painel SEM passar pelo App nem pelo
// login. Tudo o mais cai no App normal (com autenticação).
const isPainelTV = window.location.pathname.replace(/\/+$/, '') === '/painel-tv';

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(
        <React.StrictMode>
            {isPainelTV ? <PainelTV /> : <App />}
        </React.StrictMode>
    );
}
