# Integração com a Plaud Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trazer transcrição e resumo de gravações da Plaud pra dentro das sessões do sistema — a profissional configura um Zap (Zapier) que manda cada gravação pronta pro nosso backend via webhook, e depois vincula manualmente cada gravação à sessão certa, direto na tela de edição da sessão.

**Architecture:** Webhook público por profissional (`POST /plaud/webhook/{token}`) recebe e guarda o payload bruto do Zapier em `plaud_gravacoes` (sem sessão vinculada ainda). Na tela da sessão, ela escolhe entre as gravações não vinculadas e confirma o vínculo — isso atualiza `sessoes.observacoes` com o resumo e deixa a transcrição completa disponível numa seção própria.

**Tech Stack:** FastAPI + asyncpg (backend), Next.js App Router + TypeScript (frontend), Postgres (Neon).

Este projeto não tem suite de testes automatizada — verificação é sempre manual, contra produção, depois do deploy (mesmo padrão já usado em todo o resto do sistema).

---

### Task 1: Migração do banco

**Files:**
- Create: `backend/scripts/adicionar_plaud.py`
- Modify: `schema.sql` (documentação — adicionar as novas colunas/tabela, mesmo padrão de todo o resto do arquivo)

- [ ] **Step 1: Escrever o script de migração**

```python
# backend/scripts/adicionar_plaud.py
"""Adiciona o suporte à integração com a Plaud: token de webhook por profissional
e a tabela que guarda as gravações recebidas.

Rodar uma única vez direto contra o banco de produção:
    cd backend && .venv/bin/python3 scripts/adicionar_plaud.py
"""
import asyncio
import os
import secrets

import asyncpg
from dotenv import load_dotenv

load_dotenv("../.env")


async def main():
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])

    await conn.execute(
        "ALTER TABLE profissionais ADD COLUMN IF NOT EXISTS plaud_webhook_token VARCHAR(64) UNIQUE"
    )
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS plaud_gravacoes (
            id SERIAL PRIMARY KEY,
            profissional_id INTEGER NOT NULL REFERENCES profissionais(id) ON DELETE CASCADE,
            sessao_id INTEGER REFERENCES sessoes(id) ON DELETE CASCADE,
            transcricao TEXT,
            resumo TEXT,
            gravado_em TIMESTAMPTZ,
            payload_bruto JSONB NOT NULL,
            recebido_em TIMESTAMPTZ NOT NULL DEFAULT now(),
            vinculado_em TIMESTAMPTZ
        )
        """
    )

    # Preenche o token de quem já existe e ainda não tem um.
    profissionais_sem_token = await conn.fetch(
        "SELECT id FROM profissionais WHERE plaud_webhook_token IS NULL"
    )
    for row in profissionais_sem_token:
        token = secrets.token_urlsafe(32)
        await conn.execute(
            "UPDATE profissionais SET plaud_webhook_token = $1 WHERE id = $2", token, row["id"]
        )
        print(f"profissional_id={row['id']}: token gerado")

    print("Migração concluída.")
    await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 2: Rodar contra produção**

Run: `cd backend && .venv/bin/python3 scripts/adicionar_plaud.py`
Expected: imprime "profissional_id=1: token gerado" (ou o id real da profissional cadastrada) seguido de "Migração concluída."

- [ ] **Step 3: Confirmar no banco**

Run:
```bash
cd backend && .venv/bin/python3 -c "
import asyncio, asyncpg, os
from dotenv import load_dotenv
load_dotenv('../.env')
async def main():
    conn = await asyncpg.connect(os.environ['DATABASE_URL'])
    row = await conn.fetchrow('SELECT id, plaud_webhook_token FROM profissionais WHERE id = 1')
    print(dict(row))
    await conn.close()
asyncio.run(main())
"
```
Expected: `plaud_webhook_token` preenchido com uma string longa (não `None`).

- [ ] **Step 4: Documentar no schema.sql**

Adicionar perto de `CREATE TABLE sessoes` (ou logo depois), seguindo o estilo já usado no arquivo (comentários explicando o propósito de cada coluna não óbvia):

```sql
-- Token secreto usado na URL do webhook da Plaud (POST /plaud/webhook/<token>) —
-- cada profissional tem o seu, gerado uma vez.
ALTER TABLE profissionais ADD COLUMN plaud_webhook_token VARCHAR(64) UNIQUE;

