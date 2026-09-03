import type { ProfissionalPublico } from "@/lib/apiPublico";
import { AgendamentoPublicoFluxo } from "@/components/AgendamentoPublicoFluxo";

// Fetch direto no backend (não via rewrite "/api", que só resolve no navegador) —
// mesmo padrão de src/lib/api.ts pras buscas feitas em Server Component.
const API_URL = process.env.API_URL ?? "http://localhost:8000";

async function getProfissionalPublicoServer(slug: string): Promise<ProfissionalPublico> {
  const res = await fetch(`${API_URL}/publico/profissional/${slug}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Link inválido.");
  return res.json();
}

export default async function AgendarPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let profissional;
  try {
    profissional = await getProfissionalPublicoServer(slug);
  } catch {
    return (
      <div className="flex min-h-full flex-1 items-center justify-center p-6">
        <p className="text-[15px] text-muted">Link inválido ou não encontrado.</p>
      </div>
    );
  }

  return <AgendamentoPublicoFluxo slug={slug} profissional={profissional} />;
}
