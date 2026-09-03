"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Modal } from "@/components/Modal";
import {
  addMonthsISO,
  formatDiaMesCurto,
  formatDiaSemanaCurto,
  formatMesAno,
  getMonthGrid,
  getTodayISO,
} from "@/lib/format";

const API_URL = "/api"; // passa pelo rewrite do Next.js — cookie de sessão nasce no domínio do site
const DIAS_SEMANA = ["D", "S", "T", "Q", "Q", "S", "S"];

export function AgendaDatePicker({ diaSelecionadoISO }: { diaSelecionadoISO: string }) {
  const router = useRouter();
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

  function selecionarDia(diaISO: string) {
    setAberto(false);
    router.push(`/agenda?data=${diaISO}`);
  }

  const hojeISO = getTodayISO();
  const celulas = getMonthGrid(mesReferencia);

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="rounded-xl border-[1.5px] border-accent px-3.5 py-2 text-[13px] font-extrabold text-accent-dark"
      >
        {formatDiaSemanaCurto(diaSelecionadoISO)}, {formatDiaMesCurto(diaSelecionadoISO)}
      </button>

      <Modal open={aberto} onClose={() => setAberto(false)} title="Escolher data">
        <div>
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              aria-label="Mês anterior"
              onClick={() => setMesReferencia((m) => addMonthsISO(m, -1))}
              className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-accent-soft hover:text-fg"
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={2.5} />
            </button>
            <span className="text-[14.5px] font-bold">{formatMesAno(mesReferencia)}</span>
            <button
              type="button"
              aria-label="Próximo mês"
              onClick={() => setMesReferencia((m) => addMonthsISO(m, 1))}
              className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-accent-soft hover:text-fg"
            >
              <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1">
            {DIAS_SEMANA.map((d, i) => (
              <div
                key={i}
                className="flex h-8 items-center justify-center text-[12px] font-bold text-muted"
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
                  className={`relative flex h-10 items-center justify-center rounded-full text-[13.5px] font-semibold transition-colors ${
                    ehSelecionado
                      ? "bg-accent text-white"
                      : ehHoje
                        ? "text-accent-dark"
                        : "text-fg hover:bg-accent-soft"
                  }`}
                >
                  {Number(diaISO.slice(8, 10))}
                  {temSessao && !ehSelecionado && (
                    <span className="absolute bottom-1.5 h-1 w-1 rounded-full bg-accent" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </Modal>
    </>
  );
}
