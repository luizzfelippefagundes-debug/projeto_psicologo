# Cadastro e Edição de Paciente Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir criar e editar pacientes pelo painel (hoje só existe listagem; criar/editar só via API/SQL direto).

**Architecture:** Dois endpoints novos no backend (`POST /pacientes`, `PATCH /pacientes/{id}`) seguindo exatamente o padrão já usado em `/locais` e `/sessoes/{id}`. No frontend, o componente `PacientesTable.tsx` passa a ser dono do fluxo completo (listar + criar + editar) via um modal reaproveitado, no mesmo espírito do `AgendaGrid.tsx`.

**Tech Stack:** FastAPI + asyncpg (backend), Next.js 16 App Router + React client component + Tailwind (frontend). Sem suíte de testes automatizada no projeto — verificação manual via `curl` e navegador, consistente com o resto do painel.

---

## Contexto para quem for executar

- Backend roda em `http://localhost:8000` (`cd backend && source .venv/bin/activate && uvicorn app.main:app --port 8000 --reload`).
- Frontend roda em `http://localhost:3000` (`cd frontend && npm run dev`, precisa do nvm carregado pra Node 20 — ver `CONTEXTO.md` na raiz do projeto).
- Conta de teste real no banco: email `luiz@teste.com`, senha `senha123`.
- `backend/app/main.py` já importa `EmailStr` de `pydantic` (linha 7) — use-o para o campo `email`.
- O padrão de update dinâmico do projeto é `COALESCE($n, coluna)` na query `UPDATE`, e o padrão de checar duplicidade é um `SELECT` prévio (não `try/except UniqueViolationError`) — ver `signup()` em `backend/app/main.py:60-77`. Siga esse padrão para manter consistência.

---

### Task 1: Backend — incluir `email` na listagem de pacientes

**Files:**
- Modify: `backend/app/main.py:200-219`

- [ ] **Step 1: Adicionar `p.email` ao SELECT de `GET /pacientes`**

Troque:

```python
@app.get("/pacientes")
async def listar_pacientes(profissional_id: int = Depends(auth.get_current_profissional_id)):
    async with db.pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT p.id, p.nome, p.telefone, p.tipo_atendimento, p.status, p.criado_em,
                   prox.data_hora AS proxima_sessao
            FROM pacientes p
            LEFT JOIN LATERAL (
                SELECT data_hora FROM sessoes
                WHERE paciente_id = p.id AND status <> 'cancelada' AND data_hora >= now()
                ORDER BY data_hora ASC
                LIMIT 1
            ) prox ON true
            WHERE p.profissional_id = $1
            ORDER BY p.nome
            """,
            profissional_id,
        )
    return [dict(row) for row in rows]
```

Por:

```python
@app.get("/pacientes")
async def listar_pacientes(profissional_id: int = Depends(auth.get_current_profissional_id)):
    async with db.pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT p.id, p.nome, p.telefone, p.email, p.tipo_atendimento, p.status, p.criado_em,
                   prox.data_hora AS proxima_sessao
            FROM pacientes p
            LEFT JOIN LATERAL (
                SELECT data_hora FROM sessoes
                WHERE paciente_id = p.id AND status <> 'cancelada' AND data_hora >= now()
                ORDER BY data_hora ASC
                LIMIT 1
            ) prox ON true
            WHERE p.profissional_id = $1
            ORDER BY p.nome
            """,
            profissional_id,
        )
    return [dict(row) for row in rows]
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/main.py
git commit -m "Inclui email na listagem de pacientes"
```

---

### Task 2: Backend — `POST /pacientes` e `PATCH /pacientes/{id}`

**Files:**
- Modify: `backend/app/main.py` (inserir logo após o bloco de `GET /pacientes`, antes de `@app.get("/sessoes/hoje")` na linha 222)

- [ ] **Step 1: Inserir os models e os dois endpoints novos**

Insira este bloco imediatamente depois do `return [dict(row) for row in rows]` do `GET /pacientes` (Task 1) e antes de `@app.get("/sessoes/hoje")`:

