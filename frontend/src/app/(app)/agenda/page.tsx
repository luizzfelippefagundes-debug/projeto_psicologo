import { ThemeToggle } from "@/components/ThemeToggle";
import { NovoLocalForm } from "@/components/NovoLocalForm";
import { AgendaList } from "@/components/AgendaList";
import { AgendaDatePicker } from "@/components/AgendaDatePicker";
import { getLocais, getPacientes, getSessoesPeriodo } from "@/lib/api";
import { getTodayISO } from "@/lib/format";

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

  const diaISO = data ?? getTodayISO();
  const [sessoes, pacientes] = await Promise.all([
    getSessoesPeriodo(diaISO, diaISO),
    getPacientes(),
  ]);

  return (
    <div>
      <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-extrabold">Agenda</h1>
        <div className="flex items-center gap-3">
          <AgendaDatePicker diaSelecionadoISO={diaISO} />
          <ThemeToggle />
        </div>
      </div>

      {pacientes.length === 0 ? (
        <p className="mb-4 text-[13.5px] text-muted">
          Cadastre um paciente antes de criar sessões (ainda não tem tela pra isso — me avisa que eu
          construo).
        </p>
      ) : null}

      <AgendaList diaISO={diaISO} sessoes={sessoes} locais={locais} pacientes={pacientes} />
    </div>
  );
}
