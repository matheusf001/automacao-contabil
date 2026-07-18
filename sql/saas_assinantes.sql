-- ============================================================
-- ESTRUTURA DE ASSINANTES (SaaS multi-escritório)
-- Rode este script inteiro no Supabase: SQL Editor > New query
-- Cada assinante = um "escritório", com seus usuários e empresas.
-- Cobrança por empresa cadastrada: campo limite_empresas.
-- ============================================================

-- 1) Tabela de assinantes
create table if not exists escritorios (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  limite_empresas integer not null default 5,
  ativo boolean not null default true,
  observacoes text,
  criado_em timestamptz default now()
);
alter table escritorios enable row level security;

-- 2) Novas colunas
alter table perfis add column if not exists escritorio_id uuid references escritorios(id);
alter table perfis add column if not exists super boolean not null default false;
alter table empresas add column if not exists escritorio_id uuid references escritorios(id);
alter table empresas add column if not exists cnpj text;
alter table layouts_banco add column if not exists escritorio_id uuid references escritorios(id); -- null = layout padrão (global)

-- 3) Escritório inicial (o seu) + migração de tudo que já existe pra ele
do $$
declare esc uuid;
begin
  select id into esc from escritorios limit 1;
  if esc is null then
    insert into escritorios (nome, limite_empresas, observacoes)
      values ('Barreto Consultoria (matriz)', 9999, 'Escritório dono do sistema')
      returning id into esc;
  end if;
  update perfis set escritorio_id = esc where escritorio_id is null;
  update empresas set escritorio_id = esc where escritorio_id is null;
end $$;

-- 4) VOCÊ é o super administrador (dono do site).
--    >>> Confira se o username abaixo é o seu! <<<
update perfis set super = true where username = 'matheus';

-- 5) Funções de permissão
create or replace function eh_super() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from perfis p
    where p.user_id = auth.uid() and p.super and coalesce(p.ativo, true));
$$;

create or replace function meu_escritorio() returns uuid
language sql stable security definer set search_path = public as $$
  select p.escritorio_id from perfis p where p.user_id = auth.uid();
$$;

create or replace function eh_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from perfis p
    where p.user_id = auth.uid() and (p.role = 'admin' or p.super) and coalesce(p.ativo, true));
$$;

-- REDEFINIDA: agora exige também que a empresa seja do MESMO escritório do
-- usuário (super passa sempre; assinatura inativa bloqueia tudo).
-- Todas as políticas já criadas usam esta função, então a trava vale em
-- todas as tabelas automaticamente.
create or replace function tem_acesso_empresa(emp uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from perfis p
    where p.user_id = auth.uid()
      and coalesce(p.ativo, true)
      and (
        p.super
        or (
          coalesce((select e.escritorio_id from empresas e where e.id = emp), p.escritorio_id) = p.escritorio_id
          and coalesce((select es.ativo from escritorios es where es.id = p.escritorio_id), true)
          and (
            p.role = 'admin'
            or coalesce(p.acesso_todas, true)
            or exists(select 1 from perfis_empresas pe
                      where pe.user_id = auth.uid() and pe.empresa_id = emp)
          )
        )
      )
  );
$$;

-- 6) Políticas da tabela escritorios: cada um vê o seu; só o super mexe
drop policy if exists "escritorios_select" on escritorios;
create policy "escritorios_select" on escritorios
  for select using (eh_super() or id = meu_escritorio());
drop policy if exists "escritorios_super" on escritorios;
create policy "escritorios_super" on escritorios
  for all using (eh_super()) with check (eh_super());

-- 7) Trigger: toda empresa nova nasce no escritório de quem criou,
--    respeitando o LIMITE DO PLANO e a assinatura ativa.
create or replace function empresas_regras_criacao() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  meu uuid; limite int; qtde int; esta_ativo boolean;
begin
  select escritorio_id into meu from perfis where user_id = auth.uid();
  if new.escritorio_id is null then new.escritorio_id := meu; end if;
  if not eh_super() then
    if new.escritorio_id is distinct from meu then
      raise exception 'Sem permissão para criar empresa em outro escritório.';
    end if;
    select limite_empresas, ativo into limite, esta_ativo from escritorios where id = new.escritorio_id;
    if not coalesce(esta_ativo, true) then
      raise exception 'Assinatura inativa — fale com o suporte.';
    end if;
    select count(*) into qtde from empresas where escritorio_id = new.escritorio_id;
    if qtde >= limite then
      raise exception 'Limite do plano atingido: % empresa(s). Fale com o suporte para ampliar.', limite;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_empresas_regras_criacao on empresas;
create trigger trg_empresas_regras_criacao
  before insert on empresas for each row execute function empresas_regras_criacao();

-- 8) Layouts de banco: os padrões (sem escritório) todos veem, mas só o super
--    edita; cada escritório cria e edita os seus próprios.
create or replace function layouts_set_escritorio() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.escritorio_id is null and not eh_super() then
    new.escritorio_id := (select escritorio_id from perfis where user_id = auth.uid());
  end if;
  return new;
end $$;

drop trigger if exists trg_layouts_escritorio on layouts_banco;
create trigger trg_layouts_escritorio
  before insert on layouts_banco for each row execute function layouts_set_escritorio();

drop policy if exists "layouts_por_escritorio" on layouts_banco;
create policy "layouts_por_escritorio" on layouts_banco
  as restrictive for all
  using (escritorio_id is null or eh_super() or escritorio_id = meu_escritorio())
  with check (eh_super() or escritorio_id = meu_escritorio());
