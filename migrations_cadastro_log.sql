-- =====================================================================
-- cadastro_log — rastreabilidade dos cadastros feitos pelo OmniFlow no Bsoft
-- =====================================================================
-- Fase 2 do Cadastro Automático. Uma linha por cadastro de motorista disparado
-- pela tela: quem fez, quando, qual CPF e qual codPessoa saiu no Bsoft.
--
-- Serve para responder "quem cadastrou este motorista e quando", já que o Bsoft
-- registra o usuário da API (um só), não o operador do OmniFlow.
--
-- `ja_existia` distingue cadastro novo de reaproveitamento de pessoa existente
-- — sem isso, um CPF repetido no log pareceria duplicação.
--
-- Isolada: não referencia nem é referenciada por tabela existente.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.cadastro_log (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tipo          text        NOT NULL DEFAULT 'motorista',
    cpf           text,
    nome          text,
    cod_pessoa    text,
    ja_existia    boolean     NOT NULL DEFAULT false,
    anexado       boolean     NOT NULL DEFAULT false,
    sucesso       boolean     NOT NULL DEFAULT true,
    erro          text,                       -- mensagem do Bsoft quando falhou
    criado_por      uuid REFERENCES public.profiles(id),
    criado_por_nome text,
    criado_em     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cadastro_log
    DROP CONSTRAINT IF EXISTS cadastro_log_tipo_check;
ALTER TABLE public.cadastro_log
    ADD CONSTRAINT cadastro_log_tipo_check CHECK (tipo IN ('motorista', 'veiculo'));

CREATE INDEX IF NOT EXISTS idx_cadastro_log_quando ON public.cadastro_log (criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_cadastro_log_cpf    ON public.cadastro_log (cpf);

-- ---------- Privilégios ----------
REVOKE ALL ON public.cadastro_log FROM anon, authenticated;
GRANT SELECT, INSERT ON public.cadastro_log TO authenticated;

-- ---------- RLS ----------
ALTER TABLE public.cadastro_log ENABLE ROW LEVEL SECURITY;

-- SELECT: todo analista autenticado lê (transparência de time, como nas demais).
DROP POLICY IF EXISTS cadastro_log_sel_auth ON public.cadastro_log;
CREATE POLICY cadastro_log_sel_auth ON public.cadastro_log FOR SELECT TO authenticated
    USING (true);

-- INSERT: autenticado registra, mas só EM NOME PRÓPRIO — criado_por tem que ser
-- o próprio auth.uid(). Sem isso, daria para registrar cadastro no nome de outro.
DROP POLICY IF EXISTS cadastro_log_ins_proprio ON public.cadastro_log;
CREATE POLICY cadastro_log_ins_proprio ON public.cadastro_log FOR INSERT TO authenticated
    WITH CHECK (criado_por = auth.uid());

-- Sem policy de UPDATE/DELETE: o log não se altera nem se apaga.
