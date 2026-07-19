/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // pdf-parse (leitor de PDF da folha) não pode ser empacotado pelo webpack —
    // ele precisa ser carregado direto do node_modules no servidor, senão a
    // rota /api/folha/parse quebra em produção.
    serverComponentsExternalPackages: ['pdf-parse'],
  },
};
export default nextConfig;
