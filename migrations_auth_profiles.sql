-- ============================================================
-- Etapa A — Supabase Auth: tabela de perfis ligada ao auth.users
-- Rodar no SQL Editor do projeto trdkggiobsydruihvesj.
-- RLS NÃO é ligada aqui (vem na Etapa D, por último, conforme combinado).
-- ============================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  email text not null default '',
  role text not null default 'operador' check (role in ('master','operador')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'Perfil/papel do usuário, vinculado ao Supabase Auth (auth.users).';
