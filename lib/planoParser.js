import * as XLSX from 'xlsx';

// ---- PLANO DE CONTAS ----
// Detecta as colunas (código / classificação / descrição) pelo CONTEÚDO,
// não pelo texto do cabeçalho — relatórios exportados do Domínio costumam
// vir com o rótulo do cabeçalho desalinhado da coluna real de dados.
export function parseSheetRows(rows) {
  const maxCols = rows.reduce((m, r) => Math.max(m, r ? r.length : 0), 0);
  if (maxCols === 0) return [];

  const stats = [];
  for (let c = 0; c < maxCols; c++) {
    let intCount = 0, dotCount = 0, textCount = 0, textLenSum = 0, filled = 0;
    for (const r of rows) {
      if (!r || r[c] === undefined || r[c] === null) continue;
      const v = String(r[c]).trim();
      if (v === '') continue;
      filled++;
      if (/^\d+$/.test(v)) intCount++;
      else if (/^\d+(\.\d+)+$/.test(v)) dotCount++;
      else if (isNaN(v.replace(',', '.'))) { textCount++; textLenSum += v.length; }
    }
    stats.push({ c, filled, intCount, dotCount, textCount, avgTextLen: textCount ? textLenSum / textCount : 0 });
  }

  const colCodigo = stats.slice().sort((a, b) => (b.intCount / (b.filled || 1)) - (a.intCount / (a.filled || 1)))[0].c;
  const classCandidates = stats.filter(s => s.dotCount > 0).sort((a, b) => b.dotCount - a.dotCount);
  const colClass = classCandidates.length ? classCandidates[0].c : -1;
  const descCandidates = stats.filter(s => s.c !== colCodigo && s.c !== colClass && s.textCount > 0)
    .sort((a, b) => b.avgTextLen - a.avgTextLen);
  const colDesc = descCandidates.length ? descCandidates[0].c : -1;

  if (colCodigo === -1 || colDesc === -1) return [];

  const out = [];
  for (const r of rows) {
    if (!r) continue;
    const codRaw = String(r[colCodigo] || '').trim();
    const descRaw = String(r[colDesc] || '').trim();
    if (!/^\d+$/.test(codRaw) || !descRaw) continue;
    const codigo = parseInt(codRaw);
    const classificacao = colClass > -1 ? String(r[colClass] || '').trim() : '';
    out.push({ codigo, classificacao, descricao: descRaw });
  }
  return out;
}

export function parseCsvSmart(text) {
  const sep = text.includes(';') ? ';' : (text.includes('\t') ? '\t' : ',');
  const lines = text.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim());
  const rows = lines.map(l => l.split(sep));
  return parseSheetRows(rows);
}

export function parsePlanoPaste(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  const out = [];
  lines.forEach(line => {
    const parts = line.split(';').map(p => p.trim());
    if (parts.length < 2) return;
    const codigo = parseInt(parts[0]);
    if (isNaN(codigo)) return;
    const classificacao = parts.length >= 3 ? parts[1] : '';
    const descricao = parts.length >= 3 ? parts[2] : parts[1];
    out.push({ codigo, classificacao, descricao });
  });
  return out;
}

export function parsePlanoFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('falha ao ler arquivo'));
    reader.onload = (e) => {
      try {
        const ext = file.name.split('.').pop().toLowerCase();
        if (ext === 'csv' || ext === 'txt') {
          resolve(parseCsvSmart(e.target.result));
        } else {
          const data = new Uint8Array(e.target.result);
          const wb = XLSX.read(data, { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
          resolve(parseSheetRows(rows));
        }
      } catch (err) { reject(err); }
    };
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'csv' || ext === 'txt') reader.readAsText(file, 'utf-8');
    else reader.readAsArrayBuffer(file);
  });
}

// ---- EXTRATO ----
export function getSeparator(sepSetting, sampleLine) {
  if (sepSetting === 'tab') return '\t';
  if (sepSetting === ';') return ';';
  if (sepSetting === ',') return ',';
  return sampleLine.includes('\t') ? '\t' : ';';
}

export function parseExtrato(text, cfg) {
  const lines = text.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim() !== '');
  const rows = [];
  lines.forEach(line => {
    const sep = getSeparator(cfg.separador, line);
    const parts = line.split(sep).map(p => p.trim());
    const maxNeeded = Math.max(cfg.col_data, cfg.col_historico, cfg.col_valor, cfg.cd_mode === 'coluna' ? cfg.col_cd : 0);
    if (parts.length <= maxNeeded) return;
    const data = parts[cfg.col_data] || '';
    const historico = parts[cfg.col_historico] || '';
    const valorRaw = parts[cfg.col_valor] || '';
    let cd;
    if (cfg.cd_mode === 'coluna') {
      cd = (parts[cfg.col_cd] || '').toUpperCase().trim();
    } else {
      cd = valorRaw.trim().startsWith('-') ? 'D' : 'C';
    }
    const detalhamento = (cfg.col_detalhamento >= 0 && parts[cfg.col_detalhamento]) ? parts[cfg.col_detalhamento] : '';
    rows.push({ data, valor: valorRaw.replace(/^-/, ''), historico, cd, detalhamento });
  });
  return rows;
}

export function classificar(rows, regras, contaBancoFixa) {
  const listaRegras = Array.isArray(regras) ? regras : [];
  return rows.map(row => {
    const searchText = (row.detalhamento + ' ' + row.historico).toUpperCase();
    let matchedRule = null;
    for (const r of listaRegras) {
      if (r.palavra_chave && searchText.includes(r.palavra_chave.toUpperCase())) matchedRule = r;
    }
    const codigo = matchedRule ? matchedRule.codigo : null;
    const isDebito = row.cd === 'D';
    let contaCredora, contaDevedora, status;
    if (!contaBancoFixa) {
      status = 'sem conta banco configurada';
      contaCredora = contaDevedora = '';
    } else if (codigo !== null) {
      contaCredora = isDebito ? contaBancoFixa : codigo;
      contaDevedora = isDebito ? codigo : contaBancoFixa;
      status = 'automatico';
    } else {
      contaCredora = isDebito ? contaBancoFixa : '';
      contaDevedora = isDebito ? '' : contaBancoFixa;
      status = 'sem match';
    }
    return { ...row, contaCredora, contaDevedora, status };
  });
}

export function downloadFile(content, filename) {
  const blob = new Blob(['\ufeff' + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
