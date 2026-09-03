import { iniciais } from "@/lib/format";

// Sempre no tema claro, independente do tema do resto do site — mesmo padrão de
// frontend/src/app/anamnese/[token]/page.tsx: tela de porta de entrada, sem o
// ThemeToggle do app logado, então não faz sentido ela seguir o modo escuro do
// sistema de quem visita.
export function AuthDoorShell({
  nomeProfissional,
  titulo,
  descricao,
  children,
}: {
  nomeProfissional: string;
  titulo: string;
  descricao: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="relative flex min-h-dvh flex-col items-center justify-center gap-6 bg-white p-4 text-[#3a2f2f]"
      style={{ colorScheme: "light" }}
    >
      <div className="flex items-center gap-2.5 text-[15px] font-extrabold">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f3e8ec] text-[13px] font-extrabold text-[#8f5f73]">
          {iniciais(nomeProfissional)}
        </span>
        {nomeProfissional}
      </div>

      <div className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-lg font-extrabold">{titulo}</h1>
        <p className="max-w-xs text-[13.5px] text-[#8a7873]">{descricao}</p>
      </div>

      {children}
    </div>
  );
}
