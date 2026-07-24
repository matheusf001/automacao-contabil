// ============================================================
// LEITOR DE EXTRATO BANCÁRIO EM PDF (servidor)
// Recebe o texto extraído do PDF (lib/pdfTexto) e devolve os
// lançamentos no formato do site: data, valor com sinal
// (negativo = débito), histórico e detalhamento.
//
// Cada banco imprime o extrato de um jeito; há um parser por
// layout conhecido: Sicredi, Santander, Itaú e Bradesco.
// ============================================================

const RE_MONEY = /-?\d{1,3}(?:\.\d{3})*,\d{2}(?!\d)/g;
const RE_DATA = /^(\d{2}\/\d{2}\/\d{4})\s*(.*)$/;

function moneyParaNumero(s) {
  return parseFloat(String(s).replace(/\./g, '').replace(',', '.'));
}
function numeroParaBR(n) {
  return Math.abs(n).toFixed(2).replace('.', ',');
}
function contarAlfanumericos(s) {
  return (String(s).match(/[A-Za-zÀ-ú0-9]/g) || []).length;
}
function limpar(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

export function detectarBanco(texto) {
  if (/Cooperativa:/i.test(texto) && /Associado:/i.test(texto)) return 'sicredi';
  if (/Internet Banking Empresarial/i.test(texto) || /\bIBPJ\b/.test(texto)) return 'santander';
  if (/itau\.com\.br/i.test(texto) || /SALDO TOTAL DISPON[IÍ]VEL DIA/i.test(texto)) return 'itau';
  if (/Extrato Mensal \/ Por Per[íi]odo/i.test(texto) || /Invest F[áa]cil/i.test(texto)) return 'bradesco';
  return null;
}

export const NOME_BANCO = { sicredi: 'Sicredi', santander: 'Santander', itau: 'Itaú', bradesco: 'Bradesco' };

// ---------- SICREDI ----------
// Uma linha por lançamento: data descrição [documento] valor saldo
function parseSicredi(linhas) {
  const out = [];
  for (const l of linhas) {
    if (/^Lan[çc]amentos Futuros/i.test(l)) break; // agendamentos não entram
    const m = l.match(RE_DATA);
    if (!m) continue;
    const resto = m[2];
    if (/SALDO ANTERIOR/i.test(resto)) continue;
    const moneys = resto.match(RE_MONEY) || [];
    if (moneys.length < 2) continue; // lançamento de verdade tem valor + saldo
    const valorStr = moneys[moneys.length - 2];
    const saldoStr = moneys[moneys.length - 1];
    const idxSaldo = resto.lastIndexOf(saldoStr);
    const idxValor = resto.lastIndexOf(valorStr, idxSaldo - 1);
    if (idxValor < 0) continue;
    let desc = limpar(resto.slice(0, idxValor));
    let detalhe = '';
    const tokens = desc.split(' ');
    const ultimo = tokens[tokens.length - 1];
    // o "documento" (COB000014, PIX_DEB, CX86088, 178581…) vira detalhamento
    if (tokens.length > 1 && ultimo.length >= 5 && /\d/.test(ultimo) && /^[A-Z0-9_.\/-]+$/i.test(ultimo)) {
      detalhe = ultimo;
      tokens.pop();
      desc = tokens.join(' ');
    }
    out.push({ data: m[1], valorNum: moneyParaNumero(valorStr), historico: desc, detalhamento: detalhe });
  }
  return out;
}

// ---------- SANTANDER e ITAÚ ----------
// O histórico quebra em até 3 pedaços: um na linha ANTERIOR à da data,
// um na própria linha e um na linha SEGUINTE. A montagem junta os três.
function parseComFragmentos(linhas, opcoes) {
  const { ehBarreira, pularLinhaData, extrairValor } = opcoes;
  const trans = [];
  let frags = [];

  const prev = () => trans[trans.length - 1] || null;
  // um histórico "curto demais" ficou pela metade e precisa da linha seguinte
  const precisaCauda = (t) => t && t.cauda.length === 0 && contarAlfanumericos(t.inline) < 14;

  // Chega numa barreira (cabeçalho/rodapé): só completa o lançamento anterior
  // se ele realmente estava pela metade — o resto é lixo de rodapé e cai fora.
  function despejarFragsNaCauda() {
    const p = prev();
    if (p && frags.length && precisaCauda(p)) p.cauda.push(frags[0]);
    frags = [];
  }

  for (const l of linhas) {
    if (ehBarreira(l)) { despejarFragsNaCauda(); continue; }
    const m = l.match(RE_DATA);
    if (!m) {
      // pedaço de histórico tem no máximo a largura da coluna; linha comprida é texto de rodapé
      if (l.length > 60) { despejarFragsNaCauda(); continue; }
      frags.push(l);
      continue;
    }
    const resto = m[2];
    if (pularLinhaData(resto)) { despejarFragsNaCauda(); continue; }
    const extraido = extrairValor(resto);
    if (!extraido) { frags.push(l); continue; } // linha com data mas sem valor: trata como texto
    const { valorNum, inline } = extraido;

    // distribui os fragmentos pendentes entre o lançamento anterior (cauda)
    // e este (cabeça)
    let cabeca = '';
    if (frags.length === 1) {
      if (precisaCauda(prev())) prev().cauda.push(frags[0]);
      else cabeca = frags[0];
    } else if (frags.length > 1) {
      cabeca = frags.pop();
      const p = prev();
      if (p) p.cauda.push(...frags);
    }
    frags = [];
    trans.push({ data: m[1], valorNum, inline, cabeca, cauda: [] });
  }
  despejarFragsNaCauda();

  return trans.map(t => ({
    data: t.data,
    valorNum: t.valorNum,
    historico: limpar([t.cabeca, t.inline, ...t.cauda].join(' ')),
    detalhamento: '',
  }));
}

function parseSantander(linhas) {
  return parseComFragmentos(linhas, {
    ehBarreira: (l) =>
      /about:blank/i.test(l) ||
      /Internet Banking/i.test(l) ||
      /^\d{2}\/\d{2}\/\d{4}, \d{2}:\d{2}/.test(l) ||       // carimbo de impressão "07/04/2026, 15:44 IBPJ"
      /^Data Hist[óo]rico/i.test(l) ||
      /Conta Corrente\s*>/i.test(l) ||
      /^Per[íi]odo:/i.test(l) ||
      /SALDO (ANTERIOR|EM|TOTAL|FINAL|DISPON)/i.test(l) ||
      /^Total\b/i.test(l) ||
      /As informa[çc][õo]es de saldo/i.test(l) ||
      /Central de Atendimento/i.test(l) ||
      /Ouvidoria/i.test(l) ||
      /santander\s*\.\s*com/i.test(l) ||
      /^\d+\/\d+$/.test(l),                                  // número de página
    pularLinhaData: (resto) => /SALDO ANTERIOR/i.test(resto),
    extrairValor: (resto) => {
      const moneys = resto.match(RE_MONEY) || [];
      if (!moneys.length) return null;
      // 1º valor é o do lançamento; um 2º valor, quando existe, é o saldo do dia
      const valorNum = moneyParaNumero(moneys[0]);
      const inline = limpar(resto.replace(RE_MONEY, ' ').replace(/\b0{6}\b/g, ' '));
      return { valorNum, inline };
    },
  });
}

function parseItau(linhas) {
  return parseComFragmentos(linhas, {
    ehBarreira: (l) =>
      /^aviso:/i.test(l) ||
      /^novos lan[çc]amentos/i.test(l) ||
      /^atualizado em/i.test(l) ||
      /Em caso de d[úu]vidas/i.test(l) ||
      /itau\.com\.br/i.test(l) ||
      /^Data Lan[çc]amentos/i.test(l) ||
      /^Lan[çc]amentos do per[íi]odo/i.test(l) ||
      /^Saldo total/i.test(l) ||
      /^R\$ /.test(l) ||
      /^Saldo da conta corrente/i.test(l) ||
      /^Descri[çc][ãa]o Valor/i.test(l) ||
      /SALDO (DISPON|EM APLICA|TOTAL|ANTERIOR)/i.test(l) ||
      /^(VALOR TOTAL|RENDIMENTOS DE|LIMITE DA CONTA|TOTAL DISPON)/i.test(l) ||
      (/CNPJ \d/.test(l) && /Ag[êe]ncia/i.test(l)),          // cabeçalho repetido a cada página
    pularLinhaData: (resto) => /SALDO ANTERIOR|SALDO TOTAL DISPON/i.test(resto),
    extrairValor: (resto) => {
      const moneys = resto.match(RE_MONEY) || [];
      if (!moneys.length) return null;
      // o valor é o último número da linha (antes dele pode vir CNPJ/CPF, que não tem vírgula)
      const valorNum = moneyParaNumero(moneys[moneys.length - 1]);
      const inline = limpar(resto.replace(RE_MONEY, ' '));
      return { valorNum, inline };
    },
  });
}

// ---------- BRADESCO ----------
// O nome do lançamento vem na linha ANTERIOR à dos números, e o
// detalhe (REM:/favorecido) na linha SEGUINTE. A data só aparece no
// primeiro lançamento do dia. Débitos vêm com sinal negativo.
function parseBradesco(linhas) {
  const RE_NUM = /^(?:(\d{2}\/\d{2}\/\d{4})\s+)?(?:(.*?)\s+)?(\d{3,10})\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})$/;
  const ehCabecalho = (l) =>
    /^Extrato Mensal/i.test(l) ||
    /^Nome do usu[áa]rio:/i.test(l) ||
    /^Data da opera[çc][ãa]o:/i.test(l) ||
    /^Folha \d+\/\d+/i.test(l) ||
    /CNPJ:/i.test(l) ||
    /^Data Lan[çc]amento/i.test(l) ||
    /^Extrato de:/i.test(l) ||
    /Investimento sem Baixa/i.test(l) ||
    /Total Dispon[íi]vel/i.test(l) ||
    /^\(B\)/.test(l) ||
    /^Ag[êe]ncia Conta/i.test(l) ||
    /SALDO ANTERIOR/i.test(l) ||
    /^Os dados acima/i.test(l);

  const trans = [];
  let frags = [];
  let dataAtual = null;

  for (const l of linhas) {
    if (/^Saldos Invest F/i.test(l)) break;        // seção de saldos de aplicação: fim dos lançamentos
    if (/^Total\s+-?\d/.test(l) || /^Total\s+-?\d{1,3}(?:\.\d{3})*,\d{2}/.test(l)) { frags = []; continue; }
    if (ehCabecalho(l)) continue;                   // cabeçalho repetido não zera os fragmentos (vira de página)
    const m = l.match(RE_NUM);
    if (!m) { frags.push(l); continue; }
    const [, dataNova, inline, doc, valorStr] = m;
    if (dataNova) dataAtual = dataNova;
    if (!dataAtual) { frags = []; continue; }

    const anterior = trans[trans.length - 1] || null;
    let cabeca = '';
    if (frags.length) {
      if (limpar(inline || '')) {
        // a linha já tem o nome do lançamento: os fragmentos são detalhe do anterior
        if (anterior) anterior.detalhes.push(...frags);
      } else {
        cabeca = frags.pop();
        if (anterior && frags.length) anterior.detalhes.push(...frags);
      }
      frags = [];
    }
    trans.push({
      data: dataAtual,
      valorNum: moneyParaNumero(valorStr),
      historico: limpar([cabeca, inline || ''].join(' ')),
      doc,
      detalhes: [],
    });
  }
  if (frags.length && trans.length) trans[trans.length - 1].detalhes.push(...frags);

  return trans.map(t => ({
    data: t.data,
    valorNum: t.valorNum,
    historico: t.historico || 'LANÇAMENTO',
    detalhamento: limpar([...t.detalhes, t.doc ? 'doc ' + t.doc : ''].join(' ')),
  }));
}

