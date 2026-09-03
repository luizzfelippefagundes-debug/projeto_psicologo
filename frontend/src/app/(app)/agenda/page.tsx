import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NovoLocalForm } from "@/components/NovoLocalForm";
import { AgendaList } from "@/components/AgendaList";
import { AgendaDatePicker } from "@/components/AgendaDatePicker";
import { getBloqueios, getLocais, getPacientes, getSessoesPeriodo } from "@/lib/api";
import { addDaysISO, getTodayISO } from "@/lib/format";

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ data?: string }>;
}) {
  const { data } = await searchParams;
  const locais = await getLocais();

  if (locais.length === 0) {
    return (
      <div>
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

  const hojeISO = getTodayISO();
  const diaISO = data ?? hojeISO;
  const diaAnterior = addDaysISO(diaISO, -1);
  const diaSeguinte = addDaysISO(diaISO, 1);
  const ehHoje = diaISO === hojeISO;
  const [sessoes, bloqueios, pacientes] = await Promise.all([
    getSessoesPeriodo(diaISO, diaISO),
    getBloqueios(diaISO, diaISO),
    getPacientes(),
  ]);

  return (
    <div>
      <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-extrabold">Agenda</h1>
        <div className="flex items-center gap-2">
          <Link
            href={`/agenda?data=${diaAnterior}`}
            aria-label="Dia anterior"
            className="flex h-9 w-9 items-center justify-center rounded-full border-[1.5px] border-border bg-card"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={2.5} />
          </Link>
          <AgendaDatePicker diaSelecionadoISO={diaISO} />
          <Link
            href={`/agenda?data=${diaSeguinte}`}
            aria-label="Próximo dia"
            className="flex h-9 w-9 items-center justify-center rounded-full border-[1.5px] border-border bg-card"
          >
            <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
          </Link>
          <Link
            href="/agenda"
            aria-disabled={ehHoje}
            className={`ml-1 rounded-xl px-3.5 py-2 text-[13px] font-extrabold text-accent-dark transition-opacity ${
              ehHoje ? "pointer-events-none opacity-50" : "hover:bg-accent-soft"
            }`}
          >
            Hoje
          </Link>
          <ThemeToggle />
        </div>
      </div>

      {pacientes.length === 0 ? (
        <p className="mb-4 text-[13.5px] text-muted">
          Cadastre um paciente antes de criar sessões (ainda não tem tela pra isso — me avisa que eu
          construo).
        </p>
      ) : null}

      <AgendaList
        diaISO={diaISO}
        sessoes={sessoes}
        bloqueios={bloqueios}
        locais={locais}
        pacientes={pacientes}
      />
    </div>
  );
}
