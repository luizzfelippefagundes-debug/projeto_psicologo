"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Folder, FolderOpen, Pencil } from "lucide-react";
import type { PlaudGravacaoLista } from "@/lib/api";
import { formatDataHoraBrasilia } from "@/lib/format";
import { MarkdownTexto, textoSimples } from "@/components/MarkdownTexto";
import { TranscricaoChat } from "@/components/TranscricaoChat";
import { MapaMentalPlaud } from "@/components/MapaMentalPlaud";

const API_URL = "/api"; // passa pelo rewrite do Next.js — cookie de sessão nasce no domínio do site
const CHAVE_SEM_VINCULO = "__sem_vinculo__";

type Grupo = { chave: string; nome: string; gravacoes: PlaudGravacaoLista[] };
type Aba = "resumo" | "texto" | "mapa" | "transcricao";
type DadosPaciente = { nome: string | null; data_nascimento: string | null };

const ABAS: [Aba, string][] = [
  ["resumo", "Resumo"],
  ["texto", "Texto pronto"],
  ["mapa", "Mapa mental"],
  ["transcricao", "Transcrição"],
];

function agruparPorPaciente(gravacoes: PlaudGravacaoLista[]): Grupo[] {
  const mapa = new Map<string, Grupo>();
  for (const g of gravacoes) {
    const chave = g.paciente_nome ?? CHAVE_SEM_VINCULO;
    if (!mapa.has(chave)) {
      mapa.set(chave, { chave, nome: g.paciente_nome ?? "Não vinculadas", gravacoes: [] });
    }
    mapa.get(chave)!.gravacoes.push(g);
  }
  // gravacoes já chega ordenada por mais recente primeiro — preserva essa ordem entre
  // pastas (paciente com gravação mais recente aparece primeiro), só a pasta "Não
  // vinculadas" vai sempre pro topo por precisar de ação.
  return [...mapa.values()].sort((a, b) =>
    a.chave === CHAVE_SEM_VINCULO ? -1 : b.chave === CHAVE_SEM_VINCULO ? 1 : 0
  );
}

