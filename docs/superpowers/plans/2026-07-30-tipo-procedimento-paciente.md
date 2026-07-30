# Tipo de Procedimento no Cadastro de Paciente Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar `tipo_procedimento` (5 valores fixos: avaliação neuropsicológica, terapia, reabilitação com/sem estimulação transcraniana, neuromodulação) como campo obrigatório de seleção única no cadastro/edição de paciente, com coluna nova na tabela de listagem.

**Architecture:** Coluna nova em `pacientes` (nullable no banco, obrigatória na aplicação), validada nos mesmos moldes de `tipo_atendimento`/`status` já existentes em `POST`/`PATCH /pacientes`. No frontend, novo `select` no modal de `PacientesTable.tsx` e nova coluna na tabela.

**Tech Stack:** FastAPI + asyncpg (backend), Next.js 16 + React client component + Tailwind (frontend), PostgreSQL (Neon). Sem suíte de testes automatizada — verificação manual via `curl` e navegador.

---

## Contexto para quem for executar

- Backend em `http://localhost:8000`, frontend em `http://localhost:3000` — ambos já devem estar rodando (`--reload` no backend recarrega sozinho).
- Conta de teste: `luiz@teste.com` / `senha123`.
- **Não existe ferramenta de migração no projeto.** `schema.sql` é só documentação do schema — mudanças no banco ao vivo (Neon) são aplicadas rodando SQL direto via um script Python com `asyncpg`, usando `DATABASE_URL` do `.env`. Esse é o padrão já usado neste projeto (não é algo novo sendo introduzido).
- O padrão de validação de campo com valores fixos já existe em `backend/app/main.py` para `tipo_atendimento` (`in ("individual", "casal")`) e `status` (`in ("ativo", "inativo")`) — replique o mesmo estilo (`if body.campo not in (...): raise HTTPException(400, ...)`).

---

### Task 1: Migração do banco — adicionar coluna `tipo_procedimento`

**Files:**
- Modify: `schema.sql:33-47` (documentação do schema)
- Nenhum arquivo novo — a migração em si roda como comando único, não fica salva como script no repo (consistente com o fato de não haver ferramenta de migração no projeto)

- [ ] **Step 1: Rodar a migração no banco Neon**

Run:
```bash
cd backend && source .venv/bin/activate && python3 -c "
import asyncio, asyncpg, os
from dotenv import load_dotenv
load_dotenv('../.env')
async def main():
    conn = await asyncpg.connect(os.environ['DATABASE_URL'])
    await conn.execute('''
        ALTER TABLE pacientes ADD COLUMN tipo_procedimento VARCHAR(60)
            CHECK (tipo_procedimento IN (
                'avaliacao_neuropsicologica',
                'terapia',
                'reabilitacao_com_estimulacao',
                'reabilitacao_sem_estimulacao',
                'neuromodulacao'
            ))
    ''')
    print('OK: coluna tipo_procedimento adicionada')
    await conn.close()
asyncio.run(main())
"
```
Expected: `OK: coluna tipo_procedimento adicionada`. Se der erro `column "tipo_procedimento" of relation "pacientes" already exists`, a migração já rodou antes — pule pro Step 2.

- [ ] **Step 2: Confirmar a coluna existe**

Run:
```bash
cd backend && source .venv/bin/activate && python3 -c "
import asyncio, asyncpg, os
from dotenv import load_dotenv
load_dotenv('../.env')
async def main():
    conn = await asyncpg.connect(os.environ['DATABASE_URL'])
    row = await conn.fetchrow(\"SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'pacientes' AND column_name = 'tipo_procedimento'\")
    print(dict(row) if row else 'COLUNA NAO ENCONTRADA')
    await conn.close()
asyncio.run(main())
"
```
Expected: `{'column_name': 'tipo_procedimento', 'data_type': 'character varying'}`

- [ ] **Step 3: Atualizar `schema.sql` pra documentar a coluna nova**

Troque (`schema.sql:33-47`):