```python
class PacienteBody(BaseModel):
    nome: str
    telefone: str
    email: EmailStr | None = None
    tipo_atendimento: str = "individual"


class PacienteUpdateBody(BaseModel):
    nome: str | None = None
    telefone: str | None = None
    email: EmailStr | None = None
    tipo_atendimento: str | None = None
    status: str | None = None


@app.post("/pacientes", status_code=status.HTTP_201_CREATED)
async def criar_paciente(body: PacienteBody, profissional_id: int = Depends(auth.get_current_profissional_id)):
    if body.tipo_atendimento not in ("individual", "casal"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="tipo_atendimento inválido")

    async with db.pool.acquire() as conn:
        existente = await conn.fetchval(
            "SELECT id FROM pacientes WHERE profissional_id = $1 AND telefone = $2",
            profissional_id, body.telefone,
        )
        if existente:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Já existe um paciente com esse telefone"
            )

        row = await conn.fetchrow(
            """
            INSERT INTO pacientes (profissional_id, nome, telefone, email, tipo_atendimento)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, nome, telefone, email, tipo_atendimento, status, criado_em
            """,
            profissional_id, body.nome, body.telefone, body.email, body.tipo_atendimento,
        )
    return dict(row)


@app.patch("/pacientes/{paciente_id}")
async def editar_paciente(
    paciente_id: int,
    body: PacienteUpdateBody,
    profissional_id: int = Depends(auth.get_current_profissional_id),
):
    if body.tipo_atendimento is not None and body.tipo_atendimento not in ("individual", "casal"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="tipo_atendimento inválido")
    if body.status is not None and body.status not in ("ativo", "inativo"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="status inválido")

    async with db.pool.acquire() as conn:
        atual = await conn.fetchval(
            "SELECT id FROM pacientes WHERE id = $1 AND profissional_id = $2", paciente_id, profissional_id
        )
        if atual is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Paciente não encontrado")

        if body.telefone is not None:
            duplicado = await conn.fetchval(
                "SELECT id FROM pacientes WHERE profissional_id = $1 AND telefone = $2 AND id <> $3",
                profissional_id, body.telefone, paciente_id,
            )
            if duplicado:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT, detail="Já existe um paciente com esse telefone"
                )

        row = await conn.fetchrow(
            """
            UPDATE pacientes SET
                nome = COALESCE($1, nome),
                telefone = COALESCE($2, telefone),
                email = COALESCE($3, email),
                tipo_atendimento = COALESCE($4, tipo_atendimento),
                status = COALESCE($5, status)
            WHERE id = $6 AND profissional_id = $7
            RETURNING id, nome, telefone, email, tipo_atendimento, status, criado_em
            """,
            body.nome, body.telefone, body.email, body.tipo_atendimento, body.status,
            paciente_id, profissional_id,
        )
    return dict(row)
```

- [ ] **Step 2: Subir o backend (se não estiver rodando)**

Run: `cd backend && source .venv/bin/activate && uvicorn app.main:app --port 8000 --reload`

Deixe rodando num terminal separado (com `--reload` ele recarrega sozinho a cada salvamento).

- [ ] **Step 3: Login e capturar cookie de sessão pra testar**

Run:
```bash
curl -c /tmp/cookies.txt -s -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"luiz@teste.com","senha":"senha123"}'
```
Expected: JSON com `id`, `nome`, `email` do profissional (200 OK), e `/tmp/cookies.txt` contendo o cookie `session`.

- [ ] **Step 4: Testar criação de paciente**

Run:
```bash
curl -b /tmp/cookies.txt -s -X POST http://localhost:8000/pacientes \
  -H "Content-Type: application/json" \
  -d '{"nome":"Paciente Teste Plano","telefone":"11988887777","email":"pacienteteste@example.com","tipo_atendimento":"individual"}'
```
Expected: `201`, JSON com `id`, `nome: "Paciente Teste Plano"`, `email`, `status: "ativo"`.

- [ ] **Step 5: Testar conflito de telefone duplicado**

