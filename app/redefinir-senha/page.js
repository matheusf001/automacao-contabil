'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { KeyRound } from 'lucide-react';

export default function RedefinirSenhaPage() {
  const router = useRouter();
  const [pronto, setPronto] = useState(false);      // o link do e-mail cria uma sessão temporária
  const [senha, setSenha] = useState('');
  const [senha2, setSenha2] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    // quando a pessoa chega pelo link do e-mail, o Supabase autentica sozinho
    supabase.auth.getSession().then(({ data: { session } }) => setPronto(!!session));
    const { data: listener } = supabase.auth.onAuthStateChange((_e, session) => setPronto(!!session));
    return () => listener.subscription.unsubscribe();
  }, []);

  async function salvar(e) {
    e.preventDefault();
    setErro('');
    if (senha.length < 8) { setErro('A senha precisa ter pelo menos 8 caracteres.'); return; }
    if (senha !== senha2) { setErro('As senhas não conferem.'); return; }
    setSalvando(true);
    const { error } = await supabase.auth.updateUser({ password: senha });
    setSalvando(false);
    if (error) { setErro('Não deu certo: ' + error.message); return; }
    alert('Senha alterada com sucesso!');
    router.replace('/pagina-inicial');
  }

  return (
    <div className="auth-bg">
      <div className="plano-form">
        <h3><KeyRound size={16} style={{ verticalAlign: -3, marginRight: 6 }} />Criar nova senha</h3>
        {!pronto ? (
          <p style={{ fontSize: 13.5, color: 'var(--ink-soft)', lineHeight: 1.7 }}>
            Abra esta página pelo <strong>link enviado ao seu e-mail</strong>.
            Se o link expirou (vale 1 hora), <a href="/recuperar-senha" style={{ color: 'var(--teal)' }}>peça um novo aqui</a>.
          </p>
        ) : (
          <form onSubmit={salvar}>
            {erro && <div className="login-error">{erro}</div>}
            <label>Nova senha (mínimo 8 caracteres)</label>
            <input type="password" value={senha} onChange={e => setSenha(e.target.value)} required autoFocus />
            <label>Repita a nova senha</label>
            <input type="password" value={senha2} onChange={e => setSenha2(e.target.value)} required />
            <button className="btn teal full" style={{ marginTop: 14 }} type="submit" disabled={salvando}>
              {salvando ? (<><span className="spinner" /> Salvando…</>) : 'Salvar nova senha e entrar'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
