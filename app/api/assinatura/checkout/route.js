import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getPlano } from '@/lib/planos';

// =====================================================================
// LINK DE COBRANÇA para assinante JÁ EXISTENTE (só o dono do sistema).
// Uso: migrar um assinante "manual" pra cobrança automática, ou trocar
// o plano. Gera o link do Mercado Pago pra você mandar no WhatsApp;
// quando ele pagar, o webhook ajusta limite/status sozinho.
// =====================================================================

export const runtime = 'nodejs';

function clienteAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function exigirSuper(request, sb) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) return null;
  const { data: perfil } = await sb.from('perfis').select('super, ativo').eq('user_id', data.user.id).maybeSingle();
  if (!perfil || perfil.super !== true || perfil.ativo === false) return null;
  return data.user;
}

function erro(msg, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

export async function POST(request) {
  const sb = clienteAdmin();
  if (!sb) return erro('Servidor sem SUPABASE_SERVICE_ROLE_KEY.', 500);
  if (!process.env.MP_ACCESS_TOKEN) return erro('Cobrança ainda não configurada (MP_ACCESS_TOKEN ausente).', 500);
  if (!(await exigirSuper(request, sb))) return erro('Acesso exclusivo do dono do sistema.', 403);

  const body = await request.json().catch(() => ({}));
  const escritorioId = String(body.escritorio_id || '');
  const plano = getPlano(String(body.plano || ''));
  const email = String(body.email || '').trim().toLowerCase();
  if (!escritorioId || !plano) return erro('Informe o assinante e um plano válido.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return erro('Informe o e-mail de cobrança do assinante.');

  const { data: esc } = await sb.from('escritorios').select('id, nome').eq('id', escritorioId).maybeSingle();
  if (!esc) return erro('Assinante não encontrado.');

  const site = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
  const res = await fetch('https://api.mercadopago.com/preapproval', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` },
    body: JSON.stringify({
      reason: `Automação Contábil — Plano ${plano.nome} (${esc.nome})`,
      external_reference: esc.id,
      payer_email: email,
      back_url: `${site}/assinar/obrigado`,
      auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: plano.preco_mensal, currency_id: 'BRL' },
      status: 'pending',
    }),
  });
  const mp = await res.json().catch(() => ({}));
  if (!res.ok || !mp.init_point) {
    console.error('MP preapproval falhou:', mp);
    return erro('O Mercado Pago não gerou o link agora — tente de novo.', 502);
  }

  await sb.from('escritorios').update({
    mp_preapproval_id: mp.id, plano: plano.id, email_cobranca: email,
    status_pagamento: 'aguardando',
  }).eq('id', esc.id);

  return NextResponse.json({ ok: true, checkout_url: mp.init_point });
}