CREATE TABLE plaud_gravacoes (
    id SERIAL PRIMARY KEY,
    profissional_id INTEGER NOT NULL REFERENCES profissionais(id) ON DELETE CASCADE,
    sessao_id INTEGER REFERENCES sessoes(id) ON DELETE CASCADE, -- nulo até ser vinculada manualmente
    transcricao TEXT,
    resumo TEXT,
    gravado_em TIMESTAMPTZ, -- extraído do payload do Zapier quando disponível
    payload_bruto JSONB NOT NULL, -- corpo bruto recebido do Zapier, sempre guardado
    recebido_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    vinculado_em TIMESTAMPTZ
);
```

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/adicionar_plaud.py schema.sql
git commit -m "Adiciona banco pra integração com a Plaud (token de webhook + tabela de gravações)"
```

---

### Task 2: Módulo `app/plaud.py`

**Files:**
- Create: `backend/app/plaud.py`

- [ ] **Step 1: Escrever o módulo**

```python
# backend/app/plaud.py
"""Integração com a Plaud: recebe gravações via webhook (configurado pela
profissional no Zapier, gatilho "Transcript & Summary Ready") e permite vincular
manualmente uma gravação a uma sessão."""
from datetime import datetime

from app import db


def _extrair_campo(payload: dict, *chaves_possiveis: str) -> str | None:
    """Tenta achar um campo em payload por uma lista de nomes possíveis — o formato
    exato que o Zapier manda depende de como a profissional mapeou os campos no Zap,
    então não dá pra saber o nome exato de antemão. payload_bruto é sempre guardado
    inteiro, então mesmo se isso não achar nada, a gravação não se perde."""
    for chave in chaves_possiveis:
        valor = payload.get(chave)
        if valor:
            return str(valor)
    return None


def _extrair_data(payload: dict, *chaves_possiveis: str) -> datetime | None:
    bruto = _extrair_campo(payload, *chaves_possiveis)
    if not bruto:
        return None
    try:
        return datetime.fromisoformat(bruto.replace("Z", "+00:00"))
    except ValueError:
        return None


async def processar_webhook(profissional_id: int, payload: dict) -> int:
    """Guarda uma gravação recebida via webhook. Sempre guarda payload_bruto
    inteiro; faz o melhor esforço pra extrair transcrição/resumo/data dos nomes de
    campo mais prováveis (ajustado depois que virmos um payload real do Zapier)."""
    transcricao = _extrair_campo(payload, "transcript", "transcription", "text")
    resumo = _extrair_campo(payload, "summary", "ai_summary")
    gravado_em = _extrair_data(payload, "recorded_at", "created_at", "date")

    async with db.pool.acquire() as conn:
        gravacao_id = await conn.fetchval(
            """
            INSERT INTO plaud_gravacoes (profissional_id, transcricao, resumo, gravado_em, payload_bruto)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id
            """,
            profissional_id, transcricao, resumo, gravado_em, payload,
        )
    return gravacao_id


async def listar_disponiveis(profissional_id: int) -> list:
    """Gravações recebidas pra essa profissional que ainda não foram vinculadas a
    nenhuma sessão."""
    async with db.pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, resumo, gravado_em, recebido_em
            FROM plaud_gravacoes
            WHERE profissional_id = $1 AND sessao_id IS NULL
            ORDER BY recebido_em DESC
            """,
            profissional_id,
        )
    return [dict(row) for row in rows]


async def vincular_a_sessao(profissional_id: int, gravacao_id: int, sessao_id: int) -> dict | None:
    """Vincula uma gravação a uma sessão e atualiza sessoes.observacoes com o
    resumo — adicionado ao final do que já existir, sem apagar nada. Se a sessão já
    tinha outra gravação vinculada, desvincula a anterior (sessao_id = NULL nela) em
    vez de deixar duas gravações apontando pra mesma sessão. Devolve a gravação
    vinculada, ou None se ela não existe/já pertence a outra profissional."""
    async with db.pool.acquire() as conn:
        async with conn.transaction():
            gravacao = await conn.fetchrow(
                "SELECT id, resumo FROM plaud_gravacoes WHERE id = $1 AND profissional_id = $2",
                gravacao_id, profissional_id,
            )
            if gravacao is None:
                return None

            await conn.execute(
                "UPDATE plaud_gravacoes SET sessao_id = NULL, vinculado_em = NULL "
                "WHERE sessao_id = $1 AND profissional_id = $2",
                sessao_id, profissional_id,
            )
            await conn.execute(
                "UPDATE plaud_gravacoes SET sessao_id = $1, vinculado_em = now() WHERE id = $2",
                sessao_id, gravacao_id,
            )

            if gravacao["resumo"]:
                observacoes_atuais = await conn.fetchval(
                    "SELECT observacoes FROM sessoes WHERE id = $1", sessao_id
                )
                # Remove um bloco de resumo automático anterior (se essa sessão já teve
                # outra gravação vinculada antes), preservando o texto que ela escreveu
                # por conta própria antes e depois desse bloco.
                marcador = "\n\n— Resumo automático (Plaud) —\n"
                texto_base = (observacoes_atuais or "").split(marcador)[0].rstrip()
                novo_texto = f"{texto_base}{marcador}{gravacao['resumo']}" if texto_base else (
                    f"— Resumo automático (Plaud) —\n{gravacao['resumo']}"
                )
                await conn.execute(
                    "UPDATE sessoes SET observacoes = $1 WHERE id = $2", novo_texto, sessao_id
                )

    return dict(gravacao)


async def obter_gravacao(profissional_id: int, gravacao_id: int) -> dict | None:
    async with db.pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, sessao_id, transcricao, resumo, gravado_em, recebido_em "
            "FROM plaud_gravacoes WHERE id = $1 AND profissional_id = $2",
            gravacao_id, profissional_id,
        )
    return dict(row) if row else None
```

