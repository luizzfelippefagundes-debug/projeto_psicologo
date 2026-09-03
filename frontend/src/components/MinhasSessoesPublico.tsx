"use client";

import { Show, useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { cancelarSessaoPublica, getMinhasSessoes, type SessaoPublica } from "@/lib/apiPublico";

// Página pública: sempre no tema claro, mesmo padrão de AgendamentoPublicoFluxo.tsx
// e de frontend/src/app/anamnese/[token]/page.tsx.
const ESTILO_CLARO = {
  colorScheme: "light",
  "--color-accent": "#a8768a",
  "--color-accent-dark": "#8f5f73",
  "--color-accent-soft": "#f3e8ec",
  "--color-card": "#faf6f3",
  "--color-fg": "#3a2f2f",
  "--color-muted": "#8a7873",
  "--color-border": "#ddd0c9",
  "--color-gold": "#b8860b",
  "--color-gold-soft": "#f5ecd6",
  "--color-shadow": "rgba(90, 60, 60, 0.14)",
  background: "#ffffff",
  color: "#3a2f2f",
  minHeight: "100%",
} as React.CSSProperties;

export function MinhasSessoesPublico({ slug }: { slug: string }) {
  const { getToken } = useAuth();
  const [sessoes, setSessoes] = useState<SessaoPublica[]>([]);
  const [carregado, setCarregado] = useState(false);

  async function recarregar() {
    const token = await getToken();
    if (!token) return;
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
    if (!token) return;
    await cancelarSessaoPublica(id, slug, token);
    recarregar();
  }

  return (
    <div className="flex min-h-full flex-1 justify-center p-6" style={ESTILO_CLARO}>
      <div className="w-full max-w-[480px]">
        <h1 className="mb-6 text-2xl font-extrabold">Minhas consultas</h1>

        <Show
          when="signed-in"
          fallback={<p className="text-[14.5px] text-muted">Faça login pra ver suas consultas.</p>}
        >
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
        </Show>
      </div>
    </div>
  );
}
