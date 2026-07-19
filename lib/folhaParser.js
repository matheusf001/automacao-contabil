// ============================================================
// PARSER DOS PDFs DE FOLHA DE PAGAMENTO (sistema de folha → site)
// Recebe o TEXTO já extraído do PDF (a rota /api/folha/parse faz a
// extração) e devolve os funcionários com seus valores.
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

function extrairCabecalho(texto) {
  const competencia =
    (/Compet[êe]ncia:\s*(\d{2}\/\d{4})/.exec(texto) || [])[1] ||
    (/^(\d{2}\/20\d{2})$/m.exec(texto) || [])[1] || null;
  const cnpj = (/\b(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\b/.exec(texto) || [])[1] || null;
  const tipoCalculo = ((/C[áa]lculo:\s*(.+)/.exec(texto) || [])[1] || '').trim() || null;
  // "Empresa: NOME" na mesma linha, ou (no Extrato Mensal) "780 - NOME" em linha própria
  let empresaNome = ((/^Empresa:[ \t]*(?:\d+\s*-\s*)?(\S[^\n]*)/m.exec(texto) || [])[1] || '').trim() || null;
  if (!empresaNome || /^(Compet[êe]ncia|CNPJ|C[áa]lculo|P[áa]gina)/i.test(empresaNome)) {
    empresaNome = ((/^\d+\s*-\s*([A-ZÀ-Ú][^\n]+)$/m.exec(texto) || [])[1] || '').trim() || null;
  }
  return { competencia, cnpj, tipoCalculo, empresaNome };
}

function parseLiquidos(texto) {
  const itens = [];
  // linha: "30 ADRIANA ARAUJO BRAGA VILANOVA 30/06/2026  1.463,85  666875863"
  const reLinha = /^\s*(\d+)\s+(.+?)\s+(\d{2}\/\d{2}\/\d{4})\s+([\d.]+,\d{2})\s+(\S+)\s*$/;
  for (const linha of texto.split(/\r?\n/)) {
    const m = reLinha.exec(linha);
    if (!m) continue;
    itens.push({
      codigo: parseInt(m[1], 10),
      nome: m[2].trim(),
      dataPagamento: dataBRparaISO(m[3]),
      valorLiquido: parseValorBR(m[4]),
      identidade: m[5],
    });
  }
  return itens;
}

function parseExtratoMensal(texto) {
  const itens = [];
  const avisos = [];
  const linhas = texto.split(/\r?\n/);
  // cabeçalho do funcionário: "30 ADRIANA ARAUJO BRAGA VILANOVA  Empr.: ..."
  const reFunc = /^\s*(\d+)\s+(.+?)\s+Empr\.:/;
  const reCPF = /(\d{3}\.\d{3}\.\d{3}-\d{2})/;
  const reCargo = /Cargo:\s*\d+\s+(.+?)\s+[\d.]+,\d{2}/;
  const reFerias = /^F[ÉE]RIAS DE\s+(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})/;

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
    if (!atual) {
      // linha de férias vem DEPOIS do bloco do funcionário
      const mFer = ultimo && reFerias.exec(linha.trim());
      if (mFer) ultimo.observacao = `Férias de ${mFer[1]} a ${mFer[2]}`;
      continue;
    }
    const mCargo = reCargo.exec(linha);
    if (mCargo) { atual.cargo = mCargo[1].trim(); continue; }

    // linha de totais do funcionário: "ND: 0 Proventos: X ... Descontos: Y ... <líquido>"
    if (/^ND:\s*\d/.test(linha.trim()) && linha.includes('Proventos:')) {
      atual.proventos = parseValorBR((/Proventos:\s*([\d.]+,\d{2})/.exec(linha) || [])[1]);
      atual.descontos = parseValorBR((/Descontos:\s*([\d.]+,\d{2})/.exec(linha) || [])[1]);
      // o líquido é proventos - descontos; o último número da linha serve de conferência
      const decimais = linha.match(/[\d.]+,\d{2}/g) || [];
      const ultimoValor = parseValorBR(decimais[decimais.length - 1]);
      if (atual.proventos != null && atual.descontos != null) {
        atual.valorLiquido = Math.round((atual.proventos - atual.descontos) * 100) / 100;
        if (ultimoValor != null && Math.abs(atual.valorLiquido - ultimoValor) > 0.011) {
          avisos.push(`Confira o líquido de ${atual.nome}: calculado ${atual.valorLiquido.toFixed(2)}, impresso ${ultimoValor.toFixed(2)}.`);
        }
      } else {
        atual.valorLiquido = ultimoValor;
      }
      itens.push(atual);
      ultimo = atual;
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
    const decimais = linhaTotal.match(/[\d.]+,\d{2}/g) || [];
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
