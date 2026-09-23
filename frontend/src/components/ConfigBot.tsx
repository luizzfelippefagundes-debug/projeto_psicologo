"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const API_URL = "/api"; // passa pelo rewrite do Next.js — cookie de sessão nasce no domínio do site

export function ConfigBot({
  nomeSecretaria,
  valorConsulta,
}: {
  nomeSecretaria: string | null;
  valorConsulta: number | null;
}) {
  const router = useRouter();
  const [nome, setNome] = useState(nomeSecretaria ?? "");
  const [valor, setValor] = useState(valorConsulta != null ? String(valorConsulta) : "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);

  async function salvar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSalvando(true);
    setErro(null);
    setSalvo(false);

    const valorNumerico = valor.trim() ? Number(valor.replace(",", ".")) : null;
    if (valor.trim() && (valorNumerico === null || Number.isNaN(valorNumerico))) {
      setErro("Valor inválido.");
      setSalvando(false);
      return;
    }

    const res = await fetch(`${API_URL}/auth/me/config-bot`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome_secretaria: nome.trim() || null, valor_consulta: valorNumerico }),
    });

    if (!res.ok) {
      setErro("Não foi possível salvar agora, tenta de novo.");
      setSalvando(false);
      return;
    }

    setSalvando(false);
    setSalvo(true);
    router.refresh();
  }

  return (
    <form onSubmit={salvar} className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col">
        <label htmlFor="nome-secretaria" className="mb-1.5 text-sm font-semibold">
          Nome da secretária virtual
        </label>
        <input
          id="nome-secretaria"
          type="text"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="ex: Laura"
          className="w-52 rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-3 py-2.5 text-[14.5px] outline-none focus:border-accent"
        />
      </div>

      <div className="flex flex-col">
        <label htmlFor="valor-consulta" className="mb-1.5 text-sm font-semibold">
          Valor da consulta (R$)
        </label>
        <input
          id="valor-consulta"
          type="text"
          inputMode="decimal"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder="ex: 400,00"
          className="w-40 rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-3 py-2.5 text-[14.5px] outline-none focus:border-accent"
        />
      </div>

      <button
        type="submit"
        disabled={salvando}
        className="rounded-xl bg-accent px-5 py-2.5 text-[14.5px] font-bold text-white transition-colors hover:bg-accent-dark disabled:opacity-60"
      >
        {salvando ? "Salvando..." : "Salvar"}
      </button>

      {salvo && !erro && <p className="w-full text-[13px] font-semibold text-accent-dark">Salvo.</p>}
      {erro && <p className="w-full text-[13px] font-semibold text-red-600">{erro}</p>}
    </form>
  );
}