- [ ] **Step 2: Verificar sintaxe**

Run: `cd backend && python3 -c "import ast; ast.parse(open('app/plaud.py').read())"`
Expected: sem erro.

- [ ] **Step 3: Commit**

```bash
git add backend/app/plaud.py
git commit -m "Adiciona módulo de integração com a Plaud (recebimento e vínculo de gravações)"
```

---

### Task 3: Endpoints em `main.py`

**Files:**
- Modify: `backend/app/main.py`

- [ ] **Step 1: Importar o módulo**

No topo do arquivo, onde já tem `from app import agendamento_publico, anamnese, auth, bot, db, evolution, google_calendar, lembretes, notificacoes, reservas`, adiciona `plaud` na lista (ordem alfabética, como o resto):

```python
from app import agendamento_publico, anamnese, auth, bot, db, evolution, google_calendar, lembretes, notificacoes, plaud, reservas
```

- [ ] **Step 2: Endpoint do webhook (público — o token na URL é a autenticação)**

Adicionar em qualquer lugar depois da definição de `app = FastAPI(...)`, por exemplo perto de outros endpoints públicos como `/anamnese/{token}`:

```python
@app.post("/plaud/webhook/{token}")
async def receber_webhook_plaud(token: str, request: Request):
    async with db.pool.acquire() as conn:
        profissional_id = await conn.fetchval(
            "SELECT id FROM profissionais WHERE plaud_webhook_token = $1", token
        )
    if profissional_id is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Token inválido")

    payload = await request.json()
    gravacao_id = await plaud.processar_webhook(profissional_id, payload)
    return {"status": "recebido", "gravacao_id": gravacao_id}
```

- [ ] **Step 3: Endpoints autenticados (listar disponíveis, obter uma gravação, vincular)**

Adicionar perto dos outros endpoints de `/sessoes`:

```python
@app.get("/plaud/gravacoes-disponiveis")
async def listar_gravacoes_disponiveis(profissional_id: int = Depends(auth.get_current_profissional_id)):
    return await plaud.listar_disponiveis(profissional_id)


@app.get("/plaud/gravacoes/{gravacao_id}")
async def obter_gravacao_plaud(
    gravacao_id: int, profissional_id: int = Depends(auth.get_current_profissional_id)
):
    gravacao = await plaud.obter_gravacao(profissional_id, gravacao_id)
    if gravacao is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gravação não encontrada")
    return gravacao


class VincularGravacaoBody(BaseModel):
    sessao_id: int


@app.patch("/plaud/gravacoes/{gravacao_id}/vincular")
async def vincular_gravacao_plaud(
    gravacao_id: int,
    body: VincularGravacaoBody,
    profissional_id: int = Depends(auth.get_current_profissional_id),
):
    gravacao = await plaud.vincular_a_sessao(profissional_id, gravacao_id, body.sessao_id)
    if gravacao is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gravação não encontrada")
    return {"status": "vinculada"}
```

