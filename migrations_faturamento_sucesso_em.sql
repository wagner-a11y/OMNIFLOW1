-- Painel TV: hora da última coleta BEM-SUCEDIDA (separada da última tentativa).
-- Aditivo. atualizado_em = última tentativa (ok OU erro); sucesso_em = último 'ok'.
-- A TV usa sucesso_em pra exibir a hora e pra sinalizar "desatualizado" (>15 min
-- sem sucesso, ou status=erro). Painel congelado mostrando número velho como se
-- fosse atual é pior que painel errado — por isso o sinal visual é obrigatório.

ALTER TABLE public.faturamento_cache
    ADD COLUMN IF NOT EXISTS sucesso_em timestamptz;

COMMENT ON COLUMN public.faturamento_cache.sucesso_em IS
    'Timestamp da última coleta bem-sucedida (status ok). A TV sinaliza desatualizado se passar de 15 min sem sucesso ou se a última tentativa falhar.';
