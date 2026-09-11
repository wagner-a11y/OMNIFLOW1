-- =====================================================================
-- DE-PARA DE PLANTA — código de origem do OTM -> cidade/UF
--
-- O PROBLEMA. Na operação Demais Plantas a carga sai da própria planta, então
-- a origem vem da planilha. Só que a coluna "ID Origem" do OTM NÃO traz cidade:
-- traz código interno, `FAB_MOG_1110`. Medido em 21 exports / 164 linhas, o
-- vocabulário inteiro é FAB_MOG_1110, FAB_MUC_2100 e FAB_ARA_6300.
--
-- Não existe normalização que transforme isso em município — a informação "que
-- cidade é essa" simplesmente não está no arquivo. Então ela vira cadastro,
-- exatamente como o código de equipamento virou: o master diz uma vez, e vale
-- para sempre.
--
-- POR QUE NÃO O "Local de Carregamento". Aquela coluna traz FBMO-FARDO e
-- FBMO-PALLET para a MESMA planta — ela mistura origem com tipo de embalagem, e
-- trataria uma planta como duas. "ID Origem" é estável por planta.
--
-- O PREFIXO fast_delivery_ é da família de tabelas da operação Suzano, não da
-- tela Fast: o de-para de equipamento também é compartilhado pelas duas telas.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.fast_delivery_planta (
    -- Como vem no "ID Origem", sem normalizar: é chave de sistema, não texto
    -- digitado por gente. Normalizar aqui esconderia um código novo que só
    -- difere por caixa — e código novo PRECISA aparecer como pendência.
    codigo_planta text PRIMARY KEY,
    cidade        text NOT NULL,
    uf            text NOT NULL,
    -- Código do IBGE. É o que amarra a cidade à base oficial e o que permite
    -- montar o "Cidade, UF" canônico que o Qualp consome. Nullable porque uma
    -- planta pode ser cadastrada antes de alguém casar com o IBGE — e cidade
    -- sem código continua servindo para mostrar a origem na tela.
    cod_ibge      integer,
    observacao    text,
    atualizado_em timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fast_delivery_planta_uf_valida CHECK (char_length(uf) = 2)
);

-- ---------------------------------------------------------------------
-- Carga inicial — SÓ o que o Wagner confirmou
--
-- Quatro plantas, confirmadas por ele em 11/09/2026. Os códigos do IBGE não
-- foram digitados de cabeça: saíram de data/municipios-ibge.json, a mesma base
-- oficial que o resto do sistema usa.
--
-- FAB_IMP_1301 entra aqui mesmo sem ter aparecido em nenhum dos 21 exports que
-- examinei — foi confirmada pelo Wagner, e é ele quem conhece a operação. O que
-- NÃO entra é palpite meu: qualquer outro código que apareça na planilha vira
-- pendência na tela, para o master classificar.
-- ---------------------------------------------------------------------
INSERT INTO public.fast_delivery_planta (codigo_planta, cidade, uf, cod_ibge, observacao) VALUES
    ('FAB_MOG_1110', 'Mogi das Cruzes', 'SP', 3530607, 'confirmada pelo Wagner em 11/09/2026'),
    ('FAB_MUC_2100', 'Mucuri',          'BA', 2922003, 'confirmada pelo Wagner em 11/09/2026'),
    ('FAB_ARA_6300', 'Aracruz',         'ES', 3200607, 'confirmada pelo Wagner em 11/09/2026'),
    ('FAB_IMP_1301', 'Imperatriz',      'MA', 2105302, 'confirmada pelo Wagner em 11/09/2026')
ON CONFLICT (codigo_planta) DO UPDATE
    SET cidade        = EXCLUDED.cidade,
        uf            = EXCLUDED.uf,
        cod_ibge      = EXCLUDED.cod_ibge,
        observacao    = EXCLUDED.observacao,
        atualizado_em = now();

-- ---------------------------------------------------------------------
-- RLS — mesmo desenho do de-para de equipamento
--
-- Todo mundo logado LÊ (o operador precisa ver a origem da carga dele), só
-- master ESCREVE. Classificar planta não é detalhe cosmético: ela define a
-- origem, e a origem define a distância e o piso ANTT. Quem responde por isso é
-- quem responde pela tabela de preço.
--
-- anon não recebe grant nenhum.
-- ---------------------------------------------------------------------
ALTER TABLE public.fast_delivery_planta ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.fast_delivery_planta FROM anon, authenticated;
GRANT SELECT ON public.fast_delivery_planta TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.fast_delivery_planta TO authenticated;

DROP POLICY IF EXISTS fd_planta_sel ON public.fast_delivery_planta;
DROP POLICY IF EXISTS fd_planta_wri ON public.fast_delivery_planta;
CREATE POLICY fd_planta_sel ON public.fast_delivery_planta FOR SELECT TO authenticated USING (true);
CREATE POLICY fd_planta_wri ON public.fast_delivery_planta FOR ALL    TO authenticated
    USING (public.is_master()) WITH CHECK (public.is_master());

-- ---------------------------------------------------------------------
-- Conferência
-- ---------------------------------------------------------------------
-- SELECT codigo_planta, cidade, uf, cod_ibge FROM public.fast_delivery_planta
--  ORDER BY codigo_planta;
-- Esperado: as quatro linhas acima.
