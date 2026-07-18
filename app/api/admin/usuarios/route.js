import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// =====================================================================
// GERENCIAMENTO DE USUÁRIOS (só admin)
// Roda NO SERVIDOR com a chave service_role (env SUPABASE_SERVICE_ROLE_KEY),
// que nunca chega ao navegador. Toda chamada exige o token de um usuário
// logado que seja admin na tabela perfis.
// =====================================================================

export const runtime = 'nodejs';

function clienteAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

// Confere o token enviado e devolve o usuário SE ele for admin ativo.
async function exigirAdmin(request, sb) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) return null;
  const { data: perfil } = await sb.from('perfis')
    .select('role, ativo, super, escritorio_id').eq('user_id', data.user.id).maybeSingle();
  if (!perfil || perfil.ativo === false) return null;
  if (perfil.role !== 'admin' && perfil.super !== true) return null;
  // devolve o usuário junto do perfil (escritório define o alcance das ações)
  return { ...data.user, perfil };
}

// Gerente só mexe em usuários do PRÓPRIO escritório; o super mexe em todos.
async function alvoPermitido(sb, admin, userId) {
  if (admin.perfil.super) return true;
  const { data: alvo } = await sb.from('perfis')
    .select('escritorio_id, super').eq('user_id', userId).maybeSingle();
  if (!alvo) return false;
  if (alvo.super) return false; // ninguém mexe no dono do sistema
  return alvo.escritorio_id === admin.perfil.escritorio_id;
}

