import { createClient } from '@supabase/supabase-js';

// Credenciais PÚBLICAS do Supabase (client key — segurança é via RLS, não pelo
// segredo da chave; a anon key já vai no bundle de produção). Usadas como
// fallback p/ o app NUNCA derrubar a tela toda quando o ambiente não injeta as
// VITE_* (ex.: previews da Vercel, que só têm as vars em Production).
const FALLBACK_URL = 'https://trdkggiobsydruihvesj.supabase.co';
const FALLBACK_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRyZGtnZ2lvYnN5ZHJ1aWh2ZXNqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzNjMwNTcsImV4cCI6MjA4NDkzOTA1N30.yHzshSV2kJ5gWwAFxCDY85q6HdUcKtRKuGCX33nS144';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || FALLBACK_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || FALLBACK_ANON;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
