"use client";

import { useAuth, useUser } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import {
  cancelarSessaoPublica,
  getMeuPerfil,
  getMinhasSessoes,
  type PerfilPublico,
  type SessaoPublica,
} from "@/lib/apiPublico";
import { iniciais } from "@/lib/format";

export function PerfilPaciente({ slug }: { slug: string }) {
  const { getToken } = useAuth();
  const { user } = useUser();
  const [perfil, setPerfil] = useState<PerfilPublico | null>(null);
  const [sessoes, setSessoes] = useState<SessaoPublica[]>([]);
  const [carregado, setCarregado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function recarregar() {
    const token = await getToken();
    if (!token) {
      setErro("Sessão expirada. Recarregue a página e faça login de novo.");
      return;
    }
    const [dadosPerfil, dadosSessoes] = await Promise.all([
      getMeuPerfil(slug, token),
      getMinhasSessoes(slug, token),
    ]);
    setPerfil(dadosPerfil);
    setSessoes(dadosSessoes);
    setCarregado(true);
  }

  useEffect(() => {
    recarregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  async function cancelar(id: number) {
    const token = await getToken();
    if (!token) {
      setErro("Sessão expirada. Recarregue a página e faça login de novo.");
      return;
    }
    await cancelarSessaoPublica(id, slug, token);
    recarregar();
  }

  const nome = perfil?.nome ?? user?.fullName ?? "Paciente";
  const proximasSessoes = sessoes.filter((s) => s.status === "confirmada");

  return (
    <div className="mx-auto w-full max-w-[480px]">
      <div className="mb-5 flex items-center gap-3">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[18px] font-extrabold text-accent-dark">
          {iniciais(nome)}
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-extrabold">{nome}</h1>
          <p className="text-[13.5px] text-muted">
            {perfil?.telefone ?? "Telefone cadastrado na primeira consulta"}
          </p>
        </div>
      </div>

      {erro && <p className="mb-4 text-[13px] font-semibold text-red-600">{erro}</p>}

      <div className="mb-5 rounded-2xl border border-border bg-card p-5 shadow-[0_4px_14px_var(--color-shadow)]">
        <h2 className="mb-3 text-[15px] font-bold">Próximas consultas</h2>
        {!carregado ? null : proximasSessoes.length === 0 ? (
          <p className="text-[13.5px] text-muted">Nenhuma consulta marcada.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {proximasSessoes.map((s) => (
              <li key={s.id} className="flex items-center justify-between border-b border-border pb-3 last:border-0 last:pb-0">
                <div>
                  <div className="text-[14px] font-bold">
                    {new Date(s.data_hora).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                  </div>
                  <div className="text-[12.5px] text-muted">{s.local_nome}</div>
                </div>
                <button
                  type="button"
                  onClick={() => cancelar(s.id)}
                  className="text-[13px] font-semibold text-red-600 hover:underline"
                >
                  Cancelar
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {carregado && sessoes.length > proximasSessoes.length && (
        <div>
          <h2 className="mb-3 text-[15px] font-bold">Histórico</h2>
          <ul className="flex flex-col gap-3">
            {sessoes
              .filter((s) => s.status !== "confirmada")
              .map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3"
                >
                  <div>
                    <div className="text-[14px] font-bold">
                      {new Date(s.data_hora).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                    </div>
                    <div className="text-[12.5px] text-muted">{s.local_nome}</div>
                  </div>
                  <span className="text-[12px] font-semibold text-muted capitalize">{s.status}</span>
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}
