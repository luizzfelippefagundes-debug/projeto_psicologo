"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Brain, Calendar, Home, LogOut, Menu, Settings, Users } from "lucide-react";
import { logout } from "@/lib/auth-client";

const NAV_ITEMS = [
  { href: "/", label: "Visão geral", Icon: Home },
  { href: "/pacientes", label: "Pacientes", Icon: Users },
  { href: "/agenda", label: "Agenda", Icon: Calendar },
  { href: "/configuracoes", label: "Configurações", Icon: Settings },
];

export function Sidebar() {
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

        <nav className="flex flex-col gap-1">
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

        <button
          type="button"
          onClick={handleLogout}
          className="mt-auto flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-left text-[14.5px] font-semibold text-muted transition-colors hover:bg-accent-soft hover:text-fg"
        >
          <LogOut className="h-[18px] w-[18px] shrink-0" strokeWidth={2} />
          Sair
        </button>
      </aside>

      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <button
        type="button"
        aria-label="Abrir menu"
        onClick={() => setOpen(true)}
        className="fixed left-4 top-4 z-30 flex h-10 w-10 items-center justify-center rounded-[10px] border-[1.5px] border-border bg-card text-lg md:hidden"
      >
        <Menu className="h-5 w-5" strokeWidth={2} />
      </button>
    </>
  );
}
