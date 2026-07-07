-- =========================================================
-- AUTOMAÇÃO CONTÁBIL — Schema do banco de dados (Supabase)
-- =========================================================

create extension if not exists "pgcrypto";

-- EMPRESAS
create table if not exists empresas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  conta_banco_fixa integer,
  created_at timestamptz default now()
);

-- PLANO DE CONTAS (por empresa)
create table if not exists plano_contas (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references empresas(id) on delete cascade,
  codigo integer not null,
  classificacao text,
  descricao text not null
);
create index if not exists idx_plano_contas_empresa on plano_contas(empresa_id);
create index if not exists idx_plano_contas_codigo on plano_contas(empresa_id, codigo);

-- REGRAS DE CLASSIFICAÇÃO (por empresa)
create table if not exists regras (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references empresas(id) on delete cascade,
  ordem integer not null default 0,
  palavra_chave text not null,
  codigo integer not null,
  descricao text,
  created_at timestamptz default now()
);
create index if not exists idx_regras_empresa on regras(empresa_id);

-- LAYOUTS DE BANCO (compartilhados entre todas as empresas/usuários)
create table if not exists layouts_banco (
  id bigint generated always as identity primary key,
  nome text unique not null,
  separador text not null default 'auto',
  col_data integer not null default 0,
  col_historico integer not null default 2,
  col_valor integer not null default 1,
  cd_mode text not null default 'coluna',
  col_cd integer not null default 3,
  col_detalhamento integer not null default 4
);

insert into layouts_banco (nome, separador, col_data, col_historico, col_valor, cd_mode, col_cd, col_detalhamento)
values
  ('Genérico', 'auto', 0, 2, 1, 'coluna', 3, 4),
  ('Banco do Brasil', 'tab', 0, 2, 1, 'coluna', 3, 4),
  ('Santander', ';', 0, 1, 2, 'sinal', -1, 3),
  ('Sicredi', ';', 0, 1, 2, 'sinal', -1, 3),
  ('Itaú', ';', 0, 1, 2, 'sinal', -1, 3)
on conflict (nome) do nothing;

-- =========================================================
-- SEGURANÇA (Row Level Security)
-- Regra: só usuário autenticado (logado) pode ler/gravar.
-- Sem cadastro público — você cria os logins manualmente
-- em Authentication > Users no painel do Supabase.
-- =========================================================

alter table empresas enable row level security;
alter table plano_contas enable row level security;
alter table regras enable row level security;
alter table layouts_banco enable row level security;

create policy "empresas_auth_all" on empresas
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "plano_contas_auth_all" on plano_contas
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "regras_auth_all" on regras
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "layouts_banco_auth_all" on layouts_banco
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Empresa de exemplo para você já abrir o site com algo dentro
insert into empresas (nome, conta_banco_fixa) values ('Empresa Demonstração (BB)', 8);