- [ ] **Step 4: Expor o token de webhook em `/auth/me`**

Localizar o endpoint (já existente):
```python
@app.get("/auth/me")
async def me(profissional_id: int = Depends(auth.get_current_profissional_id)):
    async with db.pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, nome, email, slug FROM profissionais WHERE id = $1", profissional_id
        )
    return dict(row)
```

Trocar a query pra incluir a nova coluna:
```python
        row = await conn.fetchrow(
            "SELECT id, nome, email, slug, plaud_webhook_token FROM profissionais WHERE id = $1",
            profissional_id,
        )
```

- [ ] **Step 5: Expor se a sessão tem gravação vinculada em `GET /sessoes`**

Localizar `listar_sessoes_periodo` e trocar a query por uma com `LEFT JOIN`:

```python
@app.get("/sessoes")
async def listar_sessoes_periodo(
    inicio: date,
    fim: date,
    profissional_id: int = Depends(auth.get_current_profissional_id),
):
    async with db.pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT s.id, s.data_hora, s.duracao_minutos, s.modalidade, s.status, s.observacoes,
                   s.paciente_id, p.nome AS paciente_nome, l.id AS local_id, l.nome AS local_nome,
                   pg.id AS plaud_gravacao_id
            FROM sessoes s
            JOIN pacientes p ON p.id = s.paciente_id
            JOIN locais l ON l.id = s.local_id
            LEFT JOIN plaud_gravacoes pg ON pg.sessao_id = s.id
            WHERE s.profissional_id = $1
              AND s.data_hora::date BETWEEN $2::date AND $3::date
              AND s.status NOT IN ('cancelada', 'reservado')
            ORDER BY s.data_hora
            """,
            profissional_id, inicio, fim,
        )
    return [dict(row) for row in rows]
```

- [ ] **Step 6: Verificar sintaxe e import**

Run:
```bash
cd backend && python3 -c "import ast; ast.parse(open('app/main.py').read())"
.venv/bin/python3 -c "
import sys; sys.path.insert(0, '.')
from dotenv import load_dotenv
load_dotenv('../.env')
import app.main
print('import OK')
"
```
Expected: sem erro, imprime "import OK".

- [ ] **Step 7: Commit**

```bash
git add backend/app/main.py
git commit -m "Adiciona endpoints da integração com a Plaud (webhook, listar, vincular)"
```

---

### Task 4: Deploy do backend e verificação

**Files:** nenhum

- [ ] **Step 1: Deploy**

```bash
git push origin main
ssh root@179.199.133.37 "cd /opt/app && git pull && docker compose up -d --build backend"
```

- [ ] **Step 2: Health check**

Run: `curl -s https://api.nexosystem.online/health`
Expected: `{"status":"ok"}`

- [ ] **Step 3: Testar o webhook com um payload de mentira**

Antes de testar, pegar o token real da profissional (direto no banco — não expor em log nenhum):
```bash
cd backend && .venv/bin/python3 -c "
import asyncio, asyncpg, os
from dotenv import load_dotenv
load_dotenv('../.env')
async def main():
    conn = await asyncpg.connect(os.environ['DATABASE_URL'])
    token = await conn.fetchval('SELECT plaud_webhook_token FROM profissionais WHERE id = 1')
    print(token)
    await conn.close()
asyncio.run(main())
"
```

Com o token em mãos, simular um POST do Zapier:
```bash
curl -s -X POST "https://api.nexosystem.online/plaud/webhook/<TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"summary": "Paciente relatou melhora do sono.", "transcript": "texto de teste da transcrição completa."}'
```
Expected: `{"status":"recebido","gravacao_id":<algum número>}`

- [ ] **Step 4: Confirmar no banco que a extração de campos funcionou com esse formato de teste**

