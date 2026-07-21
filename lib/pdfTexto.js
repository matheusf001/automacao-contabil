// ============================================================
// EXTRAÇÃO DE TEXTO DE PDF (servidor) — usa o pdfjs-dist "legacy",
// que é JavaScript puro (sem binário nativo) e roda em qualquer
// versão de Node — inclusive no servidor da Vercel.
//
// Reconstrói as LINHAS do PDF: agrupa os pedaços de texto pela
// posição vertical (Y) e ordena pela horizontal (X), como se lê.
// ============================================================

import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.js';
// Este import resolve o erro "Cannot find module './pdf.worker.js'" na Vercel.
// Ele faz duas coisas: (1) registra globalThis.pdfjsWorker, que o pdfjs usa
// ANTES de tentar o require dinâmico do worker; (2) força o empacotador da
// Vercel a levar o arquivo do worker junto no deploy.
import 'pdfjs-dist/legacy/build/pdf.worker.js';

export async function extrairTextoPdf(uint8array) {
  const doc = await pdfjs.getDocument({
    data: uint8array,
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
  }).promise;

  const linhasTodas = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const conteudo = await page.getTextContent();
      // cada item: { str, transform: [a,b,c,d,x,y] }
      const itens = conteudo.items
        .filter(i => i.str && i.str.trim() !== '')
        .map(i => ({ texto: i.str, x: i.transform[4], y: i.transform[5] }));
      // ordena de cima pra baixo (Y desce) e da esquerda pra direita
      itens.sort((a, b) => (Math.abs(b.y - a.y) > 2 ? b.y - a.y : a.x - b.x));
      const linhas = [];
      let atual = null;
      let yAtual = null;
      for (const item of itens) {
        if (atual === null || Math.abs(item.y - yAtual) > 2) {
          if (atual !== null) linhas.push(atual);
          atual = item.texto;
          yAtual = item.y;
        } else {
          atual += ' ' + item.texto;
        }
      }
      if (atual !== null) linhas.push(atual);
      linhasTodas.push(...linhas.map(l => l.replace(/\s+/g, ' ').trim()));
    }
  } finally {
    await doc.destroy().catch(() => {});
  }
  return linhasTodas.join('\n');
}
