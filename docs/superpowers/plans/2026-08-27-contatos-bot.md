# Contatos do bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar, numa aba separada da tela de Pacientes, quem já mandou mensagem pro bot do WhatsApp mas ainda não virou paciente (não agendou), com um botão pra cadastrar direto a partir dali.

**Architecture:** Reaproveita a tabela `bot_conversas` (já tem telefone + timestamp de toda conversa) em vez de criar uma tabela nova — só adiciona a coluna `nome_whatsapp`, capturada do `pushName` que a Evolution API já manda no payload do webhook. Um novo endpoint filtra quem está em `bot_conversas` mas não em `pacientes`. No frontend, a tela de Pacientes ganha abas por query string (`?aba=`), igual ao padrão já usado em `/agenda?semana=`.

**Tech Stack:** FastAPI + asyncpg (backend), Next.js App Router + Tailwind (frontend). Projeto sem suíte de testes automatizados — verificação manual em cada tarefa, como já é prática aqui.

---

## Task 1: Coluna `nome_whatsapp` no schema

**Files:**
- Modify: `schema.sql` (bloco de `bot_conversas`, por volta da linha 135-142)

- [ ] **Step 1: Adicionar a coluna no `schema.sql`**

Localizar:

```sql
CREATE TABLE bot_conversas (
    id SERIAL PRIMARY KEY,
    profissional_id INTEGER NOT NULL REFERENCES profissionais(id) ON DELETE CASCADE,
    telefone_paciente VARCHAR(20) NOT NULL,
    historico JSONB NOT NULL DEFAULT '[]'::jsonb, -- lista de {role, content}, limitada nas últimas N mensagens
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (profissional_id, telefone_paciente)
);
```

Substituir por:

```sql
CREATE TABLE bot_conversas (
    id SERIAL PRIMARY KEY,
    profissional_id INTEGER NOT NULL REFERENCES profissionais(id) ON DELETE CASCADE,
    telefone_paciente VARCHAR(20) NOT NULL,
    nome_whatsapp VARCHAR(100), -- nome de exibição do WhatsApp (pushName), pra listar contatos que não agendaram
    historico JSONB NOT NULL DEFAULT '[]'::jsonb, -- lista de {role, content}, limitada nas últimas N mensagens
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (profissional_id, telefone_paciente)
);
```

- [ ] **Step 2: Aplicar a mudança no banco de verdade (Neon) — o projeto não tem migration runner**

Run (a partir da raiz do projeto, com `backend/.venv` ativado e `.env` carregado):

```bash
cd backend && source .venv/bin/activate && python3 -c "
import asyncio, asyncpg, os
from dotenv import load_dotenv
load_dotenv('../.env')
async def main():
    conn = await asyncpg.connect(os.environ['DATABASE_URL'])
    await conn.execute('ALTER TABLE bot_conversas ADD COLUMN IF NOT EXISTS nome_whatsapp VARCHAR(100)')
    print('coluna adicionada')
    await conn.close()
asyncio.run(main())
"
```

Expected: `coluna adicionada`, sem erro.

- [ ] **Step 3: Commit**

```bash
git add schema.sql
git commit -m "Adiciona coluna nome_whatsapp em bot_conversas"
```

---

## Task 2: Capturar o pushName no webhook

**Files:**
- Modify: `backend/app/main.py:915-948` (`_extrair_mensagem_whatsapp`)
- Modify: `backend/app/main.py:951-1036` (`webhook_whatsapp`)

- [ ] **Step 1: Atualizar `_extrair_mensagem_whatsapp` pra também devolver o pushName**

Localizar a assinatura e o `return` da função (verificar `grep -n "_extrair_mensagem_whatsapp" backend/app/main.py` pra achar a linha atual — pode ter mudado de número desde a escrita deste plano):

