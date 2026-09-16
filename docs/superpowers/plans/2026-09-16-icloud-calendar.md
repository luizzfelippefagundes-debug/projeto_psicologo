# Integração de leitura com Calendário Apple (iCloud/CalDAV) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ler o Calendário nativo da Apple (iCloud, via CalDAV) e trazer os compromissos de lá como
horário ocupado (`bloqueios_horario`) no sistema — pra eventos criados por Siri ou no app nativo do
iPhone aparecerem na agenda sem a profissional precisar reconfigurar nada no aparelho.

**Architecture:** Novo módulo `backend/app/icloud_calendar.py`, espelhando a organização de
`backend/app/google_calendar.py` (conexão por profissional, loop de sincronização registrado no
`lifespan`). Diferente do Google (API REST + sync incremental via `syncToken`), o CalDAV é acessado
via a biblioteca síncrona `caldav` (chamadas isoladas em `asyncio.to_thread` pra não travar o event
loop) — **simplificação deliberada**: em vez de sincronização incremental (que depende de um
comportamento do servidor iCloud não totalmente confirmado — como eventos excluídos aparecem num
sync-collection), cada ciclo busca a janela inteira de 90 dias e reconcilia com o banco por
comparação direta (insere/atualiza o que veio, apaga o que não veio mais) — mesmo efeito prático,
código bem mais simples e sem depender de um detalhe incerto do protocolo. Só leitura nessa fase.

**Tech Stack:** FastAPI + asyncpg no backend; biblioteca `caldav` (PyPI, `3.3.1` confirmada via
inspeção real da API instalada — não memória desatualizada) pro protocolo CalDAV; Next.js no frontend.

---

### Task 1: Migração de banco

**Files:**
- Create: `backend/scripts/adicionar_icloud_calendar.py`
- Modify: `schema.sql`

- [ ] **Step 1: Escrever o script de migração**

