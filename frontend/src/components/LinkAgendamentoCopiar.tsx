"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function LinkAgendamentoCopiar({ slug }: { slug: string }) {
  const [copiado, setCopiado] = useState(false);
  const link =
    typeof window !== "undefined" ? `${window.location.origin}/agendar/${slug}` : `/agendar/${slug}`;

  function copiar() {
    navigator.clipboard.writeText(link);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-accent-soft px-3 py-2.5">
      <span className="flex-1 truncate text-[13.5px] text-accent-dark">{link}</span>
      <button
        type="button"
        onClick={copiar}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-accent-dark hover:bg-accent/10"
        aria-label="Copiar link"
      >
        {copiado ? <Check className="h-4 w-4" strokeWidth={2.5} /> : <Copy className="h-4 w-4" strokeWidth={2} />}
      </button>
    </div>
  );
}