```sql
CREATE TABLE pacientes (
    id SERIAL PRIMARY KEY,
    profissional_id INTEGER NOT NULL REFERENCES profissionais(id) ON DELETE CASCADE,
    nome VARCHAR(150) NOT NULL,
    telefone VARCHAR(20) NOT NULL, -- número de WhatsApp do paciente
    email VARCHAR(150),
    tipo_atendimento VARCHAR(20) NOT NULL DEFAULT 'individual'
        CHECK (tipo_atendimento IN ('individual', 'casal')),
    status VARCHAR(20) NOT NULL DEFAULT 'ativo'
        CHECK (status IN ('ativo', 'inativo')),
    consentimento_lgpd BOOLEAN NOT NULL DEFAULT false,
    consentimento_lgpd_data TIMESTAMPTZ,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (profissional_id, telefone)
);
```

Por:

```sql
CREATE TABLE pacientes (
    id SERIAL PRIMARY KEY,
    profissional_id INTEGER NOT NULL REFERENCES profissionais(id) ON DELETE CASCADE,
    nome VARCHAR(150) NOT NULL,
    telefone VARCHAR(20) NOT NULL, -- número de WhatsApp do paciente
    email VARCHAR(150),
    tipo_atendimento VARCHAR(20) NOT NULL DEFAULT 'individual'
        CHECK (tipo_atendimento IN ('individual', 'casal')),
    tipo_procedimento VARCHAR(60)
        CHECK (tipo_procedimento IN (
            'avaliacao_neuropsicologica',
            'terapia',
            'reabilitacao_com_estimulacao',
            'reabilitacao_sem_estimulacao',
            'neuromodulacao'
        )), -- obrigatório na aplicação, não no banco (pacientes antigos ficam NULL)
    status VARCHAR(20) NOT NULL DEFAULT 'ativo'
        CHECK (status IN ('ativo', 'inativo')),
    consentimento_lgpd BOOLEAN NOT NULL DEFAULT false,
    consentimento_lgpd_data TIMESTAMPTZ,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (profissional_id, telefone)
);
```

- [ ] **Step 4: Commit**

```bash
git add schema.sql
git commit -m "Adiciona coluna tipo_procedimento em pacientes"
```

---

### Task 2: Backend — validar e persistir `tipo_procedimento`

**Files:**
- Modify: `backend/app/main.py:200-304`

- [ ] **Step 1: Adicionar a constante de valores válidos**

Insira logo antes de `class PacienteBody(BaseModel):` (linha 222):

```python
TIPOS_PROCEDIMENTO = (
    "avaliacao_neuropsicologica",
    "terapia",
    "reabilitacao_com_estimulacao",
    "reabilitacao_sem_estimulacao",
    "neuromodulacao",
)


```

- [ ] **Step 2: Adicionar o campo nos dois models**

Troque:

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
```

Por:

```python
class PacienteBody(BaseModel):
    nome: str
    telefone: str
    email: EmailStr | None = None
    tipo_atendimento: str = "individual"
    tipo_procedimento: str


class PacienteUpdateBody(BaseModel):
    nome: str | None = None
    telefone: str | None = None
    email: EmailStr | None = None
    tipo_atendimento: str | None = None
    tipo_procedimento: str | None = None
    status: str | None = None
```

- [ ] **Step 3: Validar e persistir em `criar_paciente`**

Troque:

```python
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
```

Por:

```python
@app.post("/pacientes", status_code=status.HTTP_201_CREATED)
async def criar_paciente(body: PacienteBody, profissional_id: int = Depends(auth.get_current_profissional_id)):
    if body.tipo_atendimento not in ("individual", "casal"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="tipo_atendimento inválido")
    if body.tipo_procedimento not in TIPOS_PROCEDIMENTO:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="tipo_procedimento inválido")

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
            INSERT INTO pacientes (profissional_id, nome, telefone, email, tipo_atendimento, tipo_procedimento)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, nome, telefone, email, tipo_atendimento, tipo_procedimento, status, criado_em
            """,
            profissional_id, body.nome, body.telefone, body.email, body.tipo_atendimento, body.tipo_procedimento,
        )
    return dict(row)
```

- [ ] **Step 4: Validar e persistir em `editar_paciente`**

Troque:

```python
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

Por:

```python
@app.patch("/pacientes/{paciente_id}")
async def editar_paciente(
    paciente_id: int,
    body: PacienteUpdateBody,
    profissional_id: int = Depends(auth.get_current_profissional_id),
):
    if body.tipo_atendimento is not None and body.tipo_atendimento not in ("individual", "casal"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="tipo_atendimento inválido")
    if body.tipo_procedimento is not None and body.tipo_procedimento not in TIPOS_PROCEDIMENTO:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="tipo_procedimento inválido")
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
                tipo_procedimento = COALESCE($5, tipo_procedimento),
                status = COALESCE($6, status)
            WHERE id = $7 AND profissional_id = $8
            RETURNING id, nome, telefone, email, tipo_atendimento, tipo_procedimento, status, criado_em
            """,
            body.nome, body.telefone, body.email, body.tipo_atendimento, body.tipo_procedimento, body.status,
            paciente_id, profissional_id,
        )
    return dict(row)