```python
def _extrair_mensagem_whatsapp(payload: dict) -> tuple[str | None, str | None, bool, str | None]:
    """Extrai (remoteJid, texto, from_me, message_id) de um webhook da Evolution API.

    O formato exato de aninhamento varia entre versões da Evolution API — tenta as
    duas variações documentadas antes de desistir.
    """
    dados = payload.get("data") or {}

    # variação A: data.key / data.message.conversation
    chave = dados.get("key")
    mensagem_obj = dados.get("message")

    # variação B: data.message.key / data.message.message.conversation
    if chave is None and isinstance(mensagem_obj, dict):
        chave = mensagem_obj.get("key")
        mensagem_obj = mensagem_obj.get("message")

    if not isinstance(chave, dict) or not isinstance(mensagem_obj, dict):
        return None, None, False, None

    remote_jid = chave.get("remoteJid")
    from_me = bool(chave.get("fromMe"))
    message_id = chave.get("id")
    texto = (
        mensagem_obj.get("conversation")
        or (mensagem_obj.get("extendedTextMessage") or {}).get("text")
    )
    return remote_jid, texto, from_me, message_id
```

Substituir por:

```python
def _extrair_mensagem_whatsapp(
    payload: dict,
) -> tuple[str | None, str | None, bool, str | None, str | None]:
    """Extrai (remoteJid, texto, from_me, message_id, push_name) de um webhook da Evolution API.

    O formato exato de aninhamento varia entre versões da Evolution API — tenta as
    duas variações documentadas antes de desistir.
    """
    dados = payload.get("data") or {}
    push_name = dados.get("pushName")

    # variação A: data.key / data.message.conversation
    chave = dados.get("key")
    mensagem_obj = dados.get("message")

    # variação B: data.message.key / data.message.message.conversation
    if chave is None and isinstance(mensagem_obj, dict):
        chave = mensagem_obj.get("key")
        mensagem_obj = mensagem_obj.get("message")

    if not isinstance(chave, dict) or not isinstance(mensagem_obj, dict):
        return None, None, False, None, push_name

    remote_jid = chave.get("remoteJid")
    from_me = bool(chave.get("fromMe"))
    message_id = chave.get("id")
    texto = (
        mensagem_obj.get("conversation")
        or (mensagem_obj.get("extendedTextMessage") or {}).get("text")
    )
    return remote_jid, texto, from_me, message_id, push_name
```

- [ ] **Step 2: Atualizar a chamada em `webhook_whatsapp` e salvar `nome_whatsapp` no INSERT**

Localizar:

```python
    instance = payload.get("instance")
    remote_jid, texto, from_me, message_id = _extrair_mensagem_whatsapp(payload)
```

Substituir por:

```python
    instance = payload.get("instance")
    remote_jid, texto, from_me, message_id, push_name = _extrair_mensagem_whatsapp(payload)
```

Localizar o bloco do INSERT em `bot_conversas` (dentro do `async with _lock_da_conversa(...)`):

```python
        async with db.pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO bot_conversas (profissional_id, telefone_paciente, historico, atualizado_em)
                VALUES ($1, $2, $3::jsonb, now())
                ON CONFLICT (profissional_id, telefone_paciente)
                DO UPDATE SET historico = $3::jsonb, atualizado_em = now()
                """,
                profissional_id, telefone_paciente, json.dumps(novo_historico),
            )
```

Substituir por:

```python
        async with db.pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO bot_conversas (profissional_id, telefone_paciente, nome_whatsapp, historico, atualizado_em)
                VALUES ($1, $2, $3, $4::jsonb, now())
                ON CONFLICT (profissional_id, telefone_paciente)
                DO UPDATE SET
                    historico = $4::jsonb,
                    nome_whatsapp = COALESCE($3, bot_conversas.nome_whatsapp),
                    atualizado_em = now()
                """,
                profissional_id, telefone_paciente, push_name, json.dumps(novo_historico),
            )
```

- [ ] **Step 3: Verificar que o arquivo compila**

Run: `cd backend && source .venv/bin/activate && python3 -c "import ast; ast.parse(open('app/main.py').read()); print('OK')"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/app/main.py
git commit -m "Captura pushName da Evolution API e salva em bot_conversas"
```

---

## Task 3: Endpoint `GET /contatos-bot`

