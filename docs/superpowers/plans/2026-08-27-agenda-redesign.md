# Redesign visual da Agenda Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesenhar visualmente a tela de Agenda (grid de 5 dias úteis, cabeçalho compacto com botão "Hoje", cards de sessão sólidos por modalidade, linha do horário atual) sem alterar nenhuma lógica de backend ou comportamento de negócio.

**Architecture:** Mudança isolada em três arquivos do frontend (`lib/format.ts`, `app/(app)/agenda/page.tsx`, `components/AgendaGrid.tsx`). Todo o cálculo de datas/horário já usa `Intl.DateTimeFormat` com timezone `America/Sao_Paulo` (padrão do projeto) — a mudança reaproveita esse padrão em vez de introduzir uma lib de datas nova.

**Tech Stack:** Next.js 16 (App Router) + React + Tailwind v4 (tokens definidos em `globals.css`, já usados pelo projeto). Este projeto não tem suíte de testes automatizados (frontend nem backend) — toda validação é manual no navegador, prática já estabelecida no repositório. As tarefas abaixo seguem essa convenção: cada tarefa termina com uma verificação manual explícita em vez de um `pytest`/`vitest`.

---

## Task 1: Semana de 5 dias + horário atual em `lib/format.ts`

**Files:**
- Modify: `frontend/src/lib/format.ts:182-184` (`getWeekDates`)
- Modify: `frontend/src/lib/format.ts` (adicionar `getAgoraBrasilia` depois de `getTodayISO`, por volta da linha 165)

- [ ] **Step 1: Reduzir `getWeekDates` de 7 pra 5 dias (segunda a sexta)**

Substituir:

```ts
export function getWeekDates(mondayISO: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysISO(mondayISO, i));
}
```

por:

```ts
export function getWeekDates(mondayISO: string): string[] {
  return Array.from({ length: 5 }, (_, i) => addDaysISO(mondayISO, i));
}
```

- [ ] **Step 2: Adicionar `getAgoraBrasilia`, logo depois de `getTodayISO` (linha ~165)**

```ts
export function getAgoraBrasilia(): { hour: number; minute: number } {
  const { hour, minute } = brazilParts(new Date());
  return { hour, minute };
}
```

- [ ] **Step 3: Verificar que o arquivo compila**

Run: `cd frontend && npx tsc --noEmit`
Expected: sem erros novos relacionados a `format.ts` (o projeto pode já ter avisos pré-existentes em outros arquivos — só confirme que nada em `format.ts` quebrou).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/format.ts
git commit -m "Reduz semana da agenda pra 5 dias úteis e adiciona helper de horário atual"
```

---

## Task 2: Cabeçalho da página (`agenda/page.tsx`)

**Files:**
- Modify: `frontend/src/app/(app)/agenda/page.tsx:35-70`

- [ ] **Step 1: Corrigir o fim do período consultado (era `weekDates[6]`, agora é `weekDates[4]`) e calcular se a semana visível é a atual**

Substituir o bloco:

```tsx
  const mondayISO = getWeekStart(semana);
  const weekDates = getWeekDates(mondayISO);
  const [sessoes, pacientes] = await Promise.all([
    getSessoesPeriodo(weekDates[0], weekDates[6]),
    getPacientes(),
  ]);
  const hojeISO = getTodayISO();

  const semanaAnterior = addDaysISO(mondayISO, -7);
  const proximaSemana = addDaysISO(mondayISO, 7);
```

por:

```tsx
  const mondayISO = getWeekStart(semana);
  const weekDates = getWeekDates(mondayISO);
  const [sessoes, pacientes] = await Promise.all([
    getSessoesPeriodo(weekDates[0], weekDates[4]),
    getPacientes(),
  ]);
  const hojeISO = getTodayISO();

  const semanaAnterior = addDaysISO(mondayISO, -7);
  const proximaSemana = addDaysISO(mondayISO, 7);
  const emSemanaAtual = mondayISO === getWeekStart();
```

- [ ] **Step 2: Trocar os dois links de navegação por "Hoje" + setas compactas**

Substituir:

```tsx
        <div className="flex items-center gap-3">
          <Link
            href={`/agenda?semana=${semanaAnterior}`}
            className="rounded-xl border border-border bg-card px-3 py-2 text-[13.5px] font-semibold"
          >
            ← Semana anterior
          </Link>
          <Link
            href={`/agenda?semana=${proximaSemana}`}
            className="rounded-xl border border-border bg-card px-3 py-2 text-[13.5px] font-semibold"
          >
            Próxima semana →
          </Link>
          <ThemeToggle />
        </div>
