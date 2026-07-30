"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Modal } from "@/components/Modal";
import {
  formatHoraBrasilia,
  sessaoGridPosition,
  type Local,
  type Paciente,
  type SessaoPeriodo,
} from "@/lib/format";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const HORAS = Array.from({ length: 14 }, (_, i) => 7 + i); // 07:00 .. 20:00

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

type FormState = {
  pacienteId: string;
  localId: string;
  data: string;
  hora: string;
  duracao: string;
  modalidade: "presencial" | "teleconsulta";
  observacoes: string;
};

function sessaoParaFormState(sessao: SessaoPeriodo): FormState {
  const dt = new Date(sessao.data_hora);
  const dataISO = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(dt);
  const hora = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Sao_Paulo",
  }).format(dt);
  return {
    pacienteId: String(sessao.paciente_id),
    localId: String(sessao.local_id),
    data: dataISO,
    hora,
    duracao: String(sessao.duracao_minutos),
    modalidade: sessao.modalidade,
    observacoes: sessao.observacoes ?? "",
  };
}

function formStateVazio(dataPadrao: string, localId: string, horaPadrao: string): FormState {
  return {
    pacienteId: "",
    localId,
    data: dataPadrao,
    hora: horaPadrao,
    duracao: "50",
    modalidade: "presencial",
    observacoes: "",
  };
}

function InfoRow({ label, valor }: { label: string; valor: string }) {
  return (
    <div>
      <p className="text-[12px] font-bold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-[14.5px] font-semibold">{valor}</p>
    </div>
  );
}

