"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  addMonthsISO,
  formatMesAno,
  getMonthGrid,
  getTodayISO,
} from "@/lib/format";

const API_URL = "/api"; // passa pelo rewrite do Next.js — cookie de sessão nasce no domínio do site
const DIAS_SEMANA = ["D", "S", "T", "Q", "Q", "S", "S"];

export function AgendaDatePicker({ diaSelecionadoISO }: { diaSelecionadoISO: string }) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [aberto, setAberto] = useState(false);
  const [mesReferencia, setMesReferencia] = useState(() => diaSelecionadoISO.slice(0, 8) + "01");
  const [diasComSessao, setDiasComSessao] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!aberto) return;
    setMesReferencia(diaSelecionadoISO.slice(0, 8) + "01");
  }, [aberto, diaSelecionadoISO]);

  useEffect(() => {
    if (!aberto) return;
    const inicio = mesReferencia;
    const fim = addMonthsISO(mesReferencia, 1);
    fetch(`${API_URL}/sessoes/dias?inicio=${inicio}&fim=${fim}`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : []))
      .then((dias: string[]) => setDiasComSessao(new Set(dias)))
      .catch(() => setDiasComSessao(new Set()));
  }, [aberto, mesReferencia]);

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

  function selecionarDia(diaISO: string) {
    setAberto(false);
    router.push(`/agenda?data=${diaISO}`);
  }

  const hojeISO = getTodayISO();
  const celulas = getMonthGrid(mesReferencia);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="rounded-xl border-[1.5px] border-accent px-3.5 py-2 text-[13px] font-extrabold text-accent-dark"
      >
        Hoje
      </button>

      {aberto && (
        <div className="absolute left-0 top-[calc(100%+8px)] z-20 w-[280px] rounded-2xl border border-border bg-card p-4 shadow-[0_10px_30px_var(--color-shadow)]">
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              aria-label="Mês anterior"
              onClick={() => setMesReferencia((m) => addMonthsISO(m, -1))}
              className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-accent-soft hover:text-fg"
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={2.5} />
            </button>
            <span className="text-[13.5px] font-bold">{formatMesAno(mesReferencia)}</span>
            <button
              type="button"
              aria-label="Próximo mês"
              onClick={() => setMesReferencia((m) => addMonthsISO(m, 1))}
              className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-accent-soft hover:text-fg"
            >
              <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1">
            {DIAS_SEMANA.map((d, i) => (
              <div
                key={i}
                className="flex h-7 items-center justify-center text-[11px] font-bold text-muted"
              >
                {d}
              </div>
            ))}
            {celulas.map((diaISO, i) => {
              if (!diaISO) return <div key={i} />;
              const temSessao = diasComSessao.has(diaISO);
              const ehHoje = diaISO === hojeISO;
              const ehSelecionado = diaISO === diaSelecionadoISO;
              return (
                <button
                  key={diaISO}
                  type="button"
                  onClick={() => selecionarDia(diaISO)}
                  className={`relative flex h-8 items-center justify-center rounded-full text-[12.5px] font-semibold transition-colors ${
                    ehSelecionado
                      ? "bg-accent text-white"
                      : ehHoje
                        ? "text-accent-dark"
                        : "text-fg hover:bg-accent-soft"
                  }`}
                >
                  {Number(diaISO.slice(8, 10))}
                  {temSessao && !ehSelecionado && (
                    <span className="absolute bottom-1 h-1 w-1 rounded-full bg-accent" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