```bash
cd backend && .venv/bin/python3 -c "
import asyncio, asyncpg, os
from dotenv import load_dotenv
load_dotenv('../.env')
async def main():
    conn = await asyncpg.connect(os.environ['DATABASE_URL'])
    row = await conn.fetchrow('SELECT id, resumo, transcricao, payload_bruto FROM plaud_gravacoes ORDER BY id DESC LIMIT 1')
    print(dict(row))
    await conn.close()
asyncio.run(main())
"
```
Expected: `resumo` = "Paciente relatou melhora do sono.", `transcricao` = "texto de teste da transcrição completa." — confirma que a extração funciona pro formato usado no teste (o formato real do Zapier será confirmado na Task 8).

- [ ] **Step 5: Testar `GET /plaud/gravacoes-disponiveis`**

Usar um token de sessão da profissional (mesmo padrão já usado o resto da sessão — `criar_token(1)` do `app/auth.py`) pra confirmar que a gravação de teste aparece na lista.

- [ ] **Step 6: Limpar o dado de teste**

```bash
cd backend && .venv/bin/python3 -c "
import asyncio, asyncpg, os
from dotenv import load_dotenv
load_dotenv('../.env')
async def main():
    conn = await asyncpg.connect(os.environ['DATABASE_URL'])
    await conn.execute('DELETE FROM plaud_gravacoes ORDER BY id DESC LIMIT 1')
    await conn.close()
asyncio.run(main())
"
```
(Se `DELETE ... LIMIT` der erro de sintaxe no Postgres, apagar pelo id específico visto no Step 4 — `DELETE FROM plaud_gravacoes WHERE id = <id>`.)

---

### Task 5: Tipos e funções no frontend (`lib/api.ts`, `lib/format.ts`)

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/lib/format.ts`

- [ ] **Step 1: Adicionar `plaud_webhook_token` no tipo `Profissional`**

```typescript
export type Profissional = {
  id: number;
  nome: string;
  email: string;
  slug: string;
  plaud_webhook_token: string;
};
```

- [ ] **Step 2: Adicionar `plaud_gravacao_id` no tipo `SessaoPeriodo`**

Em `frontend/src/lib/format.ts`:
```typescript
export type SessaoPeriodo = {
  id: number;
  data_hora: string;
  duracao_minutos: number;
  modalidade: "presencial" | "teleconsulta";
  status: "confirmada" | "concluida" | "nao_compareceu";
  observacoes: string | null;
  paciente_id: number;
  paciente_nome: string;
  local_id: number;
  local_nome: string;
  plaud_gravacao_id: number | null;
};
```

- [ ] **Step 3: Novos tipos e funções em `lib/api.ts`**

Adicionar perto de `getBloqueios`/`getSessoesPeriodo`:

```typescript
export type PlaudGravacaoDisponivel = {
  id: number;
  resumo: string | null;
  gravado_em: string | null;
  recebido_em: string;
};

export type PlaudGravacaoDetalhe = {
  id: number;
  sessao_id: number | null;
  transcricao: string | null;
  resumo: string | null;
  gravado_em: string | null;
  recebido_em: string;
};

export function getGravacoesPlaudDisponiveis() {
  return apiFetch<PlaudGravacaoDisponivel[]>("/plaud/gravacoes-disponiveis");
}

export function getGravacaoPlaud(id: number) {
  return apiFetch<PlaudGravacaoDetalhe>(`/plaud/gravacoes/${id}`);
}
```

(`vincularGravacaoPlaud` fica em `AgendaList.tsx` direto via `fetch`, mesmo padrão já usado ali pra `criarBloqueio`/`removerBloqueio` — não centralizado em `api.ts`, que é só pra `GET`s usados em Server Components.)

- [ ] **Step 4: Verificar sintaxe**

Run: `cd frontend && npx tsc --noEmit`
Expected: sem erro (algumas páginas ainda não usam os campos novos, mas os tipos precisam bater).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/lib/format.ts
git commit -m "Adiciona tipos e funções de API pra integração com a Plaud"
```

---

### Task 6: Card "Plaud" em Configurações

**Files:**
- Create: `frontend/src/components/PlaudConexao.tsx`
- Modify: `frontend/src/app/(app)/configuracoes/page.tsx`

- [ ] **Step 1: Componente**

