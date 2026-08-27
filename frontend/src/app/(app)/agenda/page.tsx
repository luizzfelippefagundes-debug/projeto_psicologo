import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NovoLocalForm } from "@/components/NovoLocalForm";
import { AgendaGrid } from "@/components/AgendaGrid";
import { getLocais, getPacientes, getSessoesPeriodo } from "@/lib/api";
import { addDaysISO, formatDiaMesCurto, getTodayISO, getWeekDates, getWeekStart } from "@/lib/format";

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ semana?: string }>;
}) {
  const { semana } = await searchParams;
  const locais = await getLocais();

  if (locais.length === 0) {
    return (
      <div className="pl-12 md:pl-0">
        <div className="mb-7 flex items-center justify-between gap-5">
          <div>
            <h1 className="text-2xl font-extrabold">Agenda</h1>
            <p className="mt-1 text-[14.5px] text-muted">
              Cadastre um local de atendimento pra começar a ver sua agenda aqui.
            </p>
          </div>
          <ThemeToggle />
        </div>
        <div className="rounded-2xl border border-border bg-card p-6 shadow-[0_8px_24px_var(--color-shadow)]">
          <NovoLocalForm />
        </div>
      </div>
    );
  }

  const mondayISO = getWeekStart(semana);
  const weekDates = getWeekDates(mondayISO);
  const [sessoes, pacientes] = await Promise.all([
    getSessoesPeriodo(weekDates[0], weekDates[4]),
    getPacientes(),
  ]);
  const hojeISO = getTodayISO();

  const semanaAnterior = addDaysISO(mondayISO, -7);
  const proximaSemana = addDaysISO(mondayISO, 7);
  const emSemanaAtual = mondayISO === getWeekStart();

  return (
    <div className="pl-12 md:pl-0">
      <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold">Agenda</h1>
          <p className="mt-1 text-[14.5px] text-muted">
            {formatDiaMesCurto(weekDates[0])} – {formatDiaMesCurto(weekDates[6])}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/agenda"
            aria-disabled={emSemanaAtual}
            className={`rounded-xl border-[1.5px] border-accent px-3.5 py-2 text-[13px] font-extrabold text-accent-dark transition-opacity ${
              emSemanaAtual ? "pointer-events-none opacity-50" : ""
            }`}
          >
            Hoje
          </Link>
          <div className="flex overflow-hidden rounded-xl border border-border">
            <Link
              href={`/agenda?semana=${semanaAnterior}`}
              aria-label="Semana anterior"
              className="border-r border-border bg-card px-3 py-2 text-[16px] font-extrabold leading-none"
            >
              ‹
            </Link>
            <Link
              href={`/agenda?semana=${proximaSemana}`}
              aria-label="Próxima semana"
              className="bg-card px-3 py-2 text-[16px] font-extrabold leading-none"
            >
              ›
            </Link>
          </div>
          <ThemeToggle />
        </div>
      </div>

      {pacientes.length === 0 ? (
        <p className="mb-4 text-[13.5px] text-muted">
          Cadastre um paciente antes de criar sessões (ainda não tem tela pra isso — me avisa que eu
          construo).
        </p>
      ) : null}

      <AgendaGrid
        weekDates={weekDates}
        sessoes={sessoes}
        locais={locais}
        pacientes={pacientes}
        hojeISO={hojeISO}
      />
    </div>
  );
}
