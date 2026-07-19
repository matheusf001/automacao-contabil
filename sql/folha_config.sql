-- ============================================================
-- FOLHA DE PAGAMENTO — Fase 2 (contas contábeis dos pagamentos)
-- Rode este script inteiro no Supabase: SQL Editor > New query
-- Ordem: depois de folha_pagamento.sql
--
-- Uma linha por empresa: em qual conta contábil entra o pagamento
-- de salário, férias, rescisão e 13º reconhecido no extrato bancário.
-- Sem esta configuração o site ainda reconhece o funcionário (mostra
-- o selo e avisa a IA), só não classifica sozinho.
-- ============================================================

create table if not exists folha_config (
  empresa_id uuid primary key references empresas(id) on delete cascade,
  conta_salario integer,     -- ex: Salários a Pagar
  conta_ferias integer,      -- ex: Férias a Pagar (vazio = usa a de salário)
  conta_rescisao integer,    -- ex: Rescisões a Pagar (vazio = usa a de salário)
  conta_decimo integer,      -- ex: 13º a Pagar (vazio = usa a de salário)
  atualizado_em timestamptz default now()
);

alter table folha_config enable row level security;

drop policy if exists "folha_config_auth_all" on folha_config;
create policy "folha_config_auth_all" on folha_config
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "acesso_empresa_folha_config" on folha_config;
create policy "acesso_empresa_folha_config" on folha_config
  as restrictive for all using (tem_acesso_empresa(empresa_id)) with check (tem_acesso_empresa(empresa_id));

-- configurar contas é decisão contábil: escrita só para admin
drop policy if exists "folha_config_insert_admin" on folha_config;
create policy "folha_config_insert_admin" on folha_config
  as restrictive for insert with check (eh_admin());
drop policy if exists "folha_config_update_admin" on folha_config;
create policy "folha_config_update_admin" on folha_config
  as restrictive for update using (eh_admin()) with check (eh_admin());
drop policy if exists "folha_config_delete_admin" on folha_config;
create policy "folha_config_delete_admin" on folha_config
  as restrictive for delete using (eh_admin());
