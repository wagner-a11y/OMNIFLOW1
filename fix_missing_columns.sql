-- HEALING MIGRATION: Ensure all required columns exist in freight_calculations
-- This script adds any missing columns to synchronize the database with the application code.

ALTER TABLE freight_calculations 
ADD COLUMN IF NOT EXISTS "other_costs" jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS "coleta_date" timestamp with time zone,
ADD COLUMN IF NOT EXISTS "entrega_date" timestamp with time zone,
ADD COLUMN IF NOT EXISTS "cliente_nome_operacao" text,
ADD COLUMN IF NOT EXISTS "referencia_cliente_operacao" text,
ADD COLUMN IF NOT EXISTS "solicitante" text,
ADD COLUMN IF NOT EXISTS "coleta_endereco" text,
ADD COLUMN IF NOT EXISTS "entrega_endereco" text,
ADD COLUMN IF NOT EXISTS "peso_carga_operacao" numeric,
ADD COLUMN IF NOT EXISTS "veiculo_tipo_operacao" text,
ADD COLUMN IF NOT EXISTS "carroceria_tipo_operacao" text,
ADD COLUMN IF NOT EXISTS "material_tipo" text,
ADD COLUMN IF NOT EXISTS "nosso_frete" numeric,
ADD COLUMN IF NOT EXISTS "frete_terceiro" numeric,
ADD COLUMN IF NOT EXISTS "valor_carga" numeric,
ADD COLUMN IF NOT EXISTS "outras_necessidades" text,
ADD COLUMN IF NOT EXISTS "observacoes_gerais" text,
ADD COLUMN IF NOT EXISTS "pipeline_stage" text DEFAULT 'Nova carga',
ADD COLUMN IF NOT EXISTS "real_profit" numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS "real_margin_percent" numeric DEFAULT 0;

-- Ensure system_config is also set up correctly for spot analytics and goals
ALTER TABLE system_config
ADD COLUMN IF NOT EXISTS "spot_stats" jsonb DEFAULT '{"simulated": 0, "converted": 0}'::jsonb,
ADD COLUMN IF NOT EXISTS "goals" jsonb DEFAULT '{}'::jsonb;
