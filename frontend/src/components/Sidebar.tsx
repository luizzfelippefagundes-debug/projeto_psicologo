"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Brain, Calendar, Home, LogOut, Menu, Settings, Users } from "lucide-react";
import { logout } from "@/lib/auth-client";
import type { Profissional } from "@/lib/api";
import { iniciais } from "@/lib/format";

const NAV_ITEMS = [
  { href: "/", label: "Visão geral", Icon: Home },
  { href: "/pacientes", label: "Pacientes", Icon: Users },
  { href: "/agenda", label: "Agenda", Icon: Calendar },
  { href: "/configuracoes", label: "Configurações", Icon: Settings },
];

export function Sidebar({ profissional }: { profissional: Profissional }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function handleLogout() {
    await logout();
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-60 shrink-0 flex-col gap-8 border-r border-border bg-sidebar p-7 transition-transform md:static md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-2.5 text-[17px] font-extrabold text-fg">
          <span className="flex h-8.5 w-8.5 items-center justify-center rounded-[10px] bg-accent text-white">
            <Brain className="h-4.5 w-4.5" strokeWidth={2.25} />
          </span>
          Consultório
        </div>

        <nav className="flex flex-1 flex-col gap-1">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[14.5px] font-semibold transition-colors ${
                  active
                    ? "bg-accent text-white"
                    : "text-muted hover:bg-accent-soft hover:text-fg"
                }`}
              >
                <item.Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={2} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2.5 border-t border-border pt-5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[12.5px] font-extrabold text-accent-dark">
            {iniciais(profissional.nome)}
          </div>
          <div className="min-w-0 flex-1 truncate text-[13.5px] font-bold" title={profissional.nome}>
            {profissional.nome}
          </div>
          <Link
            href="/configuracoes"
            onClick={() => setOpen(false)}
            aria-label="Configurações"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-accent-soft hover:text-fg"
          >
            <Settings className="h-4 w-4" strokeWidth={2} />
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            aria-label="Sair"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-accent-soft hover:text-fg"
          >
            <LogOut className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      </aside>

      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <div className="fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-sidebar px-4 md:hidden">
        <div className="flex items-center gap-2 text-[15.5px] font-extrabold text-fg">
          <span className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-accent text-white">
            <Brain className="h-3.5 w-3.5" strokeWidth={2.25} />
          </span>
          Consultório
        </div>
        <button
          type="button"
          aria-label="Abrir menu"
          onClick={() => setOpen(true)}
          className="flex h-9 w-9 items-center justify-center rounded-[10px] border-[1.5px] border-border bg-card"
        >
          <Menu className="h-[18px] w-[18px]" strokeWidth={2} />
        </button>
      </div>
    </>
  );
}