```tsx
// frontend/src/components/PlaudConexao.tsx
"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function PlaudConexao({ webhookToken }: { webhookToken: string }) {
  const [copiado, setCopiado] = useState(false);
  const url = `https://api.nexosystem.online/plaud/webhook/${webhookToken}`;

  function copiar() {
    navigator.clipboard.writeText(url);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 rounded-xl border border-border bg-accent-soft px-3 py-2.5">
        <span className="flex-1 truncate text-[13.5px] text-accent-dark">{url}</span>
        <button
          type="button"
          onClick={copiar}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-accent-dark hover:bg-accent/10"
          aria-label="Copiar URL do webhook"
        >
          {copiado ? <Check className="h-4 w-4" strokeWidth={2.5} /> : <Copy className="h-4 w-4" strokeWidth={2} />}
        </button>
      </div>
      <ol className="list-decimal space-y-1 pl-4 text-[13px] text-muted">
        <li>Crie um Zap no Zapier.</li>
        <li>
          Gatilho: <strong className="text-fg">Plaud</strong> → &quot;Transcript &amp; Summary Ready&quot;.
        </li>
        <li>
          Ação: <strong className="text-fg">Webhooks by Zapier</strong> → POST, usando a URL acima.
        </li>
      </ol>
    </div>
  );
}
```

- [ ] **Step 2: Adicionar o card em Configurações**

Em `frontend/src/app/(app)/configuracoes/page.tsx`, importar o componente:
```typescript
import { PlaudConexao } from "@/components/PlaudConexao";
```

E adicionar o card, logo depois do card "Google Calendar" existente:
```tsx
      <div className="mb-6 rounded-2xl border border-border bg-card p-6 shadow-[0_8px_24px_var(--color-shadow)]">
        <h2 className="mb-4 text-[16px] font-bold">Plaud</h2>
        <p className="mb-4 text-[14px] text-muted">
          Configure um Zap no Zapier pra mandar suas gravações da Plaud direto pra cá — depois você
          vincula cada gravação à sessão certa na tela de edição da sessão.
        </p>
        <PlaudConexao webhookToken={profissional.plaud_webhook_token} />
      </div>
```

(`profissional` já vem de `getMe()`, já usado nesse arquivo pro card do link de agendamento.)

- [ ] **Step 3: Verificar sintaxe e build**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: build limpo.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/PlaudConexao.tsx "frontend/src/app/(app)/configuracoes/page.tsx"
git commit -m "Adiciona card Plaud em Configurações com a URL do webhook"
```

---

### Task 7: Vincular gravação na tela da sessão

**Files:**
- Modify: `frontend/src/components/AgendaList.tsx`

- [ ] **Step 1: Novos imports e estado**

No topo do arquivo, adicionar aos imports já existentes de `lucide-react`:
```typescript
import { Lock, LockOpen, Mic, Pencil, Plus, X } from "lucide-react";
```

Adicionar ao import de `@/lib/api`:
```typescript
import {
  getGravacaoPlaud,
  getGravacoesPlaudDisponiveis,
  type PlaudGravacaoDetalhe,
  type PlaudGravacaoDisponivel,
} from "@/lib/api";
```

Dentro do componente, perto dos outros `useState`:
```typescript
  const [gravacoesDisponiveis, setGravacoesDisponiveis] = useState<PlaudGravacaoDisponivel[]>([]);
  const [modalPlaudAberto, setModalPlaudAberto] = useState(false);
  const [vinculandoGravacao, setVinculandoGravacao] = useState(false);
  const [gravacaoVinculada, setGravacaoVinculada] = useState<PlaudGravacaoDetalhe | null>(null);
  const [transcricaoAberta, setTranscricaoAberta] = useState(false);
```

- [ ] **Step 2: Funções de buscar/vincular/carregar transcrição**

Adicionar perto de `marcarNaoCompareceu`:

