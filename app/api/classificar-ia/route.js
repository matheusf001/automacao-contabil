// Rota de API — roda NO SERVIDOR (Vercel), nunca no navegador.
// A chave da Anthropic fica na variável de ambiente ANTHROPIC_API_KEY,
// que NÃO tem o prefixo NEXT_PUBLIC de propósito: assim ela nunca é
// enviada ao navegador de ninguém.
//
// O que ela faz: recebe os lançamentos "sem match" + o plano de contas
// (só as contas Analíticas DA EMPRESA ATIVA) + regras e exemplos já
// confirmados da MESMA empresa, e pede à Claude uma sugestão de conta
// para cada lançamento. A IA só pode responder com contas dessa lista —
// e ainda validamos isso aqui antes de devolver ao navegador.

export const maxDuration = 60; // dá até 60s pra IA responder (limite Vercel)

const MODELO = 'claude-haiku-4-5-20251001'; // rápido e barato — bom p/ classificação

export async function POST(req) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return Response.json({ error: 'A chave da IA (ANTHROPIC_API_KEY) não está configurada no servidor. Configure em Settings → Environment Variables no Vercel.' }, { status: 500 });
    }

    const { lancamentos, contas, regras, exemplos } = await req.json();
    if (!Array.isArray(lancamentos) || lancamentos.length === 0) {
      return Response.json({ error: 'Nenhum lançamento enviado para classificar.' }, { status: 400 });
    }
    if (!Array.isArray(contas) || contas.length === 0) {
      return Response.json({ error: 'O plano de contas da empresa está vazio — importe o plano antes de usar a IA.' }, { status: 400 });
    }

    // Limites de segurança (controle de custo por chamada)
    const lote = lancamentos.slice(0, 60);
    const listaContas = contas.slice(0, 900).map(c => `${c.codigo} | ${c.descricao}`).join('\n');
    const listaRegras = (regras || []).slice(0, 80).map(r => `"${r.palavra_chave}" → conta ${r.codigo}`).join('\n');
    const listaExemplos = (exemplos || []).slice(0, 50).map(e => `"${e.texto}" → conta ${e.codigo}`).join('\n');
    const listaLanc = lote.map(l =>
      `${l.id} | ${l.data} | ${l.cd === 'D' ? 'SAÍDA (pagamento)' : 'ENTRADA (recebimento)'} | R$ ${l.valor} | ${l.historico}${l.detalhamento ? ' — ' + l.detalhamento : ''}`
    ).join('\n');

    const prompt = `Você é um assistente de contabilidade brasileira. Sua tarefa: para cada lançamento de extrato bancário abaixo, sugerir a conta contábil de CONTRAPARTIDA (a conta de despesa/receita/fornecedor/cliente — a conta do banco já é conhecida).

REGRAS OBRIGATÓRIAS:
1. Use SOMENTE códigos da lista "PLANO DE CONTAS DA EMPRESA" abaixo. Nunca invente um código.
2. Cada empresa tem seu próprio padrão de contas — as regras e os exemplos abaixo mostram como ESTA empresa costuma classificar. Siga esse padrão sempre que possível.
3. SAÍDA (pagamento) normalmente vai para conta de despesa/custo/fornecedor. ENTRADA (recebimento) normalmente vai para conta de receita/cliente.
4. Se não tiver confiança razoável em um lançamento, simplesmente NÃO o inclua na resposta.
5. Responda APENAS com um array JSON, sem nenhum texto antes ou depois, no formato:
[{"id": 0, "codigo": 123, "confianca": 85, "motivo": "frase curta explicando"}]
"confianca" é um número de 0 a 100.

PLANO DE CONTAS DA EMPRESA (código | descrição):
${listaContas}

REGRAS JÁ CADASTRADAS PELA EMPRESA (palavra-chave → conta):
${listaRegras || '(nenhuma)'}

EXEMPLOS DE CLASSIFICAÇÕES JÁ CONFIRMADAS DESTA EMPRESA (texto → conta):
${listaExemplos || '(nenhum ainda)'}

LANÇAMENTOS PARA CLASSIFICAR (id | data | tipo | valor | histórico):
${listaLanc}`;

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || MODELO,
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!resp.ok) {
      const corpo = await resp.text();
      let msg = `Erro da API da Anthropic (código ${resp.status}).`;
      if (resp.status === 401) msg = 'Chave da IA inválida — confira a ANTHROPIC_API_KEY no Vercel.';
      if (resp.status === 429) msg = 'Limite de uso da IA atingido — aguarde um pouco e tente de novo.';
      console.error('Anthropic error:', resp.status, corpo.slice(0, 500));
      return Response.json({ error: msg }, { status: 502 });
    }

    const data = await resp.json();
    const texto = (data.content || []).map(b => b.text || '').join('');

    let sugestoes;
    try {
      const m = texto.match(/\[[\s\S]*\]/); // pega só o array JSON, mesmo se vier texto em volta
      sugestoes = JSON.parse(m ? m[0] : texto);
    } catch {
      console.error('Resposta inesperada da IA:', texto.slice(0, 500));
      return Response.json({ error: 'A IA respondeu num formato inesperado. Tente processar de novo.' }, { status: 502 });
    }

    // Validação final: só aceita códigos que existem no plano enviado (da empresa ativa)
    const codigosValidos = new Set(contas.map(c => String(c.codigo)));
    const limpas = (Array.isArray(sugestoes) ? sugestoes : [])
      .filter(s => s && s.id !== undefined && s.codigo !== undefined && codigosValidos.has(String(s.codigo)))
      .map(s => ({
        id: Number(s.id),
        codigo: s.codigo,
        confianca: Math.max(0, Math.min(100, Math.round(Number(s.confianca) || 0))),
        motivo: String(s.motivo || '').slice(0, 200),
      }));

    return Response.json({ sugestoes: limpas });
  } catch (err) {
    console.error(err);
    return Response.json({ error: 'Erro interno ao chamar a IA: ' + err.message }, { status: 500 });
  }
}
