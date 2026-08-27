"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Modal } from "@/components/Modal";
import {
  formatDataHoraBrasilia,
  iniciais,
  labelProcedimento,
  PROCEDIMENTOS,
  type ContatoBot,
  type Paciente,
} from "@/lib/format";

const API_URL = "/api"; // passa pelo rewrite do Next.js — cookie de sessão nasce no domínio do site

type FormState = {
  nome: string;
  telefone: string;
  email: string;
  dataNascimento: string;
  tipoAtendimento: "individual" | "casal";
  tipoProcedimento: string;
  status: "ativo" | "inativo";
  consentimentoLgpd: boolean;
};

function pacienteParaFormState(paciente: Paciente): FormState {
  return {
    nome: paciente.nome,
    telefone: paciente.telefone,
    email: paciente.email ?? "",
    dataNascimento: paciente.data_nascimento ?? "",
    tipoAtendimento: paciente.tipo_atendimento,
    tipoProcedimento: paciente.tipo_procedimento ?? "",
    status: paciente.status,
    consentimentoLgpd: paciente.consentimento_lgpd,
  };
}

function formStateVazio(): FormState {
  return {
    nome: "",
    telefone: "",
    email: "",
    dataNascimento: "",
    tipoAtendimento: "individual",
    tipoProcedimento: "",
    status: "ativo",
    consentimentoLgpd: false,
  };
}

