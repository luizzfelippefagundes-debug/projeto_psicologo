"use client";

import { useState } from "react";
import { CAMPOS_ADULTO, CAMPOS_INFANTIL, type CampoAnamnese } from "@/lib/anamneseSchema";
import type { Laudo, PlaudGravacaoPaciente } from "@/lib/api";
import { PlaudHistoricoPaciente } from "@/components/PlaudHistoricoPaciente";
import { LaudosTab } from "@/components/LaudosTab";
import {
  formatDataHoraBrasilia,
  iniciais,
  labelProcedimento,
  type AnamneseDetalhe,
  type Paciente,
  type SessaoHistorico,
} from "@/lib/format";

const API_URL = "/api";
const ANOTACOES_MAX = 3000;

const ABAS = ["Visão geral", "Histórico de sessões", "Plaud", "Anamnese", "Laudos", "Anotações"] as const;
type Aba = (typeof ABAS)[number];

const STATUS_SESSAO_LABEL: Record<string, string> = {
  confirmada: "Confirmada",
  concluida: "Concluída",
  cancelada: "Cancelada",
  reservado: "Reservado (bot)",
  nao_compareceu: "Não compareceu",
};

export function PacienteDetalhe({
  paciente,
  sessoes,
  anamnese,
  gravacoesPlaud,
  laudos,
}: {
  paciente: Paciente;
  sessoes: SessaoHistorico[];
  anamnese: AnamneseDetalhe;
  gravacoesPlaud: PlaudGravacaoPaciente[];
  laudos: Laudo[];
}) {
  const [aba, setAba] = useState<Aba>("Visão geral");
  const [anotacoes, setAnotacoes] = useState(paciente.anotacoes ?? "");
  const [salvandoAnotacoes, setSalvandoAnotacoes] = useState(false);
  const [anotacoesSalvas, setAnotacoesSalvas] = useState(true);

  async function salvarAnotacoes() {
    setSalvandoAnotacoes(true);
    await fetch(`${API_URL}/pacientes/${paciente.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ anotacoes: anotacoes || null }),
    });
    setSalvandoAnotacoes(false);
    setAnotacoesSalvas(true);
  }

  return (
    <div>
      <div className="mb-4 rounded-2xl border border-border bg-card p-4 shadow-[0_8px_24px_var(--color-shadow)] sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-[17px] font-extrabold text-accent-dark sm:h-16 sm:w-16 sm:rounded-2xl sm:text-xl">
              {iniciais(paciente.nome)}
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-[19px] font-extrabold sm:text-2xl">{paciente.nome}</h1>
              <p className="mt-0.5 text-[12.5px] text-muted sm:text-[14px]">
                Desde {formatDataHoraBrasilia(paciente.criado_em)}
              </p>
            </div>
          </div>
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-bold sm:px-3 sm:text-[12.5px] ${
              paciente.status === "ativo"
                ? "bg-accent-soft text-accent-dark"
                : "bg-black/5 text-muted"
            }`}
          >
            {paciente.status === "ativo" ? "Ativo" : "Inativo"}
          </span>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-4 border-t border-border pt-4 sm:grid-cols-3 lg:grid-cols-5">
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
        {(paciente.tags ?? []).length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {paciente.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-accent-soft px-3 py-1 text-[12px] font-bold text-accent-dark"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="relative mb-5">
        <div className="flex overflow-x-auto border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {ABAS.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setAba(a)}
              className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-4 py-3 text-[13.5px] font-bold transition-colors ${
                aba === a
                  ? "border-accent text-accent-dark"
                  : "border-transparent text-muted hover:text-fg"
              }`}
            >
              {a}
            </button>
          ))}
        </div>
        <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-bg to-transparent" />
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
                  className="border-b border-border px-4 py-3 last:border-0 sm:px-6 sm:py-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-[14px] font-bold">{formatDataHoraBrasilia(s.data_hora)}</p>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11.5px] font-bold ${
                        s.status === "confirmada"
                          ? "bg-accent-soft text-accent-dark"
                          : s.status === "concluida"
                            ? "bg-black/5 text-muted"
                            : s.status === "reservado"
                              ? "bg-gold-soft text-gold"
                              : "bg-red-500/10 text-red-600"
                      }`}
                    >
                      {STATUS_SESSAO_LABEL[s.status]}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[12.5px] text-muted">
                    {s.modalidade === "presencial" ? "Presencial" : "Teleconsulta"} · {s.local_nome} · {s.duracao_minutos} min
                  </p>
                  {s.observacoes && (
                    <p className="mt-1 text-[13px] text-fg">{s.observacoes}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {aba === "Plaud" && <PlaudHistoricoPaciente gravacoes={gravacoesPlaud} />}

      {aba === "Laudos" && (
        <LaudosTab pacienteId={paciente.id} laudosIniciais={laudos} />
      )}

      {aba === "Anotações" && (
        <div className="rounded-2xl border border-border bg-card p-6 shadow-[0_8px_24px_var(--color-shadow)]">
          <div className="mb-3 flex items-center justify-between gap-4">
            <h2 className="text-[16px] font-bold">Anotações</h2>
            <div className="flex items-center gap-3">
              <span className={`text-[12px] ${anotacoes.length > ANOTACOES_MAX ? "text-red-600 font-bold" : "text-muted"}`}>
                {anotacoes.length}/{ANOTACOES_MAX}
              </span>
              {!anotacoesSalvas && (
                <button
                  type="button"
                  onClick={salvarAnotacoes}
                  disabled={salvandoAnotacoes || anotacoes.length > ANOTACOES_MAX}
                  className="rounded-xl bg-accent px-4 py-2 text-[13px] font-bold text-white transition-colors hover:bg-accent-dark disabled:opacity-60"
                >
                  {salvandoAnotacoes ? "Salvando..." : "Salvar"}
                </button>
              )}
              {anotacoesSalvas && anotacoes === (paciente.anotacoes ?? "") && (
                <span className="text-[12.5px] text-muted">Salvo</span>
              )}
            </div>
          </div>
          <textarea
            value={anotacoes}
            onChange={(e) => {
              setAnotacoes(e.target.value);
              setAnotacoesSalvas(false);
            }}
            placeholder="Anotações clínicas, observações ou lembretes sobre esse paciente..."
            rows={12}
            maxLength={ANOTACOES_MAX + 100}
            className="w-full resize-y rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-4 py-3 text-[14px] leading-relaxed outline-none focus:border-accent placeholder:text-muted"
          />
          <p className="mt-2 text-[12px] text-muted">
            Visível somente pra você. Máximo de {ANOTACOES_MAX.toLocaleString("pt-BR")} caracteres.
          </p>
        </div>
      )}

      {aba === "Anamnese" && (
        <div className="rounded-2xl border border-border bg-card p-6 shadow-[0_8px_24px_var(--color-shadow)]">
          {!anamnese ? (
            <p className="text-[14px] text-muted">Anamnese ainda não foi enviada pra esse paciente.</p>
          ) : !anamnese.respondido_em ? (
            <p className="text-[14px] text-muted">
              Formulário enviado em {formatDataHoraBrasilia(anamnese.enviado_em)}, aguardando resposta.
            </p>
          ) : (
            <>
              <p className="mb-5 text-[13px] text-muted">
                Respondido em {formatDataHoraBrasilia(anamnese.respondido_em)}
              </p>
              {Array.from(
                new Set(
                  (anamnese.tipo_formulario === "infantil" ? CAMPOS_INFANTIL : CAMPOS_ADULTO).map(
                    (c) => c.secao
                  )
                )
              ).map((secao) => (
                <div key={secao} className="mb-5 last:mb-0">
                  <h3 className="mb-2 text-[12.5px] font-bold uppercase tracking-wide text-muted">
                    {secao}
                  </h3>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {(anamnese.tipo_formulario === "infantil" ? CAMPOS_INFANTIL : CAMPOS_ADULTO)
                      .filter((c) => c.secao === secao)
                      .map((campo) => {
                        const valor = anamnese.respostas?.[campo.id];
                        if (valor === undefined || valor === "" || valor === null) return null;
                        return (
                          <div key={campo.id}>
                            <p className="text-[12px] font-bold text-muted">{campo.label}</p>
                            <p className="mt-0.5 text-[14px]">{formatValorCampo(campo, valor)}</p>
                          </div>
                        );
                      })}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function formatValorCampo(campo: CampoAnamnese, valor: string | boolean): string {
  if (typeof valor === "boolean") return valor ? "Sim" : "Não";
  // campo "data" vem do <input type="date"> como YYYY-MM-DD (formato do value do HTML,
  // não é como a profissional lê) — mostra em DD/MM/AAAA, formato brasileiro.
  if (campo.tipo === "data" && /^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    const [ano, mes, dia] = valor.split("-");
    return `${dia}/${mes}/${ano}`;
  }
  return valor;
}

function Campo({ label, valor }: { label: string; valor: string }) {
  return (
    <div>
      <p className="text-[12px] font-bold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-[14.5px] font-semibold">{valor}</p>
    </div>
  );
}
