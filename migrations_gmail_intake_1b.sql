-- =====================================================================
-- ENTRADA POR E-MAIL — Etapa 1b: o que falta para o e-mail virar card
-- =====================================================================
-- A 1a já criou gmail_intake_log, gmail_intake_config e, em
-- freight_calculations, origem_entrada + gmail_message_id com o índice único.
-- Aqui entram só as duas colunas que a criação do card usa.
--
-- ATENÇÃO: aplicar esta migration NÃO liga nada. A criação depende do
-- interruptor gmail_intake_config.ativo, que continua false. Ligar é um UPDATE
-- separado, feito de propósito na hora da virada.
--
-- Idempotente.
-- =====================================================================

-- Confiança que o modelo declarou na extração que gerou este card. Guardada na
-- COTAÇÃO (e não só no log) para o funil marcar "confira" sem precisar cruzar
-- duas tabelas a cada render do board.
ALTER TABLE public.freight_calculations
    ADD COLUMN IF NOT EXISTS gmail_confianca numeric;

COMMENT ON COLUMN public.freight_calculations.gmail_confianca IS
    'Confianca 0..1 AUTODECLARADA pelo Gemini na extracao que gerou esta cotacao. Baixa confianca NAO impede o card: ele nasce marcado para conferencia. NULL = nao veio de e-mail.';

-- O log passa a registrar se aquele e-mail virou card, e qual. É o rastro que
-- liga os dois lados quando alguém perguntar "de onde saiu esta cotação?".
ALTER TABLE public.gmail_intake_log
    ADD COLUMN IF NOT EXISTS cotacao_criada boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS cotacao_numero text;

COMMENT ON COLUMN public.gmail_intake_log.cotacao_criada IS
    'true = este e-mail virou cotacao. false = modo seco, nao era cotacao, ou anterior ao cutoff.';

-- =====================================================================
-- A VIRADA (não roda agora — é o passo manual do rollout, com o Wagner junto).
--
-- Ligar é UM update. O cutoff vai para o instante da virada, e é ele que
-- garante que os 30 e-mails já lidos e os ~2.900 históricos NUNCA virem card:
-- todos são anteriores a agora.
--
--   UPDATE public.gmail_intake_config
--      SET ativo = true, cutoff = now(), teto_rodada = 5, atualizado_em = now()
--    WHERE id = 1;
--
-- DESLIGAR é o mesmo update com ativo = false. Vale na rodada seguinte, sem
-- deploy, sem rollback de código:
--
--   UPDATE public.gmail_intake_config SET ativo = false, atualizado_em = now() WHERE id = 1;
-- =====================================================================

-- CONFERÊNCIA (só leitura): o interruptor tem de estar FALSE depois desta migration.
SELECT ativo, cutoff, teto_rodada FROM public.gmail_intake_config WHERE id = 1;
