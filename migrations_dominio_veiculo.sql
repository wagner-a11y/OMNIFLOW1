-- =====================================================================
-- dominio_veiculo — dicionário de tradução das tabelas de domínio do Bsoft
-- =====================================================================
-- Fase 1 do Cadastro Automático de Motorista/Veículo. Guarda localmente as
-- tabelas de domínio de veículos do TMS Bsoft/Datamex (marca, categoria, grupo)
-- para traduzir, no futuro, o que for lido de um documento (ex.: "MERCEDES
-- BENZ") no código interno que a API do Bsoft espera (ex.: "9").
--
-- Espelho de dado externo: quem escreve é só a Edge Function
-- dominio-veiculo-sync, com service_role (que bypassa RLS). Analista autenticado
-- lê; ninguém mais escreve.
--
-- Isolada: não referencia nem é referenciada por nenhuma tabela existente.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.dominio_veiculo (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tipo           text        NOT NULL,   -- 'marca' | 'categoria' | 'grupo'
    codigo         text        NOT NULL,   -- id/código interno do Bsoft (ex.: "9")
    nome           text        NOT NULL,   -- nome legível (ex.: "MERCEDES BENZ")
    categoria_ref  text,                   -- só para marca: categoria associada (ex.: "CAVALO")
    atualizado_em  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT dominio_veiculo_tipo_codigo_key UNIQUE (tipo, codigo)
);

-- Vocabulário fechado: protege contra tipo inesperado vindo de um sync futuro.
ALTER TABLE public.dominio_veiculo
    DROP CONSTRAINT IF EXISTS dominio_veiculo_tipo_check;
ALTER TABLE public.dominio_veiculo
    ADD CONSTRAINT dominio_veiculo_tipo_check
    CHECK (tipo IN ('marca', 'categoria', 'grupo'));

-- A busca do dicionário é sempre "dado o tipo, ache pelo nome".
CREATE INDEX IF NOT EXISTS idx_dominio_veiculo_tipo_nome
    ON public.dominio_veiculo (tipo, nome);

COMMENT ON TABLE  public.dominio_veiculo IS
    'Espelho das tabelas de dominio de veiculos do Bsoft (marca/categoria/grupo). Escrita so pela Edge Function dominio-veiculo-sync via service_role.';
COMMENT ON COLUMN public.dominio_veiculo.codigo IS
    'Codigo interno do Bsoft — e o valor que a API espera receber de volta no cadastro.';
COMMENT ON COLUMN public.dominio_veiculo.categoria_ref IS
    'Só para tipo=marca: categoria associada a marca no Bsoft (ex.: CAVALO). Nulo nos demais tipos.';

-- ---------- Privilégios ----------
-- Explícito em vez de confiar no default privilege do Supabase.
REVOKE ALL ON public.dominio_veiculo FROM anon, authenticated;
GRANT SELECT ON public.dominio_veiculo TO authenticated;

-- ---------- RLS ----------
ALTER TABLE public.dominio_veiculo ENABLE ROW LEVEL SECURITY;

-- SELECT: todo analista autenticado lê o dicionário (é dado de referência).
DROP POLICY IF EXISTS dominio_veiculo_sel_auth ON public.dominio_veiculo;
CREATE POLICY dominio_veiculo_sel_auth ON public.dominio_veiculo FOR SELECT TO authenticated
    USING (true);

-- Sem policy de INSERT/UPDATE/DELETE: authenticated e anon não escrevem.
-- A Edge Function grava com service_role, que bypassa RLS.
