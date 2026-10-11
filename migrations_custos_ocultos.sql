-- Migration: Custos Ocultos e Margem Real
--
-- Dois custos que saem da margem e NAO entram no preco do cliente:
--   Antecipacao = (valor total a receber do cliente) x taxa% do prazo de pagamento
--   Comissao    = (valor total a receber do cliente) x comissao%
--
-- REGRA DE OURO: nada disso entra no gross-up do frete. O valor cotado ao
-- cliente (total_freight) continua saindo da mesma equacao de sempre, e as
-- colunas real_profit / real_margin_percent continuam gravando a margem BRUTA
-- (elas alimentam o dashboard e o gate de margem do salvamento).

-- ============ 1) Parametros globais (system_config) ============
-- Mesmo padrao do margin_threshold (escalar -> coluna numerica) e do
-- icms_rates (estrutura -> JSONB chave->taxa).
ALTER TABLE system_config
ADD COLUMN IF NOT EXISTS commission_percent numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS anticipation_rates jsonb   DEFAULT '{}'::jsonb;

COMMENT ON COLUMN system_config.commission_percent IS 'Comissao padrao (%) aplicada sobre a receita total da cotacao. Editavel por cotacao. Custo interno: nao entra no preco ao cliente.';
COMMENT ON COLUMN system_config.anticipation_rates IS 'Tabela de antecipacao (JSONB): chave = prazo de pagamento em dias ("0" = a vista), valor = taxa em %. Ex.: {"0":0,"15":1.5,"30":2.8}';

-- Semeia a linha de config existente. Comissao nasce em 0 e as taxas nascem em
-- 0 de proposito: assim o antes/depois fica IDENTICO ao de hoje (margem liquida
-- = margem bruta) e os numeros reais entram pela tela de Configuracoes.
UPDATE system_config
SET commission_percent = 0
WHERE id = 'default' AND commission_percent IS NULL;

UPDATE system_config
SET anticipation_rates = '{"0":0,"15":0,"30":0,"45":0,"60":0}'::jsonb
WHERE id = 'default'
  AND (anticipation_rates IS NULL OR anticipation_rates = '{}'::jsonb);

-- ============ 2) Escolha por cotacao (freight_calculations) ============
-- Mesmo padrao do elaboration_seconds. NULL = cotacao antiga / sem escolha:
-- a tela trata como custo zero, entao reabrir uma cotacao de antes desta
-- migration mostra margem liquida = margem bruta.
ALTER TABLE freight_calculations
ADD COLUMN IF NOT EXISTS payment_term_days  numeric,
ADD COLUMN IF NOT EXISTS commission_percent numeric;

COMMENT ON COLUMN freight_calculations.payment_term_days IS 'Prazo de pagamento em dias escolhido na cotacao (0 = a vista). Resolve a taxa de antecipacao em system_config.anticipation_rates. NULL = nao informado (custo zero).';
COMMENT ON COLUMN freight_calculations.commission_percent IS 'Comissao (%) desta cotacao, partindo do padrao de system_config.commission_percent. NULL = nao informada (custo zero).';
