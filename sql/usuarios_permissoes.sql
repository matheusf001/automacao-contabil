-- ============================================================
-- GERENCIAMENTO DE USUÁRIOS E PERMISSÕES POR EMPRESA
-- Rode este script inteiro no Supabase: SQL Editor > New query
-- ============================================================

-- 1) Novas colunas no perfil:
--    acesso_todas = true  -> usuário vê todas as empresas
--    acesso_todas = false -> vê só as empresas listadas em perfis_empresas
--    ativo = false        -> usuário bloqueado (não vê nada)
alter table perfis add column if not exists acesso_todas boolean not null default true;
alter table perfis add column if not exists ativo boolean not null default true;

-- 2) Quais empresas cada usuário (com acesso específico) pode ver
create table if not exists perfis_empresas (
  user_id uuid not null references auth.users(id) on delete cascade,
  empresa_id uuid not null references empresas(id) on delete cascade,
  primary key (user_id, empresa_id)
);
alter table perfis_empresas enable row level security;

-- 3) Função: o usuário logado é admin?
create or replace function eh_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from perfis p
    where p.user_id = auth.uid() and p.role = 'admin' and coalesce(p.ativo, true)
  );
$$;

-- 4) Função: o usuário logado tem acesso a esta empresa?
--    (admin ou acesso_todas -> sim; senão, precisa estar em perfis_empresas; inativo -> não)
create or replace function tem_acesso_empresa(emp uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from perfis p
    where p.user_id = auth.uid()
      and coalesce(p.ativo, true)
      and (
        p.role = 'admin'
        or coalesce(p.acesso_todas, true)
        or exists(select 1 from perfis_empresas pe
                  where pe.user_id = auth.uid() and pe.empresa_id = emp)
      )
  );
$$;

-- 5) Políticas da tabela perfis_empresas
drop policy if exists "perfis_empresas_select" on perfis_empresas;
create policy "perfis_empresas_select" on perfis_empresas
  for select using (auth.role() = 'authenticated');
drop policy if exists "perfis_empresas_admin" on perfis_empresas;
create policy "perfis_empresas_admin" on perfis_empresas
  for all using (eh_admin()) with check (eh_admin());

-- 6) TRAVA DE SEGURANÇA POR EMPRESA (políticas RESTRITIVAS):
--    valem EM CONJUNTO com as regras que já existem — ou seja, além do que
--    já era permitido, agora o usuário também precisa ter acesso à empresa.
--    Usuário desativado perde acesso a tudo imediatamente.
drop policy if exists "acesso_empresa_empresas" on empresas;
create policy "acesso_empresa_empresas" on empresas
  as restrictive for all using (tem_acesso_empresa(id)) with check (tem_acesso_empresa(id));

drop policy if exists "acesso_empresa_plano" on plano_contas;
create policy "acesso_empresa_plano" on plano_contas
  as restrictive for all using (tem_acesso_empresa(empresa_id)) with check (tem_acesso_empresa(empresa_id));

drop policy if exists "acesso_empresa_regras" on regras;
create policy "acesso_empresa_regras" on regras
  as restrictive for all using (tem_acesso_empresa(empresa_id)) with check (tem_acesso_empresa(empresa_id));

drop policy if exists "acesso_empresa_extratos" on extratos_processados;
create policy "acesso_empresa_extratos" on extratos_processados
  as restrictive for all using (tem_acesso_empresa(empresa_id)) with check (tem_acesso_empresa(empresa_id));

drop policy if exists "acesso_empresa_lancamentos" on lancamentos_importados;
create policy "acesso_empresa_lancamentos" on lancamentos_importados
  as restrictive for all using (tem_acesso_empresa(empresa_id)) with check (tem_acesso_empresa(empresa_id));

drop policy if exists "acesso_empresa_layout_conta" on empresa_layout_conta;
create policy "acesso_empresa_layout_conta" on empresa_layout_conta
  as restrictive for all using (tem_acesso_empresa(empresa_id)) with check (tem_acesso_empresa(empresa_id));

drop policy if exists "acesso_empresa_relfin" on relatorios_financeiros;
create policy "acesso_empresa_relfin" on relatorios_financeiros
  as restrictive for all using (tem_acesso_empresa(empresa_id)) with check (tem_acesso_empresa(empresa_id));

drop policy if exists "acesso_empresa_relitens" on relatorio_itens;
create policy "acesso_empresa_relitens" on relatorio_itens
  as restrictive for all using (tem_acesso_empresa(empresa_id)) with check (tem_acesso_empresa(empresa_id));
