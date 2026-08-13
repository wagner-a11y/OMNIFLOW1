-- =====================================================================
-- Chave de emergência do Qualp — estado + ledger imutável de acionamento
-- =====================================================================
-- Vem do incidente de 04/08/2026, em que o Qualp recusou toda rota e a saída
-- foi uma flag em código (MODO_CONTINGENCIA), que exigia deploy para ligar e
-- desligar. Aqui ela vira uma chave acionável pela interface, SÓ pelo master.
--
-- A trava é de SERVIDOR, não de tela: quem não é master não consegue ligar nem
-- chamando a API direto, porque a policy de UPDATE exige public.is_master().
-- Esconder o botão é conveniência; a RLS é a barreira.
--
-- Duas tabelas:
--   emergencia_config — o estado (uma linha só, semeada aqui)
--   emergencia_log    — quem ligou/desligou e quando; imutável, como a
--                       auditoria de cotação (cotacao_alteracao)
--
-- Por que um ledger novo em vez de reusar cotacao_alteracao: aquele é por
-- cotação (cotacao_id text NOT NULL) e este é um evento de sistema. Enfiar um
-- id sentinela lá poluiria a auditoria por cotação e o evento não apareceria em
-- modal nenhum. Mesmo padrão de imutabilidade, escopo diferente.
-- =====================================================================

-- ---------- Estado (uma linha só) ----------
-- id boolean PK com CHECK (id) garante no máximo uma linha: só `true` cabe.
CREATE TABLE IF NOT EXISTS public.emergencia_config (
    id                boolean PRIMARY KEY DEFAULT true CHECK (id),
    ligada            boolean     NOT NULL DEFAULT false,
    alterado_por      uuid REFERENCES public.profiles(id),
    alterado_por_nome text,
    alterado_em       timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.emergencia_config (id, ligada) VALUES (true, false)
    ON CONFLICT (id) DO NOTHING;

-- ---------- Ledger imutável de acionamento ----------
CREATE TABLE IF NOT EXISTS public.emergencia_log (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    acao       text NOT NULL CHECK (acao IN ('ligou', 'desligou')),
    autor_id   uuid NOT NULL REFERENCES public.profiles(id),
    autor_nome text,
    criado_em  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_emergencia_log_quando ON public.emergencia_log (criado_em DESC);

-- Imutabilidade: barra UPDATE e DELETE para todos, inclusive postgres.
CREATE OR REPLACE FUNCTION public.emergencia_log_imutavel()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
    RAISE EXCEPTION 'emergencia_log e imutavel: UPDATE/DELETE bloqueado';
END;
$fn$;

DROP TRIGGER IF EXISTS emergencia_log_sem_alteracao ON public.emergencia_log;
CREATE TRIGGER emergencia_log_sem_alteracao
    BEFORE UPDATE OR DELETE ON public.emergencia_log
    FOR EACH ROW EXECUTE FUNCTION public.emergencia_log_imutavel();

-- ---------- Privilégios ----------
REVOKE ALL ON public.emergencia_config FROM anon, authenticated;
REVOKE ALL ON public.emergencia_log    FROM anon, authenticated;
GRANT SELECT, UPDATE ON public.emergencia_config TO authenticated;  -- RLS filtra quem escreve
GRANT SELECT, INSERT ON public.emergencia_log    TO authenticated;

-- ---------- RLS ----------
ALTER TABLE public.emergencia_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emergencia_log    ENABLE ROW LEVEL SECURITY;

-- emergencia_config
-- SELECT: todo analista autenticado precisa saber se a chave está ligada — é o
-- que faz o banner amarelo aparecer na tela dele.
DROP POLICY IF EXISTS emerg_cfg_sel_auth ON public.emergencia_config;
CREATE POLICY emerg_cfg_sel_auth ON public.emergencia_config FOR SELECT TO authenticated
    USING (true);

-- UPDATE: SÓ MASTER. Esta é a trava real da funcionalidade.
DROP POLICY IF EXISTS emerg_cfg_upd_master ON public.emergencia_config;
CREATE POLICY emerg_cfg_upd_master ON public.emergencia_config FOR UPDATE TO authenticated
    USING (public.is_master()) WITH CHECK (public.is_master());

-- Sem policy de INSERT/DELETE: a linha é única e foi semeada aqui. Ninguém
-- cria uma segunda nem apaga a que existe.

-- emergencia_log
-- SELECT: só master, como a auditoria de cotação.
DROP POLICY IF EXISTS emerg_log_sel_master ON public.emergencia_log;
CREATE POLICY emerg_log_sel_master ON public.emergencia_log FOR SELECT TO authenticated
    USING (public.is_master());

-- INSERT: só master, e só em nome de si mesmo (autor_id = auth.uid() barra
-- registrar acionamento no nome de outra pessoa).
DROP POLICY IF EXISTS emerg_log_ins_master ON public.emergencia_log;
CREATE POLICY emerg_log_ins_master ON public.emergencia_log FOR INSERT TO authenticated
    WITH CHECK (public.is_master() AND autor_id = auth.uid());

-- Sem policy de UPDATE/DELETE, e o trigger acima barra até o superuser.
