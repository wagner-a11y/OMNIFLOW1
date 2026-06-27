-- =====================================================================
-- Token do Painel TV — lido só por usuário logado (não vai no bundle público)
-- =====================================================================
-- O link "Painel TV" no menu precisa do token (?k=). Em vez de embutir o token
-- no JS (que é público), guardamos aqui; o app busca em runtime e monta o link.
-- RLS: SELECT só para 'authenticated' (anon não lê). Idempotente.
-- __TOKEN__ é substituído pelo token real no momento de aplicar (não versionado).
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.painel_tv_config (
    id    smallint PRIMARY KEY DEFAULT 1,
    token text NOT NULL,
    CONSTRAINT painel_tv_config_singleton CHECK (id = 1)
);

INSERT INTO public.painel_tv_config (id, token) VALUES (1, '__TOKEN__')
ON CONFLICT (id) DO UPDATE SET token = EXCLUDED.token;

ALTER TABLE public.painel_tv_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS painel_tv_config_select ON public.painel_tv_config;
CREATE POLICY painel_tv_config_select ON public.painel_tv_config
    FOR SELECT TO authenticated USING (true);
