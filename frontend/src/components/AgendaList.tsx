"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Pencil, Plus, X } from "lucide-react";
import { Modal } from "@/components/Modal";
import { Select } from "@/components/Select";
import {
  formatHoraBrasilia,
  type Local,
  type Paciente,
  type SessaoPeriodo,
} from "@/lib/format";

const API_URL = "/api"; // passa pelo rewrite do Next.js — cookie de sessão nasce no domínio do site
const HORAS = Array.from({ length: 14 }, (_, i) => 7 + i); // 07:00 .. 20:00

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

const SLOTS = HORAS.flatMap((hora) => [0, 30].map((minuto) => `${pad2(hora)}:${pad2(minuto)}`));

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

// Pra cada horário do dia, diz se ele é o início de uma sessão, se cai dentro de uma
// sessão que começou antes (continuação), ou se está livre.
function posicaoDoSlot(sessoes: SessaoPeriodo[], horaLabel: string) {
  const [hs, ms] = horaLabel.split(":").map(Number);
  const slotMinutos = hs * 60 + ms;

  for (const sessao of sessoes) {
    const inicioLabel = formatHoraBrasilia(sessao.data_hora);
    const [h, m] = inicioLabel.split(":").map(Number);
    const inicioMinutos = h * 60 + m;
    const fimMinutos = inicioMinutos + sessao.duracao_minutos;

    if (slotMinutos === inicioMinutos) return { tipo: "inicio" as const, sessao };
    if (slotMinutos > inicioMinutos && slotMinutos < fimMinutos) {
      return { tipo: "continuacao" as const, sessao };
    }
  }
  return { tipo: "livre" as const, sessao: null };
}

