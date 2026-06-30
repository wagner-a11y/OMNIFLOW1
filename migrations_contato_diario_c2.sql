-- =====================================================================
-- Controle de Contato Diário — Camada 2 (registro de contato com evidência)
-- =====================================================================
-- Aditiva. Não toca em nada existente nem no Pipefy. Prefixo cd_.
--
-- cd_contato: cada contato registrado por um analista com um solicitante da
--   carteira dele. EVIDÊNCIA OBRIGATÓRIA DE VERDADE: evidencia_path é NOT NULL
--   (não dá pra gravar registro sem arquivo, nem pela tela nem por trás).
-- Storage: bucket PRIVADO 'cd-evidencias' (arquivo real, não link).
--
-- RLS: operador registra/le SÓ os próprios contatos e só p/ solicitantes da
--   carteira dele; master vê/auditа tudo. Evidência no Storage: operador só a
--   própria pasta; master tudo. Usa public.is_master(). Idempotente.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.cd_contato (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    solicitante_id uuid NOT NULL REFERENCES public.cd_solicitante(id) ON DELETE CASCADE,
    analista_id    uuid NOT NULL REFERENCES public.profiles(id),
    data_hora      timestamptz NOT NULL DEFAULT now(),     -- carimbo do servidor
    tipo           text NOT NULL CHECK (tipo IN ('whatsapp','ligacao','email','visita','reuniao')),
    resultado      text NOT NULL CHECK (resultado IN ('sem_demanda','cotar_depois','negociacao','sem_resposta','outro')),
    observacao     text,
    evidencia_path text NOT NULL,                          -- prova OBRIGATÓRIA (objeto no Storage privado)
    criado_em      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cd_contato_analista ON public.cd_contato (analista_id, data_hora DESC);
CREATE INDEX IF NOT EXISTS idx_cd_contato_solicitante ON public.cd_contato (solicitante_id);

ALTER TABLE public.cd_contato ENABLE ROW LEVEL SECURITY;

-- Master: tudo.
DROP POLICY IF EXISTS cd_contato_master ON public.cd_contato;
CREATE POLICY cd_contato_master ON public.cd_contato FOR ALL TO authenticated
    USING (public.is_master()) WITH CHECK (public.is_master());

-- Operador: lê só os próprios registros.
DROP POLICY IF EXISTS cd_contato_op_sel ON public.cd_contato;
CREATE POLICY cd_contato_op_sel ON public.cd_contato FOR SELECT TO authenticated
    USING (analista_id = auth.uid());

-- Operador: insere só como ele mesmo E só p/ solicitante da carteira dele.
DROP POLICY IF EXISTS cd_contato_op_ins ON public.cd_contato;
CREATE POLICY cd_contato_op_ins ON public.cd_contato FOR INSERT TO authenticated
    WITH CHECK (
        analista_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM public.cd_atribuicao a
            WHERE a.solicitante_id = cd_contato.solicitante_id
              AND a.analista_id = auth.uid()
              AND a.deleted_at IS NULL
        )
    );

-- ---------- Storage: bucket PRIVADO ----------
INSERT INTO storage.buckets (id, name, public) VALUES ('cd-evidencias', 'cd-evidencias', false)
ON CONFLICT (id) DO NOTHING;

-- Caminho do arquivo: '<analista_id>/<arquivo>'. Operador só a própria pasta; master tudo.
DROP POLICY IF EXISTS cd_evid_insert ON storage.objects;
CREATE POLICY cd_evid_insert ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'cd-evidencias' AND (public.is_master() OR (storage.foldername(name))[1] = auth.uid()::text));

DROP POLICY IF EXISTS cd_evid_select ON storage.objects;
CREATE POLICY cd_evid_select ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'cd-evidencias' AND (public.is_master() OR (storage.foldername(name))[1] = auth.uid()::text));
