import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getPlano } from '@/lib/planos';

// =====================================================================
// WEBHOOK DO MERCADO PAGO
// O MP chama esta rota quando a assinatura muda de estado ou uma
// cobrança é feita. NUNCA confiamos no corpo recebido: usamos só o id
// e buscamos a verdade direto na API do MP com o nosso token — assim
// ninguém consegue "se liberar" chamando o webhook na mão.
//   authorized  -> ativa o escritório (status em_dia)
//   paused/cancelled -> suspende
// =====================================================================

export const runtime = 'nodejs';

function clienteAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function mpGet(caminho) {
  const res = await fetch(`https://api.mercadopago.com${caminho}`, {
    headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` },
  });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

async function aplicarStatusAssinatura(sb, pre) {
  if (!pre?.id) return;
  // localiza o escritório pela assinatura (ou pela referência usada na criação)
  let { data: esc } = await sb.from('escritorios').select('id, plano, status_pagamento').eq('mp_preapproval_id', pre.id).maybeSingle();
  if (!esc && pre.external_reference) {
    const r = await sb.from('escritorios').select('id, plano, status_pagamento').eq('id', pre.external_reference).maybeSingle();
    esc = r.data;
    if (esc) await sb.from('escritorios').update({ mp_preapproval_id: pre.id }).eq('id', esc.id);
  }
  if (!esc) { console.error('Webhook: escritório não encontrado para preapproval', pre.id); return; }

  const plano = getPlano(esc.plano);
  if (pre.status === 'authorized') {
    await sb.from('escritorios').update({
      ativo: true, status_pagamento: 'em_dia',
      ...(plano ? { limite_empresas: plano.limite_empresas } : {}),
      ultimo_pagamento: new Date().toISOString(),
    }).eq('id', esc.id);
  } else if (pre.status === 'paused' || pre.status === 'cancelled') {
    await sb.from('escritorios').update({ ativo: false, status_pagamento: 'suspenso' }).eq('id', esc.id);
  }
}

export async function POST(request) {
  const sb = clienteAdmin();
  if (!sb || !process.env.MP_ACCESS_TOKEN) return NextResponse.json({ ok: true }); // responde 200 pra não gerar retentativas infinitas

  try {
    const url = new URL(request.url);
    const body = await request.json().catch(() => ({}));
    const tipo = body.type || url.searchParams.get('type') || url.searchParams.get('topic') || '';
    const id = body?.data?.id || url.searchParams.get('data.id') || url.searchParams.get('id') || '';
    if (!id) return NextResponse.json({ ok: true });

    if (String(tipo).includes('preapproval') || String(tipo).includes('subscription')) {
      const pre = await mpGet(`/preapproval/${id}`);
      await aplicarStatusAssinatura(sb, pre);
    } else if (String(tipo).includes('payment')) {
      // cobrança mensal: registra no histórico e renova o "em dia"
      const pg = await mpGet(`/v1/payments/${id}`);
      if (pg) {
        const preId = pg.metadata?.preapproval_id || pg.point_of_interaction?.transaction_data?.subscription_id || null;
        let escritorioId = null;
        if (pg.external_reference) escritorioId = pg.external_reference;
        if (!escritorioId && preId) {
          const { data } = await sb.from('escritorios').select('id').eq('mp_preapproval_id', preId).maybeSingle();
          escritorioId = data?.id || null;
        }
        await sb.from('pagamentos_assinatura').insert({
          escritorio_id: escritorioId, mp_payment_id: String(pg.id), mp_preapproval_id: preId,
          valor: pg.transaction_amount || null, status: pg.status || null,
          detalhe: pg.description || pg.status_detail || null,
        });
        if (escritorioId && pg.status === 'approved') {
          await sb.from('escritorios').update({
            ativo: true, status_pagamento: 'em_dia', ultimo_pagamento: new Date().toISOString(),
          }).eq('id', escritorioId);
        }
      }
    }
  } catch (err) {
    console.error('Webhook MP erro:', err);
  }
  return NextResponse.json({ ok: true });
}

// O MP às vezes valida o endereço com GET
export async function GET() {
  return NextResponse.json({ ok: true });
}
