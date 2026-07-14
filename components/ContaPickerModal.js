'use client';
import { useState, useEffect, useRef } from 'react';

function depthOf(classificacao) {
  if (!classificacao) return 0;
  return (String(classificacao).match(/\./g) || []).length;
}

export default function ContaPickerModal({ contas, onSelect, onClose }) {
  const [search, setSearch] = useState('');
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const f = search.trim().toLowerCase();
  const filtradas = f
    ? contas.filter(c => String(c.codigo).includes(f) || (c.descricao || '').toLowerCase().includes(f) || (c.classificacao || '').includes(f))
    : contas;
  const limitadas = filtradas.slice(0, 400);

  return (
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker-panel" onClick={e => e.stopPropagation()}>
        <div className="picker-header">
          <input
            ref={inputRef}
            type="text"
            className="picker-search"
            placeholder="Buscar por código, classificação ou descrição… (Esc para fechar)"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button className="btn secondary" onClick={onClose}>Fechar</button>
        </div>
        <div className="picker-list">
          {limitadas.length === 0 && <div className="empty-state">Nenhuma conta encontrada.</div>}
          {limitadas.map(c => {
            const sintetica = c.tipo === 'S';
            return (
              <div
                key={c.id}
                className={'picker-row' + (sintetica ? ' picker-row-disabled' : '')}
                style={{ paddingLeft: 14 + depthOf(c.classificacao) * 18 }}
                onClick={() => { if (!sintetica) { onSelect(c); onClose(); } }}
                title={sintetica ? 'Conta Sintética — apenas totalização, não pode receber lançamentos' : ''}
              >
                <span className="picker-codigo">{c.codigo}</span>
                <span className="picker-class">{c.classificacao}</span>
                <span className="picker-desc">{c.descricao}</span>
                {sintetica
                  ? <span className="badge warn">Sintética</span>
                  : (c.tipo === 'A' ? <span className="badge ok">Analítica</span> : null)}
              </div>
            );
          })}
          {filtradas.length > 400 && <div className="picker-more">mostrando as 400 primeiras — refine a busca</div>}
        </div>
      </div>
    </div>
  );
}
