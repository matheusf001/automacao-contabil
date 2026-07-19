// ============================================================
// CRUZAMENTO EXTRATO BANCÁRIO × FOLHA DE PAGAMENTO (Fase 2)
// Reconhece nos débitos do extrato:
//  1. pagamento individual  → nome do funcionário + valor líquido da folha
//  2. pagamento em lote     → valor igual ao TOTAL de uma folha (SISPAG etc.)
//  3. só o nome             → vira contexto pro usuário e pra IA
//     (valor não bate — pode ser adiantamento ou pagamento parcial)
// ============================================================

function semAcento(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function valorNum(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const n = parseFloat(String(v ?? '').replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, ''));
  return isFinite(n) ? n : null;
}

const STOPWORDS = new Set(['DA', 'DE', 'DO', 'DOS', 'DAS', 'E']);

export function tokensDeNome(nome) {
  return semAcento(nome).toUpperCase().split(/[^A-Z]+/).filter(t => t.length >= 2 && !STOPWORDS.has(t));
}

// O banco costuma TRUNCAR o fim do nome ("RIAN RICARDO SAMPAIO SANT"),
// então um token do extrato também casa se for o COMEÇO de um token do
// nome (mínimo 4 letras pra não casar por acaso).
function tokenCasa(tokensTexto, tokenNome) {
  return tokensTexto.some(tt => tt === tokenNome || (tt.length >= 4 && tokenNome.startsWith(tt)));
}

export function nomeApareceNoTexto(tokensTexto, nomeFuncionario) {
  const tokensNome = tokensDeNome(nomeFuncionario);
  if (tokensNome.length === 0) return false;
  if (!tokenCasa(tokensTexto, tokensNome[0])) return false; // primeiro nome é obrigatório
  // além do primeiro nome, exige 2 pedaços do resto do nome (ou todos, se o
  // nome for curto) — "ANTONIO ... SANTOS" sozinho casaria homônimos demais
  const resto = tokensNome.slice(1);
  const necessarios = Math.min(2, resto.length);
  return resto.filter(tn => tokenCasa(tokensTexto, tn)).length >= necessarios;
}

// Que tipo de pagamento é este item da folha? (define a conta contábil)
export function eventoDoItem(item) {
  if (item?.observacao && /f[ée]rias/i.test(item.observacao)) return 'ferias';
  const tc = item?.tipo_calculo || '';
  if (/rescis/i.test(tc)) return 'rescisao';
  if (/13|d[ée]cimo/i.test(tc)) return 'decimo';
  if (/f[ée]rias/i.test(tc)) return 'ferias';
  return 'salario';
}

export function contaParaEvento(config, evento) {
  if (!config) return null;
  const mapa = { salario: 'conta_salario', ferias: 'conta_ferias', rescisao: 'conta_rescisao', decimo: 'conta_decimo' };
  return config[mapa[evento]] || config.conta_salario || null;
}

export const NOME_EVENTO = { salario: 'salário', ferias: 'férias', rescisao: 'rescisão', decimo: '13º salário' };

// dadosFolha = {
//   itens:        folha_itens + competencia/tipo_calculo da folha,
//   funcionarios: cadastro de funcionários da empresa,
//   totais:       folhas (id, competencia, tipo_calculo, total_liquido),
// }
export function cruzarComFolha(row, dadosFolha) {
  if (!dadosFolha || row.cd !== 'D') return null; // só saídas (pagamentos)
  const valor = valorNum(row.valor);
  if (valor === null) return null;
  const alvo = Math.abs(valor);
  const texto = semAcento((row.historico || '') + ' ' + (row.detalhamento || '')).toUpperCase();
  const tokensTexto = texto.split(/[^A-Z0-9]+/).filter(Boolean);

  // 1) pagamento individual: valor líquido igual + nome do funcionário no histórico
  const mesmoValor = (dadosFolha.itens || []).filter(i => Math.abs((Number(i.valor_liquido) || 0) - alvo) <= 0.01);
  const comNome = mesmoValor.filter(i => nomeApareceNoTexto(tokensTexto, i.nome));
  if (comNome.length === 1) {
    const item = comNome[0];
    return { tipo: 'funcionario', item, evento: eventoDoItem(item) };
  }
  // dois funcionários com mesmo nome E mesmo líquido: ambíguo — não classifica

  // 2) pagamento em lote: valor igual ao total de uma folha.
  //    Com palavra típica (FOLHA/SISPAG/SALARIO) classifica; sem ela, só anota.
  const totais = (dadosFolha.totais || []).filter(f => Math.abs((Number(f.total_liquido) || 0) - alvo) <= 0.02);
  if (totais.length > 0) {
    const folha = totais[0];
    const temPalavraFolha = /(FOLHA|SISPAG|SALARIO)/.test(texto);
    return {
      tipo: temPalavraFolha ? 'total' : 'total_suspeito',
      folha,
      evento: eventoDoItem({ tipo_calculo: folha.tipo_calculo }),
    };
  }

  // 3) só o nome (valor diferente): contexto — pode ser adiantamento/parcial
  const funcs = (dadosFolha.funcionarios || []).filter(f => nomeApareceNoTexto(tokensTexto, f.nome));
  if (funcs.length === 1) return { tipo: 'nome', funcionario: funcs[0] };

  return null;
}

// Frase curta usada no selo da tabela e como contexto pra IA
export function descreverRefFolha(ref) {
  if (!ref) return '';
  if (ref.tipo === 'funcionario') {
    const comp = ref.item.competencia ? ` (folha ${ref.item.competencia})` : '';
    return `pagamento de ${NOME_EVENTO[ref.evento] || 'salário'} — ${ref.item.nome}${comp}`;
  }
  if (ref.tipo === 'total' || ref.tipo === 'total_suspeito') {
    return `valor igual ao total da folha ${ref.folha.competencia} (${ref.folha.qtd_funcionarios || '?'} funcionários)`;
  }
  if (ref.tipo === 'nome') {
    const cargo = ref.funcionario.cargo ? ` (${ref.funcionario.cargo})` : '';
    return `funcionário da empresa: ${ref.funcionario.nome}${cargo} — valor não bate com o líquido (adiantamento? parcial?)`;
  }
  return '';
}
