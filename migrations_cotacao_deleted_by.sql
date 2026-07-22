-- Relatório de apagadas: registra QUEM mandou a cotação pra lixeira (antes só tinha deleted_at).
-- Aditivo. As cotações já na lixeira ficam com deleted_by nulo (não foi registrado na época).
ALTER TABLE public.freight_calculations
    ADD COLUMN IF NOT EXISTS deleted_by      text,
    ADD COLUMN IF NOT EXISTS deleted_by_name text;

COMMENT ON COLUMN public.freight_calculations.deleted_by IS 'Quem moveu a cotação para a lixeira (id do profiles). Nulo = apagada antes deste registro existir.';
