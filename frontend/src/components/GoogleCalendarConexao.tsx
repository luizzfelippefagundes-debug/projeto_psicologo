"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const API_URL = "/api"; // passa pelo rewrite do Next.js — cookie de sessão nasce no domínio do site

export function GoogleCalendarConexao({ conectado }: { conectado: boolean }) {
  const router = useRouter();
  const [sincronizando, setSincronizando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);

  async function sincronizarAgora() {
    setSincronizando(true);
    setResultado(null);

    const res = await fetch(`${API_URL}/google/sincronizar`, {
      method: "POST",
      credentials: "include",
    });
    const data = await res.json();

    if (data.erro) {
      setResultado(data.erro);
    } else {
      setResultado(
        `Sincronizado: ${data.criados} novo(s), ${data.atualizados} atualizado(s), ${data.removidos} removido(s).`
      );
    }
    setSincronizando(false);
    router.refresh();
  }

  if (!conectado) {
    return (
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[14px] text-muted">
          Conecte seu Google Calendar pra ver suas consultas lá e trazer seus outros compromissos
          pra cá — tudo sincronizado nos dois sentidos.
        </p>
        <a
          href={`${API_URL}/google/conectar`}
          className="shrink-0 rounded-xl bg-accent px-5 py-2.5 text-center text-[14px] font-bold text-white transition-colors hover:bg-accent-dark"
        >
          Conectar Google Calendar
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 rounded-full bg-accent-soft px-3.5 py-1.5 text-[13.5px] font-bold text-accent-dark">
          ✓ Google Calendar conectado
        </span>
        <button
          type="button"
          onClick={sincronizarAgora}
          disabled={sincronizando}
          className="rounded-xl border border-border bg-card px-4 py-2 text-[13.5px] font-semibold transition-colors hover:bg-accent-soft disabled:opacity-60"
        >
          {sincronizando ? "Sincronizando..." : "Sincronizar agora"}
        </button>
      </div>
      {resultado && <p className="text-[13px] text-muted">{resultado}</p>}
    </div>
  );
}