export function AgendaList({
  diaISO,
  sessoes,
  locais,
  pacientes,
}: {
  diaISO: string;
  sessoes: SessaoPeriodo[];
  locais: Local[];
  pacientes: Paciente[];
}) {
  const router = useRouter();
  const [modalAberto, setModalAberto] = useState(false);
  const [previewAberto, setPreviewAberto] = useState(false);
  const [sessaoVisualizando, setSessaoVisualizando] = useState<SessaoPeriodo | null>(null);
  const [sessaoEditando, setSessaoEditando] = useState<SessaoPeriodo | null>(null);
  const [form, setForm] = useState<FormState>(
    formStateVazio(diaISO, String(locais[0]?.id ?? ""), "09:00")
  );
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [pendente, setPendente] = useState<{
    titulo: string;
    mensagem: string;
    executar: (notificar: boolean) => Promise<void>;
  } | null>(null);

  function abrirCriacao(horaInicial?: string) {
    setSessaoEditando(null);
    setForm(formStateVazio(diaISO, String(locais[0]?.id ?? ""), horaInicial ?? "09:00"));
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

  async function salvarSessao(notificar: boolean) {
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
      ...(sessaoEditando ? { notificar } : {}),
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

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!form.pacienteId) {
      setErro("Selecione um paciente.");
      return;
    }

    if (sessaoEditando) {
      const original = sessaoParaFormState(sessaoEditando);
      const mudouHorario = original.data !== form.data || original.hora !== form.hora;
      if (mudouHorario) {
        setPendente({
          titulo: "Salvar alterações",
          mensagem: `A sessão de ${sessaoEditando.paciente_nome} vai mudar de horário. Notificar o paciente por email?`,
          executar: salvarSessao,
        });
        return;
      }
    }

    salvarSessao(false);
  }

  async function cancelarSessao(notificar: boolean) {
    if (!sessaoEditando) return;
    setSalvando(true);
    await fetch(`${API_URL}/sessoes/${sessaoEditando.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ status: "cancelada", notificar }),
    });
    setSalvando(false);
    setModalAberto(false);
    router.refresh();
  }

  function handleCancelarClick() {
    if (!sessaoEditando) return;
    setPendente({
      titulo: "Cancelar sessão",
      mensagem: `Cancelar a sessão de ${sessaoEditando.paciente_nome}? Notificar o paciente por email?`,
      executar: cancelarSessao,
    });
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-4">
        <p className="text-[13px] text-muted">Toque num horário livre pra criar uma sessão</p>
        <button
          type="button"
          onClick={() => abrirCriacao()}
          className="flex shrink-0 items-center gap-1.5 rounded-xl bg-accent px-4 py-2.5 text-[13.5px] font-bold text-white transition-colors hover:bg-accent-dark"
        >
          <Plus className="h-4 w-4" strokeWidth={2.5} />
          Nova sessão
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_8px_24px_var(--color-shadow)]">
        {SLOTS.map((horaLabel) => {
          const pos = posicaoDoSlot(sessoes, horaLabel);

          if (pos.tipo === "continuacao") {
            return (
              <div
                key={horaLabel}
                className="flex items-center gap-2 border-b border-border px-5 py-2 text-[12px] text-muted last:border-0"
              >
                <span className="w-12 shrink-0 font-semibold">{horaLabel}</span>
                <span>↳ continuação do horário anterior</span>
              </div>
            );
          }

          if (pos.tipo === "inicio" && pos.sessao) {
            const sessao = pos.sessao;
            return (
              <button
                key={horaLabel}
                type="button"
                onClick={() => abrirPreview(sessao)}
                className="flex w-full items-center gap-4 border-b border-border px-5 py-3.5 text-left transition-colors last:border-0 hover:bg-accent-soft/40"
              >
                <span className="w-12 shrink-0 text-[13px] font-bold text-muted">{horaLabel}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14.5px] font-bold">{sessao.paciente_nome}</div>
                  <div className="truncate text-[12.5px] text-muted">
                    {sessao.local_nome} ·{" "}
                    {sessao.modalidade === "teleconsulta" ? "Teleconsulta" : "Presencial"}
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-bold ${
                    sessao.status === "confirmada"
                      ? "bg-accent-soft text-accent-dark"
                      : "bg-black/5 text-muted"
                  }`}
                >
                  {sessao.status === "confirmada" ? "Confirmada" : "Concluída"}
                </span>
              </button>
            );
          }

          return (
            <button
              key={horaLabel}
              type="button"
              onClick={() => abrirCriacao(horaLabel)}
              className="flex w-full items-center gap-4 border-b border-border px-5 py-3.5 text-left text-muted transition-colors last:border-0 hover:bg-accent-soft/40"
            >
              <span className="w-12 shrink-0 text-[13px] font-bold">{horaLabel}</span>
              <span className="flex-1 text-[13.5px]">Livre</span>
            </button>
          );
        })}
      </div>

      <Modal open={previewAberto} onClose={() => setPreviewAberto(false)} title="Detalhes da sessão">
        {sessaoVisualizando && (
          <div className="flex flex-col gap-4">
            <InfoRow label="Paciente" valor={sessaoVisualizando.paciente_nome} />
            <InfoRow label="Local" valor={sessaoVisualizando.local_nome} />
            <div className="grid grid-cols-2 gap-3">
              <InfoRow label="Hora" valor={formatHoraBrasilia(sessaoVisualizando.data_hora)} />
              <InfoRow label="Duração" valor={`${sessaoVisualizando.duracao_minutos} min`} />
            </div>
            <InfoRow
              label="Modalidade"
              valor={sessaoVisualizando.modalidade === "presencial" ? "Presencial" : "Teleconsulta"}
            />
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
                className="flex items-center gap-1.5 rounded-xl bg-accent px-5 py-2.5 text-[14.5px] font-bold text-white transition-colors hover:bg-accent-dark"
              >
                <Pencil className="h-3.5 w-3.5" strokeWidth={2.25} />
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
            <Select
              id="paciente"
              value={form.pacienteId}
              onChange={(value) => setForm({ ...form, pacienteId: value })}
              placeholder="Selecione um paciente"
              options={pacientes.map((p) => ({ value: String(p.id), label: p.nome }))}
            />
          </div>

          <div className="flex flex-col">
            <label htmlFor="local" className="mb-1.5 text-sm font-semibold">
              Local
            </label>
            <Select
              id="local"
              value={form.localId}
              onChange={(value) => setForm({ ...form, localId: value })}
              options={locais.map((l) => ({ value: String(l.id), label: l.nome }))}
            />
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
              <Select
                id="modalidade"
                value={form.modalidade}
                onChange={(value) =>
                  setForm({ ...form, modalidade: value as "presencial" | "teleconsulta" })
                }
                options={[
                  { value: "presencial", label: "Presencial" },
                  { value: "teleconsulta", label: "Teleconsulta" },
                ]}
              />
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
                onClick={handleCancelarClick}
                disabled={salvando}
                className="flex items-center gap-1 text-[13.5px] font-semibold text-red-600 hover:underline disabled:opacity-60"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2.5} />
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

      <Modal open={!!pendente} onClose={() => setPendente(null)} title={pendente?.titulo ?? ""}>
        {pendente && (
          <div className="flex flex-col gap-4">
            <p className="text-[14.5px]">{pendente.mensagem}</p>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setPendente(null)}
                className="rounded-xl border border-border px-4 py-2.5 text-[13.5px] font-bold text-fg transition-colors hover:bg-accent-soft"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  const acao = pendente.executar;
                  setPendente(null);
                  acao(false);
                }}
                className="rounded-xl border border-border px-4 py-2.5 text-[13.5px] font-bold text-fg transition-colors hover:bg-accent-soft"
              >
                Salvar sem notificar
              </button>
              <button
                type="button"
                onClick={() => {
                  const acao = pendente.executar;
                  setPendente(null);
                  acao(true);
                }}
                className="rounded-xl bg-accent px-4 py-2.5 text-[13.5px] font-bold text-white transition-colors hover:bg-accent-dark"
              >
                Salvar e notificar
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
