"use client";

import { useState } from "react";
import type { PlaudGravacaoLista } from "@/lib/api";
import { formatDataHoraBrasilia } from "@/lib/format";

export function PlaudGravacoesLista({ gravacoes }: { gravacoes: PlaudGravacaoLista[] }) {
  const [expandidoId, setExpandidoId] = useState<number | null>(null);

  if (gravacoes.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-[0_8px_24px_var(--color-shadow)]">
        <p className="text-[14px] text-muted">
          Nenhuma gravação recebida ainda. Configure o Zap no Zapier (Configurações → Plaud) pra elas
          aparecerem aqui.
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {gravacoes.map((g) => {
        const aberto = expandidoId === g.id;
        const rotulo =
          g.titulo || (g.gravado_em ? formatDataHoraBrasilia(g.gravado_em) : formatDataHoraBrasilia(g.recebido_em));

        return (
          <li
            key={g.id}
            className="rounded-2xl border border-border bg-card shadow-[0_8px_24px_var(--color-shadow)]"
          >
            <button
              type="button"
              onClick={() => setExpandidoId(aberto ? null : g.id)}
              className="flex w-full items-start justify-between gap-4 p-5 text-left"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14.5px] font-bold">{rotulo}</div>
                <div className="mt-1 text-[12.5px] text-muted">
                  {g.gravado_em ? formatDataHoraBrasilia(g.gravado_em) : formatDataHoraBrasilia(g.recebido_em)}
                </div>
                {!aberto && (
                  <div className="mt-2 truncate text-[13.5px] text-muted">
                    {g.resumo || "Sem resumo disponível."}
                  </div>
                )}
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${
                  g.sessao_id ? "bg-accent-soft text-accent-dark" : "bg-black/5 text-muted"
                }`}
              >
                {g.sessao_id && g.paciente_nome ? `Vinculada a ${g.paciente_nome}` : "Não vinculada"}
              </span>
            </button>

            {aberto && (
              <div className="border-t border-border p-5 pt-4">
                <h3 className="mb-1.5 text-[13px] font-bold">Resumo</h3>
                <p className="mb-4 whitespace-pre-wrap text-[13.5px] text-muted">
                  {g.resumo || "Sem resumo disponível."}
                </p>
                <h3 className="mb-1.5 text-[13px] font-bold">Transcrição completa</h3>
                <p className="whitespace-pre-wrap text-[13.5px] text-muted">
                  {g.transcricao || "Sem transcrição disponível."}
                </p>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
