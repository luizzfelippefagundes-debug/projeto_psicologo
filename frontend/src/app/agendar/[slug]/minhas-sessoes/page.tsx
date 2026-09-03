import { MinhasSessoesPublico } from "@/components/MinhasSessoesPublico";

export default async function MinhasSessoesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <MinhasSessoesPublico slug={slug} />;
}
