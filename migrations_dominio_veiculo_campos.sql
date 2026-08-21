-- =====================================================================
-- dominio_veiculo — campos vindos do formato real do Bsoft
-- =====================================================================
-- Incremental sobre migrations_dominio_veiculo.sql (que continua valendo).
-- O probe revelou dois campos úteis que o formato assumido não previa:
--
--   categoria -> {id, categoria, nome_interno}
--        nome_interno é a forma minúscula ("cavalo"); pode ser o que a API do
--        Bsoft espera de volta no cadastro, em vez do rótulo de exibição.
--
--   grupo     -> {id, grupo, tipo_frota, ativo, empresa:{id, descricao, cnpj}}
--        empresa.id amarra o grupo à empresa. Guardado para o dicionário não
--        misturar grupos de empresas diferentes se houver mais de uma.
--
-- Ambas anuláveis: só se aplicam a um tipo cada, e ficam nulas nos demais.
-- Aditivas: a tabela é nova e ainda está vazia; RLS e policy inalteradas.
-- =====================================================================

ALTER TABLE public.dominio_veiculo
    ADD COLUMN IF NOT EXISTS nome_interno text;

ALTER TABLE public.dominio_veiculo
    ADD COLUMN IF NOT EXISTS empresa_id text;

COMMENT ON COLUMN public.dominio_veiculo.nome_interno IS
    'Só para tipo=categoria: nome_interno do Bsoft (ex.: "cavalo"). Nulo nos demais tipos.';
COMMENT ON COLUMN public.dominio_veiculo.empresa_id IS
    'Só para tipo=grupo: empresa.id a que o grupo pertence no Bsoft. Nulo nos demais tipos.';
