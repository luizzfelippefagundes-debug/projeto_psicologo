"use client";

import Link from "next/link";
import { useState } from "react";
import { Brain } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function EsqueciSenhaPage() {
  const [email, setEmail] = useState("");
  const [enviado, setEnviado] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setCarregando(true);
    const res = await fetch("/api/auth/esqueci-senha", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setCarregando(false);
    if (res.ok || res.status === 204) {
      setEnviado(true);
    } else {
      setErro("Não foi possível enviar o e-mail. Tente novamente.");
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
          <div className="text-[18px] font-extrabold tracking-wide text-fg">Consultório Psicologia</div>
        </div>

        {enviado ? (
          <div className="text-center">
            <h1 className="mb-3 text-[22px] font-extrabold">E-mail enviado!</h1>
            <p className="mb-6 text-[14.5px] text-muted">
              Se esse e-mail estiver cadastrado, você vai receber um link pra redefinir sua senha em
              instantes. Verifique também a caixa de spam.
            </p>
            <Link
              href="/login"
              className="text-[14px] font-semibold text-accent-dark hover:underline"
            >
              ← Voltar pro login
            </Link>
          </div>
        ) : (
          <>
            <h1 className="mb-2 text-center text-[24px] font-extrabold">Esqueceu a senha?</h1>
            <p className="mb-8 text-center text-[14.5px] text-muted">
              Digite seu e-mail e vamos te mandar um link pra redefinir a senha.
            </p>

            {erro && (
              <p className="mb-4 rounded-xl bg-red-500/10 px-4 py-2.5 text-[13.5px] font-semibold text-red-600">
                {erro}
              </p>
            )}

            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              <div className="flex flex-col">
                <label htmlFor="email" className="mb-1.5 text-sm font-semibold">
                  E-mail
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="seuemail@exemplo.com"
                  className="w-full rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-4 py-3 text-[15px] outline-none focus:border-accent"
                />
              </div>

              <button
                type="submit"
                disabled={carregando}
                className="rounded-xl bg-accent py-3.5 text-base font-bold text-white transition-colors hover:bg-accent-dark active:scale-[0.98] disabled:opacity-60"
              >
                {carregando ? "Enviando..." : "Enviar link"}
              </button>
            </form>

            <div className="mt-5 text-center text-[14px]">
              <Link href="/login" className="font-semibold text-accent-dark hover:underline">
                ← Voltar pro login
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
