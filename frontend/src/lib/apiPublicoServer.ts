import { cache } from "react";
import type { ProfissionalPublico } from "@/lib/apiPublico";

// Fetch direto no backend (não via rewrite "/api", que só resolve no navegador) — mesmo
// padrão de src/lib/api.ts pras buscas feitas em Server Component. cache() do React dedupa
// chamadas repetidas com o mesmo slug dentro do mesmo request (layout + page do mesmo slug
// não disparam duas buscas de rede).
const API_URL = process.env.API_URL ?? "http://localhost:8000";

export const getProfissionalPublicoServer = cache(
  async (slug: string): Promise<ProfissionalPublico> => {
    const res = await fetch(`${API_URL}/publico/profissional/${slug}`, { cache: "no-store" });
    if (!res.ok) throw new Error("Link inválido.");
    return res.json();
  }
);
