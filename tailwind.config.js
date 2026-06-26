
/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        // Inclui TODOS os .tsx/.ts da raiz (App.tsx, PainelTV.tsx, index.tsx…).
        // Antes só listava App.tsx, então as classes do PainelTV não eram geradas
        // (fundo do gradiente sumia -> texto branco em fundo branco).
        "./*.{js,ts,jsx,tsx}",
        "./components/**/*.{js,ts,jsx,tsx}",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {},
    },
    plugins: [],
}