function AcaoDetectarPaciente({ gravacaoId, temTranscricao }: { gravacaoId: number; temTranscricao: boolean }) {
  const [dados, setDados] = useState<DadosPaciente | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function detectar() {
    setCarregando(true);
    setErro(null);
    const res = await fetch(`${API_URL}/plaud/gravacoes/${gravacaoId}/extrair-paciente`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErro(data.detail ?? "Não foi possível analisar agora, tenta de novo.");
      setCarregando(false);
      return;
    }
    setDados(await res.json());
    setCarregando(false);
  }

  if (dados) {
    if (!dados.nome) {
      return (
        <div className="rounded-xl bg-black/5 p-3.5 text-[13.5px] text-muted">
          Não conseguimos identificar automaticamente.{" "}
          <a href="/pacientes" className="font-semibold text-accent-dark hover:underline">
            Cadastrar manualmente
          </a>
        </div>
      );
    }
    const params = new URLSearchParams({ prefill_nome: dados.nome });
    if (dados.data_nascimento) params.set("prefill_nascimento", dados.data_nascimento);
    return (
      <div className="rounded-xl bg-accent-soft p-3.5 text-[13.5px]">
        <p className="font-bold text-fg">
          {dados.nome}
          {dados.data_nascimento ? ` · nascido em ${dados.data_nascimento}` : ""}
        </p>
        <a
          href={`/pacientes?${params.toString()}`}
          className="mt-2 inline-block rounded-xl bg-accent px-3.5 py-2 text-[13px] font-bold text-white hover:bg-accent-dark"
        >
          Usar esses dados pra criar cadastro
        </a>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={detectar}
        disabled={carregando || !temTranscricao}
        className="rounded-xl border border-border px-3.5 py-2 text-[13px] font-bold text-muted hover:bg-accent-soft hover:text-fg disabled:opacity-60"
      >
        {carregando ? "Analisando..." : "Detectar dados do paciente"}
      </button>
      {erro && <p className="mt-2 text-[13px] font-semibold text-red-600">{erro}</p>}
    </div>
  );
}

function GravacaoCard({ g, aberto, onToggle }: { g: PlaudGravacaoLista; aberto: boolean; onToggle: () => void }) {
  const router = useRouter();
  const [aba, setAba] = useState<Aba>("resumo");
  const [textoCurto, setTextoCurto] = useState(g.texto_curto);
  const [gerando, setGerando] = useState(false);
  const [erroTexto, setErroTexto] = useState<string | null>(null);
  const [excluindo, setExcluindo] = useState(false);
  const [erroExcluir, setErroExcluir] = useState<string | null>(null);
  const [titulo, setTitulo] = useState(g.titulo);
  const [editandoTitulo, setEditandoTitulo] = useState(false);
  const [tituloRascunho, setTituloRascunho] = useState(g.titulo ?? "");
  const [salvandoTitulo, setSalvandoTitulo] = useState(false);
  const [erroTitulo, setErroTitulo] = useState<string | null>(null);

  const rotulo =
    titulo || (g.gravado_em ? formatDataHoraBrasilia(g.gravado_em) : formatDataHoraBrasilia(g.recebido_em));

  function abrirEdicaoTitulo() {
    setTituloRascunho(titulo ?? "");
    setErroTitulo(null);
    setEditandoTitulo(true);
  }

  async function salvarTitulo() {
    const novoTitulo = tituloRascunho.trim();
    if (!novoTitulo) {
      setErroTitulo("O título não pode ficar em branco.");
      return;
    }
    setSalvandoTitulo(true);
    setErroTitulo(null);
    const res = await fetch(`${API_URL}/plaud/gravacoes/${g.id}/titulo`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ titulo: novoTitulo }),
    });
    if (!res.ok) {
      setErroTitulo("Não foi possível salvar agora, tenta de novo.");
      setSalvandoTitulo(false);
      return;
    }
    setTitulo(novoTitulo);
    setSalvandoTitulo(false);
    setEditandoTitulo(false);
  }

  async function gerarTextoCurto() {
    setGerando(true);
    setErroTexto(null);
    const res = await fetch(`${API_URL}/plaud/gravacoes/${g.id}/texto-curto`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErroTexto(data.detail ?? "Não foi possível gerar o texto agora, tenta de novo.");
      setGerando(false);
      return;
    }
    const data: { texto_curto: string } = await res.json();
    setTextoCurto(data.texto_curto);
    setGerando(false);
  }

  async function excluirGravacao() {
    const confirmado = confirm(
      "Excluir essa gravação? Isso não apaga a sessão nem as observações que já foram copiadas pra " +
        "ela — só remove o registro da gravação em si. Não é possível desfazer."
    );
    if (!confirmado) return;
    setExcluindo(true);
    setErroExcluir(null);
    const res = await fetch(`${API_URL}/plaud/gravacoes/${g.id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!res.ok) {
      setErroExcluir("Não foi possível excluir agora, tenta de novo.");
      setExcluindo(false);
      return;
    }
    router.refresh();
  }

  return (
    <li className="rounded-2xl border border-border bg-card shadow-[0_8px_24px_var(--color-shadow)]">
      <div className="flex w-full items-start justify-between gap-4 p-5 text-left">
        <button type="button" onClick={onToggle} className="min-w-0 flex-1 text-left">
          <div className="truncate text-[14.5px] font-bold">{rotulo}</div>
          <div className="mt-1 text-[12.5px] text-muted">
            {g.gravado_em ? formatDataHoraBrasilia(g.gravado_em) : formatDataHoraBrasilia(g.recebido_em)}
          </div>
          {!aberto && (
            <div className="mt-2 truncate text-[13.5px] text-muted">
              {g.resumo ? textoSimples(g.resumo) : "Sem resumo disponível."}
            </div>
          )}
        </button>
        {aberto && !editandoTitulo && (
          <button
            type="button"
            onClick={abrirEdicaoTitulo}
            className="shrink-0 rounded-lg p-1.5 text-muted hover:bg-accent-soft hover:text-accent-dark"
            aria-label="Editar título"
          >
            <Pencil className="h-4 w-4" strokeWidth={2} />
          </button>
        )}
      </div>

      {aberto && editandoTitulo && (
        <div className="border-t border-border px-5 py-4">
          <input
            type="text"
            value={tituloRascunho}
            onChange={(e) => setTituloRascunho(e.target.value)}
            className="w-full rounded-xl border border-border bg-card px-3.5 py-2 text-[13.5px] font-bold outline-none focus:border-accent"
            autoFocus
          />
          {erroTitulo && <p className="mt-2 text-[13px] font-semibold text-red-600">{erroTitulo}</p>}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={salvarTitulo}
              disabled={salvandoTitulo}
              className="rounded-xl bg-accent px-3.5 py-2 text-[13px] font-bold text-white hover:bg-accent-dark disabled:opacity-60"
            >
              {salvandoTitulo ? "Salvando..." : "Salvar"}
            </button>
            <button
              type="button"
              onClick={() => setEditandoTitulo(false)}
              disabled={salvandoTitulo}
              className="rounded-xl border border-border px-3.5 py-2 text-[13px] font-bold text-muted hover:bg-accent-soft disabled:opacity-60"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {aberto && (
        <div className="border-t border-border p-5 pt-4">
          <div className="mb-4 flex gap-1.5 overflow-x-auto">
            {ABAS.map(([valor, label]) => (
              <button
                key={valor}
                type="button"
                onClick={() => setAba(valor)}
                className={`shrink-0 whitespace-nowrap rounded-xl px-3.5 py-2 text-[13px] font-bold ${
                  aba === valor ? "bg-accent text-white" : "border border-border bg-card text-muted"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {aba === "resumo" &&
            (g.resumo ? <MarkdownTexto texto={g.resumo} /> : <p className="text-[13.5px] text-muted">Sem resumo disponível.</p>)}

          {aba === "texto" && (
            <div>
              {textoCurto ? (
                <>
                  <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-muted">{textoCurto}</p>
                  <button
                    type="button"
                    onClick={gerarTextoCurto}
                    disabled={gerando}
                    className="mt-3 text-[13px] font-semibold text-accent-dark hover:underline disabled:opacity-60"
                  >
                    {gerando ? "Gerando..." : "Gerar de novo"}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={gerarTextoCurto}
                  disabled={gerando || !g.transcricao}
                  className="rounded-xl bg-accent px-4 py-2.5 text-[13.5px] font-bold text-white hover:bg-accent-dark disabled:opacity-60"
                >
                  {gerando ? "Gerando..." : "Gerar texto pronto"}
                </button>
              )}
              {!g.transcricao && !textoCurto && (
                <p className="mt-2 text-[12.5px] text-muted">Essa gravação ainda não tem transcrição.</p>
              )}
              {erroTexto && <p className="mt-2 text-[13px] font-semibold text-red-600">{erroTexto}</p>}
            </div>
          )}

          {aba === "mapa" &&
            (g.resumo ? (
              <MapaMentalPlaud texto={g.resumo} />
            ) : (
              <p className="text-[13.5px] text-muted">Sem resumo disponível pra desenhar o mapa mental.</p>
            ))}

          {aba === "transcricao" &&
            (g.transcricao ? (
              <TranscricaoChat texto={g.transcricao} />
            ) : (
              <p className="text-[13.5px] text-muted">Sem transcrição disponível.</p>
            ))}

          {!g.sessao_id && (
            <div className="mt-5 border-t border-border pt-4">
              <AcaoDetectarPaciente gravacaoId={g.id} temTranscricao={!!g.transcricao} />
            </div>
          )}

          <div className="mt-5 border-t border-border pt-4">
            <button
              type="button"
              onClick={excluirGravacao}
              disabled={excluindo}
              className="text-[13px] font-semibold text-red-600 hover:underline disabled:opacity-60"
            >
              {excluindo ? "Excluindo..." : "Excluir gravação"}
            </button>
            {erroExcluir && <p className="mt-2 text-[13px] font-semibold text-red-600">{erroExcluir}</p>}
          </div>
        </div>
      )}
    </li>
  );
}

