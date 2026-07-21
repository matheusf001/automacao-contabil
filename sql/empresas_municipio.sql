-- ============================================================
-- EMPRESAS: município e UF (preenchidos pela busca de CNPJ)
-- Rode este script inteiro no Supabase: SQL Editor > New query
-- Ordem: depois de folha_config.sql
--
-- Sem alteração de segurança: as políticas RLS existentes da
-- tabela empresas continuam valendo para as colunas novas.
-- ============================================================

alter table empresas add column if not exists municipio text;
alter table empresas add column if not exists uf text;
