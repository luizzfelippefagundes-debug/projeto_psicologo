import Link from "next/link";
import { notFound } from "next/navigation";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PacienteDetalhe } from "@/components/PacienteDetalhe";
import { getAnamnesePaciente, getGravacoesPlaudPaciente, getPaciente, getSessoesPaciente } from "@/lib/api";

export default async function PacienteDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const pacienteId = Number(id);

  let paciente;
  let sessoes;
  let anamnese;
  let gravacoesPlaud;
  try {
    [paciente, sessoes, anamnese, gravacoesPlaud] = await Promise.all([
      getPaciente(pacienteId),
      getSessoesPaciente(pacienteId),
      getAnamnesePaciente(pacienteId),
      getGravacoesPlaudPaciente(pacienteId),
    ]);
  } catch {
    notFound();
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-5">
        <Link href="/pacientes" className="text-[13.5px] font-semibold text-muted hover:text-fg">
          ← Voltar pra Pacientes
        </Link>
        <ThemeToggle />
      </div>

      <PacienteDetalhe paciente={paciente} sessoes={sessoes} anamnese={anamnese} gravacoesPlaud={gravacoesPlaud} />
    </div>
  );
}
