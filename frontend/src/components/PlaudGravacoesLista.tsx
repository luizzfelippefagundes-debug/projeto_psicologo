"use client";

import { useState } from "react";
import { ChevronDown, Folder, FolderOpen } from "lucide-react";
import type { PlaudGravacaoLista } from "@/lib/api";
import { formatDataHoraBrasilia } from "@/lib/format";
import { MarkdownTexto, textoSimples } from "@/components/MarkdownTexto";
import { TranscricaoChat } from "@/components/TranscricaoChat";

const CHAVE_SEM_VINCULO = "__sem_vinculo__";

type Grupo = { chave: string; nome: string; gravacoes: PlaudGravacaoLista[] };

function agruparPorPaciente(gravacoes: PlaudGravacaoLista[]): Grupo[] {
  const mapa = new Map<string, Grupo>();
  for (const g of gravacoes) {
    const chave = g.paciente_nome ?? CHAVE_SEM_VINCULO;
    if (!mapa.has(chave)) {
      mapa.set(chave, { chave, nome: g.paciente_nome ?? "Não vinculadas", gravacoes: [] });
    }
    mapa.get(chave)!.gravacoes.push(g);
  }
  // gravacoes já chega ordenada por mais recente primeiro — preserva essa ordem entre
  // pastas (paciente com gravação mais recente aparece primeiro), só a pasta "Não
  // vinculadas" vai sempre pro topo por precisar de ação.
  return [...mapa.values()].sort((a, b) =>
    a.chave === CHAVE_SEM_VINCULO ? -1 : b.chave === CHAVE_SEM_VINCULO ? 1 : 0
  );
}

function GravacaoCard({ g, aberto, onToggle }: { g: PlaudGravacaoLista; aberto: boolean; onToggle: () => void }) {
  const rotulo =
    g.titulo || (g.gravado_em ? formatDataHoraBrasilia(g.gravado_em) : formatDataHoraBrasilia(g.recebido_em));

  return (
    <li className="rounded-2xl border border-border bg-card shadow-[0_8px_24px_var(--color-shadow)]">
      <button type="button" onClick={onToggle} className="flex w-full items-start justify-between gap-4 p-5 text-left">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14.5px] font-bold">{rotulo}</div>
          <div className="mt-1 text-[12.5px] text-muted">
            {g.gravado_em ? formatDataHoraBrasilia(g.gravado_em) : formatDataHoraBrasilia(g.recebido_em)}
          </div>
          {!aberto && (
            <div className="mt-2 truncate text-[13.5px] text-muted">
              {g.resumo ? textoSimples(g.resumo) : "Sem resumo disponível."}
            </div>
          )}
        </div>
      </button>

      {aberto && (
        <div className="border-t border-border p-5 pt-4">
          <h3 className="mb-2 text-[13px] font-bold">Resumo</h3>
          {g.resumo ? (
            <div className="mb-5 border-b border-border pb-5">
              <MarkdownTexto texto={g.resumo} />
            </div>
          ) : (
            <p className="mb-5 border-b border-border pb-5 text-[13.5px] text-muted">Sem resumo disponível.</p>
          )}
          <h3 className="mb-2 text-[13px] font-bold">Transcrição completa</h3>
          {g.transcricao ? (
            <TranscricaoChat texto={g.transcricao} />
          ) : (
            <p className="text-[13.5px] text-muted">Sem transcrição disponível.</p>
          )}
        </div>
      )}
    </li>
  );
}

export function PlaudGravacoesLista({ gravacoes }: { gravacoes: PlaudGravacaoLista[] }) {
  const [expandidoId, setExpandidoId] = useState<number | null>(null);
  const [pastasAbertas, setPastasAbertas] = useState<Set<string>>(new Set());

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

  const grupos = agruparPorPaciente(gravacoes);

  function alternarPasta(chave: string) {
    setPastasAbertas((atual) => {
      const nova = new Set(atual);
      if (nova.has(chave)) nova.delete(chave);
      else nova.add(chave);
      return nova;
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {grupos.map((grupo) => {
        const pastaAberta = pastasAbertas.has(grupo.chave);
        const semVinculo = grupo.chave === CHAVE_SEM_VINCULO;

        return (
          <div key={grupo.chave} className="rounded-2xl border border-border bg-card shadow-[0_8px_24px_var(--color-shadow)]">
            <button
              type="button"
              onClick={() => alternarPasta(grupo.chave)}
              className="flex w-full items-center gap-3 p-5 text-left"
            >
              {pastaAberta ? (
                <FolderOpen className="h-[18px] w-[18px] shrink-0 text-accent" strokeWidth={2} />
              ) : (
                <Folder className="h-[18px] w-[18px] shrink-0 text-accent" strokeWidth={2} />
              )}
              <span className={`flex-1 truncate text-[14.5px] font-bold ${semVinculo ? "text-muted" : ""}`}>
                {grupo.nome}
              </span>
              <span className="shrink-0 rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-bold text-accent-dark">
                {grupo.gravacoes.length}
              </span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-muted transition-transform ${pastaAberta ? "rotate-180" : ""}`}
                strokeWidth={2}
              />
            </button>

            {pastaAberta && (
              <ul className="flex flex-col gap-3 border-t border-border p-5 pt-4">
                {grupo.gravacoes.map((g) => (
                  <GravacaoCard
                    key={g.id}
                    g={g}
                    aberto={expandidoId === g.id}
                    onToggle={() => setExpandidoId(expandidoId === g.id ? null : g.id)}
                  />
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