**Files:**
- Modify: `backend/app/main.py` (logo depois do endpoint `resolver_conversa_escalonada`, por volta da linha 1100)

- [ ] **Step 1: Adicionar o endpoint**

Localizar o fim de `resolver_conversa_escalonada`:

```python
@app.patch("/conversas-escalonadas/{conversa_id}")
async def resolver_conversa_escalonada(
    conversa_id: int, profissional_id: int = Depends(auth.get_current_profissional_id)
):
    async with db.pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            UPDATE conversas_escalonadas SET resolvido = true
            WHERE id = $1 AND profissional_id = $2
            RETURNING id, resolvido
            """,
            conversa_id, profissional_id,
        )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Não encontrado")
    return dict(row)
```

Adicionar logo depois:

```python


@app.get("/contatos-bot")
async def listar_contatos_bot(profissional_id: int = Depends(auth.get_current_profissional_id)):
    async with db.pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT bc.telefone_paciente, bc.nome_whatsapp, bc.atualizado_em
            FROM bot_conversas bc
            WHERE bc.profissional_id = $1
              AND NOT EXISTS (
                SELECT 1 FROM pacientes p
                WHERE p.profissional_id = bc.profissional_id AND p.telefone = bc.telefone_paciente
              )
            ORDER BY bc.atualizado_em DESC
            """,
            profissional_id,
        )
    return [dict(row) for row in rows]
```

- [ ] **Step 2: Verificar que o arquivo compila**

Run: `cd backend && source .venv/bin/activate && python3 -c "import ast; ast.parse(open('app/main.py').read()); print('OK')"`
Expected: `OK`

- [ ] **Step 3: Testar localmente contra o banco real (sem precisar subir o servidor)**

Run:
```bash
cd backend && source .venv/bin/activate && python3 -c "
import asyncio, asyncpg, os
from dotenv import load_dotenv
load_dotenv('../.env')
async def main():
    conn = await asyncpg.connect(os.environ['DATABASE_URL'])
    rows = await conn.fetch('''
        SELECT bc.telefone_paciente, bc.nome_whatsapp, bc.atualizado_em
        FROM bot_conversas bc
        WHERE bc.profissional_id = 1
          AND NOT EXISTS (
            SELECT 1 FROM pacientes p
            WHERE p.profissional_id = bc.profissional_id AND p.telefone = bc.telefone_paciente
          )
        ORDER BY bc.atualizado_em DESC
    ''')
    for r in rows:
        print(dict(r))
    await conn.close()
asyncio.run(main())
"
```
Expected: lista de telefones que conversaram mas não têm paciente cadastrado (pode vir vazia se todo mundo que testou já virou paciente — nesse caso normal, não é erro).

- [ ] **Step 4: Commit**

```bash
git add backend/app/main.py
git commit -m "Adiciona endpoint GET /contatos-bot"
```

---

## Task 4: Deploy do backend

**Files:** nenhum (só deploy)

- [ ] **Step 1: Push e deploy na VPS**

```bash
git push origin main
ssh -i ~/.ssh/hostinger_vps_jamily root@179.199.133.37 "cd /opt/app && git pull origin main && docker compose up -d --build backend"
```

- [ ] **Step 2: Smoke check**

Run: `curl -s -o /dev/null -w "%{http_code}\n" https://api.nexosystem.online/health`
Expected: `200`

---

## Task 5: Cliente e tipos no frontend

**Files:**
- Modify: `frontend/src/lib/format.ts` (adicionar tipo `ContatoBot`)
- Modify: `frontend/src/lib/api.ts` (adicionar `getContatosBot`)

- [ ] **Step 1: Adicionar o tipo em `format.ts`, logo depois do tipo `ConversaEscalonada`**

Localizar:

```ts
export type ConversaEscalonada = {
  id: number;
  telefone_paciente: string | null;
  paciente_nome: string | null;
  previa_conversa: string;
  motivo: "crise" | "fora_do_escopo";
  resolvido: boolean;
  notificado_em: string;
};
```

Adicionar logo depois:

