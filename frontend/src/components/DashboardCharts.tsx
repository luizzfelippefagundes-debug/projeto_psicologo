"use client";

import { useState, type CSSProperties } from "react";
import type { DashboardAnalytics } from "@/lib/format";

const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function niceCeil(n: number): number {
  if (n <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(n)));
  const residual = n / magnitude;
  const niceResidual = residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 5 ? 5 : 10;
  return niceResidual * magnitude;
}

function formatSemana(isoDate: string) {
  const [ano, mes, dia] = isoDate.split("-");
  return `${dia}/${mes}`;
}

type BarDatum = { label: string; value: number };

// Tooltips anchor to the hovered mark, but a mark near either edge of the
// chart must flip its anchor inward — otherwise a centered, nowrap tooltip
// overflows the card.
function edgeAwareTooltipStyle(i: number, n: number): CSSProperties {
  if (i <= 1) return { left: 0, transform: "translateX(0)" };
  if (i >= n - 2) return { right: 0, left: "auto", transform: "translateX(0)" };
  return { left: "50%", transform: "translateX(-50%)" };
}

function ColumnChart({
  data,
  colorVar,
  formatTip,
}: {
  data: BarDatum[];
  colorVar: string;
  formatTip?: (d: BarDatum) => string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const maxValue = Math.max(...data.map((d) => d.value), 0);
  // headroom before rounding — otherwise a max that's already a "nice" number
  // (e.g. exactly 5) leaves zero space above the tallest bar and it reads as capped
  const niceMax = niceCeil(maxValue * 1.15);
  const labelReserve = 20; // px reserved above every bar for the direct value label
  const plotAreaHeight = 108; // px — the actual 0..niceMax scale lives in here
  const maxIndex = data.reduce(
    (best, d, i) => (d.value > data[best].value ? i : best),
    0,
  );

  return (
    <div className="w-full">
      <div className="flex" style={{ height: labelReserve + plotAreaHeight }}>
        <div
          className="flex flex-col justify-between pr-2 text-right text-[11px] font-semibold text-muted"
          style={{ height: plotAreaHeight, marginTop: labelReserve, fontVariantNumeric: "tabular-nums" }}
        >
          <span>{niceMax}</span>
          <span>{Math.round(niceMax / 2)}</span>
          <span>0</span>
        </div>
        <div
          className="relative flex flex-1 items-end gap-2 border-l border-border pl-2"
          style={{ height: plotAreaHeight, marginTop: labelReserve }}
        >
          <div className="pointer-events-none absolute inset-x-2 top-0 h-px bg-border/70" />
          <div className="pointer-events-none absolute inset-x-2 top-1/2 h-px bg-border/70" />
          <div className="pointer-events-none absolute inset-x-2 bottom-0 h-px bg-border" />
          {data.map((d, i) => {
            const pct = niceMax === 0 ? 0 : d.value / niceMax;
            const barPx = Math.max(pct * plotAreaHeight, d.value > 0 ? 3 : 0);
            const isMax = i === maxIndex && d.value > 0;
            return (
              <div
                key={d.label}
                className="relative flex-1"
                style={{ height: plotAreaHeight }}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered((h) => (h === i ? null : h))}
              >
                {hovered === i && (
                  <div
                    className="absolute z-10 whitespace-nowrap rounded-lg border border-border bg-card px-2.5 py-1.5 text-[12px] font-semibold shadow-[0_8px_24px_var(--color-shadow)]"
                    style={{ bottom: barPx + 10, ...edgeAwareTooltipStyle(i, data.length) }}
                  >
                    {formatTip ? formatTip(d) : `${d.label}: ${d.value}`}
                  </div>
                )}
                {isMax && (
                  <span
                    className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[11.5px] font-bold text-fg"
                    style={{ bottom: barPx + 4 }}
                  >
                    {d.value}
                  </span>
                )}
                <div
                  className="absolute bottom-0 left-1/2 w-5 -translate-x-1/2 rounded-t-[4px]"
                  style={{ height: barPx, backgroundColor: `var(${colorVar})` }}
                />
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-2 flex gap-2 pl-8">
        {data.map((d) => (
          <span key={d.label} className="flex-1 text-center text-[11.5px] font-semibold text-muted">
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function ProporcaoBar({
  titulo,
  segmentos,
}: {
  titulo: string;
  segmentos: { label: string; value: number; colorVar: string }[];
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const total = segmentos.reduce((s, x) => s + x.value, 0);
  const visiveis = segmentos.filter((s) => s.value > 0);

  return (
    <div>
      <div className="relative flex h-6 w-full overflow-hidden rounded-full bg-border/40">
        {total === 0 ? null : (
          <div className="flex h-full w-full">
            {visiveis.map((seg, i) => (
              <div
                key={seg.label}
                className="relative h-full"
                style={{
                  width: `${(seg.value / total) * 100}%`,
                  marginLeft: i === 0 ? 0 : 2,
                  backgroundColor: `var(${seg.colorVar})`,
                }}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered((h) => (h === i ? null : h))}
              >
                {hovered === i && (
                  <div
                    className="absolute -top-2 z-10 -translate-y-full whitespace-nowrap rounded-lg border border-border bg-card px-2.5 py-1.5 text-[12px] font-semibold shadow-[0_8px_24px_var(--color-shadow)]"
                    style={edgeAwareTooltipStyle(i, visiveis.length)}
                  >
                    {seg.label}: {seg.value}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {segmentos.map((seg) => {
          const pct = total === 0 ? 0 : Math.round((seg.value / total) * 100);
          return (
            <div key={seg.label} className="flex items-center gap-1.5 text-[12.5px]">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: `var(${seg.colorVar})` }}
              />
              <span className="font-semibold text-fg">{seg.label}</span>
              <span className="text-muted">
                {seg.value} ({pct}%)
              </span>
            </div>
          );
        })}
      </div>
      {total === 0 && (
        <p className="mt-2 text-[12.5px] text-muted">Nenhuma sessão registrada em {titulo}.</p>
      )}
    </div>
  );
}

const API_URL = "/api"; // passa pelo rewrite do Next.js — cookie de sessão nasce no domínio do site

const PERIODOS: { dias: number; label: string }[] = [
  { dias: 1, label: "Hoje" },
  { dias: 7, label: "7 dias" },
  { dias: 30, label: "30 dias" },
  { dias: 90, label: "90 dias" },
];

function PeriodoFiltro({
  periodo,
  onChange,
  disabled,
}: {
  periodo: number;
  onChange: (dias: number) => void;
  disabled: boolean;
}) {
  return (
    <div className="mb-5 flex items-center gap-1 rounded-full border border-border bg-card p-1 shadow-[0_8px_24px_var(--color-shadow)]">
      {PERIODOS.map((p) => {
        const ativo = p.dias === periodo;
        return (
          <button
            key={p.dias}
            type="button"
            disabled={disabled}
            onClick={() => onChange(p.dias)}
            className={
              ativo
                ? "rounded-full bg-accent px-3.5 py-1.5 text-[12.5px] font-bold text-white"
                : "rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold text-muted transition-colors hover:bg-border/40 disabled:opacity-60"
            }
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

export function DashboardCharts({ analytics: inicial }: { analytics: DashboardAnalytics }) {
  const [analytics, setAnalytics] = useState(inicial);
  const [periodo, setPeriodo] = useState(inicial.periodo_dias);
  const [loading, setLoading] = useState(false);

  async function trocarPeriodo(dias: number) {
    if (dias === periodo) return;
    setPeriodo(dias);
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/dashboard/analytics?dias=${dias}`, {
        credentials: "include",
      });
      if (res.ok) {
        setAnalytics(await res.json());
      }
    } finally {
      setLoading(false);
    }
  }

  const porDiaSemana: BarDatum[] = analytics.sessoes_por_dia_semana.map((d) => ({
    label: DIAS_SEMANA[d.dia_semana],
    value: d.total,
  }));
  const porSemana: BarDatum[] = analytics.novos_pacientes_por_semana.map((d) => ({
    label: formatSemana(d.semana_inicio),
    value: d.total,
  }));

  const semSessoes = porDiaSemana.every((d) => d.value === 0);
  const semNovosPacientes = porSemana.every((d) => d.value === 0);
  const periodoLabel = PERIODOS.find((p) => p.dias === periodo)?.label.toLowerCase() ?? "período selecionado";

  return (
    <div>
      <PeriodoFiltro periodo={periodo} onChange={trocarPeriodo} disabled={loading} />
      <div
        className={`mb-7 grid grid-cols-1 gap-5 transition-opacity lg:grid-cols-2 ${
          loading ? "opacity-50" : "opacity-100"
        }`}
      >
        <div className="rounded-2xl border border-border bg-card p-6 shadow-[0_8px_24px_var(--color-shadow)]">
          <h2 className="mb-4 text-[16px] font-bold">Sessões por dia da semana</h2>
          {semSessoes ? (
            <p className="text-[13.5px] text-muted">Nenhuma sessão registrada em {periodoLabel}.</p>
          ) : (
            <ColumnChart
              data={porDiaSemana}
              colorVar="--chart-blue"
              formatTip={(d) => `${d.label}: ${d.value} ${d.value === 1 ? "sessão" : "sessões"}`}
            />
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-[0_8px_24px_var(--color-shadow)]">
          <h2 className="mb-4 text-[16px] font-bold">Novos pacientes por semana</h2>
          {semNovosPacientes ? (
            <p className="text-[13.5px] text-muted">Nenhum paciente novo em {periodoLabel}.</p>
          ) : (
            <ColumnChart
              data={porSemana}
              colorVar="--chart-orange"
              formatTip={(d) => `Semana de ${d.label}: ${d.value} novo${d.value === 1 ? "" : "s"} paciente${d.value === 1 ? "" : "s"}`}
            />
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-[0_8px_24px_var(--color-shadow)]">
          <h2 className="mb-4 text-[16px] font-bold">Presencial x Teleconsulta</h2>
          <ProporcaoBar
            titulo={periodoLabel}
            segmentos={[
              { label: "Presencial", value: analytics.sessoes_por_modalidade.presencial, colorVar: "--chart-magenta" },
              { label: "Teleconsulta", value: analytics.sessoes_por_modalidade.teleconsulta, colorVar: "--chart-yellow" },
            ]}
          />
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-[0_8px_24px_var(--color-shadow)]">
          <h2 className="mb-4 text-[16px] font-bold">Status das sessões</h2>
          <ProporcaoBar
            titulo={periodoLabel}
            segmentos={[
              { label: "Confirmada", value: analytics.sessoes_por_status.confirmada, colorVar: "--chart-blue" },
              { label: "Concluída", value: analytics.sessoes_por_status.concluida, colorVar: "--chart-aqua" },
              { label: "Cancelada", value: analytics.sessoes_por_status.cancelada, colorVar: "--chart-orange" },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