function erro(msg, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

const EMAIL_INTERNO = '@usuarios.interno'; // gerado quando o admin não informa e-mail

// ---------- LISTAR ----------
export async function GET(request) {
  const sb = clienteAdmin();
  if (!sb) return erro('SUPABASE_SERVICE_ROLE_KEY não configurada no servidor.', 500);
  const admin = await exigirAdmin(request, sb);
  if (!admin) return erro('Acesso negado: apenas administradores.', 403);

  let qPerfis = sb.from('perfis').select('user_id, username, role, acesso_todas, ativo, escritorio_id, super');
  if (!admin.perfil.super) qPerfis = qPerfis.eq('escritorio_id', admin.perfil.escritorio_id);
  const [{ data: perfis, error: e1 }, { data: acessos }, authList] = await Promise.all([
    qPerfis,
    sb.from('perfis_empresas').select('user_id, empresa_id'),
    sb.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);
  if (e1) return erro('Erro ao listar perfis: ' + e1.message, 500);

  const porId = new Map((authList?.data?.users || []).map(u => [u.id, u]));
  const empresasPorUser = new Map();
  for (const a of (acessos || [])) {
    if (!empresasPorUser.has(a.user_id)) empresasPorUser.set(a.user_id, []);
    empresasPorUser.get(a.user_id).push(a.empresa_id);
  }
  const usuarios = (perfis || []).map(p => {
    const u = porId.get(p.user_id);
    const email = u?.email || '';
    return {
      user_id: p.user_id,
      username: p.username || '',
      email: email.endsWith(EMAIL_INTERNO) ? '' : email,
      role: p.role || 'operador',
      acesso_todas: p.acesso_todas !== false,
      ativo: p.ativo !== false,
      empresas: empresasPorUser.get(p.user_id) || [],
      ultimo_login: u?.last_sign_in_at || null,
      criado_em: u?.created_at || null,
      sou_eu: p.user_id === admin.id,
      escritorio_id: p.escritorio_id || null,
      super: p.super === true,
    };
  }).sort((a, b) => (a.username || a.email).localeCompare(b.username || b.email));

  return NextResponse.json({ usuarios });
}

// ---------- CRIAR ----------
export async function POST(request) {
  const sb = clienteAdmin();
  if (!sb) return erro('SUPABASE_SERVICE_ROLE_KEY não configurada no servidor.', 500);
  const admin = await exigirAdmin(request, sb);
  if (!admin) return erro('Acesso negado: apenas administradores.', 403);

  const body = await request.json().catch(() => ({}));
  const username = String(body.username || '').trim().toLowerCase();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const role = body.role === 'admin' ? 'admin' : 'operador';
  const acessoTodas = body.acesso_todas !== false;
  const empresas = Array.isArray(body.empresas) ? body.empresas : [];

  if (!/^[a-z0-9._-]{3,30}$/.test(username)) return erro('Nome de usuário inválido: use 3–30 letras minúsculas, números, ponto, hífen ou underline.');
  if (password.length < 6) return erro('A senha precisa ter pelo menos 6 caracteres.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return erro('E-mail inválido.');

  const { data: jaExiste } = await sb.from('perfis').select('user_id').eq('username', username).maybeSingle();
  if (jaExiste) return erro(`O nome de usuário "${username}" já está em uso.`);

  const emailFinal = email || `${username}${EMAIL_INTERNO}`;
  const { data: criado, error: e1 } = await sb.auth.admin.createUser({
    email: emailFinal, password, email_confirm: true,
  });
  if (e1) return erro('Erro ao criar usuário: ' + e1.message, 500);
  const userId = criado.user.id;

  const escritorioDestino = (admin.perfil.super && body.escritorio_id)
    ? String(body.escritorio_id)
    : admin.perfil.escritorio_id;
  const { error: e2 } = await sb.from('perfis').insert({
    user_id: userId, username, role, acesso_todas: acessoTodas, ativo: true,
    escritorio_id: escritorioDestino, super: false,
  });
  if (e2) { // desfaz pra não sobrar usuário órfão
    await sb.auth.admin.deleteUser(userId).catch(() => {});
    return erro('Erro ao salvar perfil: ' + e2.message, 500);
  }
  if (!acessoTodas && empresas.length) {
    await sb.from('perfis_empresas').insert(empresas.map(id => ({ user_id: userId, empresa_id: id })));
  }
  return NextResponse.json({ ok: true, user_id: userId });
}

// ---------- EDITAR (papel, acesso, senha, ativo) ----------
export async function PATCH(request) {
  const sb = clienteAdmin();
  if (!sb) return erro('SUPABASE_SERVICE_ROLE_KEY não configurada no servidor.', 500);
  const admin = await exigirAdmin(request, sb);
  if (!admin) return erro('Acesso negado: apenas administradores.', 403);

  const body = await request.json().catch(() => ({}));
  const userId = String(body.user_id || '');
  if (!userId) return erro('user_id obrigatório.');
  if (!(await alvoPermitido(sb, admin, userId))) return erro('Este usuário não pertence ao seu escritório.', 403);
  const souEu = userId === admin.id;

  // proteções contra se trancar pra fora
  if (souEu && body.role === 'operador') return erro('Você não pode rebaixar o seu próprio usuário.');
  if (souEu && body.ativo === false) return erro('Você não pode desativar o seu próprio usuário.');

  const upd = {};
  if (body.role === 'admin' || body.role === 'operador') upd.role = body.role;
  if (typeof body.acesso_todas === 'boolean') upd.acesso_todas = body.acesso_todas;
  if (typeof body.ativo === 'boolean') upd.ativo = body.ativo;
  if (Object.keys(upd).length) {
    const { error } = await sb.from('perfis').update(upd).eq('user_id', userId);
    if (error) return erro('Erro ao atualizar perfil: ' + error.message, 500);
  }

  if (Array.isArray(body.empresas)) {
    await sb.from('perfis_empresas').delete().eq('user_id', userId);
    if (body.empresas.length) {
      await sb.from('perfis_empresas').insert(body.empresas.map(id => ({ user_id: userId, empresa_id: id })));
    }
  }

  if (body.password) {
    if (String(body.password).length < 6) return erro('A nova senha precisa ter pelo menos 6 caracteres.');
    const { error } = await sb.auth.admin.updateUserById(userId, { password: String(body.password) });
    if (error) return erro('Erro ao redefinir senha: ' + error.message, 500);
  }

  // bloqueia/desbloqueia também no login (além do RLS)
  if (typeof body.ativo === 'boolean' && !souEu) {
    await sb.auth.admin.updateUserById(userId, { ban_duration: body.ativo ? 'none' : '876000h' }).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}

// ---------- EXCLUIR ----------
export async function DELETE(request) {
  const sb = clienteAdmin();
  if (!sb) return erro('SUPABASE_SERVICE_ROLE_KEY não configurada no servidor.', 500);
  const admin = await exigirAdmin(request, sb);
  if (!admin) return erro('Acesso negado: apenas administradores.', 403);

  const body = await request.json().catch(() => ({}));
  const userId = String(body.user_id || '');
  if (!userId) return erro('user_id obrigatório.');
  if (!(await alvoPermitido(sb, admin, userId))) return erro('Este usuário não pertence ao seu escritório.', 403);
  if (userId === admin.id) return erro('Você não pode excluir o seu próprio usuário.');

  await sb.from('perfis_empresas').delete().eq('user_id', userId);
  await sb.from('perfis').delete().eq('user_id', userId);
  const { error } = await sb.auth.admin.deleteUser(userId);
  if (error) return erro('Erro ao excluir usuário: ' + error.message, 500);
  return NextResponse.json({ ok: true });
}
