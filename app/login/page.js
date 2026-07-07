'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError('E-mail ou senha incorretos.');
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
          <label>E-mail</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
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