```ts

export type ContatoBot = {
  telefone_paciente: string;
  nome_whatsapp: string | null;
  atualizado_em: string;
};
```

- [ ] **Step 2: Adicionar `getContatosBot` em `api.ts`**

Localizar o import de tipos no topo do arquivo:

```ts
import type {
  ConversaEscalonada,
  DashboardAnalytics,
  DashboardStats,
  Local,
  Paciente,
  RegraHorario,
  SessaoHistorico,
  SessaoHoje,
  SessaoPeriodo,
} from "@/lib/format";
```

Substituir por (adiciona `ContatoBot` na lista, ordem alfabética):

```ts
import type {
  ContatoBot,
  ConversaEscalonada,
  DashboardAnalytics,
  DashboardStats,
  Local,
  Paciente,
  RegraHorario,
  SessaoHistorico,
  SessaoHoje,
  SessaoPeriodo,
} from "@/lib/format";
```

Localizar o final do arquivo:

```ts
export function getConversasEscalonadas() {
  return apiFetch<ConversaEscalonada[]>("/conversas-escalonadas?apenas_pendentes=true");
}
```

Adicionar logo depois:

```ts

export function getContatosBot() {
  return apiFetch<ContatoBot[]>("/contatos-bot");
}
```

- [ ] **Step 3: Verificar que o TypeScript compila**

Run: `cd frontend && npx tsc --noEmit 2>&1 | grep -iE "format.ts|api.ts" || echo "sem erros"`
Expected: `sem erros`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/format.ts frontend/src/lib/api.ts
git commit -m "Adiciona tipo ContatoBot e getContatosBot no client"
```

---

## Task 6: Abas na página de Pacientes

**Files:**
- Modify: `frontend/src/app/(app)/pacientes/page.tsx`

- [ ] **Step 1: Reescrever a página pra ler `?aba=` e buscar os dois conjuntos de dados**

Substituir o arquivo inteiro:

```tsx
import { ThemeToggle } from "@/components/ThemeToggle";
import { PacientesTable } from "@/components/PacientesTable";
import { getContatosBot, getPacientes } from "@/lib/api";

