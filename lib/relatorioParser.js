import * as XLSX from 'xlsx';

// =====================================================================
// RELATÓRIOS FINANCEIROS (contas pagas / recebimentos / folha etc.)
// ---------------------------------------------------------------------
// Cada sistema exporta num formato diferente (com ou sem cabeçalho,
// data como texto "01/04/2026" ou como número serial do Excel tipo
// 46113, valor "3.600,00" ou "3600.0"...). Por isso o parser:
//   1. Lê o arquivo bruto em linhas/colunas;
//   2. DETECTA sozinho quais colunas parecem Data, Valor e Descrição
//      (pelo CONTEÚDO, nunca pelo cabeçalho);
//   3. Mostra uma prévia pro usuário confirmar/ajustar antes de salvar.
// =====================================================================

// --- datas ---
// Número serial do Excel -> ISO (yyyy-mm-dd). 45000~50000 cobre 2023–2036.
export function excelSerialToISO(serial) {
  const n = Number(serial);
  if (!isFinite(n) || n < 20000 || n > 70000) return null;
  const ms = Math.round((n - 25569) * 86400000); // 25569 = 01/01/1970 no calendário do Excel
  const d = new Date(ms);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

// "01/04/2026", "1/4/26", "2026-04-01" ou serial Excel -> ISO. Senão, null.
export function normalizarDataISO(raw) {
  const v = String(raw ?? '').trim();
  if (!v) return null;
  let m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    let [, dd, mm, yy] = m;
    if (yy.length === 2) yy = (Number(yy) > 70 ? '19' : '20') + yy;
    const dia = Number(dd), mes = Number(mm), ano = Number(yy);
    if (dia < 1 || dia > 31 || mes < 1 || mes > 12) return null;
    return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  }
  m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  if (/^\d+(\.\d+)?$/.test(v)) return excelSerialToISO(v);
  return null;
}

export function fmtISOparaBR(iso) {
  if (!iso) return '—';
  const [a, m, d] = String(iso).split('-');
  return `${d}/${m}/${a}`;
}

// --- valores ---
// "3.600,00" (pt-BR), "3600.5", "R$ 1.234,56", "-936,00" -> número.
export function normalizarValor(raw) {
  let v = String(raw ?? '').trim().replace(/R\$\s?/i, '');
  if (!v) return null;
  const negativo = /^-|\(.*\)$/.test(v);
  v = v.replace(/^-/, '').replace(/[()]/g, '');
  if (v.includes(',')) v = v.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(v);
  if (!isFinite(n)) return null;
  return negativo ? -Math.abs(n) : n;
}

// --- leitura do arquivo em linhas cruas ---
export function lerArquivoEmLinhas(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('falha ao ler arquivo'));
    reader.onload = (e) => {
      try {
        const ext = file.name.split('.').pop().toLowerCase();
        if (ext === 'csv' || ext === 'txt') {
          const text = e.target.result;
          const sep = text.includes(';') ? ';' : (text.includes('\t') ? '\t' : ',');
          const rows = text.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim()).map(l => l.split(sep));
          resolve(rows);
        } else {
          const data = new Uint8Array(e.target.result);
          const wb = XLSX.read(data, { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          // raw:true preserva números seriais de data (a gente converte depois)
          const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
          resolve(rows.map(r => r.map(c => (c === null || c === undefined) ? '' : c)));
        }
      } catch (err) { reject(err); }
    };
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'csv' || ext === 'txt') reader.readAsText(file, 'utf-8');
    else reader.readAsArrayBuffer(file);
  });
}