```typescript
  async function abrirBuscaPlaud() {
    const res = await fetch(`${API_URL}/plaud/gravacoes-disponiveis`, { credentials: "include" });
    if (res.ok) setGravacoesDisponiveis(await res.json());
    setModalPlaudAberto(true);
  }

  async function vincularPlaud(gravacaoId: number) {
    if (!sessaoEditando) return;
    setVinculandoGravacao(true);
    await fetch(`${API_URL}/plaud/gravacoes/${gravacaoId}/vincular`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ sessao_id: sessaoEditando.id }),
    });
    setVinculandoGravacao(false);
    setModalPlaudAberto(false);
    router.refresh();
  }

  async function carregarTranscricao() {
    if (!sessaoEditando?.plaud_gravacao_id || gravacaoVinculada) {
      setTranscricaoAberta((v) => !v);
      return;
    }
    const gravacao = await getGravacaoPlaud(sessaoEditando.plaud_gravacao_id);
    setGravacaoVinculada(gravacao);
    setTranscricaoAberta(true);
  }
```

- [ ] **Step 3: Resetar estado da Plaud ao abrir edição de uma sessão diferente**

Localizar `abrirEdicao` (função que popula `form`/`sessaoEditando` ao clicar numa sessão existente) e adicionar as linhas de reset no início dela:

```typescript
    setGravacaoVinculada(null);
    setTranscricaoAberta(false);
```

- [ ] **Step 4: Botão "Vincular gravação Plaud" e seção de transcrição**

No formulário de edição (`AgendaList.tsx`), logo depois do bloco do campo "Anotações" (`</div>` que fecha o `textarea` de `observacoes`) e antes da linha `{erro && ...}`, adicionar:

```tsx
          {sessaoEditando && (
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={abrirBuscaPlaud}
                className="flex w-fit items-center gap-1.5 rounded-xl border border-border px-3.5 py-2 text-[13px] font-semibold text-muted hover:bg-accent-soft hover:text-fg"
              >
                <Mic className="h-3.5 w-3.5" strokeWidth={2} />
                Vincular gravação Plaud
              </button>

              {sessaoEditando.plaud_gravacao_id && (
                <div>
                  <button
                    type="button"
                    onClick={carregarTranscricao}
                    className="text-[13px] font-semibold text-accent-dark hover:underline"
                  >
                    {transcricaoAberta ? "Ocultar transcrição (Plaud)" : "Ver transcrição completa (Plaud)"}
                  </button>
                  {transcricaoAberta && gravacaoVinculada && (
                    <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-xl border border-border bg-[var(--color-accent-soft)] p-3 text-[13px] text-muted">
                      {gravacaoVinculada.transcricao || "Sem transcrição disponível pra essa gravação."}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
```

- [ ] **Step 5: Modal de escolha da gravação**

Adicionar um novo `<Modal>`, próximo aos outros já existentes no fim do JSX (antes do `</>` de fechamento do componente, se houver, ou no mesmo nível dos outros `<Modal>`):

```tsx
      <Modal open={modalPlaudAberto} onClose={() => setModalPlaudAberto(false)} title="Vincular gravação Plaud">
        {gravacoesDisponiveis.length === 0 ? (
          <p className="text-[13.5px] text-muted">
            Nenhuma gravação disponível ainda. Configure o Zap no Zapier (Configurações → Plaud) e grave
            uma consulta pela Plaud pra ela aparecer aqui.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {gravacoesDisponiveis.map((g) => (
              <li key={g.id}>
                <button
                  type="button"
                  onClick={() => vincularPlaud(g.id)}
                  disabled={vinculandoGravacao}
                  className="w-full rounded-xl border border-border p-3 text-left text-[13.5px] hover:bg-accent-soft disabled:opacity-60"
                >
                  <div className="font-bold">
                    {g.gravado_em ? formatDataHoraBrasilia(g.gravado_em) : formatDataHoraBrasilia(g.recebido_em)}
                  </div>
                  <div className="mt-1 truncate text-muted">{g.resumo || "Sem resumo disponível."}</div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Modal>
```

`formatDataHoraBrasilia` já está importado no arquivo (usado em outros pontos da Agenda).

- [ ] **Step 6: Verificar sintaxe e build**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: build limpo.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/AgendaList.tsx
git commit -m "Adiciona vínculo de gravação Plaud e transcrição na tela da sessão"
```

---

### Task 8: Deploy do frontend e verificação ponta a ponta com o Zap real

**Files:** nenhum

- [ ] **Step 1: Deploy**

```bash
cd frontend && vercel --prod --yes
```

- [ ] **Step 2: Health check**

Run: `curl -s -o /dev/null -w "%{http_code}\n" https://consultoriopsicologia.nexosystem.online/configuracoes`
Expected: `307` (redirect pro login, já que o curl não tem cookie de sessão — confirma que a página existe e não deu 500).

