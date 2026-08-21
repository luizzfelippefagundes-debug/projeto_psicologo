"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DIAS_SEMANA, formatHoraCurta, type Local, type RegraHorario } from "@/lib/format";

const API_URL = "/api"; // passa pelo rewrite do Next.js — cookie de sessão nasce no domínio do site

export function RegrasHorarioManager({
  locais,
  regras,
}: {
  locais: Local[];
  regras: RegraHorario[];
}) {
  const router = useRouter();
  const [localId, setLocalId] = useState(String(locais[0]?.id ?? ""));
  const [diasSelecionados, setDiasSelecionados] = useState<number[]>([]);
  const [horaInicio, setHoraInicio] = useState("08:00");
  const [horaFim, setHoraFim] = useState("18:00");
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  function alternarDia(dia: number) {
    setDiasSelecionados((atual) =>
      atual.includes(dia) ? atual.filter((d) => d !== dia) : [...atual, dia].sort(),
    );
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro(null);

    if (diasSelecionados.length === 0) {
      setErro("Selecione ao menos um dia.");
      return;
    }

    setCarregando(true);

    const res = await fetch(`${API_URL}/regras-horario`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        local_id: Number(localId),
        dias_semana: diasSelecionados,
        hora_inicio: horaInicio,
        hora_fim: horaFim,
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErro(data.detail ?? "Não deu pra criar a regra.");
      setCarregando(false);
      return;
    }

    setDiasSelecionados([]);
    setCarregando(false);
    router.refresh();
  }

  async function handleRemover(id: number) {
    await fetch(`${API_URL}/regras-horario/${id}`, {
      method: "DELETE",
      credentials: "include",
    });
    router.refresh();
  }

  const regrasPorLocal = locais.map((local) => ({
    local,
    regras: regras.filter((r) => r.local_id === local.id),
  }));

  return (
    <div className="flex flex-col gap-6">
      <form
        onSubmit={handleSubmit}
        className="flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-card p-5 shadow-[0_8px_24px_var(--color-shadow)]"
      >
        <div className="flex flex-col">
          <label htmlFor="local" className="mb-1.5 text-sm font-semibold">
            Local
          </label>
          <select
            id="local"
            value={localId}
            onChange={(e) => setLocalId(e.target.value)}
            className="rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-3 py-2.5 text-[14.5px] outline-none focus:border-accent"
          >
            {locais.map((local) => (
              <option key={local.id} value={local.id}>
                {local.nome}
              </option>
            ))}
          </select>
        </div>

        <div className="flex w-full flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">Dias da semana</span>
            <div className="flex gap-3 text-[12.5px] font-semibold">
              <button
                type="button"
                onClick={() => setDiasSelecionados([0, 1, 2, 3, 4, 5, 6])}
                className="text-accent hover:underline"
              >
                Semana toda
              </button>
              <button
                type="button"
                onClick={() => setDiasSelecionados([1, 2, 3, 4, 5])}
                className="text-accent hover:underline"
              >
                Dias úteis
              </button>
              <button
                type="button"
                onClick={() => setDiasSelecionados([])}
                className="text-muted hover:underline"
              >
                Limpar
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {DIAS_SEMANA.map((dia, i) => {
              const ativo = diasSelecionados.includes(i);
              return (
                <button
                  key={dia}
                  type="button"
                  onClick={() => alternarDia(i)}
                  aria-pressed={ativo}
                  className={
                    ativo
                      ? "rounded-full bg-accent px-3.5 py-1.5 text-[13px] font-bold text-white"
                      : "rounded-full border-[1.5px] border-border bg-[var(--color-accent-soft)] px-3.5 py-1.5 text-[13px] font-semibold text-accent-dark transition-colors hover:border-accent"
                  }
                >
                  {dia.slice(0, 3)}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col">
          <label htmlFor="inicio" className="mb-1.5 text-sm font-semibold">
            Início
          </label>
          <input
            id="inicio"
            type="time"
            value={horaInicio}
            onChange={(e) => setHoraInicio(e.target.value)}
            className="rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-3 py-2.5 text-[14.5px] outline-none focus:border-accent"
          />
        </div>

        <div className="flex flex-col">
          <label htmlFor="fim" className="mb-1.5 text-sm font-semibold">
            Fim
          </label>
          <input
            id="fim"
            type="time"
            value={horaFim}
            onChange={(e) => setHoraFim(e.target.value)}
            className="rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-3 py-2.5 text-[14.5px] outline-none focus:border-accent"
          />
        </div>

        <button
          type="submit"
          disabled={carregando || !localId || diasSelecionados.length === 0}
          className="rounded-xl bg-accent px-5 py-2.5 text-[14.5px] font-bold text-white transition-colors hover:bg-accent-dark disabled:opacity-60"
        >
          {carregando
            ? "Adicionando..."
            : diasSelecionados.length > 1
              ? `Adicionar horário (${diasSelecionados.length} dias)`
              : "Adicionar horário"}
        </button>

        {erro && <p className="w-full text-[13px] font-semibold text-red-600">{erro}</p>}
      </form>

      <div className="flex flex-col gap-4">
        {regrasPorLocal.map(({ local, regras: regrasDoLocal }) => (
          <div
            key={local.id}
            className="rounded-2xl border border-border bg-card p-5 shadow-[0_8px_24px_var(--color-shadow)]"
          >
            <h3 className="mb-3 text-[15px] font-bold">{local.nome}</h3>
            {regrasDoLocal.length === 0 ? (
              <p className="text-[13.5px] text-muted">Nenhum horário cadastrado ainda.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {regrasDoLocal.map((regra) => (
                  <li
                    key={regra.id}
                    className="flex items-center justify-between rounded-xl bg-accent-soft px-4 py-2.5 text-[14px]"
                  >
                    <span className="font-semibold text-accent-dark">
                      {DIAS_SEMANA[regra.dia_semana]} · {formatHoraCurta(regra.hora_inicio)} –{" "}
                      {formatHoraCurta(regra.hora_fim)}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemover(regra.id)}
                      className="text-[13px] font-semibold text-red-600 hover:underline"
                    >
                      Remover
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
