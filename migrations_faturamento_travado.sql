-- Painel TV: dois números (faturamento autorizado + valor travado) e a lista de pendências.
-- Aditivo. Alimentado pela fonte API Bsoft (flag USE_BSOFT_API). Com o scraping (flag off),
-- faturamento_autorizado espelha o total, valor_travado = 0 e pendencias = [].

ALTER TABLE public.faturamento_cache
    ADD COLUMN IF NOT EXISTS faturamento_autorizado numeric,
    ADD COLUMN IF NOT EXISTS valor_travado          numeric,
    ADD COLUMN IF NOT EXISTS pendencias             jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.faturamento_cache.faturamento_autorizado IS 'Soma dos CTe AUTORIZADO (statusSefaz 100). Fonte API Bsoft; no scraping espelha total.';
COMMENT ON COLUMN public.faturamento_cache.valor_travado IS 'Soma dos CTe PENDENTE (rejeitado/não transmitido). Não entra no faturamento.';
COMMENT ON COLUMN public.faturamento_cache.pendencias IS 'Lista dos CTe travados: [{nroConhecimento, valor, statusSefaz, tomador}].';
