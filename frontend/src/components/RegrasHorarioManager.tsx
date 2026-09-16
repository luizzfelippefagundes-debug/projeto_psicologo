"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Modal } from "@/components/Modal";
import { Select } from "@/components/Select";
import { DIAS_SEMANA, formatHoraCurta, type Local, type RegraHorario } from "@/lib/format";

// Junta regras do mesmo horário (ex: Segunda a Sexta, 08:00-18:00 cada uma como uma
// linha separada) numa única linha, pra não parecer repetição/duplicata na tela.
function agruparPorHorario(regras: RegraHorario[]) {
  const grupos = new Map<string, { horaInicio: string; horaFim: string; regras: RegraHorario[] }>();
  for (const regra of regras) {
    const chave = `${regra.hora_inicio}-${regra.hora_fim}`;
    const grupo = grupos.get(chave);
    if (grupo) {
      grupo.regras.push(regra);
    } else {
      grupos.set(chave, { horaInicio: regra.hora_inicio, horaFim: regra.hora_fim, regras: [regra] });
    }
  }
  return Array.from(grupos.values()).sort((a, b) => a.horaInicio.localeCompare(b.horaInicio));
}

function formatarDias(regras: RegraHorario[]): string {
  const dias = [...new Set(regras.map((r) => r.dia_semana))].sort((a, b) => a - b);
  if (dias.length === 7) return "Todos os dias";
  if (dias.length === 5 && dias.every((d, i) => d === i + 1)) return "Dias úteis (Seg a Sex)";

  // Compacta sequências consecutivas (ex: [1,2,3] vira "Seg a Qua")
  const partes: string[] = [];
  let inicio = dias[0];
  let fim = dias[0];
  for (let i = 1; i <= dias.length; i++) {
    if (i < dias.length && dias[i] === fim + 1) {
      fim = dias[i];
      continue;
    }
    partes.push(
      fim > inicio
        ? `${DIAS_SEMANA[inicio].slice(0, 3)} a ${DIAS_SEMANA[fim].slice(0, 3)}`
        : DIAS_SEMANA[inicio].slice(0, 3)
    );
    if (i < dias.length) {
      inicio = dias[i];
      fim = dias[i];
    }
  }
  return partes.join(", ");
}

const API_URL = "/api"; // passa pelo rewrite do Next.js — cookie de sessão nasce no domínio do site

type EdicaoState = {
  ids: number[];
  localId: string;
  dias: number[];
  horaInicio: string;
  horaFim: string;
};