// ---------- PONTO DE ENTRADA ----------
export function parseExtratoPdfTexto(texto) {
  const banco = detectarBanco(texto);
  if (!banco) {
    return {
      erro: 'Não reconheci o layout deste PDF. Por enquanto leio extratos do Sicredi, Santander, Itaú e Bradesco — para outros bancos, converta em OFX (ex.: ofxfacil.com.br) e envie o .ofx.',
    };
  }
  const linhas = texto.split('\n').map(l => l.trim()).filter(Boolean);
  const parsers = { sicredi: parseSicredi, santander: parseSantander, itau: parseItau, bradesco: parseBradesco };
  const rows = parsers[banco](linhas).filter(r => r.valorNum !== 0 && isFinite(r.valorNum));
  if (rows.length === 0) {
    return { erro: `O PDF parece ser do ${NOME_BANCO[banco]}, mas não encontrei lançamentos nele — confira se é o extrato do período (não um comprovante) e me avise se persistir.` };
  }
  // formato de linha que o site já entende (mesmo do OFX): data ⇥ valor ⇥ histórico ⇥ detalhe
  const linhasSite = rows.map(r => {
    const valorBR = (r.valorNum < 0 ? '-' : '') + numeroParaBR(r.valorNum);
    return `${r.data}\t${valorBR}\t${(r.historico || '').replace(/\t/g, ' ')}\t${(r.detalhamento || '').replace(/\t/g, ' ')}`;
  });
  return { banco, nomeBanco: NOME_BANCO[banco], quantidade: rows.length, linhas: linhasSite };
}
