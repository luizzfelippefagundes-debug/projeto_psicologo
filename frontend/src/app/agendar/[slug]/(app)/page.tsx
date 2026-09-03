import Link from "next/link";
import { CalendarClock, ChevronRight, User } from "lucide-react";
import { getProfissionalPublicoServer } from "@/lib/apiPublicoServer";

export default async function AgendarHomePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const profissional = await getProfissionalPublicoServer(slug);

  return (
    <div className="mx-auto flex w-full max-w-[480px] flex-col gap-4">
      <div className="rounded-2xl border border-border bg-card p-6 shadow-[0_8px_24px_var(--color-shadow)]">
        <h1 className="text-2xl font-extrabold text-accent-dark">{profissional.nome}</h1>
        <p className="mt-1 text-[14.5px] text-muted">Agende sua consulta ou acompanhe seus horários</p>
      </div>

      <Link
        href={`/agendar/${slug}/novo`}
        className="flex items-center gap-4 rounded-2xl border border-border bg-card p-5 shadow-[0_4px_14px_var(--color-shadow)] transition-colors hover:bg-accent-soft"
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-[1.5px] border-accent text-accent-dark">
          <CalendarClock className="h-5 w-5" strokeWidth={2} />
        </span>
        <span className="flex-1 text-[15px] font-bold">Agendar horário</span>
        <ChevronRight className="h-5 w-5 shrink-0 text-muted" strokeWidth={2} />
      </Link>

      <Link
        href={`/agendar/${slug}/perfil`}
        className="flex items-center gap-4 rounded-2xl border border-border bg-card p-5 shadow-[0_4px_14px_var(--color-shadow)] transition-colors hover:bg-accent-soft"
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-[1.5px] border-accent text-accent-dark">
          <User className="h-5 w-5" strokeWidth={2} />
        </span>
        <span className="flex-1 text-[15px] font-bold">Meu perfil</span>
        <ChevronRight className="h-5 w-5 shrink-0 text-muted" strokeWidth={2} />
      </Link>
    </div>
  );
}