```

por:

```tsx
        <div className="flex items-center gap-3">
          <Link
            href="/agenda"
            aria-disabled={emSemanaAtual}
            className={`rounded-xl border-[1.5px] border-accent px-3.5 py-2 text-[13px] font-extrabold text-accent-dark transition-opacity ${
              emSemanaAtual ? "pointer-events-none opacity-50" : ""
            }`}
          >
            Hoje
          </Link>
          <div className="flex overflow-hidden rounded-xl border border-border">
            <Link
              href={`/agenda?semana=${semanaAnterior}`}
              aria-label="Semana anterior"
              className="border-r border-border bg-card px-3 py-2 text-[16px] font-extrabold leading-none"
            >
              ‹
            </Link>
            <Link
              href={`/agenda?semana=${proximaSemana}`}
              aria-label="Próxima semana"
              className="bg-card px-3 py-2 text-[16px] font-extrabold leading-none"
            >
              ›
            </Link>
          </div>
          <ThemeToggle />
        </div>
```

- [ ] **Step 3: Verificar que o arquivo compila**

Run: `cd frontend && npx tsc --noEmit`
Expected: sem erros novos em `agenda/page.tsx`.

- [ ] **Step 4: Commit**

```bash
git add "frontend/src/app/(app)/agenda/page.tsx"
git commit -m "Redesenha cabeçalho da Agenda com botão Hoje e setas compactas"
```

---

## Task 3: Grid e cards (`AgendaGrid.tsx`)

**Files:**
- Modify: `frontend/src/components/AgendaGrid.tsx`

- [ ] **Step 1: Importar `useEffect` e `getAgoraBrasilia`**

Substituir:

```tsx
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Modal } from "@/components/Modal";
import {
  formatHoraBrasilia,
  sessaoGridPosition,
  type Local,
  type Paciente,
  type SessaoPeriodo,
} from "@/lib/format";
```

por:

```tsx
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import {
  formatHoraBrasilia,
  getAgoraBrasilia,
  sessaoGridPosition,
  type Local,
  type Paciente,
  type SessaoPeriodo,
} from "@/lib/format";
```

- [ ] **Step 2: Trocar a constante de altura de linha e usar em `HORAS`/`gridTemplateRows`**

Substituir:

```tsx
const API_URL = "/api"; // passa pelo rewrite do Next.js — cookie de sessão nasce no domínio do site
const HORAS = Array.from({ length: 14 }, (_, i) => 7 + i); // 07:00 .. 20:00
```

por:

```tsx
const API_URL = "/api"; // passa pelo rewrite do Next.js — cookie de sessão nasce no domínio do site
const HORAS = Array.from({ length: 14 }, (_, i) => 7 + i); // 07:00 .. 20:00
const ALTURA_LINHA_PX = 44;
```

- [ ] **Step 3: Adicionar o intervalo de atualização da linha do "agora", logo após a declaração dos `useState` existentes**

Localizar (dentro do componente `AgendaGrid`, logo depois de `const [pendente, setPendente] = useState<...>(null);`):

```tsx
  const [pendente, setPendente] = useState<{
    titulo: string;
    mensagem: string;
    executar: (notificar: boolean) => Promise<void>;
  } | null>(null);
