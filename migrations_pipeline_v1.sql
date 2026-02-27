-- Migration to add fields for operation pipeline and monitoring
ALTER TABLE freight_calculations 
ADD COLUMN IF NOT EXISTS coleta_date timestamp with time zone,
ADD COLUMN IF NOT EXISTS entrega_date timestamp with time zone,
ADD COLUMN IF NOT EXISTS cliente_nome_operacao text,
ADD COLUMN IF NOT EXISTS referencia_cliente_operacao text,
ADD COLUMN IF NOT EXISTS solicitante text,
ADD COLUMN IF NOT EXISTS coleta_endereco text,
ADD COLUMN IF NOT EXISTS entrega_endereco text,
ADD COLUMN IF NOT EXISTS peso_carga_operacao numeric,
ADD COLUMN IF NOT EXISTS veiculo_tipo_operacao text,
ADD COLUMN IF NOT EXISTS carroceria_tipo_operacao text,
ADD COLUMN IF NOT EXISTS material_tipo text,
ADD COLUMN IF NOT EXISTS nosso_frete numeric,
ADD COLUMN IF NOT EXISTS frete_terceiro numeric,
ADD COLUMN IF NOT EXISTS valor_carga numeric,
ADD COLUMN IF NOT EXISTS outras_necessidades text,
ADD COLUMN IF NOT EXISTS observacoes_gerais text,
ADD COLUMN IF NOT EXISTS pipeline_stage text DEFAULT 'Nova carga';

COMMENT ON COLUMN freight_calculations.pipeline_stage IS 'Pipeline stage for operations and monitoring';
