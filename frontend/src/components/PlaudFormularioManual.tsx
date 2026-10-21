"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";

const API_URL = "/api";

export function PlaudFormularioManual() {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [transcricao, setTranscricao] = useState("");
  const [resumo, setResumo] = useState("");
  const [gravadoEm, setGravadoEm] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  function limpar() {
    setTitulo("");
    setTranscricao("");
    setResumo("");
    setGravadoEm("");
    setErro(null);
  }

  async function salvar() {
    if (!transcricao.trim() && !resumo.trim()) {
      setErro("Preencha pelo menos a transcrição ou o resumo.");
      return;
    }
    setSalvando(true);
    setErro(null);
    const res = await fetch(`${API_URL}/plaud/gravacoes/manual`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        titulo: titulo.trim() || null,
        transcricao: transcricao.trim() || null,
        resumo: resumo.trim() || null,
        gravado_em: gravadoEm || null,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErro(data.detail ?? "Não foi possível salvar agora, tenta de novo.");
      setSalvando(false);
      return;
    }
    limpar();
    setAberto(false);
    setSalvando(false);
    router.refresh();
  }

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-[13.5px] font-bold text-white hover:bg-accent-dark"
      >
        <Plus className="h-4 w-4" strokeWidth={2.5} />
        Adicionar gravação manualmente
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-[0_8px_24px_var(--color-shadow)]">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[15px] font-bold">Nova gravação (manual)</h2>
        <button
          type="button"
          onClick={() => { limpar(); setAberto(false); }}
          className="rounded-lg p-1.5 text-muted hover:bg-accent-soft hover:text-fg"
          aria-label="Fechar"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>

      <div className="flex flex-col gap-4">
        <div>
          <label className="mb-1.5 block text-[13px] font-semibold text-muted">
            Título <span className="font-normal">(opcional)</span>
          </label>
          <input
            type="text"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Ex: Sessão Maria — 15/10"
            className="w-full rounded-xl border border-border bg-card px-3.5 py-2.5 text-[13.5px] outline-none focus:border-accent"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-[13px] font-semibold text-muted">
            Data da gravação <span className="font-normal">(opcional)</span>
          </label>
          <input
            type="datetime-local"
            value={gravadoEm}
            onChange={(e) => setGravadoEm(e.target.value)}
            className="w-full rounded-xl border border-border bg-card px-3.5 py-2.5 text-[13.5px] outline-none focus:border-accent"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-[13px] font-semibold text-muted">
            Transcrição
          </label>
          <textarea
            value={transcricao}
            onChange={(e) => setTranscricao(e.target.value)}
            placeholder="Cole aqui a transcrição da Plaud..."
            rows={6}
            className="w-full rounded-xl border border-border bg-card px-3.5 py-3 text-[13.5px] leading-relaxed outline-none focus:border-accent"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-[13px] font-semibold text-muted">
            Resumo
          </label>
          <textarea
            value={resumo}
            onChange={(e) => setResumo(e.target.value)}
            placeholder="Cole aqui o resumo da Plaud..."
            rows={4}
            className="w-full rounded-xl border border-border bg-card px-3.5 py-3 text-[13.5px] leading-relaxed outline-none focus:border-accent"
          />
        </div>

        {erro && <p className="text-[13px] font-semibold text-red-600">{erro}</p>}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={salvar}
            disabled={salvando}
            className="rounded-xl bg-accent px-4 py-2.5 text-[13.5px] font-bold text-white hover:bg-accent-dark disabled:opacity-60"
          >
            {salvando ? "Salvando..." : "Salvar gravação"}
          </button>
          <button
            type="button"
            onClick={() => { limpar(); setAberto(false); }}
            disabled={salvando}
            className="rounded-xl border border-border px-4 py-2.5 text-[13.5px] font-bold text-muted hover:bg-accent-soft disabled:opacity-60"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