function DiasSemanaSeletor({
  dias,
  onChange,
}: {
  dias: number[];
  onChange: (dias: number[]) => void;
}) {
  function alternarDia(dia: number) {
    onChange(dias.includes(dia) ? dias.filter((d) => d !== dia) : [...dias, dia].sort());
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">Dias da semana</span>
        <div className="flex gap-3 text-[12.5px] font-semibold">
          <button type="button" onClick={() => onChange([0, 1, 2, 3, 4, 5, 6])} className="text-accent hover:underline">
            Semana toda
          </button>
          <button type="button" onClick={() => onChange([1, 2, 3, 4, 5])} className="text-accent hover:underline">
            Dias úteis
          </button>
          <button type="button" onClick={() => onChange([])} className="text-muted hover:underline">
            Limpar
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {DIAS_SEMANA.map((dia, i) => {
          const ativo = dias.includes(i);
          return (
            <button
              key={dia}
              type="button"
              onClick={() => alternarDia(i)}
              aria-pressed={ativo}
              className={
                ativo
                  ? "rounded-full bg-accent px-3.5 py-1.5 text-[13px] font-bold text-white"
                  : "rounded-full border-[1.5px] border-border bg-[var(--color-accent-soft)] px-3.5 py-1.5 text-[13px] font-semibold text-accent-dark transition-colors hover:border-accent"
              }
            >
              {dia.slice(0, 3)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function RegrasHorarioManager({
  locais,
  regras,
}: {
  locais: Local[];
  regras: RegraHorario[];
}) {
  const router = useRouter();
  const [localId, setLocalId] = useState(String(locais[0]?.id ?? ""));
  const [diasSelecionados, setDiasSelecionados] = useState<number[]>([]);
  const [horaInicio, setHoraInicio] = useState("08:00");
  const [horaFim, setHoraFim] = useState("18:00");
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  const [edicao, setEdicao] = useState<EdicaoState | null>(null);
  const [erroEdicao, setErroEdicao] = useState<string | null>(null);
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro(null);

    if (diasSelecionados.length === 0) {
      setErro("Selecione ao menos um dia.");
      return;
    }

    setCarregando(true);

    const res = await fetch(`${API_URL}/regras-horario`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        local_id: Number(localId),
        dias_semana: diasSelecionados,
        hora_inicio: horaInicio,
        hora_fim: horaFim,
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErro(data.detail ?? "Não deu pra criar a regra.");
      setCarregando(false);
      return;
    }

    setDiasSelecionados([]);
    setCarregando(false);
    router.refresh();
  }

  async function handleRemover(ids: number[]) {
    await Promise.all(
      ids.map((id) =>
        fetch(`${API_URL}/regras-horario/${id}`, { method: "DELETE", credentials: "include" })
      )
    );
    router.refresh();
  }

  function abrirEdicao(localIdDoGrupo: number, grupo: { horaInicio: string; horaFim: string; regras: RegraHorario[] }) {
    setEdicao({
      ids: grupo.regras.map((r) => r.id),
      localId: String(localIdDoGrupo),
      dias: [...new Set(grupo.regras.map((r) => r.dia_semana))].sort(),
      horaInicio: grupo.horaInicio,
      horaFim: grupo.horaFim,
    });
    setErroEdicao(null);
  }

  async function handleSalvarEdicao(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!edicao) return;
    setErroEdicao(null);

    if (edicao.dias.length === 0) {
      setErroEdicao("Selecione ao menos um dia.");
      return;
    }

    setSalvandoEdicao(true);

    // Editar é implementado como excluir o horário antigo e criar o novo — o
    // backend não tem um PATCH pra "mover" um grupo de regras pra outros dias/horas.
    await Promise.all(
      edicao.ids.map((id) =>
        fetch(`${API_URL}/regras-horario/${id}`, { method: "DELETE", credentials: "include" })
      )
    );

    const res = await fetch(`${API_URL}/regras-horario`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        local_id: Number(edicao.localId),
        dias_semana: edicao.dias,
        hora_inicio: edicao.horaInicio,
        hora_fim: edicao.horaFim,
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErroEdicao(data.detail ?? "Não deu pra salvar as alterações.");
      setSalvandoEdicao(false);
      return;
    }

    setSalvandoEdicao(false);
    setEdicao(null);
    router.refresh();
  }

  const regrasPorLocal = locais.map((local) => ({
    local,
    regras: regras.filter((r) => r.local_id === local.id),
  }));

  return (
    <div className="flex flex-col gap-6">
      <p className="text-[13px] text-muted">
        Pode adicionar mais de um horário pro mesmo dia — por exemplo, manhã e tarde separados, com um
        intervalo no meio. É só preencher o formulário de novo com o mesmo dia e um horário diferente.
      </p>
      <form
        onSubmit={handleSubmit}
        className="flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-card p-5 shadow-[0_8px_24px_var(--color-shadow)]"
      >
        <div className="flex flex-col">
          <label htmlFor="local" className="mb-1.5 text-sm font-semibold">
            Local
          </label>
          <Select
            id="local"
            value={localId}
            onChange={setLocalId}
            options={locais.map((local) => ({ value: String(local.id), label: local.nome }))}
          />
        </div>

        <DiasSemanaSeletor dias={diasSelecionados} onChange={setDiasSelecionados} />

        <div className="flex flex-col">
          <label htmlFor="inicio" className="mb-1.5 text-sm font-semibold">
            Início
          </label>
          <input
            id="inicio"
            type="time"
            value={horaInicio}
            onChange={(e) => setHoraInicio(e.target.value)}
            className="rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-3 py-2.5 text-[14.5px] outline-none focus:border-accent"
          />
        </div>

        <div className="flex flex-col">
          <label htmlFor="fim" className="mb-1.5 text-sm font-semibold">
            Fim
          </label>
          <input
            id="fim"
            type="time"
            value={horaFim}
            onChange={(e) => setHoraFim(e.target.value)}
            className="rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-3 py-2.5 text-[14.5px] outline-none focus:border-accent"
          />
        </div>

        <button
          type="submit"
          disabled={carregando || !localId || diasSelecionados.length === 0}
          className="rounded-xl bg-accent px-5 py-2.5 text-[14.5px] font-bold text-white transition-colors hover:bg-accent-dark disabled:opacity-60"
        >
          {carregando
            ? "Adicionando..."
            : diasSelecionados.length > 1
              ? `Adicionar horário (${diasSelecionados.length} dias)`
              : "Adicionar horário"}
        </button>

        {erro && <p className="w-full text-[13px] font-semibold text-red-600">{erro}</p>}
      </form>

      <div className="flex flex-col gap-4">
        {regrasPorLocal.map(({ local, regras: regrasDoLocal }) => (
          <div
            key={local.id}
            className="rounded-2xl border border-border bg-card p-5 shadow-[0_8px_24px_var(--color-shadow)]"
          >
            <h3 className="mb-3 text-[15px] font-bold">{local.nome}</h3>
            {regrasDoLocal.length === 0 ? (
              <p className="text-[13.5px] text-muted">Nenhum horário cadastrado ainda.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {agruparPorHorario(regrasDoLocal).map((grupo) => (
                  <li
                    key={`${grupo.horaInicio}-${grupo.horaFim}`}
                    className="flex items-center justify-between rounded-xl bg-accent-soft px-4 py-2.5 text-[14px]"
                  >
                    <span className="font-semibold text-accent-dark">
                      {formatarDias(grupo.regras)} · {formatHoraCurta(grupo.horaInicio)} –{" "}
                      {formatHoraCurta(grupo.horaFim)}
                    </span>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => abrirEdicao(local.id, grupo)}
                        className="text-[13px] font-semibold text-accent-dark hover:underline"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemover(grupo.regras.map((r) => r.id))}
                        className="text-[13px] font-semibold text-red-600 hover:underline"
                      >
                        Remover
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      <Modal open={edicao !== null} onClose={() => setEdicao(null)} title="Editar horário">
        {edicao && (
          <form onSubmit={handleSalvarEdicao} className="flex flex-col gap-4">
            <div className="flex flex-col">
              <label htmlFor="edicao-local" className="mb-1.5 text-sm font-semibold">
                Local
              </label>
              <Select
                id="edicao-local"
                value={edicao.localId}
                onChange={(value) => setEdicao({ ...edicao, localId: value })}
                options={locais.map((local) => ({ value: String(local.id), label: local.nome }))}
              />
            </div>

            <DiasSemanaSeletor dias={edicao.dias} onChange={(dias) => setEdicao({ ...edicao, dias })} />

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col">
                <label htmlFor="edicao-inicio" className="mb-1.5 text-sm font-semibold">
                  Início
                </label>
                <input
                  id="edicao-inicio"
                  type="time"
                  value={edicao.horaInicio}
                  onChange={(e) => setEdicao({ ...edicao, horaInicio: e.target.value })}
                  className="rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-3 py-2.5 text-[14.5px] outline-none focus:border-accent"
                />
              </div>
              <div className="flex flex-col">
                <label htmlFor="edicao-fim" className="mb-1.5 text-sm font-semibold">
                  Fim
                </label>
                <input
                  id="edicao-fim"
                  type="time"
                  value={edicao.horaFim}
                  onChange={(e) => setEdicao({ ...edicao, horaFim: e.target.value })}
                  className="rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-3 py-2.5 text-[14.5px] outline-none focus:border-accent"
                />
              </div>
            </div>

            {erroEdicao && <p className="text-[13px] font-semibold text-red-600">{erroEdicao}</p>}

            <button
              type="submit"
              disabled={salvandoEdicao}
              className="rounded-xl bg-accent px-5 py-2.5 text-[14.5px] font-bold text-white transition-colors hover:bg-accent-dark disabled:opacity-60"
            >
              {salvandoEdicao ? "Salvando..." : "Salvar alterações"}
            </button>
          </form>
        )}
      </Modal>
    </div>
  );
}