Run o mesmo comando do Step 4 de novo (mesmo telefone).
Expected: `409` com `{"detail":"Já existe um paciente com esse telefone"}`.

- [ ] **Step 6: Testar edição (trocar nome e inativar)**

Pegue o `id` retornado no Step 4 (ex: `7`) e rode:
```bash
curl -b /tmp/cookies.txt -s -X PATCH http://localhost:8000/pacientes/7 \
  -H "Content-Type: application/json" \
  -d '{"nome":"Paciente Teste Editado","status":"inativo"}'
```
Expected: `200`, JSON com `nome: "Paciente Teste Editado"` e `status: "inativo"`, `telefone` inalterado.

- [ ] **Step 7: Confirmar na listagem**

Run: `curl -b /tmp/cookies.txt -s http://localhost:8000/pacientes`
Expected: array incluindo o paciente com `email` preenchido, `nome` editado e `status: "inativo"`.

- [ ] **Step 8: Commit**

```bash
git add backend/app/main.py
git commit -m "Adiciona POST/PATCH /pacientes para criar e editar paciente"
```

---

### Task 3: Frontend — tipo `Paciente` ganha `email`

**Files:**
- Modify: `frontend/src/lib/format.ts:1-9`

- [ ] **Step 1: Adicionar o campo `email`**

Troque:

```typescript
export type Paciente = {
  id: number;
  nome: string;
  telefone: string;
  tipo_atendimento: "individual" | "casal";
  status: "ativo" | "inativo";
  criado_em: string;
  proxima_sessao: string | null;
};
```

Por:

```typescript
export type Paciente = {
  id: number;
  nome: string;
  telefone: string;
  email: string | null;
  tipo_atendimento: "individual" | "casal";
  status: "ativo" | "inativo";
  criado_em: string;
  proxima_sessao: string | null;
};
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/lib/format.ts
git commit -m "Adiciona campo email ao tipo Paciente"
```

---

### Task 4: Frontend — `PacientesTable.tsx` ganha criar/editar via modal

**Files:**
- Modify: `frontend/src/components/PacientesTable.tsx` (reescrita completa do arquivo)

- [ ] **Step 1: Substituir o conteúdo inteiro do arquivo**

Conteúdo atual (referência, para confirmar que é o arquivo certo antes de sobrescrever):

```typescript
"use client";

import { useState } from "react";
import { formatDataHoraBrasilia, iniciais, type Paciente } from "@/lib/format";

export function PacientesTable({ pacientes }: { pacientes: Paciente[] }) {
  // ... (implementação atual, só listagem com busca)
}
```

Novo conteúdo completo:

