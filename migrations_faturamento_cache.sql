-- =====================================================================
-- Faturamento do mês (TMS) — cache lido pelo painel
-- =====================================================================
-- A Edge Function datamex-relatorio raspa o total no TMS e grava aqui.
-- O painel lê desta tabela via realtime (não bate no TMS a cada visita).
-- Linha única (id = 1): sempre o valor mais recente.
-- Idempotente — seguro rodar mais de uma vez.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.faturamento_cache (
    id            smallint PRIMARY KEY DEFAULT 1,
    total         numeric,
    ctes          integer,
    status        text NOT NULL DEFAULT 'ok',   -- 'ok' | 'erro'
    erro          text,
    atualizado_em timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT faturamento_cache_singleton CHECK (id = 1)
);

-- Garante a linha única.
INSERT INTO public.faturamento_cache (id, status) VALUES (1, 'ok')
ON CONFLICT (id) DO NOTHING;

-- RLS: qualquer usuário autenticado pode LER. Escrita só pela Edge Function
-- (service_role, que ignora RLS) — nenhuma policy de insert/update p/ o cliente.
ALTER TABLE public.faturamento_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS faturamento_cache_select ON public.faturamento_cache;
CREATE POLICY faturamento_cache_select ON public.faturamento_cache
    FOR SELECT TO authenticated USING (true);

-- Realtime: publica a tabela para o painel receber updates ao vivo.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'faturamento_cache'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.faturamento_cache;
    END IF;
END $$;
