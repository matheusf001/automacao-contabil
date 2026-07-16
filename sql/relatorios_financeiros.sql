-- =========================================================
-- RELATÓRIOS FINANCEIROS (contas pagas, recebimentos, folha…)
-- Rode este script inteiro no Supabase: SQL Editor > New query
-- =========================================================

-- Cabeçalho de cada relatório enviado
create table if not exists relatorios_financeiros (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references empresas(id) on delete cascade,
  nome_arquivo text,
  tipo text not null default 'pagamentos', -- 'pagamentos' (saídas) ou 'recebimentos' (entradas)
  total_itens integer not null default 0,
  periodo_inicio date,
  periodo_fim date,
  enviado_por text,
  criado_em timestamptz default now()
);
create index if not exists idx_relfin_empresa on relatorios_financeiros(empresa_id);

-- Itens individuais (uma linha por pagamento/recebimento do relatório)
create table if not exists relatorio_itens (
  id bigint generated always as identity primary key,
  relatorio_id bigint not null references relatorios_financeiros(id) on delete cascade,
  empresa_id uuid not null references empresas(id) on delete cascade,
  tipo text not null default 'pagamentos',
  data date not null,
  valor numeric(14,2) not null,
  descricao text not null,
  categoria text
);
create index if not exists idx_relitens_match on relatorio_itens(empresa_id, tipo, data, valor);
create index if not exists idx_relitens_relatorio on relatorio_itens(relatorio_id);

-- Segurança: qualquer usuário logado pode ler e enviar relatórios;
-- excluir relatório é livre para logados também (o item some junto, via cascade).
alter table relatorios_financeiros enable row level security;
alter table relatorio_itens enable row level security;

drop policy if exists "relfin_auth_all" on relatorios_financeiros;
create policy "relfin_auth_all" on relatorios_financeiros
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "relitens_auth_all" on relatorio_itens;
create policy "relitens_auth_all" on relatorio_itens
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