```

Adicionar logo depois:

```tsx

  const [, forcarAtualizacao] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forcarAtualizacao((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const diaIndexHoje = weekDates.indexOf(hojeISO);
  let linhaAgora: { gridColumn: number; gridRow: string; percentNoSlot: number } | null = null;
  if (diaIndexHoje !== -1) {
    const { hour, minute } = getAgoraBrasilia();
    const totalMeiaHoras = (hour - HORAS[0]) * 2 + (minute >= 30 ? 1 : 0);
    if (totalMeiaHoras >= 0 && totalMeiaHoras < HORAS.length * 2) {
      linhaAgora = {
        gridColumn: diaIndexHoje + 2,
        gridRow: `${totalMeiaHoras + 1} / span 1`,
        percentNoSlot: ((minute % 30) / 30) * 100,
      };
    }
  }
```

- [ ] **Step 4: Trocar as colunas do grid de 7 pra 5 dias (duas ocorrências)**

Primeira ocorrência (linha do cabeçalho de dias):

Substituir:

```tsx
        <div className="grid min-w-[760px] grid-cols-[56px_repeat(7,1fr)] border-b border-border">
```

por:

```tsx
        <div className="grid min-w-[600px] grid-cols-[64px_repeat(5,1fr)] border-b border-border">
```

Segunda ocorrência (corpo do grid):

Substituir:

```tsx
        <div
          className="relative grid min-w-[760px] grid-cols-[56px_repeat(7,1fr)]"
          style={{ gridTemplateRows: `repeat(${HORAS.length * 2}, 32px)` }}
        >
```

por:

```tsx
        <div
          className="relative grid min-w-[600px] grid-cols-[64px_repeat(5,1fr)]"
          style={{ gridTemplateRows: `repeat(${HORAS.length * 2}, ${ALTURA_LINHA_PX}px)` }}
        >
```

- [ ] **Step 5: Aumentar o texto do rótulo de hora**

Substituir:

```tsx
              className="border-t border-border pr-2 text-right text-[11.5px] text-muted"
```

por:

```tsx
              className="border-t border-border pr-2 text-right text-[13px] font-semibold text-muted"
```

- [ ] **Step 6: Ignorar sessões de sábado/domingo (índice de dia > 4) — a grade só tem 5 colunas agora**

Substituir:

```tsx
          {sessoes.map((sessao) => {
            const pos = sessaoGridPosition(sessao.data_hora, sessao.duracao_minutos);
            if (pos.rowStart < 1 || pos.rowStart > HORAS.length * 2) return null;
            return (
```

por:

```tsx
          {sessoes.map((sessao) => {
            const pos = sessaoGridPosition(sessao.data_hora, sessao.duracao_minutos);
            if (pos.dayIndex > 4 || pos.rowStart < 1 || pos.rowStart > HORAS.length * 2) return null;
            return (
```

- [ ] **Step 7: Cards de sessão sólidos por modalidade, sem borda esquerda**

Substituir o `<button>` da sessão inteiro:

```tsx
              <button
                key={sessao.id}
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/plain", String(sessao.id));
                  setArrastando(sessao.id);
                }}
                onDragEnd={() => setArrastando(null)}
                onClick={() => abrirPreview(sessao)}
                className={`m-0.5 cursor-grab overflow-hidden rounded-lg border-l-[3px] border-accent bg-accent-soft px-2 py-1 text-left text-[12px] font-bold text-accent-dark hover:brightness-95 active:cursor-grabbing ${
                  arrastando === sessao.id ? "opacity-40" : ""
                }`}
                style={{
                  gridColumn: pos.dayIndex + 2,
                  gridRow: `${pos.rowStart} / span ${pos.rowSpan}`,
                }}
              >
                <span className="block text-[11px] font-semibold opacity-80">
                  {formatHoraBrasilia(sessao.data_hora)}
                </span>
                {sessao.paciente_nome}
                <span className="block truncate text-[10.5px] font-medium opacity-70">
                  {sessao.local_nome}
                </span>
              </button>
```

por:

```tsx
              <button
                key={sessao.id}
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/plain", String(sessao.id));
                  setArrastando(sessao.id);
                }}
                onDragEnd={() => setArrastando(null)}
                onClick={() => abrirPreview(sessao)}
                className={`m-[3px] cursor-grab overflow-hidden rounded-xl px-2.5 py-2 text-left text-[12px] font-bold text-white shadow-[0_4px_10px_var(--color-shadow)] hover:brightness-95 active:cursor-grabbing ${
                  sessao.modalidade === "teleconsulta" ? "bg-gold" : "bg-accent"
                } ${arrastando === sessao.id ? "opacity-40" : ""}`}
                style={{
                  gridColumn: pos.dayIndex + 2,
                  gridRow: `${pos.rowStart} / span ${pos.rowSpan}`,
                }}
              >
                <span className="block text-[11px] font-semibold opacity-90">
                  {formatHoraBrasilia(sessao.data_hora)}
                </span>
                <span className="block text-[13.5px] font-extrabold">{sessao.paciente_nome}</span>
                <span className="block truncate text-[10.5px] font-semibold opacity-80">
                  {sessao.local_nome}
                </span>
              </button>
```

- [ ] **Step 8: Renderizar a linha do "agora", logo depois do bloco `{sessoes.map(...)}` e antes do `</div>` que fecha o grid do corpo**

Localizar o fechamento:

```tsx
          {sessoes.map((sessao) => {
            /* ... */
          })}
        </div>
      </div>
```

Adicionar a linha do "agora" entre o fim do `.map()` e o `</div>` que fecha o grid (não o que fecha o card externo):

```tsx
          {sessoes.map((sessao) => {
            /* ... conteúdo já existente do Step 6/7 ... */
          })}

          {linhaAgora && (
            <div
              className="pointer-events-none relative z-10"
              style={{ gridColumn: linhaAgora.gridColumn, gridRow: linhaAgora.gridRow }}
            >
              <div
                className="absolute left-0 right-0 h-[2px] bg-accent"
                style={{ top: `${linhaAgora.percentNoSlot}%` }}
              >
                <span className="absolute -left-[5px] -top-[4px] h-[10px] w-[10px] rounded-full bg-accent" />
              </div>
            </div>
          )}
        </div>
      </div>
```

- [ ] **Step 9: Verificar que o arquivo compila**

Run: `cd frontend && npx tsc --noEmit`
Expected: sem erros novos em `AgendaGrid.tsx`.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/components/AgendaGrid.tsx
git commit -m "Redesenha grid da Agenda: 5 colunas, cards sólidos por modalidade, linha do agora"
```

---

## Task 4: Verificação manual no navegador

**Files:** nenhum (só validação)

- [ ] **Step 1: Subir o frontend localmente**

Run:
```bash
export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
cd frontend
npm run dev
```
Expected: servidor sobe em `http://localhost:3000` sem erro de build.

- [ ] **Step 2: Ajustar `API_URL` local pra apontar pro backend de produção (só pra essa validação visual, já que não há backend local rodando)**

Confirmar em `frontend/.env.local` que `API_URL=https://api.nexosystem.online` (trocar temporariamente se ainda apontar pra `localhost:8000`, e reverter depois do teste pra não deixar isso commitado nem afetar dev futuro).

- [ ] **Step 3: Checklist visual**

Abrir `http://localhost:3000/login`, entrar com `luiz@teste.com`, ir em `/agenda` e conferir:
- [ ] Só 5 colunas aparecem (segunda a sexta), sem sábado/domingo
- [ ] Linhas de horário mais altas e com texto maior que antes
- [ ] Botão "Hoje" aparece; clicar nele leva pra semana atual (ou já aparece desabilitado/opaco se já estiver nela)
- [ ] Setas `‹` `›` navegam semana anterior/próxima
- [ ] Sessão de 31/08 (criada via bot no WhatsApp) aparece com fundo sólido rosa (presencial) e sombra, sem borda esquerda fina
- [ ] Se houver alguma sessão de teleconsulta, aparece em dourado
- [ ] Se a semana visível incluir hoje (dia de semana), aparece uma linha fina rosa cruzando a coluna de hoje na altura aproximada do horário atual
- [ ] Arrastar uma sessão pra outro horário/dia ainda funciona (abre confirmação de notificar por email)
- [ ] Clicar numa sessão ainda abre o modal de detalhes/edição
- [ ] Clicar num espaço vazio do grid ainda abre o modal de criar sessão

- [ ] **Step 4: Reverter qualquer alteração feita só pra teste local**

Se `frontend/.env.local` foi alterado no Step 2, reverter pro valor original antes de continuar (não commitar mudança de ambiente local).

---

## Task 5: Deploy

**Files:** nenhum (só deploy)

- [ ] **Step 1: Push pro GitHub**

```bash
git push origin main
```

- [ ] **Step 2: Deploy de produção na Vercel**

```bash
cd frontend
vercel --prod --yes
```
Expected: saída com `"readyState": "READY"` e a URL de produção.

- [ ] **Step 3: Smoke check em produção**

Run: `curl -s -o /dev/null -w "%{http_code}\n" https://frontend-theta-weld-74.vercel.app/api/health`
Expected: `200`

Depois, abrir `https://frontend-theta-weld-74.vercel.app/agenda` no navegador e repetir rapidamente o checklist visual do Task 4 Step 3.
