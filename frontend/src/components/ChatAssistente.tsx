"use client";

import { useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Mensagem = {
  role: "user" | "assistant";
  content: string;
};

export function ChatAssistente({
  pacienteId,
  sugestoes = [],
}: {
  pacienteId?: number;
  sugestoes?: string[];
}) {
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(mensagem: string) {
    if (!mensagem.trim() || enviando) return;
    setErro(null);
    setEnviando(true);

    const novasMensagens: Mensagem[] = [...mensagens, { role: "user", content: mensagem }];
    setMensagens(novasMensagens);
    setTexto("");

    const res = await fetch(`${API_URL}/assistente/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        mensagem,
        paciente_id: pacienteId,
        historico: mensagens,
      }),
    });

    if (!res.ok) {
      setErro("Não deu pra falar com o assistente agora.");
      setEnviando(false);
      return;
    }

    const data = await res.json();
    setMensagens([...novasMensagens, { role: "assistant", content: data.resposta }]);
    setEnviando(false);
  }

  return (
    <div className="flex h-full min-h-[420px] flex-col rounded-2xl border border-border bg-card shadow-[0_8px_24px_var(--color-shadow)]">
      <div className="flex-1 space-y-3 overflow-y-auto p-5">
        {mensagens.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center text-muted">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-2xl">
              🤖
            </div>
            <p className="max-w-xs text-[14px]">
              {pacienteId
                ? "Pergunte algo sobre esse paciente — histórico, resumo das sessões, sugestões."
                : "Pergunte algo pro assistente."}
            </p>
            {sugestoes.length > 0 && (
              <div className="flex flex-wrap justify-center gap-2">
                {sugestoes.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => enviar(s)}
                    className="rounded-full border border-border bg-accent-soft px-3 py-1.5 text-[13px] font-semibold text-accent-dark hover:brightness-95"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {mensagens.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[14px] ${
                m.role === "user"
                  ? "bg-accent text-white"
                  : "border border-border bg-accent-soft text-fg"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}

        {enviando && (
          <div className="flex justify-start">
            <div className="rounded-2xl border border-border bg-accent-soft px-4 py-2.5 text-[14px] text-muted">
              Pensando...
            </div>
          </div>
        )}
      </div>

      {erro && (
        <p className="px-5 pb-1 text-[13px] font-semibold text-red-600">{erro}</p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          enviar(texto);
        }}
        className="flex items-center gap-2 border-t border-border p-4"
      >
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Escreva sua pergunta..."
          className="flex-1 rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-4 py-2.5 text-[14.5px] outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={enviando || !texto.trim()}
          className="rounded-xl bg-accent px-5 py-2.5 text-[14.5px] font-bold text-white transition-colors hover:bg-accent-dark disabled:opacity-60"
        >
          Enviar
        </button>
      </form>
    </div>
  );
}
