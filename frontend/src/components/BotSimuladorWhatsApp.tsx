"use client";

import { useState } from "react";

const API_URL = "/api"; // passa pelo rewrite do Next.js — cookie de sessão nasce no domínio do site

type Mensagem = {
  role: "user" | "assistant";
  content: string;
};

export function BotSimuladorWhatsApp() {
  const [telefone, setTelefone] = useState("5511999990000");
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [acoes, setAcoes] = useState<string[]>([]);

  async function enviar() {
    if (!texto.trim() || enviando) return;
    setEnviando(true);

    const novasMensagens: Mensagem[] = [...mensagens, { role: "user", content: texto }];
    setMensagens(novasMensagens);
    setTexto("");

    const res = await fetch(`${API_URL}/bot/simular`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        telefone_paciente: telefone,
        mensagem: novasMensagens[novasMensagens.length - 1].content,
        historico: mensagens,
      }),
    });

    const data = await res.json();
    setMensagens([...novasMensagens, { role: "assistant", content: data.resposta }]);
    if (data.acoes?.length) {
      setAcoes((prev) => [...prev, ...data.acoes]);
    }
    setEnviando(false);
  }

  function reiniciar() {
    setMensagens([]);
    setAcoes([]);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-card p-4 shadow-[0_8px_24px_var(--color-shadow)]">
        <div className="flex flex-col">
          <label htmlFor="telefone-sim" className="mb-1 text-[12.5px] font-semibold text-muted">
            Número do "paciente" (simulado)
          </label>
          <input
            id="telefone-sim"
            value={telefone}
            onChange={(e) => setTelefone(e.target.value)}
            disabled={mensagens.length > 0}
            className="rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-3 py-2 text-[14px] outline-none focus:border-accent disabled:opacity-60"
          />
        </div>
        <button
          type="button"
          onClick={reiniciar}
          className="rounded-xl border border-border bg-accent-soft px-3 py-2 text-[13px] font-semibold"
        >
          Reiniciar conversa (novo número)
        </button>
        <p className="text-[12.5px] text-muted">
          Muda o número pra simular um paciente diferente a cada teste.
        </p>
      </div>

      <div className="flex h-full min-h-[420px] flex-col rounded-2xl border border-border bg-card shadow-[0_8px_24px_var(--color-shadow)]">
        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {mensagens.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-2xl">
                💬
              </div>
              <p className="max-w-sm text-[14px]">
                Escreva como se você fosse um paciente mandando mensagem no WhatsApp. Ex: "Oi,
                queria marcar uma consulta".
              </p>
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
                Digitando...
              </div>
            </div>
          )}
        </div>

        {acoes.length > 0 && (
          <div className="border-t border-border p-4">
            <p className="mb-1.5 text-[12px] font-bold uppercase tracking-wide text-muted">
              Ações reais feitas no sistema
            </p>
            <ul className="flex flex-col gap-1 text-[12.5px] text-accent-dark">
              {acoes.map((a, i) => (
                <li key={i}>• {a}</li>
              ))}
            </ul>
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            enviar();
          }}
          className="flex items-center gap-2 border-t border-border p-4"
        >
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Mensagem do paciente simulado..."
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
    </div>
  );
}