```typescript
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Modal } from "@/components/Modal";
import { formatDataHoraBrasilia, iniciais, type Paciente } from "@/lib/format";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type FormState = {
  nome: string;
  telefone: string;
  email: string;
  tipoAtendimento: "individual" | "casal";
  status: "ativo" | "inativo";
};

function pacienteParaFormState(paciente: Paciente): FormState {
  return {
    nome: paciente.nome,
    telefone: paciente.telefone,
    email: paciente.email ?? "",
    tipoAtendimento: paciente.tipo_atendimento,
    status: paciente.status,
  };
}

function formStateVazio(): FormState {
  return {
    nome: "",
    telefone: "",
    email: "",
    tipoAtendimento: "individual",
    status: "ativo",
  };
}

export function PacientesTable({ pacientes }: { pacientes: Paciente[] }) {
  const router = useRouter();
  const [busca, setBusca] = useState("");
  const [modalAberto, setModalAberto] = useState(false);
  const [pacienteEditando, setPacienteEditando] = useState<Paciente | null>(null);
  const [form, setForm] = useState<FormState>(formStateVazio());
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const filtrados = pacientes.filter((p) =>
    p.nome.toLowerCase().includes(busca.toLowerCase())
  );

  function abrirCriacao() {
    setPacienteEditando(null);
    setForm(formStateVazio());
    setErro(null);
    setModalAberto(true);
  }

  function abrirEdicao(paciente: Paciente) {
    setPacienteEditando(paciente);
    setForm(pacienteParaFormState(paciente));
    setErro(null);
    setModalAberto(true);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro(null);
    setSalvando(true);

    const payload: Record<string, unknown> = {
      nome: form.nome,
      telefone: form.telefone,
      email: form.email || null,
      tipo_atendimento: form.tipoAtendimento,
    };
    if (pacienteEditando) {
      payload.status = form.status;
    }

    const url = pacienteEditando
      ? `${API_URL}/pacientes/${pacienteEditando.id}`
      : `${API_URL}/pacientes`;
    const method = pacienteEditando ? "PATCH" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErro(data.detail ?? "Não deu pra salvar o paciente.");
      setSalvando(false);
      return;
    }

    setSalvando(false);
    setModalAberto(false);
    router.refresh();
  }

  return (
    <>
      <div className="mb-4 flex justify-end">
        <button
          type="button"
          onClick={abrirCriacao}
          className="rounded-xl bg-accent px-4 py-2.5 text-[13.5px] font-bold text-white transition-colors hover:bg-accent-dark"
        >
          + Novo paciente
        </button>
      </div>

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
          <thead>
            <tr>
              {["Paciente", "Telefone", "Tipo", "Próxima sessão", "Status"].map((col) => (
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
            {filtrados.map((p) => (
              <tr
                key={p.id}
                onClick={() => abrirEdicao(p)}
                className="cursor-pointer hover:bg-accent-soft/40"
              >
                <td className="border-b border-border px-6 py-4 text-[14.5px] last:border-0">
                  <div className="flex items-center gap-3 font-bold">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[14px] font-extrabold text-accent-dark">
                      {iniciais(p.nome)}
                    </div>
                    {p.nome}
                  </div>
                </td>
                <td className="border-b border-border px-6 py-4 text-[14.5px] text-muted">
                  {p.telefone}
                </td>
                <td className="border-b border-border px-6 py-4 text-[14.5px] capitalize">
                  {p.tipo_atendimento}
                </td>
                <td className="border-b border-border px-6 py-4 text-[14.5px] text-muted">
                  {p.proxima_sessao ? formatDataHoraBrasilia(p.proxima_sessao) : "—"}
                </td>
                <td className="border-b border-border px-6 py-4">
                  <span
                    className={`inline-block rounded-full px-3 py-1 text-[12.5px] font-bold ${
                      p.status === "ativo"
                        ? "bg-accent-soft text-accent-dark"
                        : "bg-black/5 text-muted"
                    }`}
                  >
                    {p.status === "ativo" ? "Ativo" : "Inativo"}
                  </span>
                </td>
              </tr>
            ))}
            {filtrados.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-[14px] text-muted">
                  Nenhum paciente encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={modalAberto}
        onClose={() => setModalAberto(false)}
        title={pacienteEditando ? "Editar paciente" : "Novo paciente"}
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col">
            <label htmlFor="nome" className="mb-1.5 text-sm font-semibold">
              Nome
            </label>
            <input
              id="nome"
              required
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
              placeholder="Nome completo"
              className="rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-3 py-2.5 text-[14.5px] outline-none focus:border-accent"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col">
              <label htmlFor="telefone" className="mb-1.5 text-sm font-semibold">
                Telefone
              </label>
              <input
                id="telefone"
                type="tel"
                required
                value={form.telefone}
                onChange={(e) => setForm({ ...form, telefone: e.target.value })}
                placeholder="11999999999"
                className="rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-3 py-2.5 text-[14.5px] outline-none focus:border-accent"
              />
            </div>
            <div className="flex flex-col">
              <label htmlFor="email" className="mb-1.5 text-sm font-semibold">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="opcional"
                className="rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-3 py-2.5 text-[14.5px] outline-none focus:border-accent"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col">
              <label htmlFor="tipo" className="mb-1.5 text-sm font-semibold">
                Tipo de atendimento
              </label>
              <select
                id="tipo"
                value={form.tipoAtendimento}
                onChange={(e) =>
                  setForm({ ...form, tipoAtendimento: e.target.value as "individual" | "casal" })
                }
                className="rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-3 py-2.5 text-[14.5px] outline-none focus:border-accent"
              >
                <option value="individual">Individual</option>
                <option value="casal">Casal</option>
              </select>
            </div>
            {pacienteEditando && (
              <div className="flex flex-col">
                <label htmlFor="status" className="mb-1.5 text-sm font-semibold">
                  Status
                </label>
                <select
                  id="status"
                  value={form.status}
                  onChange={(e) =>
                    setForm({ ...form, status: e.target.value as "ativo" | "inativo" })
                  }
                  className="rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-3 py-2.5 text-[14.5px] outline-none focus:border-accent"
                >
                  <option value="ativo">Ativo</option>
                  <option value="inativo">Inativo</option>
                </select>
              </div>
            )}
          </div>

          {erro && <p className="text-[13px] font-semibold text-red-600">{erro}</p>}

          <div className="flex justify-end pt-1">
            <button
              type="submit"
              disabled={salvando}
              className="rounded-xl bg-accent px-5 py-2.5 text-[14.5px] font-bold text-white transition-colors hover:bg-accent-dark disabled:opacity-60"
            >
              {salvando ? "Salvando..." : pacienteEditando ? "Salvar alterações" : "Criar paciente"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
```

