-- =====================================================================
-- Lixeira de Cotações (soft delete) — freight_calculations
-- =====================================================================
-- Aditivo e reversível: adiciona apenas a coluna deleted_at (sem tocar
-- em dados existentes). Idempotente — seguro rodar mais de uma vez.
--
-- Semântica:
--   deleted_at IS NULL  -> cotação ativa (aparece no Histórico)
--   deleted_at NOT NULL -> cotação na lixeira (mantém o timestamp de quando
--                          foi movida pra lá; usado pela limpeza automática)
--
-- Reverter, se necessário:
--   DROP INDEX IF EXISTS idx_freight_calculations_deleted_at;
--   ALTER TABLE public.freight_calculations DROP COLUMN IF EXISTS deleted_at;
-- =====================================================================

ALTER TABLE public.freight_calculations
    ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Índice parcial: acelera o filtro do Histórico (deleted_at IS NULL),
-- que é a leitura mais frequente.
CREATE INDEX IF NOT EXISTS idx_freight_calculations_deleted_at
    ON public.freight_calculations (deleted_at)
    WHERE deleted_at IS NOT NULL;
