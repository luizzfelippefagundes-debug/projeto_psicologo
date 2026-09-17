"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addMonthsISO, formatMesAno, getMonthGrid, getTodayISO } from "@/lib/format";

const API_URL = "/api"; // passa pelo rewrite do Next.js — cookie de sessão nasce no domínio do site
const DIAS_SEMANA = ["D", "S", "T", "Q", "Q", "S", "S"];

export function CalendarioMes() {
  const router = useRouter();
  const hojeISO = getTodayISO();
  const [mesReferencia, setMesReferencia] = useState(() => hojeISO.slice(0, 8) + "01");
  const [diasComSessao, setDiasComSessao] = useState<Set<string>>(new Set());

  useEffect(() => {
    const inicio = mesReferencia;
    const fim = addMonthsISO(mesReferencia, 1);
    fetch(`${API_URL}/sessoes/dias?inicio=${inicio}&fim=${fim}`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : []))
      .then((dias: string[]) => setDiasComSessao(new Set(dias)))
      .catch(() => setDiasComSessao(new Set()));
  }, [mesReferencia]);

  const celulas = getMonthGrid(mesReferencia);

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-[0_8px_24px_var(--color-shadow)]">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[16px] font-bold">Calendário</h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Mês anterior"
            onClick={() => setMesReferencia((m) => addMonthsISO(m, -1))}
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-accent-soft hover:text-fg"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={2.5} />
          </button>
          <span className="px-1 text-[14px] font-bold capitalize">{formatMesAno(mesReferencia)}</span>
          <button
            type="button"
            aria-label="Próximo mês"
            onClick={() => setMesReferencia((m) => addMonthsISO(m, 1))}
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-accent-soft hover:text-fg"
          >
            <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {DIAS_SEMANA.map((d, i) => (
          <div key={i} className="flex h-8 items-center justify-center text-[12px] font-bold text-muted">
            {d}
          </div>
        ))}
        {celulas.map((diaISO, i) => {
          if (!diaISO) return <div key={i} />;
          const temSessao = diasComSessao.has(diaISO);
          const ehHoje = diaISO === hojeISO;
          return (
            <button
              key={diaISO}
              type="button"
              onClick={() => router.push(`/agenda?data=${diaISO}`)}
              className={`relative flex h-10 items-center justify-center rounded-full text-[13.5px] font-semibold transition-colors ${
                ehHoje ? "bg-accent text-white" : "text-fg hover:bg-accent-soft"
              }`}
            >
              {Number(diaISO.slice(8, 10))}
              {temSessao && !ehHoje && <span className="absolute bottom-1.5 h-1 w-1 rounded-full bg-accent" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
