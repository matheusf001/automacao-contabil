'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { Eye, EyeOff, Lock, User, ArrowRight } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [saindo, setSaindo] = useState(false); // animação de saída quando o login dá certo

  async function handleLogin(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    let emailToUse = identifier.trim();
    if (!emailToUse.includes('@')) {
      const { data: resolvedEmail, error: lookupError } = await supabase.rpc('login_lookup', { p_username: emailToUse });
      if (lookupError || !resolvedEmail) {
        setError('Usuário não encontrado.');
        setLoading(false);
        return;
      }
      emailToUse = resolvedEmail;
    }

    const { error } = await supabase.auth.signInWithPassword({ email: emailToUse, password });
    if (error) {
      setLoading(false);
      setError('Usuário ou senha incorretos.');
      return;
    }
    // pequena animação de "virada" antes de ir pro dashboard
    setSaindo(true);
    setTimeout(() => router.push('/dashboard'), 520);
  }

  return (
    <div className="auth-bg">
      <div className={'auth-card' + (saindo ? ' auth-leaving' : '')}>
        {/* painel esquerdo — gradiente animado com a marca */}
        <div className="auth-side">
          <div className="auth-side-inner">
            <img src="/logo-branca.png" alt="AutoContax" className="auth-side-logo" />
            <h2>Bom te ver<br />de novo.</h2>
            <p>Seus extratos, regras e importações estão exatamente onde você deixou. Entre e continue de onde parou.</p>
            <div className="auth-side-foot">Acesso seguro · Dados no Supabase</div>
          </div>
          <div className="auth-blob b1" />
          <div className="auth-blob b2" />
        </div>

        {/* painel direito — formulário */}
        <div className="auth-form">
          <img src="/logo.png" alt="AutoContax" className="auth-logo-img" />
          <div className="auth-sub">acesso restrito da equipe</div>

          {error && <div className="login-error auth-shake">{error}</div>}

          <form onSubmit={handleLogin}>
            <label>Usuário</label>
            <div className="auth-field">
              <User size={15} />
              <input type="text" value={identifier} onChange={e => setIdentifier(e.target.value)}
                placeholder="seu nome de usuário" required autoFocus autoComplete="username" />
            </div>

            <label>Senha</label>
            <div className="auth-field">
              <Lock size={15} />
              <input type={showPass ? 'text' : 'password'} value={password}
                onChange={e => setPassword(e.target.value)} required autoComplete="current-password" />
              <button type="button" className="auth-eye" title={showPass ? 'Esconder senha' : 'Mostrar senha'}
                onClick={() => setShowPass(v => !v)} tabIndex={-1}>
                {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>

            <button className="auth-submit" type="submit" disabled={loading}>
              {loading ? (<><span className="spinner" /> Entrando…</>) : (<>Entrar <ArrowRight size={15} /></>)}
            </button>
            <a href="/recuperar-senha" className="auth-esqueci">Esqueci minha senha</a>
          </form>
        </div>
      </div>
    </div>
  );
}
