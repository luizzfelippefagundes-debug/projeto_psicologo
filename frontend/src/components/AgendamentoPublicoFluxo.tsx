"use client";

import { Show, SignIn, useAuth, useUser } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { agendarPublico, getHorariosPublico, type ProfissionalPublico } from "@/lib/apiPublico";
import { Select } from "@/components/Select";

// Página pública: sempre no tema claro, independente do modo escuro do
// aparelho de quem visita — mesmo padrão de frontend/src/app/anamnese/[token]/page.tsx.
const ESTILO_CLARO = {
  colorScheme: "light",
  "--color-accent": "#a8768a",
  "--color-accent-dark": "#8f5f73",
  "--color-accent-soft": "#f3e8ec",
  "--color-card": "#faf6f3",
  "--color-fg": "#3a2f2f",
  "--color-muted": "#8a7873",
  "--color-border": "#ddd0c9",
  "--color-gold": "#b8860b",
  "--color-gold-soft": "#f5ecd6",
  "--color-shadow": "rgba(90, 60, 60, 0.14)",
  background: "#ffffff",
  color: "#3a2f2f",
  minHeight: "100%",
} as React.CSSProperties;

export function AgendamentoPublicoFluxo({
  slug,
  profissional,
}: {
  slug: string;
  profissional: ProfissionalPublico;
}) {
  const { getToken } = useAuth();
  const { user } = useUser();

  const [localId, setLocalId] = useState(String(profissional.locais[0]?.id ?? ""));
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10));
  const [horarios, setHorarios] = useState<string[]>([]);
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

  useEffect(() => {
    if (!localId || !data) return;
    getToken().then((token) => {
      if (!token) return;
      getHorariosPublico(slug, Number(localId), data, token)
        .then((r) => setHorarios(r.horarios))
        .catch(() => setHorarios([]));
    });
  }, [slug, localId, data, getToken]);

  async function confirmar() {
    if (!horarioEscolhido) return;
    setErro(null);
    setCarregando(true);
    const token = await getToken();
    if (!token) return;
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

  return (
    <div className="flex min-h-full flex-1 justify-center p-6" style={ESTILO_CLARO}>
      <div className="w-full max-w-[480px]">
        <h1 className="mb-1 text-2xl font-extrabold">{profissional.nome}</h1>
        <p className="mb-6 text-[14.5px] text-muted">Agende sua consulta</p>

        <Show
          when="signed-in"
          fallback={
            <SignIn
              routing="hash"
              forceRedirectUrl={`/agendar/${slug}`}
              signUpForceRedirectUrl={`/agendar/${slug}`}
            />
          }
        >
          {confirmado ? (
            <p className="text-[15px] font-semibold text-accent-dark">
              Consulta agendada! Você pode ver em &quot;Minhas consultas&quot;.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              <Select
                value={localId}
                onChange={setLocalId}
                options={profissional.locais.map((l) => ({ value: String(l.id), label: l.nome }))}
              />
              <input
                type="date"
                value={data}
                onChange={(e) => setData(e.target.value)}
                className="rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-3 py-2.5 text-[14.5px] outline-none focus:border-accent"
              />
              <div className="flex flex-wrap gap-2">
                {horarios.map((h) => (
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
                ))}
                {horarios.length === 0 && (
                  <p className="text-[13.5px] text-muted">Nenhum horário livre nesse dia.</p>
                )}
              </div>

              {horarioEscolhido && (
                <>
                  <input
                    type="text"
                    placeholder="Nome completo"
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    className="rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-3 py-2.5 text-[14.5px] outline-none focus:border-accent"
                  />
                  <input
                    type="tel"
                    placeholder="Telefone (WhatsApp)"
                    value={telefone}
                    onChange={(e) => setTelefone(e.target.value)}
                    className="rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-3 py-2.5 text-[14.5px] outline-none focus:border-accent"
                  />
                  <input
                    type="date"
                    placeholder="Data de nascimento"
                    value={dataNascimento}
                    onChange={(e) => setDataNascimento(e.target.value)}
                    className="rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-3 py-2.5 text-[14.5px] outline-none focus:border-accent"
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

                  <button
                    type="button"
                    onClick={confirmar}
                    disabled={carregando || !nome || !telefone || !lgpd}
                    className="rounded-xl bg-accent px-5 py-2.5 text-[14.5px] font-bold text-white disabled:opacity-60"
                  >
                    {carregando ? "Agendando..." : "Confirmar consulta"}
                  </button>
                </>
              )}
            </div>
          )}
        </Show>
      </div>
    </div>
  );
}
