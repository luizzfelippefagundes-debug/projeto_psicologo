"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export type SelectOption = { value: string; label: string };

export function Select({
  id,
  value,
  onChange,
  options,
  placeholder,
  disabled,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [aberto, setAberto] = useState(false);
  const selecionada = options.find((o) => o.value === value);

  useEffect(() => {
    if (!aberto) return;
    function aoClicarFora(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setAberto(false);
      }
    }
    document.addEventListener("mousedown", aoClicarFora);
    return () => document.removeEventListener("mousedown", aoClicarFora);
  }, [aberto]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => setAberto((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-3 py-2.5 text-left text-[14.5px] outline-none focus:border-accent disabled:opacity-60"
      >
        <span className={selecionada ? "" : "text-muted"}>
          {selecionada?.label ?? placeholder ?? "Selecione"}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted transition-transform ${aberto ? "rotate-180" : ""}`}
          strokeWidth={2}
        />
      </button>

      {aberto && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-20 max-h-64 w-full min-w-[180px] overflow-y-auto rounded-xl border border-border bg-card p-1.5 shadow-[0_10px_30px_var(--color-shadow)]">
          {options.length === 0 ? (
            <p className="px-3 py-2 text-[13.5px] text-muted">Nenhuma opção disponível</p>
          ) : (
            options.map((opcao) => {
              const ativa = opcao.value === value;
              return (
                <button
                  key={opcao.value}
                  type="button"
                  onClick={() => {
                    onChange(opcao.value);
                    setAberto(false);
                  }}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-[14px] font-medium transition-colors ${
                    ativa ? "bg-accent-soft text-accent-dark" : "text-fg hover:bg-accent-soft/60"
                  }`}
                >
                  {opcao.label}
                  {ativa && <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
