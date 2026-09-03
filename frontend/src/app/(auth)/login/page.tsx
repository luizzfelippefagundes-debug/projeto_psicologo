"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Brain, Eye, EyeOff } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { login } from "@/lib/auth-client";

export default function LoginPage() {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [mostrarSenha, setMostrarSenha] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro(null);
    setCarregando(true);

    const form = new FormData(e.currentTarget);
    try {
      await login(String(form.get("email")), String(form.get("senha")));
      router.push("/");
      router.refresh();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao entrar");
      setCarregando(false);
    }
  }

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
          <div className="text-[18px] font-extrabold tracking-wide text-fg">Consultório</div>
        </div>

        <h1 className="mb-2 text-center text-[26px] font-extrabold">Bem-vinda de volta</h1>
        <p className="mb-8 text-center text-[15px] text-muted">
          Acesse sua agenda e seus pacientes
        </p>

        {erro && (
          <p className="mb-4 rounded-xl bg-red-500/10 px-4 py-2.5 text-[13.5px] font-semibold text-red-600">
            {erro}
          </p>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-[18px]">
          <div className="flex flex-col">
            <label htmlFor="email" className="mb-1.5 text-sm font-semibold">
              E-mail
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="seuemail@exemplo.com"
              className="w-full rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-4 py-3 text-[15px] outline-none focus:border-accent"
            />
          </div>

          <div className="flex flex-col">
            <label htmlFor="senha" className="mb-1.5 text-sm font-semibold">
              Senha
            </label>
            <div className="relative">
              <input
                id="senha"
                name="senha"
                type={mostrarSenha ? "text" : "password"}
                autoComplete="current-password"
                required
                placeholder="••••••••"
                className="w-full rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-4 py-3 pr-11 text-[15px] outline-none focus:border-accent"
              />
              <button
                type="button"
                onClick={() => setMostrarSenha((v) => !v)}
                aria-label={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
                className="absolute right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center text-muted hover:text-fg"
              >
                {mostrarSenha ? (
                  <EyeOff className="h-[18px] w-[18px]" strokeWidth={2} />
                ) : (
                  <Eye className="h-[18px] w-[18px]" strokeWidth={2} />
                )}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={carregando}
            className="mt-2 rounded-xl bg-accent py-3.5 text-base font-bold text-white transition-colors hover:bg-accent-dark active:scale-[0.98] disabled:opacity-60"
          >
            {carregando ? "Entrando..." : "Entrar"}
          </button>
        </form>

        <div className="mt-5 text-center text-[14px]">
          Não tem conta?{" "}
          <Link href="/signup" className="font-semibold text-accent-dark hover:underline">
            Criar conta
          </Link>
        </div>
      </div>
    </div>
  );
}
