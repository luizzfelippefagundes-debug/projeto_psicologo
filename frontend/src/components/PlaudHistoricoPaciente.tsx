"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { PlaudGravacaoPaciente } from "@/lib/api";
import { formatDataHoraBrasilia } from "@/lib/format";
import { MarkdownTexto, textoSimples } from "@/components/MarkdownTexto";
import { TranscricaoChat } from "@/components/TranscricaoChat";
import { MapaMentalPlaud } from "@/components/MapaMentalPlaud";

type Aba = "resumo" | "texto" | "mapa" | "transcricao";

const ABAS: [Aba, string][] = [
  ["resumo", "Resumo"],
  ["texto", "Texto pronto"],
  ["mapa", "Mapa mental"],
  ["transcricao", "Transcrição"],
];

function CartaoGravacao({ g }: { g: PlaudGravacaoPaciente }) {
  const [aberto, setAberto] = useState(false);
  const [aba, setAba] = useState<Aba>("resumo");
  const rotulo = g.titulo || formatDataHoraBrasilia(g.gravado_em ?? g.recebido_em);

  return (
    <li className="rounded-2xl border border-border bg-card shadow-[0_8px_24px_var(--color-shadow)]">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex w-full items-start justify-between gap-4 p-5 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14.5px] font-bold">{rotulo}</div>
          <div className="mt-1 text-[12.5px] text-muted">
            Sessão de {formatDataHoraBrasilia(g.sessao_data_hora)}
          </div>
          {!aberto && (
            <div className="mt-2 truncate text-[13.5px] text-muted">
              {g.resumo ? textoSimples(g.resumo) : "Sem resumo disponível."}
            </div>
          )}
        </div>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted transition-transform ${aberto ? "rotate-180" : ""}`}
          strokeWidth={2}
        />
      </button>

      {aberto && (
        <div className="border-t border-border p-5 pt-4">
          <div className="mb-4 flex gap-1.5 overflow-x-auto">
            {ABAS.map(([valor, label]) => (
              <button
                key={valor}
                type="button"
                onClick={() => setAba(valor)}
                className={`shrink-0 whitespace-nowrap rounded-xl px-3.5 py-2 text-[13px] font-bold ${
                  aba === valor ? "bg-accent text-white" : "border border-border bg-card text-muted"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {aba === "resumo" &&
            (g.resumo ? <MarkdownTexto texto={g.resumo} /> : <p className="text-[13.5px] text-muted">Sem resumo disponível.</p>)}

          {aba === "texto" &&
            (g.texto_curto ? (
              <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-muted">{g.texto_curto}</p>
            ) : (
              <p className="text-[13.5px] text-muted">Essa gravação ainda não tem texto pronto gerado.</p>
            ))}

          {aba === "mapa" &&
            (g.resumo ? (
              <MapaMentalPlaud texto={g.resumo} />
            ) : (
              <p className="text-[13.5px] text-muted">Sem resumo disponível pra desenhar o mapa mental.</p>
            ))}

          {aba === "transcricao" &&
            (g.transcricao ? (
              <TranscricaoChat texto={g.transcricao} />
            ) : (
              <p className="text-[13.5px] text-muted">Sem transcrição disponível.</p>
            ))}
        </div>
      )}
    </li>
  );
}

export function PlaudHistoricoPaciente({ gravacoes }: { gravacoes: PlaudGravacaoPaciente[] }) {
  if (gravacoes.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-[0_8px_24px_var(--color-shadow)]">
        <p className="text-[14px] text-muted">Nenhuma gravação do Plaud vinculada a esse paciente ainda.</p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {gravacoes.map((g) => (
        <CartaoGravacao key={g.id} g={g} />
      ))}
    </ul>
  );
}
