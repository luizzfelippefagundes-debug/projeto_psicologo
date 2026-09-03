# Agendamento Web pro Paciente (login Clerk) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Página pública `/agendar/[slug]` onde o paciente cria conta (Clerk, com Google), vê horários livres de um profissional e marca/cancela consulta sozinho — um segundo caminho de agendamento em paralelo ao bot do WhatsApp, não uma substituição.

**Architecture:** Auth do paciente via Clerk (`@clerk/nextjs` no front, verificação de JWT via JWKS com PyJWT no back — biblioteca já usada no projeto, sem SDK novo pesado), completamente separada do login JWT+bcrypt da profissional. Lógica de disponibilidade de horário sai de `bot.py` pra um módulo compartilhado `agendamento.py`, usado tanto pelo bot quanto pelos endpoints públicos novos.

**Tech Stack:** FastAPI + asyncpg + PyJWT (backend), Next.js 16 App Router + `@clerk/nextjs` (frontend), Postgres/Neon.

---

## Antes de começar: verificação obrigatória

Duas peças desse plano dependem de API de terceiro (Clerk) que muda com frequência — **não confie em conhecimento memorizado pra elas**. As Tasks 6 e 9 começam explicitamente buscando a documentação oficial atual antes de escrever qualquer linha de código de integração. As demais tasks (schema, módulo compartilhado, endpoints, páginas que só consomem a própria API do projeto) usam padrões já validados neste mesmo projeto — só seguir o que já existe.

---

### Task 1: Migração de schema — `profissionais.slug` e `pacientes.clerk_user_id`

**Files:**
- Create: `backend/scripts/migrar_agendamento_publico.py` (script one-off, mesmo padrão de outras migrações manuais já feitas neste projeto — não existe migration runner, `schema.sql` é só documentação)
- Modify: `backend/schema.sql` (documentar as colunas novas)

- [ ] **Step 1: Escrever o script de migração**

```python
# backend/scripts/migrar_agendamento_publico.py
"""Rode uma vez: python3 scripts/migrar_agendamento_publico.py
Adiciona profissionais.slug e pacientes.clerk_user_id, com os índices únicos."""
import asyncio
import re
import sys
sys.path.insert(0, ".")

from app.config import settings
import asyncpg


def slugificar(nome: str) -> str:
    slug = nome.strip().lower()
    slug = re.sub(r"[àáâãäå]", "a", slug)
    slug = re.sub(r"[èéêë]", "e", slug)
    slug = re.sub(r"[ìíîï]", "i", slug)
    slug = re.sub(r"[òóôõö]", "o", slug)
    slug = re.sub(r"[ùúûü]", "u", slug)
    slug = re.sub(r"[ç]", "c", slug)
    slug = re.sub(r"[^a-z0-9]+", "-", slug).strip("-")
    return slug


async def main():
    conn = await asyncpg.connect(settings.database_url)

    await conn.execute("ALTER TABLE profissionais ADD COLUMN IF NOT EXISTS slug VARCHAR")
    await conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS profissionais_slug_uniq ON profissionais (slug) "
        "WHERE slug IS NOT NULL"
    )
    await conn.execute("ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS clerk_user_id VARCHAR")
    await conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS pacientes_profissional_clerk_uniq "
        "ON pacientes (profissional_id, clerk_user_id) WHERE clerk_user_id IS NOT NULL"
    )
    print("Colunas e índices criados.")

    # Backfill: gera slug pra quem ainda não tem
    profissionais = await conn.fetch("SELECT id, nome FROM profissionais WHERE slug IS NULL")
    for p in profissionais:
        base = slugificar(p["nome"])
        slug = base
        sufixo = 1
        while await conn.fetchval("SELECT 1 FROM profissionais WHERE slug = $1", slug):
            sufixo += 1
            slug = f"{base}-{sufixo}"
        await conn.execute("UPDATE profissionais SET slug = $1 WHERE id = $2", slug, p["id"])
        print(f"profissional {p['id']} ({p['nome']}) -> slug '{slug}'")

    await conn.close()


asyncio.run(main())
```

- [ ] **Step 2: Rodar o script contra o banco de produção (Neon)**

Run: `cd backend && .venv/bin/python3 scripts/migrar_agendamento_publico.py`
Expected: imprime "Colunas e índices criados." e uma linha por profissional existente com o slug gerado (ex: `profissional 1 (Luiz Felippe) -> slug 'luiz-felippe'` — confira o slug real da Jamilly no `nome` cadastrado dela).

- [ ] **Step 3: Confirmar direto no banco**

Run:
```bash
cd backend && .venv/bin/python3 -c "
import asyncio, asyncpg
from app.config import settings
async def main():
    conn = await asyncpg.connect(settings.database_url)
    print(await conn.fetch('SELECT id, nome, slug FROM profissionais'))
    await conn.close()
asyncio.run(main())
"
```
Expected: toda linha tem `slug` preenchido, sem duplicata.

- [ ] **Step 4: Documentar em schema.sql**

Adiciona no bloco de `CREATE TABLE profissionais` um comentário `-- slug VARCHAR UNIQUE (link público de agendamento, ver docs/superpowers/specs/2026-09-03-agendamento-paciente-web-design.md)` e o mesmo padrão em `pacientes` pra `clerk_user_id`. (schema.sql já está sabidamente defasado da realidade — só documentando, sem tentar sincronizar o arquivo inteiro.)

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/migrar_agendamento_publico.py backend/schema.sql
git commit -m "Adiciona profissionais.slug e pacientes.clerk_user_id (agendamento web do paciente)"
```

---

### Task 2: Módulo compartilhado `backend/app/agendamento.py`

**Files:**
- Create: `backend/app/agendamento.py`
- Modify: `backend/app/bot.py:74-144` (troca a implementação de `horarios_disponiveis` por um wrapper fino em cima do módulo novo)

- [ ] **Step 1: Criar o módulo com a disponibilidade e a criação de sessão compartilhadas**

```python
# backend/app/agendamento.py
"""Lógica de agendamento reaproveitada tanto pelo bot do WhatsApp (bot.py) quanto
pelos endpoints públicos de autoagendamento do paciente (agendamento_publico.py)."""
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import asyncpg

