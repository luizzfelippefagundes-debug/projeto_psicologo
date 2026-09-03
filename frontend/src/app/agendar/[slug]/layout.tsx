import { AgendarShell } from "@/components/AgendarShell";
import { getProfissionalPublicoServer } from "@/lib/apiPublicoServer";

export default async function AgendarLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  let profissional;
  try {
    profissional = await getProfissionalPublicoServer(slug);
  } catch {
    return (
      <div className="flex min-h-dvh flex-1 items-center justify-center bg-[var(--color-bg)] p-6">
        <p className="text-[15px] text-muted">Link inválido ou não encontrado.</p>
      </div>
    );
  }

  return (
    <AgendarShell slug={slug} nomeProfissional={profissional.nome}>
      {children}
    </AgendarShell>
  );
}
