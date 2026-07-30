"use client";

import { useState } from "react";
import { formatDataHoraBrasilia, iniciais, type Paciente } from "@/lib/format";

export function PacientesTable({ pacientes }: { pacientes: Paciente[] }) {
  const [busca, setBusca] = useState("");

  const filtrados = pacientes.filter((p) =>
    p.nome.toLowerCase().includes(busca.toLowerCase())
  );

  return (
    <div className="rounded-2xl border border-border bg-card shadow-[0_8px_24px_var(--color-shadow)]">
      <div className="flex items-center justify-between gap-4 border-b border-border p-6">
        <h2 className="text-[16px] font-bold">Todos os pacientes</h2>
        <div className="flex items-center gap-2 rounded-xl border border-border bg-accent-soft px-3 py-2 text-[14px]">
          🔍
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar paciente..."
            className="bg-transparent outline-none placeholder:text-muted"
          />
        </div>
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr>
            {["Paciente", "Telefone", "Tipo", "Próxima sessão", "Status"].map((col) => (
              <th
                key={col}
                className="border-b border-border px-6 py-3.5 text-left text-[12.5px] font-bold uppercase tracking-wide text-muted"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filtrados.map((p) => (
            <tr key={p.id}>
              <td className="border-b border-border px-6 py-4 text-[14.5px] last:border-0">
                <div className="flex items-center gap-3 font-bold">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[14px] font-extrabold text-accent-dark">
                    {iniciais(p.nome)}
                  </div>
                  {p.nome}
                </div>
              </td>
              <td className="border-b border-border px-6 py-4 text-[14.5px] text-muted">
                {p.telefone}
              </td>
              <td className="border-b border-border px-6 py-4 text-[14.5px] capitalize">
                {p.tipo_atendimento}
              </td>
              <td className="border-b border-border px-6 py-4 text-[14.5px] text-muted">
                {p.proxima_sessao ? formatDataHoraBrasilia(p.proxima_sessao) : "—"}
              </td>
              <td className="border-b border-border px-6 py-4">
                <span
                  className={`inline-block rounded-full px-3 py-1 text-[12.5px] font-bold ${
                    p.status === "ativo"
                      ? "bg-accent-soft text-accent-dark"
                      : "bg-black/5 text-muted"
                  }`}
                >
                  {p.status === "ativo" ? "Ativo" : "Inativo"}
                </span>
              </td>
            </tr>
          ))}
          {filtrados.length === 0 && (
            <tr>
              <td colSpan={5} className="px-6 py-8 text-center text-[14px] text-muted">
                Nenhum paciente encontrado.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
