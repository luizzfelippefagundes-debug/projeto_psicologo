"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { CAMPOS_ADULTO, CAMPOS_INFANTIL, type CampoAnamnese } from "@/lib/anamneseSchema";

const API_URL = process.env.NEXT_PUBLIC_API_URL;

type EstadoPagina =
  | { tipo: "carregando" }
  | { tipo: "erro"; mensagem: string }
  | { tipo: "ja_respondido"; pacienteNome: string }
  | { tipo: "formulario"; pacienteNome: string; campos: CampoAnamnese[] }
  | { tipo: "enviado" };

export default function AnamnesePage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [estado, setEstado] = useState<EstadoPagina>({ tipo: "carregando" });
  const [respostas, setRespostas] = useState<Record<string, string | boolean>>({});
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/anamnese/${token}`)
      .then((res) => {
        if (!res.ok) throw new Error("not_found");
        return res.json();
      })
      .then((data: { paciente_nome: string; tipo_formulario: "adulto" | "infantil"; respondido: boolean }) => {
        if (data.respondido) {
          setEstado({ tipo: "ja_respondido", pacienteNome: data.paciente_nome });
        } else {
          const campos = data.tipo_formulario === "infantil" ? CAMPOS_INFANTIL : CAMPOS_ADULTO;
          setEstado({ tipo: "formulario", pacienteNome: data.paciente_nome, campos });
        }
      })
      .catch(() => setEstado({ tipo: "erro", mensagem: "Link inválido ou não encontrado." }));
  }, [token]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEnviando(true);
    const res = await fetch(`${API_URL}/anamnese/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ respostas }),
    });
    setEnviando(false);
    if (res.ok) {
      setEstado({ tipo: "enviado" });
    }
  }

  if (estado.tipo === "carregando") {
    return (
      <TelaCentralizada>
        <p className="text-[14.5px] text-muted">Carregando...</p>
      </TelaCentralizada>
    );
  }

  if (estado.tipo === "erro") {
    return (
      <TelaCentralizada>
        <p className="text-[14.5px] text-muted">{estado.mensagem}</p>
      </TelaCentralizada>
    );
  }

  if (estado.tipo === "ja_respondido") {
    return (
      <TelaCentralizada>
        <p className="text-[15px] font-bold">
          Você já respondeu esse formulário. Obrigada, {estado.pacienteNome}!
        </p>
      </TelaCentralizada>
    );
  }

  if (estado.tipo === "enviado") {
    return (
      <TelaCentralizada>
        <p className="text-[15px] font-bold">Formulário enviado com sucesso. Obrigada!</p>
      </TelaCentralizada>
    );
  }

  const secoes = Array.from(new Set(estado.campos.map((c) => c.secao)));
  const campoNomeId = estado.campos[0].id;

  return (
    <div className="flex min-h-full flex-1 justify-center p-6">
      <div className="w-full max-w-[640px] rounded-3xl border border-border bg-card p-8 shadow-[0_10px_30px_var(--color-shadow)]">
        <h1 className="text-xl font-extrabold">Formulário de anamnese</h1>
        <p className="mt-1 text-[14px] text-muted">
          Olá, {estado.pacienteNome}! Preencha com calma — só o nome é obrigatório.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-6">
          {secoes.map((secao) => (
            <div key={secao}>
              <h2 className="mb-3 text-[13px] font-bold uppercase tracking-wide text-muted">{secao}</h2>
              <div className="flex flex-col gap-3">
                {estado.campos
                  .filter((c) => c.secao === secao)
                  .map((campo) => (
                    <CampoInput
                      key={campo.id}
                      campo={campo}
                      obrigatorio={campo.id === campoNomeId}
                      valor={respostas[campo.id]}
                      onChange={(valor) => setRespostas((r) => ({ ...r, [campo.id]: valor }))}
                    />
                  ))}
              </div>
            </div>
          ))}

          <button
            type="submit"
            disabled={enviando}
            className="rounded-xl bg-accent px-5 py-3 text-[14.5px] font-bold text-white transition-colors hover:bg-accent-dark disabled:opacity-60"
          >
            {enviando ? "Enviando..." : "Enviar formulário"}
          </button>
        </form>
      </div>
    </div>
  );
}

function TelaCentralizada({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 items-center justify-center p-6">
      <div className="w-full max-w-[440px] rounded-3xl border border-border bg-card p-10 text-center shadow-[0_10px_30px_var(--color-shadow)]">
        {children}
      </div>
    </div>
  );
}

function CampoInput({
  campo,
  obrigatorio,
  valor,
  onChange,
}: {
  campo: CampoAnamnese;
  obrigatorio: boolean;
  valor: string | boolean | undefined;
  onChange: (valor: string | boolean) => void;
}) {
  if (campo.tipo === "booleano") {
    return (
      <label className="flex items-center gap-2.5 text-[14px]">
        <input
          type="checkbox"
          checked={Boolean(valor)}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 shrink-0 accent-accent"
        />
        {campo.label}
      </label>
    );
  }

  const inputClass =
    "rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-3 py-2.5 text-[14.5px] outline-none focus:border-accent";

  return (
    <div className="flex flex-col">
      <label htmlFor={campo.id} className="mb-1.5 text-[13.5px] font-semibold">
        {campo.label}
      </label>
      {campo.tipo === "textarea" ? (
        <textarea
          id={campo.id}
          required={obrigatorio}
          rows={2}
          value={typeof valor === "string" ? valor : ""}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        />
      ) : (
        <input
          id={campo.id}
          type={campo.tipo === "data" ? "date" : "text"}
          required={obrigatorio}
          value={typeof valor === "string" ? valor : ""}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        />
      )}
    </div>
  );
}
