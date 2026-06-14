-- Gestão de usuários: status ativo + obrigar troca de senha no 1º acesso. Aditivo; não mexe no RLS
-- das outras tabelas. profiles continua com SELECT liberado p/ authenticated; escrita é via Edge
-- Function (service role).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
