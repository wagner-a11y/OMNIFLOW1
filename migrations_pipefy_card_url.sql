-- Botão "Abrir card no Pipefy": persiste a URL exata do card devolvida pelo Pipefy.
-- Aditivo. Fallback do botão: https://app.pipefy.com/open-cards/<pipefy_card_id> (id já salvo).
ALTER TABLE public.freight_calculations
    ADD COLUMN IF NOT EXISTS pipefy_card_url text;
