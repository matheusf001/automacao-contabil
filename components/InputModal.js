'use client';
import { useState, useEffect, useRef } from 'react';

// Modal de entrada de texto que substitui o window.prompt() nativo.
// Segue o mesmo padrão visual do ContaPickerModal / modal genérico:
// fundo escurecido, cartão branco arredondado, Enter confirma, Esc cancela, clique fora cancela.
export default function InputModal({
  titulo,
  texto,            // texto de apoio opcional (aparece abaixo do título)
  label,            // rótulo opcional acima do campo
  valorInicial = '',
  placeholder = '',
  confirmarLabel = 'Confirmar',
  onConfirm,        // recebe o valor digitado (string)
  onClose,          // cancelar (Esc, clique fora ou botão)
}) {
  const [valor, setValor] = useState(valorInicial);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={e => e.stopPropagation()}>
        <h3>{titulo}</h3>
        {texto && <p className="hint">{texto}</p>}
        {label && <div className="field-label">{label}</div>}
        <input
          ref={inputRef}
          type="text"
          style={{ width: '100%' }}
          value={valor}
          placeholder={placeholder}
          onChange={e => setValor(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onConfirm(valor); }}
        />
        <div className="modal-actions">
          <button className="btn secondary" onClick={onClose}>Cancelar</button>
          <button className="btn teal" onClick={() => onConfirm(valor)}>{confirmarLabel}</button>
        </div>
      </div>
    </div>
  );
}
