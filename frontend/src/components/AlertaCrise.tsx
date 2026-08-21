"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatDataHoraBrasilia, type ConversaEscalonada } from "@/lib/format";

const API_URL = "/api"; // passa pelo rewrite do Next.js — cookie de sessão nasce no domínio do site

export function AlertaCrise({ conversas }: { conversas: ConversaEscalonada[] }) {
  const router = useRouter();
  const [resolvendo, setResolvendo] = useState<number | null>(null);

  if (conversas.length === 0) return null;

  async function marcarResolvido(id: number) {
    setResolvendo(id);
    await fetch(`${API_URL}/conversas-escalonadas/${id}`, {
      method: "PATCH",
      credentials: "include",
    });
    setResolvendo(null);
    router.refresh();
  }

  return (
    <div className="mb-6 rounded-2xl border-2 border-red-500/40 bg-red-500/5 p-5">
      <h2 className="mb-3 flex items-center gap-2 text-[15px] font-extrabold text-red-600">
        ⚠️ {conversas.length} conversa{conversas.length > 1 ? "s" : ""} precisa
        {conversas.length > 1 ? "m" : ""} da sua atenção
      </h2>
      <ul className="flex flex-col gap-3">
        {conversas.map((c) => (
          <li
            key={c.id}
            className="rounded-xl border border-red-500/20 bg-card p-4 text-[13.5px]"
          >
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <span className="font-bold">
                {c.paciente_nome ?? "Paciente não identificado"}
                {c.telefone_paciente && (
                  <span className="ml-2 font-normal text-muted">{c.telefone_paciente}</span>
                )}
              </span>
              <span className="rounded-full bg-red-500/10 px-2.5 py-0.5 text-[11.5px] font-bold text-red-600">
                {c.motivo === "crise" ? "Crise" : "Fora do escopo"}
              </span>
            </div>
            <p className="mb-2 text-fg">{c.previa_conversa}</p>
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-muted">{formatDataHoraBrasilia(c.notificado_em)}</span>
              <button
                type="button"
                onClick={() => marcarResolvido(c.id)}
                disabled={resolvendo === c.id}
                className="rounded-lg border border-border bg-accent-soft px-3 py-1.5 text-[12.5px] font-semibold disabled:opacity-60"
              >
                {resolvendo === c.id ? "Marcando..." : "Marcar como resolvido"}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
