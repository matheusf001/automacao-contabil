-- ============================================================
-- HISTÓRICO: período do extrato processado
-- Rodar no SQL Editor do Supabase (uma vez).
--
-- Guarda a menor e a maior data dos lançamentos de cada
-- importação confirmada, para a aba Histórico mostrar de que
-- período era o extrato (ex.: 01/06/2026 a 30/06/2026).
-- ============================================================

alter table extratos_processados
  add column if not exists periodo_inicio date,
  add column if not exists periodo_fim date;

comment on column extratos_processados.periodo_inicio is 'Menor data entre os lançamentos importados (início do período do extrato).';
comment on column extratos_processados.periodo_fim is 'Maior data entre os lançamentos importados (fim do período do extrato).';