export function AgendaGrid({
  weekDates,
  sessoes,
  locais,
  pacientes,
  hojeISO,
}: {
  weekDates: string[];
  sessoes: SessaoPeriodo[];
  locais: Local[];
  pacientes: Paciente[];
  hojeISO: string;
}) {
  const router = useRouter();
  const [modalAberto, setModalAberto] = useState(false);
  const [previewAberto, setPreviewAberto] = useState(false);
  const [sessaoVisualizando, setSessaoVisualizando] = useState<SessaoPeriodo | null>(null);
  const [sessaoEditando, setSessaoEditando] = useState<SessaoPeriodo | null>(null);
  const [form, setForm] = useState<FormState>(
    formStateVazio(weekDates[0], String(locais[0]?.id ?? ""), "09:00")
  );
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [arrastando, setArrastando] = useState<number | null>(null);
  const [erroArrastar, setErroArrastar] = useState<string | null>(null);

  function abrirCriacao(dataInicial?: string, horaInicial?: string) {
    setSessaoEditando(null);
    setForm(formStateVazio(dataInicial ?? hojeISO, String(locais[0]?.id ?? ""), horaInicial ?? "09:00"));
    setErro(null);
    setModalAberto(true);
  }

  function abrirEdicao(sessao: SessaoPeriodo) {
    setSessaoEditando(sessao);
    setForm(sessaoParaFormState(sessao));
    setErro(null);
    setModalAberto(true);
  }

  function abrirPreview(sessao: SessaoPeriodo) {
    setSessaoVisualizando(sessao);
    setPreviewAberto(true);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro(null);
    setSalvando(true);

    const dataHoraISO = `${form.data}T${form.hora}:00-03:00`;
    const payload = {
      paciente_id: Number(form.pacienteId),
      local_id: Number(form.localId),
      data_hora: dataHoraISO,
      duracao_minutos: Number(form.duracao),
      modalidade: form.modalidade,
      observacoes: form.observacoes || null,
    };

    const url = sessaoEditando ? `${API_URL}/sessoes/${sessaoEditando.id}` : `${API_URL}/sessoes`;
    const method = sessaoEditando ? "PATCH" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErro(data.detail ?? "Não deu pra salvar a sessão.");
      setSalvando(false);
      return;
    }

    setSalvando(false);
    setModalAberto(false);
    router.refresh();
  }

  async function handleCancelar() {
    if (!sessaoEditando) return;
    setSalvando(true);
    await fetch(`${API_URL}/sessoes/${sessaoEditando.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ status: "cancelada" }),
    });
    setSalvando(false);
    setModalAberto(false);
    router.refresh();
  }

  async function handleDrop(e: React.DragEvent, dateISO: string, hora: string) {
    e.preventDefault();
    const sessaoId = Number(e.dataTransfer.getData("text/plain"));
    setArrastando(null);
    if (!sessaoId) return;

    const sessao = sessoes.find((s) => s.id === sessaoId);
    if (!sessao) return;

    setErroArrastar(null);
    const res = await fetch(`${API_URL}/sessoes/${sessaoId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ data_hora: `${dateISO}T${hora}:00-03:00` }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErroArrastar(data.detail ?? "Não deu pra mover a sessão pra esse horário.");
      return;
    }

    router.refresh();
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-4">
        {erroArrastar ? (
          <p className="text-[13px] font-semibold text-red-600">{erroArrastar}</p>
        ) : (
          <p className="text-[13px] text-muted">Arraste uma sessão pra outro horário pra reagendar</p>
        )}
        <button
          type="button"
          onClick={() => abrirCriacao()}
          className="shrink-0 rounded-xl bg-accent px-4 py-2.5 text-[13.5px] font-bold text-white transition-colors hover:bg-accent-dark"
        >
          + Nova sessão
        </button>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-[0_8px_24px_var(--color-shadow)]">
        <div className="grid min-w-[760px] grid-cols-[56px_repeat(7,1fr)] border-b border-border">
          <div />
          {weekDates.map((dateISO) => {
            const isHoje = dateISO === hojeISO;
            return (
              <div key={dateISO} className="border-l border-border px-2 py-3 text-center">
                <div
                  className={`text-[12px] font-bold uppercase tracking-wide ${isHoje ? "text-accent" : "text-muted"}`}
                >
                  {new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "America/Sao_Paulo" })
                    .format(new Date(`${dateISO}T12:00:00-03:00`))
                    .replace(".", "")}
                </div>
                <div
                  className={`text-[16px] font-extrabold ${
                    isHoje
                      ? "mx-auto flex h-7 w-7 items-center justify-center rounded-full bg-accent text-white"
                      : ""
                  }`}
                >
                  {dateISO.slice(8, 10)}
                </div>
              </div>
            );
          })}
        </div>

        <div
          className="relative grid min-w-[760px] grid-cols-[56px_repeat(7,1fr)]"
          style={{ gridTemplateRows: `repeat(${HORAS.length * 2}, 32px)` }}
        >
          {HORAS.map((hora, i) => (
            <div
              key={hora}
              className="border-t border-border pr-2 text-right text-[11.5px] text-muted"
              style={{ gridColumn: 1, gridRow: `${i * 2 + 1} / span 2` }}
            >
              {String(hora).padStart(2, "0")}:00
            </div>
          ))}

          {weekDates.map((dateISO, dayIndex) =>
            HORAS.flatMap((hora, i) =>
              [0, 30].map((minuto, meia) => {
                const horaLabel = `${pad2(hora)}:${pad2(minuto)}`;
                return (
                  <button
                    key={`${dateISO}-${horaLabel}`}
                    type="button"
                    onClick={() => abrirCriacao(dateISO, horaLabel)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => handleDrop(e, dateISO, horaLabel)}
                    className="border-l border-border hover:bg-accent-soft/40"
                    style={{ gridColumn: dayIndex + 2, gridRow: `${i * 2 + meia + 1} / span 1` }}
                    aria-label={`Nova sessão em ${dateISO} às ${horaLabel}`}
                  />
                );
              })
            )
          )}

          {sessoes.map((sessao) => {
            const pos = sessaoGridPosition(sessao.data_hora, sessao.duracao_minutos);
            if (pos.rowStart < 1 || pos.rowStart > HORAS.length * 2) return null;
            return (
              <button
                key={sessao.id}
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/plain", String(sessao.id));
                  setArrastando(sessao.id);
                }}
                onDragEnd={() => setArrastando(null)}
                onClick={() => abrirPreview(sessao)}
                className={`m-0.5 cursor-grab overflow-hidden rounded-lg border-l-[3px] border-accent bg-accent-soft px-2 py-1 text-left text-[12px] font-bold text-accent-dark hover:brightness-95 active:cursor-grabbing ${
                  arrastando === sessao.id ? "opacity-40" : ""
                }`}
                style={{
                  gridColumn: pos.dayIndex + 2,
                  gridRow: `${pos.rowStart} / span ${pos.rowSpan}`,
                }}
              >
                <span className="block text-[11px] font-semibold opacity-80">
                  {formatHoraBrasilia(sessao.data_hora)}
                </span>
                {sessao.paciente_nome}
                <span className="block truncate text-[10.5px] font-medium opacity-70">
                  {sessao.local_nome}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <Modal open={previewAberto} onClose={() => setPreviewAberto(false)} title="Detalhes da sessão">
        {sessaoVisualizando && (
          <div className="flex flex-col gap-4">
            <InfoRow label="Paciente" valor={sessaoVisualizando.paciente_nome} />
            <InfoRow label="Local" valor={sessaoVisualizando.local_nome} />
            <div className="grid grid-cols-2 gap-3">
              <InfoRow
                label="Data"
                valor={new Intl.DateTimeFormat("pt-BR", {
                  day: "2-digit",
                  month: "2-digit",
                  timeZone: "America/Sao_Paulo",
                }).format(new Date(sessaoVisualizando.data_hora))}
              />
              <InfoRow label="Hora" valor={formatHoraBrasilia(sessaoVisualizando.data_hora)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <InfoRow label="Duração" valor={`${sessaoVisualizando.duracao_minutos} min`} />
              <InfoRow
                label="Modalidade"
                valor={sessaoVisualizando.modalidade === "presencial" ? "Presencial" : "Teleconsulta"}
              />
            </div>
            <InfoRow label="Anotações" valor={sessaoVisualizando.observacoes || "—"} />

            <div className="flex justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={() => setPreviewAberto(false)}
                className="rounded-xl border border-border px-5 py-2.5 text-[14.5px] font-bold text-fg transition-colors hover:bg-accent-soft"
              >
                Fechar
              </button>
              <button
                type="button"
                onClick={() => {
                  setPreviewAberto(false);
                  abrirEdicao(sessaoVisualizando);
                }}
                className="rounded-xl bg-accent px-5 py-2.5 text-[14.5px] font-bold text-white transition-colors hover:bg-accent-dark"
              >
                Editar
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={modalAberto}
        onClose={() => setModalAberto(false)}
        title={sessaoEditando ? "Editar sessão" : "Nova sessão"}
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col">
            <label htmlFor="paciente" className="mb-1.5 text-sm font-semibold">
              Paciente
            </label>
            <select
              id="paciente"
              required
              value={form.pacienteId}
              onChange={(e) => setForm({ ...form, pacienteId: e.target.value })}
              className="rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-3 py-2.5 text-[14.5px] outline-none focus:border-accent"
            >
              <option value="" disabled>
                Selecione um paciente
              </option>
              {pacientes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col">
            <label htmlFor="local" className="mb-1.5 text-sm font-semibold">
              Local
            </label>
            <select
              id="local"
              required
              value={form.localId}
              onChange={(e) => setForm({ ...form, localId: e.target.value })}
              className="rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-3 py-2.5 text-[14.5px] outline-none focus:border-accent"
            >
              {locais.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nome}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col">
              <label htmlFor="data" className="mb-1.5 text-sm font-semibold">
                Data
              </label>
              <input
                id="data"
                type="date"
                required
                value={form.data}
                onChange={(e) => setForm({ ...form, data: e.target.value })}
                className="rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-3 py-2.5 text-[14.5px] outline-none focus:border-accent"
              />
            </div>
            <div className="flex flex-col">
              <label htmlFor="hora" className="mb-1.5 text-sm font-semibold">
                Hora
              </label>
              <input
                id="hora"
                type="time"
                required
                value={form.hora}
                onChange={(e) => setForm({ ...form, hora: e.target.value })}
                className="rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-3 py-2.5 text-[14.5px] outline-none focus:border-accent"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col">
              <label htmlFor="duracao" className="mb-1.5 text-sm font-semibold">
                Duração (min)
              </label>
              <input
                id="duracao"
                type="number"
                min={10}
                step={5}
                required
                value={form.duracao}
                onChange={(e) => setForm({ ...form, duracao: e.target.value })}
                className="rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-3 py-2.5 text-[14.5px] outline-none focus:border-accent"
              />
            </div>
            <div className="flex flex-col">
              <label htmlFor="modalidade" className="mb-1.5 text-sm font-semibold">
                Modalidade
              </label>
              <select
                id="modalidade"
                value={form.modalidade}
                onChange={(e) =>
                  setForm({ ...form, modalidade: e.target.value as "presencial" | "teleconsulta" })
                }
                className="rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-3 py-2.5 text-[14.5px] outline-none focus:border-accent"
              >
                <option value="presencial">Presencial</option>
                <option value="teleconsulta">Teleconsulta</option>
              </select>
            </div>
          </div>

          <div className="flex flex-col">
            <label htmlFor="observacoes" className="mb-1.5 text-sm font-semibold">
              Anotações
            </label>
            <textarea
              id="observacoes"
              rows={3}
              value={form.observacoes}
              onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
              placeholder="Observações sobre a sessão..."
              className="rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-3 py-2.5 text-[14.5px] outline-none focus:border-accent"
            />
          </div>

          {erro && <p className="text-[13px] font-semibold text-red-600">{erro}</p>}

          <div className="flex items-center justify-between gap-3 pt-1">
            {sessaoEditando ? (
              <button
                type="button"
                onClick={handleCancelar}
                disabled={salvando}
                className="text-[13.5px] font-semibold text-red-600 hover:underline disabled:opacity-60"
              >
                Cancelar sessão
              </button>
            ) : (
              <span />
            )}
            <button
              type="submit"
              disabled={salvando}
              className="rounded-xl bg-accent px-5 py-2.5 text-[14.5px] font-bold text-white transition-colors hover:bg-accent-dark disabled:opacity-60"
            >
              {salvando ? "Salvando..." : sessaoEditando ? "Salvar alterações" : "Criar sessão"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