```python
"""Adiciona suporte à integração de leitura com o Calendário Apple (iCloud/CalDAV):
tabela de conexão por profissional e a coluna em bloqueios_horario que identifica
eventos vindos de lá (mesmo padrão já usado pro Google Calendar, que usa
google_event_id).

Rodar uma única vez direto contra o banco de produção:
    cd backend && .venv/bin/python3 scripts/adicionar_icloud_calendar.py
"""
import asyncio
import os

import asyncpg
from dotenv import load_dotenv

load_dotenv("../.env")


async def main():
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])

    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS icloud_conexoes (
            profissional_id INTEGER PRIMARY KEY REFERENCES profissionais(id) ON DELETE CASCADE,
            apple_id VARCHAR(255) NOT NULL,
            senha_app TEXT NOT NULL,
            calendar_url TEXT,
            sync_token TEXT,
            conectado_em TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    await conn.execute(
        "ALTER TABLE bloqueios_horario ADD COLUMN IF NOT EXISTS icloud_event_uid VARCHAR(255)"
    )
    await conn.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'bloqueios_horario_icloud_uid_unique'
            ) THEN
                ALTER TABLE bloqueios_horario
                ADD CONSTRAINT bloqueios_horario_icloud_uid_unique UNIQUE (profissional_id, icloud_event_uid);
            END IF;
        END $$;
        """
    )

    print("Migração concluída.")
    await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 2: Verificar sintaxe (sem conectar em nada)**

Run: `cd backend && .venv/bin/python3 -c "import ast; ast.parse(open('scripts/adicionar_icloud_calendar.py').read())"`
Expected: nenhuma saída.

**NÃO rodar este script contra o banco — isso é feito pelo orquestrador depois que a task for revisada.**

- [ ] **Step 3: Atualizar `schema.sql`**

Troca, no `CREATE TABLE bloqueios_horario` (procure esse bloco em `schema.sql`):

```sql
CREATE TABLE bloqueios_horario (
    id SERIAL PRIMARY KEY,
    profissional_id INTEGER NOT NULL REFERENCES profissionais(id) ON DELETE CASCADE,
    local_id INTEGER REFERENCES locais(id) ON DELETE CASCADE, -- nulo = compromisso pessoal, sem local de atendimento
    data_inicio TIMESTAMPTZ NOT NULL,
    data_fim TIMESTAMPTZ NOT NULL,
    motivo VARCHAR(255),
    google_event_id VARCHAR(255), -- id do evento de origem no Google Calendar (quando veio de lá)
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (profissional_id, google_event_id)
);
```

por:

```sql
CREATE TABLE bloqueios_horario (
    id SERIAL PRIMARY KEY,
    profissional_id INTEGER NOT NULL REFERENCES profissionais(id) ON DELETE CASCADE,
    local_id INTEGER REFERENCES locais(id) ON DELETE CASCADE, -- nulo = compromisso pessoal, sem local de atendimento
    data_inicio TIMESTAMPTZ NOT NULL,
    data_fim TIMESTAMPTZ NOT NULL,
    motivo VARCHAR(255),
    google_event_id VARCHAR(255), -- id do evento de origem no Google Calendar (quando veio de lá)
    icloud_event_uid VARCHAR(255), -- uid do evento de origem no Calendário iCloud (quando veio de lá)
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (profissional_id, google_event_id),
    UNIQUE (profissional_id, icloud_event_uid)
);
```

E adiciona, logo depois desse bloco, a tabela nova:

```sql
CREATE TABLE icloud_conexoes (
    profissional_id INTEGER PRIMARY KEY REFERENCES profissionais(id) ON DELETE CASCADE,
    apple_id VARCHAR(255) NOT NULL,
    senha_app TEXT NOT NULL, -- "senha de app" gerada em appleid.apple.com, nunca a senha normal da conta
    calendar_url TEXT, -- URL do calendário principal, descoberta e cacheada na primeira conexão
    sync_token TEXT, -- reservado pra sincronização incremental futura; não usado nessa fase
    conectado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- [ ] **Step 4: Commit**

```bash
git add backend/scripts/adicionar_icloud_calendar.py schema.sql
git commit -m "Adiciona tabelas pra integração de leitura com Calendário iCloud"
```

---

### Task 2: Módulo `backend/app/icloud_calendar.py`

**Files:**
- Modify: `backend/requirements.txt`
- Create: `backend/app/icloud_calendar.py`

- [ ] **Step 1: Adicionar a dependência**

Em `backend/requirements.txt`, adiciona uma linha no final:

```
caldav
```

- [ ] **Step 2: Instalar localmente pra poder verificar a sintaxe/import**

Run: `cd backend && .venv/bin/pip install caldav`
Expected: instala `caldav` e suas dependências (`icalendar`, `lxml`, etc.) sem erro.

- [ ] **Step 3: Escrever o módulo**

API confirmada contra a biblioteca `caldav` 3.3.1 real (instalada e inspecionada via Python, não
memória desatualizada): `caldav.DAVClient(url=, username=, password=)`, `client.principal()`,
`principal.calendars()`, `caldav.Calendar(client=, url=)` (reconstrução direta a partir de uma URL já
conhecida), `calendario.date_search(start=, end=)`, e `objeto.icalendar_component` (propriedade que
devolve o `VEVENT` já parseado pelo pacote `icalendar`, com `.get("uid")`, `.get("summary")`,
`.get("dtstart").dt`, `.get("dtend").dt`).

```python
"""backend/app/icloud_calendar.py
Sincronização de LEITURA com o Calendário da Apple (iCloud), via CalDAV — pra
compromissos criados por voz (Siri) ou no app nativo do iPhone aparecerem como
horário ocupado no sistema, sem a profissional precisar reconfigurar nada no
aparelho (diferente do Google Calendar, que exige trocar o calendário padrão do
iPhone — na prática isso se mostrou frágil, daí essa integração).

Só leitura nessa fase — não escreve de volta pro iCloud. Sem OAuth possível (a
Apple não oferece isso pra CalDAV de terceiro): autenticação é Apple ID + uma
"senha de app" gerada manualmente em appleid.apple.com.

CalDAV é um protocolo não-oficial pro iCloud (a Apple nunca declarou suporte
formal) — a biblioteca `caldav` é síncrona (bloqueante); todas as chamadas
rodam via asyncio.to_thread pra não travar o event loop do FastAPI.

Simplificação deliberada: em vez de sincronização incremental (via sync_token —
a coluna existe no banco pra uso futuro, mas não é usada aqui), cada ciclo busca
a janela inteira de 90 dias e reconcilia com o banco por comparação direta. Evita
depender de um detalhe do protocolo não totalmente confirmado (como o servidor
iCloud representa um evento excluído num relatório de sincronização) — mesmo
efeito prático de manter bloqueios_horario em dia, código bem mais simples."""
import asyncio
import logging
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import caldav

from app import db

logger = logging.getLogger(__name__)

BRASILIA = ZoneInfo("America/Sao_Paulo")
INTERVALO_SINCRONIZACAO = timedelta(minutes=1)
ICLOUD_URL = "https://caldav.icloud.com"


def _conectar_sincrono(apple_id: str, senha_app: str, calendar_url: str | None = None) -> caldav.Calendar:
    """Abre a conexão CalDAV e devolve o calendário principal. Bloqueante — só
    chamar de dentro de asyncio.to_thread. Se `calendar_url` for passado (já
    descoberto numa conexão anterior), reconstrói o objeto Calendar direto,
    sem precisar descobrir o principal de novo a cada sincronização."""
    client = caldav.DAVClient(url=ICLOUD_URL, username=apple_id, password=senha_app)
    if calendar_url:
        return caldav.Calendar(client=client, url=calendar_url)
    principal = client.principal()
    calendarios = principal.calendars()
    if not calendarios:
        raise ValueError("Nenhum calendário encontrado nessa conta iCloud.")
    return calendarios[0]


async def testar_conexao(apple_id: str, senha_app: str) -> str:
    """Testa as credenciais abrindo a conexão de verdade. Devolve a URL do
    calendário principal (pra cachear) se der certo; deixa a exceção propagar
    se falhar (credencial errada, conta sem calendário, etc.) — o chamador
    decide a mensagem de erro pro usuário."""
    calendario = await asyncio.to_thread(_conectar_sincrono, apple_id, senha_app)
    return str(calendario.url)


async def salvar_conexao(profissional_id: int, apple_id: str, senha_app: str, calendar_url: str) -> None:
    async with db.pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO icloud_conexoes (profissional_id, apple_id, senha_app, calendar_url)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (profissional_id) DO UPDATE SET
                apple_id = EXCLUDED.apple_id,
                senha_app = EXCLUDED.senha_app,
                calendar_url = EXCLUDED.calendar_url,
                sync_token = NULL
            """,
            profissional_id, apple_id, senha_app, calendar_url,
        )


async def obter_conexao(profissional_id: int):
    async with db.pool.acquire() as conn:
        return await conn.fetchrow(
            "SELECT * FROM icloud_conexoes WHERE profissional_id = $1", profissional_id
        )


async def desconectar(profissional_id: int) -> None:
    async with db.pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "DELETE FROM bloqueios_horario WHERE profissional_id = $1 AND icloud_event_uid IS NOT NULL",
                profissional_id,
            )
            await conn.execute(
                "DELETE FROM icloud_conexoes WHERE profissional_id = $1", profissional_id
            )


def _extrair_datas(componente) -> tuple[datetime, datetime] | None:
    """Extrai início/fim de um VEVENT do icalendar. Eventos de dia inteiro vêm
    como `date` (sem hora) em vez de `datetime` — nesse caso assume meia-noite a
    meia-noite no fuso de Brasília, mesmo tratamento já usado pro Google
    Calendar em backend/app/google_calendar.py."""
    dtstart = componente.get("dtstart")
    dtend = componente.get("dtend")
    if dtstart is None or dtend is None:
        return None
    inicio = dtstart.dt
    fim = dtend.dt
    if not isinstance(inicio, datetime):
        inicio = datetime(inicio.year, inicio.month, inicio.day, tzinfo=BRASILIA)
        fim = datetime(fim.year, fim.month, fim.day, tzinfo=BRASILIA)
    return inicio, fim


def _sincronizar_sincrono(apple_id: str, senha_app: str, calendar_url: str) -> list[dict]:
    """Busca a janela de 90 dias e devolve os eventos já convertidos pra tipos
    Python puros (nada de objetos da lib caldav saindo daqui) — o resto (gravar
    no banco) roda async, fora desta função. Bloqueante — só chamar de dentro
    de asyncio.to_thread."""
    calendario = _conectar_sincrono(apple_id, senha_app, calendar_url)
    agora = datetime.now(timezone.utc)
    objetos = calendario.date_search(start=agora, end=agora + timedelta(days=90))

    eventos = []
    for objeto in objetos:
        componente = objeto.icalendar_component
        datas = _extrair_datas(componente)
        if datas is None:
            continue
        inicio, fim = datas
        uid = componente.get("uid")
        if not uid:
            continue
        eventos.append({
            "uid": str(uid),
            "motivo": str(componente.get("summary", "Compromisso pessoal")),
            "inicio": inicio,
            "fim": fim,
        })
    return eventos


async def puxar_eventos_do_icloud(profissional_id: int) -> dict:
    conexao = await obter_conexao(profissional_id)
    if conexao is None:
        return {"erro": "Não conectado ao Calendário iCloud."}

    try:
        eventos = await asyncio.to_thread(
            _sincronizar_sincrono, conexao["apple_id"], conexao["senha_app"], conexao["calendar_url"],
        )
    except Exception:
        logger.exception("Falha ao sincronizar iCloud Calendar (profissional_id=%s)", profissional_id)
        return {"erro": "Não foi possível sincronizar agora — confira a senha de app."}

    uids_atuais = [evento["uid"] for evento in eventos]
    criados = atualizados = 0

    async with db.pool.acquire() as conn:
        for evento in eventos:
            existente = await conn.fetchval(
                "SELECT id FROM bloqueios_horario WHERE profissional_id = $1 AND icloud_event_uid = $2",
                profissional_id, evento["uid"],
            )
            if existente:
                await conn.execute(
                    "UPDATE bloqueios_horario SET data_inicio = $1, data_fim = $2, motivo = $3 WHERE id = $4",
                    evento["inicio"], evento["fim"], evento["motivo"], existente,
                )
                atualizados += 1
            else:
                await conn.execute(
                    """
                    INSERT INTO bloqueios_horario (profissional_id, data_inicio, data_fim, motivo, icloud_event_uid)
                    VALUES ($1, $2, $3, $4, $5)
                    """,
                    profissional_id, evento["inicio"], evento["fim"], evento["motivo"], evento["uid"],
                )
                criados += 1

        removidos = await conn.fetchval(
            """
            WITH apagados AS (
                DELETE FROM bloqueios_horario
                WHERE profissional_id = $1 AND icloud_event_uid IS NOT NULL
                  AND NOT (icloud_event_uid = ANY($2::text[]))
                RETURNING id
            )
            SELECT count(*) FROM apagados
            """,
            profissional_id, uids_atuais,
        )

    return {"criados": criados, "atualizados": atualizados, "removidos": removidos}


async def _sincronizar_todos_conectados() -> None:
    async with db.pool.acquire() as conn:
        profissionais_ids = await conn.fetchval("SELECT array_agg(profissional_id) FROM icloud_conexoes")
    for profissional_id in profissionais_ids or []:
        try:
            await puxar_eventos_do_icloud(profissional_id)
        except Exception:
            logger.exception(
                "Erro na sincronização automática do iCloud Calendar (profissional_id=%s)", profissional_id
            )


async def loop_sincronizacao() -> None:
    while True:
        try:
            await _sincronizar_todos_conectados()
        except Exception:
            logger.exception("Erro no loop de sincronização do iCloud Calendar")
        await asyncio.sleep(INTERVALO_SINCRONIZACAO.total_seconds())
```

- [ ] **Step 4: Verificar sintaxe e import**

Run:
```bash
cd backend && .venv/bin/python3 -c "import ast; ast.parse(open('app/icloud_calendar.py').read())"
cd backend && set -a && source ../.env 2>/dev/null; set +a && .venv/bin/python3 -c "from app import icloud_calendar; print(icloud_calendar.ICLOUD_URL)"
```
Expected: `import ast` sem erro; o segundo comando imprime `https://caldav.icloud.com` (confirma que o
módulo importa sem erro — não conecta em nada nesse momento, `DAVClient` só é criado dentro das
funções).

**NÃO chamar `testar_conexao` nem `puxar_eventos_do_icloud` de verdade nesta task — ainda não existe
credencial real (senha de app da Apple) pra testar contra. Essa verificação é feita pelo orquestrador
depois que a profissional fornecer a senha através do formulário em produção.**

- [ ] **Step 5: Commit**

```bash
git add backend/requirements.txt backend/app/icloud_calendar.py
git commit -m "Adiciona módulo de sincronização de leitura com Calendário iCloud"
```

---

### Task 3: Endpoints em `backend/app/main.py`

**Files:**
- Modify: `backend/app/main.py`

- [ ] **Step 1: Importar `icloud_calendar`**

Troca a linha de import dos módulos do app:

```python
from app import agendamento_publico, anamnese, auth, bot, db, evolution, google_calendar, ia, lembretes, notificacoes, plaud, reservas
```

por:

```python
from app import agendamento_publico, anamnese, auth, bot, db, evolution, google_calendar, ia, icloud_calendar, lembretes, notificacoes, plaud, reservas
```

- [ ] **Step 2: Registrar o loop de sincronização no `lifespan`**

Troca:

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.connect()
    tarefa_lembretes = asyncio.create_task(lembretes.loop_lembretes())
    tarefa_holds = asyncio.create_task(reservas.loop_expiracao_holds())
    tarefa_google_sync = asyncio.create_task(google_calendar.loop_sincronizacao())
    yield
    tarefa_lembretes.cancel()
    tarefa_holds.cancel()
    tarefa_google_sync.cancel()
    await db.disconnect()
```

por:

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.connect()
    tarefa_lembretes = asyncio.create_task(lembretes.loop_lembretes())
    tarefa_holds = asyncio.create_task(reservas.loop_expiracao_holds())
    tarefa_google_sync = asyncio.create_task(google_calendar.loop_sincronizacao())
    tarefa_icloud_sync = asyncio.create_task(icloud_calendar.loop_sincronizacao())
    yield
    tarefa_lembretes.cancel()
    tarefa_holds.cancel()
    tarefa_google_sync.cancel()
    tarefa_icloud_sync.cancel()
    await db.disconnect()
```

- [ ] **Step 3: Adicionar os endpoints**

Logo depois do endpoint `google_sincronizar` (que termina com
`return await google_calendar.puxar_eventos_do_google(profissional_id)`), adiciona:

```python
class IcloudConectarBody(BaseModel):
    apple_id: str
    senha_app: str


@app.post("/icloud/conectar")
async def icloud_conectar(
    body: IcloudConectarBody, profissional_id: int = Depends(auth.get_current_profissional_id)
):
    try:
        calendar_url = await icloud_calendar.testar_conexao(body.apple_id, body.senha_app)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Não foi possível conectar — confira o Apple ID e a senha de app.",
        )
    await icloud_calendar.salvar_conexao(profissional_id, body.apple_id, body.senha_app, calendar_url)
    return {"status": "conectado"}


@app.get("/icloud/status")
async def icloud_status(profissional_id: int = Depends(auth.get_current_profissional_id)):
    conexao = await icloud_calendar.obter_conexao(profissional_id)
    return {"conectado": conexao is not None}


@app.post("/icloud/sincronizar")
async def icloud_sincronizar(profissional_id: int = Depends(auth.get_current_profissional_id)):
    return await icloud_calendar.puxar_eventos_do_icloud(profissional_id)


@app.delete("/icloud/desconectar")
async def icloud_desconectar(profissional_id: int = Depends(auth.get_current_profissional_id)):
    await icloud_calendar.desconectar(profissional_id)
    return {"status": "desconectado"}
```

- [ ] **Step 4: Verificar sintaxe e import**

Run:
```bash
cd backend && .venv/bin/python3 -c "import ast; ast.parse(open('app/main.py').read())"
cd backend && set -a && source ../.env 2>/dev/null; set +a && .venv/bin/python3 -c "import app.main"
```
Expected: ambos sem erro.

**NÃO chamar esses endpoints de verdade nesta task (nem local, nem produção) — isso é feito pelo
orquestrador depois.**

- [ ] **Step 5: Commit**

```bash
git add backend/app/main.py
git commit -m "Adiciona endpoints de conexão/sincronização do Calendário iCloud"
```

---

### Task 4: Card em Configurações (frontend)

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Create: `frontend/src/components/IcloudCalendarConexao.tsx`
- Modify: `frontend/src/app/(app)/configuracoes/page.tsx`

- [ ] **Step 1: Adicionar `getIcloudStatus` em `api.ts`**

Logo depois da função `getGoogleStatus` (que tem o corpo
`return apiFetch<{ conectado: boolean }>("/google/status");`), adiciona:

```typescript
export function getIcloudStatus() {
  return apiFetch<{ conectado: boolean }>("/icloud/status");
}
```

- [ ] **Step 2: Criar `IcloudCalendarConexao.tsx`**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check } from "lucide-react";

