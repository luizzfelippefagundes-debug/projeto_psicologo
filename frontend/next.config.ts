import type { NextConfig } from "next";

const API_URL = process.env.API_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        // o navegador chama /api/* no próprio domínio do site — a Vercel repassa pro
        // backend por trás dos panos, fazendo o cookie de sessão nascer no mesmo domínio
        // do front (senão o navegador recusa o cookie cross-site em páginas renderizadas no servidor)
        source: "/api/:path*",
        destination: `${API_URL}/:path*`,
      },
    ];
  },
};

export default nextConfig;
