-- =====================================================================
-- Acompanhamento de Negociações — Camada 1
-- =====================================================================
-- Módulo NOVO e isolado. Aditivo. Não toca em nenhuma tabela existente,
-- nem no Pipefy, nem no Contato Diário. Prefixo neg_.
--
-- Uma negociação entra na lista quando a cotação é enviada pro Ramper
-- (mesmo gatilho do botão "Mandar pro Ramper"). Dono = quem mandou pro Ramper.
-- Toda negociação aberta tem um "próximo contato" (date) — é o que impede o
-- esquecimento. Follow-ups guardam o histórico do que foi feito.
--
-- RLS (padrão do Contato Diário: helper public.is_master() + auth.uid()):
--   - SELECT: TODO analista autenticado lê TODAS (transparência de time).
--   - INSERT/UPDATE: só o DONO (dono_id = auth.uid()) e o MASTER.
--   - Follow-up: insere só o dono da negociação (como ele mesmo) ou o master.
--   - DELETE: só master.
-- Idempotente. A prova por simulação está em neg_rls_simulacao.sql.
-- =====================================================================

-- ---------- Tabela: negociação ----------
CREATE TABLE IF NOT EXISTS public.neg_negociacao (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cotacao_id            text NOT NULL,            -- id da cotação de origem (freight_calculations.id); sem FK dura p/ não tocar naquela tabela
    proposta_numero       text,                     -- proposalNumber, p/ exibição
    -- Snapshot p/ a lista ser acionável sem depender de join com freight_calculations:
    cliente_nome          text,
    rota                  text,                     -- "origem x destino"
    mercadoria            text,
    veiculo               text,
    valor_cotado          numeric,                  -- totalFreight da cotação
    -- Dono = quem criou a cotação e mandou pro Ramper:
    dono_id               uuid NOT NULL REFERENCES public.profiles(id),
    dono_nome             text,
    ramper_opportunity_id text,                     -- id do card devolvido pelo Ramper (base p/ auto-perdido futuro)
    aberta_em             timestamptz NOT NULL DEFAULT now(),
    status                text NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','ganha','perdida')),
    proximo_contato       date NOT NULL,            -- +1 dia útil na entrada; regroga a cada follow-up
    fechada_em            timestamptz,
    fechada_motivo        text,                     -- livre (ex.: "ganha via Ramper", "cliente fechou com concorrente")
    fechada_origem        text CHECK (fechada_origem IN ('manual','espelho_omniflow')), -- como saiu da lista
    criado_em             timestamptz NOT NULL DEFAULT now(),
    atualizado_em         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_neg_negociacao_dono    ON public.neg_negociacao (dono_id);
CREATE INDEX IF NOT EXISTS idx_neg_negociacao_status  ON public.neg_negociacao (status, proximo_contato);
CREATE INDEX IF NOT EXISTS idx_neg_negociacao_cotacao ON public.neg_negociacao (cotacao_id);
-- Uma cotação tem no máximo UMA negociação aberta (evita duplicar se reenviar pro Ramper).
CREATE UNIQUE INDEX IF NOT EXISTS uq_neg_negociacao_cotacao_aberta
    ON public.neg_negociacao (cotacao_id) WHERE status = 'aberta';

-- ---------- Tabela: follow-up ----------
CREATE TABLE IF NOT EXISTS public.neg_followup (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    negociacao_id   uuid NOT NULL REFERENCES public.neg_negociacao(id) ON DELETE CASCADE,
    autor_id        uuid NOT NULL REFERENCES public.profiles(id),
    autor_nome      text,
    data_hora       timestamptz NOT NULL DEFAULT now(),  -- carimbo do servidor
    descricao       text NOT NULL,                        -- o que foi feito
    proximo_contato date,                                 -- a próxima data que este follow-up marcou (histórico)
    criado_em       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_neg_followup_neg ON public.neg_followup (negociacao_id, data_hora DESC);

-- ---------- RLS: neg_negociacao ----------
ALTER TABLE public.neg_negociacao ENABLE ROW LEVEL SECURITY;

-- Master: tudo.
DROP POLICY IF EXISTS neg_neg_master ON public.neg_negociacao;
CREATE POLICY neg_neg_master ON public.neg_negociacao FOR ALL TO authenticated
    USING (public.is_master()) WITH CHECK (public.is_master());

-- Todos os analistas leem TODAS (transparência de time).
DROP POLICY IF EXISTS neg_neg_sel_all ON public.neg_negociacao;
CREATE POLICY neg_neg_sel_all ON public.neg_negociacao FOR SELECT TO authenticated
    USING (true);

-- Dono insere só como ele mesmo.
DROP POLICY IF EXISTS neg_neg_ins_owner ON public.neg_negociacao;
CREATE POLICY neg_neg_ins_owner ON public.neg_negociacao FOR INSERT TO authenticated
    WITH CHECK (dono_id = auth.uid());

-- Dono edita só a própria (e não pode transferir a dono a outro).
DROP POLICY IF EXISTS neg_neg_upd_owner ON public.neg_negociacao;
CREATE POLICY neg_neg_upd_owner ON public.neg_negociacao FOR UPDATE TO authenticated
    USING (dono_id = auth.uid()) WITH CHECK (dono_id = auth.uid());

-- (sem policy de DELETE p/ operador => só o master apaga, via neg_neg_master)

-- ---------- RLS: neg_followup ----------
ALTER TABLE public.neg_followup ENABLE ROW LEVEL SECURITY;

-- Master: tudo.
DROP POLICY IF EXISTS neg_fu_master ON public.neg_followup;
CREATE POLICY neg_fu_master ON public.neg_followup FOR ALL TO authenticated
    USING (public.is_master()) WITH CHECK (public.is_master());

-- Todos leem todos (transparência).
DROP POLICY IF EXISTS neg_fu_sel_all ON public.neg_followup;
CREATE POLICY neg_fu_sel_all ON public.neg_followup FOR SELECT TO authenticated
    USING (true);

-- Insere follow-up só o DONO da negociação, e só como ele mesmo.
DROP POLICY IF EXISTS neg_fu_ins_owner ON public.neg_followup;
CREATE POLICY neg_fu_ins_owner ON public.neg_followup FOR INSERT TO authenticated
    WITH CHECK (
        autor_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM public.neg_negociacao n
            WHERE n.id = neg_followup.negociacao_id
              AND n.dono_id = auth.uid()
        )
    );
