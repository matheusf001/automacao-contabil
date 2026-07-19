-- ============================================================
-- FOLHA DE PAGAMENTO — Fase 1 (funcionários + folhas importadas)
-- Rode este script inteiro no Supabase: SQL Editor > New query
-- Ordem: depois de todos os anteriores (o último foi
--        travas_papeis_e_layouts.sql)
--
-- O site lê o PDF da folha (Relatório de Líquidos / Extrato Mensal),
-- mostra pra conferência e grava aqui. Esses dados servem para:
--  1. reconhecer no extrato bancário os pagamentos feitos a cada
--     funcionário (nome + valor líquido), inclusive férias/rescisão;
--  2. reconhecer pagamentos consolidados (ex. SISPAG) pelo total;
--  3. futuramente, gerar os lançamentos contábeis da folha pro Domínio.
-- ============================================================

-- 1) Funcionários de cada empresa (alimentado pelos PDFs da folha)
create table if not exists funcionarios (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references empresas(id) on delete cascade,
  codigo integer not null,              -- código do empregado no sistema de folha
  nome text not null,
  cpf text,
  identidade text,
  cargo text,
  ativo boolean not null default true,
  criado_em timestamptz default now(),
  unique (empresa_id, codigo)
);
create index if not exists idx_funcionarios_empresa on funcionarios(empresa_id);

-- 2) Cada PDF de folha importado (cabeçalho)
create table if not exists folhas (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references empresas(id) on delete cascade,
  competencia text not null,            -- ex: '06/2026'
  tipo_calculo text,                    -- ex: 'Folha Mensal', 'Rescisão', '13º Salário'
  origem text not null,                 -- 'liquidos' | 'extrato_mensal'
  total_liquido numeric(14,2),
  qtd_funcionarios integer,
  arquivo_nome text,
  criado_por text,
  criado_em timestamptz default now()
);
create index if not exists idx_folhas_empresa on folhas(empresa_id);

-- 3) Valores de cada funcionário dentro de uma folha
create table if not exists folha_itens (
  id bigint generated always as identity primary key,
  folha_id bigint not null references folhas(id) on delete cascade,
  empresa_id uuid not null references empresas(id) on delete cascade,
  funcionario_id bigint references funcionarios(id) on delete set null,
  codigo_funcionario integer,
  nome text not null,
  valor_liquido numeric(14,2) not null,
  data_pagamento date,                  -- só o Relatório de Líquidos informa
  proventos numeric(14,2),              -- só o Extrato Mensal informa
  descontos numeric(14,2),
  observacao text                       -- ex: 'Férias de 01/06/2026 a 20/06/2026'
);
create index if not exists idx_folha_itens_folha on folha_itens(folha_id);
create index if not exists idx_folha_itens_empresa on folha_itens(empresa_id);

-- 4) Segurança (mesmo padrão das outras tabelas por empresa):
--    permissiva "logado pode" + RESTRITIVA "só quem tem acesso à empresa".
--    Operador PODE gravar (importar a folha é tarefa do dia a dia,
--    como processar extrato).
alter table funcionarios enable row level security;
alter table folhas enable row level security;
alter table folha_itens enable row level security;

drop policy if exists "funcionarios_auth_all" on funcionarios;
create policy "funcionarios_auth_all" on funcionarios
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
drop policy if exists "acesso_empresa_funcionarios" on funcionarios;
create policy "acesso_empresa_funcionarios" on funcionarios
  as restrictive for all using (tem_acesso_empresa(empresa_id)) with check (tem_acesso_empresa(empresa_id));

drop policy if exists "folhas_auth_all" on folhas;
create policy "folhas_auth_all" on folhas
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
drop policy if exists "acesso_empresa_folhas" on folhas;
create policy "acesso_empresa_folhas" on folhas
  as restrictive for all using (tem_acesso_empresa(empresa_id)) with check (tem_acesso_empresa(empresa_id));

drop policy if exists "folha_itens_auth_all" on folha_itens;
create policy "folha_itens_auth_all" on folha_itens
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
drop policy if exists "acesso_empresa_folha_itens" on folha_itens;
create policy "acesso_empresa_folha_itens" on folha_itens
  as restrictive for all using (tem_acesso_empresa(empresa_id)) with check (tem_acesso_empresa(empresa_id));
