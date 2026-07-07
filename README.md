# Automação Contábil — Site

## O que já está pronto
- Banco de dados no Supabase (você já rodou o `schema.sql`)
- Seu usuário de login (você já criou)
- Código do site (Next.js) — este projeto

## Passo 1 — Pegar as chaves do Supabase
No painel do Supabase → **Project Settings** → **API**:
- copie a **Project URL**
- copie a chave **anon public**

## Passo 2 — Rodar localmente para testar (opcional, mas recomendado)
```
npm install
cp .env.local.example .env.local
```
Edite `.env.local` e cole a URL e a chave do Passo 1. Depois:
```
npm run dev
```
Abra http://localhost:3000 — deve pedir login. Entre com o e-mail/senha que você criou no Supabase.

## Passo 3 — Subir para o GitHub
```
git init
git add .
git commit -m "primeira versão do site"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/automacao-contabil.git
git push -u origin main
```
(Crie o repositório vazio no GitHub antes, em github.com/new — sem README, sem .gitignore, para não conflitar.)

## Passo 4 — Publicar no Vercel
1. No painel do Vercel → **Add New** → **Project**
2. Selecione o repositório `automacao-contabil` que você acabou de subir
3. Em **Environment Variables**, adicione:
   - `NEXT_PUBLIC_SUPABASE_URL` = a URL do Passo 1
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = a chave do Passo 1
4. Clique em **Deploy**

Em ~1 minuto o site estará no ar em algo como `automacao-contabil.vercel.app`.

## Passo 5 — Criar login dos colegas
No Supabase → **Authentication** → **Users** → **Add user** → **Create new user**, marcando **Auto Confirm User**. Repita para cada colega.

## Depois disso
- Domínio próprio: em Vercel → seu projeto → **Settings** → **Domains**, adiciona o domínio que você comprar (Hostinger, Registro.br, etc.) e aponta o DNS conforme instrução do Vercel.
- Qualquer atualização de código: só fazer `git push` de novo — o Vercel publica automaticamente.