```

- [ ] **Step 5: Incluir a coluna no `GET /pacientes`**

Troque (linha 205):

```python
            SELECT p.id, p.nome, p.telefone, p.email, p.tipo_atendimento, p.status, p.criado_em,
                   prox.data_hora AS proxima_sessao
```

Por:

```python
            SELECT p.id, p.nome, p.telefone, p.email, p.tipo_atendimento, p.tipo_procedimento, p.status, p.criado_em,
                   prox.data_hora AS proxima_sessao
```

- [ ] **Step 6: Verificar via curl — 422 quando falta o campo**

Backend com `--reload` já deve ter recarregado. Login:
```bash
curl -c /tmp/cookies.txt -s -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" -d '{"email":"luiz@teste.com","senha":"senha123"}'
```

Criar sem `tipo_procedimento`:
```bash
curl -b /tmp/cookies.txt -s -w "\nHTTP_STATUS:%{http_code}\n" -X POST http://localhost:8000/pacientes \
  -H "Content-Type: application/json" \
  -d '{"nome":"Teste Sem Procedimento","telefone":"11955554444"}'
```
Expected: `HTTP_STATUS:422` (Pydantic rejeita por campo obrigatório ausente).

- [ ] **Step 7: Verificar via curl — 400 com valor inválido**

```bash
curl -b /tmp/cookies.txt -s -w "\nHTTP_STATUS:%{http_code}\n" -X POST http://localhost:8000/pacientes \
  -H "Content-Type: application/json" \
  -d '{"nome":"Teste Procedimento Invalido","telefone":"11955554444","tipo_procedimento":"acupuntura"}'
```
Expected: `HTTP_STATUS:400`, `{"detail":"tipo_procedimento inválido"}`.

- [ ] **Step 8: Verificar via curl — criação e edição válidas**

```bash
curl -b /tmp/cookies.txt -s -w "\nHTTP_STATUS:%{http_code}\n" -X POST http://localhost:8000/pacientes \
  -H "Content-Type: application/json" \
  -d '{"nome":"Teste Procedimento Valido","telefone":"11955554444","tipo_procedimento":"neuromodulacao"}'
```
Expected: `HTTP_STATUS:201`, JSON com `"tipo_procedimento":"neuromodulacao"`. Anote o `id` retornado (ex: `9`).

```bash
curl -b /tmp/cookies.txt -s -w "\nHTTP_STATUS:%{http_code}\n" -X PATCH http://localhost:8000/pacientes/9 \
  -H "Content-Type: application/json" \
  -d '{"tipo_procedimento":"terapia"}'
