"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import type { Local } from "@/lib/format";

const API_URL = "/api"; // passa pelo rewrite do Next.js — cookie de sessão nasce no domínio do site

export function LocaisList({ locais }: { locais: Local[] }) {
  const router = useRouter();
  const [excluindoId, setExcluindoId] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function excluir(local: Local) {
    if (!confirm(`Excluir "${local.nome}"?`)) return;
    setErro(null);
    setExcluindoId(local.id);

    const res = await fetch(`${API_URL}/locais/${local.id}`, {
      method: "DELETE",
      credentials: "include",
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErro(data.detail ?? "Não deu pra excluir esse local.");
      setExcluindoId(null);
      return;
    }

    router.refresh();
  }

  if (locais.length === 0) return null;

  return (
    <div>
      <ul className="mt-5 flex flex-wrap gap-2">
        {locais.map((local) => (
          <li
            key={local.id}
            className="flex items-center gap-1.5 rounded-full bg-accent-soft py-1.5 pl-3.5 pr-1.5 text-[13.5px] font-semibold text-accent-dark"
          >
            {local.nome}
            <button
              type="button"
              onClick={() => excluir(local)}
              disabled={excluindoId === local.id}
              aria-label={`Excluir ${local.nome}`}
              className="flex h-5 w-5 items-center justify-center rounded-full text-accent-dark hover:bg-accent/20 disabled:opacity-50"
            >
              <X className="h-3 w-3" strokeWidth={2.5} />
            </button>
          </li>
        ))}
      </ul>
      {erro && <p className="mt-3 text-[13px] font-semibold text-red-600">{erro}</p>}
    </div>
  );
}
