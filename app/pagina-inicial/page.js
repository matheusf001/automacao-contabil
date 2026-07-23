'use client';
import { useEffect, useState, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import * as XLSX from 'xlsx';
import { Check, Pencil, Trash2, Search, Plus, ArrowUp, ArrowDown, X, Sparkles, Clock, Building2, ChevronDown, ChevronUp, ChevronRight, FileSpreadsheet, FileText, BarChart3, Settings, BookOpen, Upload, History, Users, KeyRound, UserX, UserCheck, Crown, Eye, Scale, CreditCard, FolderOpen, AlertTriangle, Banknote, LayoutDashboard, Menu, LogOut } from 'lucide-react';
import { parsePlanoFile, parsePlanoPaste, parseExtrato, classificar, downloadFile, downloadFileAnsi, tokenizarTexto, sugerirConta, similaridadeJaccard } from '@/lib/planoParser';
import { lerArquivoEmLinhas, detectarColunas, extrairItens, construirIndiceRelatorio, cruzarComRelatorio, fmtISOparaBR, normalizarDataISO } from '@/lib/relatorioParser';
import ContaPickerModal from '@/components/ContaPickerModal';
import InputModal from '@/components/InputModal';
import { cruzarComFolha, contaParaEvento, descreverRefFolha } from '@/lib/folhaMatcher';
import { PLANOS, getPlano, formatarPreco } from '@/lib/planos';

// Barras cinzas pulsantes exibidas enquanto os dados carregam (melhor que "carregando…")
function SkeletonTabela({ linhas = 4 }) {
  return (
    <div className="skeleton-wrap">
      {Array.from({ length: linhas }).map((_, i) => (
        <div key={i} className="skeleton-bar" style={{ width: `${92 - (i % 4) * 9}%` }} />
      ))}
    </div>
  );
}

// Botão de "Escolher arquivo" estilizado (o input nativo fica escondido, mas continua acessível por teclado).
// Também aceita arrastar-e-soltar (drag & drop): dá pra soltar o arquivo em cima da área toda.
function FilePicker({ id, inputRef, accept, fileName, onFileChange, big, titulo, subtitulo, formatos }) {
  const [arrastando, setArrastando] = useState(false);
  function handleDrop(e) {
    e.preventDefault();
    setArrastando(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) onFileChange(f);
  }
  const dragProps = {
    onDragOver: e => { e.preventDefault(); setArrastando(true); },
    onDragEnter: e => { e.preventDefault(); setArrastando(true); },
    onDragLeave: e => { e.preventDefault(); setArrastando(false); },
    onDrop: handleDrop,
  };
  // variante grande (área de soltar arquivo, como no preview)
  if (big) {
    return (
      <div className={'dropzone' + (arrastando ? ' drag-over' : '')} {...dragProps}>
        <input type="file" id={id} ref={inputRef} accept={accept} style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', border: 0 }}
          onChange={e => onFileChange(e.target.files?.[0] || null)} />
        <label htmlFor={id}>
          <div className="dz-ico"><Upload size={24} /></div>
          <div className={'dz-title' + (fileName ? ' has-file' : '')}>{fileName || titulo || 'Arraste o arquivo aqui ou clique para selecionar'}</div>
          <div className="dz-sub">{fileName ? 'Arquivo carregado — clique para trocar' : subtitulo}</div>
          {formatos && formatos.length > 0 && (
            <div className="dz-formats">{formatos.map(f => <span key={f} className="dz-fmt">{f}</span>)}</div>
          )}
        </label>
      </div>
    );
  }
  return (
    <div className={'file-picker' + (arrastando ? ' drag-over' : '')} {...dragProps}>
      <input type="file" id={id} ref={inputRef} accept={accept}
        onChange={e => onFileChange(e.target.files?.[0] || null)} />
      <label htmlFor={id} className="file-picker-btn"><Upload size={14} />Escolher arquivo</label>
      <span className={'file-picker-name' + (fileName ? ' has-file' : '')}>{fileName || 'ou arraste o arquivo até aqui'}</span>
    </div>
  );
}

// Dropdown de "empresa selecionada" no cabeçalho, com busca (substitui o <select> nativo)
function EmpresaPicker({ empresas, currentEmpresaId, onSelect }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setSearch('');
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const atual = empresas.find(e => e.id === currentEmpresaId);
  const f = search.trim().toLowerCase();
  const filtradas = f ? empresas.filter(e => e.nome.toLowerCase().includes(f)) : empresas;

  return (
    <div className="empresa-picker">
      <label>Empresa selecionada</label>
      <button type="button" className={'empresa-picker-trigger' + (open ? ' open' : '')} onClick={() => setOpen(v => !v)}>
        <span>{atual?.nome || 'Selecione…'}</span>
        <ChevronDown size={15} />
      </button>
      {open && (
        <>
          <div className="empresa-dropdown-backdrop" onClick={() => setOpen(false)} />
          <div className="empresa-dropdown">
            <div className="empresa-dropdown-search">
              <Search size={14} />
              <input ref={inputRef} type="text" placeholder="Buscar empresa…"
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="empresa-dropdown-list">
              {filtradas.length === 0 && <div className="empty-state" style={{ padding: '24px 12px' }}>Nenhuma empresa encontrada.</div>}
              {filtradas.map(e => (
                <div key={e.id} className={'empresa-dropdown-item' + (e.id === currentEmpresaId ? ' active' : '')}
                  onClick={() => { onSelect(e.id); setOpen(false); }}>
                  <span>{e.nome}</span>
                  {e.id === currentEmpresaId && <Check size={14} />}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const TAB_META = {
  inicio:     { label: 'Página Inicial',  Icon: LayoutDashboard },
  empresas:   { label: 'Empresas',        Icon: Building2 },
  extrato:    { label: 'Extrato',         Icon: FileText },
  relatorios: { label: 'Relatórios',      Icon: BarChart3 },
  folha:      { label: 'Folha',           Icon: Banknote },
  regras:     { label: 'Regras',          Icon: Settings },
  contas:     { label: 'Plano de Contas', Icon: BookOpen },
  importacao: { label: 'Importação',      Icon: Upload },
  historico:  { label: 'Histórico',       Icon: History },
  usuarios:   { label: 'Usuários',        Icon: Users },
  assinantes: { label: 'Assinantes',      Icon: Crown },
};

// grupos do menu lateral (mesma ordem do preview aprovado)
const MENU_SECOES = [
  { titulo: 'Principal', tabs: ['inicio', 'empresas'] },
  { titulo: 'Movimento', tabs: ['extrato', 'relatorios', 'folha'] },
  { titulo: 'Automação', tabs: ['regras', 'contas', 'importacao'] },
  { titulo: 'Sistema',   tabs: ['historico', 'usuarios', 'assinantes'] },
];

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

export default function PaginaInicial() {
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

  const [tab, setTab] = useState('inicio');
  const [menuRecolhido, setMenuRecolhido] = useState(false);   // sidebar só com ícones (telas grandes)
  const [menuMobileAberto, setMenuMobileAberto] = useState(false); // sidebar deslizante (telas pequenas)
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
  const [filtroStatus, setFiltroStatus] = useState('todos'); // filtro da tabela de lançamentos (aba Extrato)
  const [regrasSearch, setRegrasSearch] = useState(''); // busca na aba Regras
  const [confirmado, setConfirmado] = useState(false);
  const [confirmando, setConfirmando] = useState(false); // trava contra duplo clique (evita gravar a importação em dobro)
  const [processando, setProcessando] = useState(false);
  const [importStatus, setImportStatus] = useState('');
  const [destEmpresaImport, setDestEmpresaImport] = useState(null);
  const [saveFlag, setSaveFlag] = useState('');
  const [historico, setHistorico] = useState([]);
  const [keywordDraft, setKeywordDraft] = useState('');
  const [codigoDraft, setCodigoDraft] = useState('');
  const [toasts, setToasts] = useState([]);
  const [pickerOnSelect, setPickerOnSelect] = useState(null);
  const [inputModal, setInputModal] = useState(null); // { titulo, texto, label, valorInicial, confirmarLabel, onConfirm } — substitui window.prompt()

  // folha de pagamento (Fase 1: funcionários + líquidos importados do PDF)
  const [funcionarios, setFuncionarios] = useState([]);
  const [folhas, setFolhas] = useState([]);
  const [folhaPreview, setFolhaPreview] = useState(null); // resultado do PDF lido, aguardando conferência
  const [folhaLendo, setFolhaLendo] = useState(false);
  const [folhaSalvando, setFolhaSalvando] = useState(false);
  const [fileNameFolha, setFileNameFolha] = useState('');
  const folhaFileRef = useRef(null);
  const dadosFolhaRef = useRef({ itens: [], funcionarios: [], totais: [], config: null }); // usado no cruzamento com o extrato
  const [folhaCfgDraft, setFolhaCfgDraft] = useState({ salario: '', ferias: '', rescisao: '', decimo: '' });
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

  useEffect(() => {
    if (tab === 'folha' && currentEmpresaId) { loadFuncionarios(currentEmpresaId); loadFolhas(currentEmpresaId); }
  }, [tab, currentEmpresaId]); // eslint-disable-line react-hooks/exhaustive-deps

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

  function redefinirSenhaUsuario(u) {
    setInputModal({
      titulo: 'Redefinir senha',
      texto: <>Nova senha para <strong>"{u.username || u.email}"</strong> (mínimo 6 caracteres):</>,
      label: 'Nova senha',
      confirmarLabel: 'Redefinir',
      onConfirm: async (nova) => {
        if (!nova) return;
        try {
          await apiUsuarios('PATCH', { user_id: u.user_id, password: nova });
          notify('Senha redefinida — avise o usuário.', 'success');
        } catch (err) { notify(err.message); }
      },
    });
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
  const [assModal, setAssModal] = useState(null); // { tipo: 'limite'|'suspender'|'cobranca'|'link', esc, ... }
  const [assModalSalvando, setAssModalSalvando] = useState(false);

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

  function editarLimiteAssinante(esc) {
    setAssModal({ tipo: 'limite', esc, valor: String(esc.limite_empresas) });
  }

  async function confirmarLimiteAssinante() {
    const { esc, valor } = assModal;
    const novo = parseInt(valor);
    if (!novo || novo < 1) { notify('Informe um número válido.'); return; }
    setAssModalSalvando(true);
    try {
      await apiAssinantes('PATCH', { id: esc.id, limite_empresas: novo });
      notify('Limite atualizado.', 'success');
      setAssModal(null);
      carregarAssinantes();
    } catch (err) {
      notify(err.message);
    } finally {
      setAssModalSalvando(false);
    }
  }

  function alternarAtivoAssinante(esc) {
    setAssModal({ tipo: 'suspender', esc });
  }

  async function confirmarAlternarAtivo() {
    const { esc } = assModal;
    setAssModalSalvando(true);
    try {
      await apiAssinantes('PATCH', { id: esc.id, ativo: !esc.ativo });
      notify(esc.ativo ? 'Assinatura suspensa.' : 'Assinatura reativada.', 'success');
      setAssModal(null);
      carregarAssinantes();
    } catch (err) {
      notify(err.message);
    } finally {
      setAssModalSalvando(false);
    }
  }

  function excluirAssinante(esc) {
    setAssModal({ tipo: 'excluir', esc, confirmNome: '' });
  }

  async function confirmarExcluirAssinante() {
    const { esc, confirmNome } = assModal;
    if ((confirmNome || '').trim().toLowerCase() !== esc.nome.trim().toLowerCase()) {
      notify('Digite o nome do escritório exatamente para confirmar a exclusão.');
      return;
    }
    setAssModalSalvando(true);
    try {
      await apiAssinantes('DELETE', { id: esc.id });
      notify(`Assinante "${esc.nome}" excluído definitivamente.`, 'success');
      setAssModal(null);
      await carregarAssinantes();
      await loadEmpresas();
    } catch (err) {
      notify(err.message);
    } finally {
      setAssModalSalvando(false);
    }
  }

  // Gera o link de assinatura do Mercado Pago pra mandar no WhatsApp do
  // assinante. Quando ele pagar, o webhook libera/ajusta tudo sozinho.
  function gerarLinkCobranca(esc) {
    setAssModal({ tipo: 'cobranca', esc, planoId: esc.plano || PLANOS[1]?.id || PLANOS[0].id, email: esc.email_cobranca || '' });
  }

  async function confirmarGerarLinkCobranca() {
    const { esc, planoId, email } = assModal;
    const plano = getPlano(planoId);
    if (!plano) { notify('Escolha um plano.'); return; }
    if (!email || !email.includes('@')) { notify('Informe um e-mail válido.'); return; }
    setAssModalSalvando(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/assinatura/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
        body: JSON.stringify({ escritorio_id: esc.id, plano: plano.id, email }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { notify(json.error || 'Erro ao gerar o link.'); return; }
      try { await navigator.clipboard.writeText(json.checkout_url); notify('Link copiado! Cole no WhatsApp do assinante.', 'success'); } catch {}
      setAssModal({ tipo: 'link', esc, checkoutUrl: json.checkout_url });
      carregarAssinantes();
    } catch (err) {
      notify('Erro: ' + err.message);
    } finally {
      setAssModalSalvando(false);
    }
  }

  function verAmbienteAssinante(esc) {
    setEscritorioVisao(esc.id);
    setEscritorioVisaoNome(esc.nome);
    setTab('empresas');
    notify(`Modo suporte: você está vendo o ambiente de "${esc.nome}".`, 'info');
  }

  // ---------- NOVA EMPRESA COM BUSCA DE CNPJ ----------
  const EMPRESA_VAZIA = { cnpj: '', nome: '', municipio: '', uf: '' };
  const [mostrarNovaEmpresa, setMostrarNovaEmpresa] = useState(false);
  const [novaEmpresa, setNovaEmpresa] = useState(EMPRESA_VAZIA);
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
      setNovaEmpresa(f => ({ ...f, nome, municipio: d.municipio || '', uf: d.uf || '' }));
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
      const payload = {
        nome,
        cnpj: cnpjDigitos.length === 14 ? formatarCNPJ(cnpjDigitos) : null,
        municipio: novaEmpresa.municipio.trim() || null,
        uf: novaEmpresa.uf.trim().toUpperCase() || null,
      };
      // no modo suporte, a empresa nasce no escritório do assinante que está sendo atendido
      if (souSuper && escritorioVisao) payload.escritorio_id = escritorioVisao;
      let { data, error } = await supabase.from('empresas').insert(payload).select().single();
      if (error && /municipio|uf/.test(error.message)) {
        // banco ainda sem as colunas novas (script sql/empresas_municipio.sql não rodado) — salva sem elas
        const { municipio, uf, ...semMunicipio } = payload;
        ({ data, error } = await supabase.from('empresas').insert(semMunicipio).select().single());
      }
      if (error) { notify('Erro ao criar empresa: ' + error.message); return; }
      await loadEmpresas();
      selecionarEmpresa(data.id);
      setMostrarNovaEmpresa(false);
      setNovaEmpresa(EMPRESA_VAZIA);
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

  // ---------- MEMÓRIA DAS ESCOLHAS MANUAIS ----------
  // Quando o usuário troca uma conta na mão e depois reprocessa (criou uma
  // regra, clicou em Processar de novo…), a escolha dele NÃO pode sumir.
  // Guardamos por "impressão digital" do lançamento (data+valor+histórico)
  // e reaplicamos a cada processamento. Some só ao Limpar, trocar de
  // arquivo/empresa ou confirmar a importação.
  const manualOverridesRef = useRef(new Map());

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
    try { setMenuRecolhido(localStorage.getItem('ac_menu_recolhido') === '1'); } catch { /* ignora */ }
  }, []);

  // Botão dos 3 tracinhos: em tela grande recolhe/expande a sidebar (fica só
  // com os ícones); em tela pequena abre/fecha o menu deslizante.
  function alternarMenu() {
    if (typeof window !== 'undefined' && window.innerWidth <= 1020) {
      setMenuMobileAberto(v => !v);
      return;
    }
    setMenuRecolhido(v => {
      const novo = !v;
      try { localStorage.setItem('ac_menu_recolhido', novo ? '1' : '0'); } catch { /* ignora */ }
      return novo;
    });
  }

  function trocarTab(t) {
    setTab(t);
    setMenuMobileAberto(false); // no celular, fecha o menu ao escolher uma aba
  }

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
    manualOverridesRef.current.clear(); // memória de contas manuais é por extrato/empresa
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
  const [fileNamePlano, setFileNamePlano] = useState('');
  const [fileNameExtrato, setFileNameExtrato] = useState('');

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
        manualOverridesRef.current.clear();
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
      manualOverridesRef.current.clear();
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
    if (currentEmpresaId) { loadPlanoContas(currentEmpresaId); loadRegras(currentEmpresaId); loadHistorico(currentEmpresaId); loadBaseAprendizado(currentEmpresaId); loadRelatorios(currentEmpresaId); loadDadosFolha(currentEmpresaId); }
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
  function criarEmpresa() {
    setInputModal({
      titulo: 'Nova empresa',
      label: 'Nome da nova empresa',
      confirmarLabel: 'Criar',
      onConfirm: async (nome) => {
        if (!nome || !nome.trim()) return;
        const { data, error } = await supabase.from('empresas').insert({ nome: nome.trim() }).select().single();
        if (error) { notify('Erro ao criar empresa: ' + error.message); return; }
        await loadEmpresas();
        selecionarEmpresa(data.id);
        notify(`Empresa "${nome.trim()}" criada!`, 'success');
      },
    });
  }
  function renomearEmpresa(emp) {
    setInputModal({
      titulo: 'Renomear empresa',
      label: 'Novo nome da empresa',
      valorInicial: emp.nome,
      confirmarLabel: 'Renomear',
      onConfirm: async (novoNome) => {
        if (!novoNome || !novoNome.trim()) return;
        const { error } = await supabase.from('empresas').update({ nome: novoNome.trim() }).eq('id', emp.id);
        if (error) { notify('Erro ao renomear: ' + error.message); return; }
        loadEmpresas();
      },
    });
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
    setFileNamePlano('');
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
    if (field === 'codigo' || field === 'codigo_recebimento') {
      const codigoNum = parseInt(value) || 0;
      if (codigoNum && isContaSintetica(codigoNum)) {
        notify('Essa conta é Sintética (de totalização) — escolha uma conta Analítica.');
        loadRegras(currentEmpresaId); // recarrega pra desfazer o valor digitado na tela
        return;
      }
    }
    const patch = {
      [field]: field === 'codigo' ? (parseInt(value) || 0)
        : field === 'codigo_recebimento' ? (parseInt(value) || null)
        : value,
      updated_by: userEmail, updated_at: new Date().toISOString(),
    };
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
  function novoLayout() {
    setInputModal({
      titulo: 'Novo layout de banco',
      label: 'Nome do novo layout',
      placeholder: 'ex: nome do banco',
      confirmarLabel: 'Criar',
      onConfirm: async (nome) => {
        if (!nome || !nome.trim()) return;
        const base = currentLayout || { separador: 'auto', col_data: 0, col_historico: 2, col_valor: 1, cd_mode: 'coluna', col_cd: 3, col_detalhamento: 4 };
        const { data, error } = await supabase.from('layouts_banco').insert({ ...base, id: undefined, nome: nome.trim() }).select().single();
        if (error) { notify('Erro: ' + error.message); return; }
        await loadLayouts();
        setCurrentLayoutId(data.id);
      },
    });
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

  // ---------- FOLHA DE PAGAMENTO (Fase 1: funcionários + líquidos do PDF) ----------
  async function loadFuncionarios(empresaId) {
    const { data, error } = await supabase.from('funcionarios').select('*').eq('empresa_id', empresaId).order('nome');
    if (error) { console.error(error); return; }
    setFuncionarios(data || []);
  }
  async function loadFolhas(empresaId) {
    const { data, error } = await supabase.from('folhas').select('*').eq('empresa_id', empresaId).order('criado_em', { ascending: false });
    if (error) { console.error(error); return; }
    setFolhas(data || []);
  }
  async function lerPdfFolha() {
    const file = folhaFileRef.current?.files?.[0];
    if (!file) { notify('Escolha o PDF da folha primeiro.'); return; }
    setFolhaLendo(true);
    setFolhaPreview(null);
    try {
      const fd = new FormData();
      fd.append('arquivo', file);
      const res = await fetch('/api/folha/parse', { method: 'POST', body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { notify(json.error || 'Erro ao ler o PDF.'); return; }
      setFolhaPreview(json);
    } catch {
      notify('Falha de conexão ao enviar o PDF — tente de novo.');
    } finally {
      setFolhaLendo(false);
    }
  }
  async function salvarFolha() {
    if (!folhaPreview || folhaSalvando) return;
    if (!folhaPreview.competencia) { notify('Não achei a competência (mês/ano) neste PDF — me avise que eu ajusto o leitor.'); return; }
    const jaExiste = folhas.find(f => f.competencia === folhaPreview.competencia && f.origem === folhaPreview.origem);
    if (jaExiste && !confirm(`Já existe uma folha deste tipo na competência ${folhaPreview.competencia}. Salvar de novo cria uma duplicada — prefira excluir a antiga antes. Salvar mesmo assim?`)) return;
    setFolhaSalvando(true);
    try {
      // 1) cria/atualiza os funcionários (chave: empresa + código do empregado)
      const rowsFunc = folhaPreview.itens.map(i => {
        const r = { empresa_id: currentEmpresaId, codigo: i.codigo, nome: i.nome };
        if (i.cpf) r.cpf = i.cpf;
        if (i.identidade) r.identidade = i.identidade;
        if (i.cargo) r.cargo = i.cargo;
        return r;
      });
      const { data: funcs, error: e1 } = await supabase.from('funcionarios')
        .upsert(rowsFunc, { onConflict: 'empresa_id,codigo' }).select();
      if (e1) { notify('Erro ao salvar funcionários: ' + e1.message); return; }
      const idPorCodigo = new Map((funcs || []).map(f => [f.codigo, f.id]));

      // 2) cabeçalho da folha
      const { data: folha, error: e2 } = await supabase.from('folhas').insert({
        empresa_id: currentEmpresaId,
        competencia: folhaPreview.competencia,
        tipo_calculo: folhaPreview.tipoCalculo,
        origem: folhaPreview.origem,
        total_liquido: folhaPreview.totalLiquido,
        qtd_funcionarios: folhaPreview.qtdFuncionarios,
        arquivo_nome: folhaPreview.arquivoNome,
        criado_por: userEmail,
      }).select().single();
      if (e2) { notify('Erro ao salvar a folha: ' + e2.message); return; }

      // 3) valores de cada funcionário
      const itens = folhaPreview.itens.map(i => ({
        folha_id: folha.id, empresa_id: currentEmpresaId,
        funcionario_id: idPorCodigo.get(i.codigo) || null,
        codigo_funcionario: i.codigo, nome: i.nome,
        valor_liquido: i.valorLiquido, data_pagamento: i.dataPagamento || null,
        proventos: i.proventos ?? null, descontos: i.descontos ?? null,
        observacao: i.observacao || null,
      }));
      const { error: e3 } = await supabase.from('folha_itens').insert(itens);
      if (e3) {
        await supabase.from('folhas').delete().eq('id', folha.id); // desfaz o cabeçalho pra não ficar órfão
        notify('Erro ao salvar os valores: ' + e3.message);
        return;
      }
      setFolhaPreview(null);
      if (folhaFileRef.current) folhaFileRef.current.value = '';
      setFileNameFolha('');
      await Promise.all([loadFuncionarios(currentEmpresaId), loadFolhas(currentEmpresaId), loadDadosFolha(currentEmpresaId)]);
      notify(`Folha ${folha.competencia} salva — ${itens.length} funcionário(s).`, 'success');
    } finally {
      setFolhaSalvando(false);
    }
  }
  async function excluirFolha(f) {
    if (!confirm(`Excluir a folha ${f.competencia} (${f.qtd_funcionarios} funcionário(s))? Só os valores importados saem do site — o PDF original continua com você.`)) return;
    const { error } = await supabase.from('folhas').delete().eq('id', f.id);
    if (error) { notify('Erro ao excluir: ' + error.message); return; }
    loadFolhas(currentEmpresaId);
    loadDadosFolha(currentEmpresaId);
  }

  // Carrega tudo que o cruzamento extrato × folha precisa (fica num ref
  // pra não re-renderizar a tela — é usado dentro do processarExtrato)
  async function loadDadosFolha(empresaId) {
    try {
      const [ri, rf, rl, rc] = await Promise.all([
        supabase.from('folha_itens').select('folha_id,codigo_funcionario,nome,valor_liquido,data_pagamento,observacao').eq('empresa_id', empresaId).limit(9000),
        supabase.from('funcionarios').select('id,codigo,nome,cargo').eq('empresa_id', empresaId).limit(2000),
        supabase.from('folhas').select('id,competencia,tipo_calculo,origem,total_liquido,qtd_funcionarios').eq('empresa_id', empresaId).limit(500),
        supabase.from('folha_config').select('*').eq('empresa_id', empresaId).maybeSingle(),
      ]);
      const folhaPorId = new Map((rl.data || []).map(f => [f.id, f]));
      dadosFolhaRef.current = {
        itens: (ri.data || []).map(i => ({
          ...i,
          competencia: folhaPorId.get(i.folha_id)?.competencia,
          tipo_calculo: folhaPorId.get(i.folha_id)?.tipo_calculo,
        })),
        funcionarios: rf.data || [],
        totais: rl.data || [],
        config: rc.data || null,
      };
      const cfg = rc.data;
      setFolhaCfgDraft({
        salario: cfg?.conta_salario ? `${cfg.conta_salario} — ${findContaDesc(cfg.conta_salario)}` : '',
        ferias: cfg?.conta_ferias ? `${cfg.conta_ferias} — ${findContaDesc(cfg.conta_ferias)}` : '',
        rescisao: cfg?.conta_rescisao ? `${cfg.conta_rescisao} — ${findContaDesc(cfg.conta_rescisao)}` : '',
        decimo: cfg?.conta_decimo ? `${cfg.conta_decimo} — ${findContaDesc(cfg.conta_decimo)}` : '',
      });
    } catch (e) {
      console.error(e); // tabelas da folha ainda não criadas no banco — segue sem o cruzamento
    }
  }

  async function salvarFolhaConfig() {
    const campos = [
      ['conta_salario', 'salario', 'salário'],
      ['conta_ferias', 'ferias', 'férias'],
      ['conta_rescisao', 'rescisao', 'rescisão'],
      ['conta_decimo', 'decimo', '13º'],
    ];
    const payload = { empresa_id: currentEmpresaId };
    for (const [coluna, chave, rotulo] of campos) {
      const textoCampo = (folhaCfgDraft[chave] || '').trim();
      const codigo = extractCodigoFromPicked(textoCampo);
      if (textoCampo && !codigo) { notify(`Conta de ${rotulo} inválida — escolha uma conta da lista.`); return; }
      if (codigo && isContaSintetica(codigo)) { notify(`A conta de ${rotulo} é Sintética (de totalização) — escolha uma conta Analítica.`); return; }
      payload[coluna] = codigo ? parseInt(codigo, 10) : null;
    }
    if (!payload.conta_salario) { notify('Informe pelo menos a conta de salário — as outras usam ela quando vazias.'); return; }
    const { error } = await supabase.from('folha_config').upsert(payload, { onConflict: 'empresa_id' });
    if (error) { notify('Erro ao salvar as contas: ' + error.message); return; }
    await loadDadosFolha(currentEmpresaId);
    flash('salvo ✓');
    notify('Contas da folha salvas — os próximos processamentos de extrato já classificam sozinhos.', 'success');
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
      // Duas transações REAIS podem ter a mesma data+valor+histórico (ex.: dois Pix
      // iguais no mesmo dia). Pra nenhuma se perder na chave única do banco, as
      // repetições ganham um sufixo |2, |3... — estável entre reprocessamentos do
      // mesmo arquivo, então a detecção de duplicidade continua funcionando.
      const contagemFp = new Map();
      const withFingerprint = classificado.map(r => {
        let fp = fingerprintOf(r.data, r.valor, r.historico);
        const n = (contagemFp.get(fp) || 0) + 1;
        contagemFp.set(fp, n);
        if (n > 1) fp = `${fp}|${n}`;
        return { ...r, fingerprint: fp };
      });

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

      // Cruza com a FOLHA DE PAGAMENTO: pagamento individual (nome + líquido),
      // lote SISPAG (total da folha) ou só o nome (vira contexto pra IA).
      // Só classifica sozinho se a conta do de-para estiver configurada e for Analítica.
      const cfgFolha = dadosFolhaRef.current.config;
      const comFolha = comRelatorio.map(r => {
        if (r.status !== 'sem match') return r;
        const refFolha = cruzarComFolha(r, dadosFolhaRef.current);
        if (!refFolha) return r;
        if (refFolha.tipo === 'funcionario' || refFolha.tipo === 'total') {
          const conta = contaParaEvento(cfgFolha, refFolha.evento);
          if (conta && !isContaSintetica(conta)) {
            return { ...r, refFolha, contaDevedora: String(conta), status: 'automatico', origem: 'folha' };
          }
        }
        return { ...r, refFolha };
      });

      const comSugestao = comFolha.map(r => {
        if (r.status !== 'sem match') return r;
        const sugestao = sugerirConta(r, baseAprendizadoRef.current, contaBancaria);
        return sugestao ? { ...r, sugestao } : r;
      });

      // reaplica as contas que o usuário escolheu manualmente antes do reprocessamento
      const comManuais = comSugestao.map(r => {
        if (r.status === 'duplicado') return r;
        const manual = manualOverridesRef.current.get(r.fingerprint);
        if (!manual) return r;
        return { ...r, contaDevedora: manual.contaDevedora, contaCredora: manual.contaCredora, status: 'automatico', origem: 'manual' };
      });
      setProcessedRows(comManuais);
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
    if (confirmando) return; // já tem um salvamento em andamento — ignora o clique repetido
    if (processedRows.length === 0) return;
    const naoDuplicados = processedRows.filter(r => r.status !== 'duplicado');
    if (naoDuplicados.length === 0) { notify('Todos os lançamentos já foram importados antes — nada novo para salvar.'); return; }

    setConfirmando(true);
    try {
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

      // Tira duplicados DENTRO do próprio lote: a chave única do banco é
      // (empresa_id, fingerprint) e o fingerprint é data+valor+histórico. Duas linhas
      // do mesmo extrato com esses três campos iguais colidiam e derrubavam a
      // gravação inteira (erro 409). Com o sufixo |2, |3... que o processamento
      // agora acrescenta às repetições, isso não deve mais acontecer — este Set
      // é só uma rede de segurança extra.
      const vistosNoLote = new Set();
      const linhas = [];
      for (const r of naoDuplicados) {
        if (vistosNoLote.has(r.fingerprint)) continue;
        vistosNoLote.add(r.fingerprint);
        linhas.push({
          empresa_id: currentEmpresaId, extrato_id: extrato.id, fingerprint: r.fingerprint,
          data: r.data, valor: r.valor, historico: r.historico, detalhamento: r.detalhamento, cd: r.cd,
          conta_credora: r.contaCredora || null, conta_devedora: r.contaDevedora || null, status: r.status,
        });
      }
      const chunkSize = 300;
      for (let i = 0; i < linhas.length; i += chunkSize) {
        // upsert com ignoreDuplicates: se um fingerprint já existir no banco (ex.: extrato
        // reenviado), ele é ignorado em vez de estourar a chave única e derrubar tudo.
        const { error } = await supabase.from('lancamentos_importados')
          .upsert(linhas.slice(i, i + chunkSize), { onConflict: 'empresa_id,fingerprint', ignoreDuplicates: true });
        if (error) { notify('Erro ao salvar lançamentos: ' + error.message); return; }
      }
      setConfirmado(true);
      loadHistorico(currentEmpresaId);
      loadBaseAprendizado(currentEmpresaId); // atualiza a base de aprendizado com os lançamentos recém-confirmados
      notify('Importação confirmada e salva no histórico!', 'success');
    } finally {
      setConfirmando(false);
    }
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
            // contexto vindo do relatório financeiro e/ou da folha de pagamento da empresa
            contexto: [
              r.refRelatorio
                ? `${r.refRelatorio.item.categoria ? '[' + r.refRelatorio.item.categoria + '] ' : ''}${r.refRelatorio.item.descricao}`
                : null,
              r.refFolha ? `FOLHA DE PAGAMENTO: ${descreverRefFolha(r.refFolha)}` : null,
            ].filter(Boolean).join(' | ') || undefined,
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
          if (novo.fingerprint) {
            manualOverridesRef.current.set(novo.fingerprint, {
              contaDevedora: novo.contaDevedora, contaCredora: novo.contaCredora,
            });
          }
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

  function exportarImportacao(onlyMatched, formato = 'txt') {
    const linhas = processedRows.filter(r => {
      if (r.status === 'duplicado') return false;
      if (onlyMatched && r.status !== 'automatico') return false;
      return true;
    });
    const nomeBase = (onlyMatched ? 'importacao_classificados_' : 'importacao_') + currentEmpresaId;
    if (formato === 'txt') {
      // .txt pro Domínio: sem cabeçalho, sem aspas, sem coluna de status, separado por ";" e em ANSI
      const txt = linhas.map(r => {
        const historicoFull = (r.detalhamento ? `${r.historico} - ${r.detalhamento}` : r.historico).replace(/;/g, ',');
        return `${r.data};${r.contaDevedora};${r.contaCredora};${r.valor};${historicoFull}`;
      }).join('\r\n') + '\r\n';
      downloadFileAnsi(txt, nomeBase + '.txt');
    } else {
      let csv = 'DATA;CONTA DEVEDORA;CONTA CREDORA;VALOR;HISTORICO;STATUS\n';
      linhas.forEach(r => {
        const historicoFull = r.detalhamento ? `${r.historico} - ${r.detalhamento}` : r.historico;
        csv += `${r.data};${r.contaDevedora};${r.contaCredora};${r.valor};"${historicoFull.replace(/"/g, "'")}";${r.origem === 'manual' ? 'manual' : r.status}\n`;
      });
      downloadFile(csv, nomeBase + '.csv');
    }
  }

  if (checkingAuth) return <div className="center-loading">verificando sessão…</div>;

  const empresaAtiva = empresas.find(e => e.id === currentEmpresaId);
  const pendenciasExtrato = processedRows.filter(r => r.status === 'sem match').length;

  // descrição exibida no cabeçalho de cada página/aba
  const TAB_DESC = {
    inicio: empresaAtiva ? <>Visão geral do escritório — trabalhando em <strong>{empresaAtiva.nome}</strong>.</> : 'Visão geral do escritório.',
    empresas: 'Gerencie as empresas atendidas pelo escritório.',
    extrato: <>Importe o extrato bancário e deixe as regras e a IA classificarem os lançamentos de <strong>{empresaAtiva?.nome || '—'}</strong>.</>,
    relatorios: <>Envie os relatórios de pagamentos e recebimentos de <strong>{empresaAtiva?.nome || '—'}</strong> — eles são cruzados com o extrato por data e valor.</>,
    folha: <>Envie o PDF da folha de pagamento de <strong>{empresaAtiva?.nome || '—'}</strong> para reconhecer salários, férias e rescisões no extrato.</>,
    regras: <>Regras de classificação aplicadas automaticamente aos lançamentos de <strong>{empresaAtiva?.nome || '—'}</strong>.</>,
    contas: <>Plano de contas de <strong>{empresaAtiva?.nome || '—'}</strong> — contas sintéticas totalizam, analíticas recebem lançamento.</>,
    importacao: 'Gere o arquivo de importação com os lançamentos classificados, no layout do Domínio.',
    historico: <>Processamentos e importações já confirmados de <strong>{empresaAtiva?.nome || '—'}</strong>.</>,
    usuarios: 'Controle de acesso da equipe do escritório.',
    assinantes: 'Gestão dos escritórios assinantes do sistema.',
  };
  const contasFiltradas = planoContas.filter(c => {
    const f = contasSearch.toLowerCase();
    const passaBusca = !f || String(c.codigo).includes(f) || (c.descricao || '').toLowerCase().includes(f);
    const passaGrupo = !grupoFiltro || grupoOf(c.classificacao) === grupoFiltro;
    return passaBusca && passaGrupo;
  }).slice(0, 500);

  return (
    <div className="shell">
      {pickerOnSelect && (
        <ContaPickerModal
          contas={planoContas}
          onSelect={(conta) => pickerOnSelect(conta)}
          onClose={() => setPickerOnSelect(null)}
        />
      )}
      {inputModal && (
        <InputModal
          {...inputModal}
          onConfirm={(valor) => { setInputModal(null); inputModal.onConfirm(valor); }}
          onClose={() => setInputModal(null)}
        />
      )}
      {assModal && (
        <div className="modal-overlay" onClick={() => !assModalSalvando && setAssModal(null)}>
          <div className="modal-panel" onClick={e => e.stopPropagation()}>
            {assModal.tipo === 'limite' && (
              <>
                <h3>Limite de empresas</h3>
                <p className="hint">Plano de "<strong>{assModal.esc.nome}</strong>" — hoje: {assModal.esc.limite_empresas}, em uso: {assModal.esc.qtde_empresas}.</p>
                <div className="field-label">Novo limite</div>
                <input type="number" min="1" style={{ width: '100%' }} value={assModal.valor} autoFocus
                  onChange={e => setAssModal(m => ({ ...m, valor: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') confirmarLimiteAssinante(); }} />
                <div className="modal-actions">
                  <button className="btn secondary" onClick={() => setAssModal(null)} disabled={assModalSalvando}>Cancelar</button>
                  <button className="btn teal" onClick={confirmarLimiteAssinante} disabled={assModalSalvando}>
                    {assModalSalvando ? (<><span className="spinner" /> Salvando…</>) : 'Salvar'}
                  </button>
                </div>
              </>
            )}

            {assModal.tipo === 'suspender' && (
              <>
                <h3>{assModal.esc.ativo ? 'Suspender assinatura' : 'Reativar assinatura'}</h3>
                <p className="hint">
                  {assModal.esc.ativo
                    ? <>Suspender o escritório <strong>"{assModal.esc.nome}"</strong>? Todos os usuários dele perdem o acesso na hora (é reversível).</>
                    : <>Reativar o escritório <strong>"{assModal.esc.nome}"</strong>? O acesso volta na hora para todos os usuários dele.</>}
                </p>
                <div className="modal-actions">
                  <button className="btn secondary" onClick={() => setAssModal(null)} disabled={assModalSalvando}>Cancelar</button>
                  <button className={assModal.esc.ativo ? 'btn danger' : 'btn teal'} onClick={confirmarAlternarAtivo} disabled={assModalSalvando}>
                    {assModalSalvando ? (<><span className="spinner" /> Aguarde…</>) : (assModal.esc.ativo ? 'Suspender' : 'Reativar')}
                  </button>
                </div>
              </>
            )}

            {assModal.tipo === 'cobranca' && (
              <>
                <h3>Gerar cobrança</h3>
                <p className="hint">Escolha o plano para "<strong>{assModal.esc.nome}</strong>". O link gera uma assinatura recorrente no Mercado Pago.</p>
                <div className="plano-opcoes">
                  {PLANOS.map(p => (
                    <div key={p.id} className={'plano-opcao' + (assModal.planoId === p.id ? ' selected' : '')}
                      onClick={() => setAssModal(m => ({ ...m, planoId: p.id }))}>
                      <div>
                        <div className="nome">{p.nome}</div>
                        <div className="preco">até {p.limite_empresas} empresas</div>
                      </div>
                      <div className="preco">{formatarPreco(p.preco_mensal)}/mês</div>
                    </div>
                  ))}
                </div>
                <div className="field-label">E-mail de cobrança (conta Mercado Pago do assinante)</div>
                <input type="email" style={{ width: '100%' }} placeholder="financeiro@escritorio.com.br"
                  value={assModal.email} onChange={e => setAssModal(m => ({ ...m, email: e.target.value }))} />
                <div className="modal-actions">
                  <button className="btn secondary" onClick={() => setAssModal(null)} disabled={assModalSalvando}>Cancelar</button>
                  <button className="btn teal" onClick={confirmarGerarLinkCobranca} disabled={assModalSalvando || !assModal.email}>
                    {assModalSalvando ? (<><span className="spinner" /> Gerando…</>) : 'Gerar link'}
                  </button>
                </div>
              </>
            )}

            {assModal.tipo === 'link' && (
              <>
                <h3>Link de pagamento pronto</h3>
                <p className="hint">Já copiamos pra sua área de transferência — cole no WhatsApp do assinante. Se precisar, copie de novo abaixo.</p>
                <div className="link-copia">
                  <input type="text" readOnly value={assModal.checkoutUrl} onFocus={e => e.target.select()} />
                  <button className="btn secondary" onClick={() => {
                    navigator.clipboard?.writeText(assModal.checkoutUrl)
                      .then(() => notify('Link copiado!', 'success'))
                      .catch(() => notify('Não deu pra copiar automaticamente — selecione o texto e copie manualmente.'));
                  }}>Copiar</button>
                </div>
                <div className="modal-actions">
                  <button className="btn teal" onClick={() => setAssModal(null)}>Concluir</button>
                </div>
              </>
            )}

            {assModal.tipo === 'excluir' && (
              <>
                <h3 style={{ color: 'var(--danger)' }}>Excluir assinante</h3>
                <p className="hint">
                  Isto apaga <strong>para sempre</strong> o escritório <strong>"{assModal.esc.nome}"</strong> e tudo dele:
                  {' '}{assModal.esc.qtde_empresas} empresa(s), {assModal.esc.qtde_usuarios} usuário(s), planos de contas, regras, extratos e histórico. Não dá pra desfazer.
                </p>
                <p className="hint">Se é só uma pausa, prefira <strong>suspender</strong>. Para confirmar, digite o nome do escritório abaixo:</p>
                <input type="text" style={{ width: '100%' }} placeholder={assModal.esc.nome} value={assModal.confirmNome} autoFocus
                  onChange={e => setAssModal(m => ({ ...m, confirmNome: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') confirmarExcluirAssinante(); }} />
                <div className="modal-actions">
                  <button className="btn secondary" onClick={() => setAssModal(null)} disabled={assModalSalvando}>Cancelar</button>
                  <button className="btn danger" onClick={() => confirmarExcluirAssinante()}
                    disabled={assModalSalvando || (assModal.confirmNome || '').trim().toLowerCase() !== assModal.esc.nome.trim().toLowerCase()}>
                    {assModalSalvando ? (<><span className="spinner" /> Excluindo…</>) : 'Excluir para sempre'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={'toast toast-' + t.type}>{t.message}</div>
        ))}
      </div>

      <datalist id="contas-datalist">
        {planoContas.map(c => <option key={c.id} value={`${c.codigo} — ${c.descricao}${c.tipo === 'S' ? ' [SINTÉTICA]' : ''}`} />)}
      </datalist>

      {/* ===== MENU LATERAL (sidebar) ===== */}
      <aside className={'sidebar' + (menuRecolhido ? ' collapsed' : '') + (menuMobileAberto ? ' mobile-open' : '')}>
        <div className="sb-head">
          <div className="sb-logo-mini">A</div>
          <div className="sb-title">
            <div className="name">AutoContax</div>
            <div className="desc">Automação contábil</div>
          </div>
        </div>
        <nav className="sb-nav">
          {MENU_SECOES.map(sec => {
            const visiveis = sec.tabs.filter(t => (t === 'usuarios' ? isAdmin : t === 'assinantes' ? souSuper : true));
            if (visiveis.length === 0) return null;
            return (
              <div key={sec.titulo}>
                <div className="sb-section">{sec.titulo}</div>
                {visiveis.map(t => {
                  const { label, Icon } = TAB_META[t];
                  return (
                    <button key={t} className={'sb-item' + (tab === t ? ' active' : '')} title={label} onClick={() => trocarTab(t)}>
                      <Icon size={17} />
                      <span className="sb-label">{label}</span>
                      {t === 'empresas' && empresas.length > 0 && <span className="sb-badge">{empresas.length}</span>}
                      {t === 'extrato' && pendenciasExtrato > 0 && <span className="sb-badge warn">{pendenciasExtrato}</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>
        <div className="sb-foot">
          <div className="sb-user">
            <div className="sb-avatar">{(userEmail || '?').slice(0, 2).toUpperCase()}</div>
            <div className="info">
              <div className="email">{userEmail}</div>
              <div className="role">{isAdmin ? 'Administrador' : 'Operador'}</div>
            </div>
            <button className="sb-logout" title="Sair" onClick={() => handleLogout()}><LogOut size={16} /></button>
          </div>
        </div>
      </aside>
      {menuMobileAberto && <div className="sidebar-backdrop" onClick={() => setMenuMobileAberto(false)} />}

      {/* ===== ÁREA PRINCIPAL ===== */}
      <div className="main-area">
      <header className="topbar">
        <button className="hamburger" title={menuRecolhido ? 'Expandir menu' : 'Recolher menu'} onClick={() => alternarMenu()}>
          <Menu size={17} />
        </button>
        <div className="breadcrumb">
          <span className="crumb-root">AutoContax</span>
          <ChevronRight size={13} />
          <span className="crumb-here">{TAB_META[tab]?.label || ''}</span>
        </div>
        <div className="topbar-spacer" />
        <EmpresaPicker empresas={empresas} currentEmpresaId={currentEmpresaId} onSelect={selecionarEmpresa} />
        <div className="user-block">
          <div className="user-info">
            <div className="user-email">{userEmail}</div>
            <div className="user-role">{isAdmin ? 'Administrador' : 'Operador'} · <a href="#" onClick={(e) => { e.preventDefault(); handleLogout(); }}>Sair</a></div>
          </div>
          <div className="avatar">{(userEmail || '?').slice(0, 2).toUpperCase()}</div>
        </div>
      </header>

      <div className="app">

      {souSuper && escritorioVisao && (
        <div className="suporte-banner">
          <Eye size={14} style={{ verticalAlign: -2, marginRight: 7 }} />
          Modo suporte: você está vendo o ambiente do assinante <strong>&nbsp;{escritorioVisaoNome || 'selecionado'}</strong>.
          <button className="btn secondary" style={{ marginLeft: 12, padding: '4px 10px', fontSize: 11.5 }}
            onClick={() => { setEscritorioVisao(null); setEscritorioVisaoNome(''); }}>Sair do modo suporte</button>
        </div>
      )}
      <div key={tab} className="fade-in">

      <div className="page-head">
        <div className="ph-text">
          <h1>{tab === 'inicio' ? 'Página Inicial' : TAB_META[tab]?.label}</h1>
          <p>{TAB_DESC[tab]}</p>
        </div>
        {tab === 'empresas' && isAdmin && (
          <button className="btn teal" onClick={() => setMostrarNovaEmpresa(v => !v)}>
            <Plus size={15} style={{ marginRight: 6, verticalAlign: -2 }} />Nova empresa
          </button>
        )}
        {tab === 'regras' && isAdmin && (
          <button className="btn teal" onClick={() => addRegra()}>
            <Plus size={15} style={{ marginRight: 6, verticalAlign: -2 }} />Nova regra
          </button>
        )}
        {tab === 'contas' && isAdmin && (
          <button className="btn teal" onClick={() => addContaManual()}>
            <Plus size={15} style={{ marginRight: 6, verticalAlign: -2 }} />Nova conta
          </button>
        )}
      </div>

      {tab === 'inicio' && (() => {
        const totalLanc = processedRows.length;
        const classif = processedRows.filter(r => r.status === 'automatico').length;
        const manuais = processedRows.filter(r => r.status === 'automatico' && r.origem === 'manual').length;
        const duplicados = processedRows.filter(r => r.status === 'duplicado').length;
        const pct = (n) => totalLanc ? Math.max(4, Math.round((n / totalLanc) * 100)) : 0;
        const grupos = {};
        planoContas.forEach(c => { const g = grupoOf(c.classificacao); if (g !== '—') grupos[g] = (grupos[g] || 0) + 1; });
        const gruposArr = Object.entries(grupos);
        const maxGrupo = Math.max(1, ...gruposArr.map(([, n]) => n));
        return (
          <>
            <div className="dash-grid">
              <button className="kpi-card" onClick={() => trocarTab('empresas')}>
                <div className="kpi-top"><div className="kpi-ico"><Building2 size={19} /></div></div>
                <div className="kpi-value">{empresas.length}</div>
                <div className="kpi-label">Empresas</div>
                <div className="kpi-sub">cadastradas no escritório</div>
              </button>
              <button className="kpi-card" onClick={() => trocarTab('extrato')}>
                <div className="kpi-top"><div className="kpi-ico violet"><FileText size={19} /></div></div>
                <div className="kpi-value">{totalLanc}</div>
                <div className="kpi-label">Lançamentos</div>
                <div className="kpi-sub">na sessão atual</div>
              </button>
              <button className="kpi-card" onClick={() => trocarTab('extrato')}>
                <div className="kpi-top"><div className="kpi-ico green"><Check size={19} /></div></div>
                <div className="kpi-value">{classif}</div>
                <div className="kpi-label">Classificados</div>
                <div className="kpi-sub">pelas regras, pela IA e por você</div>
              </button>
              <button className="kpi-card" onClick={() => trocarTab('extrato')}>
                <div className="kpi-top"><div className="kpi-ico amber"><AlertTriangle size={19} /></div></div>
                <div className="kpi-value">{pendenciasExtrato}</div>
                <div className="kpi-label">Pendências</div>
                <div className="kpi-sub">sem correspondência</div>
              </button>
              <button className="kpi-card" onClick={() => trocarTab('regras')}>
                <div className="kpi-top"><div className="kpi-ico"><Settings size={19} /></div></div>
                <div className="kpi-value">{regras.length}</div>
                <div className="kpi-label">Regras</div>
                <div className="kpi-sub">da empresa selecionada</div>
              </button>
              <button className="kpi-card" onClick={() => trocarTab('contas')}>
                <div className="kpi-top"><div className="kpi-ico"><BookOpen size={19} /></div></div>
                <div className="kpi-value">{planoContas.length}</div>
                <div className="kpi-label">Contas no plano</div>
                <div className="kpi-sub">plano de contas da empresa</div>
              </button>
            </div>

            <div className="charts-row">
              <div className="chart-card">
                <h3>Status dos lançamentos</h3>
                <div className="chart-sub">Distribuição do extrato em processamento nesta sessão</div>
                {totalLanc === 0 ? (
                  <div className="empty-state" style={{ padding: '26px 10px' }}>
                    Nenhum extrato em processamento. Comece pela aba <strong>Extrato</strong>.
                  </div>
                ) : (
                  <>
                    <div className="hbar-row"><div className="hbar-label">Classificados</div><div className="hbar-track"><div className="hbar-fill green" style={{ width: pct(classif) + '%' }} /></div><div className="hbar-val">{classif}</div></div>
                    <div className="hbar-row"><div className="hbar-label">Pendências</div><div className="hbar-track"><div className="hbar-fill amber" style={{ width: pct(pendenciasExtrato) + '%' }} /></div><div className="hbar-val">{pendenciasExtrato}</div></div>
                    <div className="hbar-row"><div className="hbar-label">Manuais</div><div className="hbar-track"><div className="hbar-fill" style={{ width: pct(manuais) + '%' }} /></div><div className="hbar-val">{manuais}</div></div>
                    <div className="hbar-row"><div className="hbar-label">Duplicados</div><div className="hbar-track"><div className="hbar-fill red" style={{ width: pct(duplicados) + '%' }} /></div><div className="hbar-val">{duplicados}</div></div>
                  </>
                )}
              </div>
              <div className="chart-card">
                <h3>Plano de contas por grupo</h3>
                <div className="chart-sub">Contas cadastradas em cada grupo contábil{empresaAtiva ? ` — ${empresaAtiva.nome}` : ''}</div>
                {gruposArr.length === 0 ? (
                  <div className="empty-state" style={{ padding: '26px 10px' }}>
                    Nenhum plano de contas importado ainda para esta empresa.
                  </div>
                ) : (
                  gruposArr.map(([g, n]) => (
                    <div className="hbar-row" key={g}>
                      <div className="hbar-label">{g}</div>
                      <div className="hbar-track"><div className="hbar-fill" style={{ width: Math.max(4, Math.round((n / maxGrupo) * 100)) + '%' }} /></div>
                      <div className="hbar-val">{n}</div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="section-label">Ações rápidas</div>
            <div className="quick-grid">
              <button className="quick-card" onClick={() => trocarTab('extrato')}>
                <div className="q-ico"><Upload size={18} /></div>
                <div><div className="q-name">Processar extrato</div><div className="q-desc">Importar e classificar lançamentos</div></div>
              </button>
              <button className="quick-card" onClick={() => trocarTab('relatorios')}>
                <div className="q-ico"><BarChart3 size={18} /></div>
                <div><div className="q-name">Enviar relatório</div><div className="q-desc">Pagamentos e recebimentos da empresa</div></div>
              </button>
              <button className="quick-card" onClick={() => trocarTab('importacao')}>
                <div className="q-ico"><FileText size={18} /></div>
                <div><div className="q-name">Exportar importação</div><div className="q-desc">Gerar arquivo para o Domínio</div></div>
              </button>
              <button className="quick-card" onClick={() => trocarTab('historico')}>
                <div className="q-ico"><History size={18} /></div>
                <div><div className="q-name">Ver histórico</div><div className="q-desc">Processamentos anteriores</div></div>
              </button>
            </div>
          </>
        );
      })()}

      {tab === 'empresas' && (
        <section className="panel">
          <div className={isAdmin ? 'empresas-layout' : ''}>
          <div>
          <p className="hint" style={{ marginBottom: 0 }}>{empresas.length} empresas cadastradas, cada uma com plano de contas e regras próprios.
            {!isAdmin && <> Você está como <strong>operador</strong>: só admin cria/edita empresas.</>}
          </p>

          {isAdmin && mostrarNovaEmpresa && (
            <div className="card destaque" style={{ marginTop: 14 }}>
              <h3 style={{ fontSize: 15 }}>Nova empresa</h3>
              <p className="hint" style={{ marginBottom: 0 }}>Digite o CNPJ e busque: nome e município vêm da Receita Federal. Sem CNPJ, preencha só o nome.</p>
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
                <div className="field-inline"><label>Município</label>
                  <input type="text" style={{ width: 240 }} placeholder="preenchido pela busca" value={novaEmpresa.municipio}
                    onChange={e => setNovaEmpresa(f => ({ ...f, municipio: e.target.value }))} />
                </div>
                <div className="field-inline"><label>UF</label>
                  <input type="text" style={{ width: 60 }} maxLength={2} placeholder="BA" value={novaEmpresa.uf}
                    onChange={e => setNovaEmpresa(f => ({ ...f, uf: e.target.value.toUpperCase() }))} />
                </div>
              </div>
              <div className="row">
                <button className="btn teal" onClick={salvarNovaEmpresa} disabled={salvandoEmpresa || !novaEmpresa.nome.trim()}>
                  {salvandoEmpresa ? (<><span className="spinner" /> Criando…</>) : 'Criar empresa'}
                </button>
                <button className="btn secondary" onClick={() => { setMostrarNovaEmpresa(false); setNovaEmpresa(EMPRESA_VAZIA); }}>Cancelar</button>
              </div>
            </div>
          )}

          <div className="row" style={{ margin: '16px 0 0' }}>
            <div className="search-box">
              <Search size={15} />
              <input type="search" placeholder="Buscar por nome ou CNPJ…"
                value={empresaListSearch} onChange={e => setEmpresaListSearch(e.target.value)} />
            </div>
          </div>

          {(() => {
            const busca = empresaListSearch.trim().toLowerCase();
            const buscaDigitos = busca.replace(/\D/g, '');
            const filtradas = busca ? empresas.filter(emp =>
              emp.nome.toLowerCase().includes(busca) ||
              (buscaDigitos && (emp.cnpj || '').replace(/\D/g, '').includes(buscaDigitos))
            ) : empresas;
            if (filtradas.length === 0) {
              return <div className="empty-state">Nenhuma empresa encontrada.{isAdmin && ' Use o botão "Nova empresa" para cadastrar.'}</div>;
            }
            return (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>EMPRESA</th><th>CNPJ</th><th>MUNICÍPIO</th><th>STATUS</th><th style={{ width: 150 }}></th></tr></thead>
                  <tbody>
                    {filtradas.map(emp => (
                      <tr key={emp.id}>
                        <td><strong>{emp.nome}</strong></td>
                        <td className="mono">{emp.cnpj || '—'}</td>
                        <td>{emp.municipio ? `${emp.municipio}${emp.uf ? '/' + emp.uf : ''}` : '—'}</td>
                        <td>{emp.id === currentEmpresaId ? <span className="badge ok">em uso</span> : <span className="badge off">disponível</span>}</td>
                        <td className="num">
                          <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', alignItems: 'center' }}>
                            {emp.id !== currentEmpresaId && (
                              <button className="btn secondary sm" title="Trabalhar com esta empresa" onClick={() => selecionarEmpresa(emp.id)}>Usar</button>
                            )}
                            {isAdmin && <button className="icon-btn" title="Renomear" onClick={() => renomearEmpresa(emp)}><Pencil size={14} /></button>}
                            {isAdmin && <button className="icon-btn icon-btn-danger" title="Excluir" onClick={() => excluirEmpresa(emp)}><Trash2 size={14} /></button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
              <FilePicker id="file-plano-contas" inputRef={fileInputRef} accept=".xls,.xlsx,.csv,.txt"
                fileName={fileNamePlano} onFileChange={f => setFileNamePlano(f?.name || '')} />
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
          <div className="card">
            <h3>Layout do banco</h3>
            <p className="hint" style={{ marginBottom: 10 }}>Confira a prévia e ajuste as colunas antes de salvar.</p>
            <div className="row" style={{ marginTop: 0 }}>
              <label style={{ fontSize: 12.5 }}>Layout:</label>
              <select value={currentLayoutId || ''} onChange={e => setCurrentLayoutId(e.target.value)}>
                {layouts.map(l => <option key={l.id} value={l.id}>{l.nome}</option>)}
              </select>
              {isAdmin && <button className="btn secondary" onClick={() => novoLayout()}>+ Novo layout</button>}
              {isAdmin && <button className="btn danger" onClick={excluirLayout}>Excluir layout</button>}
            </div>
            {currentLayout && (
              <div className="row">
                <label style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>Conta bancária desta importação:</label>
                <input type="text" list="contas-datalist" placeholder="buscar conta…" style={{ minWidth: 280 }}
                  defaultValue={contaBancaria ? `${contaBancaria} — ${findContaDesc(contaBancaria)}` : ''}
                  key={`${currentEmpresaId}-${currentLayoutId}-${contaBancaria ?? ''}`}
                  onBlur={e => salvarContaBancaria(extractCodigoFromPicked(e.target.value))} />
                <button className="btn secondary" onClick={() => openPicker((conta) => salvarContaBancaria(conta.codigo))}><Search size={13} style={{marginRight:5,verticalAlign:-2}}/>Buscar conta</button>
                <span className={'save-flag' + (saveFlag ? ' show' : '')}>{saveFlag}</span>
              </div>
            )}
            {isAdmin && currentLayout && (
              <div key={currentLayoutId}>
                <div className="field-group">
                  <div className="field-group-label">Posição das colunas</div>
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

          <FilePicker big id="file-extrato" inputRef={extratoFileInputRef} accept=".xls,.xlsx,.csv,.txt,.ofx"
            fileName={fileNameExtrato}
            titulo="Arraste o extrato aqui ou clique para selecionar"
            subtitulo="Arquivo direto do banco — conta corrente, conta garantida e aplicações"
            formatos={['OFX', 'XLS', 'XLSX', 'CSV', 'TXT']}
            onFileChange={f => { setFileNameExtrato(f?.name || ''); if (f) handleExtratoFileUpload(f); }} />
          <p className="hint" style={{ margin: '12px 0 6px' }}>Só tem o extrato em <strong>PDF</strong>? Converta grátis no <a href="https://www.ofxfacil.com.br/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--blue)', fontWeight: 600 }}>OFX Fácil ↗</a> e envie o .ofx aqui — ou cole as linhas do extrato manualmente abaixo, conforme o layout selecionado.</p>
          <textarea value={extratoText} onChange={e => { setExtratoText(e.target.value); ofxModeRef.current = false; setConfirmado(false); existentesCacheRef.current = null; }}
            placeholder={'01/07/2026\t1250,00\tPIX RECEBIDO\tCLIENTE XYZ LTDA'} style={{ minHeight: 90 }} />
          <div className="row">
            <button className="btn teal" onClick={() => processarExtrato()} disabled={processando}>
              {processando ? (<><span className="spinner" /> Processando…</>) : 'Processar extrato'}
            </button>
            <button className="btn secondary" onClick={() => { setExtratoText(''); setProcessedRows([]); setConfirmado(false); ofxModeRef.current = false; existentesCacheRef.current = null; manualOverridesRef.current.clear(); if (extratoFileInputRef.current) extratoFileInputRef.current.value = ''; setFileNameExtrato(''); }}>Limpar</button>
          </div>

          {processedRows.length > 0 && (
            <>
              <div className="card">
                <h3>Criar regra a partir do extrato</h3>
                <p className="hint" style={{ marginBottom: 10 }}>Clique nas palavras do histórico na tabela abaixo para montar a palavra-chave, escolha a conta e salve.</p>
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
                {processedRows.some(r => r.refFolha) && (
                  <div className="stat" style={{ background: '#E9F5EC', color: '#15803D', borderColor: '#C9E8D2' }}>
                    <Banknote size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
                    {processedRows.filter(r => r.refFolha).length} reconhecidos na folha de pagamento
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
                  <button className="btn teal" onClick={() => confirmarImportacao()} disabled={confirmando}>
                    {confirmando ? (<><span className="spinner" /> Salvando…</>) : 'Confirmar importação (salva no histórico)'}
                  </button>
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
                Clique no número da conta (colunas DEV. / CRED.) para trocar a conta de uma linha — a escolha aparece como <span className="badge ok">✎ manual</span>.
              </p>
              <div className="row filtro-status" style={{ marginTop: 0, gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 12.5, color: 'var(--ink-soft)', fontWeight: 600 }}>Filtrar:</span>
                {[
                  ['todos', 'Todos', processedRows.length],
                  ['automatico', 'Automático', processedRows.filter(r => r.status === 'automatico' && r.origem !== 'manual').length],
                  ['manual', 'Manual', processedRows.filter(r => r.status === 'automatico' && r.origem === 'manual').length],
                  ['sem_match', 'Sem match', processedRows.filter(r => r.status === 'sem match').length],
                  ...(processedRows.some(r => r.status === 'duplicado') ? [['duplicado', 'Duplicado', processedRows.filter(r => r.status === 'duplicado').length]] : []),
                ].map(([val, lbl, qtd]) => (
                  <button key={val} type="button"
                    className={'filtro-chip' + (filtroStatus === val ? ' active' : '')}
                    onClick={() => setFiltroStatus(val)}>
                    {lbl} <span className="filtro-chip-num">{qtd}</span>
                  </button>
                ))}
              </div>
              <div className="table-wrap"><table>
                <thead><tr><th>DATA</th><th className="num">VALOR</th><th>HISTÓRICO</th><th>DETALHAMENTO</th><th>C/D</th><th className="num">DEV.</th><th className="num">CRED.</th><th>STATUS</th></tr></thead>
                <tbody>
                  {processedRows.map((r, i) => ({ r, i }))
                    .filter(({ r }) => {
                      if (filtroStatus === 'automatico') return r.status === 'automatico' && r.origem !== 'manual';
                      if (filtroStatus === 'manual') return r.status === 'automatico' && r.origem === 'manual';
                      if (filtroStatus === 'sem_match') return r.status === 'sem match';
                      if (filtroStatus === 'duplicado') return r.status === 'duplicado';
                      return true;
                    })
                    .map(({ r, i }) => (
                    <tr key={i} className={r.status !== 'automatico' ? 'warn-row' : ''}>
                      <td className="mono">{r.data}</td><td className="num">{r.valor}</td>
                      <td>
                        {renderClickableText(r.historico)}
                        {r.refRelatorio && (
                          <div className="ref-relatorio" title={r.refRelatorio.tipo === 'exato'
                            ? 'Data e valor batem com um item do relatório financeiro desta empresa'
                            : r.refRelatorio.tipo === 'grupo'
                              ? 'Este débito/crédito único do banco corresponde à SOMA de vários pagamentos do relatório no mesmo dia (ex: folha via conta-salário, lote de duplicatas)'
                              : `Mesmo valor no relatório, com ${r.refRelatorio.diasDiferenca} dia(s) de diferença na data`}>
                            <FileSpreadsheet size={11} style={{ verticalAlign: -1.5, marginRight: 4 }} />
                            {r.refRelatorio.item.categoria ? <strong>{r.refRelatorio.item.categoria}: </strong> : <strong>relatório: </strong>}
                            {r.refRelatorio.item.descricao.slice(0, 90)}
                            {r.refRelatorio.tipo === 'grupo' && <em> Σ</em>}
                            {r.refRelatorio.tipo === 'aproximado' && <em> (±{r.refRelatorio.diasDiferenca}d)</em>}
                            {r.refRelatorio.outros > 0 && <em> (+{r.refRelatorio.outros} itens iguais)</em>}
                          </div>
                        )}
                        {r.refFolha && (
                          <div className="ref-relatorio" style={{ color: '#15803D' }} title={
                            r.refFolha.tipo === 'funcionario' ? 'Nome e valor líquido batem com a folha de pagamento importada — classificado automaticamente se as contas da folha estiverem configuradas'
                            : r.refFolha.tipo === 'total' ? 'Valor igual ao total líquido da folha (pagamento em lote / SISPAG)'
                            : r.refFolha.tipo === 'total_suspeito' ? 'Valor igual ao total da folha, mas o histórico não menciona folha/salário — confira antes de aceitar'
                            : 'Nome de funcionário reconhecido, mas o valor não bate com nenhum líquido da folha (adiantamento? pagamento parcial?)'}>
                            <Banknote size={11} style={{ verticalAlign: -1.5, marginRight: 4 }} />
                            <strong>folha: </strong>{descreverRefFolha(r.refFolha).slice(0, 90)}
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
          <p className="hint">
            Envie os relatórios que a empresa manda (contas pagas, recebimentos, folha etc.). O site cruza cada lançamento
            do extrato com esses relatórios <strong>por data + valor</strong> e mostra do que se trata o pagamento/recebimento —
            e a IA usa essa informação pra sugerir a conta contábil certa. Também serve como consulta rápida.
          </p>

          {relatorios.length > 0 && (() => {
            const pag = relatorios.filter(r => r.tipo === 'pagamentos');
            const rec = relatorios.filter(r => r.tipo === 'recebimentos');
            const itens = relatorios.reduce((s, r) => s + (r.total_itens || 0), 0);
            return (
              <div className="dash-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', marginBottom: 16 }}>
                <div className="kpi-card" style={{ cursor: 'default' }}>
                  <div className="kpi-top"><div className="kpi-ico red"><ArrowDown size={19} /></div></div>
                  <div className="kpi-value sm">{pag.length}</div>
                  <div className="kpi-label">Relatórios de pagamentos</div>
                  <div className="kpi-sub">saídas enviadas para o cruzamento</div>
                </div>
                <div className="kpi-card" style={{ cursor: 'default' }}>
                  <div className="kpi-top"><div className="kpi-ico green"><ArrowUp size={19} /></div></div>
                  <div className="kpi-value sm">{rec.length}</div>
                  <div className="kpi-label">Relatórios de recebimentos</div>
                  <div className="kpi-sub">entradas enviadas para o cruzamento</div>
                </div>
                <div className="kpi-card" style={{ cursor: 'default' }}>
                  <div className="kpi-top"><div className="kpi-ico"><FileSpreadsheet size={19} /></div></div>
                  <div className="kpi-value sm">{itens}</div>
                  <div className="kpi-label">Itens no total</div>
                  <div className="kpi-sub">linhas disponíveis para consulta</div>
                </div>
              </div>
            );
          })()}

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
                <FilePicker id="file-relatorio" inputRef={relFileInputRef} accept=".xls,.xlsx,.csv,.txt"
                  fileName={relNomeArquivo}
                  onFileChange={f => { if (f) handleRelatorioFile(f); }} />
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
                  <button className="btn secondary" onClick={() => { setRelRows(null); setRelMapa(null); setRelColunas([]); setRelNomeArquivo(''); if (relFileInputRef.current) relFileInputRef.current.value = ''; }}>Cancelar</button>
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
            <div className="empty-state">
              <FolderOpen size={34} strokeWidth={1.5} />
              Nenhum relatório enviado ainda para esta empresa.<br />
              <span style={{ fontSize: 12 }}>Envie o primeiro no cartão "Enviar novo relatório" aqui em cima — o cruzamento com o extrato começa a funcionar na hora.</span>
            </div>
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

      {tab === 'folha' && (
        <section className="panel">
          <p className="hint">Envie o PDF gerado pelo sistema de folha: o <strong>Relatório de Líquidos</strong> (nome e valor líquido de cada funcionário) ou o <strong>Extrato Mensal</strong> (completo, com proventos, descontos e férias). O site reconhece os funcionários e guarda os valores — é o que permite identificar no extrato bancário os pagamentos de salário, férias e rescisão, tanto Pix individual quanto pagamento em lote (SISPAG).</p>

          {folhas.length > 0 && (
            <div className="dash-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', marginBottom: 16 }}>
              <div className="kpi-card" style={{ cursor: 'default' }}>
                <div className="kpi-top"><div className="kpi-ico green"><Banknote size={19} /></div></div>
                <div className="kpi-value sm">R$ {Number(folhas[0].total_liquido || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
                <div className="kpi-label">Líquido da última folha</div>
                <div className="kpi-sub">competência {folhas[0].competencia}</div>
              </div>
              <div className="kpi-card" style={{ cursor: 'default' }}>
                <div className="kpi-top"><div className="kpi-ico"><Users size={19} /></div></div>
                <div className="kpi-value sm">{funcionarios.length}</div>
                <div className="kpi-label">Funcionários</div>
                <div className="kpi-sub">reconhecidos nos PDFs enviados</div>
              </div>
              <div className="kpi-card" style={{ cursor: 'default' }}>
                <div className="kpi-top"><div className="kpi-ico violet"><FileText size={19} /></div></div>
                <div className="kpi-value sm">{folhas.length}</div>
                <div className="kpi-label">Folhas salvas</div>
                <div className="kpi-sub">competências importadas</div>
              </div>
            </div>
          )}

          <div className="card">
            <h3>Enviar folha (PDF)</h3>
            <div className="row" style={{ marginTop: 8 }}>
              <FilePicker id="file-folha" inputRef={folhaFileRef} accept=".pdf" fileName={fileNameFolha}
                onFileChange={f => { setFileNameFolha(f?.name || ''); setFolhaPreview(null); }} />
              <button className="btn teal" onClick={() => lerPdfFolha()} disabled={folhaLendo || !fileNameFolha}>
                {folhaLendo ? (<><span className="spinner" /> Lendo PDF…</>) : 'Ler PDF'}
              </button>
            </div>
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <h3>Contas contábeis dos pagamentos</h3>
            <p className="hint" style={{ marginBottom: 10 }}>Quando o site reconhece no extrato um pagamento da folha (nome + valor líquido, ou o total do lote SISPAG), ele lança nestas contas automaticamente. Sem elas, o pagamento só ganha o selo verde de identificação. Férias, rescisão e 13º em branco usam a conta de salário.</p>
            {(() => {
              const CAMPOS_CFG = [['salario', 'Salário'], ['ferias', 'Férias'], ['rescisao', 'Rescisão'], ['decimo', '13º salário']];
              return (
                <>
                  <div className="row" style={{ marginTop: 0, flexWrap: 'wrap' }}>
                    {CAMPOS_CFG.map(([chave, rotulo]) => (
                      <div className="field-inline" key={chave}>
                        <label>{rotulo}</label>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <input type="text" list="contas-datalist" style={{ minWidth: 210 }} placeholder={chave === 'salario' ? 'ex: Salários a Pagar' : 'vazio = usa a de salário'}
                            value={folhaCfgDraft[chave]} readOnly={!isAdmin}
                            onChange={e => setFolhaCfgDraft(d => ({ ...d, [chave]: e.target.value }))} />
                          {isAdmin && <button className="icon-btn" style={{ width: 26, height: 26 }} title="Buscar conta"
                            onClick={() => openPicker((conta) => setFolhaCfgDraft(d => ({ ...d, [chave]: `${conta.codigo} — ${conta.descricao}` })))}><Search size={13} /></button>}
                        </div>
                      </div>
                    ))}
                  </div>
                  {isAdmin && (
                    <div className="row" style={{ marginTop: 10 }}>
                      <button className="btn teal" onClick={() => salvarFolhaConfig()}>Salvar contas</button>
                      <span className={'save-flag' + (saveFlag ? ' show' : '')}>{saveFlag}</span>
                    </div>
                  )}
                </>
              );
            })()}
          </div>

          {folhaPreview && (
            <div className="card" style={{ marginTop: 14 }}>
              <h3>Conferência — {folhaPreview.origem === 'liquidos' ? 'Relatório de Líquidos' : 'Extrato Mensal'} · competência {folhaPreview.competencia || '?'}</h3>
              <p className="hint">
                {folhaPreview.empresaNome ? <>{folhaPreview.empresaNome} — </> : null}
                {folhaPreview.qtdFuncionarios} funcionário(s), total líquido <strong>R$ {(folhaPreview.totalLiquido || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong>.
                {folhaPreview.tipoCalculo ? <> Cálculo: {folhaPreview.tipoCalculo}.</> : null} Confira e salve.
              </p>
              {(folhaPreview.avisos || []).map((a, i) => <div key={i} className="login-error" style={{ marginBottom: 8 }}>{a}</div>)}
              <div className="table-wrap"><table>
                <thead><tr>
                  <th className="num">CÓD.</th><th>NOME</th><th>CPF</th><th>CARGO</th>
                  <th className="num">PROVENTOS</th><th className="num">DESCONTOS</th><th className="num">LÍQUIDO</th>
                  <th>DATA PGTO</th><th>OBS.</th>
                </tr></thead>
                <tbody>
                  {folhaPreview.itens.map((i, k) => (
                    <tr key={k}>
                      <td className="num mono">{i.codigo}</td>
                      <td>{i.nome}</td>
                      <td className="mono">{i.cpf || '—'}</td>
                      <td>{i.cargo || '—'}</td>
                      <td className="num">{i.proventos != null ? i.proventos.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '—'}</td>
                      <td className="num">{i.descontos != null ? i.descontos.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '—'}</td>
                      <td className="num"><strong>{(i.valorLiquido || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong></td>
                      <td className="mono">{i.dataPagamento ? fmtISOparaBR(i.dataPagamento) : '—'}</td>
                      <td>{i.observacao || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
              <div className="row">
                <button className="btn teal" onClick={() => salvarFolha()} disabled={folhaSalvando}>
                  {folhaSalvando ? (<><span className="spinner" /> Salvando…</>) : 'Salvar folha'}
                </button>
                <button className="btn secondary" onClick={() => setFolhaPreview(null)} disabled={folhaSalvando}>Descartar</button>
              </div>
            </div>
          )}

          <div className="card" style={{ marginTop: 14 }}>
            <h3>Folhas salvas</h3>
            {folhas.length === 0 ? <div className="empty-state">Nenhuma folha importada ainda.</div> : (
              <div className="table-wrap"><table>
                <thead><tr><th>COMPETÊNCIA</th><th>TIPO</th><th>ORIGEM</th><th className="num">FUNC.</th><th className="num">TOTAL LÍQUIDO</th><th>ENVIADA EM</th><th></th></tr></thead>
                <tbody>
                  {folhas.map(f => (
                    <tr key={f.id}>
                      <td className="mono">{f.competencia}</td>
                      <td>{f.tipo_calculo || '—'}</td>
                      <td>{f.origem === 'liquidos' ? 'Líquidos' : 'Extrato Mensal'}</td>
                      <td className="num">{f.qtd_funcionarios}</td>
                      <td className="num">{Number(f.total_liquido || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                      <td className="mono">{f.criado_em ? new Date(f.criado_em).toLocaleDateString('pt-BR') : '—'}</td>
                      <td><button className="icon-btn icon-btn-danger" title="Excluir folha" onClick={() => excluirFolha(f)}><Trash2 size={14} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <h3>Funcionários reconhecidos ({funcionarios.length})</h3>
            <p className="hint" style={{ marginBottom: 8 }}>Cadastro alimentado automaticamente pelos PDFs — é ele que permite reconhecer os pagamentos por nome no extrato bancário.</p>
            {funcionarios.length === 0 ? <div className="empty-state">Envie uma folha acima para cadastrar os funcionários.</div> : (
              <div className="table-wrap"><table>
                <thead><tr><th className="num">CÓD.</th><th>NOME</th><th>CPF</th><th>CARGO</th></tr></thead>
                <tbody>
                  {funcionarios.map(f => (
                    <tr key={f.id}>
                      <td className="num mono">{f.codigo}</td>
                      <td>{f.nome}</td>
                      <td className="mono">{f.cpf || f.identidade || '—'}</td>
                      <td>{f.cargo || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </div>
        </section>
      )}

      {tab === 'regras' && (
        <section className="panel">
          <p className="hint">Palavra-chave → conta contábil. Quando mais de uma regra combina, vale a <strong>última da lista</strong>. A conta p/ entradas (opcional) é usada quando o dinheiro entra; vazia, vale a mesma conta dos dois lados.</p>
          <div className="regras-toolbar">
            <div className="search-hero" style={{ margin: 0, flex: '1 1 320px' }}>
              <Search size={16} />
              <input type="search" placeholder="Buscar regra por palavra-chave, conta ou descrição…"
                value={regrasSearch} onChange={e => setRegrasSearch(e.target.value)} />
            </div>
          </div>
          <div className="stats" style={{ marginTop: 10 }}>
            <div className="stat">{regras.length} regras</div>
            {regrasInvalidas.length > 0 && (
              <div className="stat warn"><AlertTriangle size={12} style={{ verticalAlign: -2, marginRight: 5 }} />{regrasInvalidas.length} com código fora do plano de contas</div>
            )}
            {regrasComSintetica.length > 0 && (
              <div className="stat warn" style={{ background: '#F1E3E3', color: '#A33', borderColor: '#E0C4C4' }}>{regrasComSintetica.length} apontando pra conta Sintética</div>
            )}
          </div>
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="regras-table">
              <thead><tr><th style={{ width: 50 }}></th><th style={{ width: '24%' }}>PALAVRA-CHAVE</th><th style={{ width: '15%' }}>CONTA (SAÍDAS)</th><th style={{ width: '15%' }}>CONTA P/ ENTRADAS</th><th style={{ width: '22%' }}>DESCRIÇÃO DA CONTA</th><th>OBSERVAÇÃO</th><th style={{ width: 34 }}></th></tr></thead>
              <tbody>
                {(() => {
                  const q = regrasSearch.trim().toLowerCase();
                  const visiveis = q ? regras.filter(r =>
                    (r.palavra_chave || '').toLowerCase().includes(q) ||
                    String(r.codigo || '').includes(q) ||
                    String(r.codigo_recebimento || '').includes(q) ||
                    (r.descricao || '').toLowerCase().includes(q) ||
                    (findContaDesc(r.codigo) || '').toLowerCase().includes(q)
                  ) : regras;
                  if (q && visiveis.length === 0) {
                    return <tr><td colSpan={7}><div className="empty-state" style={{ padding: '22px 10px' }}>Nenhuma regra encontrada para "{regrasSearch}".</div></td></tr>;
                  }
                  return visiveis.map(r => {
                  const i = regras.indexOf(r);
                  return (
                  <tr key={r.id} title={r.updated_by ? `editado por ${r.updated_by} em ${fmtData(r.updated_at)}` : ''}>
                    <td>
                      <div className="icon-btn-group">
                        <button className="icon-btn" style={{ width: 24, height: 24 }} title={q ? 'Limpe a busca para reordenar' : 'Subir na prioridade'} disabled={!isAdmin || i === 0 || !!q} onClick={() => moveRegra(r, -1)}><ArrowUp size={13} /></button>
                        <button className="icon-btn" style={{ width: 24, height: 24 }} title={q ? 'Limpe a busca para reordenar' : 'Descer na prioridade'} disabled={!isAdmin || i === regras.length - 1 || !!q} onClick={() => moveRegra(r, 1)}><ArrowDown size={13} /></button>
                      </div>
                    </td>
                    <td><input className="cell-edit" defaultValue={r.palavra_chave} readOnly={!isAdmin} onBlur={e => isAdmin && updateRegra(r, 'palavra_chave', e.target.value)} /></td>
                    <td style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <input className="cell-edit" list="contas-datalist" defaultValue={r.codigo ? `${r.codigo} — ${findContaDesc(r.codigo)}` : ''} readOnly={!isAdmin}
                        onBlur={e => isAdmin && updateRegra(r, 'codigo', extractCodigoFromPicked(e.target.value))} />
                      {isAdmin && <button className="icon-btn" style={{ width: 26, height: 26 }} title="Buscar conta" onClick={() => openPicker((conta) => updateRegra(r, 'codigo', String(conta.codigo)))}><Search size={13} /></button>}
                    </td>
                    <td style={{ display: 'flex', gap: 4, alignItems: 'center' }} title="Se preenchida, entradas (PIX recebido, TED recebida…) usam esta conta; saídas continuam na conta ao lado. Vazio = mesma conta pros dois.">
                      <input className="cell-edit" list="contas-datalist" placeholder="mesma da saída" defaultValue={r.codigo_recebimento ? `${r.codigo_recebimento} — ${findContaDesc(r.codigo_recebimento)}` : ''} readOnly={!isAdmin}
                        onBlur={e => isAdmin && updateRegra(r, 'codigo_recebimento', extractCodigoFromPicked(e.target.value))} />
                      {isAdmin && <button className="icon-btn" style={{ width: 26, height: 26 }} title="Buscar conta" onClick={() => openPicker((conta) => updateRegra(r, 'codigo_recebimento', String(conta.codigo)))}><Search size={13} /></button>}
                    </td>
                    <td className="mono" style={{ color: 'var(--ink-soft)' }}>
                      {!r.codigo ? '' : !findContaDesc(r.codigo)
                        ? <span className="badge warn" style={{ background: '#FBE9E7', color: '#A33' }}>código não encontrado</span>
                        : isContaSintetica(r.codigo)
                          ? <><span className="badge warn" style={{ background: '#FBE9E7', color: '#A33' }}>SINTÉTICA</span> {findContaDesc(r.codigo)}</>
                          : findContaDesc(r.codigo)}
                    </td>
                    <td><input className="cell-edit" defaultValue={r.descricao || ''} readOnly={!isAdmin} onBlur={e => isAdmin && updateRegra(r, 'descricao', e.target.value)} /></td>
                    <td>{isAdmin && <button className="icon-btn icon-btn-danger" title="Excluir regra" onClick={() => deleteRegra(r)}><Trash2 size={14} /></button>}</td>
                  </tr>
                  );
                  });
                })()}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === 'contas' && (
        <section className="panel">
          <div className="stats" style={{ marginTop: 2 }}>
            <div className="stat">{planoContas.length} contas no total</div>
            <div className="stat ok">{planoContas.filter(c => c.tipo === 'A').length} analíticas</div>
            <div className="stat" style={{ background: '#FBEEE1', color: '#B5651D', borderColor: '#EED6BC' }}>{planoContas.filter(c => c.tipo === 'S').length} sintéticas (totalizadoras)</div>
            {contasFiltradas.length !== planoContas.length && <div className="stat warn">{contasFiltradas.length} exibidas no filtro</div>}
          </div>
          <p className="hint" style={{ marginBottom: 4 }}>As contas <strong>sintéticas</strong> (destacadas) só totalizam e não recebem lançamento; as <strong>analíticas</strong> são as que recebem. Use a busca para achar rápido.</p>
          <div className="row" style={{ marginTop: 0 }}>
            <input type="search" placeholder="Buscar por código ou descrição…" style={{ minWidth: 280 }}
              value={contasSearch} onChange={e => setContasSearch(e.target.value)} />
            <select value={grupoFiltro} onChange={e => setGrupoFiltro(e.target.value)}>
              <option value="">Todos os grupos</option>
              {Object.values(GRUPOS_POR_NIVEL1).map(g => <option key={g} value={g}>{g}</option>)}
            </select>
            <button className="btn secondary" onClick={() => openPicker(() => {})}><Search size={13} style={{marginRight:5,verticalAlign:-2}}/>Abrir em janela de busca (F4)</button>
          </div>
          <div className="table-wrap" style={{ marginTop: 14 }}>
            <table>
              <thead><tr><th style={{ width: '9%' }}>CÓDIGO</th><th style={{ width: '15%' }}>CLASSIFICAÇÃO</th><th style={{ width: '13%' }}>GRUPO</th><th>DESCRIÇÃO</th><th style={{ width: '10%' }}>TIPO</th><th style={{ width: 34 }}></th></tr></thead>
              <tbody>
                {contasFiltradas.map(c => {
                  const nivel = Math.max(0, String(c.classificacao || '').split('.').filter(Boolean).length - 1);
                  const sintetica = c.tipo === 'S';
                  return (
                  <tr key={c.id} className={sintetica ? 'conta-sintetica' : ''} title={c.updated_by ? `editado por ${c.updated_by} em ${fmtData(c.updated_at)}` : ''}>
                    <td><input className="cell-edit mono" defaultValue={c.codigo} readOnly={!isAdmin} onBlur={e => isAdmin && updateConta(c, 'codigo', e.target.value)} /></td>
                    <td><input className="cell-edit mono" defaultValue={c.classificacao || ''} readOnly={!isAdmin} onBlur={e => isAdmin && updateConta(c, 'classificacao', e.target.value)} /></td>
                    <td className="mono" style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{grupoOf(c.classificacao)}</td>
                    <td><input className="cell-edit" style={{ paddingLeft: 8 + nivel * 16, fontWeight: sintetica ? 700 : 400 }} defaultValue={c.descricao} readOnly={!isAdmin} onBlur={e => isAdmin && updateConta(c, 'descricao', e.target.value)} /></td>
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
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === 'importacao' && (
        <section className="panel">
          {processedRows.length === 0 ? (
            <div className="empty-state">Processe um extrato na aba EXTRATO primeiro.</div>
          ) : (
            <>
              {(() => {
                const prontos = processedRows.filter(r => r.status === 'automatico').length;
                const pend = processedRows.filter(r => r.status === 'sem match').length;
                const dups = processedRows.filter(r => r.status === 'duplicado').length;
                return (
                  <>
                    <div className="steps">
                      <div className="step done"><div className="step-n">✓</div><div className="step-t">Extrato processado</div></div>
                      <div className={'step ' + (prontos > 0 ? 'done' : 'now')}><div className="step-n">{prontos > 0 ? '✓' : '2'}</div><div className="step-t">Lançamentos classificados</div></div>
                      <div className={'step ' + (pend === 0 ? 'done' : 'now')}><div className="step-n">{pend === 0 ? '✓' : '3'}</div><div className="step-t">Revisar pendências</div></div>
                      <div className={'step ' + (pend === 0 && prontos > 0 ? 'now' : '')}><div className="step-n">4</div><div className="step-t">Gerar arquivo</div></div>
                    </div>
                    <div className="dash-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', marginBottom: 16 }}>
                      <div className="kpi-card" style={{ cursor: 'default' }}><div className="kpi-value">{prontos}</div><div className="kpi-label">Prontos p/ exportar</div><div className="kpi-sub">classificados e conferidos</div></div>
                      <div className="kpi-card" style={{ cursor: 'default' }}><div className="kpi-value" style={{ color: 'var(--amber-vivid)' }}>{pend}</div><div className="kpi-label">Pendências</div><div className="kpi-sub">precisam de conta manual</div></div>
                      <div className="kpi-card" style={{ cursor: 'default' }}><div className="kpi-value" style={{ color: 'var(--red)' }}>{dups}</div><div className="kpi-label">Duplicados</div><div className="kpi-sub">não entram no arquivo</div></div>
                    </div>
                  </>
                );
              })()}
              <div className="row" style={{ marginTop: 0 }}>
                <button className="btn teal" onClick={() => exportarImportacao(false, 'txt')}>Exportar .txt — Domínio</button>
                <button className="btn secondary" onClick={() => exportarImportacao(true, 'txt')}>Exportar só classificados (.txt)</button>
                <button className="btn secondary" onClick={() => exportarImportacao(false, 'csv')}>Exportar .csv — conferência</button>
              </div>
              <p className="hint">O <strong>.txt</strong> sai pronto pro Domínio: separado por ponto e vírgula (;), sem cabeçalho e em codificação ANSI. O <strong>.csv</strong> inclui cabeçalho e a coluna de status, pra conferir no Excel. Lançamentos marcados como "duplicado" não entram em nenhum arquivo.</p>
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
          {historico.length === 0 ? (
            <div className="empty-state">Nenhuma importação confirmada ainda para esta empresa.</div>
          ) : (
            <>
              <div className="stats">
                <div className="stat">{historico.length} importações registradas</div>
                <div className="stat ok">{historico.reduce((s, h) => s + (h.total_classificados || 0), 0)} lançamentos classificados no total</div>
                <div className="stat warn">{historico.reduce((s, h) => s + (h.total_sem_match || 0), 0)} sem correspondência no total</div>
              </div>
              <div className="timeline" style={{ marginTop: 22 }}>
                {historico.map(h => {
                  const layoutNome = layouts.find(l => String(l.id) === String(h.layout_id))?.nome || '—';
                  return (
                    <div key={h.id} className={'tl-item ' + ((h.total_sem_match || 0) > 0 ? 'warn' : 'ok')}>
                      <div className="tl-title">Importação confirmada — {h.total_lancamentos} lançamento(s)</div>
                      <div className="tl-meta">{fmtData(h.processado_em)} · {h.processado_por}</div>
                      <div className="tl-desc">
                        {h.total_classificados} classificados · {h.total_sem_match} sem correspondência · {h.total_duplicados} duplicados · layout {layoutNome} · conta {h.conta_codigo}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>
      )}

      </div>

      {tab === 'assinantes' && souSuper && (
        <section className="panel">
          <div className="empresas-layout">
          <div>
            <p className="hint">Cada assinante é um escritório com ambiente próprio e isolado: os usuários dele só enxergam as empresas dele. A cobrança é pelo <strong>limite de empresas (CNPJs)</strong>; usuários são ilimitados. Suspender corta o acesso de todos na hora (reversível).</p>
            {assCarregando ? (
              <SkeletonTabela linhas={5} />
            ) : (
              <div className="table-wrap"><table>
                <thead><tr><th>ESCRITÓRIO</th><th>GERENTE(S)</th><th className="num">EMPRESAS</th><th className="num">USUÁRIOS</th><th>PLANO</th><th>PAGAMENTO</th><th>STATUS</th><th>DESDE</th><th style={{ width: 150 }}>AÇÕES</th></tr></thead>
                <tbody>
                  {assinantes.map(esc => (
                    <tr key={esc.id} style={esc.ativo ? {} : { opacity: 0.55 }}>
                      <td><strong>{esc.nome}</strong>{esc.id === meuEscritorioId && <span className="pill" style={{ marginLeft: 6 }}>seu</span>}</td>
                      <td className="mono" style={{ fontSize: 11.5 }}>{esc.gerentes || '—'}</td>
                      <td className="num" style={esc.qtde_empresas >= esc.limite_empresas ? { color: 'var(--danger)', fontWeight: 700 } : {}}>
                        {esc.qtde_empresas} / {esc.limite_empresas}
                      </td>
                      <td className="num">{esc.qtde_usuarios}</td>
                      <td style={{ fontSize: 12 }}>{getPlano(esc.plano)?.nome || '—'}</td>
                      <td>
                        {esc.status_pagamento === 'em_dia' && <span className="badge ok">em dia</span>}
                        {esc.status_pagamento === 'aguardando' && <span className="badge warn">aguardando</span>}
                        {esc.status_pagamento === 'suspenso' && <span className="badge warn" style={{ background: '#F1E3E3', color: '#A33' }}>suspenso</span>}
                        {(!esc.status_pagamento || esc.status_pagamento === 'manual') && <span className="pill">manual</span>}
                      </td>
                      <td>{esc.ativo ? <span className="badge ok">ativa</span> : <span className="badge warn">suspensa</span>}</td>
                      <td className="mono" style={{ fontSize: 11.5 }}>{fmtData(esc.criado_em)}</td>
                      <td>
                        <button className="icon-btn" title="Ver o ambiente deste assinante (modo suporte)" onClick={() => verAmbienteAssinante(esc)}><Eye size={14} /></button>
                        <button className="icon-btn" title="Alterar limite de empresas do plano" onClick={() => editarLimiteAssinante(esc)}><Pencil size={14} /></button>
                        <button className="icon-btn" title="Gerar link de cobrança (Mercado Pago)" onClick={() => gerarLinkCobranca(esc)}><CreditCard size={14} /></button>
                        {esc.id !== meuEscritorioId && (
                          <button className="icon-btn" title={esc.ativo ? 'Suspender assinatura' : 'Reativar assinatura'} onClick={() => alternarAtivoAssinante(esc)}>
                            {esc.ativo ? <UserX size={14} /> : <UserCheck size={14} />}
                          </button>
                        )}
                        {esc.id !== meuEscritorioId && (
                          <button className="icon-btn icon-btn-danger" title="Excluir assinante para sempre" onClick={() => excluirAssinante(esc)}><Trash2 size={14} /></button>
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

            <div className="form-grid-2">
              <div>
                <div className="field-label">Nome do escritório</div>
                <input type="text" style={{ width: '100%' }} placeholder="ex: Contabilidade Silva & Souza" value={assForm.nome}
                  onChange={e => setAssForm(f => ({ ...f, nome: e.target.value }))} />
              </div>
              <div>
                <div className="field-label">Limite de empresas</div>
                <input type="number" min="1" style={{ width: '100%' }} value={assForm.limite_empresas}
                  onChange={e => setAssForm(f => ({ ...f, limite_empresas: parseInt(e.target.value) || 1 }))} />
              </div>
              <div>
                <div className="field-label">Usuário do gerente</div>
                <input type="text" style={{ width: '100%' }} placeholder="ex: silva.gerente" value={assForm.gerente_username}
                  onChange={e => setAssForm(f => ({ ...f, gerente_username: e.target.value }))} />
              </div>
              <div>
                <div className="field-label">E-mail do gerente (opcional)</div>
                <input type="email" style={{ width: '100%' }} placeholder="contato@silvaesouza.com.br" value={assForm.gerente_email}
                  onChange={e => setAssForm(f => ({ ...f, gerente_email: e.target.value }))} />
              </div>
            </div>

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
            <p className="hint">Crie logins para a equipe, defina o papel de cada um e limite o acesso por empresa. Usuário desativado perde o acesso na hora.</p>
            {usrCarregando ? (
              <SkeletonTabela linhas={5} />
            ) : (
              <div className="table-wrap"><table>
                <thead><tr><th>USUÁRIO</th><th>PAPEL</th><th>ACESSO</th><th>ÚLTIMO LOGIN</th><th>STATUS</th><th style={{ width: 130 }}>AÇÕES</th></tr></thead>
                <tbody>
                  {usuarios.map((u, idx) => (
                    <tr key={u.user_id} style={u.ativo ? {} : { opacity: 0.55 }}>
                      <td>
                        <div className="u-cell">
                          <div className={'u-avatar ' + ['a', 'b', 'c', 'd'][idx % 4]}>{(u.username || u.email || '?').slice(0, 2).toUpperCase()}</div>
                          <div>
                            <div className="u-name">{u.username || '—'}{u.sou_eu && <span className="pill" style={{ marginLeft: 6 }}>você</span>}</div>
                            <div className="u-mail">{u.email || 'sem e-mail'}</div>
                          </div>
                        </div>
                      </td>
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
              <div className="form-grid-2">
                <div>
                  <div className="field-label">E-mail (opcional)</div>
                  <input type="email" style={{ width: '100%' }} placeholder="joao@escritorio.com.br" value={usrForm.email}
                    onChange={e => setUsrForm(f => ({ ...f, email: e.target.value }))} />
                </div>
                <div>
                  <div className="field-label">Senha inicial</div>
                  <input type="text" style={{ width: '100%' }} placeholder="mínimo 6 caracteres" value={usrForm.password}
                    onChange={e => setUsrForm(f => ({ ...f, password: e.target.value }))} />
                </div>
              </div>
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
      </div>{/* fim .app */}
      </div>{/* fim .main-area */}
    </div>
  );
}
