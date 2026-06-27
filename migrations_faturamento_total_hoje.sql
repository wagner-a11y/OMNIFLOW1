-- =====================================================================
-- Faturamento de HOJE no cache (painel da TV)
-- =====================================================================
-- Soma do "Total" por CTe das linhas com Emissão = hoje (BRT), calculada
-- pela Edge Function a partir do MESMO relatório do mês (sem request extra).
-- Aditivo e idempotente.
-- =====================================================================

ALTER TABLE public.faturamento_cache
    ADD COLUMN IF NOT EXISTS total_hoje numeric;