from app import anamnese, db

BRASILIA = ZoneInfo("America/Sao_Paulo")


def _dia_semana_banco(d: date) -> int:
    # Python: segunda=0..domingo=6 | Banco: domingo=0..sábado=6
    return (d.weekday() + 1) % 7


async def horarios_disponiveis(
    profissional_id: int, local_id: int, data: date, duracao_minutos: int = 50
) -> list[str]:
    async with db.pool.acquire() as conn:
        dia_semana = _dia_semana_banco(data)

        regras = await conn.fetch(
            """
            SELECT hora_inicio, hora_fim FROM regras_horario
            WHERE profissional_id = $1 AND local_id = $2 AND dia_semana = $3 AND ativo
            ORDER BY hora_inicio
            """,
            profissional_id, local_id, dia_semana,
        )
        if not regras:
            return []

        ocupados = await conn.fetch(
            """
            SELECT data_hora, duracao_minutos FROM sessoes
            WHERE profissional_id = $1 AND local_id = $2
              AND data_hora::date = $3 AND status <> 'cancelada'
            """,
            profissional_id, local_id, data,
        )
        janelas_ocupadas = [
            (row["data_hora"], row["data_hora"] + timedelta(minutes=row["duracao_minutos"]))
            for row in ocupados
        ]

        bloqueios = await conn.fetch(
            """
            SELECT data_inicio, data_fim FROM bloqueios_horario
            WHERE profissional_id = $1 AND (local_id IS NULL OR local_id = $2)
              AND data_inicio::date <= $3 AND data_fim::date >= $3
            """,
            profissional_id, local_id, data,
        )
        janelas_ocupadas += [(row["data_inicio"], row["data_fim"]) for row in bloqueios]

    livres: list[str] = []
    passo = timedelta(minutes=30)
    duracao = timedelta(minutes=duracao_minutos)
    agora = datetime.now(BRASILIA)

    for regra in regras:
        inicio = datetime.combine(data, regra["hora_inicio"], tzinfo=BRASILIA)
        fim_janela = datetime.combine(data, regra["hora_fim"], tzinfo=BRASILIA)
        candidato = inicio
        while candidato + duracao <= fim_janela:
            candidato_fim = candidato + duracao
            conflito = candidato < agora or any(
                candidato < oc_fim and candidato_fim > oc_inicio
                for oc_inicio, oc_fim in janelas_ocupadas
            )
            if not conflito:
                livres.append(candidato.strftime("%H:%M"))
            candidato += passo

    return livres


async def criar_sessao_e_notificar(
    conn,
    *,
    profissional_id: int,
    paciente: asyncpg.Record,
    local: asyncpg.Record,
    data_hora: datetime,
    duracao_minutos: int,
    modalidade: str,
    whatsapp_instance: str | None,
) -> asyncpg.Record:
    """Insere a sessão e dispara o envio de anamnese (se o procedimento exigir).
    `paciente` precisa ter pelo menos: id, nome, email, tipo_procedimento, data_nascimento.
    `local` precisa ter pelo menos: id, nome. Levanta ExclusionViolationError se o
    horário já estiver ocupado (quem chama decide como tratar)."""
    sessao = await conn.fetchrow(
        """
        INSERT INTO sessoes (profissional_id, paciente_id, local_id, data_hora, duracao_minutos, modalidade)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, data_hora, duracao_minutos, modalidade, status
        """,
        profissional_id, paciente["id"], local["id"], data_hora, duracao_minutos, modalidade,
    )

    await anamnese.enviar_anamnese(
        paciente_id=paciente["id"],
        paciente_email=paciente["email"],
        paciente_telefone=paciente["telefone"],
        paciente_nome=paciente["nome"],
        tipo_procedimento=paciente["tipo_procedimento"],
        data_nascimento=paciente["data_nascimento"],
        whatsapp_instance=whatsapp_instance,
    )

    return sessao
```

- [ ] **Step 2: Verificar sintaxe**

Run: `cd backend && .venv/bin/python3 -c "import ast; ast.parse(open('app/agendamento.py').read()); print('OK')"`
Expected: `OK`

- [ ] **Step 3: Trocar `horarios_disponiveis` em `bot.py` por um wrapper fino**

Em `backend/app/bot.py`, a função `horarios_disponiveis` (linhas 74-144 antes dessa mudança) resolve `local_nome` → `local_id` e delega pro módulo novo:

```python
async def horarios_disponiveis(
    profissional_id: int, local_nome: str, data_str: str, duracao_minutos: int = 50
) -> list[str]:
    async with db.pool.acquire() as conn:
        local = await _buscar_local(conn, profissional_id, local_nome)
    return await agendamento.horarios_disponiveis(
        profissional_id, local["id"], date.fromisoformat(data_str), duracao_minutos
    )
```

Isso substitui o corpo inteiro da função antiga (que tinha a query de regras/ocupados/bloqueios direto). Adiciona o import no topo do arquivo:

```python
from app import agendamento, anamnese, db, notificacoes, reservas
```//substitui a linha `from app import anamnese, db, notificacoes, reservas` já existente

- [ ] **Step 4: Verificar sintaxe de bot.py**

Run: `cd backend && .venv/bin/python3 -c "import ast; ast.parse(open('app/bot.py').read()); print('OK')"`
Expected: `OK`

- [ ] **Step 5: Testar que o bot ainda oferece horário certo (regressão)**

Run:
```bash
cd backend && .venv/bin/python3 -c "
import asyncio, sys
sys.path.insert(0, '.')
from app import db, bot
async def main():
    await db.connect()
    livres = await bot.horarios_disponiveis(1, 'Consultório Centro', '2026-09-08', 50)
    print(livres)
    await db.pool.close()
