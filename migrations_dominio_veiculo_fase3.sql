-- =====================================================================
-- Fase 3A — dicionário de veículo: tipoEquipamento, tipoRodado,
-- tipoCarroceria e cor.
--
-- Aditiva. Não mexe nas 202 marcas, 19 categorias e 2 grupos da Fase 1,
-- nem nas policies: a RLS da tabela continua sendo SELECT para
-- authenticated e escrita só por service_role.
--
-- tipoRodado e tipoCarroceria NÃO vêm de endpoint: são listas fixas do
-- layout do MDF-e, então entram como seed aqui. `cor` idem, é a lista do
-- próprio Bsoft. Só tipoEquipamento é sincronizado da API.
-- =====================================================================

-- 1. O CHECK precisa aceitar o vocabulário novo antes de qualquer insert.
ALTER TABLE public.dominio_veiculo DROP CONSTRAINT IF EXISTS dominio_veiculo_tipo_check;
ALTER TABLE public.dominio_veiculo ADD CONSTRAINT dominio_veiculo_tipo_check
    CHECK (tipo IN ('marca', 'categoria', 'grupo',
                    'tipoEquipamento', 'tipoRodado', 'tipoCarroceria', 'cor'));

-- 2. tipoRodado — códigos do MDF-e, Char(2).
--    O layout também prevê '00' (Não aplicável); ficou de fora porque a
--    lista pedida começa em 01. Se precisar, é só somar a linha.
INSERT INTO public.dominio_veiculo (tipo, codigo, nome) VALUES
    ('tipoRodado', '01', 'Truck'),
    ('tipoRodado', '02', 'Toco'),
    ('tipoRodado', '03', 'Cavalo Mecanico'),
    ('tipoRodado', '04', 'VAN'),
    ('tipoRodado', '05', 'Utilitario'),
    ('tipoRodado', '06', 'Outros')
ON CONFLICT (tipo, codigo) DO UPDATE SET nome = EXCLUDED.nome, atualizado_em = now();

-- 3. tipoCarroceria — códigos do MDF-e, Char(2).
INSERT INTO public.dominio_veiculo (tipo, codigo, nome) VALUES
    ('tipoCarroceria', '00', 'Nao aplicavel'),
    ('tipoCarroceria', '01', 'Aberta'),
    ('tipoCarroceria', '02', 'Fechada/Bau'),
    ('tipoCarroceria', '03', 'Graneleira'),
    ('tipoCarroceria', '04', 'Porta Container'),
    ('tipoCarroceria', '05', 'Sider')
ON CONFLICT (tipo, codigo) DO UPDATE SET nome = EXCLUDED.nome, atualizado_em = now();

-- 4. cor — a lista do Bsoft. O código é o próprio nome: a API grava o
--    texto da cor, não um id (ver "cor": "Branca" no POST de veículo).
INSERT INTO public.dominio_veiculo (tipo, codigo, nome) VALUES
    ('cor', 'Amarelo', 'Amarelo'), ('cor', 'Azul', 'Azul'),
    ('cor', 'Bege', 'Bege'),       ('cor', 'Branco', 'Branco'),
    ('cor', 'Cinza', 'Cinza'),     ('cor', 'Dourado', 'Dourado'),
    ('cor', 'Grena', 'Grena'),     ('cor', 'Laranja', 'Laranja'),
    ('cor', 'Marrom', 'Marrom'),   ('cor', 'Prata', 'Prata'),
    ('cor', 'Preto', 'Preto'),     ('cor', 'Rosa', 'Rosa'),
    ('cor', 'Roxo', 'Roxo'),       ('cor', 'Verde', 'Verde'),
    ('cor', 'Vermelho', 'Vermelho'), ('cor', 'Fantasia', 'Fantasia')
ON CONFLICT (tipo, codigo) DO UPDATE SET nome = EXCLUDED.nome, atualizado_em = now();

-- =====================================================================
-- Ajuste validado pelo Wagner em 22/08/2026: o rodado '00' faltava.
-- Semi-reboque não tem rodado próprio, e é justamente o caso da carreta —
-- sem esta linha a tradução deixava o campo em aberto em todo reboque.
-- =====================================================================
INSERT INTO public.dominio_veiculo (tipo, codigo, nome) VALUES
    ('tipoRodado', '00', 'Nao aplicavel')
ON CONFLICT (tipo, codigo) DO UPDATE SET nome = EXCLUDED.nome, atualizado_em = now();
