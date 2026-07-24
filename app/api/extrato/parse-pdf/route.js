// Rota de API — roda NO SERVIDOR, nunca no navegador.
// Recebe o PDF do extrato bancário, extrai o texto com pdfjs
// (lib/pdfTexto) e devolve os lançamentos no formato que a aba
// Extrato já entende (mesmo formato do OFX: data ⇥ valor ⇥
// histórico ⇥ detalhe, com valor negativo = débito).
// Não grava nada no banco — quem confirma e salva é o usuário.

import { extrairTextoPdf } from '@/lib/pdfTexto';
import { parseExtratoPdfTexto } from '@/lib/extratoPdfParser';

export const runtime = 'nodejs';
export const maxDuration = 60;

const TAMANHO_MAX = 15 * 1024 * 1024; // 15 MB

export async function POST(req) {
  try {
    const form = await req.formData();
    const arquivo = form.get('arquivo');
    if (!arquivo || typeof arquivo === 'string') {
      return Response.json({ error: 'Envie o arquivo PDF do extrato.' }, { status: 400 });
    }
    if (arquivo.size > TAMANHO_MAX) {
      return Response.json({ error: 'Arquivo muito grande (máximo 15 MB).' }, { status: 400 });
    }

    const dados = new Uint8Array(await arquivo.arrayBuffer());
    let texto = '';
    try {
      texto = await extrairTextoPdf(dados);
    } catch (e) {
      console.error('extrato/parse-pdf — PDF ilegível:', e);
      return Response.json({ error: 'Não consegui abrir este PDF — confira se o arquivo não está corrompido ou protegido por senha.', detalhe: String(e?.message || e) }, { status: 400 });
    }

    const resultado = parseExtratoPdfTexto(texto);
    if (resultado.erro) return Response.json({ error: resultado.erro }, { status: 400 });
    return Response.json({ ...resultado, arquivoNome: arquivo.name || null });
  } catch (e) {
    console.error('extrato/parse-pdf:', e);
    return Response.json({ error: 'Erro inesperado ao ler o PDF — tente de novo.', detalhe: String(e?.message || e) }, { status: 500 });
  }
}
