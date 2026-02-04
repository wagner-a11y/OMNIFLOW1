-- Migration to add Real Margin columns to freight_calculations table

ALTER TABLE freight_calculations 
ADD COLUMN IF NOT EXISTS real_profit numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS real_margin_percent numeric DEFAULT 0;

COMMENT ON COLUMN freight_calculations.real_profit IS 'Author: Wagner - Added for auditing real profit values';
COMMENT ON COLUMN freight_calculations.real_margin_percent IS 'Author: Wagner - Added for auditing real margin percentage';
