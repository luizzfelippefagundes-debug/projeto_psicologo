import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AlertaCrise } from "@/components/AlertaCrise";
import { getConversasEscalonadas, getDashboardStats, getMe, getSessoesHoje } from "@/lib/api";
import { formatHoraBrasilia } from "@/lib/format";

export default async function DashboardPage() {
  const [stats, sessoes, profissional, conversasEscalonadas] = await Promise.all([
    getDashboardStats(),
    getSessoesHoje(),
    getMe(),
    getConversasEscalonadas(),
  ]);
  const primeiroNome = profissional.nome.split(" ")[0];

  return (
    <div className="pl-12 md:pl-0">
      <div className="mb-7 flex items-center justify-between gap-5">
        <div>
          <h1 className="text-2xl font-extrabold">Olá, {primeiroNome} 👋</h1>
          <p className="mt-1 text-[14.5px] text-muted">Aqui está um resumo do seu dia</p>
        </div>
        <ThemeToggle />
      </div>

      <AlertaCrise conversas={conversasEscalonadas} />

      <div className="mb-7 grid grid-cols-2 gap-4">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-[0_8px_24px_var(--color-shadow)]">
          <div className="text-[13px] font-semibold text-muted">Consultas hoje</div>
          <div className="mt-2 text-[26px] font-extrabold">{stats.consultas_hoje}</div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5 shadow-[0_8px_24px_var(--color-shadow)]">
          <div className="text-[13px] font-semibold text-muted">Pacientes ativos</div>
          <div className="mt-2 text-[26px] font-extrabold">{stats.pacientes_ativos}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-6 shadow-[0_8px_24px_var(--color-shadow)]">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[16px] font-bold">Agenda de hoje</h2>
            <Link href="/agenda" className="text-[13.5px] font-semibold text-accent">
              Ver agenda →
            </Link>
          </div>
          {sessoes.length === 0 ? (
            <p className="text-[13.5px] text-muted">Nenhuma sessão marcada para hoje.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {sessoes.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center gap-4 border-b border-border pb-3 last:border-0 last:pb-0"
                >
                  <div className="w-12 shrink-0 text-[13px] font-bold text-muted">
                    {formatHoraBrasilia(item.data_hora)}
                  </div>
                  <div className="flex-1">
                    <div className="text-[14.5px] font-bold">{item.paciente_nome}</div>
                    <div className="text-[13px] text-muted">
                      {item.local_nome} · {item.modalidade === "teleconsulta" ? "Teleconsulta" : "Presencial"}
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-accent-soft px-2.5 py-1 text-[11.5px] font-bold text-accent-dark">
                    {item.status === "confirmada" ? "Confirmada" : "Concluída"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-[0_8px_24px_var(--color-shadow)]">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[16px] font-bold">Atividade do assistente</h2>
            <Link href="/assistente" className="text-[13.5px] font-semibold text-accent">
              Ver bot →
            </Link>
          </div>
          <p className="text-[13.5px] text-muted">
            O bot ainda não está conectado — assim que o WhatsApp e a IA entrarem no ar, a
            atividade real aparece aqui.
          </p>
        </div>
      </div>
    </div>
  );
}
