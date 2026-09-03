import { SignUp } from "@clerk/nextjs";
import { AuthDoorShell } from "@/components/AuthDoorShell";
import { getProfissionalPublicoServer } from "@/lib/apiPublicoServer";

export default async function CadastroPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let profissional;
  try {
    profissional = await getProfissionalPublicoServer(slug);
  } catch {
    return (
      <div className="flex min-h-dvh flex-1 items-center justify-center bg-white p-6">
        <p className="text-[15px] text-[#8a7873]">Link inválido ou não encontrado.</p>
      </div>
    );
  }

  return (
    <AuthDoorShell
      nomeProfissional={profissional.nome}
      titulo="Criar conta"
      descricao="Crie sua conta pra agendar sua consulta."
    >
      <SignUp
        path={`/agendar/${slug}/cadastro`}
        routing="path"
        signInUrl={`/agendar/${slug}/entrar`}
        fallbackRedirectUrl={`/agendar/${slug}`}
      />
    </AuthDoorShell>
  );
}
