-- ============================================================
-- REGRAS COM CONTA POR DIREÇÃO (entradas x saídas)
-- Rode no Supabase: SQL Editor > New query
-- Permite que a mesma palavra-chave use uma conta quando é
-- PAGAMENTO (saída) e outra quando é RECEBIMENTO (entrada).
-- Caso clássico: empresas do grupo (controladas/coligadas) e
-- sócios (retirada no ativo x pró-labore no passivo).
-- ============================================================
alter table regras add column if not exists codigo_recebimento integer;
