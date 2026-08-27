-- =====================================================================
-- FAST DELIVERY — tabela de preço (Bloco 1 de 3)
--
-- Operação SUZANO FAST DELIVERY. Cada frete cruza DESTINO × TIPO DE VEÍCULO
-- para achar o valor a pagar ao terceiro. A origem é sempre GUARULHOS.
--
-- MODELO EM DUAS TABELAS, de propósito:
--   fast_delivery_destino  -> km e pedágio, que são do DESTINO
--   fast_delivery_preco    -> os três valores, que são do DESTINO × VEÍCULO
-- Numa tabela só, km e pedágio se repetiriam seis vezes por destino e nada
-- impediria que as cópias divergissem numa atualização parcial. Aqui o km mora
-- num lugar só.
--
-- Isso também deixa os tipos de veículo ABERTOS: FIORINO e TOCO já entram como
-- linha de preço, e um veículo novo não exige alterar coluna nenhuma.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Destinos
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fast_delivery_destino (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    origem           text NOT NULL DEFAULT 'GUARULHOS',
    -- Chave de casamento: sem acento, maiúsculo, sem "(2)" e sem espaço duplo.
    -- É por ela que o destino lido do Excel encontra a linha de preço.
    destino          text NOT NULL,
    -- Como veio na planilha, para conferência humana.
    destino_original text,
    km               numeric(10,2),
    pedagio          numeric(12,2),
    atualizado_em    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fast_delivery_destino_unico UNIQUE (origem, destino)
);

-- ---------------------------------------------------------------------
-- 2. Preços por destino × veículo
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fast_delivery_preco (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    destino_id    bigint NOT NULL REFERENCES public.fast_delivery_destino(id) ON DELETE CASCADE,
    tipo_veiculo  text   NOT NULL,
    -- O que a Omnicargo recebe. Na operação o valor real vem do OTM; aqui é
    -- referência e base do cálculo de margem.
    nosso_frete   numeric(12,2),
    -- O que se paga ao terceiro. É ESTE que a cotação usa.
    a_pagar       numeric(12,2),
    sobra         numeric(12,2),
    atualizado_em timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fast_delivery_preco_unico UNIQUE (destino_id, tipo_veiculo)
);

CREATE INDEX IF NOT EXISTS fast_delivery_preco_veiculo ON public.fast_delivery_preco (tipo_veiculo);

-- ---------------------------------------------------------------------
-- 3. De-para do código de equipamento do OTM
--
-- FIORINO e TOCO existem na tabela de preço mas ainda NÃO têm código do OTM.
-- Ficam de fora daqui de propósito: código desconhecido não pode virar palpite,
-- e a ausência da linha é o que faz a tela (Bloco 2) parar e perguntar.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fast_delivery_equipamento (
    codigo_otm    text PRIMARY KEY,
    tipo_veiculo  text NOT NULL,
    observacao    text,
    atualizado_em timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.fast_delivery_equipamento (codigo_otm, tipo_veiculo, observacao) VALUES
    ('10300', 'VAN',     NULL),
    ('10410', '3/4',     NULL),
    ('10710', 'TRUCK',   NULL),
    ('10920', 'CARRETA', 'dois códigos do OTM caem em CARRETA'),
    ('10910', 'CARRETA', 'dois códigos do OTM caem em CARRETA')
ON CONFLICT (codigo_otm) DO UPDATE
    SET tipo_veiculo = EXCLUDED.tipo_veiculo,
        observacao   = EXCLUDED.observacao,
        atualizado_em = now();

-- ---------------------------------------------------------------------
-- 4. Consulta pronta: destino + veículo -> a_pagar
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.fast_delivery_tabela AS
SELECT d.origem, d.destino, d.destino_original, d.km, d.pedagio,
       p.tipo_veiculo, p.nosso_frete, p.a_pagar, p.sobra
FROM public.fast_delivery_destino d
JOIN public.fast_delivery_preco   p ON p.destino_id = d.id;

-- ---------------------------------------------------------------------
-- 5. RLS
--
-- Preço é dado de negócio: todo mundo logado LÊ, só master ESCREVE. Segue o
-- mesmo desenho da chave de emergência, que já usa public.is_master().
-- anon não recebe grant nenhum.
-- ---------------------------------------------------------------------
ALTER TABLE public.fast_delivery_destino      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fast_delivery_preco        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fast_delivery_equipamento  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.fast_delivery_destino,
              public.fast_delivery_preco,
              public.fast_delivery_equipamento FROM anon, authenticated;

GRANT SELECT ON public.fast_delivery_destino,
                public.fast_delivery_preco,
                public.fast_delivery_equipamento TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.fast_delivery_destino,
                                 public.fast_delivery_preco,
                                 public.fast_delivery_equipamento TO authenticated;
GRANT SELECT ON public.fast_delivery_tabela TO authenticated;

DROP POLICY IF EXISTS fd_destino_sel ON public.fast_delivery_destino;
DROP POLICY IF EXISTS fd_destino_wri ON public.fast_delivery_destino;
CREATE POLICY fd_destino_sel ON public.fast_delivery_destino FOR SELECT TO authenticated USING (true);
CREATE POLICY fd_destino_wri ON public.fast_delivery_destino FOR ALL    TO authenticated
    USING (public.is_master()) WITH CHECK (public.is_master());

DROP POLICY IF EXISTS fd_preco_sel ON public.fast_delivery_preco;
DROP POLICY IF EXISTS fd_preco_wri ON public.fast_delivery_preco;
CREATE POLICY fd_preco_sel ON public.fast_delivery_preco FOR SELECT TO authenticated USING (true);
CREATE POLICY fd_preco_wri ON public.fast_delivery_preco FOR ALL    TO authenticated
    USING (public.is_master()) WITH CHECK (public.is_master());

DROP POLICY IF EXISTS fd_equip_sel ON public.fast_delivery_equipamento;
DROP POLICY IF EXISTS fd_equip_wri ON public.fast_delivery_equipamento;
CREATE POLICY fd_equip_sel ON public.fast_delivery_equipamento FOR SELECT TO authenticated USING (true);
CREATE POLICY fd_equip_wri ON public.fast_delivery_equipamento FOR ALL    TO authenticated
    USING (public.is_master()) WITH CHECK (public.is_master());

-- ---------------------------------------------------------------------
-- 6. Normalização do destino — a MESMA regra que o Bloco 2 vai usar ao ler o
--    Excel. Fica no banco para não existirem duas versões da regra.
--
--    "São Paulo (2)" -> "SAO PAULO"
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fast_delivery_normaliza(texto text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT btrim(regexp_replace(
        regexp_replace(
            upper(translate(coalesce(texto, ''),
                'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
                'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn')),
            '\(\s*\d+\s*\)', '', 'g'),   -- tira o "(2)" dos destinos repetidos
        '\s+', ' ', 'g'));
$$;
