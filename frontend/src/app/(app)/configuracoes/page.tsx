import { ThemeToggle } from "@/components/ThemeToggle";
import { NovoLocalForm } from "@/components/NovoLocalForm";
import { RegrasHorarioManager } from "@/components/RegrasHorarioManager";
import { GoogleCalendarConexao } from "@/components/GoogleCalendarConexao";
import { getGoogleStatus, getLocais, getRegrasHorario } from "@/lib/api";

export default async function ConfiguracoesPage() {
  const [locais, regras, googleStatus] = await Promise.all([
    getLocais(),
    getRegrasHorario(),
    getGoogleStatus(),
  ]);

  return (
    <div className="pl-12 md:pl-0">
      <div className="mb-7 flex items-center justify-between gap-5">
        <div>
          <h1 className="text-2xl font-extrabold">Configurações</h1>
          <p className="mt-1 text-[14.5px] text-muted">
            Locais de atendimento e grade de horários
          </p>
        </div>
        <ThemeToggle />
      </div>

      <div className="mb-6 rounded-2xl border border-border bg-card p-6 shadow-[0_8px_24px_var(--color-shadow)]">
        <h2 className="mb-4 text-[16px] font-bold">Locais de atendimento</h2>
        <NovoLocalForm />
        {locais.length > 0 && (
          <ul className="mt-5 flex flex-wrap gap-2">
            {locais.map((local) => (
              <li
                key={local.id}
                className="rounded-full bg-accent-soft px-3.5 py-1.5 text-[13.5px] font-semibold text-accent-dark"
              >
                {local.nome}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mb-6 rounded-2xl border border-border bg-card p-6 shadow-[0_8px_24px_var(--color-shadow)]">
        <h2 className="mb-4 text-[16px] font-bold">Google Calendar</h2>
        <GoogleCalendarConexao conectado={googleStatus.conectado} />
      </div>

      {locais.length === 0 ? (
        <p className="text-[14px] text-muted">
          Cadastre um local acima pra poder configurar a grade de horários.
        </p>
      ) : (
        <div>
          <h2 className="mb-4 text-[16px] font-bold">Grade de horários</h2>
          <RegrasHorarioManager locais={locais} regras={regras} />
        </div>
      )}
    </div>
  );
}
