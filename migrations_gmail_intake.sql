-- =====================================================================
-- ENTRADA DE COTAÇÃO POR E-MAIL — Etapa 1a (MODO SECO)
-- =====================================================================
-- A caixa cotacoes@omnicargo.com.br recebe pedido de frete o dia inteiro, e
-- alguém relê tudo à mão para digitar a cotação. A ideia é o Gemini ler o
-- e-mail (corpo, print colado e anexo) e a cotação nascer sozinha na coluna
-- "Cotações" do funil.
--
-- ESTA ETAPA NÃO CRIA COTAÇÃO NENHUMA. Ela só LÊ e registra o que o Gemini
-- entendeu, aqui nesta tabela de log, para o Wagner julgar a qualidade da
-- extração em e-mail real ANTES de qualquer coisa entrar no funil que o time
-- usa. Card só na etapa 1b, depois dessa validação.
--
-- Idempotente: seguro rodar mais de uma vez.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. O LOG — uma linha por e-mail lido.
--
-- A PK é o id da mensagem no Gmail. Isso é a trava de duplicata que não
-- depende de ninguém lembrar de conferir: reprocessar o mesmo e-mail dá
-- conflito, não segunda linha.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gmail_intake_log (
    message_id     text PRIMARY KEY,
    thread_id      text,
    remetente      text,
    assunto        text,
    recebido_em    timestamptz,
    -- O que o Gemini devolveu, cru. jsonb para dar para consultar campo a campo
    -- depois ("quantos e-mails vieram sem destino?") sem reprocessar nada.
    json_extraido  jsonb,
    -- 0..1, AUTODECLARADA pelo modelo. Não é probabilidade de nada: é o próprio
    -- Gemini dizendo o quanto se sente seguro. Serve para ordenar a revisão —
    -- e, na 1b, para decidir o que vira card sozinho e o que espera gente.
    confianca      numeric,
    -- Quantas partes foram enviadas na extração (corpo + imagens + anexos).
    partes         integer NOT NULL DEFAULT 0,
    -- Preenchido quando a leitura ou a extração falhou. Linha com erro fica
    -- registrada de propósito: e-mail que quebrou é informação, não lixo.
    erro           text,
    processado_em  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.gmail_intake_log IS
    'Um registro por e-mail lido da caixa de cotacoes. MODO SECO na etapa 1a: nada aqui cria cotacao. PK = id da mensagem no Gmail, que e a trava contra reprocessar.';
COMMENT ON COLUMN public.gmail_intake_log.confianca IS
    'Confianca 0..1 AUTODECLARADA pelo Gemini na propria extracao. Nao e probabilidade calculada.';

CREATE INDEX IF NOT EXISTS idx_gmail_intake_log_recente
    ON public.gmail_intake_log (processado_em DESC);

-- ---------------------------------------------------------------------
-- 2. A CONFIGURAÇÃO — o cutoff, e é ele que segura o histórico.
--
-- A caixa tem ~2.900 e-mails antigos. Se a função olhasse a caixa inteira,
-- o funil receberia milhares de cards de uma vez. O cutoff é o instante da
-- ativação: da 1b em diante, e-mail anterior a ele NUNCA é processado.
--
-- Mora no BANCO, não no código, por dois motivos: sobrevive a deploy, e a
-- função pode recusar-se a rodar se ele não existir (fail-closed). Linha
-- única, como o faturamento_cache.
--
-- Na 1a o cutoff é gravado mas NÃO barra nada: o backfill inicial lê de
-- propósito os e-mails mais recentes, inclusive anteriores a ele, porque é
-- disso que sai a amostra para julgar a extração. Como nada vira cotação
-- nesta etapa, ler e-mail velho é inofensivo — e necessário.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gmail_intake_config (
    id            smallint PRIMARY KEY DEFAULT 1,
    cutoff        timestamptz,
    ativo         boolean NOT NULL DEFAULT false,
    -- Teto de mensagens por rodada. Limita o estrago de qualquer engano na
    -- consulta: no pior caso, o erro custa este número de linhas, não a caixa.
    teto_rodada   integer NOT NULL DEFAULT 10,
    atualizado_em timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT gmail_intake_config_singleton CHECK (id = 1)
);

-- Nasce com o cutoff no instante da migration e INATIVO. 'ativo' é o
-- interruptor da 1b: enquanto false, nenhuma cotação é criada, mesmo que o
-- código da criação já esteja publicado.
INSERT INTO public.gmail_intake_config (id, cutoff, ativo)
VALUES (1, now(), false)
ON CONFLICT (id) DO NOTHING;

COMMENT ON COLUMN public.gmail_intake_config.cutoff IS
    'Instante da ativacao. Da etapa 1b em diante, e-mail recebido antes disto nunca vira cotacao.';
COMMENT ON COLUMN public.gmail_intake_config.ativo IS
    'false = modo seco (so log). true = pode criar cotacao. Interruptor da etapa 1b.';

-- ---------------------------------------------------------------------
-- 3. A COTAÇÃO ganha a marca da porta de entrada (para a 1b).
--
-- NÃO reusa `origem_dados`: aquela coluna diz de onde vieram os NÚMEROS
-- (contingencia = fechada sem o Qualp), que é outra pergunta. Misturar as duas
-- criaria o mesmo tipo de confusao que o 'em_operacao' ja causou no funil.
-- ---------------------------------------------------------------------
ALTER TABLE public.freight_calculations
    ADD COLUMN IF NOT EXISTS origem_entrada   text,
    ADD COLUMN IF NOT EXISTS gmail_message_id text;

COMMENT ON COLUMN public.freight_calculations.origem_entrada IS
    'Porta de entrada da cotacao: ''email'' = nasceu de e-mail lido pela gmail-intake; NULL = calculadora ou planilha.';
COMMENT ON COLUMN public.freight_calculations.gmail_message_id IS
    'Id da mensagem no Gmail que gerou esta cotacao. Serve para deduplicar e para reabrir o e-mail de origem.';

-- Trava de duplicata no BANCO: o mesmo e-mail nao vira duas cotacoes, mesmo se
-- o codigo esquecer de conferir. Parcial porque a esmagadora maioria das
-- cotacoes nao vem de e-mail e teria o campo nulo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fc_gmail_message_id
    ON public.freight_calculations (gmail_message_id)
    WHERE gmail_message_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 4. RLS — leitura para quem está logado; escrita só pela Edge Function.
--
-- Mesmo modelo de faturamento_cache e faturamento_diario: nenhuma policy de
-- escrita, porque quem grava e a funcao com service_role, que ignora RLS.
-- ---------------------------------------------------------------------
ALTER TABLE public.gmail_intake_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gmail_intake_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gil_select ON public.gmail_intake_log;
CREATE POLICY gil_select ON public.gmail_intake_log
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS gic_select ON public.gmail_intake_config;
CREATE POLICY gic_select ON public.gmail_intake_config
    FOR SELECT TO authenticated USING (true);

-- =====================================================================
-- CONFERÊNCIA — rode junto e confira a saída.
--
-- Em 25/09/2026 a faturamento_diario nasceu SEM RLS porque o ALTER nao chegou
-- a rodar, e a tabela ficou legivel pela anon key. A conferencia vem junto da
-- migration desde entao.
--
-- ESPERADO: as duas tabelas com rls_ligada = true e 1 policy cada.
-- =====================================================================
SELECT c.relname,
       c.relrowsecurity AS rls_ligada,
       (SELECT count(*) FROM pg_policies p
         WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
  FROM pg_class c
 WHERE c.oid IN ('public.gmail_intake_log'::regclass,
                 'public.gmail_intake_config'::regclass)
 ORDER BY c.relname;
