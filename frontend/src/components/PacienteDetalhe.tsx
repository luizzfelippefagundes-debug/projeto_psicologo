"use client";

import { useState } from "react";
import { ChatAssistente } from "@/components/ChatAssistente";
import {
  formatDataHoraBrasilia,
  iniciais,
  labelProcedimento,
  type Paciente,
  type SessaoHistorico,
} from "@/lib/format";

const ABAS = ["Visão geral", "Histórico de sessões", "Assistente IA"] as const;
type Aba = (typeof ABAS)[number];

const STATUS_SESSAO_LABEL: Record<string, string> = {
  confirmada: "Confirmada",
  concluida: "Concluída",
  cancelada: "Cancelada",
};

export function PacienteDetalhe({
  paciente,
  sessoes,
}: {
  paciente: Paciente;
  sessoes: SessaoHistorico[];
}) {
  const [aba, setAba] = useState<Aba>("Visão geral");

  return (
    <div>
      <div className="mb-6 rounded-2xl border border-border bg-card p-6 shadow-[0_8px_24px_var(--color-shadow)]">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-xl font-extrabold text-accent-dark">
              {iniciais(paciente.nome)}
            </div>
            <div>
              <h1 className="text-2xl font-extrabold">{paciente.nome}</h1>
              <p className="mt-0.5 text-[14px] text-muted">
                Paciente desde {formatDataHoraBrasilia(paciente.criado_em)}
              </p>
            </div>
          </div>
          <span
            className={`inline-block rounded-full px-3 py-1 text-[12.5px] font-bold ${
              paciente.status === "ativo"
                ? "bg-accent-soft text-accent-dark"
                : "bg-black/5 text-muted"
            }`}
          >
            {paciente.status === "ativo" ? "Ativo" : "Inativo"}
          </span>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-5 border-t border-border pt-5 sm:grid-cols-3 lg:grid-cols-5">
          <Campo label="Telefone" valor={paciente.telefone} />
          <Campo label="Email" valor={paciente.email ?? "—"} />
          <Campo
            label="Tipo de atendimento"
            valor={paciente.tipo_atendimento === "individual" ? "Individual" : "Casal"}
          />
          <Campo label="Tipo de procedimento" valor={labelProcedimento(paciente.tipo_procedimento)} />
          <Campo
            label="Próxima sessão"
            valor={paciente.proxima_sessao ? formatDataHoraBrasilia(paciente.proxima_sessao) : "—"}
          />
        </div>
      </div>

      <div className="mb-5 flex gap-2 border-b border-border">
        {ABAS.map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => setAba(a)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-[14px] font-bold transition-colors ${
              aba === a
                ? "border-accent text-accent-dark"
                : "border-transparent text-muted hover:text-fg"
            }`}
          >
            {a}
          </button>
        ))}
      </div>

      {aba === "Visão geral" && (
        <div className="rounded-2xl border border-border bg-card p-6 shadow-[0_8px_24px_var(--color-shadow)]">
          <h2 className="mb-4 text-[16px] font-bold">Resumo</h2>
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3">
            <Campo label="Total de sessões" valor={String(sessoes.length)} />
            <Campo
              label="Sessões concluídas"
              valor={String(sessoes.filter((s) => s.status === "concluida").length)}
            />
            <Campo
              label="Sessões canceladas"
              valor={String(sessoes.filter((s) => s.status === "cancelada").length)}
            />
          </div>
        </div>
      )}

      {aba === "Histórico de sessões" && (
        <div className="rounded-2xl border border-border bg-card shadow-[0_8px_24px_var(--color-shadow)]">
          {sessoes.length === 0 ? (
            <p className="p-6 text-center text-[14px] text-muted">
              Nenhuma sessão registrada ainda.
            </p>
          ) : (
            <ul>
              {sessoes.map((s) => (
                <li
                  key={s.id}
                  className="flex items-start justify-between gap-4 border-b border-border px-6 py-4 last:border-0"
                >
                  <div>
                    <p className="text-[14.5px] font-bold">{formatDataHoraBrasilia(s.data_hora)}</p>
                    <p className="mt-0.5 text-[13px] text-muted">
                      {s.modalidade === "presencial" ? "Presencial" : "Teleconsulta"} · {s.local_nome} ·{" "}
                      {s.duracao_minutos} min
                    </p>
                    {s.observacoes && (
                      <p className="mt-1.5 text-[13.5px] text-fg">{s.observacoes}</p>
                    )}
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-3 py-1 text-[12px] font-bold ${
                      s.status === "confirmada"
                        ? "bg-accent-soft text-accent-dark"
                        : s.status === "concluida"
                          ? "bg-black/5 text-muted"
                          : "bg-red-500/10 text-red-600"
                    }`}
                  >
                    {STATUS_SESSAO_LABEL[s.status]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {aba === "Assistente IA" && (
        <ChatAssistente
          pacienteId={paciente.id}
          sugestoes={["Resuma o histórico desse paciente", "Quais os próximos passos sugeridos?"]}
        />
      )}
    </div>
  );
}

function Campo({ label, valor }: { label: string; valor: string }) {
  return (
    <div>
      <p className="text-[12px] font-bold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-[14.5px] font-semibold">{valor}</p>
    </div>
  );
}
