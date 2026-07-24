-- ============================================================
-- FOLHA: conta contábil de ADIANTAMENTO DE SALÁRIO
-- Rodar no SQL Editor do Supabase (uma vez).
--
-- Como funciona no site depois deste script:
--  - nome do funcionário + valor IGUAL ao líquido da folha  -> conta de salário (como já era)
--  - nome do funcionário reconhecido mas valor DIFERENTE    -> conta de adiantamento (nova)
-- Se a conta de adiantamento ficar vazia na aba Folha, o site
-- NÃO classifica sozinho — só mostra o selo verde de contexto.
-- ============================================================

alter table folha_config
  add column if not exists conta_adiantamento integer;

comment on column folha_config.conta_adiantamento is
  'Conta analítica usada quando o extrato traz o nome de um funcionário com valor diferente do líquido (adiantamento quinzenal / pagamento parcial).';
