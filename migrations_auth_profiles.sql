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

-- A tabela já está com RLS ligada. Política MÍNIMA para a Etapa A:
-- usuários AUTENTICADOS leem os perfis (anon continua bloqueado).
-- A trava fina por papel (operador só o próprio, master tudo) entra na Etapa D.
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated" on public.profiles
  for select to authenticated using (true);
