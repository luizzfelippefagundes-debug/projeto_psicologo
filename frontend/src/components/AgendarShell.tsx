"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarClock, Home, ListChecks, LogOut } from "lucide-react";
import { SignOutButton } from "@clerk/nextjs";
import { ThemeToggle } from "@/components/ThemeToggle";
import { iniciais } from "@/lib/format";

export function AgendarShell({
  slug,
  nomeProfissional,
  children,
}: {
  slug: string;
  nomeProfissional: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  const base = `/agendar/${slug}`;
  const NAV_ITEMS = [
    { href: base, label: "Início", Icon: Home, exact: true },
    { href: `${base}/novo`, label: "Agendar", Icon: CalendarClock, exact: false },
    { href: `${base}/minhas-sessoes`, label: "Consultas", Icon: ListChecks, exact: false },
  ];

  return (
    <div className="flex min-h-dvh flex-1 flex-col bg-[var(--color-bg)]">
      <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-4 lg:px-8">
        <div className="flex min-w-0 items-center gap-2.5 text-[15px] font-extrabold">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[12px] font-extrabold text-accent-dark">
            {iniciais(nomeProfissional)}
          </span>
          <span className="truncate">{nomeProfissional}</span>
        </div>

        {/* Em telas largas a navegação fica aqui no topo — a barra fixa embaixo
            (pensada pra alcance do polegar no celular) só faz sentido no mobile. */}
        <nav className="hidden items-center gap-1 lg:flex">
          {NAV_ITEMS.map((item) => {
            const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 rounded-full px-3.5 py-2 text-[13.5px] font-semibold transition-colors ${
                  active ? "bg-accent-soft text-accent-dark" : "text-muted hover:bg-accent-soft hover:text-fg"
                }`}
              >
                <item.Icon className="h-4 w-4" strokeWidth={2} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          <ThemeToggle />
          {/* Rotas dentro desse layout só renderizam pra quem já passou pela checagem de
              auth.protect() no proxy.ts — sempre logado aqui, sem precisar checar isSignedIn. */}
          <SignOutButton redirectUrl={`${base}/entrar`}>
            <button
              type="button"
              aria-label="Sair"
              className="flex h-9 w-9 items-center justify-center rounded-full border-[1.5px] border-border bg-card text-muted"
            >
              <LogOut className="h-4 w-4" strokeWidth={2} />
            </button>
          </SignOutButton>
        </div>
      </header>

      <main className="flex-1 px-4 pb-24 pt-5 lg:px-8 lg:pb-10">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-20 flex h-16 border-t border-border bg-card lg:hidden">
        {NAV_ITEMS.map((item) => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-1 flex-col items-center justify-center gap-1 text-[11.5px] font-semibold transition-colors ${
                active ? "text-accent-dark" : "text-muted"
              }`}
            >
              <item.Icon className="h-5 w-5" strokeWidth={active ? 2.5 : 2} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