// --- detecção automática de colunas ---
// Devolve { colunas: [{indice, pctData, pctValor, pctTexto, exemplo}], sugestao: {colData, colValor, colsDescricao} }
export function detectarColunas(rows) {
  const maxCols = rows.reduce((m, r) => Math.max(m, r ? r.length : 0), 0);
  const colunas = [];
  for (let c = 0; c < maxCols; c++) {
    let preenchidas = 0, comoData = 0, comoValor = 0, comDecimal = 0, comoTexto = 0, somaLen = 0;
    let exemplo = '';
    for (const r of rows) {
      if (!r) continue;
      const raw = r[c];
      const v = String(raw ?? '').trim();
      if (v === '') continue;
      preenchidas++;
      if (!exemplo && v.length > 0) exemplo = v.slice(0, 30);
      if (normalizarDataISO(v)) comoData++;
      const num = normalizarValor(v);
      if (num !== null && /[\d]/.test(v)) {
        comoValor++;
        // dinheiro de verdade quase sempre tem centavos ("3600.5", "1.234,56");
        // números de lançamento/nota são inteiros — é assim que diferenciamos.
        if (Math.abs(num % 1) > 1e-9 || /,\d{2}$/.test(v)) comDecimal++;
      }
      if (isNaN(Number(v.replace(',', '.'))) && !/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(v)) { comoTexto++; somaLen += v.length; }
    }
    colunas.push({
      indice: c,
      preenchidas,
      pctData: preenchidas ? comoData / preenchidas : 0,
      pctValor: preenchidas ? comoValor / preenchidas : 0,
      pctDecimal: preenchidas ? comDecimal / preenchidas : 0,
      pctTexto: preenchidas ? comoTexto / preenchidas : 0,
      lenMediaTexto: comoTexto ? somaLen / comoTexto : 0,
      exemplo,
    });
  }

  // Data: colunas onde quase tudo vira data válida. Se houver várias (venc/emissão/pagto),
  // sugerimos a ÚLTIMA — nos relatórios de contas pagas a "Dt. Pagto" costuma vir depois.
  const colsData = colunas.filter(s => s.preenchidas >= 3 && s.pctData > 0.85);
  const colData = colsData.length ? colsData[colsData.length - 1].indice : -1;

  // Valor: coluna numérica que não seja data. Prioriza quem tem mais valores
  // com CENTAVOS (decimais) — colunas de nº de lançamento/nota são só inteiros.
  const candidatasValor = colunas
    .filter(s => s.indice !== colData && s.preenchidas >= 3 && s.pctValor > 0.85 && s.pctData < 0.5);
  const comDecimais = candidatasValor.filter(s => s.pctDecimal > 0.05)
    .sort((a, b) => (b.pctDecimal - a.pctDecimal) || (b.preenchidas - a.preenchidas));
  const colValor = comDecimais.length
    ? comDecimais[0].indice
    : (candidatasValor.sort((a, b) => b.preenchidas - a.preenchidas)[0]?.indice ?? -1);

  // Descrição: colunas de texto com tamanho médio razoável (nomes, históricos)
  const colsDescricao = colunas
    .filter(s => s.pctTexto > 0.5 && s.lenMediaTexto >= 4 && s.indice !== colData && s.indice !== colValor)
    .sort((a, b) => b.lenMediaTexto - a.lenMediaTexto)
    .slice(0, 3)
    .map(s => s.indice)
    .sort((a, b) => a - b);

  return { colunas, sugestao: { colData, colValor, colsDescricao } };
}

// --- extração final, com o mapeamento (auto ou ajustado pelo usuário) ---
export function extrairItens(rows, mapa) {
  const { colData, colValor, colsDescricao, colCategoria } = mapa;
  const itens = [];
  for (const r of rows) {
    if (!r) continue;
    const dataISO = normalizarDataISO(r[colData]);
    const valor = normalizarValor(r[colValor]);
    if (!dataISO || valor === null || valor === 0) continue; // linha de cabeçalho/total/lixo
    const descricao = (colsDescricao || [])
      .map(c => String(r[c] ?? '').trim())
      .filter(Boolean)
      .join(' — ')
      .slice(0, 300);
    if (!descricao) continue;
    const categoria = (colCategoria !== undefined && colCategoria >= 0)
      ? String(r[colCategoria] ?? '').trim().slice(0, 120) : '';
    itens.push({ data: dataISO, valor: Math.abs(valor), valorOriginal: valor, descricao, categoria });
  }
  return itens;
}

