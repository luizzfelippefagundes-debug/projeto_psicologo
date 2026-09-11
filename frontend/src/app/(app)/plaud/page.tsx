import { ThemeToggle } from "@/components/ThemeToggle";
import { PlaudGravacoesLista } from "@/components/PlaudGravacoesLista";
import { getGravacoesPlaud } from "@/lib/api";

export default async function PlaudPage() {
  const gravacoes = await getGravacoesPlaud();

  return (
    <div>
      <div className="mb-7 flex items-center justify-between gap-5">
        <div>
          <h1 className="text-2xl font-extrabold">Plaud</h1>
          <p className="mt-1 text-[14.5px] text-muted">
            Gravações recebidas automaticamente via webhook, vinculadas ou não a uma sessão
          </p>
        </div>
        <ThemeToggle />
      </div>

      <PlaudGravacoesLista gravacoes={gravacoes} />
    </div>
  );
}
