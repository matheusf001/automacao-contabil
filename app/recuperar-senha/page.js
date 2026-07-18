'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Mail, ArrowLeft } from 'lucide-react';

export default function RecuperarSenhaPage() {
  const [email, setEmail] = useState('');
  const [enviado, setEnviado] = useState(false);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e) {
    e.preventDefault();
    setEnviando(true);
    // Sempre mostramos a mesma mensagem, exista o e-mail ou não —
    // assim ninguém descobre quais e-mails têm cadastro.
    await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/redefinir-senha`,
    }).catch(() => {});
    setEnviado(true);
    setEnviando(false);
  }

  return (
    <div className="auth-bg">
      <div className="plano-form">
        <h3><Mail size={16} style={{ verticalAlign: -3, marginRight: 6 }} />Recuperar senha</h3>
        {enviado ? (
          <p style={{ fontSize: 13.5, color: 'var(--ink-soft)', lineHeight: 1.7 }}>
            Se este e-mail tiver cadastro, você vai receber em instantes um link
            pra criar uma senha nova (vale por 1 hora — confira o spam).<br /><br />
            Sua conta não tem e-mail cadastrado? Peça ao administrador do seu
            escritório pra redefinir sua senha na aba Usuários.
          </p>
        ) : (
          <form onSubmit={enviar}>
            <label>E-mail cadastrado na sua conta</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
            <button className="btn teal full" style={{ marginTop: 14 }} type="submit" disabled={enviando}>
              {enviando ? (<><span className="spinner" /> Enviando…</>) : 'Enviar link de recuperação'}
            </button>
          </form>
        )}
        <a href="/login" style={{ display: 'inline-block', marginTop: 14, fontSize: 12.5, color: 'var(--teal)', textDecoration: 'none' }}>
          <ArrowLeft size={12} style={{ verticalAlign: -2 }} /> Voltar ao login
        </a>
      </div>
    </div>
  );
}
