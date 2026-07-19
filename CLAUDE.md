# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Next.js 14 (App Router) SaaS for Brazilian accounting firms ("escritórios de contabilidade"). It ingests bank statements (OFX/CSV), classifies each transaction into a chart-of-accounts code via keyword rules and/or an LLM fallback, and generates an import file for the "Domínio" accounting system. It's multi-tenant: multiple firms ("escritórios"), each with multiple companies ("empresas"/CNPJs), users with per-company permissions, and its own subscription billing via Mercado Pago.

All UI text, comments, and commit messages in this repo are in Portuguese (pt-BR) — match that when editing.

## Regras permanentes deste projeto

1. **Responda sempre em português do Brasil**, com passo a passo simples e explicado — o dono do projeto está aprendendo a programar.
2. **Antes de concluir qualquer tarefa, rode `npm run build` e corrija os erros até passar.** Só considere a tarefa terminada com o build limpo.
3. **Nunca edite nem exiba o conteúdo de `.env.local`** nem de qualquer chave/segredo (API keys, tokens, service role key etc.), mesmo se solicitado a "mostrar" ou "conferir" o arquivo.
4. **Nunca use `onClick={funcao}` direto quando a função tiver parâmetros opcionais** — sempre `onClick={() => funcao()}`. Isso já causou um bug antigo neste projeto (o evento do clique era passado como argumento sem querer).
5. **O site é multi-assinante (SaaS)**: tabelas com `empresa_id`/`escritorio_id` têm segurança RLS no Supabase — nunca remova nem enfraqueça políticas de segurança (RLS) ao editar `sql/*.sql` ou o schema.
6. **Contas Sintéticas (tipo `S`) nunca podem receber lançamento** — mantenha essa validação em qualquer código novo que grave classificação/lançamento em conta.
7. **Alterações em banco de dados devem ser entregues como script SQL na pasta `sql/`**, nunca executadas diretamente pelo Claude contra o Supabase.
8. **Antes de mudanças grandes, faça um `git commit` de segurança** (checkpoint) para permitir reverter facilmente se algo der errado.

## Commands

```
npm install
npm run dev      # start dev server (http://localhost:3000)
npm run build
npm run start
```

There is no test suite, no lint script, and no ESLint/Prettier config in this repo — don't invent one unprompted.

### Environment variables (`.env.local`, see `.env.local.exemplo`)

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — client-side Supabase (anon key, RLS-restricted).
- `SUPABASE_SERVICE_ROLE_KEY` — server-only, used by `app/api/admin/*` and `app/api/assinatura/*` routes to bypass RLS. Never expose to the client.
- `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` — used only by `app/api/classificar-ia/route.js`.
- `MP_ACCESS_TOKEN` — Mercado Pago access token, used by `app/api/assinatura/*`.
- `NEXT_PUBLIC_SITE_URL` — base URL used to build Mercado Pago redirect/webhook URLs.

## Architecture

### Multi-tenant model

`escritorios` (subscriber firms) → `perfis` (users, each tied to one `escritorio_id`, with `super`/admin flags) → `empresas` (companies/CNPJs, each tied to one `escritorio_id`) → `plano_contas` / `regras` / extratos (all scoped to `empresa_id`). A user's access to a given `empresa` is further restricted by `perfis_empresas` unless they have `acesso_todas`. One user has `super = true` (the platform owner) and can see/manage all `escritorios` from the "Assinantes" tab. Row Level Security in Postgres enforces all of this — see `sql/*.sql` for the actual policies/functions (`eh_super`, `eh_admin`, `tem_acesso_empresa`, `meu_escritorio`).

`sql/` files are applied manually against Supabase in order: `schema.sql` → `usuarios_permissoes.sql` → `saas_assinantes.sql` → `relatorios_financeiros.sql` → `regras_por_direcao.sql`. There is no migration runner — treat these as an ordered history of hand-applied changes, and add new changes as a new numbered/dated file rather than editing old ones.

### `app/dashboard/page.js` — the core, single large client component (~2200 lines)

Tab-based UI (`TABS` / `TAB_META` near the top of the file), tabs rendered conditionally by `tab === 'x'` blocks. Key functions, all defined inside this same file:

- `parseOFX()` — parses OFX bank statement files.
- `processarExtrato()` — central classification pipeline: matches each transaction against `regras` (keyword rules), applies direction-aware overrides (`codigo_recebimento` for incoming vs outgoing), and marks unmatched lines for either manual assignment or AI classification.
- `classificarComIA()` — calls `app/api/classificar-ia` for lines with no rule match.
- `confirmarImportacao()` — writes the finalized, user-confirmed classification to history (this becomes training/reference data for future rule and AI suggestions).

Tabs: Empresas (company CRUD + "active company" selector that scopes every other tab) → Extrato (import/classify/reconcile statements — the main workflow) → Relatórios (upload client payment/receivable reports, matched to statement lines by date+value as extra classification context) → Regras (keyword→account rule CRUD, with direction variants) → Plano de Contas (chart of accounts CRUD per company, synthetic vs analytic accounts) → Importação (generates the Domínio import file) → Histórico (confirmed past imports) → Usuários (admin-only) → Assinantes (super-only, manages subscriber firms).

When editing this file, changes are usually localized to one tab's block plus any shared helper functions/state it touches — read the relevant tab section and its state variables rather than the whole file.

### API routes (`app/api/`)

- `classificar-ia/route.js` — server-only call to Anthropic Claude. Builds a Portuguese prompt embedding the company's analytic-only chart of accounts, existing rules, and previously-confirmed examples, plus hardcoded Brazilian accounting business rules (e.g. generic DARF handling, pró-labore vs sócio withdrawal, salary vs advance, transfers between own accounts). Any suggested account code that doesn't exist in the chart of accounts sent is discarded — never trust the model's code back without validating against the real `plano_contas`.
- `assinatura/signup/route.js` — public self-signup (from `/assinar`): creates the firm suspended (`ativo=false`), creates the manager user, creates a recurring Mercado Pago subscription (`preapproval`), and manually rolls back everything created if any step fails (no DB transaction across Supabase + Mercado Pago calls).
- `assinatura/checkout/route.js` — super-only: generates a Mercado Pago charge link for an existing subscriber.
- `assinatura/webhook/route.js` — Mercado Pago webhook. Never trusts the webhook payload directly — re-fetches the authoritative state from the Mercado Pago API using the ID in the notification before acting. Handles `preapproval`/`subscription` events (activate/suspend the firm) and `payment` events (record in `pagamentos_assinatura`).
- `admin/escritorios/route.js`, `admin/usuarios/route.js` — super/admin-only CRUD, run with the service-role key. Scope rule: a firm admin (manager) can only manage users within their own `escritorio`; nobody but the platform owner touches the `super` account.

### `lib/`

- `planoParser.js` / `relatorioParser.js` — spreadsheet/report parsers (chart of accounts import, client financial report import).
- `planos.js` — commercial plan definitions (pricing, `limite_empresas` per plan) — edit here to change pricing/limits shown on `/assinar`.
- `supabaseClient.js` — browser Supabase client (anon key only).
