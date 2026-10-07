"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Brain, Eye, EyeOff } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";

function RedefinirSenhaForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [novaSenha, setNovaSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [mostrar, setMostrar] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [concluido, setConcluido] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (novaSenha !== confirmar) {
      setErro("As senhas não coincidem.");
      return;
    }
    setErro(null);
    setCarregando(true);
    const res = await fetch("/api/auth/redefinir-senha", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, nova_senha: novaSenha }),
    });
    setCarregando(false);
    if (res.ok || res.status === 204) {
      setConcluido(true);
      setTimeout(() => router.push("/login"), 2000);
    } else {
      const data = await res.json().catch(() => ({}));
      setErro(data.detail ?? "Link inválido ou expirado. Solicite um novo.");
    }
  }

  if (!token) {
    return (
      <div className="text-center">
        <p className="mb-4 text-[14.5px] text-muted">Link inválido.</p>
        <Link href="/esqueci-senha" className="font-semibold text-accent-dark hover:underline">
          Solicitar novo link
        </Link>
      </div>
    );
  }

  return concluido ? (
    <div className="text-center">
      <h1 className="mb-3 text-[22px] font-extrabold">Senha redefinida!</h1>
      <p className="text-[14.5px] text-muted">Redirecionando pro login...</p>
    </div>
  ) : (
    <>
      <h1 className="mb-2 text-center text-[24px] font-extrabold">Nova senha</h1>
      <p className="mb-8 text-center text-[14.5px] text-muted">
        Escolha uma senha com pelo menos 6 caracteres.
      </p>

      {erro && (
        <p className="mb-4 rounded-xl bg-red-500/10 px-4 py-2.5 text-[13.5px] font-semibold text-red-600">
          {erro}
        </p>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div className="flex flex-col">
          <label htmlFor="nova-senha" className="mb-1.5 text-sm font-semibold">
            Nova senha
          </label>
          <div className="relative">
            <input
              id="nova-senha"
              type={mostrar ? "text" : "password"}
              required
              minLength={6}
              value={novaSenha}
              onChange={(e) => setNovaSenha(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-4 py-3 pr-11 text-[15px] outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={() => setMostrar((v) => !v)}
              className="absolute right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center text-muted hover:text-fg"
            >
              {mostrar ? <EyeOff className="h-[18px] w-[18px]" strokeWidth={2} /> : <Eye className="h-[18px] w-[18px]" strokeWidth={2} />}
            </button>
          </div>
        </div>

        <div className="flex flex-col">
          <label htmlFor="confirmar" className="mb-1.5 text-sm font-semibold">
            Confirmar senha
          </label>
          <input
            id="confirmar"
            type={mostrar ? "text" : "password"}
            required
            value={confirmar}
            onChange={(e) => setConfirmar(e.target.value)}
            placeholder="••••••••"
            className="w-full rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-4 py-3 text-[15px] outline-none focus:border-accent"
          />
        </div>

        <button
          type="submit"
          disabled={carregando}
          className="rounded-xl bg-accent py-3.5 text-base font-bold text-white transition-colors hover:bg-accent-dark active:scale-[0.98] disabled:opacity-60"
        >
          {carregando ? "Salvando..." : "Salvar nova senha"}
        </button>
      </form>
    </>
  );
}

export default function RedefinirSenhaPage() {
  return (
    <div className="flex min-h-full flex-1 items-center justify-center p-6">
      <div className="fixed right-5 top-5">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-[400px] rounded-3xl border border-border bg-card p-10 shadow-[0_10px_30px_var(--color-shadow)]">
        <div className="mb-6 flex flex-col items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-white">
            <Brain className="h-7 w-7" strokeWidth={2.25} />
          </div>
          <div className="text-[18px] font-extrabold tracking-wide text-fg">Consultório Psicologia</div>
        </div>
        <Suspense>
          <RedefinirSenhaForm />
        </Suspense>
      </div>
    </div>
  );
}
