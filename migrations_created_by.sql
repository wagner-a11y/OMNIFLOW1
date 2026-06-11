-- ============================================================
-- Etapa C — Autoria imutável da cotação
-- created_by / created_by_name: gravados na criação e nunca sobrescritos.
-- Rodar no SQL Editor do projeto trdkggiobsydruihvesj.
-- ============================================================

alter table public.freight_calculations
  add column if not exists created_by text,
  add column if not exists created_by_name text;

-- Backfill (melhor esforço): para cotações antigas, usa o último editor como criador.
update public.freight_calculations
   set created_by = coalesce(created_by, updated_by),
       created_by_name = coalesce(created_by_name, updated_by_name)
 where created_by is null;
