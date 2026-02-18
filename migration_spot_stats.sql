-- Migration to add spot_stats column to system_config table
-- This is required for cross-device synchronization of analytics

ALTER TABLE system_config 
ADD COLUMN IF NOT EXISTS spot_stats jsonb DEFAULT '{"simulated": 0, "converted": 0}'::jsonb;

COMMENT ON COLUMN system_config.spot_stats IS 'Spot Checker conversion analytics (session-wide/global)';