const API_URL = "/api"; // passa pelo rewrite do Next.js — cookie de sessão nasce no domínio do site

export function IcloudCalendarConexao({ conectado }: { conectado: boolean }) {
  const router = useRouter();
  const [appleId, setAppleId] = useState("");
  const [senhaApp, setSenhaApp] = useState("");
  const [conectando, setConectando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sincronizando, setSincronizando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);

  async function conectar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro(null);
    setConectando(true);

    const res = await fetch(`${API_URL}/icloud/conectar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ apple_id: appleId, senha_app: senhaApp }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErro(data.detail ?? "Não foi possível conectar.");
      setConectando(false);
      return;
    }

    setConectando(false);
    router.refresh();
  }

  async function sincronizarAgora() {
    setSincronizando(true);
    setResultado(null);

    const res = await fetch(`${API_URL}/icloud/sincronizar`, {
      method: "POST",
      credentials: "include",
    });
    const data = await res.json();

    if (data.erro) {
      setResultado(data.erro);
    } else {
      setResultado(
        `Sincronizado: ${data.criados} novo(s), ${data.atualizados} atualizado(s), ${data.removidos} removido(s).`
      );
    }
    setSincronizando(false);
    router.refresh();
  }

  async function desconectar() {
    const confirmado = confirm(
      "Desconectar o Calendário iCloud? Os compromissos que já foram trazidos de lá somem da agenda — " +
        "não é possível desfazer."
    );
    if (!confirmado) return;
    await fetch(`${API_URL}/icloud/desconectar`, { method: "DELETE", credentials: "include" });
    router.refresh();
  }

  if (!conectado) {
    return (
      <form onSubmit={conectar} className="flex flex-col gap-3">
        <p className="text-[14px] text-muted">
          Conecte o Calendário da Apple (iCloud) pra trazer pra cá os compromissos que a Siri ou o app
          nativo do iPhone criam — sem precisar mudar nenhuma configuração no aparelho.
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col">
            <label htmlFor="apple-id" className="mb-1.5 text-sm font-semibold">
              Apple ID (e-mail)
            </label>
            <input
              id="apple-id"
              type="email"
              required
              value={appleId}
              onChange={(e) => setAppleId(e.target.value)}
              placeholder="nome@icloud.com"
              className="rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-3 py-2.5 text-[14.5px] outline-none focus:border-accent"
            />
          </div>
          <div className="flex flex-col">
            <label htmlFor="senha-app" className="mb-1.5 text-sm font-semibold">
              Senha de app
            </label>
            <input
              id="senha-app"
              type="password"
              required
              value={senhaApp}
              onChange={(e) => setSenhaApp(e.target.value)}
              placeholder="xxxx-xxxx-xxxx-xxxx"
              className="rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-3 py-2.5 text-[14.5px] outline-none focus:border-accent"
            />
          </div>
        </div>

        <ol className="list-decimal space-y-1 pl-4 text-[13px] text-muted">
          <li>
            Entra em <strong className="text-fg">appleid.apple.com</strong> e loga com o Apple ID dela.
          </li>
          <li>
            Na seção <strong className="text-fg">Iniciar Sessão e Segurança</strong>, procura{" "}
            <strong className="text-fg">Senhas específicas de app</strong> → Gerar senha de app.
          </li>
          <li>Cola essa senha (não a senha normal da conta) no campo acima.</li>
        </ol>

        {erro && <p className="text-[13px] font-semibold text-red-600">{erro}</p>}

        <button
          type="submit"
          disabled={conectando}
          className="w-fit rounded-xl bg-accent px-5 py-2.5 text-[14px] font-bold text-white transition-colors hover:bg-accent-dark disabled:opacity-60"
        >
          {conectando ? "Conectando..." : "Conectar"}
        </button>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3.5 py-1.5 text-[13.5px] font-bold text-accent-dark">
          <Check className="h-[15px] w-[15px]" strokeWidth={2.5} />
          Calendário iCloud conectado
        </span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={sincronizarAgora}
            disabled={sincronizando}
            className="rounded-xl border border-border bg-card px-4 py-2 text-[13.5px] font-semibold transition-colors hover:bg-accent-soft disabled:opacity-60"
          >
            {sincronizando ? "Sincronizando..." : "Sincronizar agora"}
          </button>
          <button
            type="button"
            onClick={desconectar}
            className="text-[13px] font-semibold text-red-600 hover:underline"
          >
            Desconectar
          </button>
        </div>
      </div>
      {resultado && <p className="text-[13px] text-muted">{resultado}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Adicionar o card em Configurações**

Em `frontend/src/app/(app)/configuracoes/page.tsx`, troca:

```tsx
import { ThemeToggle } from "@/components/ThemeToggle";
import { NovoLocalForm } from "@/components/NovoLocalForm";
import { LocaisList } from "@/components/LocaisList";
import { RegrasHorarioManager } from "@/components/RegrasHorarioManager";
import { GoogleCalendarConexao } from "@/components/GoogleCalendarConexao";
import { LinkAgendamentoCopiar } from "@/components/LinkAgendamentoCopiar";
import { PlaudConexao } from "@/components/PlaudConexao";
import { getGoogleStatus, getLocais, getMe, getRegrasHorario } from "@/lib/api";

export default async function ConfiguracoesPage() {
  const [locais, regras, googleStatus, profissional] = await Promise.all([
    getLocais(),
    getRegrasHorario(),
    getGoogleStatus(),
    getMe(),
  ]);
```

por:

```tsx
import { ThemeToggle } from "@/components/ThemeToggle";
import { NovoLocalForm } from "@/components/NovoLocalForm";
import { LocaisList } from "@/components/LocaisList";
import { RegrasHorarioManager } from "@/components/RegrasHorarioManager";
import { GoogleCalendarConexao } from "@/components/GoogleCalendarConexao";
import { IcloudCalendarConexao } from "@/components/IcloudCalendarConexao";
import { LinkAgendamentoCopiar } from "@/components/LinkAgendamentoCopiar";
import { PlaudConexao } from "@/components/PlaudConexao";
import { getGoogleStatus, getIcloudStatus, getLocais, getMe, getRegrasHorario } from "@/lib/api";

export default async function ConfiguracoesPage() {
  const [locais, regras, googleStatus, icloudStatus, profissional] = await Promise.all([
    getLocais(),
    getRegrasHorario(),
    getGoogleStatus(),
    getIcloudStatus(),
    getMe(),
  ]);
```

E troca:

```tsx
      <div className="mb-6 rounded-2xl border border-border bg-card p-6 shadow-[0_8px_24px_var(--color-shadow)]">
        <h2 className="mb-4 text-[16px] font-bold">Google Calendar</h2>
        <GoogleCalendarConexao conectado={googleStatus.conectado} />
      </div>
```

por:

```tsx
      <div className="mb-6 rounded-2xl border border-border bg-card p-6 shadow-[0_8px_24px_var(--color-shadow)]">
        <h2 className="mb-4 text-[16px] font-bold">Google Calendar</h2>
        <GoogleCalendarConexao conectado={googleStatus.conectado} />
      </div>

      <div className="mb-6 rounded-2xl border border-border bg-card p-6 shadow-[0_8px_24px_var(--color-shadow)]">
        <h2 className="mb-4 text-[16px] font-bold">Calendário Apple (iCloud)</h2>
        <IcloudCalendarConexao conectado={icloudStatus.conectado} />
      </div>
```

- [ ] **Step 4: Verificar tipos**

Run: `cd frontend && npx tsc --noEmit`
Expected: nenhuma saída.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/components/IcloudCalendarConexao.tsx "frontend/src/app/(app)/configuracoes/page.tsx"
git commit -m "Adiciona card de conexão com Calendário iCloud em Configurações"
```

---

## Depois de todas as tasks (orquestrador, não subagente)

1. Rodar `backend/scripts/adicionar_icloud_calendar.py` contra produção.
2. Deploy do backend e do frontend (mesmo processo de sempre).
3. **Bloqueado até a profissional gerar a senha de app** em appleid.apple.com e informar Apple ID +
   senha através do formulário em Configurações, em produção:
   - Conectar de verdade e conferir que `calendar_url` foi salva.
   - Clicar em "Sincronizar agora" e conferir que os compromissos reais dela (inclusive os criados
     pela Siri, já vistos com problema nesta sessão) aparecem em `bloqueios_horario` e na Agenda.
   - Se `_sincronizar_sincrono` falhar de um jeito inesperado (ex: a forma como a lib `caldav`
     representa datas/UIDs for diferente do assumido), ajustar `_extrair_datas`/`_sincronizar_sincrono`
     com base no que a conta real devolver — é o ponto do plano mais sujeito a precisar de ajuste,
     dado que CalDAV contra iCloud é um protocolo não-oficial (já sinalizado na spec).
   - Marcar/cancelar um compromisso de teste no iPhone dela e confirmar que o próximo ciclo de
     sincronização (até 1 min depois) atualiza/remove o bloqueio correspondente.
   - Testar "Desconectar" e confirmar que os bloqueios de origem iCloud somem.

## Self-Review

**Cobertura da spec:** tabela `icloud_conexoes` + coluna `icloud_event_uid` (Task 1) ✓; módulo de
sincronização (Task 2) ✓; loop registrado no lifespan (Task 3) ✓; card em Configurações com
formulário de Apple ID + senha de app, passo a passo, "Conectado", "Sincronizar agora", desconectar
(Task 4) ✓; só leitura, sem escrever de volta (nenhuma task implementa push) ✓.

**Desvio consciente da spec:** a spec original previa sincronização incremental via `sync_token`
como caminho principal, com fallback pra busca completa. Na prática, a forma exata como a biblioteca
`caldav` sinaliza eventos excluídos num sync-collection não está documentada com clareza, e só dá pra
confirmar testando contra a conta real (que ainda não temos). Em vez de implementar um caminho
incerto, esse plano usa sempre a busca completa de 90 dias + reconciliação por comparação (a própria
spec já previa essa possibilidade: "já assume que pode cair pro modo busca tudo de novo a cada
ciclo"). A coluna `sync_token` fica no banco pra uso futuro, mas não é escrita nessa implementação.
Isso é mais simples e mais robusto pra uma primeira versão — pode ser otimizado depois se o volume de
eventos justificar.
