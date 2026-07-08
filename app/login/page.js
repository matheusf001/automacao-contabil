'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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
    setLoading(false);
    if (error) {
      setError('Usuário ou senha incorretos.');
      return;
    }
    router.push('/dashboard');
  }

  return (
    <div className="app">
      <div className="login-wrap">
        <h1>AUTOMAÇÃO CONTÁBIL</h1>
        <div className="sub">acesso restrito</div>
        {error && <div className="login-error">{error}</div>}
        <form onSubmit={handleLogin}>
          <label>Usuário</label>
          <input type="text" value={identifier} onChange={e => setIdentifier(e.target.value)} placeholder="seu nome de usuário" required autoFocus />
          <label>Senha</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
          <button className="btn teal" type="submit" disabled={loading} style={{ width: '100%' }}>
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
