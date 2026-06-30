-- =====================================================================
-- Controle de Contato Diário — Camada 1 (carteira)
-- =====================================================================
-- Módulo NOVO e isolado. Não toca em nenhuma tabela existente, nem no Pipefy.
-- Prefixo cd_ (Contato Diário).
--
-- cd_solicitante: cadastro CANÔNICO (uma linha por pessoa de verdade). Guarda
--   as variações de nome (aliases) como aparecem nas cotações, p/ o cruzamento
--   futuro reconhecer todas, e o solicitante_pipefy_id quando existir.
-- cd_atribuicao: liga um solicitante canônico a um analista (operador).
--
-- RLS: gestor (master) gerencia tudo; analista (operador) só LÊ a carteira dele
--   (atribuição onde analista_id = auth.uid()), nunca a dos outros nem gestão.
-- Usa o helper public.is_master() já existente. Idempotente. Soft delete.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.cd_solicitante (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nome_canonico         text NOT NULL,
    solicitante_pipefy_id text,
    aliases               text[] NOT NULL DEFAULT '{}',  -- variações de nome conhecidas (das cotações)
    deleted_at            timestamptz,
    criado_por            uuid,
    criado_em             timestamptz NOT NULL DEFAULT now(),
    atualizado_em         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cd_solicitante_aliases ON public.cd_solicitante USING gin (aliases);

CREATE TABLE IF NOT EXISTS public.cd_atribuicao (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    solicitante_id uuid NOT NULL REFERENCES public.cd_solicitante(id) ON DELETE CASCADE,
    analista_id   uuid NOT NULL REFERENCES public.profiles(id),
    observacao    text,
    deleted_at    timestamptz,
    criado_por    uuid,
    criado_em     timestamptz NOT NULL DEFAULT now(),
    atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cd_atribuicao_analista ON public.cd_atribuicao (analista_id);
-- Um solicitante pertence a no máximo uma carteira ativa.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cd_atribuicao_solicitante ON public.cd_atribuicao (solicitante_id) WHERE deleted_at IS NULL;

-- ---------- RLS ----------
ALTER TABLE public.cd_solicitante ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cd_atribuicao  ENABLE ROW LEVEL SECURITY;

-- cd_solicitante: master tudo; operador só LÊ os solicitantes da carteira dele.
DROP POLICY IF EXISTS cd_sol_master ON public.cd_solicitante;
CREATE POLICY cd_sol_master ON public.cd_solicitante FOR ALL TO authenticated
    USING (public.is_master()) WITH CHECK (public.is_master());

DROP POLICY IF EXISTS cd_sol_operador_sel ON public.cd_solicitante;
CREATE POLICY cd_sol_operador_sel ON public.cd_solicitante FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.cd_atribuicao a
        WHERE a.solicitante_id = cd_solicitante.id
          AND a.analista_id = auth.uid()
          AND a.deleted_at IS NULL
    ));

-- cd_atribuicao: master tudo; operador só LÊ as atribuições dele.
DROP POLICY IF EXISTS cd_atr_master ON public.cd_atribuicao;
CREATE POLICY cd_atr_master ON public.cd_atribuicao FOR ALL TO authenticated
    USING (public.is_master()) WITH CHECK (public.is_master());

DROP POLICY IF EXISTS cd_atr_operador_sel ON public.cd_atribuicao;
CREATE POLICY cd_atr_operador_sel ON public.cd_atribuicao FOR SELECT TO authenticated
    USING (analista_id = auth.uid());