```
Expected: `HTTP_STATUS:200`, JSON com `"tipo_procedimento":"terapia"`, resto dos campos inalterado.

- [ ] **Step 9: Limpar o paciente de teste do banco**

```bash
cd backend && source .venv/bin/activate && python3 -c "
import asyncio, asyncpg, os
from dotenv import load_dotenv
load_dotenv('../.env')
async def main():
    conn = await asyncpg.connect(os.environ['DATABASE_URL'])
    result = await conn.execute(\"DELETE FROM pacientes WHERE telefone = '11955554444'\")
    print(result)
    await conn.close()
asyncio.run(main())
"
```
Expected: `DELETE 1`.

- [ ] **Step 10: Commit**

```bash
git add backend/app/main.py
git commit -m "Adiciona validação e persistência de tipo_procedimento em POST/PATCH /pacientes"
```

---

### Task 3: Frontend — tipo `Paciente` e lista de procedimentos

**Files:**
- Modify: `frontend/src/lib/format.ts:1-10`

- [ ] **Step 1: Adicionar o campo ao tipo `Paciente`**

Troque:

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

Por:

```typescript
export type Paciente = {
  id: number;
  nome: string;
  telefone: string;
  email: string | null;
  tipo_atendimento: "individual" | "casal";
  tipo_procedimento: string | null;
  status: "ativo" | "inativo";
  criado_em: string;
  proxima_sessao: string | null;
};

export const PROCEDIMENTOS = [
  { value: "avaliacao_neuropsicologica", label: "Avaliação neuropsicológica" },
  { value: "terapia", label: "Terapia" },
  { value: "reabilitacao_com_estimulacao", label: "Reabilitação com estimulação transcraniana" },
  { value: "reabilitacao_sem_estimulacao", label: "Reabilitação sem estimulação transcraniana" },
  { value: "neuromodulacao", label: "Neuromodulação" },
] as const;

export function labelProcedimento(value: string | null): string {
  return PROCEDIMENTOS.find((p) => p.value === value)?.label ?? "—";
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/lib/format.ts
git commit -m "Adiciona tipo_procedimento ao tipo Paciente e lista PROCEDIMENTOS"
```

---

### Task 4: Frontend — coluna e campo de tipo de procedimento em `PacientesTable.tsx`

**Files:**
- Modify: `frontend/src/components/PacientesTable.tsx`

- [ ] **Step 1: Importar `PROCEDIMENTOS`/`labelProcedimento` e incluir no `FormState`**

Troque:

```typescript
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
```

Por:

```typescript
import { formatDataHoraBrasilia, iniciais, labelProcedimento, PROCEDIMENTOS, type Paciente } from "@/lib/format";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type FormState = {
  nome: string;
  telefone: string;
  email: string;
  tipoAtendimento: "individual" | "casal";
  tipoProcedimento: string;
  status: "ativo" | "inativo";
};

function pacienteParaFormState(paciente: Paciente): FormState {
  return {
    nome: paciente.nome,
    telefone: paciente.telefone,
    email: paciente.email ?? "",
    tipoAtendimento: paciente.tipo_atendimento,
    tipoProcedimento: paciente.tipo_procedimento ?? "",
    status: paciente.status,
  };
}

function formStateVazio(): FormState {
  return {
    nome: "",
    telefone: "",
    email: "",
    tipoAtendimento: "individual",
    tipoProcedimento: "",
    status: "ativo",
  };
}
```

- [ ] **Step 2: Incluir `tipo_procedimento` no payload de submit**

Troque:

```typescript
    const payload: Record<string, unknown> = {
      nome: form.nome,
      telefone: form.telefone,
      email: form.email || null,
      tipo_atendimento: form.tipoAtendimento,
    };
    if (pacienteEditando) {
      payload.status = form.status;
    }
```

Por:

```typescript
    const payload: Record<string, unknown> = {
      nome: form.nome,
      telefone: form.telefone,
      email: form.email || null,
      tipo_atendimento: form.tipoAtendimento,
      tipo_procedimento: form.tipoProcedimento,
    };
    if (pacienteEditando) {
      payload.status = form.status;
    }
```

- [ ] **Step 3: Adicionar a coluna "Procedimento" no cabeçalho e nas linhas da tabela**

Troque:

```typescript
              {["Paciente", "Telefone", "Tipo", "Próxima sessão", "Status"].map((col) => (
```

Por:

```typescript
              {["Paciente", "Telefone", "Tipo", "Procedimento", "Próxima sessão", "Status"].map((col) => (
```

Troque:

```typescript
                <td className="border-b border-border px-6 py-4 text-[14.5px] capitalize">
                  {p.tipo_atendimento}
                </td>
                <td className="border-b border-border px-6 py-4 text-[14.5px] text-muted">
                  {p.proxima_sessao ? formatDataHoraBrasilia(p.proxima_sessao) : "—"}
                </td>
```

Por:

```typescript
                <td className="border-b border-border px-6 py-4 text-[14.5px] capitalize">
                  {p.tipo_atendimento}
                </td>
                <td className="border-b border-border px-6 py-4 text-[14.5px] text-muted">
                  {labelProcedimento(p.tipo_procedimento)}
                </td>
                <td className="border-b border-border px-6 py-4 text-[14.5px] text-muted">
                  {p.proxima_sessao ? formatDataHoraBrasilia(p.proxima_sessao) : "—"}
                </td>
```

Também troque o `colSpan={5}` da linha de "nenhum paciente encontrado" pra `colSpan={6}` (uma coluna a mais):

```typescript
                <td colSpan={5} className="px-6 py-8 text-center text-[14px] text-muted">
```

Por:

```typescript
                <td colSpan={6} className="px-6 py-8 text-center text-[14px] text-muted">
```

- [ ] **Step 4: Adicionar o select "Tipo de procedimento" no formulário**

Troque:

```typescript
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
```

Por:

```typescript
          <div className="flex flex-col">
            <label htmlFor="tipo-procedimento" className="mb-1.5 text-sm font-semibold">
              Tipo de procedimento
            </label>
            <select
              id="tipo-procedimento"
              required
              value={form.tipoProcedimento}
              onChange={(e) => setForm({ ...form, tipoProcedimento: e.target.value })}
              className="rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-3 py-2.5 text-[14.5px] outline-none focus:border-accent"
            >
              <option value="" disabled>
                Selecione...
              </option>
              {PROCEDIMENTOS.map((proc) => (
                <option key={proc.value} value={proc.value}>
                  {proc.label}
                </option>
              ))}
            </select>
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
```

- [ ] **Step 5: Rodar o linter**

Run: `cd frontend && npm run lint`
Expected: sem erros novos em `PacientesTable.tsx` ou `format.ts` (o erro pré-existente em `ThemeToggle.tsx`, se aparecer, não é relacionado a essa mudança).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/PacientesTable.tsx
git commit -m "Adiciona campo e coluna de tipo de procedimento na tela de Pacientes"
```

---

### Task 5: Verificação end-to-end no navegador

**Files:** nenhum (só verificação manual)

- [ ] **Step 1: Login e navegação até Pacientes**

`http://localhost:3000/login`, logar com `luiz@teste.com` / `senha123`, ir pra Pacientes.
Expected: tabela carrega com a coluna nova "Procedimento"; pacientes já existentes mostram "—" nessa coluna.

- [ ] **Step 2: Tentar criar paciente sem escolher o procedimento**

Clicar em "+ Novo paciente", preencher só Nome/Telefone, tentar submeter sem tocar em "Tipo de procedimento".
Expected: o navegador barra o submit (campo `required`, opção "Selecione..." desabilitada) — formulário não fecha.

- [ ] **Step 3: Criar paciente com procedimento escolhido**

Preencher todos os campos, escolher "Neuromodulação", submeter.
Expected: modal fecha, paciente aparece na tabela com "Neuromodulação" na coluna Procedimento.

- [ ] **Step 4: Editar e trocar o procedimento**

Clicar na linha do paciente criado no Step 3, trocar pra "Terapia", salvar.
Expected: coluna Procedimento atualiza pra "Terapia".

---

## Self-Review (spec coverage)

- 5 valores fixos (avaliação neuropsicológica, terapia, reabilitação com/sem estimulação, neuromodulação) → Task 1 (CHECK constraint) + Task 2 (`TIPOS_PROCEDIMENTO`) + Task 3 (`PROCEDIMENTOS`). ✅
- Seleção única, não múltipla → campo `str`/`VARCHAR`, não array, em todas as camadas. ✅
- Obrigatório na aplicação, nullable no banco → `PacienteBody.tipo_procedimento: str` sem default (obrigatório no POST), coluna sem `NOT NULL` no schema, `PacienteUpdateBody` com `| None` (opcional no PATCH). ✅
- Coluna nova na tabela de listagem → Task 4 Step 3. ✅
- Campo no formulário de criar/editar → Task 4 Step 4. ✅
