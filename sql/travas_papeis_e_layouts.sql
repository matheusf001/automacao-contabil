-- ============================================================
-- TRAVAS DE PAPEL NO BANCO (RLS) + PROTEÇÃO DOS LAYOUTS GLOBAIS
-- Rode este script inteiro no Supabase: SQL Editor > New query
-- Ordem: schema.sql -> usuarios_permissoes.sql -> saas_assinantes.sql
--        -> relatorios_financeiros.sql -> regras_por_direcao.sql -> ESTE
--
-- Motivo: as travas de papel (admin x operador) existiam só na tela.
-- Como a chave anon do Supabase é pública por natureza, qualquer
-- operador logado conseguia, chamando a API direto (fora do site):
--   - editar/excluir empresas, plano de contas e regras;
--   - excluir ou "sequestrar" os layouts de banco GLOBAIS (Genérico,
--     Banco do Brasil, Itaú...) compartilhados por todos os assinantes.
--
-- Todas as políticas abaixo são RESTRITIVAS: valem EM CONJUNTO com as
-- já existentes (um "E" lógico). Nada aqui afrouxa o que já havia.
-- Leituras (select) não mudam para ninguém.
-- ============================================================

-- ------------------------------------------------------------
-- 1) LAYOUTS DE BANCO
--    - Criar/editar/excluir layout é ação de admin na interface;
--      agora o banco exige o mesmo papel.
--    - Layout global (escritorio_id null): só o SUPER mexe.
--      A política antiga ("layouts_por_escritorio") deixava qualquer
--      autenticado EXCLUIR um layout global (no DELETE só o USING é
--      avaliado, e ele aceitava escritorio_id null) e também permitia
--      "roubar" um layout global via UPDATE trocando o escritorio_id.
-- ------------------------------------------------------------

drop policy if exists "layouts_insert_admin" on layouts_banco;
create policy "layouts_insert_admin" on layouts_banco
  as restrictive for insert
  with check (eh_admin());

drop policy if exists "layouts_update_admin" on layouts_banco;
create policy "layouts_update_admin" on layouts_banco
  as restrictive for update
  using (eh_super() or (eh_admin() and escritorio_id is not null and escritorio_id = meu_escritorio()))
  with check (eh_super() or (eh_admin() and escritorio_id is not null and escritorio_id = meu_escritorio()));

drop policy if exists "layouts_delete_admin" on layouts_banco;
create policy "layouts_delete_admin" on layouts_banco
  as restrictive for delete
  using (eh_super() or (eh_admin() and escritorio_id is not null and escritorio_id = meu_escritorio()));

-- ------------------------------------------------------------
-- 2) EMPRESAS: criar, renomear e excluir é só admin.
--    (Operador continua vendo e usando as empresas normalmente.)
--    O trigger de limite do plano continua valendo por cima.
-- ------------------------------------------------------------

drop policy if exists "empresas_insert_admin" on empresas;
create policy "empresas_insert_admin" on empresas
  as restrictive for insert
  with check (eh_admin());

drop policy if exists "empresas_update_admin" on empresas;
create policy "empresas_update_admin" on empresas
  as restrictive for update
  using (eh_admin()) with check (eh_admin());

drop policy if exists "empresas_delete_admin" on empresas;
create policy "empresas_delete_admin" on empresas
  as restrictive for delete
  using (eh_admin());

-- ------------------------------------------------------------
-- 3) PLANO DE CONTAS: qualquer escrita é só admin.
--    (Na interface, importar/editar/excluir contas já era só admin.)
-- ------------------------------------------------------------

drop policy if exists "plano_insert_admin" on plano_contas;
create policy "plano_insert_admin" on plano_contas
  as restrictive for insert
  with check (eh_admin());

drop policy if exists "plano_update_admin" on plano_contas;
create policy "plano_update_admin" on plano_contas
  as restrictive for update
  using (eh_admin()) with check (eh_admin());

drop policy if exists "plano_delete_admin" on plano_contas;
create policy "plano_delete_admin" on plano_contas
  as restrictive for delete
  using (eh_admin());

-- ------------------------------------------------------------
-- 4) REGRAS: operador PODE criar regra (é o fluxo "Criar regra a
--    partir do extrato", usado no dia a dia) — por isso o INSERT
--    fica como está. Editar, reordenar e excluir é só admin,
--    igual à interface.
-- ------------------------------------------------------------

drop policy if exists "regras_update_admin" on regras;
create policy "regras_update_admin" on regras
  as restrictive for update
  using (eh_admin()) with check (eh_admin());

drop policy if exists "regras_delete_admin" on regras;
create policy "regras_delete_admin" on regras
  as restrictive for delete
  using (eh_admin());
