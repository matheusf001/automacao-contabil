/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // pdfjs-dist (leitor de PDF da folha) não pode ser empacotado pelo webpack —
    // ele precisa ser carregado direto do node_modules no servidor, senão a
    // rota /api/folha/parse quebra em produção.
    serverComponentsExternalPackages: ['pdfjs-dist'],
  },
  // quem tiver o endereço antigo salvo nos favoritos cai na página nova
  async redirects() {
    return [
      { source: '/dashboard', destination: '/pagina-inicial', permanent: true },
    ];
  },
};
export default nextConfig;
