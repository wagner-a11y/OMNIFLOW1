-- =====================================================================
-- Mini CRM (Prospecção) — Omnicargo · Fase 1 (fundação)
-- =====================================================================
-- Módulo NOVO e independente do CRMBoard antigo (que era sobre cotações).
-- Tabelas: crm_empresa (card), crm_contato (pessoa), crm_evento (timeline).
-- RLS: só master por enquanto (decisão Fase 1); fácil relaxar p/ o time depois.
-- Soft delete via deleted_at. Idempotente.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.crm_empresa (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nome          text NOT NULL,
    chave_grupo   text NOT NULL,              -- chave normalizada de dedupe (regra 5.4)
    etapa         text NOT NULL DEFAULT 'Contato inicial',
    proximo_passo text,
    responsavel   text,
    last_touch    date,                       -- maior data de contato (regra 5.5)
    deleted_at    timestamptz,
    criado_em     timestamptz NOT NULL DEFAULT now(),
    atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_empresa_chave ON public.crm_empresa (chave_grupo);
CREATE INDEX IF NOT EXISTS idx_crm_empresa_etapa ON public.crm_empresa (etapa);

CREATE TABLE IF NOT EXISTS public.crm_contato (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id    uuid NOT NULL REFERENCES public.crm_empresa(id) ON DELETE CASCADE,
    nome          text,
    cargo         text,
    email         text,
    telefone      text,
    canal         text,
    origem        text NOT NULL DEFAULT 'Omnicargo',  -- 'Optus' | 'Omnicargo'
    status        text NOT NULL DEFAULT 'Novo',
    data          date,
    codigo        text,                        -- código de campanha "MC DC - XXXX-26"
    evidencia     text,                        -- link da prova
    print_ref     text,                        -- referência do print no storage
    resumo_ultimo text,
    deleted_at    timestamptz,
    criado_em     timestamptz NOT NULL DEFAULT now(),
    atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_contato_empresa ON public.crm_contato (empresa_id);

CREATE TABLE IF NOT EXISTS public.crm_evento (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id  uuid NOT NULL REFERENCES public.crm_empresa(id) ON DELETE CASCADE,
    tipo        text NOT NULL,                 -- contato|nota|movimentacao|evidencia|ia
    data        timestamptz NOT NULL DEFAULT now(),
    autor       uuid,                          -- profiles.id
    autor_nome  text,
    texto       text,
    link        text
);
CREATE INDEX IF NOT EXISTS idx_crm_evento_empresa ON public.crm_evento (empresa_id, data DESC);

-- RLS — só master (Fase 1). Usa o helper public.is_master() já existente.
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['crm_empresa','crm_contato','crm_evento'] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS %I_all ON public.%I', t, t);
        EXECUTE format($p$CREATE POLICY %I_all ON public.%I FOR ALL TO authenticated USING (public.is_master()) WITH CHECK (public.is_master())$p$, t, t);
    END LOOP;
END $$;
