
-- Script para liberar permissão de Upload no Storage
-- Isso resolve o erro "new row violates row-level security policy"

-- 1. Permitir que qualquer pessoa envie arquivos para o bucket 'documents'
CREATE POLICY "Permitir Upload Publico"
ON storage.objects FOR INSERT
TO public
WITH CHECK (bucket_id = 'documents');

-- 2. Permitir que qualquer pessoa visualize os arquivos no bucket 'documents'
-- (Necessário mesmo se o bucket for "Public", para evitar erros de permissão no acesso)
CREATE POLICY "Permitir Visualizacao Publica"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'documents');

-- 3. (Opcional) Permitir deletar/atualizar se necessário no futuro
-- CREATE POLICY "Permitir Update Publico" ON storage.objects FOR UPDATE TO public USING (bucket_id = 'documents');