- [ ] **Step 3: Fluxo manual completo (só o usuário consegue fazer essa parte — precisa da conta Zapier/Plaud reais)**

1. Abrir Configurações, conferir que o card "Plaud" aparece com a URL do webhook.
2. Copiar a URL, criar o Zap no Zapier (gatilho Plaud "Transcript & Summary Ready" → ação Webhooks by Zapier POST com essa URL).
3. Gravar uma consulta de teste pela Plaud (ou usar o "Test trigger" do próprio Zapier, se disponível, pra disparar sem esperar uma gravação de verdade).
4. Confirmar no Zapier que o Zap rodou com sucesso (histórico de execuções).

- [ ] **Step 4: Capturar o payload real e ajustar a extração de campos**

Consultar o banco pra ver o `payload_bruto` que chegou de verdade:
```bash
cd backend && .venv/bin/python3 -c "
import asyncio, asyncpg, os, json
from dotenv import load_dotenv
load_dotenv('../.env')
async def main():
    conn = await asyncpg.connect(os.environ['DATABASE_URL'])
    row = await conn.fetchrow('SELECT id, payload_bruto, resumo, transcricao FROM plaud_gravacoes ORDER BY id DESC LIMIT 1')
    print(json.dumps(row['payload_bruto'], indent=2, ensure_ascii=False))
    print('resumo extraído:', row['resumo'])
    print('transcrição extraída:', row['transcricao'])
    await conn.close()
asyncio.run(main())
"
```

Se `resumo`/`transcricao` vieram `None` (os nomes de campo reais não bateram com os
chutados em `_extrair_campo`), ajustar `backend/app/plaud.py`:
- Olhar as chaves reais em `payload_bruto` impresso acima.
- Adicionar essas chaves nas chamadas de `_extrair_campo(payload, ...)` dentro de
  `processar_webhook` (função já escrita na Task 2) — sem remover as chaves
  chutadas, só adicionar as reais na frente da lista.
- Reprocessar a gravação de teste já recebida (não precisa disparar o Zap de novo):
  ```bash
  cd backend && .venv/bin/python3 -c "
  import asyncio, asyncpg, os
  from dotenv import load_dotenv
  load_dotenv('../.env')
  import sys; sys.path.insert(0, '.')
  from app import plaud
  async def main():
      conn = await asyncpg.connect(os.environ['DATABASE_URL'])
      row = await conn.fetchrow('SELECT payload_bruto FROM plaud_gravacoes ORDER BY id DESC LIMIT 1')
      transcricao = plaud._extrair_campo(row['payload_bruto'], 'transcript', 'transcription', 'text', '<CAMPO REAL AQUI>')
      resumo = plaud._extrair_campo(row['payload_bruto'], 'summary', 'ai_summary', '<CAMPO REAL AQUI>')
      print('transcrição:', transcricao)
      print('resumo:', resumo)
      await conn.close()
  asyncio.run(main())
  "
  ```
- Depois de confirmar que os nomes certos funcionam, editar `_extrair_campo(payload, "summary", "ai_summary")` e `_extrair_campo(payload, "transcript", "transcription", "text")` em `processar_webhook` (dentro de `backend/app/plaud.py`) incluindo os nomes reais, redeployar o backend (`git push && ssh ... docker compose up -d --build backend`), e rodar um `UPDATE` direto pra corrigir a linha de teste já recebida com os valores certos (não precisa reenviar o webhook).

- [ ] **Step 5: Testar o vínculo de ponta a ponta**

1. Criar uma sessão de teste (paciente/telefone de teste, cancelável depois).
2. Abrir a sessão, clicar "Vincular gravação Plaud", escolher a gravação de teste.
3. Confirmar que as observações da sessão ganharam o bloco "— Resumo automático (Plaud) —" com o resumo certo.
4. Confirmar que "Ver transcrição completa (Plaud)" mostra o texto certo.
5. Cancelar a sessão de teste (não deletar) e apagar a gravação de teste do banco
   (`DELETE FROM plaud_gravacoes WHERE id = ...`), deixando o sistema limpo.