export function PlaudGravacoesLista({ gravacoes }: { gravacoes: PlaudGravacaoLista[] }) {
  const [expandidoId, setExpandidoId] = useState<number | null>(null);
  const [pastasAbertas, setPastasAbertas] = useState<Set<string>>(new Set());

  if (gravacoes.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-[0_8px_24px_var(--color-shadow)]">
        <p className="text-[14px] text-muted">
          Nenhuma gravação recebida ainda. Configure o Zap no Zapier (Configurações → Plaud) pra elas
          aparecerem aqui.
        </p>
      </div>
    );
  }

  const grupos = agruparPorPaciente(gravacoes);

  function alternarPasta(chave: string) {
    setPastasAbertas((atual) => {
      const nova = new Set(atual);
      if (nova.has(chave)) nova.delete(chave);
      else nova.add(chave);
      return nova;
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {grupos.map((grupo) => {
        const pastaAberta = pastasAbertas.has(grupo.chave);
        const semVinculo = grupo.chave === CHAVE_SEM_VINCULO;

        return (
          <div key={grupo.chave} className="rounded-2xl border border-border bg-card shadow-[0_8px_24px_var(--color-shadow)]">
            <button
              type="button"
              onClick={() => alternarPasta(grupo.chave)}
              className="flex w-full items-center gap-3 p-5 text-left"
            >
              {pastaAberta ? (
                <FolderOpen className="h-[18px] w-[18px] shrink-0 text-accent" strokeWidth={2} />
              ) : (
                <Folder className="h-[18px] w-[18px] shrink-0 text-accent" strokeWidth={2} />
              )}
              <span className={`flex-1 truncate text-[14.5px] font-bold ${semVinculo ? "text-muted" : ""}`}>
                {grupo.nome}
              </span>
              <span className="shrink-0 rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-bold text-accent-dark">
                {grupo.gravacoes.length}
              </span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-muted transition-transform ${pastaAberta ? "rotate-180" : ""}`}
                strokeWidth={2}
              />
            </button>

            {pastaAberta && (
              <ul className="flex flex-col gap-3 border-t border-border p-5 pt-4">
                {grupo.gravacoes.map((g) => (
                  <GravacaoCard
                    key={g.id}
                    g={g}
                    aberto={expandidoId === g.id}
                    onToggle={() => setExpandidoId(expandidoId === g.id ? null : g.id)}
                  />
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
