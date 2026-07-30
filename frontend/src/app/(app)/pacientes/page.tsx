import { ThemeToggle } from "@/components/ThemeToggle";
import { PacientesTable } from "@/components/PacientesTable";
import { getPacientes } from "@/lib/api";

export default async function PacientesPage() {
  const pacientes = await getPacientes();

  return (
    <div className="pl-12 md:pl-0">
      <div className="mb-7 flex items-center justify-between gap-5">
        <div>
          <h1 className="text-2xl font-extrabold">Pacientes</h1>
          <p className="mt-1 text-[14.5px] text-muted">
            Acompanhe consultas e cadastro de cada paciente
          </p>
        </div>
        <ThemeToggle />
      </div>

      <PacientesTable pacientes={pacientes} />
    </div>
  );
}
