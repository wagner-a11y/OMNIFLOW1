
-- Add goals column to system_config
ALTER TABLE system_config 
ADD COLUMN IF NOT EXISTS goals jsonb DEFAULT '{}'::jsonb;

COMMENT ON COLUMN system_config.goals IS 'Monthly financial goals (JSONB: {"2024-01": 50000, ...})';