export default async function PacientesPage({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string }>;
}) {
  const { aba } = await searchParams;
  const abaAtiva = aba === "contatos" ? "contatos" : "pacientes";

  const [pacientes, contatos] = await Promise.all([getPacientes(), getContatosBot()]);

  return (
    <div className="pl-12 md:pl-0">
      <div className="mb-7 flex items-center justify-between gap-5">
        <div>
          <h1 className="text-2xl font-extrabold">Pacientes</h1>
          <p className="mt-1 text-[14.5px] text-muted">
            Acompanhe consultas e cadastro de cada paciente
          </p>
        </div>
        <ThemeToggle />
      </div>

      <PacientesTable pacientes={pacientes} contatos={contatos} abaAtiva={abaAtiva} />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add "frontend/src/app/(app)/pacientes/page.tsx"
git commit -m "Página de Pacientes busca contatos e passa aba ativa via query string"
```

(Vai dar erro de tipo até a Task 7 atualizar `PacientesTable` pra aceitar essas novas props — normal, corrige na próxima tarefa antes do deploy.)

---

## Task 7: Aba "Contatos" em `PacientesTable`

**Files:**
- Modify: `frontend/src/components/PacientesTable.tsx`

- [ ] **Step 1: Atualizar imports e a assinatura do componente**

Localizar:

```tsx
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Modal } from "@/components/Modal";
import {
  formatDataHoraBrasilia,
  iniciais,
  labelProcedimento,
  PROCEDIMENTOS,
  type Paciente,
} from "@/lib/format";
```

Substituir por:

```tsx
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Modal } from "@/components/Modal";
import {
  formatDataHoraBrasilia,
  iniciais,
  labelProcedimento,
  PROCEDIMENTOS,
  type ContatoBot,
  type Paciente,
} from "@/lib/format";
```

Localizar:

```tsx
export function PacientesTable({ pacientes }: { pacientes: Paciente[] }) {
```

Substituir por:

```tsx
export function PacientesTable({
  pacientes,
  contatos,
  abaAtiva,
}: {
  pacientes: Paciente[];
  contatos: ContatoBot[];
  abaAtiva: "pacientes" | "contatos";
}) {
```

- [ ] **Step 2: Fazer `abrirCriacao` aceitar um prefill opcional**

Localizar:

```tsx
  function abrirCriacao() {
    setPacienteEditando(null);
    setForm(formStateVazio());
    setErro(null);
    setModalAberto(true);
  }
```

Substituir por:

```tsx
  function abrirCriacao(prefill?: { nome: string; telefone: string }) {
    setPacienteEditando(null);
    setForm(prefill ? { ...formStateVazio(), ...prefill } : formStateVazio());
    setErro(null);
    setModalAberto(true);
  }
```

- [ ] **Step 3: Atualizar o botão "+ Novo paciente" (agora precisa passar sem args explicitamente, já que `abrirCriacao` tem parâmetro opcional e o handler de clique do DOM passaria o `MouseEvent` senão)**

Localizar:

```tsx
        <button
          type="button"
          onClick={abrirCriacao}
          className="rounded-xl bg-accent px-4 py-2.5 text-[13.5px] font-bold text-white transition-colors hover:bg-accent-dark"
        >
          + Novo paciente
        </button>
```

Substituir por:

```tsx
        <button
          type="button"
          onClick={() => abrirCriacao()}
          className="rounded-xl bg-accent px-4 py-2.5 text-[13.5px] font-bold text-white transition-colors hover:bg-accent-dark"
        >
          + Novo paciente
        </button>
```

- [ ] **Step 4: Adicionar as abas, logo antes do card de "Todos os pacientes", e trocar o card pela versão condicional (pacientes ou contatos)**

Localizar:

```tsx
      <div className="rounded-2xl border border-border bg-card shadow-[0_8px_24px_var(--color-shadow)]">
        <div className="flex items-center justify-between gap-4 border-b border-border p-6">
          <h2 className="text-[16px] font-bold">Todos os pacientes</h2>
          <div className="flex items-center gap-2 rounded-xl border border-border bg-accent-soft px-3 py-2 text-[14px]">
            🔍
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar paciente..."
              className="bg-transparent outline-none placeholder:text-muted"
            />
          </div>
        </div>

        <table className="w-full border-collapse">
```

Substituir por:

```tsx
      <div className="mb-4 flex gap-2">
        <Link
          href="/pacientes?aba=pacientes"
          className={`rounded-xl px-4 py-2 text-[13.5px] font-bold ${
            abaAtiva === "pacientes"
              ? "bg-accent text-white"
              : "border border-border bg-card text-fg"
          }`}
        >
          Pacientes
        </Link>
        <Link
          href="/pacientes?aba=contatos"
          className={`rounded-xl px-4 py-2 text-[13.5px] font-bold ${
            abaAtiva === "contatos"
              ? "bg-accent text-white"
              : "border border-border bg-card text-fg"
          }`}
        >
          Contatos{contatos.length > 0 ? ` (${contatos.length})` : ""}
        </Link>
      </div>

      {abaAtiva === "contatos" ? (
        <div className="rounded-2xl border border-border bg-card shadow-[0_8px_24px_var(--color-shadow)]">
          <div className="border-b border-border p-6">
            <h2 className="text-[16px] font-bold">Conversaram mas não agendaram</h2>
            <p className="mt-1 text-[13px] text-muted">
              Pessoas que mandaram mensagem pro assistente do WhatsApp mas ainda não têm
              agendamento.
            </p>
          </div>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {["Nome", "Telefone", "Última mensagem", ""].map((col) => (
                  <th
                    key={col}
                    className="border-b border-border px-6 py-3.5 text-left text-[12.5px] font-bold uppercase tracking-wide text-muted"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {contatos.map((c) => (
                <tr key={c.telefone_paciente}>
                  <td className="border-b border-border px-6 py-4 text-[14.5px] font-bold last:border-0">
                    {c.nome_whatsapp ?? "Não informado"}
                  </td>
                  <td className="border-b border-border px-6 py-4 text-[14.5px] text-muted">
                    {c.telefone_paciente}
                  </td>
                  <td className="border-b border-border px-6 py-4 text-[14.5px] text-muted">
                    {formatDataHoraBrasilia(c.atualizado_em)}
                  </td>
                  <td className="border-b border-border px-6 py-4 text-right">
                    <button
                      type="button"
                      onClick={() =>
                        abrirCriacao({
                          nome: c.nome_whatsapp ?? "",
                          telefone: c.telefone_paciente,
                        })
                      }
                      className="rounded-xl border border-border px-3 py-1.5 text-[13px] font-bold text-fg hover:bg-accent-soft"
                    >
                      Cadastrar como paciente
                    </button>
                  </td>
                </tr>
              ))}
              {contatos.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-[14px] text-muted">
                    Ninguém conversou com o bot ainda sem virar paciente.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
      <div className="rounded-2xl border border-border bg-card shadow-[0_8px_24px_var(--color-shadow)]">
        <div className="flex items-center justify-between gap-4 border-b border-border p-6">
          <h2 className="text-[16px] font-bold">Todos os pacientes</h2>
          <div className="flex items-center gap-2 rounded-xl border border-border bg-accent-soft px-3 py-2 text-[14px]">
            🔍
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar paciente..."
              className="bg-transparent outline-none placeholder:text-muted"
            />
          </div>
        </div>

        <table className="w-full border-collapse">
```

- [ ] **Step 5: Fechar o novo bloco condicional logo depois da tabela de pacientes**

Localizar (fim da tabela de pacientes, logo antes do `Modal` de criar/editar):

```tsx
        </table>
      </div>

      <Modal
        open={modalAberto}
        onClose={() => setModalAberto(false)}
        title={pacienteEditando ? "Editar paciente" : "Novo paciente"}
      >
```

Substituir por:

```tsx
        </table>
      </div>
      )}

      <Modal
        open={modalAberto}
        onClose={() => setModalAberto(false)}
        title={pacienteEditando ? "Editar paciente" : "Novo paciente"}
      >
```

- [ ] **Step 6: Verificar que o TypeScript compila**

Run: `cd frontend && npx tsc --noEmit 2>&1 | grep -i "PacientesTable\|pacientes/page" || echo "sem erros"`
Expected: `sem erros`

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/PacientesTable.tsx
git commit -m "Adiciona aba Contatos em Pacientes, com botão de cadastro rápido"
```

---

## Task 8: Verificação manual e deploy do frontend

**Files:** nenhum

- [ ] **Step 1: Rodar localmente e conferir visualmente**

```bash
export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
cd frontend && npm run dev
```

Abrir `http://localhost:3000/pacientes` (com `API_URL` em `.env.local` apontando pra
`https://api.nexosystem.online`, revertendo depois do teste), logado como
`luiz@teste.com`, e conferir:
- [ ] Duas abas aparecem: "Pacientes" (ativa por padrão) e "Contatos (N)"
- [ ] Clicar em "Contatos" mostra a lista de telefones que já conversaram mas não têm
  paciente vinculado
- [ ] Clicar em "Cadastrar como paciente" numa linha abre o modal já com nome e telefone
  preenchidos
- [ ] Completar o cadastro (tipo de procedimento, LGPD) e salvar funciona normal
- [ ] Depois de salvar, esse telefone não aparece mais na aba Contatos (porque virou
  paciente) e passa a aparecer na aba Pacientes
- [ ] A aba "Pacientes" continua funcionando exatamente como antes (criar, editar, buscar)

- [ ] **Step 2: Deploy de produção**

```bash
git push origin main
cd frontend && vercel --prod --yes
```

- [ ] **Step 3: Smoke check**

Run: `curl -s -o /dev/null -w "%{http_code}\n" https://frontend-theta-weld-74.vercel.app/api/health`
Expected: `200`

Repetir o checklist do Step 1 direto em produção.
