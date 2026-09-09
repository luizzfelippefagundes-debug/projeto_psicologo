"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function PlaudConexao({ webhookToken }: { webhookToken: string }) {
  const [copiado, setCopiado] = useState(false);
  const url = `https://api.nexosystem.online/plaud/webhook/${webhookToken}`;

  function copiar() {
    navigator.clipboard.writeText(url);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 rounded-xl border border-border bg-accent-soft px-3 py-2.5">
        <span className="flex-1 truncate text-[13.5px] text-accent-dark">{url}</span>
        <button
          type="button"
          onClick={copiar}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-accent-dark hover:bg-accent/10"
          aria-label="Copiar URL do webhook"
        >
          {copiado ? <Check className="h-4 w-4" strokeWidth={2.5} /> : <Copy className="h-4 w-4" strokeWidth={2} />}
        </button>
      </div>
      <ol className="list-decimal space-y-1 pl-4 text-[13px] text-muted">
        <li>Crie um Zap no Zapier.</li>
        <li>
          Gatilho: <strong className="text-fg">Plaud</strong> → &quot;Transcript &amp; Summary Ready&quot;.
        </li>
        <li>
          Ação: <strong className="text-fg">Webhooks by Zapier</strong> → POST, usando a URL acima.
        </li>
      </ol>
    </div>
  );
}
