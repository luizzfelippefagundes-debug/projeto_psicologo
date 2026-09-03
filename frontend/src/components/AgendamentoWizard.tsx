"use client";

import { useAuth, useUser } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { agendarPublico, getHorariosPublico, type ProfissionalPublico } from "@/lib/apiPublico";
import { Select } from "@/components/Select";
import { AgendarDataPicker } from "@/components/AgendarDataPicker";
import { formatDiaMesCurto, formatDiaSemanaCurto, getTodayISO } from "@/lib/format";

const PASSOS = ["Local", "Horário", "Confirmar"];

const CAMPO_CLASSE =
  "rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-3 py-2.5 text-[14.5px] outline-none focus:border-accent";

function StepIndicator({ atual }: { atual: number }) {
  return (
    <div className="mb-5 flex items-center justify-center">
      {PASSOS.map((_, i) => {
        const n = i + 1;
        return (
          <div key={n} className="flex items-center">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-[13.5px] font-bold ${
                n <= atual ? "bg-accent text-white" : "bg-accent-soft text-muted"
              }`}
            >
              {n}
            </div>
            {i < PASSOS.length - 1 && (
              <div className={`h-0.5 w-6 ${n < atual ? "bg-accent" : "bg-border"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function LinhaResumo({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border py-2.5 last:border-0">
      <span className="text-[13.5px] text-muted">{label}</span>
      <span className="text-[14px] font-bold">{valor}</span>
    </div>
  );
}

function BotaoVoltar({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border-[1.5px] border-border bg-card px-5 py-2.5 text-[14px] font-bold text-muted"
    >
      Voltar
    </button>
  );
}

function BotaoAvancar({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex-1 rounded-xl bg-accent px-5 py-2.5 text-[14px] font-bold text-white disabled:opacity-60"
    >
      Avançar
    </button>
  );
}

export function AgendamentoWizard({
  slug,
  profissional,
}: {
  slug: string;
  profissional: ProfissionalPublico;
}) {
  const router = useRouter();
  const { getToken } = useAuth();
  const { user } = useUser();

  const [passo, setPasso] = useState(1);
  const [localId, setLocalId] = useState(String(profissional.locais[0]?.id ?? ""));
  const [data, setData] = useState(getTodayISO);
  const [horarios, setHorarios] = useState<string[]>([]);
  const [carregandoHorarios, setCarregandoHorarios] = useState(false);
  const [horarioEscolhido, setHorarioEscolhido] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [dataNascimento, setDataNascimento] = useState("");
  const [lgpd, setLgpd] = useState(false);
  const [estimulacao, setEstimulacao] = useState<"sim" | "nao" | "">("");
  const [erro, setErro] = useState<string | null>(null);
  const [confirmado, setConfirmado] = useState(false);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    if (user?.fullName) setNome(user.fullName);
  }, [user]);

  // Muda o local ou a data invalida o horário já escolhido — ele pode não existir mais
  // nessa combinação nova.
  useEffect(() => {
    setHorarioEscolhido(null);
  }, [localId, data]);

  useEffect(() => {
    if (passo !== 2 || !localId || !data) return;
    setCarregandoHorarios(true);
    getToken().then((token) => {
      if (!token) return;
      getHorariosPublico(slug, Number(localId), data, token)
        .then((r) => setHorarios(r.horarios))
        .catch(() => setHorarios([]))
        .finally(() => setCarregandoHorarios(false));
    });
  }, [passo, slug, localId, data, getToken]);

  async function confirmar() {
    if (!horarioEscolhido) return;
    setErro(null);
    setCarregando(true);
    const token = await getToken();
    if (!token) {
      setErro("Sessão expirada. Recarregue a página e faça login de novo.");
      setCarregando(false);
      return;
    }
    try {
      await agendarPublico(token, {
        slug,
        local_id: Number(localId),
        data_hora: `${data}T${horarioEscolhido}:00-03:00`,
        nome: nome || undefined,
        telefone: telefone || undefined,
        data_nascimento: dataNascimento || undefined,
        consentimento_lgpd: lgpd,
        procedimento_estimulacao: estimulacao === "sim",
      });
      setConfirmado(true);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não deu pra agendar.");
    } finally {
      setCarregando(false);
    }
  }

  const localNome = profissional.locais.find((l) => String(l.id) === localId)?.nome ?? "";

  return (
    <div className="mx-auto w-full max-w-[480px]">
      {confirmado ? (
        <div className="rounded-2xl border border-border bg-card p-6 text-center shadow-[0_8px_24px_var(--color-shadow)]">
          <p className="text-[15px] font-semibold text-accent-dark">Consulta agendada!</p>
          <button
            type="button"
            onClick={() => router.push(`/agendar/${slug}/perfil`)}
            className="mt-4 rounded-xl bg-accent px-5 py-2.5 text-[14px] font-bold text-white"
          >
            Ver meu perfil
          </button>
        </div>
      ) : (
        <>
          <AgendarDataPicker dataSelecionada={data} onSelect={setData} />
          <StepIndicator atual={passo} />
          <h1 className="mb-5 text-center text-xl font-extrabold">{PASSOS[passo - 1]}</h1>

          {passo === 1 && (
            <div className="flex flex-col gap-4">
              <Select
                value={localId}
                onChange={setLocalId}
                options={profissional.locais.map((l) => ({ value: String(l.id), label: l.nome }))}
              />
              <div className="flex gap-3">
                <BotaoAvancar onClick={() => setPasso(2)} disabled={!localId} />
              </div>
            </div>
          )}

          {passo === 2 && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-2">
                {carregandoHorarios ? (
                  <p className="text-[13.5px] text-muted">Carregando horários...</p>
                ) : horarios.length === 0 ? (
                  <p className="text-[13.5px] text-muted">Nenhum horário livre nesse dia.</p>
                ) : (
                  horarios.map((h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => setHorarioEscolhido(h)}
                      className={`rounded-xl px-3.5 py-2 text-[13.5px] font-bold ${
                        horarioEscolhido === h ? "bg-accent text-white" : "border border-border bg-card"
                      }`}
                    >
                      {h}
                    </button>
                  ))
                )}
              </div>
              <div className="flex gap-3">
                <BotaoVoltar onClick={() => setPasso(1)} />
                <BotaoAvancar onClick={() => setPasso(3)} disabled={!horarioEscolhido} />
              </div>
            </div>
          )}

          {passo === 3 && horarioEscolhido && (
            <div className="flex flex-col gap-4">
              <div className="rounded-2xl border border-border bg-card p-5 shadow-[0_4px_14px_var(--color-shadow)]">
                <LinhaResumo label="Profissional" valor={profissional.nome} />
                <LinhaResumo label="Local" valor={localNome} />
                <LinhaResumo
                  label="Data"
                  valor={`${formatDiaSemanaCurto(data)}, ${formatDiaMesCurto(data)}`}
                />
                <LinhaResumo label="Horário" valor={horarioEscolhido} />
              </div>

              <input
                type="text"
                placeholder="Nome completo"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                className={CAMPO_CLASSE}
              />
              <input
                type="tel"
                placeholder="Telefone (WhatsApp)"
                value={telefone}
                onChange={(e) => setTelefone(e.target.value)}
                className={CAMPO_CLASSE}
              />
              <input
                type="date"
                placeholder="Data de nascimento"
                value={dataNascimento}
                onChange={(e) => setDataNascimento(e.target.value)}
                className={CAMPO_CLASSE}
              />
              <Select
                value={estimulacao}
                onChange={(v) => setEstimulacao(v as "sim" | "nao")}
                placeholder="É consulta de estimulação/tDCS?"
                options={[
                  { value: "nao", label: "Não, é consulta regular" },
                  { value: "sim", label: "Sim, é estimulação/tDCS" },
                ]}
              />
              <label className="flex items-start gap-2.5 text-[13.5px]">
                <input
                  type="checkbox"
                  checked={lgpd}
                  onChange={(e) => setLgpd(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                />
                <span>Concordo com o tratamento dos meus dados de saúde, conforme a LGPD.</span>
              </label>

              {erro && <p className="text-[13px] font-semibold text-red-600">{erro}</p>}

              <div className="flex gap-3">
                <BotaoVoltar onClick={() => setPasso(2)} />
                <button
                  type="button"
                  onClick={confirmar}
                  disabled={carregando || !nome || !telefone || !lgpd}
                  className="flex-1 rounded-xl bg-accent px-5 py-2.5 text-[14px] font-bold text-white disabled:opacity-60"
                >
                  {carregando ? "Agendando..." : "Confirmar agendamento"}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