// --- cruzamento extrato x relatório ---
// Índices:
//   porChave      data|valor  -> itens (casamento exato, 1 pra 1)
//   porValor      valor       -> itens (casamento aproximado ±dias)
//   porDataCat    data|categoria -> soma dos itens (folha via SISPAG etc.)
//   porDataForn   data|fornecedor -> soma dos itens (vários títulos do mesmo fornecedor pagos juntos)
//   porDataTotal  data        -> soma de TODOS os itens do dia (último recurso)
// Os índices de soma resolvem o caso "1 débito no banco = N pagamentos no
// relatório" (conta-salário, lote de duplicatas do mesmo fornecedor…).
export function construirIndiceRelatorio(itens) {
  const porChave = new Map();
  const porValor = new Map();
  const porDataCat = new Map();
  const porDataForn = new Map();
  const porDataTotal = new Map();

  const acumula = (mapa, chave, it, rotulo) => {
    if (!mapa.has(chave)) mapa.set(chave, { soma: 0, count: 0, rotulo });
    const g = mapa.get(chave);
    g.soma += Number(it.valor);
    g.count += 1;
  };

  for (const it of itens) {
    const kValor = Number(it.valor).toFixed(2);
    const k = `${it.data}|${kValor}`;
    if (!porChave.has(k)) porChave.set(k, []);
    porChave.get(k).push(it);
    if (!porValor.has(kValor)) porValor.set(kValor, []);
    porValor.get(kValor).push(it);

    const cat = (it.categoria || '').trim().toUpperCase();
    if (cat) acumula(porDataCat, `${it.data}|${cat}`, it, it.categoria);
    // "fornecedor" = primeiro pedaço da descrição (as colunas são unidas por ' — ')
    const forn = String(it.descricao || '').split(' — ')[0].trim().toUpperCase();
    if (forn.length >= 4) acumula(porDataForn, `${it.data}|${forn}`, it, String(it.descricao).split(' — ')[0].trim());
    acumula(porDataTotal, it.data, it, 'todos os itens do dia');
  }
  return { porChave, porValor, porDataCat, porDataForn, porDataTotal };
}

function diffDias(isoA, isoB) {
  const a = new Date(isoA + 'T00:00:00Z').getTime();
  const b = new Date(isoB + 'T00:00:00Z').getTime();
  return Math.abs(a - b) / 86400000;
}

// row do extrato: {data: 'dd/mm/aaaa', valor: '1.234,56', cd: 'D'|'C'}
// indices: { D: indicePagamentos, C: indiceRecebimentos }  (qualquer um pode ser null)
export function cruzarComRelatorio(row, indices, toleranciaDias = 3) {
  const idx = indices[row.cd === 'D' ? 'D' : 'C'];
  if (!idx) return null;
  const dataISO = normalizarDataISO(row.data);
  const valor = normalizarValor(row.valor);
  if (!dataISO || valor === null) return null;
  const alvo = Math.abs(valor);
  const kValor = alvo.toFixed(2);

  // 1) casamento exato 1 pra 1 (mesma data, mesmo valor)
  const exatos = idx.porChave.get(`${dataISO}|${kValor}`);
  if (exatos && exatos.length) {
    return { tipo: 'exato', item: exatos[0], outros: exatos.length - 1 };
  }

  // 2) mesmo valor com até N dias de diferença
  const mesmoValor = idx.porValor.get(kValor);
  if (mesmoValor && mesmoValor.length) {
    let melhor = null;
    for (const it of mesmoValor) {
      const d = diffDias(dataISO, it.data);
      if (d <= toleranciaDias && (!melhor || d < melhor.d)) melhor = { it, d };
    }
    if (melhor) return { tipo: 'aproximado', item: melhor.it, diasDiferenca: Math.round(melhor.d), outros: 0 };
  }

  // 3) SOMAS do mesmo dia: 1 débito no banco = N pagamentos no relatório
  //    (folha via SISPAG/conta-salário, lote de duplicatas do fornecedor…)
  const bate = (soma) => Math.abs(soma - alvo) < 0.015;
  const buscaGrupo = (mapa, prefixoRotulo) => {
    for (const [chave, g] of mapa) {
      if (chave.startsWith(dataISO + '|') && g.count > 1 && bate(g.soma)) {
        return {
          tipo: 'grupo',
          quantidade: g.count,
          item: {
            categoria: prefixoRotulo === 'categoria' ? g.rotulo : '',
            descricao: `soma de ${g.count} pagamentos${prefixoRotulo === 'fornecedor' ? ` de ${g.rotulo}` : prefixoRotulo === 'categoria' ? '' : ' do relatório'} neste dia`,
          },
        };
      }
    }
    return null;
  };
  const porCat = buscaGrupo(idx.porDataCat, 'categoria');
  if (porCat) return porCat;
  const porForn = buscaGrupo(idx.porDataForn, 'fornecedor');
  if (porForn) return porForn;
  const dia = idx.porDataTotal.get(dataISO);
  if (dia && dia.count > 1 && bate(dia.soma)) {
    return { tipo: 'grupo', quantidade: dia.count, item: { categoria: '', descricao: `soma dos ${dia.count} itens do relatório neste dia` } };
  }
  return null;
}
