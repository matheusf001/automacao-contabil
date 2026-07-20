// Rota de API — roda NO SERVIDOR, nunca no navegador.
// Recebe o PDF da folha de pagamento (Relatório de Líquidos ou Extrato
// Mensal), extrai o texto com pdfjs (via lib/pdfTexto) e devolve os
// funcionários com seus valores, prontos pra conferência na aba Folha.
// Não grava nada no banco — quem salva é o navegador, com a chave anon
// e as travas RLS de sempre.

import { extrairTextoPdf } from '@/lib/pdfTexto';
import { parseFolhaTexto } from '@/lib/folhaParser';

export const runtime = 'nodejs';
export const maxDuration = 60;

const TAMANHO_MAX = 10 * 1024 * 1024; // 10 MB

export async function POST(req) {
  try {
    const form = await req.formData();
    const arquivo = form.get('arquivo');
    if (!arquivo || typeof arquivo === 'string') {
      return Response.json({ error: 'Envie o arquivo PDF da folha.' }, { status: 400 });
    }
    if (arquivo.size > TAMANHO_MAX) {
      return Response.json({ error: 'Arquivo muito grande (máximo 10 MB).' }, { status: 400 });
    }

    const dados = new Uint8Array(await arquivo.arrayBuffer());
    let texto = '';
    try {
      texto = await extrairTextoPdf(dados);
    } catch (e) {
      console.error('folha/parse — PDF ilegível:', e);
      return Response.json({ error: 'Não consegui abrir este PDF — confira se o arquivo não está corrompido ou protegido por senha.', detalhe: String(e?.message || e) }, { status: 400 });
    }

    const folha = parseFolhaTexto(texto);
    if (folha.erro) return Response.json({ error: folha.erro }, { status: 400 });
    return Response.json({ ...folha, arquivoNome: arquivo.name || null });
  } catch (e) {
    console.error('folha/parse:', e);
    // "detalhe" ajuda a diagnosticar em produção pela aba Network do navegador
    return Response.json({ error: 'Erro inesperado ao ler o PDF — tente de novo.', detalhe: String(e?.message || e) }, { status: 500 });
  }
}