asyncio.run(main())
"
```
Expected: mesma lista de horários livres de antes da mudança (excluindo os bloqueios de 08:00-09:20 do dia 08/09, já confirmado hoje mais cedo nesta sessão).

- [ ] **Step 6: Commit**

```bash
git add backend/app/agendamento.py backend/app/bot.py
git commit -m "Extrai disponibilidade de horário e criação de sessão pra módulo compartilhado agendamento.py"
```

---

### Task 3: Verificação de JWT do Clerk no backend (`clerk_auth.py`)

**Files:**
- Create: `backend/app/clerk_auth.py`
- Modify: `backend/app/config.py`
- Modify: `backend/requirements.txt` (nenhuma dependência nova — `pyjwt` e `httpx` já estão)

Verificação de JWT via JWKS é um padrão de mercado estável (RFC 7517/7519), não uma API específica do Clerk que muda — não precisa de doc-check aqui, só confirmar a URL do domínio Clerk do projeto quando a conta for criada (Task 6).

- [ ] **Step 1: Adicionar configuração**

Em `backend/app/config.py`, adiciona dentro da classe `Settings`:

```python
    clerk_issuer: str | None = None  # ex: https://exemplo-123.clerk.accounts.dev
```

- [ ] **Step 2: Escrever o verificador de token**

```python
# backend/app/clerk_auth.py
import logging

import jwt
from fastapi import Header, HTTPException, status

from app.config import settings

logger = logging.getLogger(__name__)

_jwks_client: jwt.PyJWKClient | None = None


def _get_jwks_client() -> jwt.PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        _jwks_client = jwt.PyJWKClient(f"{settings.clerk_issuer}/.well-known/jwks.json")
    return _jwks_client


