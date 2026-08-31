/// <reference types="vite/client" />

// Tipos do Vite para `import.meta.env`. Sem esta referência o TypeScript não
// conhece import.meta.env e acusa erro em todo lugar que lê uma VITE_*, que era
// o caso de PainelTV, RouteMap e supabase.ts.
//
// Vem do próprio Vite (node_modules/vite/client.d.ts), não é tipo inventado
// aqui: declarar à mão o que a ferramenta já declara seria arriscar divergir
// dela na próxima atualização.
