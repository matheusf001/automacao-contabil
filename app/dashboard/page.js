'use client';
import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { parsePlanoFile, parsePlanoPaste, parseExtrato, classificar, downloadFile } from '@/lib/planoParser';

const TABS = ['empresas', 'extrato', 'regras', 'contas', 'importacao', 'historico'];
const TAB_LABELS = {
  empresas: '01 · EMPRESAS',
  extrato: '02 · EXTRATO',
  regras: '03 · REGRAS',
  contas: '04 · PLANO DE CONTAS',
  importacao: '05 · IMPORTAÇÃO',
  historico: '06 · HISTÓRICO',
};

function fingerprintOf(data, valor, historico) {
  return `${data}|${valor}|${historico}`.trim().toUpperCase().replace(/\s+/g, ' ');
}

function fmtData(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('pt-BR');
}

export default function Dashboard() {
  const router = useRouter();
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [userEmail, setUserEmail] = useState('');
  const [role, setRole] = useState('operador');
  const isAdmin = role === 'admin';

  const [tab, setTab] = useState('empresas');
  const [empresas, setEmpresas] = useState([]);
  const [currentEmpresaId, setCurrentEmpresaId] = useState(null);
  const [planoContas, setPlanoContas] = useState([]);
  const [regras, setRegras] = useState([]);
  const [layouts, setLayouts] = useState([]);
  const [currentLayoutId, setCurrentLayoutId] = useState(null);
  const [contaBancaria, setContaBancaria] = useState(null);

  const [contasSearch, setContasSearch] = useState('');
  const [extratoText, setExtratoText] = useState('');
  const [processedRows, setProcessedRows] = useState([]);
  const [confirmado, setConfirmado] = useState(false);
  const [processando, setProcessando] = useState(false);
  const [importStatus, setImportStatus] = useState('');
  const [destEmpresaImport, setDestEmpresaImport] = useState(null);
  const [saveFlag, setSaveFlag] = useState('');
  const [historico, setHistorico] = useState([]);

  const fileInputRef = useRef(null);
  const pasteRef = useRef(null);

  // ---------- AUTH ----------
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.replace('/login'); return; }
      setUserEmail(session.user.email);
      const { data: perfil } = await supabase.from('perfis').select('role').eq('user_id', session.user.id).maybeSingle();
      setRole(perfil?.role || 'operador');
      setCheckingAuth(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) router.replace('/login');
    });
    return () => listener.subscription.unsubscribe();
  }, [router]);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace('/login');
  }

  // ---------- LOAD DATA ----------
  useEffect(() => { if (!checkingAuth) { loadEmpresas(); loadLayouts(); } }, [checkingAuth]);

  useEffect(() => {
    if (currentEmpresaId) { loadPlanoContas(currentEmpresaId); loadRegras(currentEmpresaId); loadHistorico(currentEmpresaId); }
  }, [currentEmpresaId]);

  useEffect(() => {
    if (currentEmpresaId && currentLayoutId) loadContaBancaria(currentEmpresaId, currentLayoutId);
  }, [currentEmpresaId, currentLayoutId]);

  async function loadEmpresas() {
    const { data, error } = await supabase.from('empresas').select('*').order('nome');
    if (error) { console.error(error); return; }
    setEmpresas(data || []);
    if (data && data.length && !currentEmpresaId) {
      setCurrentEmpresaId(data[0].id);
      setDestEmpresaImport(data[0].id);
    }
  }

  async function loadPlanoContas(empresaId) {
    const { data, error } = await supabase.from('plano_contas').select('*').eq('empresa_id', empresaId).order('codigo');
    if (error) { console.error(error); return; }
    setPlanoContas(data || []);
  }

  async function loadRegras(empresaId) {
    const { data, error } = await supabase.from('regras').select('*').eq('empresa_id', empresaId).order('ordem');
    if (error) { console.error(error); return; }
    setRegras(data || []);
  }

  async function loadLayouts() {
    const { data, error } = await supabase.from('layouts_banco').select('*').order('nome');
    if (error) { console.error(error); return; }
    setLayouts(data || []);
    if (data && data.length) setCurrentLayoutId(data[0].id);
  }

  async function loadContaBancaria(empresaId, layoutId) {
    const { data, error } = await supabase.from('empresa_layout_conta').select('conta_codigo')
      .eq('empresa_id', empresaId).eq('layout_id', layoutId).maybeSingle();
    if (error) { console.error(error); return; }
    if (data) { setContaBancaria(data.conta_codigo); return; }
    const emp = empresas.find(e => e.id === empresaId);
    setContaBancaria(emp?.conta_banco_fixa || null);
  }

  async function salvarContaBancaria(codigo) {
    setContaBancaria(codigo || null);
    if (!codigo || !currentEmpresaId || !currentLayoutId) return;
    const { error } = await supabase.from('empresa_layout_conta')
      .upsert({ empresa_id: currentEmpresaId, layout_id: currentLayoutId, conta_codigo: codigo }, { onConflict: 'empresa_id,layout_id' });
    if (error) { alert('Erro ao salvar conta bancária: ' + error.message); return; }
    flash('salvo ✓');
  }

  async function loadHistorico(empresaId) {
    const { data, error } = await supabase.from('extratos_processados').select('*')
      .eq('empresa_id', empresaId).order('processado_em', { ascending: false }).limit(50);
    if (error) { console.error(error); return; }
    setHistorico(data || []);
  }

  function flash(msg) { setSaveFlag(msg); setTimeout(() => setSaveFlag(''), 1200); }

  // ---------- EMPRESAS (admin) ----------
  async function criarEmpresa() {
    const nome = prompt('Nome da nova empresa:');
    if (!nome || !nome.trim()) return;
    const { data, error } = await supabase.from('empresas').insert({ nome: nome.trim() }).select().single();
    if (error) { alert('Erro ao criar empresa: ' + error.message); return; }
    await loadEmpresas();
    setCurrentEmpresaId(data.id);
  }
  async function renomearEmpresa(emp) {
    const novoNome = prompt('Novo nome da empresa:', emp.nome);
    if (!novoNome || !novoNome.trim()) return;
    const { error } = await supabase.from('empresas').update({ nome: novoNome.trim() }).eq('id', emp.id);
    if (error) { alert('Erro ao renomear: ' + error.message); return; }
    loadEmpresas();
  }
  async function excluirEmpresa(emp) {
    if (empresas.length <= 1) { alert('Precisa manter ao menos uma empresa.'); return; }
    if (!confirm(`Excluir "${emp.nome}" e todos os dados dela? Não pode ser desfeito.`)) return;
    const { error } = await supabase.from('empresas').delete().eq('id', emp.id);
    if (error) { alert('Erro ao excluir: ' + error.message); return; }
    if (currentEmpresaId === emp.id) setCurrentEmpresaId(null);
    loadEmpresas();
  }

  // ---------- IMPORTAR PLANO DE CONTAS (admin) ----------
  async function importarPlano() {
    setImportStatus('');
    let novoPlano = [];
    try {
      if (fileInputRef.current?.files?.[0]) {
        novoPlano = await parsePlanoFile(fileInputRef.current.files[0]);
      } else if (pasteRef.current?.value?.trim()) {
        novoPlano = parsePlanoPaste(pasteRef.current.value.trim());
      } else {
        setImportStatus('Selecione um arquivo ou cole os dados.');
        return;
      }
    } catch (err) {
      setImportStatus('Erro ao processar: ' + err.message);
      return;
    }
    if (novoPlano.length === 0) {
      setImportStatus('Nenhuma conta reconhecida no arquivo/texto enviado.');
      return;
    }
    const destEmp = empresas.find(e => e.id === destEmpresaImport);
    if (!confirm(`Importar ${novoPlano.length} contas para "${destEmp?.nome}"? Isso substitui o plano de contas atual dessa empresa.`)) return;

    setImportStatus('Importando…');
    const { error: delError } = await supabase.from('plano_contas').delete().eq('empresa_id', destEmpresaImport);
    if (delError) { setImportStatus('Erro ao limpar plano anterior: ' + delError.message); return; }

    const chunkSize = 500;
    for (let i = 0; i < novoPlano.length; i += chunkSize) {
      const chunk = novoPlano.slice(i, i + chunkSize).map(c => ({ ...c, empresa_id: destEmpresaImport, updated_by: userEmail, updated_at: new Date().toISOString() }));
      const { error } = await supabase.from('plano_contas').insert(chunk);
      if (error) { setImportStatus('Erro ao importar: ' + error.message); return; }
    }
    setImportStatus(`✔ ${novoPlano.length} contas importadas com sucesso.`);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (pasteRef.current) pasteRef.current.value = '';
    if (destEmpresaImport === currentEmpresaId) loadPlanoContas(currentEmpresaId);
  }

  // ---------- REGRAS ----------
  async function addRegra() {
    const maxOrdem = regras.reduce((m, r) => Math.max(m, r.ordem || 0), 0);
    const { error } = await supabase.from('regras').insert({
      empresa_id: currentEmpresaId, palavra_chave: '', codigo: 0, descricao: '', ordem: maxOrdem + 1,
      updated_by: userEmail, updated_at: new Date().toISOString(),
    });
    if (error) { alert('Erro: ' + error.message); return; }
    loadRegras(currentEmpresaId);
  }
  async function updateRegra(regra, field, value) {
    const patch = { [field]: field === 'codigo' ? (parseInt(value) || 0) : value, updated_by: userEmail, updated_at: new Date().toISOString() };
    const { error } = await supabase.from('regras').update(patch).eq('id', regra.id);
    if (error) { alert('Erro: ' + error.message); return; }
    flash('salvo ✓');
    loadRegras(currentEmpresaId);
  }
  async function deleteRegra(regra) {
    const { error } = await supabase.from('regras').delete().eq('id', regra.id);
    if (error) { alert('Erro: ' + error.message); return; }
    loadRegras(currentEmpresaId);
  }
  async function moveRegra(regra, direction) {
    const idx = regras.findIndex(r => r.id === regra.id);
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= regras.length) return;
    const other = regras[targetIdx];
    await supabase.from('regras').update({ ordem: other.ordem }).eq('id', regra.id);
    await supabase.from('regras').update({ ordem: regra.ordem }).eq('id', other.id);
    loadRegras(currentEmpresaId);
  }

  function extractCodigoFromPicked(value) {
    const m = String(value).trim().match(/^(\d+)/);
    return m ? parseInt(m[1]) : 0;
  }
  function findContaDesc(codigo) {
    const c = planoContas.find(c => String(c.codigo) === String(codigo));
    return c ? c.descricao : '';
  }
  const regrasInvalidas = regras.filter(r => r.codigo && !findContaDesc(r.codigo));

  // ---------- PLANO DE CONTAS (edição manual, admin) ----------
  async function addContaManual() {
    const { error } = await supabase.from('plano_contas').insert({ empresa_id: currentEmpresaId, codigo: 0, classificacao: '', descricao: '', updated_by: userEmail, updated_at: new Date().toISOString() });
    if (error) { alert('Erro: ' + error.message); return; }
    loadPlanoContas(currentEmpresaId);
  }
  async function updateConta(conta, field, value) {
    const patch = { [field]: field === 'codigo' ? (parseInt(value) || 0) : value, updated_by: userEmail, updated_at: new Date().toISOString() };
    const { error } = await supabase.from('plano_contas').update(patch).eq('id', conta.id);
    if (error) { alert('Erro: ' + error.message); return; }
    flash('salvo ✓');
  }
  async function deleteConta(conta) {
    const { error } = await supabase.from('plano_contas').delete().eq('id', conta.id);
    if (error) { alert('Erro: ' + error.message); return; }
    loadPlanoContas(currentEmpresaId);
  }

  // ---------- LAYOUTS (admin) ----------
  const currentLayout = layouts.find(l => String(l.id) === String(currentLayoutId)) || null;
  async function novoLayout() {
    const nome = prompt('Nome do novo layout (ex: nome do banco):');
    if (!nome || !nome.trim()) return;
    const base = currentLayout || { separador: 'auto', col_data: 0, col_historico: 2, col_valor: 1, cd_mode: 'coluna', col_cd: 3, col_detalhamento: 4 };
    const { data, error } = await supabase.from('layouts_banco').insert({ ...base, id: undefined, nome: nome.trim() }).select().single();
    if (error) { alert('Erro: ' + error.message); return; }
    await loadLayouts();
    setCurrentLayoutId(data.id);
  }
  async function excluirLayout() {
    if (layouts.length <= 1) { alert('Precisa manter ao menos um layout.'); return; }
    if (!confirm(`Excluir layout "${currentLayout.nome}"?`)) return;
    await supabase.from('layouts_banco').delete().eq('id', currentLayoutId);
    setCurrentLayoutId(null);
    loadLayouts();
  }
  async function salvarLayout(patch) {
    const { error } = await supabase.from('layouts_banco').update(patch).eq('id', currentLayoutId);
    if (error) { alert('Erro: ' + error.message); return; }
    flash('salvo ✓');
    loadLayouts();
  }

  // ---------- EXTRATO ----------
  async function processarExtrato() {
    if (!contaBancaria) { alert('Escolha a conta bancária desta importação na aba EXTRATO antes de processar.'); return; }
    if (!currentLayout) { alert('Selecione um layout de banco na aba EXTRATO.'); return; }
    setProcessando(true);
    setConfirmado(false);
    const rows = parseExtrato(extratoText, currentLayout);
    const classificado = classificar(rows, regras, contaBancaria);

    const withFingerprint = classificado.map(r => ({ ...r, fingerprint: fingerprintOf(r.data, r.valor, r.historico) }));
    const fps = withFingerprint.map(r => r.fingerprint);
    let existentes = new Set();
    const chunkSize = 200;
    for (let i = 0; i < fps.length; i += chunkSize) {
      const chunk = fps.slice(i, i + chunkSize);
      const { data, error } = await supabase.from('lancamentos_importados').select('fingerprint')
        .eq('empresa_id', currentEmpresaId).in('fingerprint', chunk);
      if (error) { console.error(error); continue; }
      (data || []).forEach(d => existentes.add(d.fingerprint));
    }
    const marcado = withFingerprint.map(r => existentes.has(r.fingerprint) ? { ...r, status: 'duplicado' } : r);
    setProcessedRows(marcado);
    setProcessando(false);
  }

  async function confirmarImportacao() {
    if (processedRows.length === 0) return;
    const naoDuplicados = processedRows.filter(r => r.status !== 'duplicado');
    if (naoDuplicados.length === 0) { alert('Todos os lançamentos já foram importados antes — nada novo para salvar.'); return; }

    const { data: extrato, error: errExtrato } = await supabase.from('extratos_processados').insert({
      empresa_id: currentEmpresaId,
      layout_id: currentLayoutId,
      conta_codigo: contaBancaria,
      total_lancamentos: processedRows.length,
      total_classificados: processedRows.filter(r => r.status === 'automatico').length,
      total_sem_match: processedRows.filter(r => r.status === 'sem match').length,
      total_duplicados: processedRows.filter(r => r.status === 'duplicado').length,
      processado_por: userEmail,
    }).select().single();
    if (errExtrato) { alert('Erro ao salvar histórico: ' + errExtrato.message); return; }

    const linhas = naoDuplicados.map(r => ({
      empresa_id: currentEmpresaId, extrato_id: extrato.id, fingerprint: r.fingerprint,
      data: r.data, valor: r.valor, historico: r.historico, detalhamento: r.detalhamento, cd: r.cd,
      conta_credora: r.contaCredora || null, conta_devedora: r.contaDevedora || null, status: r.status,
    }));
    const chunkSize = 300;
    for (let i = 0; i < linhas.length; i += chunkSize) {
      const { error } = await supabase.from('lancamentos_importados').insert(linhas.slice(i, i + chunkSize));
      if (error) { alert('Erro ao salvar lançamentos: ' + error.message); return; }
    }
    setConfirmado(true);
    loadHistorico(currentEmpresaId);
  }

  function exportarImportacao(onlyMatched) {
    let csv = 'DATA;CONTA CREDORA;CONTA DEVEDORA;VALOR;HISTORICO;STATUS\n';
    processedRows.forEach(r => {
      if (r.status === 'duplicado') return;
      if (onlyMatched && r.status !== 'automatico') return;
      const historicoFull = r.detalhamento ? `${r.historico} - ${r.detalhamento}` : r.historico;
      csv += `${r.data};${r.contaCredora};${r.contaDevedora};${r.valor};"${historicoFull.replace(/"/g, "'")}";${r.status}\n`;
    });
    downloadFile(csv, (onlyMatched ? 'importacao_classificados_' : 'importacao_') + currentEmpresaId + '.csv');
  }

  if (checkingAuth) return <div className="center-loading">verificando sessão…</div>;

  const empresaAtiva = empresas.find(e => e.id === currentEmpresaId);
  const contasFiltradas = planoContas.filter(c => {
    const f = contasSearch.toLowerCase();
    return !f || String(c.codigo).includes(f) || (c.descricao || '').toLowerCase().includes(f);
  }).slice(0, 500);

  return (
    <div className="app">
      <datalist id="contas-datalist">
        {planoContas.map(c => <option key={c.id} value={`${c.codigo} — ${c.descricao}`} />)}
      </datalist>

      <header className="top">
        <div>
          <h1>AUTOMAÇÃO <span>CONTÁBIL</span></h1>
          <div className="subtitle">{userEmail} · <span className="pill">{isAdmin ? 'admin' : 'operador'}</span> · <a href="#" onClick={(e) => { e.preventDefault(); handleLogout(); }} style={{ color: 'var(--teal)' }}>sair</a></div>
        </div>
        <div className="empresa-picker">
          <label>EMPRESA ATIVA</label>
          <select value={currentEmpresaId || ''} onChange={e => setCurrentEmpresaId(e.target.value)}>
            {empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
        </div>
      </header>

      <nav className="tabs">
        {TABS.map(t => (
          <button key={t} className={'tab-btn' + (tab === t ? ' active' : '')} onClick={() => setTab(t)}>
            {TAB_LABELS[t]}
          </button>
        ))}
      </nav>

      {tab === 'empresas' && (
        <section className="panel">
          <h2>Empresas cadastradas</h2>
          <p className="hint">Cada empresa tem seu próprio plano de contas e regras. Dados no banco — visíveis para todos que fizerem login.
            {!isAdmin && <> Você está como <strong>operador</strong>: pode processar extratos, mas criar/editar empresas, plano de contas e regras é só para admin.</>}
          </p>
          {isAdmin && (
            <div className="row" style={{ marginTop: 0 }}>
              <button className="btn teal" onClick={criarEmpresa}>+ Nova empresa</button>
            </div>
          )}
          <div style={{ marginTop: 16 }}>
            {empresas.map(emp => (
              <div key={emp.id} className={'empresa-row' + (emp.id === currentEmpresaId ? ' active' : '')}>
                <div>
                  <div className="name">{emp.nome}</div>
                  <div className="meta">conta banco fixa (padrão): {emp.conta_banco_fixa ?? '—'}</div>
                </div>
                <div className="row" style={{ margin: 0 }}>
                  <button className="btn secondary" onClick={() => setCurrentEmpresaId(emp.id)}>Usar</button>
                  {isAdmin && <button className="btn secondary" onClick={() => renomearEmpresa(emp)}>Renomear</button>}
                  {isAdmin && <button className="btn danger" onClick={() => excluirEmpresa(emp)}>Excluir</button>}
                </div>
              </div>
            ))}
          </div>

          {isAdmin && (
            <div className="card" style={{ marginTop: 20 }}>
              <h3>Importar / substituir plano de contas de uma empresa</h3>
              <p className="hint" style={{ marginBottom: 10 }}>Envie o .xls/.xlsx/.csv exportado do Domínio, ou cole manualmente <code>codigo;classificacao;descricao</code> por linha.</p>
              <div className="row" style={{ marginTop: 0 }}>
                <label style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>Empresa de destino:</label>
                <select value={destEmpresaImport || ''} onChange={e => setDestEmpresaImport(e.target.value)}>
                  {empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
                </select>
              </div>
              <div className="row"><input type="file" ref={fileInputRef} accept=".xls,.xlsx,.csv,.txt" /></div>
              <textarea ref={pasteRef} placeholder={'8;1.1.1.02.001;BANCO DO BRASIL'} style={{ minHeight: 80, marginTop: 8 }} />
              <div className="row">
                <button className="btn" onClick={importarPlano}>Importar (substitui o plano de contas atual)</button>
                <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{importStatus}</span>
              </div>
            </div>
          )}
        </section>
      )}

      {tab === 'extrato' && (
        <section className="panel">
          <h2>Colar extrato bancário — <span style={{ color: 'var(--teal)' }}>{empresaAtiva?.nome}</span></h2>

          <div className="card">
            <h3>Layout do banco</h3>
            <p className="hint" style={{ marginBottom: 10 }}>Cole uma linha real, confira a prévia e ajuste as colunas (contando a partir de 0) antes de salvar.</p>
            <div className="row" style={{ marginTop: 0 }}>
              <label style={{ fontSize: 12.5 }}>Layout:</label>
              <select value={currentLayoutId || ''} onChange={e => setCurrentLayoutId(e.target.value)}>
                {layouts.map(l => <option key={l.id} value={l.id}>{l.nome}</option>)}
              </select>
              {isAdmin && <button className="btn secondary" onClick={novoLayout}>+ Novo layout</button>}
              {isAdmin && <button className="btn danger" onClick={excluirLayout}>Excluir layout</button>}
            </div>
            {currentLayout && (
              <div className="row">
                <label style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>Conta bancária desta importação:</label>
                <input type="text" list="contas-datalist" placeholder="buscar conta…" style={{ minWidth: 280 }}
                  defaultValue={contaBancaria ? `${contaBancaria} — ${findContaDesc(contaBancaria)}` : ''}
                  key={`${currentEmpresaId}-${currentLayoutId}`}
                  onBlur={e => salvarContaBancaria(extractCodigoFromPicked(e.target.value))} />
                <span className={'save-flag' + (saveFlag ? ' show' : '')}>{saveFlag}</span>
              </div>
            )}
            {isAdmin && currentLayout && (
              <>
                <div className="row">
                  <label style={{ fontSize: 12.5 }}>Separador:</label>
                  <select value={currentLayout.separador} onChange={e => salvarLayout({ separador: e.target.value })}>
                    <option value="auto">Auto (tab ou ;)</option>
                    <option value="tab">Tabulação</option>
                    <option value=";">Ponto e vírgula ( ; )</option>
                    <option value=",">Vírgula ( , )</option>
                  </select>
                  <label style={{ fontSize: 12.5 }}>Col. Data:</label>
                  <input type="number" style={{ width: 56 }} value={currentLayout.col_data} onChange={e => salvarLayout({ col_data: parseInt(e.target.value) || 0 })} />
                  <label style={{ fontSize: 12.5 }}>Col. Histórico:</label>
                  <input type="number" style={{ width: 56 }} value={currentLayout.col_historico} onChange={e => salvarLayout({ col_historico: parseInt(e.target.value) || 0 })} />
                  <label style={{ fontSize: 12.5 }}>Col. Valor:</label>
                  <input type="number" style={{ width: 56 }} value={currentLayout.col_valor} onChange={e => salvarLayout({ col_valor: parseInt(e.target.value) || 0 })} />
                </div>
                <div className="row">
                  <label style={{ fontSize: 12.5 }}>C/D por:</label>
                  <select value={currentLayout.cd_mode} onChange={e => salvarLayout({ cd_mode: e.target.value })}>
                    <option value="coluna">Coluna específica</option>
                    <option value="sinal">Sinal do valor (negativo = débito)</option>
                  </select>
                  <label style={{ fontSize: 12.5 }}>Col. C/D:</label>
                  <input type="number" style={{ width: 56 }} value={currentLayout.col_cd} onChange={e => salvarLayout({ col_cd: parseInt(e.target.value) || 0 })} />
                  <label style={{ fontSize: 12.5 }}>Col. Detalhamento (-1 = nenhuma):</label>
                  <input type="number" style={{ width: 56 }} value={currentLayout.col_detalhamento} onChange={e => salvarLayout({ col_detalhamento: parseInt(e.target.value) })} />
                </div>
              </>
            )}
          </div>

          <p className="hint">Cole as linhas do extrato conforme o layout selecionado.</p>
          <textarea value={extratoText} onChange={e => { setExtratoText(e.target.value); setConfirmado(false); }}
            placeholder={'01/07/2026\t1250,00\tPIX RECEBIDO\tC\tCLIENTE XYZ LTDA'} />
          <div className="row">
            <button className="btn teal" onClick={processarExtrato} disabled={processando}>{processando ? 'Processando…' : 'Processar extrato'}</button>
            <button className="btn secondary" onClick={() => { setExtratoText(''); setProcessedRows([]); setConfirmado(false); }}>Limpar</button>
          </div>

          {processedRows.length > 0 && (
            <>
              <div className="stats">
                <div className="stat">{processedRows.length} lançamentos</div>
                <div className="stat ok">{processedRows.filter(r => r.status === 'automatico').length} classificados</div>
                <div className="stat warn">{processedRows.filter(r => r.status === 'sem match').length} sem correspondência</div>
                {processedRows.some(r => r.status === 'duplicado') && (
                  <div className="stat warn" style={{ background: '#F1E3E3', color: '#A33', borderColor: '#E0C4C4' }}>
                    {processedRows.filter(r => r.status === 'duplicado').length} já importados antes (duplicado)
                  </div>
                )}
              </div>
              <div className="row" style={{ marginTop: 6 }}>
                {!confirmado ? (
                  <button className="btn teal" onClick={confirmarImportacao}>Confirmar importação (salva no histórico)</button>
                ) : (
                  <span className="stat ok">✔ importação confirmada e salva no histórico</span>
                )}
              </div>
              <div className="table-wrap"><table>
                <thead><tr><th>DATA</th><th className="num">VALOR</th><th>HISTÓRICO</th><th>DETALHAMENTO</th><th>C/D</th><th className="num">CRED.</th><th className="num">DEV.</th><th>STATUS</th></tr></thead>
                <tbody>
                  {processedRows.map((r, i) => (
                    <tr key={i} className={r.status !== 'automatico' ? 'warn-row' : ''}>
                      <td className="mono">{r.data}</td><td className="num">{r.valor}</td><td>{r.historico}</td>
                      <td>{r.detalhamento}</td><td className="mono">{r.cd}</td>
                      <td className="num">{r.contaCredora}</td><td className="num">{r.contaDevedora}</td>
                      <td>
                        {r.status === 'automatico' && <span className="badge ok">✔ automatico</span>}
                        {r.status === 'sem match' && <span className="badge warn">⚠ sem match</span>}
                        {r.status === 'duplicado' && <span className="badge warn" style={{ background: '#F1E3E3', color: '#A33' }}>⚠ duplicado</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </>
          )}
        </section>
      )}

      {tab === 'regras' && (
        <section className="panel">
          <h2>Regras de classificação — <span style={{ color: 'var(--teal)' }}>{empresaAtiva?.nome}</span></h2>
          <p className="hint">Palavra-chave → código contábil. Quando mais de uma regra combina, prevalece a <strong>última da lista</strong> (use as setas ↑↓ para reordenar).</p>
          <div className="stats">
            <div className="stat">{regras.length} regras</div>
            {regrasInvalidas.length > 0 && (
              <div className="stat warn">⚠ {regrasInvalidas.length} regra(s) com código que não existe no plano de contas</div>
            )}
          </div>
          {isAdmin && (
            <div className="row">
              <button className="btn" onClick={addRegra}>+ Nova regra</button>
            </div>
          )}
          <div className="table-wrap" style={{ marginTop: 14 }}>
            <table>
              <thead><tr><th style={{ width: 50 }}></th><th style={{ width: '30%' }}>PALAVRA-CHAVE</th><th style={{ width: '12%' }}>CÓDIGO</th><th style={{ width: '24%' }}>DESCRIÇÃO CONTA</th><th>OBSERVAÇÃO</th><th style={{ width: 34 }}></th></tr></thead>
              <tbody>
                {regras.map((r, i) => (
                  <tr key={r.id} title={r.updated_by ? `editado por ${r.updated_by} em ${fmtData(r.updated_at)}` : ''}>
                    <td className="mono">
                      <button className="del-btn" style={{ color: 'var(--ink-soft)' }} disabled={!isAdmin || i === 0} onClick={() => moveRegra(r, -1)}>↑</button>
                      <button className="del-btn" style={{ color: 'var(--ink-soft)' }} disabled={!isAdmin || i === regras.length - 1} onClick={() => moveRegra(r, 1)}>↓</button>
                    </td>
                    <td><input className="cell-edit" defaultValue={r.palavra_chave} readOnly={!isAdmin} onBlur={e => isAdmin && updateRegra(r, 'palavra_chave', e.target.value)} /></td>
                    <td><input className="cell-edit" list="contas-datalist" defaultValue={r.codigo ? `${r.codigo} — ${findContaDesc(r.codigo)}` : ''} readOnly={!isAdmin}
                      onBlur={e => isAdmin && updateRegra(r, 'codigo', extractCodigoFromPicked(e.target.value))} /></td>
                    <td className="mono" style={{ color: findContaDesc(r.codigo) ? 'var(--ink-soft)' : 'var(--amber)' }}>
                      {findContaDesc(r.codigo) || (r.codigo ? 'código não encontrado' : '')}
                    </td>
                    <td><input className="cell-edit" defaultValue={r.descricao || ''} readOnly={!isAdmin} onBlur={e => isAdmin && updateRegra(r, 'descricao', e.target.value)} /></td>
                    <td>{isAdmin && <button className="del-btn" onClick={() => deleteRegra(r)}>✕</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === 'contas' && (
        <section className="panel">
          <h2>Plano de contas — <span style={{ color: 'var(--teal)' }}>{empresaAtiva?.nome}</span></h2>
          <p className="hint">{planoContas.length} contas cadastradas. Use a busca para achar rápido.</p>
          <div className="row" style={{ marginTop: 0 }}>
            <input type="search" placeholder="Buscar por código ou descrição…" style={{ minWidth: 280 }}
              value={contasSearch} onChange={e => setContasSearch(e.target.value)} />
            {isAdmin && <button className="btn" onClick={addContaManual}>+ Nova conta manual</button>}
          </div>
          <div className="table-wrap" style={{ marginTop: 14 }}>
            <table>
              <thead><tr><th style={{ width: '12%' }}>CÓDIGO</th><th style={{ width: '20%' }}>CLASSIFICAÇÃO</th><th>DESCRIÇÃO</th><th style={{ width: 34 }}></th></tr></thead>
              <tbody>
                {contasFiltradas.map(c => (
                  <tr key={c.id} title={c.updated_by ? `editado por ${c.updated_by} em ${fmtData(c.updated_at)}` : ''}>
                    <td><input className="cell-edit" defaultValue={c.codigo} readOnly={!isAdmin} onBlur={e => isAdmin && updateConta(c, 'codigo', e.target.value)} /></td>
                    <td><input className="cell-edit" defaultValue={c.classificacao || ''} readOnly={!isAdmin} onBlur={e => isAdmin && updateConta(c, 'classificacao', e.target.value)} /></td>
                    <td><input className="cell-edit" defaultValue={c.descricao} readOnly={!isAdmin} onBlur={e => isAdmin && updateConta(c, 'descricao', e.target.value)} /></td>
                    <td>{isAdmin && <button className="del-btn" onClick={() => deleteConta(c)}>✕</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === 'importacao' && (
        <section className="panel">
          <h2>Arquivo para importação no Domínio</h2>
          {processedRows.length === 0 ? (
            <div className="empty-state">Processe um extrato na aba EXTRATO primeiro.</div>
          ) : (
            <>
              <div className="row" style={{ marginTop: 0 }}>
                <button className="btn teal" onClick={() => exportarImportacao(false)}>Exportar .csv — Domínio</button>
                <button className="btn secondary" onClick={() => exportarImportacao(true)}>Exportar só classificados</button>
              </div>
              <p className="hint">Lançamentos marcados como "duplicado" não entram no arquivo exportado.</p>
              <div className="table-wrap" style={{ marginTop: 14 }}><table>
                <thead><tr><th>DATA</th><th className="num">CRED.</th><th className="num">DEV.</th><th className="num">VALOR</th><th>HISTÓRICO</th><th>STATUS</th></tr></thead>
                <tbody>
                  {processedRows.map((r, i) => {
                    const historicoFull = r.detalhamento ? `${r.historico} - ${r.detalhamento}` : r.historico;
                    return (
                      <tr key={i} className={r.status !== 'automatico' ? 'warn-row' : ''}>
                        <td className="mono">{r.data}</td><td className="num">{r.contaCredora}</td><td className="num">{r.contaDevedora}</td>
                        <td className="num">{r.valor}</td><td>{historicoFull}</td>
                        <td>{r.status === 'automatico' ? <span className="badge ok">✔</span> : <span className="badge warn">⚠ {r.status}</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table></div>
            </>
          )}
        </section>
      )}

      {tab === 'historico' && (
        <section className="panel">
          <h2>Histórico de importações — <span style={{ color: 'var(--teal)' }}>{empresaAtiva?.nome}</span></h2>
          {historico.length === 0 ? (
            <div className="empty-state">Nenhuma importação confirmada ainda para esta empresa.</div>
          ) : (
            <>
              <div className="stats">
                <div className="stat">{historico.length} importações registradas</div>
                <div className="stat ok">{historico.reduce((s, h) => s + (h.total_classificados || 0), 0)} lançamentos classificados no total</div>
                <div className="stat warn">{historico.reduce((s, h) => s + (h.total_sem_match || 0), 0)} sem correspondência no total</div>
              </div>
              <div className="table-wrap" style={{ marginTop: 14 }}><table>
                <thead><tr><th>DATA/HORA</th><th>LAYOUT</th><th className="num">CONTA</th><th className="num">TOTAL</th><th className="num">CLASSIF.</th><th className="num">SEM MATCH</th><th className="num">DUPLICADOS</th><th>POR</th></tr></thead>
                <tbody>
                  {historico.map(h => {
                    const layoutNome = layouts.find(l => String(l.id) === String(h.layout_id))?.nome || '—';
                    return (
                      <tr key={h.id}>
                        <td className="mono">{fmtData(h.processado_em)}</td>
                        <td>{layoutNome}</td>
                        <td className="num">{h.conta_codigo}</td>
                        <td className="num">{h.total_lancamentos}</td>
                        <td className="num">{h.total_classificados}</td>
                        <td className="num">{h.total_sem_match}</td>
                        <td className="num">{h.total_duplicados}</td>
                        <td className="mono">{h.processado_por}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table></div>
            </>
          )}
        </section>
      )}

      <div className="footer-note">Dados salvos no Supabase — acessíveis de qualquer lugar por qualquer login autorizado.</div>
    </div>
  );
}