async def get_current_clerk_user_id(authorization: str | None = Header(default=None)) -> str:
    """Dependency do FastAPI: exige um Bearer token do Clerk válido, devolve o
    user_id (claim 'sub'). Levanta 401 se faltar, for inválido ou expirado."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Não autenticado")

    token = authorization.removeprefix("Bearer ")
    try:
        signing_key = _get_jwks_client().get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token, signing_key.key, algorithms=["RS256"], issuer=settings.clerk_issuer,
            options={"verify_aud": False},
        )
    except jwt.PyJWTError:
        logger.exception("Token do Clerk inválido")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sessão inválida")

    return payload["sub"]
```

- [ ] **Step 3: Verificar sintaxe**

Run: `cd backend && .venv/bin/python3 -c "import ast; ast.parse(open('app/clerk_auth.py').read()); ast.parse(open('app/config.py').read()); print('OK')"`
Expected: `OK`

- [ ] **Step 4: Adicionar `CLERK_ISSUER` no `.env` (raiz do repo) e no ambiente de produção**

Isso só é possível depois da Task 6 (criar a conta Clerk e saber o domínio real). Deixa uma nota aqui e volta depois de criar a conta: adiciona `CLERK_ISSUER=https://<seu-dominio>.clerk.accounts.dev` no `.env` local e a mesma variável nas envs do backend em produção (arquivo `.env` usado pelo `docker-compose.yml` na VPS).

- [ ] **Step 5: Commit**

```bash
git add backend/app/clerk_auth.py backend/app/config.py
git commit -m "Adiciona verificação de JWT do Clerk (JWKS) pro backend"
```

---

### Task 4: Router público `backend/app/agendamento_publico.py`

**Files:**
- Create: `backend/app/agendamento_publico.py`
- Modify: `backend/app/main.py` (registra o router)

- [ ] **Step 1: Escrever o router**

```python
# backend/app/agendamento_publico.py
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app import agendamento, db
from app.clerk_auth import get_current_clerk_user_id

router = APIRouter(prefix="/publico", tags=["agendamento-publico"])


async def _buscar_profissional_por_slug(conn, slug: str):
    profissional = await conn.fetchrow(
        "SELECT id, nome FROM profissionais WHERE slug = $1", slug
    )
    if profissional is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Link inválido")
    return profissional


@router.get("/profissional/{slug}")
async def obter_profissional_publico(slug: str):
    async with db.pool.acquire() as conn:
        profissional = await _buscar_profissional_por_slug(conn, slug)
        locais = await conn.fetch(
            "SELECT id, nome FROM locais WHERE profissional_id = $1 ORDER BY nome", profissional["id"]
        )
    return {"nome": profissional["nome"], "locais": [dict(l) for l in locais]}


@router.get("/horarios")
async def horarios_publico(
    slug: str, local_id: int, data: date, duracao_minutos: int = 50,
):
    async with db.pool.acquire() as conn:
        profissional = await _buscar_profissional_por_slug(conn, slug)
        local = await conn.fetchval(
            "SELECT id FROM locais WHERE id = $1 AND profissional_id = $2", local_id, profissional["id"]
        )
        if local is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Local não encontrado")
    livres = await agendamento.horarios_disponiveis(profissional["id"], local_id, data, duracao_minutos)
    return {"horarios": livres}


class AgendarBody(BaseModel):
    slug: str
    local_id: int
    data_hora: datetime
    duracao_minutos: int = 50
    modalidade: str = "presencial"
    # só obrigatório na primeira consulta desse paciente com esse profissional
    nome: str | None = None
    telefone: str | None = None
    email: str | None = None
    data_nascimento: date | None = None
    consentimento_lgpd: bool = False
    procedimento_estimulacao: bool = False


@router.post("/agendar", status_code=status.HTTP_201_CREATED)
async def agendar_publico(body: AgendarBody, clerk_user_id: str = Depends(get_current_clerk_user_id)):
    if body.modalidade not in ("presencial", "teleconsulta"):
        body.modalidade = "presencial"

    async with db.pool.acquire() as conn:
        profissional = await _buscar_profissional_por_slug(conn, body.slug)
        local = await conn.fetchrow(
            "SELECT id, nome FROM locais WHERE id = $1 AND profissional_id = $2",
            body.local_id, profissional["id"],
        )
        if local is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Local não encontrado")

        paciente = await conn.fetchrow(
            "SELECT id, nome, email, telefone, tipo_procedimento, data_nascimento FROM pacientes "
            "WHERE profissional_id = $1 AND clerk_user_id = $2",
            profissional["id"], clerk_user_id,
        )
        if paciente is None:
            if not body.nome or not body.telefone or not body.consentimento_lgpd:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Primeira consulta: informe nome, telefone e consentimento LGPD.",
                )
            tipo_procedimento = "neuromodulacao" if body.procedimento_estimulacao else None
            paciente = await conn.fetchrow(
                """
                INSERT INTO pacientes (
                    profissional_id, nome, telefone, email, data_nascimento, tipo_procedimento,
                    tipo_atendimento, consentimento_lgpd, consentimento_lgpd_data, clerk_user_id
                )
                VALUES ($1, $2, $3, $4, $5, $6, 'individual', true, now(), $7)
                RETURNING id, nome, email, telefone, tipo_procedimento, data_nascimento
                """,
                profissional["id"], body.nome, body.telefone, body.email, body.data_nascimento,
                tipo_procedimento, clerk_user_id,
            )

        whatsapp_instance = await conn.fetchval(
            "SELECT whatsapp_instance FROM profissionais WHERE id = $1", profissional["id"]
        )

        try:
            sessao = await agendamento.criar_sessao_e_notificar(
                conn,
                profissional_id=profissional["id"],
                paciente=paciente,
                local=local,
                data_hora=body.data_hora,
                duracao_minutos=body.duracao_minutos,
                modalidade=body.modalidade,
                whatsapp_instance=whatsapp_instance,
            )
        except Exception as e:
            if "exclusion" in str(type(e)).lower():
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Esse horário acabou de ser ocupado. Escolha outro.",
                )
            raise

    return {"sessao_id": sessao["id"], "data_hora": sessao["data_hora"].isoformat()}


@router.get("/minhas-sessoes")
async def minhas_sessoes(slug: str, clerk_user_id: str = Depends(get_current_clerk_user_id)):
    async with db.pool.acquire() as conn:
        profissional = await _buscar_profissional_por_slug(conn, slug)
        sessoes = await conn.fetch(
            """
            SELECT s.id, s.data_hora, s.duracao_minutos, s.modalidade, s.status, l.nome AS local_nome
            FROM sessoes s
            JOIN pacientes p ON p.id = s.paciente_id
            JOIN locais l ON l.id = s.local_id
            WHERE s.profissional_id = $1 AND p.clerk_user_id = $2
            ORDER BY s.data_hora DESC
            """,
            profissional["id"], clerk_user_id,
        )
    return [dict(s) for s in sessoes]


@router.patch("/sessoes/{sessao_id}/cancelar")
async def cancelar_sessao_publico(
    sessao_id: int, slug: str, clerk_user_id: str = Depends(get_current_clerk_user_id)
):
    async with db.pool.acquire() as conn:
        profissional = await _buscar_profissional_por_slug(conn, slug)
        resultado = await conn.execute(
            """
            UPDATE sessoes SET status = 'cancelada'
            WHERE id = $1 AND profissional_id = $2
              AND paciente_id = (SELECT id FROM pacientes WHERE clerk_user_id = $3 AND profissional_id = $2)
            """,
            sessao_id, profissional["id"], clerk_user_id,
        )
    if resultado == "UPDATE 0":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sessão não encontrada")
    return {"status": "cancelada"}
```

- [ ] **Step 2: Verificar sintaxe**

Run: `cd backend && .venv/bin/python3 -c "import ast; ast.parse(open('app/agendamento_publico.py').read()); print('OK')"`
Expected: `OK`

- [ ] **Step 3: Registrar o router em `main.py`**

Em `backend/app/main.py`, junto dos outros imports de `app`:

```python
from app import agendamento_publico
```

E logo depois de `app = FastAPI(...)` (antes do `add_middleware` do CORS, não importa muito a ordem exata, mas depois da criação do `app`):

```python
app.include_router(agendamento_publico.router)
```

- [ ] **Step 4: Verificar sintaxe de main.py**

Run: `cd backend && .venv/bin/python3 -c "import ast; ast.parse(open('app/main.py').read()); print('OK')"`
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add backend/app/agendamento_publico.py backend/app/main.py
git commit -m "Adiciona endpoints públicos de agendamento (autenticados via Clerk)"
```

---

### Task 5: Deploy do backend e teste manual dos endpoints (sem frontend ainda)

**Files:** nenhum (só deploy e verificação)

- [ ] **Step 1: Push e deploy**

```bash
git push origin main
ssh root@179.199.133.37 "cd /opt/app && git pull && docker compose up -d --build backend"
```

- [ ] **Step 2: Health check**

Run: `curl -s https://api.nexosystem.online/health`
Expected: `{"status":"ok"}`

- [ ] **Step 3: Testar `/publico/profissional/{slug}` (rota pública, sem token)**

Run: `curl -s https://api.nexosystem.online/publico/profissional/<slug-real-da-jamilly>`
Expected: JSON com `nome` e `locais` — confirma que o slug gerado na Task 1 está funcionando end-to-end.

- [ ] **Step 4: Testar que `/publico/agendar` exige token (deve dar 401 sem Authorization)**

Run: `curl -s -o /dev/null -w "%{http_code}\n" -X POST https://api.nexosystem.online/publico/agendar -H "Content-Type: application/json" -d '{}'`
Expected: `401`

(Teste completo com token real do Clerk só é possível depois da Task 6, quando existir uma conta de teste pra gerar um JWT válido.)

---

### Task 6: Configurar Clerk (conta, chaves, SDK no frontend)

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/src/app/layout.tsx`
- Create/Modify: `frontend/.env.local` (chaves locais, não commitado) e variáveis de ambiente na Vercel

- [ ] **Step 1: Buscar a documentação oficial atual do Clerk pra Next.js App Router**

Use o WebFetch (ou peça pro humano abrir) `https://clerk.com/docs/quickstarts/nextjs` — confirme: nome atual do pacote (`@clerk/nextjs`), nome do componente provider (`ClerkProvider`), variáveis de ambiente esperadas (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`), e se ainda é `clerkMiddleware` (de `@clerk/nextjs/server`) o jeito atual de integrar com o middleware do Next — a API já mudou de nome antes (`authMiddleware` → `clerkMiddleware`), então **não assuma, confirme na doc antes de escrever a Task 7**.

- [ ] **Step 2: Criar a conta/app no Clerk (ação manual do usuário, fora do código)**

Pede pro usuário criar a conta em https://clerk.com (ou usar uma existente, já que ele mencionou já ter usado no projeto da barbearia), criar uma aplicação nova pra esse projeto, e habilitar os provedores de login: Google + Email. Anota: `Publishable Key`, `Secret Key`, e o domínio Frontend API (algo tipo `https://exemplo-123.clerk.accounts.dev`) — esse último é o `CLERK_ISSUER` da Task 3.

- [ ] **Step 3: Instalar o pacote**

Run: `cd frontend && npm install @clerk/nextjs`

- [ ] **Step 4: Adicionar as chaves**

Em `frontend/.env.local` (não commitado — já está no `.gitignore` do projeto):
```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=<publishable key real>
CLERK_SECRET_KEY=<secret key real>
```

Adiciona as mesmas duas na Vercel (produção): `vercel env add NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY production` e `vercel env add CLERK_SECRET_KEY production`.

No backend, adiciona `CLERK_ISSUER=<domínio Frontend API>` no `.env` da raiz do repo e no ambiente de produção da VPS (arquivo usado pelo `docker-compose.yml`).

- [ ] **Step 5: Envolver o layout raiz com `ClerkProvider`**

`ClerkProvider` é o componente estável mais básico do Clerk (não muda como `clerkMiddleware` mudou de nome) — confirme só que o import continua `import { ClerkProvider } from "@clerk/nextjs"` na doc do Step 1, e aplica exatamente isso em `frontend/src/app/layout.tsx`, mantendo tudo que já está lá:

```tsx
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { PwaRegister } from "@/components/PwaRegister";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Consultório",
  description: "Painel de agendamento e gestão do consultório",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Consultório",
  },
  icons: {
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#a8768a",
};

const themeInitScript = `
(function () {
  var saved = localStorage.getItem('theme');
  var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  var isDark = saved ? saved === 'dark' : prefersDark;
  document.documentElement.classList.toggle('dark', isDark);
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="pt-BR" className={`${inter.variable} h-full`} suppressHydrationWarning>
        <head>
          <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        </head>
        <body className="min-h-full flex antialiased" suppressHydrationWarning>
          <PwaRegister />
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
```

- [ ] **Step 6: Verificar build**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: build limpo, sem erro de import do Clerk.

- [ ] **Step 7: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/app/layout.tsx
git commit -m "Adiciona Clerk (auth do paciente) ao projeto"
```

---

### Task 7: Middleware — liberar `/agendar` publicamente e integrar Clerk

**Files:**
- Modify: `frontend/src/proxy.ts`

- [ ] **Step 1: Confirmar na doc buscada na Task 6** se `clerkMiddleware` é compatível com o arquivo `proxy.ts` (convenção nova do Next 16, renomeado de `middleware.ts`) ou se ainda espera o nome antigo — Next 16 mudou isso recentemente, e o suporte do Clerk pro nome novo pode não estar em todas as versões da doc. Se a doc do Clerk só mostrar exemplos com `middleware.ts`, teste primeiro com o arquivo `proxy.ts` já existente (Next 16 já usa esse nome no projeto todo) antes de considerar renomear de volta.

- [ ] **Step 2: Integrar `clerkMiddleware` com a lógica de auth já existente**

O arquivo `frontend/src/proxy.ts` já tem uma função `proxy` que cuida do login da profissional (cookie `session`). Preciso que `/agendar/*` continue **sempre público** (não exige nem redireciona por causa do cookie de sessão da profissional — esse é outro sistema de auth), e que o Clerk consiga rodar seu próprio middleware especificamente nesse trecho, sem interferir no resto do app. Estrutura (ajustar a sintaxe exata conforme a doc confirmada no Step 1):

```typescript
import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/signup"];
const ALWAYS_PUBLIC_PATHS = ["/anamnese", "/agendar"];

function proxyDaProfissional(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (ALWAYS_PUBLIC_PATHS.some((path) => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  const isPublic = PUBLIC_PATHS.some((path) => pathname.startsWith(path));
  const hasSession = request.cookies.has("session");

  if (!hasSession && !isPublic) return NextResponse.redirect(new URL("/login", request.url));
  if (hasSession && isPublic) return NextResponse.redirect(new URL("/", request.url));
  return NextResponse.next();
}

export default clerkMiddleware((auth, request) => {
  return proxyDaProfissional(request);
});

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icon-.*\\.png|apple-touch-icon.png).*)",
  ],
};
```

Isso preserva a matcher config já existente (excluindo os arquivos estáticos do PWA que já corrigimos hoje) e mantém `/agendar` sempre público, igual `/anamnese`.

- [ ] **Step 3: Verificar build**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: build limpo.

- [ ] **Step 4: Testar que as rotas administrativas continuam pedindo login**

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/pacientes` (com o dev server rodando)
Expected: `307` (redirect pro login, comportamento de antes preservado).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/proxy.ts
git commit -m "Integra Clerk middleware liberando /agendar publicamente"
```

---

### Task 8: Cliente de API público (frontend)

**Files:**
- Create: `frontend/src/lib/apiPublico.ts`

- [ ] **Step 1: Escrever as funções de fetch client-side**

```typescript
// frontend/src/lib/apiPublico.ts
const API_URL = "/api"; // passa pelo rewrite do Next.js

export type ProfissionalPublico = {
  nome: string;
  locais: { id: number; nome: string }[];
};

export type SessaoPublica = {
  id: number;
  data_hora: string;
  duracao_minutos: number;
  modalidade: "presencial" | "teleconsulta";
  status: string;
  local_nome: string;
};

async function fetchPublico<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail ?? "Algo deu errado.");
  }
  return res.json();
}

export async function getProfissionalPublico(slug: string): Promise<ProfissionalPublico> {
  const res = await fetch(`${API_URL}/publico/profissional/${slug}`);
  if (!res.ok) throw new Error("Link inválido.");
  return res.json();
}

export function getHorariosPublico(
  slug: string, localId: number, data: string, token: string
): Promise<{ horarios: string[] }> {
  return fetchPublico(`/publico/horarios?slug=${slug}&local_id=${localId}&data=${data}`, token);
}

export function agendarPublico(
  token: string,
  body: {
    slug: string;
    local_id: number;
    data_hora: string;
    duracao_minutos?: number;
    modalidade?: string;
    nome?: string;
    telefone?: string;
    email?: string;
    data_nascimento?: string;
    consentimento_lgpd?: boolean;
    procedimento_estimulacao?: boolean;
  }
) {
  return fetchPublico<{ sessao_id: number; data_hora: string }>("/publico/agendar", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function getMinhasSessoes(slug: string, token: string): Promise<SessaoPublica[]> {
  return fetchPublico(`/publico/minhas-sessoes?slug=${slug}`, token);
}

export function cancelarSessaoPublica(sessaoId: number, slug: string, token: string) {
  return fetchPublico(`/publico/sessoes/${sessaoId}/cancelar?slug=${slug}`, token, {
    method: "PATCH",
  });
}
```

- [ ] **Step 2: Verificar sintaxe**

Run: `cd frontend && npx tsc --noEmit`
Expected: sem erro.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/apiPublico.ts
git commit -m "Adiciona cliente de API pros endpoints públicos de agendamento"
```

---

### Task 9: Página de agendamento `/agendar/[slug]`

**Files:**
- Create: `frontend/src/app/agendar/[slug]/page.tsx`
- Create: `frontend/src/components/AgendamentoPublicoFluxo.tsx`

Antes de escrever, confirme na doc do Clerk (buscada na Task 6) o nome atual dos componentes/hooks client-side que serão usados aqui: componente de login embutido (algo como `<SignIn />`), estado "logado"/"deslogado" (`<SignedIn>`/`<SignedOut>`), hook pra pegar o token JWT no client (`useAuth()` → `getToken()`), e hook do usuário atual (`useUser()`, pra pegar nome/email já preenchidos do Google). Os nomes abaixo são os documentados até o treinamento deste agente — **confirme antes de implementar**.

- [ ] **Step 1: Server Component da rota (busca dados públicos, sem exigir login)**

```tsx
// frontend/src/app/agendar/[slug]/page.tsx
import { getProfissionalPublico } from "@/lib/apiPublico";
import { AgendamentoPublicoFluxo } from "@/components/AgendamentoPublicoFluxo";

export default async function AgendarPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let profissional;
  try {
    profissional = await getProfissionalPublico(slug);
  } catch {
    return (
      <div className="flex min-h-full flex-1 items-center justify-center p-6">
        <p className="text-[15px] text-muted">Link inválido ou não encontrado.</p>
      </div>
    );
  }

  return <AgendamentoPublicoFluxo slug={slug} profissional={profissional} />;
}
```

- [ ] **Step 2: Componente client com o fluxo de login + escolha de horário + confirmação**

Reaproveita o mesmo estilo visual da página de anamnese pública (`ESTILO_CLARO`, card centralizado — ver `frontend/src/app/anamnese/[token]/page.tsx` pro padrão exato de forçar tema claro). Estrutura:

```tsx
// frontend/src/components/AgendamentoPublicoFluxo.tsx
"use client";

import { SignedIn, SignedOut, SignIn, useAuth, useUser } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { agendarPublico, getHorariosPublico, type ProfissionalPublico } from "@/lib/apiPublico";
import { Select } from "@/components/Select";

export function AgendamentoPublicoFluxo({
  slug,
  profissional,
}: {
  slug: string;
  profissional: ProfissionalPublico;
}) {
  const { getToken } = useAuth();
  const { user } = useUser();

  const [localId, setLocalId] = useState(String(profissional.locais[0]?.id ?? ""));
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10));
  const [horarios, setHorarios] = useState<string[]>([]);
  const [horarioEscolhido, setHorarioEscolhido] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [dataNascimento, setDataNascimento] = useState("");
  const [lgpd, setLgpd] = useState(false);
  const [estimulacao, setEstimulacao] = useState<"sim" | "nao" | "">("");
  const [erro, setErro] = useState<string | null>(null);
  const [confirmado, setConfirmado] = useState(false);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    if (user?.fullName) setNome(user.fullName);
  }, [user]);

  useEffect(() => {
    if (!localId || !data) return;
    getToken().then((token) => {
      if (!token) return;
      getHorariosPublico(slug, Number(localId), data, token)
        .then((r) => setHorarios(r.horarios))
        .catch(() => setHorarios([]));
    });
  }, [slug, localId, data, getToken]);

  async function confirmar() {
    if (!horarioEscolhido) return;
    setErro(null);
    setCarregando(true);
    const token = await getToken();
    if (!token) return;
    try {
      await agendarPublico(token, {
        slug,
        local_id: Number(localId),
        data_hora: `${data}T${horarioEscolhido}:00-03:00`,
        nome: nome || undefined,
        telefone: telefone || undefined,
        data_nascimento: dataNascimento || undefined,
        consentimento_lgpd: lgpd,
        procedimento_estimulacao: estimulacao === "sim",
      });
      setConfirmado(true);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não deu pra agendar.");
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="flex min-h-full flex-1 justify-center p-6">
      <div className="w-full max-w-[480px]">
        <h1 className="mb-1 text-2xl font-extrabold">{profissional.nome}</h1>
        <p className="mb-6 text-[14.5px] text-muted">Agende sua consulta</p>

        <SignedOut>
          <SignIn routing="hash" />
        </SignedOut>

        <SignedIn>
          {confirmado ? (
            <p className="text-[15px] font-semibold text-accent-dark">
              Consulta agendada! Você pode ver em &quot;Minhas consultas&quot;.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              <Select
                value={localId}
                onChange={setLocalId}
                options={profissional.locais.map((l) => ({ value: String(l.id), label: l.nome }))}
              />
              <input
                type="date"
                value={data}
                onChange={(e) => setData(e.target.value)}
                className="rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-3 py-2.5 text-[14.5px] outline-none focus:border-accent"
              />
              <div className="flex flex-wrap gap-2">
                {horarios.map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => setHorarioEscolhido(h)}
                    className={`rounded-xl px-3.5 py-2 text-[13.5px] font-bold ${
                      horarioEscolhido === h ? "bg-accent text-white" : "border border-border bg-card"
                    }`}
                  >
                    {h}
                  </button>
                ))}
                {horarios.length === 0 && (
                  <p className="text-[13.5px] text-muted">Nenhum horário livre nesse dia.</p>
                )}
              </div>

              {horarioEscolhido && (
                <>
                  <input
                    type="text"
                    placeholder="Nome completo"
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    className="rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-3 py-2.5 text-[14.5px] outline-none focus:border-accent"
                  />
                  <input
                    type="tel"
                    placeholder="Telefone (WhatsApp)"
                    value={telefone}
                    onChange={(e) => setTelefone(e.target.value)}
                    className="rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-3 py-2.5 text-[14.5px] outline-none focus:border-accent"
                  />
                  <input
                    type="date"
                    placeholder="Data de nascimento"
                    value={dataNascimento}
                    onChange={(e) => setDataNascimento(e.target.value)}
                    className="rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-3 py-2.5 text-[14.5px] outline-none focus:border-accent"
                  />
                  <Select
                    value={estimulacao}
                    onChange={(v) => setEstimulacao(v as "sim" | "nao")}
                    placeholder="É consulta de estimulação/tDCS?"
                    options={[
                      { value: "nao", label: "Não, é consulta regular" },
                      { value: "sim", label: "Sim, é estimulação/tDCS" },
                    ]}
                  />
                  <label className="flex items-start gap-2.5 text-[13.5px]">
                    <input
                      type="checkbox"
                      checked={lgpd}
                      onChange={(e) => setLgpd(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                    />
                    <span>Concordo com o tratamento dos meus dados de saúde, conforme a LGPD.</span>
                  </label>

                  {erro && <p className="text-[13px] font-semibold text-red-600">{erro}</p>}

                  <button
                    type="button"
                    onClick={confirmar}
                    disabled={carregando || !nome || !telefone || !lgpd}
                    className="rounded-xl bg-accent px-5 py-2.5 text-[14.5px] font-bold text-white disabled:opacity-60"
                  >
                    {carregando ? "Agendando..." : "Confirmar consulta"}
                  </button>
                </>
              )}
            </div>
          )}
        </SignedIn>
      </div>
    </div>
  );
}
```

Nota: se o paciente já tiver cadastro (`clerk_user_id` já existe pra esse profissional), o backend ignora `nome`/`telefone`/`consentimento_lgpd` enviados e usa o cadastro existente — o formulário de dados pessoais podia ficar escondido nesse caso, mas fica simples deixar sempre visível por enquanto (YAGNI — não é o caminho mais comum, é mais fácil sempre mostrar do que buscar se já é paciente antes de decidir o que mostrar).

- [ ] **Step 2: Verificar sintaxe e build**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: build limpo.

- [ ] **Step 3: Commit**

```bash
git add "frontend/src/app/agendar/[slug]/page.tsx" frontend/src/components/AgendamentoPublicoFluxo.tsx
git commit -m "Adiciona página pública de agendamento com login Clerk"
```

---

### Task 10: Página "Minhas consultas"

**Files:**
- Create: `frontend/src/app/agendar/[slug]/minhas-sessoes/page.tsx`
- Create: `frontend/src/components/MinhasSessoesPublico.tsx`

- [ ] **Step 1: Server component da rota**

```tsx
// frontend/src/app/agendar/[slug]/minhas-sessoes/page.tsx
import { MinhasSessoesPublico } from "@/components/MinhasSessoesPublico";

export default async function MinhasSessoesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <MinhasSessoesPublico slug={slug} />;
}
```

- [ ] **Step 2: Componente client — lista e cancelamento**

```tsx
// frontend/src/components/MinhasSessoesPublico.tsx
"use client";

import { SignedIn, SignedOut, useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { cancelarSessaoPublica, getMinhasSessoes, type SessaoPublica } from "@/lib/apiPublico";

export function MinhasSessoesPublico({ slug }: { slug: string }) {
  const { getToken } = useAuth();
  const [sessoes, setSessoes] = useState<SessaoPublica[]>([]);
  const [carregado, setCarregado] = useState(false);

  async function recarregar() {
    const token = await getToken();
    if (!token) return;
    const dados = await getMinhasSessoes(slug, token);
    setSessoes(dados);
    setCarregado(true);
  }

  useEffect(() => {
    recarregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  async function cancelar(id: number) {
    const token = await getToken();
    if (!token) return;
    await cancelarSessaoPublica(id, slug, token);
    recarregar();
  }

  return (
    <div className="flex min-h-full flex-1 justify-center p-6">
      <div className="w-full max-w-[480px]">
        <h1 className="mb-6 text-2xl font-extrabold">Minhas consultas</h1>

        <SignedOut>
          <p className="text-[14.5px] text-muted">Faça login pra ver suas consultas.</p>
        </SignedOut>

        <SignedIn>
          {!carregado ? null : sessoes.length === 0 ? (
            <p className="text-[14.5px] text-muted">Nenhuma consulta ainda.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {sessoes.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3"
                >
                  <div>
                    <div className="text-[14px] font-bold">
                      {new Date(s.data_hora).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                    </div>
                    <div className="text-[12.5px] text-muted">
                      {s.local_nome} · {s.status}
                    </div>
                  </div>
                  {s.status === "confirmada" && (
                    <button
                      type="button"
                      onClick={() => cancelar(s.id)}
                      className="text-[13px] font-semibold text-red-600 hover:underline"
                    >
                      Cancelar
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </SignedIn>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verificar sintaxe e build**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: build limpo.

- [ ] **Step 4: Commit**

```bash
git add "frontend/src/app/agendar/[slug]/minhas-sessoes/page.tsx" frontend/src/components/MinhasSessoesPublico.tsx
git commit -m "Adiciona página de minhas consultas (autoagendamento)"
```

---

### Task 11: Link de agendamento em Configurações

**Files:**
- Modify: `frontend/src/app/(app)/configuracoes/page.tsx`
- Create: `frontend/src/components/LinkAgendamentoCopiar.tsx`
- Modify: `backend/app/main.py` (endpoint `/auth/me` já existe — confirmar se devolve `slug`; se não, adicionar)

- [ ] **Step 1: Confirmar/ajustar o endpoint `/auth/me` pra devolver o slug**

Em `backend/app/main.py`, localiza o endpoint `GET /auth/me` (usado por `getMe()` no frontend) e confirma que o `SELECT` inclui a coluna `slug`. Se não incluir, adiciona `slug` na query e no dict de retorno.

- [ ] **Step 2: Atualizar o tipo `Profissional` no frontend**

Em `frontend/src/lib/api.ts`:
```typescript
export type Profissional = {
  id: number;
  nome: string;
  email: string;
  slug: string;
};
```

- [ ] **Step 3: Componente de copiar link**

```tsx
// frontend/src/components/LinkAgendamentoCopiar.tsx
"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function LinkAgendamentoCopiar({ slug }: { slug: string }) {
  const [copiado, setCopiado] = useState(false);
  const link =
    typeof window !== "undefined" ? `${window.location.origin}/agendar/${slug}` : `/agendar/${slug}`;

  function copiar() {
    navigator.clipboard.writeText(link);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-accent-soft px-3 py-2.5">
      <span className="flex-1 truncate text-[13.5px] text-accent-dark">{link}</span>
      <button
        type="button"
        onClick={copiar}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-accent-dark hover:bg-accent/10"
        aria-label="Copiar link"
      >
        {copiado ? <Check className="h-4 w-4" strokeWidth={2.5} /> : <Copy className="h-4 w-4" strokeWidth={2} />}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Adicionar o card em Configurações**

Em `frontend/src/app/(app)/configuracoes/page.tsx`, dentro do `Promise.all` que já busca `locais`/`regras`/`googleStatus`, adiciona `getMe()` (já existe em `@/lib/api`), e insere um novo card na página, seguindo o mesmo padrão visual dos outros (`rounded-2xl border border-border bg-card p-6 ...`):

```tsx
<div className="mb-6 rounded-2xl border border-border bg-card p-6 shadow-[0_8px_24px_var(--color-shadow)]">
  <h2 className="mb-4 text-[16px] font-bold">Link de agendamento pro paciente</h2>
  <p className="mb-4 text-[14px] text-muted">
    Compartilhe esse link — o paciente cria conta e marca a própria consulta, mesmo se o bot do
    WhatsApp estiver fora do ar.
  </p>
  <LinkAgendamentoCopiar slug={profissional.slug} />
</div>
```

- [ ] **Step 5: Verificar sintaxe e build**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: build limpo.

- [ ] **Step 6: Commit**

```bash
git add backend/app/main.py frontend/src/lib/api.ts "frontend/src/app/(app)/configuracoes/page.tsx" frontend/src/components/LinkAgendamentoCopiar.tsx
git commit -m "Mostra link de agendamento do paciente na página de Configurações"
```

---

### Task 12: Deploy final e verificação manual ponta a ponta

**Files:** nenhum

- [ ] **Step 1: Deploy do backend (se algo mudou desde a Task 5) e do frontend**

```bash
git push origin main
ssh root@179.199.133.37 "cd /opt/app && git pull && docker compose up -d --build backend"
cd frontend && vercel --prod --yes
```

- [ ] **Step 2: Health checks**

Run: `curl -s https://api.nexosystem.online/health` → `{"status":"ok"}`
Run: `curl -s -o /dev/null -w "%{http_code}\n" https://frontend-theta-weld-74.vercel.app/agendar/<slug-real>` → `200`

- [ ] **Step 3: Fluxo manual completo no navegador**

1. Abrir `/agendar/<slug-real>`, fazer login de teste (conta Google pessoal, ou email de teste).
2. Escolher local + data, confirmar que aparecem horários livres batendo com o que a Agenda administrativa mostra pro mesmo dia.
3. Preencher dados de primeira consulta e confirmar o agendamento.
4. Checar na Agenda administrativa (`/agenda?data=<mesma-data>`) que a sessão apareceu certinho, com o paciente novo criado.
5. Ir em `/agendar/<slug-real>/minhas-sessoes`, confirmar que a consulta aparece na lista.
6. Cancelar pela tela pública, confirmar que sumiu da Agenda administrativa (mesmo comportamento de cancelamento já validado hoje).
7. Confirmar que o link de Configurações bate com a URL usada no teste.

- [ ] **Step 4: Limpar dados de teste**

Cancelar (não deletar — mesma convenção usada o resto da sessão) a sessão de teste se ainda não tiver cancelado no passo anterior, e deixar registrado que o paciente/conta de teste existe caso precise limpar depois.
