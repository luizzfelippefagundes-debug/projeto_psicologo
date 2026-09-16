"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check } from "lucide-react";

const API_URL = "/api"; // passa pelo rewrite do Next.js — cookie de sessão nasce no domínio do site

export function IcloudCalendarConexao({ conectado }: { conectado: boolean }) {
  const router = useRouter();
  const [appleId, setAppleId] = useState("");
  const [senhaApp, setSenhaApp] = useState("");
  const [conectando, setConectando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sincronizando, setSincronizando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);

  async function conectar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro(null);
    setConectando(true);

    const res = await fetch(`${API_URL}/icloud/conectar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ apple_id: appleId, senha_app: senhaApp }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErro(data.detail ?? "Não foi possível conectar.");
      setConectando(false);
      return;
    }

    setConectando(false);
    router.refresh();
  }

  async function sincronizarAgora() {
    setSincronizando(true);
    setResultado(null);

    const res = await fetch(`${API_URL}/icloud/sincronizar`, {
      method: "POST",
      credentials: "include",
    });
    const data = await res.json();

    if (data.erro) {
      setResultado(data.erro);
    } else {
      setResultado(
        `Sincronizado: ${data.criados} novo(s), ${data.atualizados} atualizado(s), ${data.removidos} removido(s).`
      );
    }
    setSincronizando(false);
    router.refresh();
  }

  async function desconectar() {
    const confirmado = confirm(
      "Desconectar o Calendário iCloud? Os compromissos que já foram trazidos de lá somem da agenda — " +
        "não é possível desfazer."
    );
    if (!confirmado) return;
    await fetch(`${API_URL}/icloud/desconectar`, { method: "DELETE", credentials: "include" });
    router.refresh();
  }

  if (!conectado) {
    return (
      <form onSubmit={conectar} className="flex flex-col gap-3">
        <p className="text-[14px] text-muted">
          Conecte o Calendário da Apple (iCloud) pra trazer pra cá os compromissos que a Siri ou o app
          nativo do iPhone criam — sem precisar mudar nenhuma configuração no aparelho.
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col">
            <label htmlFor="apple-id" className="mb-1.5 text-sm font-semibold">
              Apple ID (e-mail)
            </label>
            <input
              id="apple-id"
              type="email"
              required
              value={appleId}
              onChange={(e) => setAppleId(e.target.value)}
              placeholder="nome@icloud.com"
              className="rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-3 py-2.5 text-[14.5px] outline-none focus:border-accent"
            />
          </div>
          <div className="flex flex-col">
            <label htmlFor="senha-app" className="mb-1.5 text-sm font-semibold">
              Senha de app
            </label>
            <input
              id="senha-app"
              type="password"
              required
              value={senhaApp}
              onChange={(e) => setSenhaApp(e.target.value)}
              placeholder="xxxx-xxxx-xxxx-xxxx"
              className="rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-3 py-2.5 text-[14.5px] outline-none focus:border-accent"
            />
          </div>
        </div>

        <ol className="list-decimal space-y-1 pl-4 text-[13px] text-muted">
          <li>
            Entra em <strong className="text-fg">appleid.apple.com</strong> e loga com o Apple ID dela.
          </li>
          <li>
            Na seção <strong className="text-fg">Iniciar Sessão e Segurança</strong>, procura{" "}
            <strong className="text-fg">Senhas específicas de app</strong> → Gerar senha de app.
          </li>
          <li>Cola essa senha (não a senha normal da conta) no campo acima.</li>
        </ol>

        {erro && <p className="text-[13px] font-semibold text-red-600">{erro}</p>}

        <button
          type="submit"
          disabled={conectando}
          className="w-fit rounded-xl bg-accent px-5 py-2.5 text-[14px] font-bold text-white transition-colors hover:bg-accent-dark disabled:opacity-60"
        >
          {conectando ? "Conectando..." : "Conectar"}
        </button>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3.5 py-1.5 text-[13.5px] font-bold text-accent-dark">
          <Check className="h-[15px] w-[15px]" strokeWidth={2.5} />
          Calendário iCloud conectado
        </span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={sincronizarAgora}
            disabled={sincronizando}
            className="rounded-xl border border-border bg-card px-4 py-2 text-[13.5px] font-semibold transition-colors hover:bg-accent-soft disabled:opacity-60"
          >
            {sincronizando ? "Sincronizando..." : "Sincronizar agora"}
          </button>
          <button
            type="button"
            onClick={desconectar}
            className="text-[13px] font-semibold text-red-600 hover:underline"
          >
            Desconectar
          </button>
        </div>
      </div>
      {resultado && <p className="text-[13px] text-muted">{resultado}</p>}
    </div>
  );
}
