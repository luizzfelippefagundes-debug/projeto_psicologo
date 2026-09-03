import { AgendamentoWizard } from "@/components/AgendamentoWizard";
import { getProfissionalPublicoServer } from "@/lib/apiPublicoServer";

export default async function NovoAgendamentoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const profissional = await getProfissionalPublicoServer(slug);
  return <AgendamentoWizard slug={slug} profissional={profissional} />;
}
