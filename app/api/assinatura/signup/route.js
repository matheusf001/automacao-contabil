import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getPlano } from '@/lib/planos';

// =====================================================================
// AUTOASSINATURA (página pública /assinar chama esta rota)
// 1. Cria o escritório SUSPENSO (ativo=false, aguardando pagamento)
// 2. Cria o usuário gerente
// 3. Cria a assinatura recorrente no Mercado Pago e devolve o link
// O webhook (/api/assinatura/webhook) libera o acesso quando o MP
// confirmar o pagamento — sem nenhuma ação manual sua.
// =====================================================================

export const runtime = 'nodejs';
const EMAIL_INTERNO = '@usuarios.interno';

function clienteAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function erro(msg, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

export async function POST(request) {
  const sb = clienteAdmin();
  if (!sb) return erro('Servidor sem SUPABASE_SERVICE_ROLE_KEY.', 500);
  const mpToken = process.env.MP_ACCESS_TOKEN;
  if (!mpToken) return erro('Cobrança ainda não configurada (MP_ACCESS_TOKEN ausente).', 500);

  const body = await request.json().catch(() => ({}));
  const nome = String(body.nome || '').trim();
  const planoId = String(body.plano || '');
  const gUsername = String(body.gerente_username || '').trim().toLowerCase();
  const gEmail = String(body.gerente_email || '').trim().toLowerCase();
  const gPassword = String(body.gerente_password || '');

  const plano = getPlano(planoId);
  if (!plano) return erro('Plano inválido.');
  if (nome.length < 2) return erro('Informe o nome do escritório.');
  if (!/^[a-z0-9._-]{3,30}$/.test(gUsername)) return erro('Usuário inválido: 3–30 letras minúsculas, números, ponto, hífen ou underline.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(gEmail)) return erro('Informe um e-mail válido — é por ele que você paga, recupera a senha e recebe avisos.');
  if (gPassword.length < 8) return erro('A senha precisa ter pelo menos 8 caracteres.');

  const { data: jaExiste } = await sb.from('perfis').select('user_id').eq('username', gUsername).maybeSingle();
  if (jaExiste) return erro(`O nome de usuário "${gUsername}" já está em uso — escolha outro.`);

  // 1) escritório nasce SUSPENSO, aguardando o pagamento
  const { data: esc, error: e1 } = await sb.from('escritorios').insert({
    nome, limite_empresas: plano.limite_empresas, ativo: false,
    plano: plano.id, status_pagamento: 'aguardando', email_cobranca: gEmail,
    observacoes: 'Criado pela página de assinatura',
  }).select().single();
  if (e1) return erro('Erro ao criar cadastro: ' + e1.message, 500);

  // 2) usuário gerente
  const { data: criado, error: e2 } = await sb.auth.admin.createUser({
    email: gEmail || `${gUsername}${EMAIL_INTERNO}`, password: gPassword, email_confirm: true,
  });
  if (e2) {
    await sb.from('escritorios').delete().eq('id', esc.id).catch(() => {});
    return erro(e2.message.includes('already') ? 'Este e-mail já tem cadastro — use "Esqueci minha senha" na tela de login.' : 'Erro ao criar usuário: ' + e2.message, 500);
  }
  const { error: e3 } = await sb.from('perfis').insert({
    user_id: criado.user.id, username: gUsername, role: 'admin',
    acesso_todas: true, ativo: true, escritorio_id: esc.id, super: false,
  });
  if (e3) {
    await sb.auth.admin.deleteUser(criado.user.id).catch(() => {});
    await sb.from('escritorios').delete().eq('id', esc.id).catch(() => {});
    return erro('Erro ao salvar perfil: ' + e3.message, 500);
  }

  // 3) assinatura recorrente no Mercado Pago (cartão de crédito, mensal)
  const site = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
  const res = await fetch('https://api.mercadopago.com/preapproval', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${mpToken}` },
    body: JSON.stringify({
      reason: `Automação Contábil — Plano ${plano.nome} (${nome})`,
      external_reference: esc.id,
      payer_email: gEmail,
      back_url: `${site}/assinar/obrigado`,
      auto_recurring: {
        frequency: 1, frequency_type: 'months',
        transaction_amount: plano.preco_mensal, currency_id: 'BRL',
      },
      status: 'pending',
    }),
  });
  const mp = await res.json().catch(() => ({}));
  if (!res.ok || !mp.init_point) {
    console.error('MP preapproval falhou:', mp);
    return erro('Não foi possível gerar o link de pagamento agora — tente novamente em instantes.', 502);
  }
  await sb.from('escritorios').update({ mp_preapproval_id: mp.id }).eq('id', esc.id);

  return NextResponse.json({ ok: true, checkout_url: mp.init_point });
}
