"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export function NovoLocalForm() {
  const router = useRouter();
  const [nome, setNome] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro(null);
    setCarregando(true);

    const res = await fetch(`${API_URL}/locais`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ nome }),
    });

    if (!res.ok) {
      setErro("Não deu pra criar o local. Tenta de novo.");
      setCarregando(false);
      return;
    }

    setNome("");
    setCarregando(false);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex flex-1 flex-col">
        <label htmlFor="nome-local" className="mb-1.5 text-sm font-semibold">
          Nome do local
        </label>
        <input
          id="nome-local"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          required
          placeholder="Ex: Consultório Centro"
          className="w-full rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-4 py-2.5 text-[14.5px] outline-none focus:border-accent"
        />
      </div>
      <button
        type="submit"
        disabled={carregando}
        className="rounded-xl bg-accent px-5 py-2.5 text-[14.5px] font-bold text-white transition-colors hover:bg-accent-dark disabled:opacity-60"
      >
        {carregando ? "Criando..." : "Adicionar local"}
      </button>
      {erro && <p className="text-[13px] font-semibold text-red-600">{erro}</p>}
    </form>
  );
}
