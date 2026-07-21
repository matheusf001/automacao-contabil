import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// =====================================================================
// GERENCIAMENTO DE ASSINANTES (escritórios) — exclusivo do SUPER admin
// (dono do site). Cria o escritório já com o usuário GERENTE dele, que
// por sua vez cria os próprios usuários e empresas dentro do limite.
// =====================================================================

export const runtime = 'nodejs';
const EMAIL_INTERNO = '@usuarios.interno';

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
  const { data: perfil } = await sb.from('perfis')
    .select('super, ativo').eq('user_id', data.user.id).maybeSingle();
  if (!perfil || perfil.super !== true || perfil.ativo === false) return null;
  return data.user;
}

function erro(msg, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

// ---------- LISTAR assinantes com contadores ----------
export async function GET(request) {
  const sb = clienteAdmin();
  if (!sb) return erro('SUPABASE_SERVICE_ROLE_KEY não configurada no servidor.', 500);
  if (!(await exigirSuper(request, sb))) return erro('Acesso exclusivo do dono do sistema.', 403);

  const [{ data: escritorios, error: e1 }, { data: empresas }, { data: perfis }] = await Promise.all([
    sb.from('escritorios').select('*').order('criado_em'),
    sb.from('empresas').select('id, escritorio_id'),
    sb.from('perfis').select('user_id, escritorio_id, username, role'),
  ]);
  if (e1) return erro('Erro ao listar assinantes: ' + e1.message, 500);

  const lista = (escritorios || []).map(esc => {
    const usuariosDoEsc = (perfis || []).filter(p => p.escritorio_id === esc.id);
    return {
      ...esc,
      qtde_empresas: (empresas || []).filter(e => e.escritorio_id === esc.id).length,
      qtde_usuarios: usuariosDoEsc.length,
      gerentes: usuariosDoEsc.filter(p => p.role === 'admin').map(p => p.username).join(', '),
    };
  });
  return NextResponse.json({ escritorios: lista });
}

// ---------- CRIAR assinante (escritório + usuário gerente) ----------
export async function POST(request) {
  const sb = clienteAdmin();
  if (!sb) return erro('SUPABASE_SERVICE_ROLE_KEY não configurada no servidor.', 500);
  if (!(await exigirSuper(request, sb))) return erro('Acesso exclusivo do dono do sistema.', 403);

  const body = await request.json().catch(() => ({}));
  const nome = String(body.nome || '').trim();
  const limite = Math.max(1, parseInt(body.limite_empresas) || 5);
  const gUsername = String(body.gerente_username || '').trim().toLowerCase();
  const gEmail = String(body.gerente_email || '').trim().toLowerCase();
  const gPassword = String(body.gerente_password || '');

  if (nome.length < 2) return erro('Informe o nome do escritório assinante.');
  if (!/^[a-z0-9._-]{3,30}$/.test(gUsername)) return erro('Usuário do gerente inválido: 3–30 letras minúsculas, números, ponto, hífen ou underline.');
  if (gPassword.length < 6) return erro('A senha do gerente precisa ter pelo menos 6 caracteres.');
  if (gEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(gEmail)) return erro('E-mail do gerente inválido.');

  const { data: jaExiste } = await sb.from('perfis').select('user_id').eq('username', gUsername).maybeSingle();
  if (jaExiste) return erro(`O nome de usuário "${gUsername}" já está em uso.`);

  const { data: esc, error: e1 } = await sb.from('escritorios')
    .insert({ nome, limite_empresas: limite, ativo: true }).select().single();
  if (e1) return erro('Erro ao criar escritório: ' + e1.message, 500);

  const { data: criado, error: e2 } = await sb.auth.admin.createUser({
    email: gEmail || `${gUsername}${EMAIL_INTERNO}`, password: gPassword, email_confirm: true,
  });
  if (e2) {
    await sb.from('escritorios').delete().eq('id', esc.id).catch(() => {});
    return erro('Erro ao criar o gerente: ' + e2.message, 500);
  }
  const { error: e3 } = await sb.from('perfis').insert({
    user_id: criado.user.id, username: gUsername, role: 'admin',
    acesso_todas: true, ativo: true, escritorio_id: esc.id, super: false,
  });
  if (e3) {
    await sb.auth.admin.deleteUser(criado.user.id).catch(() => {});
    await sb.from('escritorios').delete().eq('id', esc.id).catch(() => {});
    return erro('Erro ao salvar o perfil do gerente: ' + e3.message, 500);
  }
  return NextResponse.json({ ok: true, escritorio_id: esc.id });
}

// ---------- EDITAR assinante (nome, limite, ativo) ----------
export async function PATCH(request) {
  const sb = clienteAdmin();
  if (!sb) return erro('SUPABASE_SERVICE_ROLE_KEY não configurada no servidor.', 500);
  if (!(await exigirSuper(request, sb))) return erro('Acesso exclusivo do dono do sistema.', 403);

  const body = await request.json().catch(() => ({}));
  const id = String(body.id || '');
  if (!id) return erro('id obrigatório.');

  const upd = {};
  if (typeof body.nome === 'string' && body.nome.trim()) upd.nome = body.nome.trim();
  if (body.limite_empresas !== undefined) upd.limite_empresas = Math.max(1, parseInt(body.limite_empresas) || 1);
  if (typeof body.ativo === 'boolean') upd.ativo = body.ativo;
  if (typeof body.observacoes === 'string') upd.observacoes = body.observacoes;
  if (!Object.keys(upd).length) return erro('Nada para atualizar.');

  const { error } = await sb.from('escritorios').update(upd).eq('id', id);
  if (error) return erro('Erro ao atualizar: ' + error.message, 500);
  return NextResponse.json({ ok: true });
}


// ---------- EXCLUIR assinante (escritório + TODOS os dados dele) ----------
export async function DELETE(request) {
  const sb = clienteAdmin();
  if (!sb) return erro('SUPABASE_SERVICE_ROLE_KEY não configurada no servidor.', 500);
  if (!(await exigirSuper(request, sb))) return erro('Acesso exclusivo do dono do sistema.', 403);

  const body = await request.json().catch(() => ({}));
  const id = String(body.id || '');
  if (!id) return erro('id obrigatório.');

  // Nunca deixa excluir um escritório que contenha o dono do sistema (super).
  const { data: perfisEsc, error: ePerfis } = await sb.from('perfis')
    .select('user_id, super').eq('escritorio_id', id);
  if (ePerfis) return erro('Erro ao checar usuários do assinante: ' + ePerfis.message, 500);
  if ((perfisEsc || []).some(p => p.super === true)) {
    return erro('Este escritório contém o dono do sistema — não pode ser excluído.', 400);
  }

  // 1) Empresas do escritório + tudo preso a elas (filhos primeiro, para não bater em FK).
  const { data: empresas, error: eEmp } = await sb.from('empresas').select('id').eq('escritorio_id', id);
  if (eEmp) return erro('Erro ao listar empresas do assinante: ' + eEmp.message, 500);
  const empresaIds = (empresas || []).map(e => e.id);

  if (empresaIds.length) {
    const tabelasFilhas = [
      'lancamentos_importados', 'extratos_processados',
      'relatorio_itens', 'relatorios_financeiros',
      'folha_itens', 'folhas', 'folha_config', 'funcionarios',
      'empresa_layout_conta', 'plano_contas', 'regras', 'perfis_empresas',
    ];
    for (const t of tabelasFilhas) {
      const { error } = await sb.from(t).delete().in('empresa_id', empresaIds);
      if (error) return erro(`Erro ao apagar ${t}: ` + error.message, 500);
    }
    const { error: eDelEmp } = await sb.from('empresas').delete().eq('escritorio_id', id);
    if (eDelEmp) return erro('Erro ao apagar empresas: ' + eDelEmp.message, 500);
  }

  // 2) Usuários do escritório: apaga o perfil primeiro (FK) e depois o login (auth).
  const { error: eDelPerfis } = await sb.from('perfis').delete().eq('escritorio_id', id);
  if (eDelPerfis) return erro('Erro ao apagar perfis: ' + eDelPerfis.message, 500);
  for (const perfil of (perfisEsc || [])) {
    await sb.auth.admin.deleteUser(perfil.user_id).catch(() => {});
  }

  // 3) Layouts próprios do escritório (os globais, com escritorio_id nulo, ficam) e pagamentos.
  await sb.from('layouts_banco').delete().eq('escritorio_id', id);
  await sb.from('pagamentos_assinatura').delete().eq('escritorio_id', id);

  // 4) Por fim, o próprio escritório.
  const { error: eDelEsc } = await sb.from('escritorios').delete().eq('id', id);
  if (eDelEsc) return erro('Erro ao apagar o escritório: ' + eDelEsc.message, 500);

  return NextResponse.json({ ok: true });
}
