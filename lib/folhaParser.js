// ============================================================
// PARSER DOS PDFs DE FOLHA DE PAGAMENTO (sistema de folha → site)
// Recebe o TEXTO já extraído do PDF (lib/pdfTexto.js faz a extração,
// em ordem natural de leitura) e devolve os funcionários com valores.
//
// Formatos aceitos:
//  - "Relação Geral dos Líquidos"  → código, nome, líquido, data de pagamento
//  - "Extrato Mensal"              → código, nome, CPF, cargo, proventos,
//                                    descontos, líquido, férias
// ============================================================

function parseValorBR(s) {
  if (!s) return null;
  const n = parseFloat(String(s).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function dataBRparaISO(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s || '').trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

const RE_MOEDA = /\d{1,3}(?:\.\d{3})*,\d{2}/g;

function extrairCabecalho(texto) {
  const competencia =
    (/Compet[êe]ncia:\s*(\d{2}\/\d{4})/.exec(texto) || [])[1] ||
    (/^(\d{2}\/20\d{2})$/m.exec(texto) || [])[1] || null;
  const cnpj = (/\b(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\b/.exec(texto) || [])[1] || null;
  const tipoCalculo = (((/C[áa]lculo:\s*(.+)/.exec(texto) || [])[1] || '').split(/\s+Horas?:/)[0] || '').trim() || null;
  // "Empresa: [780 - ]NOME [Página: 1/6]" — corta o que vier depois de "Página:"
  let empresaNome = ((/^Empresa:\s*(?:\d+\s*-\s*)?(\S[^\n]*)/m.exec(texto) || [])[1] || '').trim() || null;
  if (empresaNome) empresaNome = empresaNome.split(/\s+P[áa]gina:/)[0].trim() || null;
  if (empresaNome && /^(Compet[êe]ncia|CNPJ|C[áa]lculo|P[áa]gina)/i.test(empresaNome)) empresaNome = null;
  return { competencia, cnpj, tipoCalculo, empresaNome };
}

// linha: "30 ADRIANA ARAUJO BRAGA VILANOVA 666875863 1.463,85 30/06/2026"
// (tolerante à ordem: acha a data e o valor onde estiverem na linha)
function parseLiquidos(texto) {
  const itens = [];
  for (const linha of texto.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+([A-ZÀ-Ú].*)$/.exec(linha.trim());
    if (!m) continue;
    const resto = m[2];
    if (/Total da Empresa/i.test(resto)) continue;
    const data = (/(\d{2}\/\d{2}\/\d{4})/.exec(resto) || [])[1] || null;
    const moedas = resto.match(RE_MOEDA) || [];
    if (!data || moedas.length === 0) continue; // linha de funcionário tem data E valor
    // nome = tokens do início até aparecer o primeiro token com dígito
    const tokens = resto.split(/\s+/);
    const nomeTokens = [];
    for (const t of tokens) { if (/\d/.test(t)) break; nomeTokens.push(t); }
    if (nomeTokens.length === 0) continue;
    const valor = moedas[moedas.length - 1];
    const identidade = tokens.find(t => /^\d{5,}$/.test(t) && !t.includes('/')) || null;
    itens.push({
      codigo: parseInt(m[1], 10),
      nome: nomeTokens.join(' ').trim(),
      identidade,
      valorLiquido: parseValorBR(valor),
      dataPagamento: dataBRparaISO(data),
    });
  }
  return itens;
}

function parseExtratoMensal(texto) {
  const itens = [];
  const avisos = [];
  const linhas = texto.split(/\r?\n/);
  // "Empr.: 30 ADRIANA ARAUJO BRAGA VILANOVA Situação: Trabalhando CPF: 908.984.865-72 Adm: ..."
  const reFunc = /Empr\.?:\s*(\d+)\s*(.+?)\s+Situa[çc][ãa]o:/;
  const reCPF = /(\d{3}\.\d{3}\.\d{3}-\d{2})/;
  // "Cargo: 15 COORD ADM C.B.O: 410105 ..."
  const reCargo = /Cargo:\s*(?:\d+\s*)?(.+?)\s+C\.B\.O/;
  const reFerias = /F[ÉE]RIAS DE\s+(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})/;

  let atual = null;    // funcionário cujo bloco está sendo lido
  let ultimo = null;   // último funcionário fechado (pra anexar a linha de férias)

  for (const linha of linhas) {
    const mFunc = reFunc.exec(linha);
    if (mFunc) {
      atual = {
        codigo: parseInt(mFunc[1], 10),
        nome: mFunc[2].trim(),
        cpf: (reCPF.exec(linha) || [])[1] || null,
        cargo: null,
        proventos: null, descontos: null, valorLiquido: null,
        dataPagamento: null, observacao: null,
      };
      continue;
    }
    const alvoFerias = atual || ultimo;
    const mFer = alvoFerias && reFerias.exec(linha);
    if (mFer) { alvoFerias.observacao = `Férias de ${mFer[1]} a ${mFer[2]}`; continue; }
    if (!atual) continue;

    const mCargo = reCargo.exec(linha);
    if (mCargo) { atual.cargo = mCargo[1].trim(); continue; }

    // linha de totais: "ND: 0 Proventos: X Descontos: Y ... Líquido: Z"
    if (/^ND:\s*\d/.test(linha.trim()) && linha.includes('Proventos:')) {
      atual.proventos = parseValorBR((/Proventos:\s*([\d.]+,\d{2})/.exec(linha) || [])[1]);
      atual.descontos = parseValorBR((/Descontos:\s*([\d.]+,\d{2})/.exec(linha) || [])[1]);
      const liquidoImpresso = parseValorBR((/L[íi]quido:\s*([\d.]+,\d{2})/.exec(linha) || [])[1]);
      const calculado = (atual.proventos != null && atual.descontos != null)
        ? Math.round((atual.proventos - atual.descontos) * 100) / 100 : null;
      atual.valorLiquido = liquidoImpresso ?? calculado;
      if (liquidoImpresso != null && calculado != null && Math.abs(calculado - liquidoImpresso) > 0.011) {
        avisos.push(`Confira o líquido de ${atual.nome}: proventos - descontos dá ${calculado.toFixed(2)}, mas o PDF imprime ${liquidoImpresso.toFixed(2)}.`);
      }
      if (atual.valorLiquido != null) { itens.push(atual); ultimo = atual; }
      atual = null;
    }
  }
  return { itens, avisos };
}

export function parseFolhaTexto(texto) {
  const t = String(texto || '');
  if (!t.trim()) return { erro: 'O PDF não tem texto legível — se for um arquivo escaneado (foto), gere o PDF direto no sistema de folha.' };

  const ehLiquidos = /RELA[ÇC][ÃA]O GERAL DOS L[ÍI]QUIDOS/i.test(t);
  const ehExtrato = /EXTRATO MENSAL/i.test(t);
  if (!ehLiquidos && !ehExtrato) {
    return { erro: 'Não reconheci este PDF. Envie o "Relatório de Líquidos" ou o "Extrato Mensal" gerado pelo sistema de folha.' };
  }

  const cab = extrairCabecalho(t);
  let itens = [];
  const avisos = [];

  if (ehLiquidos) {
    itens = parseLiquidos(t);
  } else {
    const r = parseExtratoMensal(t);
    itens = r.itens;
    avisos.push(...r.avisos);
  }

  if (itens.length === 0) {
    return { erro: 'Reconheci o tipo do relatório, mas não achei nenhum funcionário nele — me avise que eu ajusto o leitor pra esse arquivo.' };
  }

  const totalLiquido = Math.round(itens.reduce((s, i) => s + (i.valorLiquido || 0), 0) * 100) / 100;

  // conferência com o "Total da Empresa" impresso no PDF (quando presente)
  const linhaTotal = t.split(/\r?\n/).find(l => l.includes('Total da Empresa'));
  if (linhaTotal) {
    const decimais = linhaTotal.match(RE_MOEDA) || [];
    const totalImpresso = parseValorBR(decimais[decimais.length - 1]);
    if (totalImpresso != null && Math.abs(totalImpresso - totalLiquido) > 0.011) {
      avisos.push(`A soma dos líquidos (${totalLiquido.toFixed(2)}) difere do total impresso no PDF (${totalImpresso.toFixed(2)}) — confira antes de salvar.`);
    }
  }

  return {
    origem: ehLiquidos ? 'liquidos' : 'extrato_mensal',
    ...cab,
    itens,
    totalLiquido,
    qtdFuncionarios: itens.length,
    avisos,
  };
}
