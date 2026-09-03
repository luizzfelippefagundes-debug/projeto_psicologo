"use client";

import { useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Calendar } from "lucide-react";
import { Modal } from "@/components/Modal";
import {
  addMonthsISO,
  formatDiaMesCurto,
  formatDiaSemanaCurto,
  formatMesAno,
  getMonthGrid,
  getTodayISO,
} from "@/lib/format";

const DIAS_SEMANA = ["D", "S", "T", "Q", "Q", "S", "S"];

// Pill de data persistente, igual ao padrão do projeto da barbearia: mostra a data
// escolhida e abre um calendário pra trocar — sem navegação de página, controlado
// por props (o pai é quem guarda o estado da data e refaz a busca de horários).
export function AgendarDataPicker({
  dataSelecionada,
  onSelect,
}: {
  dataSelecionada: string;
  onSelect: (dataISO: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [mesReferencia, setMesReferencia] = useState(() => dataSelecionada.slice(0, 8) + "01");
  const hojeISO = getTodayISO();
  const celulas = getMonthGrid(mesReferencia);

  function abrir() {
    setMesReferencia(dataSelecionada.slice(0, 8) + "01");
    setAberto(true);
  }

  function selecionar(diaISO: string) {
    onSelect(diaISO);
    setAberto(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        className="mb-5 flex w-full items-center gap-3 rounded-2xl border-[1.5px] border-accent bg-accent-soft px-4 py-3 text-left"
      >
        <Calendar className="h-5 w-5 shrink-0 text-accent-dark" strokeWidth={2} />
        <div className="flex-1">
          <p className="text-[14.5px] font-bold">
            {dataSelecionada === hojeISO
              ? "Hoje"
              : `${formatDiaSemanaCurto(dataSelecionada)}, ${formatDiaMesCurto(dataSelecionada)}`}
          </p>
          <p className="text-[11.5px] font-semibold text-accent-dark">Para alterar a data, clique aqui</p>
        </div>
        <ChevronDown className="h-4 w-4 shrink-0 text-accent-dark" strokeWidth={2.5} />
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
              <div key={i} className="flex h-8 items-center justify-center text-[12px] font-bold text-muted">
                {d}
              </div>
            ))}
            {celulas.map((diaISO, i) => {
              if (!diaISO) return <div key={i} />;
              const passado = diaISO < hojeISO;
              const ehHoje = diaISO === hojeISO;
              const ehSelecionado = diaISO === dataSelecionada;
              return (
                <button
                  key={diaISO}
                  type="button"
                  disabled={passado}
                  onClick={() => selecionar(diaISO)}
                  className={`flex h-10 items-center justify-center rounded-full text-[13.5px] font-semibold transition-colors ${
                    ehSelecionado
                      ? "bg-accent text-white"
                      : passado
                        ? "text-border"
                        : ehHoje
                          ? "text-accent-dark"
                          : "text-fg hover:bg-accent-soft"
                  }`}
                >
                  {Number(diaISO.slice(8, 10))}
                </button>
              );
            })}
          </div>
        </div>
      </Modal>
    </>
  );
}
