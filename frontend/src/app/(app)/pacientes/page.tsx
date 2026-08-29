import { ThemeToggle } from "@/components/ThemeToggle";
import { PacientesTable } from "@/components/PacientesTable";
import { getContatosBot, getPacientes, getPacientesAnamnese } from "@/lib/api";

export default async function PacientesPage({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string }>;
}) {
  const { aba } = await searchParams;
  const abaAtiva = aba === "contatos" ? "contatos" : aba === "anamneses" ? "anamneses" : "pacientes";

  const [pacientes, contatos, anamneses] = await Promise.all([
    getPacientes(),
    getContatosBot(),
    getPacientesAnamnese(),
  ]);

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

      <PacientesTable
        pacientes={pacientes}
        contatos={contatos}
        anamneses={anamneses}
        abaAtiva={abaAtiva}
      />
    </div>
  );
}
