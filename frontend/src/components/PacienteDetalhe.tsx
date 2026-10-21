"use client";

import { useRef, useState } from "react";
import {
  Cake,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Mail,
  MessageCircle,
  Phone,
  ShieldCheck,
  Stethoscope,
  Users,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { CAMPOS_ADULTO, CAMPOS_INFANTIL, type CampoAnamnese } from "@/lib/anamneseSchema";
import type { Laudo, PlaudGravacaoPaciente } from "@/lib/api";
import { PlaudHistoricoPaciente } from "@/components/PlaudHistoricoPaciente";
import { LaudosTab } from "@/components/LaudosTab";
import {
  formatDataHoraBrasilia,
  labelProcedimento,
  type AnamneseDetalhe,
  type Paciente,
  type SessaoHistorico,
} from "@/lib/format";

const API_URL = "/api";
const ANOTACOES_MAX = 3000;

const ABAS = ["Visão geral", "Histórico de sessões", "Plaud", "Anamnese", "Laudos", "Anotações"] as const;
type Aba = (typeof ABAS)[number];

const STATUS_SESSAO_LABEL: Record<string, string> = {
  confirmada: "Confirmada",
  concluida: "Concluída",
  cancelada: "Cancelada",
  reservado: "Reservado (bot)",
  nao_compareceu: "Não compareceu",
};

export function PacienteDetalhe({
  paciente,
  sessoes,
  anamnese,
  gravacoesPlaud,
  laudos,
}: {
  paciente: Paciente;
  sessoes: SessaoHistorico[];
  anamnese: AnamneseDetalhe;
  gravacoesPlaud: PlaudGravacaoPaciente[];
  laudos: Laudo[];
}) {
  const [aba, setAba] = useState<Aba>("Visão geral");
  const [anotacoes, setAnotacoes] = useState(paciente.anotacoes ?? "");
  const [salvandoAnotacoes, setSalvandoAnotacoes] = useState(false);
  const [anotacoesSalvas, setAnotacoesSalvas] = useState(true);
  const [tags, setTags] = useState<string[]>(paciente.tags ?? []);
  const [tagInput, setTagInput] = useState("");
  const [adicionandoTag, setAdicionandoTag] = useState(false);
  const tagInputRef = useRef<HTMLInputElement>(null);

  async function salvarAnotacoes() {
    setSalvandoAnotacoes(true);
    await fetch(`${API_URL}/pacientes/${paciente.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ anotacoes: anotacoes || null }),
    });
    setSalvandoAnotacoes(false);
    setAnotacoesSalvas(true);
  }

  async function adicionarTag(tag: string) {
    const nova = tag.trim();
    if (!nova || tags.includes(nova)) return;
    const novas = [...tags, nova];
    setTags(novas);
    setTagInput("");
    await fetch(`${API_URL}/pacientes/${paciente.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ tags: novas }),
    });
  }

  async function removerTag(tag: string) {
    const novas = tags.filter((t) => t !== tag);
    setTags(novas);
    await fetch(`${API_URL}/pacientes/${paciente.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ tags: novas }),
    });
  }

  const digitosTelefone = paciente.telefone.replace(/\D/g, "");
  const linkWhatsapp = digitosTelefone
    ? `https://wa.me/${digitosTelefone.length <= 11 ? `55${digitosTelefone}` : digitosTelefone}`
    : null;
  const ativo = paciente.status === "ativo";

  return (
    <div>
      <div className="mb-6 rounded-[28px] border border-border bg-card p-5 shadow-[0_8px_24px_var(--color-shadow)] sm:p-8">
        <div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="break-words text-2xl font-extrabold sm:text-4xl">{paciente.nome}</h1>
                  <span
                    className={`shrink-0 whitespace-nowrap rounded-full border border-border px-3 py-1 text-[10.5px] font-extrabold uppercase tracking-wider ${
                      ativo ? "bg-accent-soft text-accent-dark" : "bg-card text-muted"
                    }`}
                  >
                    {ativo ? "Ativo" : "Inativo"}
                  </span>
                </div>
                {paciente.email && (
                  <p className="mt-1 break-all text-[15px] text-muted sm:text-[17px]">{paciente.email}</p>
                )}
                <p className="mt-1 text-[12.5px] text-muted">
                  Paciente desde {formatDataHoraBrasilia(paciente.criado_em)}
                </p>
              </div>
              {linkWhatsapp && (
                <a
                  href={linkWhatsapp}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex shrink-0 items-center gap-2 rounded-xl border border-border bg-accent-soft px-4 py-2.5 text-[11.5px] font-extrabold uppercase tracking-wider text-accent-dark transition-colors hover:bg-accent hover:text-white"
                >
                  <MessageCircle className="h-4 w-4" strokeWidth={2.25} />
                  WhatsApp
                </a>
              )}
            </div>

            <div className="mt-7 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              <InfoTile Icon={Phone} label="Telefone" valor={paciente.telefone} />
              <InfoTile Icon={Mail} label="E-mail" valor={paciente.email ?? "—"} />
              <InfoTile Icon={Cake} label="Nascimento" valor={formatNascimento(paciente.data_nascimento)} />
              <InfoTile
                Icon={Users}
                label="Atendimento"
                valor={paciente.tipo_atendimento === "individual" ? "Individual" : "Casal"}
              />
              <InfoTile Icon={Stethoscope} label="Procedimento" valor={labelProcedimento(paciente.tipo_procedimento)} />
              <InfoTile
                Icon={CalendarClock}
                label="Próxima sessão"
                valor={paciente.proxima_sessao ? formatDataHoraBrasilia(paciente.proxima_sessao) : "—"}
              />
            </div>
          </div>
        </div>

        <div className="mt-7 flex flex-wrap items-center gap-1.5 border-t border-border pt-5">
          {tags.map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-1 rounded-full bg-accent-soft px-3 py-1 text-[12px] font-bold text-accent-dark"
            >
              {tag}
              <button
                type="button"
                onClick={() => removerTag(tag)}
                className="ml-0.5 leading-none text-accent-dark/50 hover:text-accent-dark"
              >
                ×
              </button>
            </span>
          ))}
          {adicionandoTag ? (
            <input
              ref={tagInputRef}
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  adicionarTag(tagInput);
                  setAdicionandoTag(false);
                } else if (e.key === "Escape") {
                  setTagInput("");
                  setAdicionandoTag(false);
                }
              }}
              onBlur={() => {
                if (tagInput.trim()) adicionarTag(tagInput);
                setAdicionandoTag(false);
                setTagInput("");
              }}
              placeholder="Palavra-chave..."
              autoFocus
              className="w-36 rounded-full border border-accent bg-transparent px-3 py-1 text-[12px] focus:outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => setAdicionandoTag(true)}
              title="Adicionar palavra-chave"
              className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-muted text-[14px] font-bold text-muted hover:border-accent hover:text-accent"
            >
              +
            </button>
          )}
        </div>
      </div>

      <div className="mb-6 overflow-x-auto rounded-2xl border border-border bg-card p-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex min-w-max gap-1 sm:min-w-0 sm:justify-between">
          {ABAS.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setAba(a)}
              className={`shrink-0 whitespace-nowrap rounded-xl px-4 py-2.5 text-[11.5px] font-extrabold uppercase tracking-wider transition-colors sm:flex-1 ${
                aba === a ? "bg-accent text-white shadow-sm" : "text-muted hover:text-fg"
              }`}
            >
              {a}
            </button>
          ))}
        </div>
      </div>

      {aba === "Visão geral" && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard
              Icon={CalendarDays}
              label="Total de sessões"
              valor={sessoes.length}
              cor="var(--color-accent)"
            />
            <StatCard
              Icon={CheckCircle2}
              label="Sessões concluídas"
              valor={sessoes.filter((s) => s.status === "concluida").length}
              cor="var(--chart-aqua)"
            />
            <StatCard
              Icon={XCircle}
              label="Sessões canceladas"
              valor={sessoes.filter((s) => s.status === "cancelada").length}
              cor="var(--chart-orange)"
            />
          </div>

          <div className="flex items-center gap-4 rounded-2xl border border-border bg-card p-5 shadow-[0_8px_24px_var(--color-shadow)]">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-dark">
              <ShieldCheck className="h-5 w-5" strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Consentimento LGPD</p>
              <p className="mt-0.5 text-[14.5px] font-semibold">
                {paciente.consentimento_lgpd
                  ? `Concedido${
                      paciente.consentimento_lgpd_data
                        ? ` em ${formatDataHoraBrasilia(paciente.consentimento_lgpd_data)}`
                        : ""
                    }`
                  : "Não registrado"}
              </p>
            </div>
          </div>
        </div>
      )}

      {aba === "Histórico de sessões" && (
        <div className="rounded-2xl border border-border bg-card shadow-[0_8px_24px_var(--color-shadow)]">
          {sessoes.length === 0 ? (
            <p className="p-6 text-center text-[14px] text-muted">
              Nenhuma sessão registrada ainda.
            </p>
          ) : (
            <ul>
              {sessoes.map((s) => (
                <li
                  key={s.id}
                  className="border-b border-border px-4 py-3 last:border-0 sm:px-6 sm:py-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-[14px] font-bold">{formatDataHoraBrasilia(s.data_hora)}</p>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11.5px] font-bold ${
                        s.status === "confirmada"
                          ? "bg-accent-soft text-accent-dark"
                          : s.status === "concluida"
                            ? "bg-black/5 text-muted"
                            : s.status === "reservado"
                              ? "bg-gold-soft text-gold"
                              : "bg-red-500/10 text-red-600"
                      }`}
                    >
                      {STATUS_SESSAO_LABEL[s.status]}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[12.5px] text-muted">
                    {s.modalidade === "presencial" ? "Presencial" : "Teleconsulta"} · {s.local_nome} · {s.duracao_minutos} min
                  </p>
                  {s.observacoes && (
                    <p className="mt-1 text-[13px] text-fg">{s.observacoes}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {aba === "Plaud" && <PlaudHistoricoPaciente gravacoes={gravacoesPlaud} />}

      {aba === "Laudos" && (
        <LaudosTab pacienteId={paciente.id} laudosIniciais={laudos} />
      )}

      {aba === "Anotações" && (
        <div className="rounded-2xl border border-border bg-card p-6 shadow-[0_8px_24px_var(--color-shadow)]">
          <div className="mb-3 flex items-center justify-between gap-4">
            <h2 className="text-[16px] font-bold">Anotações</h2>
            <div className="flex items-center gap-3">
              <span className={`text-[12px] ${anotacoes.length > ANOTACOES_MAX ? "text-red-600 font-bold" : "text-muted"}`}>
                {anotacoes.length}/{ANOTACOES_MAX}
              </span>
              {!anotacoesSalvas && (
                <button
                  type="button"
                  onClick={salvarAnotacoes}
                  disabled={salvandoAnotacoes || anotacoes.length > ANOTACOES_MAX}
                  className="rounded-xl bg-accent px-4 py-2 text-[13px] font-bold text-white transition-colors hover:bg-accent-dark disabled:opacity-60"
                >
                  {salvandoAnotacoes ? "Salvando..." : "Salvar"}
                </button>
              )}
              {anotacoesSalvas && anotacoes === (paciente.anotacoes ?? "") && (
                <span className="text-[12.5px] text-muted">Salvo</span>
              )}
            </div>
          </div>
          <textarea
            value={anotacoes}
            onChange={(e) => {
              setAnotacoes(e.target.value);
              setAnotacoesSalvas(false);
            }}
            placeholder="Anotações clínicas, observações ou lembretes sobre esse paciente..."
            rows={12}
            maxLength={ANOTACOES_MAX + 100}
            className="w-full resize-y rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-4 py-3 text-[14px] leading-relaxed outline-none focus:border-accent placeholder:text-muted"
          />
          <p className="mt-2 text-[12px] text-muted">
            Visível somente pra você. Máximo de {ANOTACOES_MAX.toLocaleString("pt-BR")} caracteres.
          </p>
        </div>
      )}

      {aba === "Anamnese" && <AnamnesePainel anamnese={anamnese} />}
    </div>
  );
}

function respondido(valor: string | boolean | undefined | null): boolean {
  return valor !== undefined && valor !== null && valor !== "";
}

function AnamnesePainel({ anamnese }: { anamnese: AnamneseDetalhe }) {
  const [secaoAtiva, setSecaoAtiva] = useState(0);
  const [visao, setVisao] = useState<"respostas" | "mapa">("respostas");

  if (!anamnese || !anamnese.respondido_em) {
    return (
      <div className="rounded-3xl border border-border bg-card p-8 text-center shadow-[0_8px_24px_var(--color-shadow)]">
        <p className="text-[14.5px] text-muted">
          {!anamnese
            ? "Anamnese ainda não foi enviada pra esse paciente."
            : `Formulário enviado em ${formatDataHoraBrasilia(anamnese.enviado_em)}, aguardando resposta.`}
        </p>
      </div>
    );
  }

  const campos = anamnese.tipo_formulario === "infantil" ? CAMPOS_INFANTIL : CAMPOS_ADULTO;
  const respostas = anamnese.respostas ?? {};
  const secoes = Array.from(new Set(campos.map((c) => c.secao)))
    .map((nome) => {
      const doGrupo = campos.filter((c) => c.secao === nome);
      const comResposta = doGrupo.filter((c) => respondido(respostas[c.id]));
      return { nome, comResposta, total: doGrupo.length };
    })
    .filter((sec) => sec.comResposta.length > 0);

  if (secoes.length === 0) {
    return (
      <div className="rounded-3xl border border-border bg-card p-8 text-center shadow-[0_8px_24px_var(--color-shadow)]">
        <p className="text-[14.5px] text-muted">O formulário foi enviado, mas veio sem respostas.</p>
      </div>
    );
  }

  const eixos: Eixo[] = Array.from(new Set(campos.filter((c) => c.tipo === "booleano").map((c) => c.secao)))
    .map((secao) => {
      const bools = campos.filter(
        (c) => c.secao === secao && c.tipo === "booleano" && typeof respostas[c.id] === "boolean"
      );
      const sinalizados = bools.filter((c) => respostas[c.id] === true).map((c) => c.label);
      const nome = secao.replace(/^Histórico médico — /, "");
      return {
        nome: nome.charAt(0).toUpperCase() + nome.slice(1),
        total: bools.length,
        sinalizados,
        pct: bools.length ? Math.round((100 * sinalizados.length) / bools.length) : 0,
      };
    })
    .filter((e) => e.total >= 2);

  const atual = secoes[Math.min(secaoAtiva, secoes.length - 1)];
  const curtos = atual.comResposta.filter((c) => c.tipo === "booleano");
  const longos = atual.comResposta.filter((c) => c.tipo !== "booleano");

  return (
    <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-[0_8px_24px_var(--color-shadow)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-5 sm:px-8">
        <div>
          <h2 className="text-xl font-extrabold">Anamnese</h2>
          <p className="mt-0.5 text-[13.5px] text-muted">
            Formulário {anamnese.tipo_formulario === "infantil" ? "infantil" : "adulto"} respondido em{" "}
            {formatDataHoraBrasilia(anamnese.respondido_em)}
          </p>
        </div>
        <div className="flex gap-1 rounded-xl border border-border bg-accent-soft p-1">
          {(
            [
              ["respostas", "Respostas"],
              ["mapa", "Mapeamento"],
            ] as const
          ).map(([valor, rotulo]) => (
            <button
              key={valor}
              type="button"
              onClick={() => setVisao(valor)}
              className={`rounded-lg px-4 py-2 text-[11px] font-extrabold uppercase tracking-wider transition-colors ${
                visao === valor ? "bg-accent text-white shadow-sm" : "text-muted hover:text-fg"
              }`}
            >
              {rotulo}
            </button>
          ))}
        </div>
      </div>

      {visao === "mapa" ? (
        <MapeamentoClinico eixos={eixos} />
      ) : (

      <div className="grid lg:grid-cols-[300px_1fr]">
        <div className="flex gap-3 overflow-x-auto border-b border-border p-4 lg:flex-col lg:overflow-visible lg:border-b-0 lg:border-r lg:p-6">
          <p className="hidden text-[10.5px] font-extrabold uppercase tracking-wider text-muted lg:block">Seções</p>
          {secoes.map((sec, i) => {
            const ativa = sec === atual;
            return (
              <button
                key={sec.nome}
                type="button"
                onClick={() => setSecaoAtiva(i)}
                className={`w-60 shrink-0 rounded-2xl border-2 p-4 text-left transition-colors lg:w-auto ${
                  ativa ? "border-accent bg-accent-soft" : "border-transparent hover:bg-accent-soft/60"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`text-[10.5px] font-extrabold uppercase tracking-wider ${
                      ativa ? "text-gold" : "text-muted"
                    }`}
                  >
                    Seção {i + 1}
                  </span>
                  {ativa && <span className="h-2 w-2 rounded-full bg-gold" />}
                </div>
                <p className={`mt-1 text-[14.5px] font-extrabold leading-snug ${ativa ? "text-fg" : "text-muted"}`}>
                  {sec.nome}
                </p>
                <p className="mt-1 text-[12px] text-muted">
                  {sec.comResposta.length} {sec.comResposta.length === 1 ? "resposta" : "respostas"}
                </p>
              </button>
            );
          })}
        </div>

        <div className="p-6 sm:p-8">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-gold">Respostas do paciente</p>
          <h3 className="mt-1 text-2xl font-extrabold">{atual.nome}</h3>

          {curtos.length > 0 && (
            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {curtos.map((campo) => {
                const sim = respostas[campo.id] === true;
                return (
                  <div
                    key={campo.id}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-accent-soft/50 px-4 py-3.5"
                  >
                    <p className="text-[13.5px] font-bold">{campo.label}</p>
                    <span
                      className={`shrink-0 rounded-full px-3 py-1 text-[10.5px] font-extrabold uppercase tracking-wider ${
                        sim ? "bg-gold-soft text-gold" : "bg-card text-muted ring-1 ring-border"
                      }`}
                    >
                      {sim ? "Sim" : "Não"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {longos.length > 0 && (
            <div className="mt-4 grid grid-cols-1 gap-3">
              {longos.map((campo) => (
                <div key={campo.id} className="rounded-2xl border border-border bg-accent-soft/50 px-5 py-4">
                  <p className="text-[10.5px] font-extrabold uppercase tracking-wider text-muted">{campo.label}</p>
                  <p className="mt-1.5 whitespace-pre-wrap text-[14.5px] leading-relaxed">
                    {formatValorCampo(campo, respostas[campo.id] as string | boolean)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  );
}

type Eixo = { nome: string; total: number; sinalizados: string[]; pct: number };

function MapeamentoClinico({ eixos }: { eixos: Eixo[] }) {
  if (eixos.length === 0) {
    return (
      <p className="p-8 text-center text-[14px] text-muted">
        Esse formulário não tem perguntas de sim/não suficientes pra montar o mapeamento.
      </p>
    );
  }

  const totalSim = eixos.reduce((acc, e) => acc + e.sinalizados.length, 0);
  const totalItens = eixos.reduce((acc, e) => acc + e.total, 0);
  const pctGeral = totalItens ? Math.round((100 * totalSim) / totalItens) : 0;

  return (
    <div className="grid lg:grid-cols-[1fr_360px]">
      <div className="p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-gold">Mapeamento clínico</p>
            <h3 className="mt-1 text-2xl font-extrabold">Itens marcados como “Sim”</h3>
          </div>
          <div className="text-right">
            <p className="text-[10.5px] font-extrabold uppercase tracking-wider text-muted">Sinalizados</p>
            <p className="text-5xl font-extrabold leading-none text-gold">{pctGeral}%</p>
            <p className="mt-1 text-[12px] text-muted">
              {totalSim} de {totalItens} itens
            </p>
          </div>
        </div>

        {eixos.length >= 3 ? (
          <RadarClinico eixos={eixos} />
        ) : (
          <p className="mt-8 text-[13.5px] text-muted">
            São poucas áreas pra desenhar o radar — veja o detalhamento ao lado.
          </p>
        )}

        <p className="mt-2 text-center text-[11.5px] text-muted">
          Proporção de respostas “Sim” em cada área do formulário. É um resumo das respostas do paciente,
          não um diagnóstico.
        </p>
      </div>

      <div className="flex flex-col gap-3 border-t border-border p-6 lg:border-l lg:border-t-0">
        {eixos.map((eixo) => (
          <div key={eixo.nome} className="rounded-2xl border border-border bg-accent-soft/50 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] font-extrabold uppercase tracking-wider">{eixo.nome}</p>
              <p className={`text-[12.5px] font-extrabold ${eixo.pct > 0 ? "text-gold" : "text-muted"}`}>{eixo.pct}%</p>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border">
              <div className="h-full rounded-full bg-gold" style={{ width: `${eixo.pct}%` }} />
            </div>
            {eixo.sinalizados.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {eixo.sinalizados.map((item) => (
                  <span
                    key={item}
                    className="rounded-full bg-gold-soft px-2.5 py-1 text-[11px] font-bold leading-none text-gold"
                  >
                    {item}
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-[12px] text-muted">Nenhum item sinalizado.</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function RadarClinico({ eixos }: { eixos: Eixo[] }) {
  const largura = 640;
  const altura = 420;
  const cx = largura / 2;
  const cy = altura / 2;
  const raio = 128;
  const n = eixos.length;
  const angulo = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / n;
  const ponto = (i: number, fracao: number) =>
    [cx + raio * fracao * Math.cos(angulo(i)), cy + raio * fracao * Math.sin(angulo(i))] as const;
  const poligono = (fracao: (i: number) => number) =>
    eixos.map((_, i) => ponto(i, fracao(i)).join(",")).join(" ");

  return (
    <svg
      viewBox={`0 0 ${largura} ${altura}`}
      role="img"
      aria-label="Radar do mapeamento clínico por área"
      className="mx-auto mt-4 h-auto w-full max-w-[640px] overflow-visible"
    >
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon key={f} points={poligono(() => f)} fill="none" stroke="var(--color-border)" strokeWidth={1} />
      ))}
      {eixos.map((_, i) => {
        const [x, y] = ponto(i, 1);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--color-border)" strokeWidth={1} />;
      })}
      <polygon
        points={poligono((i) => eixos[i].pct / 100)}
        fill="var(--color-gold)"
        fillOpacity={0.28}
        stroke="var(--color-gold)"
        strokeWidth={2}
        strokeLinejoin="round"
      />
      {eixos.map((eixo, i) => {
        const [x, y] = ponto(i, eixo.pct / 100);
        const [lx, ly] = ponto(i, 1.18);
        const cos = Math.cos(angulo(i));
        return (
          <g key={eixo.nome}>
            <circle cx={x} cy={y} r={4} fill="var(--color-gold)" />
            <text
              x={lx}
              y={ly}
              textAnchor={cos > 0.3 ? "start" : cos < -0.3 ? "end" : "middle"}
              dominantBaseline="middle"
              fontSize={14}
              fontWeight={800}
              letterSpacing="0.06em"
              fill="var(--color-fg)"
            >
              <tspan x={lx} dy="-0.35em">
                {eixo.nome.toUpperCase()}
              </tspan>
              <tspan x={lx} dy="1.5em" fontSize={13} fill={eixo.pct > 0 ? "var(--color-gold)" : "var(--color-muted)"}>
                {eixo.pct}%
              </tspan>
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function formatValorCampo(campo: CampoAnamnese, valor: string | boolean): string {
  if (typeof valor === "boolean") return valor ? "Sim" : "Não";
  // campo "data" vem do <input type="date"> como YYYY-MM-DD (formato do value do HTML,
  // não é como a profissional lê) — mostra em DD/MM/AAAA, formato brasileiro.
  if (campo.tipo === "data" && /^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    const [ano, mes, dia] = valor.split("-");
    return `${dia}/${mes}/${ano}`;
  }
  return valor;
}

function formatNascimento(data: string | null): string {
  if (!data || !/^\d{4}-\d{2}-\d{2}/.test(data)) return "—";
  const [ano, mes, dia] = data.slice(0, 10).split("-").map(Number);
  const hoje = new Date();
  let idade = hoje.getFullYear() - ano;
  if (hoje.getMonth() + 1 < mes || (hoje.getMonth() + 1 === mes && hoje.getDate() < dia)) idade -= 1;
  const dd = String(dia).padStart(2, "0");
  const mm = String(mes).padStart(2, "0");
  return `${dd}/${mm}/${ano} (${idade} anos)`;
}

function InfoTile({ Icon, label, valor }: { Icon: LucideIcon; label: string; valor: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3.5">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-muted">
        <Icon className="h-5 w-5" strokeWidth={2} />
      </span>
      <div className="min-w-0">
        <p className="text-[10.5px] font-extrabold uppercase tracking-wider text-muted">{label}</p>
        <p className="mt-0.5 break-words text-[14.5px] font-bold leading-snug">{valor}</p>
      </div>
    </div>
  );
}

function StatCard({ Icon, label, valor, cor }: { Icon: LucideIcon; label: string; valor: number; cor: string }) {
  return (
    <div
      className="rounded-2xl border border-border border-t-[3px] bg-card p-5 shadow-[0_8px_24px_var(--color-shadow)]"
      style={{ borderTopColor: cor }}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">{label}</p>
        <Icon className="h-[18px] w-[18px] text-muted" strokeWidth={2} />
      </div>
      <p className="mt-3 text-4xl font-extrabold">{valor}</p>
    </div>
  );
}
