"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { cancelarSessaoPublica, getMinhasSessoes, type SessaoPublica } from "@/lib/apiPublico";

export function MinhasSessoesPublico({ slug }: { slug: string }) {
  const { getToken } = useAuth();
  const [sessoes, setSessoes] = useState<SessaoPublica[]>([]);
  const [carregado, setCarregado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function recarregar() {
    const token = await getToken();
    if (!token) {
      setErro("Sessão expirada. Recarregue a página e faça login de novo.");
      return;
    }
    const dados = await getMinhasSessoes(slug, token);
    setSessoes(dados);
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

  return (
    <div className="mx-auto w-full max-w-[480px]">
      <h1 className="mb-5 text-xl font-extrabold">Minhas consultas</h1>

      {erro && <p className="mb-4 text-[13px] font-semibold text-red-600">{erro}</p>}

      {!carregado ? null : sessoes.length === 0 ? (
        <p className="text-[14.5px] text-muted">Nenhuma consulta ainda.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {sessoes.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3"
            >
              <div>
                <div className="text-[14px] font-bold">
                  {new Date(s.data_hora).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                </div>
                <div className="text-[12.5px] text-muted">
                  {s.local_nome} · {s.status}
                </div>
              </div>
              {s.status === "confirmada" && (
                <button
                  type="button"
                  onClick={() => cancelar(s.id)}
                  className="text-[13px] font-semibold text-red-600 hover:underline"
                >
                  Cancelar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
