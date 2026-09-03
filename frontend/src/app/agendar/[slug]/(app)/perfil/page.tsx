import { PerfilPaciente } from "@/components/PerfilPaciente";

export default async function PerfilPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <PerfilPaciente slug={slug} />;
}