function ContatosCard({
  contatos,
  onCadastrar,
}: {
  contatos: ContatoBot[];
  onCadastrar: (contato: ContatoBot) => void;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card shadow-[0_8px_24px_var(--color-shadow)]">
      <div className="border-b border-border p-6">
        <h2 className="text-[16px] font-bold">Conversaram mas não agendaram</h2>
        <p className="mt-1 text-[13px] text-muted">
          Pessoas que mandaram mensagem pro assistente do WhatsApp mas ainda não têm
          agendamento.
        </p>
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {["Nome", "Telefone", "Última mensagem", ""].map((col) => (
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
          {contatos.map((c) => (
            <tr key={c.telefone_paciente}>
              <td className="border-b border-border px-6 py-4 text-[14.5px] font-bold last:border-0">
                {c.nome_whatsapp ?? "Não informado"}
              </td>
              <td className="border-b border-border px-6 py-4 text-[14.5px] text-muted">
                {c.telefone_paciente}
              </td>
              <td className="border-b border-border px-6 py-4 text-[14.5px] text-muted">
                {formatDataHoraBrasilia(c.atualizado_em)}
              </td>
              <td className="border-b border-border px-6 py-4 text-right">
                <button
                  type="button"
                  onClick={() => onCadastrar(c)}
                  className="rounded-xl border border-border px-3 py-1.5 text-[13px] font-bold text-fg hover:bg-accent-soft"
                >
                  Cadastrar como paciente
                </button>
              </td>
            </tr>
          ))}
          {contatos.length === 0 && (
            <tr>
              <td colSpan={4} className="px-6 py-8 text-center text-[14px] text-muted">
                Ninguém conversou com o bot ainda.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function PacientesCard({
  pacientes,
  busca,
  onBuscaChange,
  onSelecionar,
  onEditar,
}: {
  pacientes: Paciente[];
  busca: string;
  onBuscaChange: (busca: string) => void;
  onSelecionar: (paciente: Paciente) => void;
  onEditar: (paciente: Paciente) => void;
}) {
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
            onChange={(e) => onBuscaChange(e.target.value)}
            placeholder="Buscar paciente..."
            className="bg-transparent outline-none placeholder:text-muted"
          />
        </div>
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr>
            {["Paciente", "Telefone", "Tipo", "Procedimento", "Próxima sessão", "Status"].map((col) => (
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
            <tr
              key={p.id}
              onClick={() => onSelecionar(p)}
              className="cursor-pointer hover:bg-accent-soft/40"
            >
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
                {labelProcedimento(p.tipo_procedimento)}
              </td>
              <td className="border-b border-border px-6 py-4 text-[14.5px] text-muted">
                {p.proxima_sessao ? formatDataHoraBrasilia(p.proxima_sessao) : "—"}
              </td>
              <td className="border-b border-border px-6 py-4">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block rounded-full px-3 py-1 text-[12.5px] font-bold ${
                      p.status === "ativo"
                        ? "bg-accent-soft text-accent-dark"
                        : "bg-black/5 text-muted"
                    }`}
                  >
                    {p.status === "ativo" ? "Ativo" : "Inativo"}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditar(p);
                    }}
                    aria-label="Editar paciente"
                    className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-accent-soft hover:text-fg"
                  >
                    ✎
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {filtrados.length === 0 && (
            <tr>
              <td colSpan={6} className="px-6 py-8 text-center text-[14px] text-muted">
                Nenhum paciente encontrado.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function PacientesTable({
  pacientes,
  contatos,
  abaAtiva,
}: {
  pacientes: Paciente[];
  contatos: ContatoBot[];
  abaAtiva: "pacientes" | "contatos";
}) {
  const router = useRouter();
  const [busca, setBusca] = useState("");
  const [modalAberto, setModalAberto] = useState(false);
  const [pacienteEditando, setPacienteEditando] = useState<Paciente | null>(null);
  const [form, setForm] = useState<FormState>(formStateVazio());
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  function abrirCriacao(prefill?: { nome: string; telefone: string }) {
    setPacienteEditando(null);
    setForm(prefill ? { ...formStateVazio(), ...prefill } : formStateVazio());
    setErro(null);
    setModalAberto(true);
  }

  function abrirEdicao(paciente: Paciente) {
    setPacienteEditando(paciente);
    setForm(pacienteParaFormState(paciente));
    setErro(null);
    setModalAberto(true);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro(null);
    setSalvando(true);

    const payload: Record<string, unknown> = {
      nome: form.nome,
      telefone: form.telefone,
      email: form.email || null,
      data_nascimento: form.dataNascimento || null,
      tipo_atendimento: form.tipoAtendimento,
      consentimento_lgpd: form.consentimentoLgpd,
    };
    if (form.tipoProcedimento) {
      payload.tipo_procedimento = form.tipoProcedimento;
    }
    if (pacienteEditando) {
      payload.status = form.status;
    }

    const url = pacienteEditando
      ? `${API_URL}/pacientes/${pacienteEditando.id}`
      : `${API_URL}/pacientes`;
    const method = pacienteEditando ? "PATCH" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErro(data.detail ?? "Não deu pra salvar o paciente.");
      setSalvando(false);
      return;
    }

    setSalvando(false);
    setModalAberto(false);
    router.refresh();
  }

  return (
    <>
      <div className="mb-4 flex justify-end">
        <button
          type="button"
          onClick={() => abrirCriacao()}
          className="rounded-xl bg-accent px-4 py-2.5 text-[13.5px] font-bold text-white transition-colors hover:bg-accent-dark"
        >
          + Novo paciente
        </button>
      </div>

      <div className="mb-4 flex gap-2">
        <Link
          href="/pacientes?aba=pacientes"
          className={`rounded-xl px-4 py-2 text-[13.5px] font-bold ${
            abaAtiva === "pacientes"
              ? "bg-accent text-white"
              : "border border-border bg-card text-fg"
          }`}
        >
          Pacientes
        </Link>
        <Link
          href="/pacientes?aba=contatos"
          className={`rounded-xl px-4 py-2 text-[13.5px] font-bold ${
            abaAtiva === "contatos"
              ? "bg-accent text-white"
              : "border border-border bg-card text-fg"
          }`}
        >
          Contatos{contatos.length > 0 ? ` (${contatos.length})` : ""}
        </Link>
      </div>

      {abaAtiva === "contatos" ? (
        <ContatosCard
          contatos={contatos}
          onCadastrar={(c) =>
            abrirCriacao({ nome: c.nome_whatsapp ?? "", telefone: c.telefone_paciente })
          }
        />
      ) : (
        <PacientesCard
          pacientes={pacientes}
          busca={busca}
          onBuscaChange={setBusca}
          onSelecionar={(p) => router.push(`/pacientes/${p.id}`)}
          onEditar={abrirEdicao}
        />
      )}

      <Modal
        open={modalAberto}
        onClose={() => setModalAberto(false)}
        title={pacienteEditando ? "Editar paciente" : "Novo paciente"}
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col">
            <label htmlFor="nome" className="mb-1.5 text-sm font-semibold">
              Nome
            </label>
            <input
              id="nome"
              required
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
              placeholder="Nome completo"
              className="rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-3 py-2.5 text-[14.5px] outline-none focus:border-accent"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col">
              <label htmlFor="telefone" className="mb-1.5 text-sm font-semibold">
                Telefone
              </label>
              <input
                id="telefone"
                type="tel"
                required
                value={form.telefone}
                onChange={(e) => setForm({ ...form, telefone: e.target.value })}
                placeholder="11999999999"
                className="rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-3 py-2.5 text-[14.5px] outline-none focus:border-accent"
              />
            </div>
            <div className="flex flex-col">
              <label htmlFor="email" className="mb-1.5 text-sm font-semibold">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="opcional"
                className="rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-3 py-2.5 text-[14.5px] outline-none focus:border-accent"
              />
            </div>
          </div>

          <div className="flex flex-col">
            <label htmlFor="data-nascimento" className="mb-1.5 text-sm font-semibold">
              Data de nascimento
            </label>
            <input
              id="data-nascimento"
              type="date"
              value={form.dataNascimento}
              onChange={(e) => setForm({ ...form, dataNascimento: e.target.value })}
              className="rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-3 py-2.5 text-[14.5px] outline-none focus:border-accent"
            />
          </div>

          <div className="flex flex-col">
            <label htmlFor="tipo-procedimento" className="mb-1.5 text-sm font-semibold">
              Tipo de procedimento
            </label>
            <select
              id="tipo-procedimento"
              required={!pacienteEditando}
              value={form.tipoProcedimento}
              onChange={(e) => setForm({ ...form, tipoProcedimento: e.target.value })}
              className="rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-3 py-2.5 text-[14.5px] outline-none focus:border-accent"
            >
              <option value="" disabled>
                Selecione...
              </option>
              {PROCEDIMENTOS.map((proc) => (
                <option key={proc.value} value={proc.value}>
                  {proc.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col">
              <label htmlFor="tipo" className="mb-1.5 text-sm font-semibold">
                Tipo de atendimento
              </label>
              <select
                id="tipo"
                value={form.tipoAtendimento}
                onChange={(e) =>
                  setForm({ ...form, tipoAtendimento: e.target.value as "individual" | "casal" })
                }
                className="rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-3 py-2.5 text-[14.5px] outline-none focus:border-accent"
              >
                <option value="individual">Individual</option>
                <option value="casal">Casal</option>
              </select>
            </div>
            {pacienteEditando && (
              <div className="flex flex-col">
                <label htmlFor="status" className="mb-1.5 text-sm font-semibold">
                  Status
                </label>
                <select
                  id="status"
                  value={form.status}
                  onChange={(e) =>
                    setForm({ ...form, status: e.target.value as "ativo" | "inativo" })
                  }
                  className="rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-3 py-2.5 text-[14.5px] outline-none focus:border-accent"
                >
                  <option value="ativo">Ativo</option>
                  <option value="inativo">Inativo</option>
                </select>
              </div>
            )}
          </div>

          {pacienteEditando?.consentimento_lgpd ? (
            <p className="text-[13px] text-muted">
              ✓ Consentimento LGPD registrado em{" "}
              {pacienteEditando.consentimento_lgpd_data &&
                formatDataHoraBrasilia(pacienteEditando.consentimento_lgpd_data)}
            </p>
          ) : (
            <label className="flex items-start gap-2.5 text-[13.5px]">
              <input
                type="checkbox"
                required
                checked={form.consentimentoLgpd}
                onChange={(e) => setForm({ ...form, consentimentoLgpd: e.target.checked })}
                className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
              />
              <span>
                O paciente consentiu explicitamente com o tratamento dos seus dados de saúde,
                conforme a LGPD.
              </span>
            </label>
          )}

          {erro && <p className="text-[13px] font-semibold text-red-600">{erro}</p>}

          <div className="flex justify-end pt-1">
            <button
              type="submit"
              disabled={salvando}
              className="rounded-xl bg-accent px-5 py-2.5 text-[14.5px] font-bold text-white transition-colors hover:bg-accent-dark disabled:opacity-60"
            >
              {salvando ? "Salvando..." : pacienteEditando ? "Salvar alterações" : "Criar paciente"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
