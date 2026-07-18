'use client';
import { CheckCircle2 } from 'lucide-react';

export default function ObrigadoPage() {
  return (
    <div className="assinar-bg">
      <div className="plano-form" style={{ textAlign: 'center', marginTop: 80 }}>
        <CheckCircle2 size={46} color="#16A34A" style={{ margin: '0 auto 12px' }} />
        <h3>Pagamento em processamento!</h3>
        <p style={{ fontSize: 13.5, color: 'var(--ink-soft)', lineHeight: 1.7 }}>
          Assim que o Mercado Pago confirmar (normalmente em instantes),
          seu acesso é liberado automaticamente.<br />
          Entre com o usuário e a senha que você criou no cadastro.
        </p>
        <a href="/login" className="btn teal full" style={{ textDecoration: 'none', display: 'block', textAlign: 'center', marginTop: 10 }}>Ir para o login</a>
      </div>
    </div>
  );
}