- [ ] **Step 2: Rodar o linter/typecheck do frontend**

Run: `cd frontend && npm run lint`
Expected: sem erros novos relacionados a `PacientesTable.tsx` ou `format.ts`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/PacientesTable.tsx
git commit -m "Adiciona criação e edição de paciente via modal na tela de Pacientes"
```

---

### Task 5: Verificação end-to-end no navegador

**Files:** nenhum (só verificação manual)

- [ ] **Step 1: Subir os dois servidores**

Backend: `cd backend && source .venv/bin/activate && uvicorn app.main:app --port 8000 --reload`
Frontend: `export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"; cd frontend && npm run dev`

- [ ] **Step 2: Login e navegação até Pacientes**

Abrir `http://localhost:3000/login`, logar com `luiz@teste.com` / `senha123`, ir para a rota de Pacientes.
Expected: tabela carrega normalmente, botão "+ Novo paciente" visível no topo.

- [ ] **Step 3: Criar paciente pela UI**

Clicar em "+ Novo paciente", preencher Nome, Telefone, Email, Tipo de atendimento, submeter.
Expected: modal fecha, paciente aparece na tabela com status "Ativo".

- [ ] **Step 4: Testar erro de telefone duplicado pela UI**

Criar outro paciente usando o mesmo telefone do Step 3.
Expected: modal permanece aberto, mensagem de erro "Já existe um paciente com esse telefone" aparece abaixo do form.

- [ ] **Step 5: Editar paciente pela UI**

Clicar na linha do paciente criado no Step 3. Modal abre pré-preenchido (incluindo o campo Status, que só aparece em edição). Trocar o nome e mudar Status para "Inativo", salvar.
Expected: modal fecha, linha da tabela reflete nome novo e badge "Inativo".

- [ ] **Step 6: Confirmar isolamento multi-tenant (checagem rápida)**

Fazer logout e login com outra conta de profissional (se existir) ou revisar visualmente que a lista não mudou de forma inesperada.
Expected: nenhum paciente de outro profissional aparece na lista.

---

## Self-Review (spec coverage)

- Criar paciente (nome, telefone, email, tipo) → Task 2 (backend) + Task 4 (frontend). ✅
- Editar paciente (mesmos campos + status) → Task 2 + Task 4. ✅
- Modal único reaproveitado para criar/editar → Task 4. ✅
- Sem checkbox LGPD → não incluído em nenhum campo do form (Task 4). ✅
- Sem exclusão permanente, só toggle ativo/inativo → Task 2 não expõe DELETE, Task 4 só oferece select de status. ✅
- `GET /pacientes` retorna `email` → Task 1. ✅
- 409 em telefone duplicado, tanto criação quanto edição → Task 2 (Steps 4-5), Task 5 (Step 4). ✅
