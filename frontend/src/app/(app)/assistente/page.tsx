"use client";

import { useState } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ChatAssistente } from "@/components/ChatAssistente";
import { BotSimuladorWhatsApp } from "@/components/BotSimuladorWhatsApp";

const ABAS = ["Assistente IA", "Simular paciente no WhatsApp"] as const;
type Aba = (typeof ABAS)[number];

export default function AssistentePage() {
  const [aba, setAba] = useState<Aba>("Assistente IA");

  return (
    <div className="pl-12 md:pl-0">
      <div className="mb-6 flex items-center justify-between gap-5">
        <div>
          <h1 className="text-2xl font-extrabold">Assistente</h1>
          <p className="mt-1 text-[14.5px] text-muted">
            {aba === "Assistente IA"
              ? "Converse com o assistente de IA sobre sua agenda e seus pacientes"
              : "Teste o bot de agendamento como se fosse um paciente no WhatsApp — sem WhatsApp de verdade ainda"}
          </p>
        </div>
        <ThemeToggle />
      </div>

      <div className="mb-5 flex gap-2 border-b border-border">
        {ABAS.map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => setAba(a)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-[14px] font-bold transition-colors ${
              aba === a
                ? "border-accent text-accent-dark"
                : "border-transparent text-muted hover:text-fg"
            }`}
          >
            {a}
          </button>
        ))}
      </div>

      {aba === "Assistente IA" ? (
        <ChatAssistente
          sugestoes={["Como está minha agenda essa semana?", "Quantos pacientes ativos eu tenho?"]}
        />
      ) : (
        <BotSimuladorWhatsApp />
      )}
    </div>
  );
}
