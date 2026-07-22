-- Auditoria de alterações de cotação (Parte C). LEDGER APPEND-ONLY E IMUTÁVEL.
-- Captura é no app (saveQuote), só em edição de cotação existente. Guarda o diff
-- (antes/depois) dos campos de negócio, quem alterou e quando.
--
-- IMUTABILIDADE (requisito): ninguém altera nem apaga um registro depois de criado.
--   - RLS: só master LÊ; insert é como o próprio usuário (alterado_por = auth.uid());
--     NÃO existe policy de UPDATE/DELETE -> negado p/ authenticated/anon (via API).
--   - Trigger BEFORE UPDATE/DELETE: RAISE -> bloqueia ATÉ superuser/service_role.
--   Provado em cotacao_alteracao_simulacao.sql.

CREATE TABLE IF NOT EXISTS public.cotacao_alteracao (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cotacao_id        text NOT NULL,                 -- freight_calculations.id
    proposta_numero   text,
    alterado_por      uuid NOT NULL,                 -- profiles.id (auth.uid()) de quem salvou
    alterado_por_nome text,
    alterado_em       timestamptz NOT NULL DEFAULT now(),
    status_no_momento text,                          -- status da cotação no momento (destaca edição de Ganha)
    mudancas          jsonb NOT NULL                 -- [{campo, label, de, para}]
);
CREATE INDEX IF NOT EXISTS idx_cotacao_alteracao_cotacao ON public.cotacao_alteracao (cotacao_id, alterado_em DESC);

-- ---------- Imutabilidade: trigger que barra UPDATE e DELETE (todos os papéis) ----------
CREATE OR REPLACE FUNCTION public.bloqueia_alteracao_auditoria()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'cotacao_alteracao e imutavel: % nao permitido', TG_OP;
END;
$$;
DROP TRIGGER IF EXISTS trg_cotacao_alteracao_imutavel ON public.cotacao_alteracao;
CREATE TRIGGER trg_cotacao_alteracao_imutavel
    BEFORE UPDATE OR DELETE ON public.cotacao_alteracao
    FOR EACH ROW EXECUTE FUNCTION public.bloqueia_alteracao_auditoria();

-- ---------- RLS ----------
ALTER TABLE public.cotacao_alteracao ENABLE ROW LEVEL SECURITY;

-- SELECT: só master.
DROP POLICY IF EXISTS ca_select_master ON public.cotacao_alteracao;
CREATE POLICY ca_select_master ON public.cotacao_alteracao FOR SELECT TO authenticated
    USING (public.is_master());

-- INSERT: autenticado, e só como ele mesmo (não dá pra forjar autor).
DROP POLICY IF EXISTS ca_insert_self ON public.cotacao_alteracao;
CREATE POLICY ca_insert_self ON public.cotacao_alteracao FOR INSERT TO authenticated
    WITH CHECK (alterado_por = auth.uid());

-- (SEM policy de UPDATE/DELETE -> ninguém altera/apaga via API; o trigger reforça até superuser.)
