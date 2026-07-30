import { ThemeToggle } from "@/components/ThemeToggle";
import { ChatAssistente } from "@/components/ChatAssistente";

export default function AssistentePage() {
  return (
    <div className="pl-12 md:pl-0">
      <div className="mb-7 flex items-center justify-between gap-5">
        <div>
          <h1 className="text-2xl font-extrabold">Assistente</h1>
          <p className="mt-1 text-[14.5px] text-muted">
            Converse com o assistente de IA sobre sua agenda e seus pacientes
          </p>
        </div>
        <ThemeToggle />
      </div>

      <ChatAssistente
        sugestoes={["Como está minha agenda essa semana?", "Quantos pacientes ativos eu tenho?"]}
      />
    </div>
  );
}
