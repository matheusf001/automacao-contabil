'use client';
import { useEffect, useState, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import * as XLSX from 'xlsx';
import { Check, Pencil, Trash2, Search, Plus, ArrowUp, ArrowDown, X, Sparkles, Clock, Building2, ChevronDown, ChevronUp, FileSpreadsheet, FileText, BarChart3, Settings, BookOpen, Upload, History, Users, KeyRound, UserX, UserCheck, Crown, Eye, Scale } from 'lucide-react';
import { parsePlanoFile, parsePlanoPaste, parseExtrato, classificar, downloadFile, tokenizarTexto, sugerirConta, similaridadeJaccard } from '@/lib/planoParser';
import { lerArquivoEmLinhas, detectarColunas, extrairItens, construirIndiceRelatorio, cruzarComRelatorio, fmtISOparaBR, normalizarDataISO } from '@/lib/relatorioParser';
import ContaPickerModal from '@/components/ContaPickerModal';

const TABS = ['empresas', 'extrato', 'relatorios', 'regras', 'contas', 'importacao', 'historico', 'usuarios', 'assinantes'];
const TAB_META = {
  empresas:   { num: '01', label: 'Empresas',        Icon: Building2 },
  extrato:    { num: '02', label: 'Extrato',         Icon: FileText },
  relatorios: { num: '03', label: 'Relatórios',      Icon: BarChart3 },
  regras:     { num: '04', label: 'Regras',          Icon: Settings },
  contas:     { num: '05', label: 'Plano de Contas', Icon: BookOpen },
  importacao: { num: '06', label: 'Importação',      Icon: Upload },
  historico:  { num: '07', label: 'Histórico',       Icon: History },
  usuarios:   { num: '08', label: 'Usuários',        Icon: Users },
  assinantes: { num: '09', label: 'Assinantes',      Icon: Crown },
};

function fingerprintOf(data, valor, historico) {
  return `${data}|${valor}|${historico}`.trim().toUpperCase().replace(/\s+/g, ' ');
}

function fmtData(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('pt-BR');
}

const GRUPOS_POR_NIVEL1 = {
  '1': 'ATIVO', '2': 'PASSIVO', '3': 'CUSTOS E DESPESAS', '4': 'RECEITAS', '5': 'APURAÇÃO',
};
function grupoOf(classificacao) {
  const nivel1 = String(classificacao || '').split('.')[0];
  return GRUPOS_POR_NIVEL1[nivel1] || '—';
}

function compararClassificacao(a, b) {
  const pa = String(a || '').split('.').map(n => parseInt(n) || 0);
  const pb = String(b || '').split('.').map(n => parseInt(n) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const va = pa[i] ?? -1;
    const vb = pb[i] ?? -1;
    if (va !== vb) return va - vb;
  }
  return 0;
}

export default function Dashboard() {
  const router = useRouter();
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [userEmail, setUserEmail] = useState('');
  const [role, setRole] = useState('operador');
  const [souSuper, setSouSuper] = useState(false);          // dono do sistema
  const [meuEscritorioId, setMeuEscritorioId] = useState(null);
  const [escritorioVisao, setEscritorioVisao] = useState(null); // modo suporte: ver o ambiente de um assinante
  const [escritorioVisaoNome, setEscritorioVisaoNome] = useState('');
  const empresasTodasRef = useRef([]);                       // lista completa (super vê todos os escritórios)
  const isAdmin = role === 'admin' || souSuper;

  const [tab, setTab] = useState('empresas');
  const [empresas, setEmpresas] = useState([]);
  const [currentEmpresaId, setCurrentEmpresaId] = useState(null);
  const [planoContas, setPlanoContas] = useState([]);
  const [regras, setRegras] = useState([]);
  const [layouts, setLayouts] = useState([]);
  const [currentLayoutId, setCurrentLayoutId] = useState(null);
  const [contaBancaria, setContaBancaria] = useState(null);

  const [contasSearch, setContasSearch] = useState('');
  const [grupoFiltro, setGrupoFiltro] = useState('');
  const [empresaListSearch, setEmpresaListSearch] = useState('');
  const [extratoText, setExtratoText] = useState('');
  const [processedRows, setProcessedRows] = useState([]);
  const [confirmado, setConfirmado] = useState(false);
  const [processando, setProcessando] = useState(false);
  const [importStatus, setImportStatus] = useState('');
  const [destEmpresaImport, setDestEmpresaImport] = useState(null);
  const [saveFlag, setSaveFlag] = useState('');
  const [historico, setHistorico] = useState([]);
  const [keywordDraft, setKeywordDraft] = useState('');
  const [codigoDraft, setCodigoDraft] = useState('');
  const [toasts, setToasts] = useState([]);
  const [pickerOnSelect, setPickerOnSelect] = useState(null);
  const [recentes, setRecentes] = useState([]);
  const [verTodas, setVerTodas] = useState(false);
  const [iaLoading, setIaLoading] = useState(false);

  // ---------- RELATÓRIOS FINANCEIROS ----------
  const [relatorios, setRelatorios] = useState([]);           // lista de relatórios enviados
  const [relTipo, setRelTipo] = useState('pagamentos');       // tipo do upload em andamento
  const [relRows, setRelRows] = useState(null);               // linhas cruas do arquivo em análise
  const [relNomeArquivo, setRelNomeArquivo] = useState('');
  const [relColunas, setRelColunas] = useState([]);           // estatísticas por coluna (pra prévia)
  const [relMapa, setRelMapa] = useState(null);               // {colData, colValor, colsDescricao, colCategoria}
  const [relSalvando, setRelSalvando] = useState(false);
  const [relBusca, setRelBusca] = useState('');
  const [relBuscaResultados, setRelBuscaResultados] = useState(null);
  const relFileInputRef = useRef(null);
  const indicesRelatorioRef = useRef({ D: null, C: null });   // índices data|valor pro cruzamento com o extrato

  // ---------- USUÁRIOS (gerenciamento, admin) ----------
  const USR_FORM_VAZIO = { username: '', email: '', password: '', role: 'operador', acesso_todas: true, empresas: [] };
  const [usuarios, setUsuarios] = useState([]);
  const [usrCarregando, setUsrCarregando] = useState(false);
  const [usrSalvando, setUsrSalvando] = useState(false);
  const [usrEditandoId, setUsrEditandoId] = useState(null);  // null = criando novo
  const [usrForm, setUsrForm] = useState(USR_FORM_VAZIO);

  // Chamada à API de administração (envia o token do admin logado; a chave
  // secreta service_role fica só no servidor, nunca no navegador).
  async function apiUsuarios(method, body) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Sessão expirada — faça login de novo.');
    const res = await fetch('/api/admin/usuarios', {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Erro ${res.status} na chamada.`);
    return json;
  }

  async function carregarUsuarios() {
    setUsrCarregando(true);
    try {
      const { usuarios } = await apiUsuarios('GET');
      setUsuarios(usuarios || []);
    } catch (err) {
      notify('Erro ao listar usuários: ' + err.message);
    } finally {
      setUsrCarregando(false);
    }
  }

  useEffect(() => {
    if (tab === 'usuarios' && isAdmin) carregarUsuarios();
  }, [tab, isAdmin]);

  async function salvarUsuario() {
    if (usrSalvando) return;
    setUsrSalvando(true);
    try {
      if (usrEditandoId) {
        await apiUsuarios('PATCH', {
          user_id: usrEditandoId,
          role: usrForm.role,
          acesso_todas: usrForm.acesso_todas,
          empresas: usrForm.acesso_todas ? [] : usrForm.empresas,
        });
        notify('Usuário atualizado.', 'success');
      } else {
        await apiUsuarios('POST', {
          username: usrForm.username, email: usrForm.email, password: usrForm.password,
          role: usrForm.role, acesso_todas: usrForm.acesso_todas,
          empresas: usrForm.acesso_todas ? [] : usrForm.empresas,
        });
        notify(`Usuário "${usrForm.username}" criado. Ele já pode fazer login.`, 'success');
      }
      setUsrForm(USR_FORM_VAZIO);
      setUsrEditandoId(null);
      await carregarUsuarios();
    } catch (err) {
      notify(err.message);
    } finally {
      setUsrSalvando(false);
    }
  }

  function editarUsuario(u) {
    setUsrEditandoId(u.user_id);
    setUsrForm({ username: u.username, email: u.email, password: '', role: u.role, acesso_todas: u.acesso_todas, empresas: u.empresas || [] });
  }

  async function redefinirSenhaUsuario(u) {
    const nova = prompt(`Nova senha para "${u.username || u.email}" (mínimo 6 caracteres):`);
    if (!nova) return;
    try {
      await apiUsuarios('PATCH', { user_id: u.user_id, password: nova });
      notify('Senha redefinida — avise o usuário.', 'success');
    } catch (err) { notify(err.message); }
  }

  async function alternarAtivoUsuario(u) {
    const acao = u.ativo ? 'desativar' : 'reativar';
    if (!confirm(`Deseja ${acao} o usuário "${u.username || u.email}"?${u.ativo ? ' Ele perde o acesso na hora.' : ''}`)) return;
    try {
      await apiUsuarios('PATCH', { user_id: u.user_id, ativo: !u.ativo });
      notify(u.ativo ? 'Usuário desativado.' : 'Usuário reativado.', 'success');
      await carregarUsuarios();
    } catch (err) { notify(err.message); }
  }

  async function excluirUsuario(u) {
    if (!confirm(`EXCLUIR de vez o usuário "${u.username || u.email}"? Prefira desativar, que é reversível.`)) return;
    try {
      await apiUsuarios('DELETE', { user_id: u.user_id });
      notify('Usuário excluído.', 'success');
      await carregarUsuarios();
    } catch (err) { notify(err.message); }
  }

  // ---------- ASSINANTES (só o dono do sistema) ----------
  const ASS_FORM_VAZIO = { nome: '', limite_empresas: 5, gerente_username: '', gerente_email: '', gerente_password: '' };
  const [assinantes, setAssinantes] = useState([]);
  const [assCarregando, setAssCarregando] = useState(false);
  const [assSalvando, setAssSalvando] = useState(false);
  const [assForm, setAssForm] = useState(ASS_FORM_VAZIO);

  async function apiAssinantes(method, body) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Sessão expirada — faça login de novo.');
    const res = await fetch('/api/admin/escritorios', {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Erro ${res.status} na chamada.`);
    return json;
  }

  async function carregarAssinantes() {
    setAssCarregando(true);
    try {
      const { escritorios } = await apiAssinantes('GET');
      setAssinantes(escritorios || []);
    } catch (err) {
      notify('Erro ao listar assinantes: ' + err.message);
    } finally {
      setAssCarregando(false);
    }
  }

  useEffect(() => {
    if (tab === 'assinantes' && souSuper) carregarAssinantes();
  }, [tab, souSuper]);

  async function criarAssinante() {
    if (assSalvando) return;
    setAssSalvando(true);
    try {
      await apiAssinantes('POST', assForm);
      notify(`Assinante "${assForm.nome}" criado! Passe o login do gerente pra ele: ${assForm.gerente_username}`, 'success');
      setAssForm(ASS_FORM_VAZIO);
      await carregarAssinantes();
      await loadEmpresas();
    } catch (err) {
      notify(err.message);
    } finally {
      setAssSalvando(false);
    }
  }

  async function editarLimiteAssinante(esc) {
    const novo = prompt(`Limite de empresas do plano de "${esc.nome}" (hoje: ${esc.limite_empresas}, em uso: ${esc.qtde_empresas}):`, esc.limite_empresas);
    if (!novo) return;
    try {
      await apiAssinantes('PATCH', { id: esc.id, limite_empresas: parseInt(novo) });
      notify('Limite atualizado.', 'success');
      carregarAssinantes();
    } catch (err) { notify(err.message); }
  }

  async function alternarAtivoAssinante(esc) {
    const acao = esc.ativo ? 'SUSPENDER' : 'reativar';
    if (!confirm(`${acao} a assinatura de "${esc.nome}"?${esc.ativo ? ' Todos os usuários dele perdem o acesso na hora.' : ''}`)) return;
    try {
      await apiAssinantes('PATCH', { id: esc.id, ativo: !esc.ativo });
      notify(esc.ativo ? 'Assinatura suspensa.' : 'Assinatura reativada.', 'success');
      carregarAssinantes();
    } catch (err) { notify(err.message); }
  }

  function verAmbienteAssinante(esc) {
    setEscritorioVisao(esc.id);
    setEscritorioVisaoNome(esc.nome);
    setTab('empresas');
    notify(`Modo suporte: você está vendo o ambiente de "${esc.nome}".`, 'info');
  }

  // ---------- NOVA EMPRESA COM BUSCA DE CNPJ ----------
  const [mostrarNovaEmpresa, setMostrarNovaEmpresa] = useState(false);
  const [novaEmpresa, setNovaEmpresa] = useState({ cnpj: '', nome: '' });
  const [buscandoCNPJ, setBuscandoCNPJ] = useState(false);
  const [salvandoEmpresa, setSalvandoEmpresa] = useState(false);

  function formatarCNPJ(v) {
    const d = String(v).replace(/\D/g, '').slice(0, 14);
    return d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');
  }

  // Consulta pública de CNPJ (BrasilAPI, dados da Receita Federal)
  async function buscarCNPJ() {
    const digitos = novaEmpresa.cnpj.replace(/\D/g, '');
    if (digitos.length !== 14) { notify('Digite o CNPJ completo (14 números).'); return; }
    setBuscandoCNPJ(true);
    try {
      const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digitos}`);
      if (!res.ok) {
        notify(res.status === 404 ? 'CNPJ não encontrado na Receita Federal — confira os números.' : 'A consulta de CNPJ está indisponível agora; preencha o nome manualmente.');
        return;
      }
      const d = await res.json();
      const nome = d.razao_social || d.nome_fantasia || '';
      setNovaEmpresa(f => ({ ...f, nome }));
      const situacao = d.descricao_situacao_cadastral || '';
      notify(`Encontrado: ${nome}${situacao ? ` (situação: ${situacao})` : ''}${d.municipio ? ` — ${d.municipio}/${d.uf}` : ''}`, 'success');
    } catch (err) {
      notify('Sem conexão com a consulta de CNPJ — preencha o nome manualmente.');
    } finally {
      setBuscandoCNPJ(false);
    }
  }

  async function salvarNovaEmpresa() {
    const nome = novaEmpresa.nome.trim();
    if (!nome) { notify('Informe o nome da empresa (ou busque pelo CNPJ).'); return; }
    setSalvandoEmpresa(true);
    try {
      const cnpjDigitos = novaEmpresa.cnpj.replace(/\D/g, '');
      const payload = { nome, cnpj: cnpjDigitos.length === 14 ? formatarCNPJ(cnpjDigitos) : null };
      // no modo suporte, a empresa nasce no escritório do assinante que está sendo atendido
      if (souSuper && escritorioVisao) payload.escritorio_id = escritorioVisao;
      const { data, error } = await supabase.from('empresas').insert(payload).select().single();
      if (error) { notify('Erro ao criar empresa: ' + error.message); return; }
      await loadEmpresas();
      selecionarEmpresa(data.id);
      setMostrarNovaEmpresa(false);
      setNovaEmpresa({ cnpj: '', nome: '' });
      notify(`Empresa "${nome}" criada!`, 'success');
    } finally {
      setSalvandoEmpresa(false);
    }
  }

  // ---------- OFX (formato padrão de extrato dos bancos) ----------
  const ofxModeRef = useRef(false);

  function parseOFX(texto) {
    const blocos = String(texto).split(/<STMTTRN>/i).slice(1);
    const pega = (bloco, tag) => {
      const m = bloco.match(new RegExp('<' + tag + '>([^<\\r\\n]*)', 'i'));
      return m ? m[1].trim() : '';
    };
    const linhas = [];
    for (const b of blocos) {
      const dt = pega(b, 'DTPOSTED');
      const md = dt.match(/^(\d{4})(\d{2})(\d{2})/);
      if (!md) continue;
      const data = `${md[3]}/${md[2]}/${md[1]}`;
      const bruto = pega(b, 'TRNAMT').replace(',', '.');
      const num = parseFloat(bruto);
      if (!isFinite(num) || num === 0) continue;
      const memo = pega(b, 'MEMO');
      const name = pega(b, 'NAME');
      const historico = (memo || name || pega(b, 'TRNTYPE') || 'LANÇAMENTO').replace(/\t/g, ' ');
      const detalhe = (memo && name && memo !== name) ? name.replace(/\t/g, ' ') : (pega(b, 'CHECKNUM') || '');
      const valorBR = num.toFixed(2).replace('.', ',');
      linhas.push(`${data}\t${valorBR}\t${historico}\t${detalhe}`);
    }
    return linhas;
  }

  // Layout virtual usado quando o arquivo é OFX (posições fixas, sinal define C/D)
  const LAYOUT_OFX = { nome: 'OFX', separador: 'tab', col_data: 0, col_valor: 1, col_historico: 2, col_detalhamento: 3, cd_mode: 'sinal', col_cd: 0 };

  // ---------- CONCILIAÇÃO DE SALDO ----------
  const [concSaldoInicial, setConcSaldoInicial] = useState('');
  const [concSaldoFinal, setConcSaldoFinal] = useState('');

  function openPicker(onSelectFn) {
    setPickerOnSelect(() => onSelectFn);
  }

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'F4') {
        e.preventDefault();
        // F4 sem estar em nenhum campo específico = apenas navegar/consultar
        openPicker(() => {});
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // ---------- EMPRESAS RECENTES (guardado no navegador) ----------
  useEffect(() => {
    try { setRecentes(JSON.parse(localStorage.getItem('ac_empresas_recentes') || '[]')); } catch { /* ignora */ }
  }, []);

  function registrarRecente(id) {
    setRecentes(prev => {
      const novo = [id, ...prev.filter(x => x !== id)].slice(0, 6);
      try { localStorage.setItem('ac_empresas_recentes', JSON.stringify(novo)); } catch { /* ignora */ }
      return novo;
    });
  }

  function selecionarEmpresa(id) {
    setCurrentEmpresaId(id);
    existentesCacheRef.current = null;
    setProcessedRows([]);
    setConfirmado(false);
    registrarRecente(id);
  }

  function notify(message, type = 'error') {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }

  const fileInputRef = useRef(null);
  const pasteRef = useRef(null);
  const extratoFileInputRef = useRef(null);

  async function handleExtratoFileUpload(file) {
    try {
      const ext = file.name.split('.').pop().toLowerCase();
      let text;
      if (ext === 'ofx') {
        // OFX: formato universal dos bancos — não depende de layout de colunas
        const bruto = await file.text();
        const linhas = parseOFX(bruto);
        if (!linhas.length) { notify('Não encontrei lançamentos neste OFX — confira se o arquivo está completo.'); return; }
        ofxModeRef.current = true;
        setExtratoText(linhas.join('\n'));
        setConfirmado(false);
        existentesCacheRef.current = null;
        notify(`OFX "${file.name}" lido: ${linhas.length} lançamentos. As colunas foram detectadas automaticamente — só clicar em Processar.`, 'success');
        return;
      }
      if (ext === 'csv' || ext === 'txt') {
        text = await file.text();
      } else {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
        text = rows.filter(r => r.some(c => String(c).trim() !== '')).map(r => r.join('\t')).join('\n');
      }
      ofxModeRef.current = false;
      setExtratoText(text);
      setConfirmado(false);
      existentesCacheRef.current = null;
      notify(`Arquivo "${file.name}" carregado — confira abaixo e clique em Processar.`, 'success');
    } catch (err) {
      notify('Erro ao ler o arquivo: ' + err.message);
    }
  }

  // ---------- AUTH ----------
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.replace('/login'); return; }
      setUserEmail(session.user.email);
      const { data: perfil } = await supabase.from('perfis').select('role, super, escritorio_id').eq('user_id', session.user.id).maybeSingle();
      setRole(perfil?.role || 'operador');
      setSouSuper(perfil?.super === true);
      setMeuEscritorioId(perfil?.escritorio_id || null);
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
    if (currentEmpresaId) { loadPlanoContas(currentEmpresaId); loadRegras(currentEmpresaId); loadHistorico(currentEmpresaId); loadBaseAprendizado(currentEmpresaId); loadRelatorios(currentEmpresaId); }
  }, [currentEmpresaId]);

  useEffect(() => {
    if (currentEmpresaId && currentLayoutId) loadContaBancaria(currentEmpresaId, currentLayoutId);
  }, [currentEmpresaId, currentLayoutId]);

  async function loadEmpresas() {
    const { data, error } = await supabase.from('empresas').select('*').order('nome');
    if (error) { console.error(error); return; }
    empresasTodasRef.current = data || [];
    aplicarVisaoEmpresas(data || [], escritorioVisao);
  }

  // Super no modo suporte: enxerga só as empresas do assinante escolhido,
  // exatamente como o assinante vê. Demais usuários: o RLS do banco já filtra.
  function aplicarVisaoEmpresas(todas, visaoId) {
    const filtradas = (souSuper && visaoId)
      ? todas.filter(e => e.escritorio_id === visaoId)
      : todas;
    setEmpresas(filtradas);
    const atualExiste = filtradas.some(e => e.id === currentEmpresaId);
    if (filtradas.length && !atualExiste) {
      setCurrentEmpresaId(filtradas[0].id);
      setDestEmpresaImport(filtradas[0].id);
    }
    if (!filtradas.length) setCurrentEmpresaId(null);
  }

  useEffect(() => {
    aplicarVisaoEmpresas(empresasTodasRef.current, escritorioVisao);
  }, [escritorioVisao]);

  async function loadPlanoContas(empresaId) {
    const { data, error } = await supabase.from('plano_contas').select('*').eq('empresa_id', empresaId);
    if (error) { console.error(error); return; }
    const ordenado = (data || []).slice().sort((a, b) => compararClassificacao(a.classificacao, b.classificacao));
    setPlanoContas(ordenado);
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
    setCurrentLayoutId(prev => prev || (data && data.length ? data[0].id : null));
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
    if (codigo && isContaSintetica(codigo)) {
      notify('Essa conta é Sintética (de totalização) — a conta bancária precisa ser uma conta Analítica.');
      return;
    }
    setContaBancaria(codigo || null);
    if (!codigo || !currentEmpresaId || !currentLayoutId) return;
    const { error } = await supabase.from('empresa_layout_conta')
      .upsert({ empresa_id: currentEmpresaId, layout_id: currentLayoutId, conta_codigo: codigo }, { onConflict: 'empresa_id,layout_id' });
    if (error) { notify('Erro ao salvar conta bancária: ' + error.message); return; }
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
    if (error) { notify('Erro ao criar empresa: ' + error.message); return; }
    await loadEmpresas();
    selecionarEmpresa(data.id);
    notify(`Empresa "${nome.trim()}" criada!`, 'success');
  }
  async function renomearEmpresa(emp) {
    const novoNome = prompt('Novo nome da empresa:', emp.nome);
    if (!novoNome || !novoNome.trim()) return;
    const { error } = await supabase.from('empresas').update({ nome: novoNome.trim() }).eq('id', emp.id);
    if (error) { notify('Erro ao renomear: ' + error.message); return; }
    loadEmpresas();
  }
  async function excluirEmpresa(emp) {
    if (empresas.length <= 1) { notify('Precisa manter ao menos uma empresa.'); return; }
    if (!confirm(`Excluir "${emp.nome}" e todos os dados dela? Não pode ser desfeito.`)) return;
    const { error } = await supabase.from('empresas').delete().eq('id', emp.id);
    if (error) { notify('Erro ao excluir: ' + error.message); return; }
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
    if (error) { notify('Erro: ' + error.message); return; }
    loadRegras(currentEmpresaId);
  }
  async function updateRegra(regra, field, value) {
    if (field === 'codigo') {
      const codigoNum = parseInt(value) || 0;
      if (codigoNum && isContaSintetica(codigoNum)) {
        notify('Essa conta é Sintética (de totalização) — escolha uma conta Analítica.');
        loadRegras(currentEmpresaId); // recarrega pra desfazer o valor digitado na tela
        return;
      }
    }
    const patch = { [field]: field === 'codigo' ? (parseInt(value) || 0) : value, updated_by: userEmail, updated_at: new Date().toISOString() };
    const { error } = await supabase.from('regras').update(patch).eq('id', regra.id);
    if (error) { notify('Erro: ' + error.message); return; }
    flash('salvo ✓');
    loadRegras(currentEmpresaId);
  }
  async function deleteRegra(regra) {
    const { error } = await supabase.from('regras').delete().eq('id', regra.id);
    if (error) { notify('Erro: ' + error.message); return; }
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
  // Índice código -> conta em O(1): antes cada célula da tabela varria o plano
  // inteiro (find), o que pesava em extratos grandes com planos de 500+ contas.
  const contasPorCodigo = useMemo(() => {
    const m = new Map();
    for (const c of planoContas) m.set(String(c.codigo), c);
    return m;
  }, [planoContas]);

  function findContaDesc(codigo) {
    return contasPorCodigo.get(String(codigo))?.descricao || '';
  }
  function isContaSintetica(codigo) {
    return contasPorCodigo.get(String(codigo))?.tipo === 'S';
  }
  const regrasInvalidas = regras.filter(r => r.codigo && !findContaDesc(r.codigo));
  const regrasComSintetica = regras.filter(r => r.codigo && isContaSintetica(r.codigo));

  // ---------- PLANO DE CONTAS (edição manual, admin) ----------
  async function addContaManual() {
    const { error } = await supabase.from('plano_contas').insert({ empresa_id: currentEmpresaId, codigo: 0, classificacao: '', descricao: '', updated_by: userEmail, updated_at: new Date().toISOString() });
    if (error) { notify('Erro: ' + error.message); return; }
    loadPlanoContas(currentEmpresaId);
  }
  async function updateConta(conta, field, value) {
    const patch = { [field]: field === 'codigo' ? (parseInt(value) || 0) : value, updated_by: userEmail, updated_at: new Date().toISOString() };
    const { error } = await supabase.from('plano_contas').update(patch).eq('id', conta.id);
    if (error) { notify('Erro: ' + error.message); return; }
    flash('salvo ✓');
  }
  async function deleteConta(conta) {
    const { error } = await supabase.from('plano_contas').delete().eq('id', conta.id);
    if (error) { notify('Erro: ' + error.message); return; }
    loadPlanoContas(currentEmpresaId);
  }

  // ---------- LAYOUTS (admin) ----------
  const currentLayout = layouts.find(l => String(l.id) === String(currentLayoutId)) || null;
  async function novoLayout() {
    const nome = prompt('Nome do novo layout (ex: nome do banco):');
    if (!nome || !nome.trim()) return;
    const base = currentLayout || { separador: 'auto', col_data: 0, col_historico: 2, col_valor: 1, cd_mode: 'coluna', col_cd: 3, col_detalhamento: 4 };
    const { data, error } = await supabase.from('layouts_banco').insert({ ...base, id: undefined, nome: nome.trim() }).select().single();
    if (error) { notify('Erro: ' + error.message); return; }
    await loadLayouts();
    setCurrentLayoutId(data.id);
  }
  async function excluirLayout() {
    if (layouts.length <= 1) { notify('Precisa manter ao menos um layout.'); return; }
    if (!confirm(`Excluir layout "${currentLayout.nome}"?`)) return;
    await supabase.from('layouts_banco').delete().eq('id', currentLayoutId);
    setCurrentLayoutId(null);
    loadLayouts();
  }
  async function salvarLayout(patch) {
    const { error } = await supabase.from('layouts_banco').update(patch).eq('id', currentLayoutId);
    if (error) { notify('Erro: ' + error.message); return; }
    flash('salvo ✓');
    loadLayouts();
  }

  // ---------- EXTRATO ----------
  const existentesCacheRef = useRef(null); // Set de fingerprints já importados, cacheado por processamento
  const baseAprendizadoRef = useRef([]); // lançamentos já classificados desta empresa, usados pra sugestão por similaridade

  async function loadBaseAprendizado(empresaId) {
    const { data, error } = await supabase.from('lancamentos_importados').select('historico,detalhamento,conta_devedora,conta_credora')
      .eq('empresa_id', empresaId).eq('status', 'automatico').limit(3000);
    if (error) { console.error(error); baseAprendizadoRef.current = []; return; }
    baseAprendizadoRef.current = (data || []).map(d => ({
      tokens: tokenizarTexto((d.historico || '') + ' ' + (d.detalhamento || '')),
      contaDevedora: d.conta_devedora, contaCredora: d.conta_credora,
      historico: d.detalhamento ? `${d.historico} - ${d.detalhamento}` : d.historico,
    }));
  }

  // ---------- RELATÓRIOS FINANCEIROS (funções) ----------
  async function loadRelatorios(empresaId) {
    const { data, error } = await supabase.from('relatorios_financeiros').select('*')
      .eq('empresa_id', empresaId).order('criado_em', { ascending: false }).limit(60);
    if (error) { console.error(error); setRelatorios([]); indicesRelatorioRef.current = { D: null, C: null }; return; }
    setRelatorios(data || []);
    await carregarIndicesRelatorio(empresaId);
  }

  // Baixa os itens dos relatórios da empresa e monta os índices data|valor usados no
  // cruzamento com o extrato (pagamentos casam com débitos, recebimentos com créditos).
  async function carregarIndicesRelatorio(empresaId) {
    try {
      const { data, error } = await withTimeout(
        supabase.from('relatorio_itens').select('tipo,data,valor,descricao,categoria')
          .eq('empresa_id', empresaId).limit(9000),
        20000, 'itens de relatório'
      );
      if (error) { console.error(error); indicesRelatorioRef.current = { D: null, C: null }; return; }
      const pag = (data || []).filter(i => i.tipo === 'pagamentos');
      const rec = (data || []).filter(i => i.tipo === 'recebimentos');
      indicesRelatorioRef.current = {
        D: pag.length ? construirIndiceRelatorio(pag) : null,
        C: rec.length ? construirIndiceRelatorio(rec) : null,
      };
    } catch (err) {
      console.error(err);
      indicesRelatorioRef.current = { D: null, C: null };
    }
  }

  async function handleRelatorioFile(file) {
    try {
      const rows = await lerArquivoEmLinhas(file);
      if (!rows || rows.length === 0) { notify('O arquivo veio vazio ou não foi possível ler.'); return; }
      const { colunas, sugestao } = detectarColunas(rows);
      if (sugestao.colData === -1 || sugestao.colValor === -1) {
        notify('Não achei colunas de Data e Valor automaticamente — ajuste manualmente na prévia abaixo.', 'info');
      }
      setRelRows(rows);
      setRelNomeArquivo(file.name);
      setRelColunas(colunas);
      setRelMapa({
        colData: sugestao.colData,
        colValor: sugestao.colValor,
        colsDescricao: sugestao.colsDescricao,
        colCategoria: -1,
      });
    } catch (err) {
      notify('Erro ao ler o relatório: ' + err.message);
    }
  }

  const relPreviewItens = (relRows && relMapa && relMapa.colData >= 0 && relMapa.colValor >= 0)
    ? extrairItens(relRows, relMapa) : [];

  async function salvarRelatorio() {
    if (!relRows || !relMapa) return;
    const itens = extrairItens(relRows, relMapa);
    if (itens.length === 0) { notify('Nenhum item válido reconhecido — confira as colunas de Data e Valor na prévia.'); return; }
    setRelSalvando(true);
    try {
      const datas = itens.map(i => i.data).sort();
      const { data: cab, error: errCab } = await supabase.from('relatorios_financeiros').insert({
        empresa_id: currentEmpresaId, nome_arquivo: relNomeArquivo, tipo: relTipo,
        total_itens: itens.length, periodo_inicio: datas[0], periodo_fim: datas[datas.length - 1],
        enviado_por: userEmail,
      }).select().single();
      if (errCab) { notify('Erro ao salvar relatório: ' + errCab.message); return; }

      const linhas = itens.map(i => ({
        relatorio_id: cab.id, empresa_id: currentEmpresaId, tipo: relTipo,
        data: i.data, valor: i.valor, descricao: i.descricao, categoria: i.categoria || null,
      }));
      const chunkSize = 400;
      for (let i = 0; i < linhas.length; i += chunkSize) {
        const { error } = await supabase.from('relatorio_itens').insert(linhas.slice(i, i + chunkSize));
        if (error) { notify('Erro ao salvar itens: ' + error.message); return; }
      }
      notify(`Relatório salvo: ${itens.length} itens de ${fmtISOparaBR(datas[0])} a ${fmtISOparaBR(datas[datas.length - 1])}.`, 'success');
      setRelRows(null); setRelMapa(null); setRelColunas([]); setRelNomeArquivo('');
      if (relFileInputRef.current) relFileInputRef.current.value = '';
      await loadRelatorios(currentEmpresaId);
    } finally {
      setRelSalvando(false);
    }
  }

  async function excluirRelatorio(rel) {
    if (!confirm(`Excluir o relatório "${rel.nome_arquivo || rel.tipo}" (${rel.total_itens} itens)? Os cruzamentos com o extrato deixam de aparecer.`)) return;
    const { error } = await supabase.from('relatorios_financeiros').delete().eq('id', rel.id);
    if (error) { notify('Erro ao excluir: ' + error.message); return; }
    loadRelatorios(currentEmpresaId);
  }

  async function buscarNosRelatorios() {
    const termo = relBusca.trim();
    if (!termo) { setRelBuscaResultados(null); return; }
    let query = supabase.from('relatorio_itens').select('tipo,data,valor,descricao,categoria')
      .eq('empresa_id', currentEmpresaId).limit(100);
    const comoData = normalizarDataISO(termo);
    const comoValor = termo.match(/^[\d.,]+$/) ? parseFloat(termo.replace(/\./g, '').replace(',', '.')) : null;
    if (comoData) query = query.eq('data', comoData);
    else if (comoValor !== null && isFinite(comoValor)) query = query.eq('valor', comoValor);
    else query = query.ilike('descricao', `%${termo}%`);
    const { data, error } = await query.order('data', { ascending: false });
    if (error) { notify('Erro na busca: ' + error.message); return; }
    setRelBuscaResultados(data || []);
  }

  function withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`Tempo esgotado (${label})`)), ms)),
    ]);
  }

  async function processarExtrato(regrasOverride, opts = {}) {
    if (!contaBancaria) { notify('Escolha a conta bancária desta importação na aba EXTRATO antes de processar.'); return; }
    if (!ofxModeRef.current && !currentLayout) { notify('Selecione um layout de banco na aba EXTRATO.'); return; }
    setProcessando(true);
    setConfirmado(false);
    try {
      const regrasAtuais = regrasOverride || regras;
      const layoutUsado = ofxModeRef.current ? LAYOUT_OFX : currentLayout;
      const rows = parseExtrato(extratoText, layoutUsado);
      const classificado = classificar(rows, regrasAtuais, contaBancaria);
      const withFingerprint = classificado.map(r => ({ ...r, fingerprint: fingerprintOf(r.data, r.valor, r.historico) }));

      let existentes;
      if (opts.reuseCache && existentesCacheRef.current) {
        // reclassificação local (ex: depois de criar uma regra) — não precisa consultar o banco de novo
        existentes = existentesCacheRef.current;
      } else {
        existentes = new Set();
        const fps = withFingerprint.map(r => r.fingerprint);
        const chunkSize = 80;
        for (let i = 0; i < fps.length; i += chunkSize) {
          const chunk = fps.slice(i, i + chunkSize);
          try {
            const { data, error } = await withTimeout(
              supabase.from('lancamentos_importados').select('fingerprint').eq('empresa_id', currentEmpresaId).in('fingerprint', chunk),
              15000, 'verificação de duplicidade'
            );
            if (error) { console.error(error); continue; }
            (data || []).forEach(d => existentes.add(d.fingerprint));
          } catch (timeoutErr) {
            console.error(timeoutErr);
            notify('A verificação de duplicidade demorou demais e foi pulada — confira antes de confirmar a importação.', 'error');
          }
        }
        existentesCacheRef.current = existentes;
      }

      const marcado = withFingerprint.map(r => existentes.has(r.fingerprint) ? { ...r, status: 'duplicado' } : r);

      // Cruza cada lançamento com os relatórios financeiros da empresa (por data + valor):
      // saída do banco procura nos PAGAMENTOS, entrada procura nos RECEBIMENTOS.
      const comRelatorio = marcado.map(r => {
        const ref = cruzarComRelatorio(r, indicesRelatorioRef.current);
        return ref ? { ...r, refRelatorio: ref } : r;
      });

      const comSugestao = comRelatorio.map(r => {
        if (r.status !== 'sem match') return r;
        const sugestao = sugerirConta(r, baseAprendizadoRef.current, contaBancaria);
        return sugestao ? { ...r, sugestao } : r;
      });
      setProcessedRows(comSugestao);
    } catch (err) {
      console.error(err);
      notify('Deu um erro ao processar o extrato: ' + err.message + '\n\nConfira se as colunas do layout (Data/Histórico/Valor) estão configuradas corretamente.');
    } finally {
      setProcessando(false);
    }
  }

  function appendWord(word) {
    const limpo = word.trim();
    if (!limpo) return;
    setKeywordDraft(prev => {
      if (!prev) return limpo;
      const jaTem = prev.split(/\s+/).some(w => w.toUpperCase() === limpo.toUpperCase());
      return jaTem ? prev : prev + ' ' + limpo;
    });
  }

  function renderClickableText(text) {
    if (!text) return null;
    const parts = text.split(/(\s+)/);
    return parts.map((part, idx) => {
      if (/^\s*$/.test(part)) return part;
      return (
        <span key={idx} className="word-token" title="Clicar adiciona à palavra-chave da nova regra"
          onClick={() => appendWord(part)}>{part}</span>
      );
    });
  }

  async function salvarRegraDraft() {
    const codigo = extractCodigoFromPicked(codigoDraft);
    if (!keywordDraft.trim()) { notify('Monte a palavra-chave clicando nas palavras do histórico/detalhamento, ou digite manualmente.'); return; }
    if (!codigo) { notify('Escolha a conta contábil da regra.'); return; }
    if (isContaSintetica(codigo)) { notify('Essa conta é Sintética (de totalização) — escolha uma conta Analítica, que é onde os lançamentos podem entrar.'); return; }
    const maxOrdem = regras.reduce((m, r) => Math.max(m, r.ordem || 0), 0);
    const { error } = await supabase.from('regras').insert({
      empresa_id: currentEmpresaId, palavra_chave: keywordDraft.trim(), codigo, descricao: '',
      ordem: maxOrdem + 1, updated_by: userEmail, updated_at: new Date().toISOString(),
    });
    if (error) { notify('Erro ao salvar regra: ' + error.message); return; }
    setKeywordDraft(''); setCodigoDraft('');
    const { data: novasRegras } = await supabase.from('regras').select('*').eq('empresa_id', currentEmpresaId).order('ordem');
    setRegras(novasRegras || []);
    notify('Regra criada! Reclassificando o extrato…', 'success');
    if (processedRows.length > 0) await processarExtrato(novasRegras || [], { reuseCache: true });
  }

  async function confirmarImportacao() {
    if (processedRows.length === 0) return;
    const naoDuplicados = processedRows.filter(r => r.status !== 'duplicado');
    if (naoDuplicados.length === 0) { notify('Todos os lançamentos já foram importados antes — nada novo para salvar.'); return; }

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
    if (errExtrato) { notify('Erro ao salvar histórico: ' + errExtrato.message); return; }

    const linhas = naoDuplicados.map(r => ({
      empresa_id: currentEmpresaId, extrato_id: extrato.id, fingerprint: r.fingerprint,
      data: r.data, valor: r.valor, historico: r.historico, detalhamento: r.detalhamento, cd: r.cd,
      conta_credora: r.contaCredora || null, conta_devedora: r.contaDevedora || null, status: r.status,
    }));
    const chunkSize = 300;
    for (let i = 0; i < linhas.length; i += chunkSize) {
      const { error } = await supabase.from('lancamentos_importados').insert(linhas.slice(i, i + chunkSize));
      if (error) { notify('Erro ao salvar lançamentos: ' + error.message); return; }
    }
    setConfirmado(true);
    loadHistorico(currentEmpresaId);
    loadBaseAprendizado(currentEmpresaId); // atualiza a base de aprendizado com os lançamentos recém-confirmados
    notify('Importação confirmada e salva no histórico!', 'success');
  }

  // ---------- CLASSIFICAÇÃO COM IA (Claude via API — sempre com confirmação humana) ----------
  async function classificarComIA() {
    const semMatch = processedRows
      .map((r, i) => ({ ...r, __idx: i }))
      .filter(r => r.status === 'sem match' && !r.sugestaoIA);
    if (semMatch.length === 0) { notify('Nenhum lançamento sem correspondência para enviar à IA.'); return; }

    setIaLoading(true);
    try {
      // Só manda dados DA EMPRESA ATIVA: plano (só Analíticas), regras e exemplos já confirmados dela.
      const contasAnaliticas = planoContas
        .filter(c => c.tipo !== 'S' && c.codigo && c.descricao)
        .map(c => ({ codigo: c.codigo, descricao: c.descricao }));

      // Em vez de mandar só os últimos 50 exemplos, escolhemos os MAIS PARECIDOS
      // com o lote que está sem match — assim a IA recebe exatamente os precedentes
      // que ajudam nesses lançamentos ("aprendizado" que melhora a cada confirmação).
      const tokensLote = tokenizarTexto(semMatch.map(r => (r.historico || '') + ' ' + (r.detalhamento || '')).join(' '));
      const exemplos = baseAprendizadoRef.current
        .map(e => ({
          texto: e.historico,
          codigo: String(e.contaDevedora) === String(contaBancaria) ? e.contaCredora : e.contaDevedora,
          relevancia: similaridadeJaccard(tokensLote, e.tokens),
        }))
        .filter(e => e.codigo)
        .sort((a, b) => b.relevancia - a.relevancia)
        .slice(0, 50)
        .map(e => ({ texto: e.texto, codigo: e.codigo }));
      const regrasResumo = regras.filter(r => r.palavra_chave && r.codigo)
        .map(r => ({ palavra_chave: r.palavra_chave, codigo: r.codigo }));

      const resp = await withTimeout(fetch('/api/classificar-ia', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          lancamentos: semMatch.slice(0, 60).map(r => ({
            id: r.__idx, data: r.data, valor: r.valor, cd: r.cd,
            historico: r.historico, detalhamento: r.detalhamento,
            // contexto vindo do relatório financeiro da empresa (quando data+valor bateram)
            contexto: r.refRelatorio
              ? `${r.refRelatorio.item.categoria ? '[' + r.refRelatorio.item.categoria + '] ' : ''}${r.refRelatorio.item.descricao}`
              : undefined,
          })),
          contas: contasAnaliticas, regras: regrasResumo, exemplos,
        }),
      }), 90000, 'classificação com IA');

      const data = await resp.json();
      if (!resp.ok || data.error) { notify(data.error || 'Erro ao chamar a IA.'); return; }

      const porId = new Map((data.sugestoes || []).map(s => [Number(s.id), s]));
      let aplicadas = 0;
      const novas = processedRows.map((r, i) => {
        const s = porId.get(i);
        if (!s || r.status !== 'sem match') return r;
        if (!findContaDesc(s.codigo) || isContaSintetica(s.codigo)) return r; // segurança extra
        aplicadas++;
        return { ...r, sugestaoIA: s };
      });
      setProcessedRows(novas);
      if (aplicadas > 0) notify(`A IA sugeriu conta para ${aplicadas} lançamento(s). Revise e clique em "Aceitar" nos que estiverem certos.`, 'success');
      else notify('A IA não teve confiança suficiente para sugerir nenhuma conta desta vez.', 'info');
      if (semMatch.length > 60) notify('Enviados os primeiros 60 sem match — clique de novo para classificar os demais.', 'info');
    } catch (err) {
      console.error(err);
      notify('Erro ao classificar com IA: ' + err.message);
    } finally {
      setIaLoading(false);
    }
  }

  function aplicarContaNaLinha(r, codigo) {
    const isDebito = r.cd === 'D';
    return {
      ...r,
      contaDevedora: isDebito ? codigo : contaBancaria,
      contaCredora: isDebito ? contaBancaria : codigo,
      status: 'automatico',
      origem: 'ia',
    };
  }

  // Troca manual da conta de um lançamento: clica na célula DEV/CRED, abre a
  // busca de contas (F4) e a escolha vale só para aquela linha — sem criar regra.
  // Serve pros casos ambíguos: sócio (retirada C/C sócio × pró-labore a pagar),
  // funcionário (salário a pagar × adiantamento), DARF (INSS × PIS × COFINS ×
  // IRPJ/CSLL × parcelamento), transferência pra aplicação etc.
  function editarContaDaLinha(idx, campo) {
    setPickerOnSelect(() => (conta) => {
      try {
        if (!conta || conta.codigo === undefined) return;
        if (isContaSintetica(conta.codigo)) {
          notify('Conta Sintética (totalizadora) não pode receber lançamento — escolha uma Analítica.');
          return;
        }
        setProcessedRows(prev => prev.map((r, i) => {
          if (i !== idx || r.status === 'duplicado') return r;
          const novo = { ...r };
          if (campo === 'dev') novo.contaDevedora = conta.codigo;
          else novo.contaCredora = conta.codigo;
          // se o outro lado ainda está vazio (linha "sem match"), completa com a conta do banco
          if (!novo.contaDevedora) novo.contaDevedora = contaBancaria;
          if (!novo.contaCredora) novo.contaCredora = contaBancaria;
          novo.status = 'automatico';
          novo.origem = 'manual';
          return novo;
        }));
      } catch (err) {
        console.error(err);
        notify('Erro ao aplicar a conta: ' + err.message);
      } finally {
        setPickerOnSelect(null);
      }
    });
  }

  function aceitarSugestaoIA(idx) {
    setProcessedRows(prev => prev.map((r, i) =>
      (i === idx && r.status === 'sem match' && r.sugestaoIA) ? aplicarContaNaLinha(r, r.sugestaoIA.codigo) : r
    ));
  }

  function aceitarTodasIA() {
    const total = processedRows.filter(r => r.status === 'sem match' && r.sugestaoIA).length;
    if (total === 0) return;
    if (!confirm(`Aceitar as ${total} sugestões da IA? Você ainda pode revisar tudo antes de confirmar a importação.`)) return;
    setProcessedRows(prev => prev.map(r =>
      (r.status === 'sem match' && r.sugestaoIA) ? aplicarContaNaLinha(r, r.sugestaoIA.codigo) : r
    ));
  }

  function exportarImportacao(onlyMatched) {
    let csv = 'DATA;CONTA DEVEDORA;CONTA CREDORA;VALOR;HISTORICO;STATUS\n';
    processedRows.forEach(r => {
      if (r.status === 'duplicado') return;
      if (onlyMatched && r.status !== 'automatico') return;
      const historicoFull = r.detalhamento ? `${r.historico} - ${r.detalhamento}` : r.historico;
      csv += `${r.data};${r.contaDevedora};${r.contaCredora};${r.valor};"${historicoFull.replace(/"/g, "'")}";${r.origem === 'manual' ? 'manual' : r.status}\n`;
    });
    downloadFile(csv, (onlyMatched ? 'importacao_classificados_' : 'importacao_') + currentEmpresaId + '.csv');
  }

  if (checkingAuth) return <div className="center-loading">verificando sessão…</div>;

  const empresaAtiva = empresas.find(e => e.id === currentEmpresaId);
  const contasFiltradas = planoContas.filter(c => {
    const f = contasSearch.toLowerCase();
    const passaBusca = !f || String(c.codigo).includes(f) || (c.descricao || '').toLowerCase().includes(f);
    const passaGrupo = !grupoFiltro || grupoOf(c.classificacao) === grupoFiltro;
    return passaBusca && passaGrupo;
  }).slice(0, 500);

  return (
    <div className="app">
      {pickerOnSelect && (
        <ContaPickerModal
          contas={planoContas}
          onSelect={(conta) => pickerOnSelect(conta)}
          onClose={() => setPickerOnSelect(null)}
        />
      )}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={'toast toast-' + t.type}>{t.message}</div>
        ))}
      </div>

      <datalist id="contas-datalist">
        {planoContas.map(c => <option key={c.id} value={`${c.codigo} — ${c.descricao}${c.tipo === 'S' ? ' [SINTÉTICA]' : ''}`} />)}
      </datalist>

      <header className="top">
        <div className="top-inner">
          <div className="brand">AUTOMAÇÃO</div>
          <div className="top-divider" />
          <div className="empresa-picker">
            <label>Empresa selecionada</label>
            <select value={currentEmpresaId || ''} onChange={e => selecionarEmpresa(e.target.value)}>
              {empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
            </select>
          </div>
          <div className="user-block">
            <div className="user-info">
              <div className="user-email">{userEmail}</div>
              <div className="user-role">{isAdmin ? 'Administrador' : 'Operador'} · <a href="#" onClick={(e) => { e.preventDefault(); handleLogout(); }}>Sair</a></div>
            </div>
            <div className="avatar">{(userEmail || '?').slice(0, 2).toUpperCase()}</div>
          </div>
        </div>
      </header>

      <nav className="tabs">
        <div className="tabs-inner">
          {TABS.filter(t => (t === 'usuarios' ? isAdmin : t === 'assinantes' ? souSuper : true)).map(t => {
            const { num, label, Icon } = TAB_META[t];
            return (
              <button key={t} className={'tab-btn' + (tab === t ? ' active' : '')} onClick={() => setTab(t)}>
                <Icon size={15} /><span className="tab-num">{num}</span>{label}
              </button>
            );
          })}
        </div>
      </nav>

      {souSuper && escritorioVisao && (
        <div className="suporte-banner">
          <Eye size={14} style={{ verticalAlign: -2, marginRight: 7 }} />
          Modo suporte: você está vendo o ambiente do assinante <strong>&nbsp;{escritorioVisaoNome || 'selecionado'}</strong>.
          <button className="btn secondary" style={{ marginLeft: 12, padding: '4px 10px', fontSize: 11.5 }}
            onClick={() => { setEscritorioVisao(null); setEscritorioVisaoNome(''); }}>Sair do modo suporte</button>
        </div>
      )}
      <div key={tab} className="fade-in">

      {tab === 'empresas' && (
        <section className="panel">
          <div className={isAdmin ? 'empresas-layout' : ''}>
          <div>
          <div className="row" style={{ marginTop: 0, justifyContent: 'space-between' }}>
            <div>
              <h2>Gestão de Empresas</h2>
              <p className="hint" style={{ marginBottom: 0 }}>Gerencie as {empresas.length} entidades cadastradas — cada uma com seu próprio plano de contas e regras.
                {!isAdmin && <> Você está como <strong>operador</strong>: só admin cria/edita empresas.</>}
              </p>
            </div>
            {isAdmin && <button className="btn secondary" onClick={() => setMostrarNovaEmpresa(v => !v)}><Plus size={14} style={{ marginRight: 5, verticalAlign: -2 }} />Nova empresa</button>}
          </div>

          {isAdmin && mostrarNovaEmpresa && (
            <div className="card destaque" style={{ marginTop: 14 }}>
              <h3 style={{ fontSize: 15 }}>Cadastrar nova empresa</h3>
              <p className="hint" style={{ marginBottom: 0 }}>Digite o CNPJ e clique em Buscar: o nome vem preenchido direto da Receita Federal. Sem CNPJ (ex: produtor rural CPF), preencha só o nome.</p>
              <div className="row">
                <div className="field-inline"><label>CNPJ</label>
                  <input type="text" style={{ width: 180 }} placeholder="00.000.000/0000-00" value={novaEmpresa.cnpj}
                    onChange={e => setNovaEmpresa(f => ({ ...f, cnpj: formatarCNPJ(e.target.value) }))}
                    onKeyDown={e => { if (e.key === 'Enter') buscarCNPJ(); }} />
                </div>
                <button className="btn secondary" onClick={buscarCNPJ} disabled={buscandoCNPJ} style={{ alignSelf: 'flex-end' }}>
                  {buscandoCNPJ ? (<><span className="spinner" /> Buscando…</>) : (<><Search size={13} style={{ marginRight: 5, verticalAlign: -2 }} />Buscar CNPJ</>)}
                </button>
              </div>
              <div className="field-label">Nome / razão social</div>
              <input type="text" style={{ width: '100%' }} placeholder="preenchido pela busca, ou digite" value={novaEmpresa.nome}
                onChange={e => setNovaEmpresa(f => ({ ...f, nome: e.target.value }))} />
              <div className="row">
                <button className="btn teal" onClick={salvarNovaEmpresa} disabled={salvandoEmpresa || !novaEmpresa.nome.trim()}>
                  {salvandoEmpresa ? (<><span className="spinner" /> Criando…</>) : 'Criar empresa'}
                </button>
                <button className="btn secondary" onClick={() => { setMostrarNovaEmpresa(false); setNovaEmpresa({ cnpj: '', nome: '' }); }}>Cancelar</button>
              </div>
            </div>
          )}

          <div className="search-hero">
            <Search size={18} />
            <input type="search" placeholder="Buscar empresa pelo nome…" autoFocus
              value={empresaListSearch} onChange={e => setEmpresaListSearch(e.target.value)} />
          </div>

          {(() => {
            const busca = empresaListSearch.trim().toLowerCase();
            const filtradas = busca ? empresas.filter(emp => emp.nome.toLowerCase().includes(busca)) : [];
            const recentesList = recentes.map(id => empresas.find(e => e.id === id)).filter(Boolean);

            const renderCard = (emp) => (
              <div key={emp.id} className={'empresa-card' + (emp.id === currentEmpresaId ? ' active' : '')}
                onClick={() => { selecionarEmpresa(emp.id); setEmpresaListSearch(''); }}
                title="Clique para usar esta empresa">
                <div className="card-top">
                  <Building2 size={16} className="card-ico" />
                  {emp.id === currentEmpresaId && <span className="badge ok">ativa</span>}
                </div>
                <div className="name">{emp.nome}</div>
                <div className="meta">conta banco fixa (padrão): {emp.conta_banco_fixa ?? '—'}</div>
                {isAdmin && (
                  <div className="card-actions">
                    <button className="icon-btn" title="Renomear" onClick={(ev) => { ev.stopPropagation(); renomearEmpresa(emp); }}><Pencil size={14} /></button>
                    <button className="icon-btn icon-btn-danger" title="Excluir" onClick={(ev) => { ev.stopPropagation(); excluirEmpresa(emp); }}><Trash2 size={14} /></button>
                  </div>
                )}
              </div>
            );

            if (busca) {
              return (
                <>
                  <div className="section-label">{filtradas.length} resultado(s) para "{empresaListSearch}"</div>
                  {filtradas.length > 0
                    ? <div className="empresa-grid">{filtradas.map(renderCard)}</div>
                    : <div className="empty-state">Nenhuma empresa encontrada. {isAdmin && 'Use o botão "Nova empresa" para cadastrar.'}</div>}
                </>
              );
            }
            return (
              <>
                {recentesList.length > 0 && (
                  <>
                    <div className="section-label"><Clock size={13} style={{ verticalAlign: -2, marginRight: 5 }} />Seleção rápida — usadas recentemente</div>
                    <div className="empresa-grid">{recentesList.map(renderCard)}</div>
                  </>
                )}
                {recentesList.length === 0 && (
                  <div className="empty-state" style={{ padding: '30px 20px' }}>Use a busca acima para encontrar uma empresa. As que você usar vão aparecer aqui como atalho.</div>
                )}
                <button className="btn secondary" style={{ marginTop: 18 }} onClick={() => setVerTodas(v => !v)}>
                  {verTodas ? <ChevronUp size={14} style={{ marginRight: 5, verticalAlign: -2 }} /> : <ChevronDown size={14} style={{ marginRight: 5, verticalAlign: -2 }} />}
                  {verTodas ? 'Esconder lista completa' : `Ver todas as ${empresas.length} empresas`}
                </button>
                {verTodas && <div className="empresa-grid" style={{ marginTop: 14 }}>{empresas.map(renderCard)}</div>}
              </>
            );
          })()}

          </div>

          {isAdmin && (
            <div className="card destaque" style={{ marginTop: 0 }}>
              <h3 style={{ fontSize: 15.5 }}>Atualizar Plano de Contas</h3>
              <p className="hint" style={{ marginBottom: 4 }}>Substitua o plano atual enviando um arquivo <code>.xls</code>/<code>.xlsx</code>/<code>.csv</code> ou colando os dados abaixo.</p>
              <p className="hint" style={{ marginBottom: 0 }}>
                <a href="/modelo-plano-de-contas.xlsx" download style={{ color: 'var(--teal)', fontWeight: 600 }}>
                  Baixar planilha modelo
                </a>{' '}
                — preencha e envie de volta. Se o .xls do Domínio não for reconhecido, abra no Excel e salve como <code>.xlsx</code>.
              </p>
              <div className="field-label">Empresa destino</div>
              <select style={{ width: '100%' }} value={destEmpresaImport || ''} onChange={e => setDestEmpresaImport(e.target.value)}>
                {empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
              </select>
              <div className="field-label">Importação de arquivo</div>
              <input type="file" ref={fileInputRef} accept=".xls,.xlsx,.csv,.txt" style={{ width: '100%' }} />
              <div className="field-label">Entrada manual (CSV)</div>
              <textarea ref={pasteRef} placeholder={'7;1.1.1.02;BANCOS CONTA MOVIMENTO;S\n8;1.1.1.02.001;BANCO DO BRASIL;A'} style={{ minHeight: 90 }} />
              <div className="row">
                <button className="btn teal full" onClick={importarPlano}>Processar e Substituir Plano</button>
              </div>
              {importStatus && <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 8 }}>{importStatus}</div>}
            </div>
          )}
          </div>
        </section>
      )}

      {tab === 'extrato' && (
        <section className="panel">
          <h2>Colar extrato bancário — <span style={{ color: 'var(--teal)' }}>{empresaAtiva?.nome}</span></h2>

          <div className="card">
            <h3>Layout do banco</h3>
            <p className="hint" style={{ marginBottom: 10 }}>Cole uma linha real, confira a prévia e ajuste as colunas (a 1ª coluna é a nº 1) antes de salvar.</p>
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
                <button className="btn secondary" onClick={() => openPicker((conta) => salvarContaBancaria(conta.codigo))}><Search size={13} style={{marginRight:5,verticalAlign:-2}}/>Buscar conta</button>
                <span className={'save-flag' + (saveFlag ? ' show' : '')}>{saveFlag}</span>
              </div>
            )}
            {isAdmin && currentLayout && (
              <div key={currentLayoutId}>
                <div className="field-group">
                  <div className="field-group-label">Posição das colunas (a 1ª coluna é a nº 1)</div>
                  <div className="row" style={{ marginTop: 0 }}>
                    <div className="field-inline"><label>Separador</label>
                      <select defaultValue={currentLayout.separador} onChange={e => salvarLayout({ separador: e.target.value })}>
                        <option value="auto">Auto (tab ou ;)</option>
                        <option value="tab">Tabulação</option>
                        <option value=";">Ponto e vírgula ( ; )</option>
                        <option value=",">Vírgula ( , )</option>
                      </select>
                    </div>
                    <div className="field-inline"><label>Col. Data</label>
                      <input type="number" min="1" style={{ width: 64 }} defaultValue={currentLayout.col_data + 1} onBlur={e => salvarLayout({ col_data: Math.max(0, (parseInt(e.target.value) || 1) - 1) })} />
                    </div>
                    <div className="field-inline"><label>Col. Histórico</label>
                      <input type="number" min="1" style={{ width: 64 }} defaultValue={currentLayout.col_historico + 1} onBlur={e => salvarLayout({ col_historico: Math.max(0, (parseInt(e.target.value) || 1) - 1) })} />
                    </div>
                    <div className="field-inline"><label>Col. Valor</label>
                      <input type="number" min="1" style={{ width: 64 }} defaultValue={currentLayout.col_valor + 1} onBlur={e => salvarLayout({ col_valor: Math.max(0, (parseInt(e.target.value) || 1) - 1) })} />
                    </div>
                    <div className="field-inline"><label>Col. Detalhamento (0 = nenhuma)</label>
                      <input type="number" min="0" style={{ width: 64 }} defaultValue={currentLayout.col_detalhamento >= 0 ? currentLayout.col_detalhamento + 1 : 0} onBlur={e => { const v = parseInt(e.target.value) || 0; salvarLayout({ col_detalhamento: v <= 0 ? -1 : v - 1 }); }} />
                    </div>
                  </div>
                </div>
                <div className="field-group">
                  <div className="field-group-label">Como identificar crédito/débito</div>
                  <div className="row" style={{ marginTop: 0 }}>
                    <div className="field-inline"><label>C/D por</label>
                      <select defaultValue={currentLayout.cd_mode} onChange={e => salvarLayout({ cd_mode: e.target.value })}>
                        <option value="coluna">Coluna específica</option>
                        <option value="sinal">Sinal do valor (negativo = débito)</option>
                      </select>
                    </div>
                    <div className="field-inline"><label>Col. C/D</label>
                      <input type="number" min="1" style={{ width: 64 }} defaultValue={currentLayout.col_cd + 1} onBlur={e => salvarLayout({ col_cd: Math.max(0, (parseInt(e.target.value) || 1) - 1) })} />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <p className="hint">Cole as linhas do extrato conforme o layout selecionado, ou envie o arquivo direto do banco.</p>
          <div className="row" style={{ marginTop: 0 }}>
            <input type="file" ref={extratoFileInputRef} accept=".xls,.xlsx,.csv,.txt,.ofx"
              onChange={e => { if (e.target.files?.[0]) handleExtratoFileUpload(e.target.files[0]); }} />
            <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>ou cole manualmente abaixo</span>
          </div>
          <textarea value={extratoText} onChange={e => { setExtratoText(e.target.value); ofxModeRef.current = false; setConfirmado(false); existentesCacheRef.current = null; }}
            placeholder={'01/07/2026\t1250,00\tPIX RECEBIDO\tCLIENTE XYZ LTDA'} />
          <div className="row">
            <button className="btn teal" onClick={() => processarExtrato()} disabled={processando}>
              {processando ? (<><span className="spinner" /> Processando…</>) : 'Processar extrato'}
            </button>
            <button className="btn secondary" onClick={() => { setExtratoText(''); setProcessedRows([]); setConfirmado(false); ofxModeRef.current = false; existentesCacheRef.current = null; if (extratoFileInputRef.current) extratoFileInputRef.current.value = ''; }}>Limpar</button>
          </div>

          {processedRows.length > 0 && (
            <>
              <div className="card">
                <h3>Criar regra a partir do extrato</h3>
                <p className="hint" style={{ marginBottom: 10 }}>Clique em palavras do histórico/detalhamento na tabela abaixo para montar a palavra-chave, escolha a conta e salve — sem sair desta tela.</p>
                <div className="row" style={{ marginTop: 0 }}>
                  <label style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>Palavra-chave:</label>
                  <input type="text" style={{ minWidth: 320 }} value={keywordDraft} onChange={e => setKeywordDraft(e.target.value)} placeholder="clique nas palavras abaixo…" />
                  <button className="btn secondary" onClick={() => setKeywordDraft('')}>Limpar</button>
                </div>
                <div className="row">
                  <label style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>Conta contábil:</label>
                  <input type="text" list="contas-datalist" style={{ minWidth: 280 }} value={codigoDraft} onChange={e => setCodigoDraft(e.target.value)} placeholder="buscar conta…" />
                  <button className="btn secondary" onClick={() => openPicker((conta) => setCodigoDraft(`${conta.codigo} — ${conta.descricao}`))}><Search size={13} style={{marginRight:5,verticalAlign:-2}}/>Buscar conta</button>
                  <button className="btn teal" onClick={salvarRegraDraft} disabled={!keywordDraft.trim() || !codigoDraft.trim()}>Salvar regra e reclassificar</button>
                  <span className={'save-flag' + (saveFlag ? ' show' : '')}>{saveFlag}</span>
                </div>
              </div>

              <div className="stats">
                <div className="stat">{processedRows.length} lançamentos</div>
                <div className="stat ok">{processedRows.filter(r => r.status === 'automatico').length} classificados</div>
                <div className="stat warn">{processedRows.filter(r => r.status === 'sem match').length} sem correspondência</div>
                {processedRows.some(r => r.origem === 'ia') && (
                  <div className="stat" style={{ background: '#EDE9FE', color: '#6D28D9', borderColor: '#DDD6FE' }}>
                    ✦ {processedRows.filter(r => r.origem === 'ia').length} classificados pela IA (aceitos por você)
                  </div>
                )}
                {processedRows.some(r => r.status === 'duplicado') && (
                  <div className="stat warn" style={{ background: '#F1E3E3', color: '#A33', borderColor: '#E0C4C4' }}>
                    {processedRows.filter(r => r.status === 'duplicado').length} já importados antes (duplicado)
                  </div>
                )}
                {processedRows.some(r => r.refRelatorio) && (
                  <div className="stat" style={{ background: '#E8F0FB', color: '#1D4ED8', borderColor: '#C8DAF5' }}>
                    <FileSpreadsheet size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
                    {processedRows.filter(r => r.refRelatorio).length} identificados no relatório financeiro
                  </div>
                )}
              </div>
              <div className="row" style={{ marginTop: 6 }}>
                {processedRows.some(r => r.status === 'sem match' && !r.sugestaoIA) && (
                  <button className="btn" onClick={classificarComIA} disabled={iaLoading}>
                    {iaLoading ? (<><span className="spinner" /> Consultando a IA…</>) : (
                      <><Sparkles size={14} style={{ marginRight: 5, verticalAlign: -2 }} />Classificar com IA ({processedRows.filter(r => r.status === 'sem match' && !r.sugestaoIA).length} sem match)</>
                    )}
                  </button>
                )}
                {processedRows.some(r => r.status === 'sem match' && r.sugestaoIA) && (
                  <button className="btn secondary" onClick={aceitarTodasIA}>
                    ✦ Aceitar todas as sugestões da IA ({processedRows.filter(r => r.status === 'sem match' && r.sugestaoIA).length})
                  </button>
                )}
                {!confirmado ? (
                  <button className="btn teal" onClick={confirmarImportacao}>Confirmar importação (salva no histórico)</button>
                ) : (
                  <span className="stat ok">✔ importação confirmada e salva no histórico</span>
                )}
              </div>
              <div className="card" style={{ marginTop: 14 }}>
                <h3 style={{ fontSize: 14 }}><Scale size={14} style={{ verticalAlign: -2, marginRight: 6 }} />Conciliação de saldo</h3>
                <p className="hint" style={{ marginBottom: 6 }}>Informe os saldos do extrato do banco e confira se a movimentação processada fecha: <em>saldo anterior + entradas − saídas = saldo final</em>. Diferença zero = extrato completo e sem sobras.</p>
                {(() => {
                  const pv = (t) => { const n = parseFloat(String(t).replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '')); return isFinite(n) ? n : null; };
                  const abs = (t) => Math.abs(pv(t) ?? 0);
                  const creditos = processedRows.filter(r => r.cd === 'C').reduce((s, r) => s + abs(r.valor), 0);
                  const debitos = processedRows.filter(r => r.cd === 'D').reduce((s, r) => s + abs(r.valor), 0);
                  const si = pv(concSaldoInicial);
                  const sf = pv(concSaldoFinal);
                  const fmt = (n) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                  const calculado = si !== null ? si + creditos - debitos : null;
                  const diferenca = (calculado !== null && sf !== null) ? sf - calculado : null;
                  return (
                    <>
                      <div className="row" style={{ marginTop: 4 }}>
                        <div className="field-inline"><label>Saldo anterior (banco)</label>
                          <input type="text" style={{ width: 140 }} placeholder="ex: 24.278,34" value={concSaldoInicial} onChange={e => setConcSaldoInicial(e.target.value)} />
                        </div>
                        <div className="field-inline"><label>Saldo final (banco)</label>
                          <input type="text" style={{ width: 140 }} placeholder="ex: 18.633,32" value={concSaldoFinal} onChange={e => setConcSaldoFinal(e.target.value)} />
                        </div>
                      </div>
                      <div className="stats" style={{ marginTop: 10 }}>
                        <div className="stat ok">entradas (C): {fmt(creditos)}</div>
                        <div className="stat" style={{ background: '#FBEEE1', color: '#B5651D', borderColor: '#EED6BC' }}>saídas (D): {fmt(debitos)}</div>
                        {calculado !== null && <div className="stat">saldo calculado: {fmt(calculado)}</div>}
                        {diferenca !== null && (
                          Math.abs(diferenca) < 0.005
                            ? <div className="stat ok">✔ conciliado — diferença 0,00</div>
                            : <div className="stat warn" style={{ background: '#F1E3E3', color: '#A33', borderColor: '#E0C4C4' }}>⚠ diferença de {fmt(diferenca)} — {diferenca > 0 ? 'faltam lançamentos no extrato colado (ou saldo digitado errado)' : 'há lançamentos a mais (ou saldo digitado errado)'}</div>
                        )}
                      </div>
                    </>
                  );
                })()}
              </div>

              <p className="hint" style={{ margin: '10px 0 6px' }}>
                💡 <strong>Clique no número da conta (colunas DEV. / CRED.)</strong> de qualquer linha para trocar a conta manualmente —
                útil nos casos ambíguos: DARF (INSS × PIS × COFINS × IRPJ/CSLL), sócio (retirada × pró-labore), funcionário (salário × adiantamento), aplicação etc.
                A escolha vale só para aquela linha e aparece como <span className="badge ok">✎ manual</span>.
              </p>
              <div className="table-wrap"><table>
                <thead><tr><th>DATA</th><th className="num">VALOR</th><th>HISTÓRICO</th><th>DETALHAMENTO</th><th>C/D</th><th className="num">DEV.</th><th className="num">CRED.</th><th>STATUS</th></tr></thead>
                <tbody>
                  {processedRows.map((r, i) => (
                    <tr key={i} className={r.status !== 'automatico' ? 'warn-row' : ''}>
                      <td className="mono">{r.data}</td><td className="num">{r.valor}</td>
                      <td>
                        {renderClickableText(r.historico)}
                        {r.refRelatorio && (
                          <div className="ref-relatorio" title={r.refRelatorio.tipo === 'exato'
                            ? 'Data e valor batem com um item do relatório financeiro desta empresa'
                            : `Mesmo valor no relatório, com ${r.refRelatorio.diasDiferenca} dia(s) de diferença na data`}>
                            <FileSpreadsheet size={11} style={{ verticalAlign: -1.5, marginRight: 4 }} />
                            {r.refRelatorio.item.categoria ? <strong>{r.refRelatorio.item.categoria}: </strong> : <strong>relatório: </strong>}
                            {r.refRelatorio.item.descricao.slice(0, 90)}
                            {r.refRelatorio.tipo === 'aproximado' && <em> (±{r.refRelatorio.diasDiferenca}d)</em>}
                            {r.refRelatorio.outros > 0 && <em> (+{r.refRelatorio.outros} itens iguais)</em>}
                          </div>
                        )}
                      </td>
                      <td>{renderClickableText(r.detalhamento)}</td>
                      <td className="mono">{r.cd}</td>
                      <td className="num">
                        {r.status !== 'duplicado' ? (
                          <button className="conta-cell" title={(r.contaDevedora ? `${r.contaDevedora} — ${findContaDesc(r.contaDevedora)}. ` : '') + 'Clique para escolher outra conta devedora'}
                            onClick={() => editarContaDaLinha(i, 'dev')}>
                            {r.contaDevedora || '—'}<Pencil size={10} className="conta-cell-ico" />
                          </button>
                        ) : (r.contaDevedora || '')}
                      </td>
                      <td className="num">
                        {r.status !== 'duplicado' ? (
                          <button className="conta-cell" title={(r.contaCredora ? `${r.contaCredora} — ${findContaDesc(r.contaCredora)}. ` : '') + 'Clique para escolher outra conta credora'}
                            onClick={() => editarContaDaLinha(i, 'cred')}>
                            {r.contaCredora || '—'}<Pencil size={10} className="conta-cell-ico" />
                          </button>
                        ) : (r.contaCredora || '')}
                      </td>
                      <td>
                        {r.status === 'automatico' && (
                          r.origem === 'manual'
                            ? <span className="badge ok" title="Conta escolhida manualmente por você nesta linha">✎ manual</span>
                            : r.origem === 'ia'
                              ? <span className="badge ia" title={r.sugestaoIA?.motivo || ''}>✦ IA (aceita por você)</span>
                              : <span className="badge ok">✔ automatico</span>
                        )}
                        {r.status === 'sem match' && r.sugestaoIA && (
                          <div>
                            <span className="badge ia" title={r.sugestaoIA.motivo} style={{ marginBottom: 4, display: 'inline-block' }}>
                              ✦ IA sugere: {r.sugestaoIA.codigo} — {findContaDesc(r.sugestaoIA.codigo)} ({r.sugestaoIA.confianca}% confiança)
                            </span><br />
                            {r.sugestaoIA.motivo && <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{r.sugestaoIA.motivo}</span>}
                            <div style={{ marginTop: 4, display: 'flex', gap: 5 }}>
                              <button className="btn teal" style={{ fontSize: 10.5, padding: '3px 10px' }}
                                onClick={() => aceitarSugestaoIA(i)}>Aceitar</button>
                              <button className="btn secondary" style={{ fontSize: 10.5, padding: '3px 8px' }}
                                onClick={() => { setKeywordDraft(''); setCodigoDraft(`${r.sugestaoIA.codigo} — ${findContaDesc(r.sugestaoIA.codigo)}`); }}>
                                Criar regra com esta conta
                              </button>
                            </div>
                          </div>
                        )}
                        {r.status === 'sem match' && !r.sugestaoIA && !r.sugestao && <span className="badge warn">⚠ sem match</span>}
                        {r.status === 'sem match' && !r.sugestaoIA && r.sugestao && (
                          <div>
                            <span className="badge warn" style={{ marginBottom: 4, display: 'inline-block' }}>⚠ sem match</span><br />
                            <span style={{ fontSize: 11, color: 'var(--teal-dark)' }}>
                              💡 sugestão: {r.sugestao.codigo} — {findContaDesc(r.sugestao.codigo)} ({Math.round(r.sugestao.score * 100)}% parecido)
                            </span><br />
                            <button className="btn secondary" style={{ fontSize: 10.5, padding: '3px 8px', marginTop: 3 }}
                              onClick={() => { setKeywordDraft(''); setCodigoDraft(`${r.sugestao.codigo} — ${findContaDesc(r.sugestao.codigo)}`); }}>
                              Usar sugestão
                            </button>
                          </div>
                        )}
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

      {tab === 'relatorios' && (
        <section className="panel">
          <h2>Relatórios financeiros — <span style={{ color: 'var(--teal)' }}>{empresaAtiva?.nome}</span></h2>
          <p className="hint">
            Envie os relatórios que a empresa manda (contas pagas, recebimentos, folha etc.). O site cruza cada lançamento
            do extrato com esses relatórios <strong>por data + valor</strong> e mostra do que se trata o pagamento/recebimento —
            e a IA usa essa informação pra sugerir a conta contábil certa. Também serve como consulta rápida.
          </p>

          <div className="card">
            <h3>Enviar novo relatório</h3>
            <div className="row" style={{ marginTop: 8 }}>
              <div className="field-inline"><label>Tipo do relatório</label>
                <select value={relTipo} onChange={e => setRelTipo(e.target.value)}>
                  <option value="pagamentos">Pagamentos (saídas: contas pagas, folha, guias…)</option>
                  <option value="recebimentos">Recebimentos (entradas: títulos recebidos, vendas…)</option>
                </select>
              </div>
              <div className="field-inline"><label>Arquivo (.xls / .xlsx / .csv)</label>
                <input type="file" ref={relFileInputRef} accept=".xls,.xlsx,.csv,.txt"
                  onChange={e => { if (e.target.files?.[0]) handleRelatorioFile(e.target.files[0]); }} />
              </div>
            </div>

            {relRows && relMapa && (
              <>
                <div className="field-group">
                  <div className="field-group-label">Confira as colunas detectadas (ajuste se precisar)</div>
                  <div className="row" style={{ marginTop: 0 }}>
                    <div className="field-inline"><label>Coluna da DATA (do pagamento/recebimento)</label>
                      <select value={relMapa.colData} onChange={e => setRelMapa(m => ({ ...m, colData: parseInt(e.target.value) }))}>
                        <option value={-1}>— escolher —</option>
                        {relColunas.map(c => <option key={c.indice} value={c.indice}>Coluna {c.indice + 1} (ex: {c.exemplo || 'vazia'})</option>)}
                      </select>
                    </div>
                    <div className="field-inline"><label>Coluna do VALOR</label>
                      <select value={relMapa.colValor} onChange={e => setRelMapa(m => ({ ...m, colValor: parseInt(e.target.value) }))}>
                        <option value={-1}>— escolher —</option>
                        {relColunas.map(c => <option key={c.indice} value={c.indice}>Coluna {c.indice + 1} (ex: {c.exemplo || 'vazia'})</option>)}
                      </select>
                    </div>
                    <div className="field-inline"><label>Coluna de CATEGORIA (opcional)</label>
                      <select value={relMapa.colCategoria} onChange={e => setRelMapa(m => ({ ...m, colCategoria: parseInt(e.target.value) }))}>
                        <option value={-1}>— nenhuma —</option>
                        {relColunas.map(c => <option key={c.indice} value={c.indice}>Coluna {c.indice + 1} (ex: {c.exemplo || 'vazia'})</option>)}
                      </select>
                    </div>
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <label style={{ fontSize: 11, color: 'var(--ink-soft)', fontWeight: 600 }}>Colunas de DESCRIÇÃO (fornecedor, histórico… — pode marcar várias):</label>
                    <div className="row" style={{ marginTop: 6 }}>
                      {relColunas.filter(c => c.preenchidas > 0).map(c => (
                        <label key={c.indice} style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4, border: '1px solid var(--line)', borderRadius: 6, padding: '4px 8px', background: relMapa.colsDescricao.includes(c.indice) ? 'var(--teal-bg)' : '#fff', cursor: 'pointer' }}>
                          <input type="checkbox" checked={relMapa.colsDescricao.includes(c.indice)}
                            onChange={e => setRelMapa(m => ({
                              ...m,
                              colsDescricao: e.target.checked
                                ? [...m.colsDescricao, c.indice].sort((a, b) => a - b)
                                : m.colsDescricao.filter(x => x !== c.indice),
                            }))} />
                          Col {c.indice + 1}: <span style={{ color: 'var(--ink-soft)' }}>{(c.exemplo || 'vazia').slice(0, 22)}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="stats">
                  <div className={'stat ' + (relPreviewItens.length ? 'ok' : 'warn')}>
                    {relPreviewItens.length} itens reconhecidos de {relRows.length} linhas do arquivo
                  </div>
                  {relPreviewItens.length > 0 && (
                    <div className="stat">
                      período: {fmtISOparaBR(relPreviewItens.map(i => i.data).sort()[0])} a {fmtISOparaBR(relPreviewItens.map(i => i.data).sort().slice(-1)[0])}
                    </div>
                  )}
                </div>
                {relPreviewItens.length > 0 && (
                  <div className="table-wrap" style={{ maxHeight: 260 }}>
                    <table>
                      <thead><tr><th>DATA</th><th className="num">VALOR</th><th>DESCRIÇÃO</th><th>CATEGORIA</th></tr></thead>
                      <tbody>
                        {relPreviewItens.slice(0, 12).map((i, k) => (
                          <tr key={k}>
                            <td className="mono">{fmtISOparaBR(i.data)}</td>
                            <td className="num">{i.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                            <td>{i.descricao}</td><td>{i.categoria || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="row">
                  <button className="btn teal" onClick={salvarRelatorio} disabled={relSalvando || relPreviewItens.length === 0}>
                    {relSalvando ? (<><span className="spinner" /> Salvando…</>) : `Salvar relatório (${relPreviewItens.length} itens)`}
                  </button>
                  <button className="btn secondary" onClick={() => { setRelRows(null); setRelMapa(null); setRelColunas([]); if (relFileInputRef.current) relFileInputRef.current.value = ''; }}>Cancelar</button>
                </div>
              </>
            )}
          </div>

          <div className="card">
            <h3>Consultar itens dos relatórios</h3>
            <p className="hint" style={{ marginBottom: 8 }}>Busque por texto (ex: fornecedor), por valor exato (ex: 3600,00) ou por data (ex: 01/04/2026).</p>
            <div className="row" style={{ marginTop: 0 }}>
              <input type="search" style={{ minWidth: 300 }} placeholder="fornecedor, valor ou data…" value={relBusca}
                onChange={e => setRelBusca(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') buscarNosRelatorios(); }} />
              <button className="btn secondary" onClick={buscarNosRelatorios}><Search size={13} style={{ marginRight: 5, verticalAlign: -2 }} />Buscar</button>
              {relBuscaResultados && <button className="btn secondary" onClick={() => { setRelBusca(''); setRelBuscaResultados(null); }}>Limpar</button>}
            </div>
            {relBuscaResultados && (
              relBuscaResultados.length === 0
                ? <div className="empty-state" style={{ padding: '24px 10px' }}>Nada encontrado nos relatórios desta empresa.</div>
                : <div className="table-wrap" style={{ maxHeight: 300 }}>
                    <table>
                      <thead><tr><th>DATA</th><th className="num">VALOR</th><th>TIPO</th><th>DESCRIÇÃO</th><th>CATEGORIA</th></tr></thead>
                      <tbody>
                        {relBuscaResultados.map((i, k) => (
                          <tr key={k}>
                            <td className="mono">{fmtISOparaBR(i.data)}</td>
                            <td className="num">{Number(i.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                            <td>{i.tipo === 'pagamentos' ? <span className="badge warn">saída</span> : <span className="badge ok">entrada</span>}</td>
                            <td>{i.descricao}</td><td>{i.categoria || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
            )}
          </div>

          <h3 style={{ fontSize: 13, margin: '18px 0 6px' }}>Relatórios enviados</h3>
          {relatorios.length === 0 ? (
            <div className="empty-state">Nenhum relatório enviado ainda para esta empresa.</div>
          ) : (
            <div className="table-wrap"><table>
              <thead><tr><th>ENVIADO EM</th><th>ARQUIVO</th><th>TIPO</th><th className="num">ITENS</th><th>PERÍODO</th><th>POR</th><th style={{ width: 34 }}></th></tr></thead>
              <tbody>
                {relatorios.map(rel => (
                  <tr key={rel.id}>
                    <td className="mono">{fmtData(rel.criado_em)}</td>
                    <td>{rel.nome_arquivo || '—'}</td>
                    <td>{rel.tipo === 'pagamentos' ? <span className="badge warn">pagamentos</span> : <span className="badge ok">recebimentos</span>}</td>
                    <td className="num">{rel.total_itens}</td>
                    <td className="mono">{fmtISOparaBR(rel.periodo_inicio)} — {fmtISOparaBR(rel.periodo_fim)}</td>
                    <td className="mono">{rel.enviado_por}</td>
                    <td><button className="icon-btn icon-btn-danger" title="Excluir relatório" onClick={() => excluirRelatorio(rel)}><Trash2 size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
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
            {regrasComSintetica.length > 0 && (
              <div className="stat warn" style={{ background: '#F1E3E3', color: '#A33', borderColor: '#E0C4C4' }}>⚠ {regrasComSintetica.length} regra(s) apontando pra conta Sintética</div>
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
                    <td>
                      <div className="icon-btn-group">
                        <button className="icon-btn" style={{ width: 24, height: 24 }} disabled={!isAdmin || i === 0} onClick={() => moveRegra(r, -1)}><ArrowUp size={13} /></button>
                        <button className="icon-btn" style={{ width: 24, height: 24 }} disabled={!isAdmin || i === regras.length - 1} onClick={() => moveRegra(r, 1)}><ArrowDown size={13} /></button>
                      </div>
                    </td>
                    <td><input className="cell-edit" defaultValue={r.palavra_chave} readOnly={!isAdmin} onBlur={e => isAdmin && updateRegra(r, 'palavra_chave', e.target.value)} /></td>
                    <td style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <input className="cell-edit" list="contas-datalist" defaultValue={r.codigo ? `${r.codigo} — ${findContaDesc(r.codigo)}` : ''} readOnly={!isAdmin}
                        onBlur={e => isAdmin && updateRegra(r, 'codigo', extractCodigoFromPicked(e.target.value))} />
                      {isAdmin && <button className="icon-btn" style={{ width: 26, height: 26 }} title="Buscar conta" onClick={() => openPicker((conta) => updateRegra(r, 'codigo', String(conta.codigo)))}><Search size={13} /></button>}
                    </td>
                    <td className="mono" style={{ color: !findContaDesc(r.codigo) ? 'var(--amber)' : (isContaSintetica(r.codigo) ? '#A33' : 'var(--ink-soft)') }}>
                      {!r.codigo ? '' : !findContaDesc(r.codigo) ? 'código não encontrado' : isContaSintetica(r.codigo) ? `⚠ ${findContaDesc(r.codigo)} (SINTÉTICA — evite lançar aqui)` : findContaDesc(r.codigo)}
                    </td>
                    <td><input className="cell-edit" defaultValue={r.descricao || ''} readOnly={!isAdmin} onBlur={e => isAdmin && updateRegra(r, 'descricao', e.target.value)} /></td>
                    <td>{isAdmin && <button className="icon-btn icon-btn-danger" onClick={() => deleteRegra(r)}><Trash2 size={14} /></button>}</td>
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
            <select value={grupoFiltro} onChange={e => setGrupoFiltro(e.target.value)}>
              <option value="">Todos os grupos</option>
              {Object.values(GRUPOS_POR_NIVEL1).map(g => <option key={g} value={g}>{g}</option>)}
            </select>
            <button className="btn secondary" onClick={() => openPicker(() => {})}><Search size={13} style={{marginRight:5,verticalAlign:-2}}/>Abrir em janela de busca (F4)</button>
            {isAdmin && <button className="btn" onClick={addContaManual}>+ Nova conta manual</button>}
          </div>
          <div className="table-wrap" style={{ marginTop: 14 }}>
            <table>
              <thead><tr><th style={{ width: '9%' }}>CÓDIGO</th><th style={{ width: '15%' }}>CLASSIFICAÇÃO</th><th style={{ width: '13%' }}>GRUPO</th><th>DESCRIÇÃO</th><th style={{ width: '10%' }}>TIPO</th><th style={{ width: 34 }}></th></tr></thead>
              <tbody>
                {contasFiltradas.map(c => (
                  <tr key={c.id} title={c.updated_by ? `editado por ${c.updated_by} em ${fmtData(c.updated_at)}` : ''}>
                    <td><input className="cell-edit" defaultValue={c.codigo} readOnly={!isAdmin} onBlur={e => isAdmin && updateConta(c, 'codigo', e.target.value)} /></td>
                    <td><input className="cell-edit" defaultValue={c.classificacao || ''} readOnly={!isAdmin} onBlur={e => isAdmin && updateConta(c, 'classificacao', e.target.value)} /></td>
                    <td className="mono" style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{grupoOf(c.classificacao)}</td>
                    <td><input className="cell-edit" defaultValue={c.descricao} readOnly={!isAdmin} onBlur={e => isAdmin && updateConta(c, 'descricao', e.target.value)} /></td>
                    <td>
                      {isAdmin ? (
                        <select defaultValue={c.tipo || ''} onChange={e => updateConta(c, 'tipo', e.target.value || null)} style={{ fontSize: 11.5 }}>
                          <option value="">—</option>
                          <option value="A">Analítica</option>
                          <option value="S">Sintética</option>
                        </select>
                      ) : (
                        c.tipo === 'S' ? <span className="badge warn">Sintética</span> : c.tipo === 'A' ? <span className="badge ok">Analítica</span> : '—'
                      )}
                    </td>
                    <td>{isAdmin && <button className="icon-btn icon-btn-danger" onClick={() => deleteConta(c)}><Trash2 size={14} /></button>}</td>
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
                <thead><tr><th>DATA</th><th className="num">DEV.</th><th className="num">CRED.</th><th className="num">VALOR</th><th>HISTÓRICO</th><th>STATUS</th></tr></thead>
                <tbody>
                  {processedRows.map((r, i) => {
                    const historicoFull = r.detalhamento ? `${r.historico} - ${r.detalhamento}` : r.historico;
                    return (
                      <tr key={i} className={r.status !== 'automatico' ? 'warn-row' : ''}>
                        <td className="mono">{r.data}</td><td className="num">{r.contaDevedora}</td><td className="num">{r.contaCredora}</td>
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

      </div>

      {tab === 'assinantes' && souSuper && (
        <section className="panel">
          <div className="empresas-layout">
          <div>
            <h2>Assinantes do sistema</h2>
            <p className="hint">Cada assinante é um escritório com ambiente próprio e isolado: os usuários dele só enxergam as empresas dele. A cobrança é pelo <strong>limite de empresas (CNPJs)</strong>; usuários são ilimitados. Suspender corta o acesso de todos na hora (reversível).</p>
            {assCarregando ? (
              <div className="center-loading">carregando assinantes…</div>
            ) : (
              <div className="table-wrap"><table>
                <thead><tr><th>ESCRITÓRIO</th><th>GERENTE(S)</th><th className="num">EMPRESAS</th><th className="num">USUÁRIOS</th><th>STATUS</th><th>DESDE</th><th style={{ width: 120 }}>AÇÕES</th></tr></thead>
                <tbody>
                  {assinantes.map(esc => (
                    <tr key={esc.id} style={esc.ativo ? {} : { opacity: 0.55 }}>
                      <td><strong>{esc.nome}</strong>{esc.id === meuEscritorioId && <span className="pill" style={{ marginLeft: 6 }}>seu</span>}</td>
                      <td className="mono" style={{ fontSize: 11.5 }}>{esc.gerentes || '—'}</td>
                      <td className="num" style={esc.qtde_empresas >= esc.limite_empresas ? { color: 'var(--danger)', fontWeight: 700 } : {}}>
                        {esc.qtde_empresas} / {esc.limite_empresas}
                      </td>
                      <td className="num">{esc.qtde_usuarios}</td>
                      <td>{esc.ativo ? <span className="badge ok">ativa</span> : <span className="badge warn">suspensa</span>}</td>
                      <td className="mono" style={{ fontSize: 11.5 }}>{fmtData(esc.criado_em)}</td>
                      <td>
                        <button className="icon-btn" title="Ver o ambiente deste assinante (modo suporte)" onClick={() => verAmbienteAssinante(esc)}><Eye size={14} /></button>
                        <button className="icon-btn" title="Alterar limite de empresas do plano" onClick={() => editarLimiteAssinante(esc)}><Pencil size={14} /></button>
                        {esc.id !== meuEscritorioId && (
                          <button className="icon-btn" title={esc.ativo ? 'Suspender assinatura' : 'Reativar assinatura'} onClick={() => alternarAtivoAssinante(esc)}>
                            {esc.ativo ? <UserX size={14} /> : <UserCheck size={14} />}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </div>

          <div className="card destaque" style={{ marginTop: 0 }}>
            <h3 style={{ fontSize: 15.5 }}>Novo assinante</h3>
            <p className="hint" style={{ marginBottom: 0 }}>Cria o escritório já com o usuário <strong>gerente</strong>, que administra o próprio ambiente: cadastra as empresas (até o limite do plano) e cria os usuários da equipe dele.</p>

            <div className="field-label">Nome do escritório</div>
            <input type="text" style={{ width: '100%' }} placeholder="ex: Contabilidade Silva & Souza" value={assForm.nome}
              onChange={e => setAssForm(f => ({ ...f, nome: e.target.value }))} />

            <div className="field-label">Limite de empresas do plano</div>
            <input type="number" min="1" style={{ width: 120 }} value={assForm.limite_empresas}
              onChange={e => setAssForm(f => ({ ...f, limite_empresas: parseInt(e.target.value) || 1 }))} />

            <div className="field-label">Usuário do gerente</div>
            <input type="text" style={{ width: '100%' }} placeholder="ex: silva.gerente" value={assForm.gerente_username}
              onChange={e => setAssForm(f => ({ ...f, gerente_username: e.target.value }))} />

            <div className="field-label">E-mail do gerente (opcional)</div>
            <input type="email" style={{ width: '100%' }} placeholder="ex: contato@silvaesouza.com.br" value={assForm.gerente_email}
              onChange={e => setAssForm(f => ({ ...f, gerente_email: e.target.value }))} />

            <div className="field-label">Senha inicial do gerente</div>
            <input type="text" style={{ width: '100%' }} placeholder="mínimo 6 caracteres" value={assForm.gerente_password}
              onChange={e => setAssForm(f => ({ ...f, gerente_password: e.target.value }))} />

            <div className="row">
              <button className="btn teal full" onClick={criarAssinante}
                disabled={assSalvando || !assForm.nome.trim() || !assForm.gerente_username || !assForm.gerente_password}>
                {assSalvando ? (<><span className="spinner" /> Criando…</>) : 'Criar assinante'}
              </button>
            </div>
          </div>
          </div>
        </section>
      )}

      {tab === 'usuarios' && isAdmin && (
        <section className="panel">
          <div className="empresas-layout">
          <div>
            <h2>Gerenciamento de Usuários</h2>
            <p className="hint">Crie logins para a equipe, defina o papel de cada um e limite o acesso por empresa. Usuário desativado perde o acesso na hora.</p>
            {usrCarregando ? (
              <div className="center-loading">carregando usuários…</div>
            ) : (
              <div className="table-wrap"><table>
                <thead><tr><th>USUÁRIO</th><th>E-MAIL</th><th>PAPEL</th><th>ACESSO</th><th>ÚLTIMO LOGIN</th><th>STATUS</th><th style={{ width: 130 }}>AÇÕES</th></tr></thead>
                <tbody>
                  {usuarios.map(u => (
                    <tr key={u.user_id} style={u.ativo ? {} : { opacity: 0.55 }}>
                      <td><strong>{u.username || '—'}</strong>{u.sou_eu && <span className="pill" style={{ marginLeft: 6 }}>você</span>}</td>
                      <td className="mono" style={{ fontSize: 11.5 }}>{u.email || '—'}</td>
                      <td>{u.role === 'admin' ? <span className="badge ia">admin</span> : <span className="badge ok">operador</span>}</td>
                      <td style={{ fontSize: 12 }}>
                        {u.role === 'admin' || u.acesso_todas
                          ? 'todas as empresas'
                          : `${u.empresas.length} empresa(s)`}
                      </td>
                      <td className="mono" style={{ fontSize: 11.5 }}>{u.ultimo_login ? fmtData(u.ultimo_login) : 'nunca entrou'}</td>
                      <td>{u.ativo ? <span className="badge ok">ativo</span> : <span className="badge warn">desativado</span>}</td>
                      <td>
                        <button className="icon-btn" title="Editar papel e acesso" onClick={() => editarUsuario(u)}><Pencil size={14} /></button>
                        <button className="icon-btn" title="Redefinir senha" onClick={() => redefinirSenhaUsuario(u)}><KeyRound size={14} /></button>
                        {!u.sou_eu && (
                          <button className="icon-btn" title={u.ativo ? 'Desativar (reversível)' : 'Reativar'} onClick={() => alternarAtivoUsuario(u)}>
                            {u.ativo ? <UserX size={14} /> : <UserCheck size={14} />}
                          </button>
                        )}
                        {!u.sou_eu && <button className="icon-btn icon-btn-danger" title="Excluir de vez" onClick={() => excluirUsuario(u)}><Trash2 size={14} /></button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </div>

          <div className="card destaque" style={{ marginTop: 0 }}>
            <h3 style={{ fontSize: 15.5 }}>{usrEditandoId ? 'Editar usuário' : 'Novo usuário'}</h3>
            {!usrEditandoId && <p className="hint" style={{ marginBottom: 0 }}>O usuário entra com o nome de usuário e a senha que você definir aqui. E-mail é opcional (serve só de referência).</p>}

            <div className="field-label">Nome de usuário</div>
            <input type="text" style={{ width: '100%' }} placeholder="ex: joao.silva" value={usrForm.username}
              disabled={!!usrEditandoId}
              onChange={e => setUsrForm(f => ({ ...f, username: e.target.value }))} />

            {!usrEditandoId && (
              <>
                <div className="field-label">E-mail (opcional)</div>
                <input type="email" style={{ width: '100%' }} placeholder="ex: joao@escritorio.com.br" value={usrForm.email}
                  onChange={e => setUsrForm(f => ({ ...f, email: e.target.value }))} />
                <div className="field-label">Senha inicial</div>
                <input type="text" style={{ width: '100%' }} placeholder="mínimo 6 caracteres" value={usrForm.password}
                  onChange={e => setUsrForm(f => ({ ...f, password: e.target.value }))} />
              </>
            )}

            <div className="field-label">Papel</div>
            <select style={{ width: '100%' }} value={usrForm.role} onChange={e => setUsrForm(f => ({ ...f, role: e.target.value }))}>
              <option value="operador">Operador — processa extratos, cria regras</option>
              <option value="admin">Administrador — acesso total, gerencia tudo</option>
            </select>

            {usrForm.role !== 'admin' && (
              <>
                <div className="field-label">Acesso às empresas</div>
                <div className="row" style={{ marginTop: 4 }}>
                  <label style={{ fontSize: 12.5 }}><input type="radio" checked={usrForm.acesso_todas} onChange={() => setUsrForm(f => ({ ...f, acesso_todas: true }))} /> Todas as empresas</label>
                  <label style={{ fontSize: 12.5 }}><input type="radio" checked={!usrForm.acesso_todas} onChange={() => setUsrForm(f => ({ ...f, acesso_todas: false }))} /> Somente as escolhidas:</label>
                </div>
                {!usrForm.acesso_todas && (
                  <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', marginTop: 8, background: '#fff' }}>
                    {empresas.map(e => (
                      <label key={e.id} style={{ display: 'block', fontSize: 12.5, padding: '3px 0', cursor: 'pointer' }}>
                        <input type="checkbox" checked={usrForm.empresas.includes(e.id)}
                          onChange={ev => setUsrForm(f => ({
                            ...f,
                            empresas: ev.target.checked ? [...f.empresas, e.id] : f.empresas.filter(x => x !== e.id),
                          }))} /> {e.nome}
                      </label>
                    ))}
                  </div>
                )}
              </>
            )}

            <div className="row">
              <button className="btn teal full" onClick={salvarUsuario}
                disabled={usrSalvando || (!usrEditandoId && (!usrForm.username || !usrForm.password))}>
                {usrSalvando ? (<><span className="spinner" /> Salvando…</>) : (usrEditandoId ? 'Salvar alterações' : 'Criar usuário')}
              </button>
            </div>
            {usrEditandoId && (
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn secondary full" onClick={() => { setUsrEditandoId(null); setUsrForm(USR_FORM_VAZIO); }}>Cancelar edição</button>
              </div>
            )}

            <details style={{ marginTop: 16, fontSize: 12, color: 'var(--ink-soft)' }}>
              <summary style={{ cursor: 'pointer', fontWeight: 700, color: 'var(--ink)' }}>Ver a lista completa de permissões de cada papel</summary>
              <div style={{ marginTop: 8, lineHeight: 1.7 }}>
                <strong style={{ color: 'var(--ink)' }}>Operador</strong> — pode: processar e confirmar extratos; usar a IA e aceitar sugestões; trocar conta manualmente nas linhas; criar regras novas; enviar e consultar relatórios financeiros; exportar o arquivo de importação; ver plano de contas e histórico. Não pode: criar/editar/excluir empresas; editar ou excluir regras existentes; editar o plano de contas; mexer em layouts de banco; gerenciar usuários. Se marcado com "somente as escolhidas", só enxerga as empresas liberadas — a trava vale no banco de dados, não só na tela.<br /><br />
                <strong style={{ color: 'var(--ink)' }}>Administrador (gerente do escritório)</strong> — tudo do operador e mais: criar/editar/excluir empresas (até o limite do plano); editar plano de contas, regras e layouts próprios; criar e gerenciar os usuários do próprio escritório (papéis, acesso por empresa, senhas, desativação). Não enxerga nem administra outros escritórios.<br /><br />
                <strong style={{ color: 'var(--ink)' }}>Dono do sistema (você)</strong> — tudo acima em qualquer escritório, mais a aba Assinantes: criar assinantes, definir limites do plano, suspender/reativar e entrar em modo suporte.
              </div>
            </details>
          </div>
          </div>
        </section>
      )}

      <footer className="statusbar">
        <div><span className="dot" />Conectado · dados salvos no Supabase, acessíveis por qualquer login autorizado</div>
        <div>Sugestões da IA nunca são aplicadas sem a sua confirmação</div>
      </footer>
    </div>
  );
}
