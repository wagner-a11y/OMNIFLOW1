-- =====================================================================
-- FAST DELIVERY — capacidade em m³ por tipo de veículo, e o limiar do alerta.
--
-- Serve a uma pergunta só: a carga cabe no veículo que veio na planilha? O
-- alerta é AVISO, nunca bloqueio — quem conhece a carga é o operador, e há
-- carga que passa do cálculo e entra assim mesmo.
--
-- DUAS TABELAS, de propósito. A capacidade é do VEÍCULO; o limiar é da REGRA,
-- e vale para todos. Repetir o limiar em cada linha de capacidade convidaria à
-- divergência numa atualização parcial — o mesmo motivo pelo qual km e pedágio
-- moram no destino e não em cada preço.
--
-- Nada aqui é constante em código: mudar a capacidade de um veículo ou afrouxar
-- o limiar é UPDATE, sem deploy.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Capacidade por tipo de veículo
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fast_delivery_capacidade (
    tipo_veiculo  text PRIMARY KEY,
    -- Metros cúbicos úteis. numeric, não int: FIORINO é 3,3.
    capacidade_m3 numeric(10,2) NOT NULL CHECK (capacidade_m3 > 0),
    observacao    text,
    atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- Valores informados pelo Wagner em 29/08/2026.
INSERT INTO public.fast_delivery_capacidade (tipo_veiculo, capacidade_m3) VALUES
    ('FIORINO',   3.3),
    ('VAN',       9),
    ('3/4',      25),
    ('TOCO',     43),
    ('TRUCK',    60),
    ('CARRETA', 103)
ON CONFLICT (tipo_veiculo) DO UPDATE
    SET capacidade_m3 = EXCLUDED.capacidade_m3,
        atualizado_em = now();

-- ---------------------------------------------------------------------
-- 2. Parâmetros da operação — chave/valor numérico
--
-- Fica separado da capacidade porque é regra, não medida de veículo. Tabela
-- chave/valor para não precisar de DDL toda vez que aparecer um parâmetro novo.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fast_delivery_config (
    chave         text PRIMARY KEY,
    valor         numeric NOT NULL,
    descricao     text,
    atualizado_em timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.fast_delivery_config (chave, valor, descricao) VALUES
    ('limiar_volume_alerta', 0.90,
     'Fração da capacidade do veículo a partir da qual a linha ganha alerta de volume. 0.90 = avisa acima de 90%. Alerta, não bloqueio.')
ON CONFLICT (chave) DO NOTHING;   -- não sobrescreve um limiar já ajustado

-- ---------------------------------------------------------------------
-- 3. RLS — mesmo desenho das outras fast_delivery_*:
--    todo mundo logado LÊ, só master ESCREVE. anon não recebe nada.
-- ---------------------------------------------------------------------
ALTER TABLE public.fast_delivery_capacidade ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fast_delivery_config     ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.fast_delivery_capacidade, public.fast_delivery_config FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
    ON public.fast_delivery_capacidade, public.fast_delivery_config TO authenticated;

DROP POLICY IF EXISTS fd_cap_sel ON public.fast_delivery_capacidade;
DROP POLICY IF EXISTS fd_cap_wri ON public.fast_delivery_capacidade;
CREATE POLICY fd_cap_sel ON public.fast_delivery_capacidade FOR SELECT TO authenticated USING (true);
CREATE POLICY fd_cap_wri ON public.fast_delivery_capacidade FOR ALL    TO authenticated
    USING (public.is_master()) WITH CHECK (public.is_master());

DROP POLICY IF EXISTS fd_cfg_sel ON public.fast_delivery_config;
DROP POLICY IF EXISTS fd_cfg_wri ON public.fast_delivery_config;
CREATE POLICY fd_cfg_sel ON public.fast_delivery_config FOR SELECT TO authenticated USING (true);
CREATE POLICY fd_cfg_wri ON public.fast_delivery_config FOR ALL    TO authenticated
    USING (public.is_master()) WITH CHECK (public.is_master());
