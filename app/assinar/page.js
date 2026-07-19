'use client';
import { useState } from 'react';
import { PLANOS, formatarPreco } from '@/lib/planos';
import { Check, ArrowRight, Building2 } from 'lucide-react';

export default function AssinarPage() {
  const [planoEscolhido, setPlanoEscolhido] = useState(null);
  const [form, setForm] = useState({ nome: '', gerente_username: '', gerente_email: '', gerente_password: '' });
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');

  async function assinar() {
    setErro('');
    setEnviando(true);
    try {
      const res = await fetch('/api/assinatura/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, plano: planoEscolhido.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(json.error || 'Erro ao criar a assinatura.'); return; }
      window.location.href = json.checkout_url; // vai pro pagamento no Mercado Pago
    } catch {
      setErro('Falha de conexão — tente novamente.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="assinar-bg">
      <div className="assinar-wrap">
        <img src="/logo.png" alt="AutoContax" style={{ height: 44, width: 'auto', display: 'block', margin: '0 auto' }} />
        <p className="assinar-sub">Classificação de extratos bancários com regras e IA, pronta pra importar no Domínio.<br />Escolha o plano, pague com cartão pelo Mercado Pago e o acesso libera sozinho.</p>

        {!planoEscolhido ? (
          <div className="planos-grid">
            {PLANOS.map(p => (
              <div key={p.id} className={'plano-card' + (p.destaque ? ' destaque' : '')}>
                {p.destaque && <div className="plano-tag">MAIS ESCOLHIDO</div>}
                <h3>{p.nome}</h3>
                <div className="plano-preco">{formatarPreco(p.preco_mensal)}<span>/mês</span></div>
                <div className="plano-desc">{p.descricao}</div>
                <ul>
                  {p.itens.map((i, k) => <li key={k}><Check size={13} /> {i}</li>)}
                </ul>
                <button className="btn teal full" onClick={() => setPlanoEscolhido(p)}>
                  Assinar {p.nome} <ArrowRight size={14} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="plano-form">
            <h3><Building2 size={16} style={{ verticalAlign: -3, marginRight: 6 }} />Criar conta — Plano {planoEscolhido.nome} ({formatarPreco(planoEscolhido.preco_mensal)}/mês)</h3>
            {erro && <div className="login-error">{erro}</div>}
            <label>Nome do escritório</label>
            <input type="text" placeholder="ex: Contabilidade Silva & Souza" value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} />
            <label>Seu nome de usuário (pra entrar no sistema)</label>
            <input type="text" placeholder="ex: silva.gerente — letras minúsculas, sem espaço" value={form.gerente_username} onChange={e => setForm(f => ({ ...f, gerente_username: e.target.value }))} />
            <label>Seu e-mail (cobrança e recuperação de senha)</label>
            <input type="email" placeholder="ex: contato@seuescritorio.com.br" value={form.gerente_email} onChange={e => setForm(f => ({ ...f, gerente_email: e.target.value }))} />
            <label>Senha (mínimo 8 caracteres)</label>
            <input type="password" value={form.gerente_password} onChange={e => setForm(f => ({ ...f, gerente_password: e.target.value }))} />
            <button className="btn teal full" style={{ marginTop: 14 }} onClick={assinar}
              disabled={enviando || !form.nome || !form.gerente_username || !form.gerente_email || form.gerente_password.length < 8}>
              {enviando ? (<><span className="spinner" /> Preparando pagamento…</>) : 'Continuar para o pagamento seguro'}
            </button>
            <button className="btn secondary full" style={{ marginTop: 8 }} onClick={() => setPlanoEscolhido(null)}>Voltar aos planos</button>
            <p className="assinar-nota">Pagamento mensal recorrente no cartão, processado pelo Mercado Pago. Cancele quando quiser. Após a confirmação, entre em <strong>/login</strong> com o usuário e a senha criados aqui.</p>
          </div>
        )}
      </div>
    </div>
  );
}
