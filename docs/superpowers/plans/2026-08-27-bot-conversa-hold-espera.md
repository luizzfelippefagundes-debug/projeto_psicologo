# Bot: hold de horário, lista de espera e tom de conversa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bot do WhatsApp passa a saber segurar (hold) um horário até o paciente confirmar, oferecer lista de espera quando não há vaga boa, e conversar de forma mais gradual/aberta em vez de listar exigências de uma vez.

**Architecture:** Novo status `'reservado'` em `sessoes` (com `expira_em`) representa um hold — a constraint de exclusão que já impede sobreposição de horário protege ele de graça. Job de fundo (mesmo padrão do `loop_lembretes` já existente) expira holds vencidos e dispara checagem de lista de espera. Três tools novas no bot (`segurar_horario`, `confirmar_horario_reservado`, `entrar_lista_espera`) dão ao modelo os meios de agir nesse fluxo; o system prompt é reescrito pra guiar quando usar cada uma.

**Tech Stack:** FastAPI + asyncpg (Python 3.12), Anthropic Claude (`claude-haiku-4-5`), Postgres (Neon, sem migration runner — schema alterado por script avulso).

**Spec:** `docs/superpowers/specs/2026-08-27-bot-conversa-hold-espera-design.md`

---

## Contexto pro engenheiro

Este projeto é um SaaS de agendamento pra psicólogos com um bot de WhatsApp (`backend/app/bot.py`) que já sabe consultar horários livres e criar agendamento confirmado na hora, via function calling com Claude. Não há suite de testes automatizada nesse projeto — a verificação é sempre manual: `python3 -c "import ast; ast.parse(...)"` pra sintaxe, e simulação de conversa real (chamando `bot.processar_mensagem` diretamente, ou testando as funções isoladas) rodando dentro do container Docker de produção via SSH. **Só o orquestrador (não os subagents) tem acesso SSH à VPS e às credenciais de deploy** — por isso as Tasks 1 a 9 são só código + verificação local/sintática, e a Task 10 (deploy + teste ao vivo) é do orquestrador.

O banco é Neon Postgres sem migration runner: mudanças de schema são aplicadas por um script avulso em Python usando `asyncpg`, lendo a `DATABASE_URL` do `.env` na raiz do projeto (formato: uma linha `DATABASE_URL=postgres://...`). `schema.sql` na raiz do projeto é a documentação viva do schema atual — toda alteração real no banco precisa ser espelhada lá.

---

### Task 1: Schema — status `reservado`, `expira_em`, `lista_espera`

**Files:**
- Modify: `schema.sql`

- [ ] **Step 1: Atualizar `schema.sql`**

Localizar a definição de `sessoes` (contém `CHECK (status IN ('confirmada', 'cancelada', 'concluida'))` e a `EXCLUDE USING gist`). Substituir o bloco da coluna `status` e adicionar as duas colunas novas logo depois de `lembrete_enviado`:

```sql
    status VARCHAR(20) NOT NULL DEFAULT 'confirmada'
        CHECK (status IN ('confirmada', 'reservado', 'cancelada', 'concluida')),
    observacoes TEXT,
    google_event_id VARCHAR(255), -- id do evento espelhado no Google Calendar, se sincronizado
    lembrete_enviado BOOLEAN NOT NULL DEFAULT false,
    expira_em TIMESTAMPTZ, -- só preenchido quando status = 'reservado'; prazo do hold
    lembrete_expiracao_enviado BOOLEAN NOT NULL DEFAULT false, -- evita mandar o aviso de hold quase expirando 2x
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
```

(a `EXCLUDE USING gist (...) WHERE (status <> 'cancelada')` que já existe logo depois continua igual — não precisa mexer nela, ela já protege `'reservado'` automaticamente)

Adicionar, depois do `CREATE TABLE sessoes (...)` e seu trigger (procure `sessoes_calc_fim` — a nova tabela entra logo depois desse bloco terminar):

```sql
CREATE TABLE lista_espera (
    id SERIAL PRIMARY KEY,
    profissional_id INTEGER NOT NULL REFERENCES profissionais(id) ON DELETE CASCADE,
    local_id INTEGER NOT NULL REFERENCES locais(id),
    paciente_telefone VARCHAR(20) NOT NULL,
    paciente_nome VARCHAR(150) NOT NULL,
    periodo_preferido VARCHAR(10) NOT NULL DEFAULT 'qualquer'
        CHECK (periodo_preferido IN ('manha', 'tarde', 'qualquer')),
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    atendido_em TIMESTAMPTZ -- preenchido quando essa entrada foi avisada de uma vaga
);
```

- [ ] **Step 2: Escrever e rodar o script avulso que aplica isso no banco de verdade**

Criar `/tmp/aplicar_schema_hold_espera.py` (não versionar — é um script de uso único):

```python
import asyncio
import asyncpg

async def main():
    env_path = "/home/luiz-felippe/Área de trabalho/projeto_psicologia/projeto_jamily/.env"
    dsn = None
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line.startswith("DATABASE_URL="):
                dsn = line.split("=", 1)[1].strip().strip('"').strip("'")
                break
    if not dsn:
        raise RuntimeError("DATABASE_URL não encontrada")

    conn = await asyncpg.connect(dsn)
    try:
        await conn.execute(
            "ALTER TABLE sessoes DROP CONSTRAINT sessoes_status_check"
        )
        await conn.execute(
            "ALTER TABLE sessoes ADD CONSTRAINT sessoes_status_check "
            "CHECK (status IN ('confirmada', 'reservado', 'cancelada', 'concluida'))"
        )
        await conn.execute("ALTER TABLE sessoes ADD COLUMN IF NOT EXISTS expira_em TIMESTAMPTZ")
        await conn.execute(
            "ALTER TABLE sessoes ADD COLUMN IF NOT EXISTS lembrete_expiracao_enviado BOOLEAN NOT NULL DEFAULT false"
        )
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS lista_espera (
                id SERIAL PRIMARY KEY,
                profissional_id INTEGER NOT NULL REFERENCES profissionais(id) ON DELETE CASCADE,
                local_id INTEGER NOT NULL REFERENCES locais(id),
                paciente_telefone VARCHAR(20) NOT NULL,
                paciente_nome VARCHAR(150) NOT NULL,
                periodo_preferido VARCHAR(10) NOT NULL DEFAULT 'qualquer'
                    CHECK (periodo_preferido IN ('manha', 'tarde', 'qualquer')),
                criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
                atendido_em TIMESTAMPTZ
            )
            """
        )
        print("OK — schema atualizado")
    finally:
        await conn.close()

asyncio.run(main())
```

**Antes de rodar**, confira o nome real da constraint de status (pode não ser `sessoes_status_check` — Postgres nomeia automaticamente):

Run: `python3 -c "
import asyncio, asyncpg
async def main():
    dsn = None
    with open('/home/luiz-felippe/Área de trabalho/projeto_psicologia/projeto_jamily/.env') as f:
        for line in f:
            if line.strip().startswith('DATABASE_URL='):
                dsn = line.strip().split('=', 1)[1].strip().strip('\"').strip(chr(39))
    conn = await asyncpg.connect(dsn)
    rows = await conn.fetch(\"SELECT conname FROM pg_constraint WHERE conrelid = 'sessoes'::regclass AND contype = 'c'\")
    print([r['conname'] for r in rows])
    await conn.close()
asyncio.run(main())
"`

Expected: uma lista com o nome da constraint CHECK de `status` (algo como `sessoes_status_check`). Ajuste o nome no script acima se vier diferente.

Depois, rode: `python3 /tmp/aplicar_schema_hold_espera.py`
Expected: `OK — schema atualizado`

- [ ] **Step 3: Verificar**

Run:
```bash
python3 -c "
import asyncio, asyncpg
async def main():
    dsn = None
    with open('/home/luiz-felippe/Área de trabalho/projeto_psicologia/projeto_jamily/.env') as f:
        for line in f:
            if line.strip().startswith('DATABASE_URL='):
                dsn = line.strip().split('=', 1)[1].strip().strip('\"').strip(chr(39))
    conn = await asyncpg.connect(dsn)
    cols = await conn.fetch(\"SELECT column_name FROM information_schema.columns WHERE table_name = 'sessoes' AND column_name IN ('expira_em', 'lembrete_expiracao_enviado')\")
    print('colunas sessoes:', [r['column_name'] for r in cols])
    existe = await conn.fetchval(\"SELECT to_regclass('lista_espera')\")
    print('tabela lista_espera existe:', existe is not None)
    await conn.close()
asyncio.run(main())
"
```
Expected: `colunas sessoes: ['expira_em', 'lembrete_expiracao_enviado']` (ordem pode variar) e `tabela lista_espera existe: True`

- [ ] **Step 4: Commit**

```bash
git add schema.sql
git commit -m "Adiciona status 'reservado' em sessoes e tabela lista_espera"
```

(o script em `/tmp` não é versionado — schema.sql já documenta o resultado final)

---

### Task 2: Extrair helpers compartilhados em `bot.py` (refactor, sem mudar comportamento)

**Files:**
- Modify: `backend/app/bot.py`

**Contexto:** `criar_agendamento` tem duas partes reaproveitáveis — buscar um local por nome, e buscar-ou-criar um paciente — que as próximas tasks (`segurar_horario`) também vão precisar. Extrair agora evita duplicar essa lógica.

- [ ] **Step 1: Adicionar os dois helpers, logo antes de `async def criar_agendamento`**

```python
async def _buscar_local(conn, profissional_id: int, local_nome: str):
    local = await conn.fetchrow(
        "SELECT id, nome FROM locais WHERE profissional_id = $1 AND nome ILIKE $2",
        profissional_id, local_nome,
    )
    if local is None:
        raise ValueError(f"Não encontrei o local '{local_nome}'.")
    return local


async def _buscar_ou_criar_paciente(
    conn, profissional_id: int, nome_paciente: str, telefone_paciente: str,
    consentimento_lgpd: bool, data_nascimento,
):
    paciente = await conn.fetchrow(
        "SELECT id, nome, email, tipo_procedimento, data_nascimento FROM pacientes WHERE profissional_id = $1 AND telefone = $2",
        profissional_id, telefone_paciente,
    )
    if paciente is not None:
        return paciente
    if not consentimento_lgpd:
        raise ValueError(
            "Antes de agendar, preciso do consentimento explícito do paciente pra tratar "
            "os dados de saúde dele conforme a LGPD. Pergunte se ele concorda, e só chame "
            "essa ferramenta de novo com consentimento_lgpd=true depois que ele confirmar."
        )
    return await conn.fetchrow(
        """
        INSERT INTO pacientes (profissional_id, nome, telefone, data_nascimento, tipo_atendimento, consentimento_lgpd, consentimento_lgpd_data)
        VALUES ($1, $2, $3, $4, 'individual', true, now())
        RETURNING id, nome, email, tipo_procedimento, data_nascimento
        """,
        profissional_id, nome_paciente, telefone_paciente, data_nascimento,
    )
```

- [ ] **Step 2: Reescrever `criar_agendamento` pra usar os helpers**

Substituir o corpo de `criar_agendamento` (a partir de `async with db.pool.acquire() as conn:` até o fim da função) por:

```python
    async with db.pool.acquire() as conn:
        local = await _buscar_local(conn, profissional_id, local_nome)
        paciente = await _buscar_ou_criar_paciente(
            conn, profissional_id, nome_paciente, telefone_paciente, consentimento_lgpd, data_nascimento
        )

        try:
            sessao = await conn.fetchrow(
                """
                INSERT INTO sessoes (profissional_id, paciente_id, local_id, data_hora, duracao_minutos, modalidade)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING id, data_hora, duracao_minutos, modalidade, status
                """,
                profissional_id, paciente["id"], local["id"], data_hora, duracao_minutos, modalidade,
            )
        except asyncpg.exceptions.ExclusionViolationError:
            raise ValueError("Esse horário acabou de ser ocupado por outra sessão. Escolha outro horário.")

        whatsapp_instance = await conn.fetchval(
            "SELECT whatsapp_instance FROM profissionais WHERE id = $1", profissional_id
        )

    # Mesmo hook de main.py:criar_sessao — aqui cobre agendamentos feitos pelo próprio bot,
    # que não passam pelo endpoint POST /sessoes (visto em produção: paciente agendava pelo
    # WhatsApp e só recebia a anamnese no lembrete de 24h, não na hora da confirmação).
    await anamnese.enviar_anamnese(
        paciente_email=paciente["email"],
        paciente_telefone=telefone_paciente,
        paciente_nome=paciente["nome"],
        tipo_procedimento=paciente["tipo_procedimento"],
        data_nascimento=paciente["data_nascimento"],
        whatsapp_instance=whatsapp_instance,
    )

    return {
        "sessao_id": sessao["id"],
        "paciente": paciente["nome"],
        "local": local["nome"],
        # sessao["data_hora"] volta do banco em UTC — sem converter pra Brasília aqui, a IA
        # acaba repetindo a hora UTC crua pro paciente como se fosse hora local (bug real visto
        # em produção: agendou 11:00 mas confirmou "14:00" pro paciente)
        "data_hora": sessao["data_hora"].astimezone(BRASILIA).strftime("%d/%m/%Y %H:%M"),
        "modalidade": sessao["modalidade"],
    }
```

- [ ] **Step 3: Verificar sintaxe**

Run: `python3 -c "import ast; ast.parse(open('backend/app/bot.py').read())" && echo "sintaxe OK"`
Expected: `sintaxe OK`

- [ ] **Step 4: Conferir que o comportamento não mudou**

Run: `grep -c "def criar_agendamento\|def _buscar_local\|def _buscar_ou_criar_paciente" backend/app/bot.py`
Expected: `3`

- [ ] **Step 5: Commit**

```bash
git add backend/app/bot.py
git commit -m "Extrai _buscar_local e _buscar_ou_criar_paciente de criar_agendamento (refactor)"
```

---

### Task 3: Novo módulo `backend/app/reservas.py`

**Files:**
- Create: `backend/app/reservas.py`

**Contexto:** Este módulo cuida do ciclo de vida do hold (expiração + lembrete) e da lista de espera. Não depende de `bot.py` (pra evitar import circular, já que `bot.py` vai depender dele).

- [ ] **Step 1: Escrever o módulo completo**

```python
import asyncio
import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import asyncpg

from app import db, evolution

logger = logging.getLogger(__name__)

BRASILIA = ZoneInfo("America/Sao_Paulo")
INTERVALO_VERIFICACAO = timedelta(minutes=15)
JANELA_LEMBRETE_EXPIRACAO = timedelta(hours=1)


def calcular_expiracao_hold() -> datetime:
    """Hold expira às 21h de Brasília do dia da conversa. Se a conversa já estiver
    depois das 21h, dá uma janela mínima de 2h a partir de agora, pra nunca nascer
    já expirado ou com prazo curto demais pro paciente decidir."""
    agora = datetime.now(BRASILIA)
    prazo = agora.replace(hour=21, minute=0, second=0, microsecond=0)
    if prazo <= agora:
        prazo = agora + timedelta(hours=2)
    return prazo


async def checar_lista_espera(
    profissional_id: int, local_id: int, data_hora_liberada: datetime, duracao_minutos: int
) -> None:
    """Chamada sempre que uma sessão vira 'cancelada' (cancelamento manual ou hold
    expirado). Se alguém na lista de espera bate com o horário que abriu, cria um
    hold automático em nome dela e avisa por WhatsApp. FIFO: só a entrada mais
    antiga que bate é atendida — se o hold dela expirar sem confirmação, essa mesma
    função roda de novo (via loop_expiracao_holds) e naturalmente pega a próxima,
    porque a entrada anterior já ficou marcada com atendido_em."""
    periodo = "manha" if data_hora_liberada.astimezone(BRASILIA).hour < 12 else "tarde"

    async with db.pool.acquire() as conn:
        candidato = await conn.fetchrow(
            """
            SELECT id, paciente_telefone, paciente_nome
            FROM lista_espera
            WHERE profissional_id = $1 AND local_id = $2 AND atendido_em IS NULL
              AND periodo_preferido IN ('qualquer', $3)
            ORDER BY criado_em
            LIMIT 1
            """,
            profissional_id, local_id, periodo,
        )
        if candidato is None:
            return

        paciente = await conn.fetchrow(
            "SELECT id FROM pacientes WHERE profissional_id = $1 AND telefone = $2",
            profissional_id, candidato["paciente_telefone"],
        )
        if paciente is None:
            paciente = await conn.fetchrow(
                """
                INSERT INTO pacientes (profissional_id, nome, telefone, tipo_atendimento)
                VALUES ($1, $2, $3, 'individual')
                RETURNING id
                """,
                profissional_id, candidato["paciente_nome"], candidato["paciente_telefone"],
            )

        expira_em = calcular_expiracao_hold()
        try:
            await conn.execute(
                """
                INSERT INTO sessoes (profissional_id, paciente_id, local_id, data_hora, duracao_minutos, status, expira_em)
                VALUES ($1, $2, $3, $4, $5, 'reservado', $6)
                """,
                profissional_id, paciente["id"], local_id, data_hora_liberada, duracao_minutos, expira_em,
            )
        except asyncpg.exceptions.ExclusionViolationError:
            logger.warning(
                "Não deu pra reservar horário da lista de espera pro paciente %s — horário %s já ocupado",
                candidato["paciente_telefone"], data_hora_liberada,
            )
            return

        await conn.execute("UPDATE lista_espera SET atendido_em = now() WHERE id = $1", candidato["id"])

        whatsapp_instance = await conn.fetchval(
            "SELECT whatsapp_instance FROM profissionais WHERE id = $1", profissional_id
        )

    if not whatsapp_instance:
        return

    data_formatada = data_hora_liberada.astimezone(BRASILIA).strftime("%d/%m/%Y às %H:%M")
    prazo_formatado = expira_em.strftime("%H:%M")
    try:
        await evolution.enviar_mensagem_texto(
            whatsapp_instance,
            candidato["paciente_telefone"],
            f"Boa notícia! Abriu um horário pra você: {data_formatada}. Deixei reservado até as "
            f"{prazo_formatado} de hoje — é só me confirmar por aqui que eu garanto pra você.",
        )
    except Exception:
        logger.exception(
            "Falha ao avisar paciente da lista de espera (telefone=%s)", candidato["paciente_telefone"]
        )


async def _verificar_expiracao_e_lembrete() -> None:
    agora = datetime.now(BRASILIA)

    async with db.pool.acquire() as conn:
        proximos_de_expirar = await conn.fetch(
            """
            SELECT s.id, s.expira_em, p.telefone AS paciente_telefone, pr.whatsapp_instance
            FROM sessoes s
            JOIN pacientes p ON p.id = s.paciente_id
            JOIN profissionais pr ON pr.id = s.profissional_id
            WHERE s.status = 'reservado' AND s.lembrete_expiracao_enviado = false
              AND s.expira_em BETWEEN $1 AND $2
            """,
            agora, agora + JANELA_LEMBRETE_EXPIRACAO,
        )
        for sessao in proximos_de_expirar:
            if sessao["whatsapp_instance"]:
                prazo_formatado = sessao["expira_em"].astimezone(BRASILIA).strftime("%H:%M")
                try:
                    await evolution.enviar_mensagem_texto(
                        sessao["whatsapp_instance"],
                        sessao["paciente_telefone"],
                        f"Só lembrando: seu horário reservado expira às {prazo_formatado} de hoje. "
                        "Confirma pra garantir?",
                    )
                except Exception:
                    logger.exception(
                        "Falha ao mandar lembrete de expiração de hold (sessao_id=%s)", sessao["id"]
                    )
            await conn.execute(
                "UPDATE sessoes SET lembrete_expiracao_enviado = true WHERE id = $1", sessao["id"]
            )

        expirados = await conn.fetch(
            """
            UPDATE sessoes SET status = 'cancelada'
            WHERE status = 'reservado' AND expira_em < $1
            RETURNING id, profissional_id, local_id, data_hora, duracao_minutos
            """,
            agora,
        )

    for sessao in expirados:
        logger.info("Hold expirado e liberado (sessao_id=%s)", sessao["id"])
        await checar_lista_espera(
            sessao["profissional_id"], sessao["local_id"], sessao["data_hora"], sessao["duracao_minutos"]
        )


async def loop_expiracao_holds() -> None:
    while True:
        try:
            await _verificar_expiracao_e_lembrete()
        except Exception:
            logger.exception("Erro ao verificar expiração de holds")
        await asyncio.sleep(INTERVALO_VERIFICACAO.total_seconds())
```

- [ ] **Step 2: Verificar sintaxe**

Run: `python3 -c "import ast; ast.parse(open('backend/app/reservas.py').read())" && echo "sintaxe OK"`
Expected: `sintaxe OK`

- [ ] **Step 3: Commit**

```bash
git add backend/app/reservas.py
git commit -m "Adiciona módulo reservas.py (expiração de hold, lembrete e lista de espera)"
```

---

### Task 4: `segurar_horario` e `entrar_lista_espera` em `bot.py`

**Files:**
- Modify: `backend/app/bot.py`

- [ ] **Step 1: Adicionar `from app import reservas` ao import**

Localizar `from app import anamnese, db, notificacoes` e substituir por:

```python
from app import anamnese, db, notificacoes, reservas
```

- [ ] **Step 2: Adicionar `segurar_horario`, logo depois de `criar_agendamento`**

```python
async def segurar_horario(
    profissional_id: int,
    nome_paciente: str,
    telefone_paciente: str,
    local_nome: str,
    data_hora_str: str,
    modalidade: str = "presencial",
    duracao_minutos: int = 50,
    consentimento_lgpd: bool = False,
    data_nascimento_str: str | None = None,
) -> dict:
    if modalidade not in ("presencial", "teleconsulta"):
        modalidade = "presencial"

    data_hora = datetime.fromisoformat(data_hora_str)
    if data_hora.tzinfo is None:
        data_hora = data_hora.replace(tzinfo=BRASILIA)

    data_nascimento = date.fromisoformat(data_nascimento_str) if data_nascimento_str else None
    expira_em = reservas.calcular_expiracao_hold()

    async with db.pool.acquire() as conn:
        local = await _buscar_local(conn, profissional_id, local_nome)
        paciente = await _buscar_ou_criar_paciente(
            conn, profissional_id, nome_paciente, telefone_paciente, consentimento_lgpd, data_nascimento
        )

        try:
            sessao = await conn.fetchrow(
                """
                INSERT INTO sessoes (profissional_id, paciente_id, local_id, data_hora, duracao_minutos, modalidade, status, expira_em)
                VALUES ($1, $2, $3, $4, $5, $6, 'reservado', $7)
                RETURNING id, data_hora, duracao_minutos, modalidade, status
                """,
                profissional_id, paciente["id"], local["id"], data_hora, duracao_minutos, modalidade, expira_em,
            )
        except asyncpg.exceptions.ExclusionViolationError:
            raise ValueError("Esse horário acabou de ser ocupado por outra sessão. Escolha outro horário.")

    # Nada de anamnese/email de confirmação aqui de propósito — isso só dispara quando
    # o hold vira confirmado de verdade, em confirmar_horario_reservado. Mandar antes
    # seria enviar formulário/email pra uma reserva que pode nem virar consulta.
    return {
        "sessao_id": sessao["id"],
        "paciente": paciente["nome"],
        "local": local["nome"],
        "data_hora": sessao["data_hora"].astimezone(BRASILIA).strftime("%d/%m/%Y %H:%M"),
        "modalidade": sessao["modalidade"],
        "expira_em": expira_em.strftime("%H:%M"),
    }
```

- [ ] **Step 3: Adicionar `entrar_lista_espera`, logo depois de `segurar_horario`**

```python
async def entrar_lista_espera(
    profissional_id: int, telefone_paciente: str, nome_paciente: str, local_nome: str, periodo_preferido: str,
) -> None:
    if periodo_preferido not in ("manha", "tarde", "qualquer"):
        periodo_preferido = "qualquer"

    async with db.pool.acquire() as conn:
        local = await _buscar_local(conn, profissional_id, local_nome)

        existente = await conn.fetchval(
            """
            SELECT id FROM lista_espera
            WHERE profissional_id = $1 AND local_id = $2 AND paciente_telefone = $3 AND atendido_em IS NULL
            """,
            profissional_id, local["id"], telefone_paciente,
        )
        if existente:
            await conn.execute(
                "UPDATE lista_espera SET periodo_preferido = $1 WHERE id = $2",
                periodo_preferido, existente,
            )
            return

        await conn.execute(
            """
            INSERT INTO lista_espera (profissional_id, local_id, paciente_telefone, paciente_nome, periodo_preferido)
            VALUES ($1, $2, $3, $4, $5)
            """,
            profissional_id, local["id"], telefone_paciente, nome_paciente, periodo_preferido,
        )
```

- [ ] **Step 4: Verificar sintaxe**

Run: `python3 -c "import ast; ast.parse(open('backend/app/bot.py').read())" && echo "sintaxe OK"`
Expected: `sintaxe OK`

- [ ] **Step 5: Commit**

```bash
git add backend/app/bot.py
git commit -m "Adiciona segurar_horario e entrar_lista_espera em bot.py"
```

---

### Task 5: `confirmar_horario_reservado` em `bot.py`

**Files:**
- Modify: `backend/app/bot.py`

- [ ] **Step 1: Adicionar a função, logo depois de `entrar_lista_espera`**

```python
async def confirmar_horario_reservado(profissional_id: int, telefone_paciente: str, sessao_id: int) -> dict:
    async with db.pool.acquire() as conn:
        # WHERE por telefone (via subquery) garante que só o dono do hold consegue
        # confirmá-lo — sem isso, um paciente poderia adivinhar/testar sessao_id alheio.
        sessao = await conn.fetchrow(
            """
            UPDATE sessoes SET status = 'confirmada'
            WHERE id = $1 AND profissional_id = $2 AND status = 'reservado'
              AND paciente_id = (SELECT id FROM pacientes WHERE telefone = $3 AND profissional_id = $2)
            RETURNING id, paciente_id, local_id, data_hora, duracao_minutos, modalidade, link_teleconsulta
            """,
            sessao_id, profissional_id, telefone_paciente,
        )
        if sessao is None:
            raise ValueError(
                "Esse horário reservado não existe mais, já expirou, ou não é seu. Quer que eu "
                "consulte os horários disponíveis de novo?"
            )

        paciente = await conn.fetchrow(
            "SELECT nome, email, telefone, tipo_procedimento, data_nascimento FROM pacientes WHERE id = $1",
            sessao["paciente_id"],
        )
        local = await conn.fetchrow("SELECT nome FROM locais WHERE id = $1", sessao["local_id"])
        profissional = await conn.fetchrow(
            "SELECT nome, whatsapp_instance FROM profissionais WHERE id = $1", profissional_id
        )

    await notificacoes.enviar_email_sessao(
        tipo="confirmacao",
        paciente_email=paciente["email"],
        paciente_nome=paciente["nome"],
        profissional_nome=profissional["nome"],
        data_hora=sessao["data_hora"],
        duracao_minutos=sessao["duracao_minutos"],
        local_nome=local["nome"],
        modalidade=sessao["modalidade"],
        link_teleconsulta=sessao["link_teleconsulta"],
    )
    await anamnese.enviar_anamnese(
        paciente_email=paciente["email"],
        paciente_telefone=paciente["telefone"],
        paciente_nome=paciente["nome"],
        tipo_procedimento=paciente["tipo_procedimento"],
        data_nascimento=paciente["data_nascimento"],
        whatsapp_instance=profissional["whatsapp_instance"],
    )

    return {
        "sessao_id": sessao["id"],
        "paciente": paciente["nome"],
        "local": local["nome"],
        "data_hora": sessao["data_hora"].astimezone(BRASILIA).strftime("%d/%m/%Y %H:%M"),
        "modalidade": sessao["modalidade"],
    }
```

- [ ] **Step 2: Verificar sintaxe**

Run: `python3 -c "import ast; ast.parse(open('backend/app/bot.py').read())" && echo "sintaxe OK"`
Expected: `sintaxe OK`

- [ ] **Step 3: Commit**

```bash
git add backend/app/bot.py
git commit -m "Adiciona confirmar_horario_reservado em bot.py"
```

---

### Task 6: Tools novas + dispatch em `bot.py`

**Files:**
- Modify: `backend/app/bot.py`

- [ ] **Step 1: Adicionar as 3 tools na lista `TOOLS`**

Localizar o fechamento do dicionário de `criar_agendamento` dentro de `TOOLS` (a entrada termina em `"required": ["nome_paciente", "local_nome", "data_hora"],\n    },`, logo antes de `{"name": "acolher_e_escalar", ...`). Inserir as 3 tools novas logo antes de `acolher_e_escalar`:

```python
    {
        "name": "segurar_horario",
        "description": (
            "Segura (reserva temporariamente) um horário pro paciente, sem confirmar de vez, "
            "quando ele demonstra interesse num horário oferecido por consultar_horarios_disponiveis "
            "mas ainda não confirmou de cara (ex: pediu pra pensar, disse que confirma depois). "
            "A reserva expira sozinha ainda hoje se ele não confirmar."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "nome_paciente": {"type": "string", "description": "Nome do paciente"},
                "local_nome": {"type": "string"},
                "data_hora": {"type": "string", "description": "Data e hora no formato YYYY-MM-DDTHH:MM"},
                "modalidade": {"type": "string", "enum": ["presencial", "teleconsulta"]},
                "duracao_minutos": {"type": "integer"},
                "consentimento_lgpd": {
                    "type": "boolean",
                    "description": (
                        "Só true se for a primeira sessão desse paciente E ele já confirmou "
                        "explicitamente que concorda com o tratamento dos dados de saúde dele "
                        "conforme a LGPD. Pra pacientes que já têm cadastro, não precisa disso."
                    ),
                },
                "data_nascimento": {
                    "type": "string",
                    "description": (
                        "Data de nascimento do paciente, no formato YYYY-MM-DD. Só preencha se "
                        "for a primeira sessão de um paciente novo. Pra pacientes que já têm "
                        "cadastro, não precisa perguntar de novo."
                    ),
                },
            },
            "required": ["nome_paciente", "local_nome", "data_hora"],
        },
    },
    {
        "name": "confirmar_horario_reservado",
        "description": (
            "Confirma de vez um horário que já estava reservado (segurado) nessa conversa, "
            "convertendo a reserva numa consulta confirmada de verdade. Use quando o paciente "
            "voltar dizendo que quer confirmar o horário que você segurou pra ele."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "sessao_id": {
                    "type": "integer",
                    "description": "O sessao_id que veio no resultado de segurar_horario, nessa mesma conversa.",
                },
            },
            "required": ["sessao_id"],
        },
    },
    {
        "name": "entrar_lista_espera",
        "description": (
            "Coloca o paciente na lista de espera de um local, quando não há horário bom "
            "disponível pro que ele quer. Ele é avisado automaticamente por WhatsApp assim que "
            "um horário compatível abrir (por cancelamento de outra sessão, por exemplo)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "nome_paciente": {"type": "string", "description": "Nome do paciente"},
                "local_nome": {"type": "string"},
                "periodo_preferido": {
                    "type": "string",
                    "enum": ["manha", "tarde", "qualquer"],
                    "description": "Período do dia que o paciente prefere, ou 'qualquer' se não tiver preferência.",
                },
            },
            "required": ["nome_paciente", "local_nome", "periodo_preferido"],
        },
    },
```

- [ ] **Step 2: Adicionar o dispatch em `_executar_ferramenta`**

Localizar o bloco `if nome == "criar_agendamento": ... return f"Agendamento criado com sucesso: {resultado}"`. Adicionar logo depois (antes de `if nome == "acolher_e_escalar":`):

```python
        if nome == "segurar_horario":
            resultado = await segurar_horario(
                profissional_id,
                entrada["nome_paciente"],
                telefone_paciente,
                entrada["local_nome"],
                entrada["data_hora"],
                entrada.get("modalidade", "presencial"),
                entrada.get("duracao_minutos", 50),
                entrada.get("consentimento_lgpd", False),
                entrada.get("data_nascimento"),
            )
            return f"Horário reservado com sucesso: {resultado}"

        if nome == "confirmar_horario_reservado":
            resultado = await confirmar_horario_reservado(
                profissional_id, telefone_paciente, entrada["sessao_id"]
            )
            return f"Reserva confirmada com sucesso: {resultado}"

        if nome == "entrar_lista_espera":
            await entrar_lista_espera(
                profissional_id, telefone_paciente, entrada["nome_paciente"],
                entrada["local_nome"], entrada["periodo_preferido"],
            )
            return "Paciente adicionado à lista de espera com sucesso."
```

- [ ] **Step 3: Atualizar a condição que registra `acoes` em `processar_mensagem`**

Localizar:

```python
            if chamada.name == "criar_agendamento" and not resultado.startswith("Erro:"):
                acoes.append(resultado)
```

Substituir por:

```python
            if chamada.name in ("criar_agendamento", "segurar_horario", "confirmar_horario_reservado") \
                    and not resultado.startswith("Erro:"):
                acoes.append(resultado)
```

- [ ] **Step 4: Verificar sintaxe**

Run: `python3 -c "import ast; ast.parse(open('backend/app/bot.py').read())" && echo "sintaxe OK"`
Expected: `sintaxe OK`

- [ ] **Step 5: Commit**

```bash
git add backend/app/bot.py
git commit -m "Registra tools segurar_horario, confirmar_horario_reservado e entrar_lista_espera"
```

---

### Task 7: Atualizar a rede de segurança anti-alucinação

**Files:**
- Modify: `backend/app/bot.py`

**Contexto:** `_alega_confirmacao_sem_ter_agendado` intercepta o bot dizendo "confirmado"/"reservado" sem ter chamado a tool de verdade (bug real já visto em produção). Hoje só reconhece `criar_agendamento` como prova de ação real — precisa reconhecer as duas tools novas também, senão o bot fica proibido de confirmar que segurou/confirmou um horário de verdade.

- [ ] **Step 1: Atualizar o reconhecimento de ação real**

Localizar:

```python
def _alega_confirmacao_sem_ter_agendado(texto: str, acoes: list[str]) -> bool:
    """Detecta o modelo dizendo que um agendamento foi feito sem ter chamado
    criar_agendamento com sucesso nessa resposta — visto em produção (o bot confirmou
    uma consulta pro paciente "Gustavo" que nunca foi criada no banco)."""
    texto_lower = texto.lower()
    alegou_confirmacao = any(palavra in texto_lower for palavra in _PALAVRAS_CONFIRMACAO)
    agendamento_real = any(a.startswith("Agendamento criado com sucesso") for a in acoes)
    return alegou_confirmacao and not agendamento_real
```

Substituir por:

```python
_PREFIXOS_ACAO_REAL = (
    "Agendamento criado com sucesso",
    "Horário reservado com sucesso",
    "Reserva confirmada com sucesso",
)


def _alega_confirmacao_sem_ter_agendado(texto: str, acoes: list[str]) -> bool:
    """Detecta o modelo dizendo que um agendamento/reserva foi feito sem ter chamado a
    tool correspondente com sucesso nessa resposta — visto em produção (o bot confirmou
    uma consulta pro paciente "Gustavo" que nunca foi criada no banco)."""
    texto_lower = texto.lower()
    alegou_confirmacao = any(palavra in texto_lower for palavra in _PALAVRAS_CONFIRMACAO)
    agendamento_real = any(a.startswith(_PREFIXOS_ACAO_REAL) for a in acoes)
    return alegou_confirmacao and not agendamento_real
```

- [ ] **Step 2: Verificar sintaxe**

Run: `python3 -c "import ast; ast.parse(open('backend/app/bot.py').read())" && echo "sintaxe OK"`
Expected: `sintaxe OK`

- [ ] **Step 3: Commit**

```bash
git add backend/app/bot.py
git commit -m "Rede de segurança anti-alucinação reconhece hold e confirmação de reserva"
```

---

### Task 8: Reescrever o tom de conversa (system prompt)

**Files:**
- Modify: `backend/app/bot.py`

- [ ] **Step 1: Substituir o `system_prompt` em `processar_mensagem`**

Localizar o bloco `system_prompt = ( ... )` inteiro (começa em `f"Você é o assistente de agendamento..."` e termina em `"clínico, diagnóstico, etc.)."` seguido do `)` de fechamento). Substituir por:

```python
    system_prompt = (
        f"Você é o assistente de agendamento de {profissional['nome']}, respondendo pelo WhatsApp "
        f"a um paciente. Seja breve, cordial e direto, em português do Brasil.\n"
        f"Agora é {agora_str} (horário de Brasília).\n"
        f"Locais de atendimento disponíveis: {nomes_locais}.\n"
        "Conduza a conversa aos poucos: prefira perguntas abertas (ex: 'prefere de manhã ou fim "
        "de tarde?') a listar de uma vez tudo que falta (nome, local, modalidade, data). Peça uma "
        "coisa de cada vez, na ordem que fizer sentido pra conversa.\n"
        "\n"
        "# REGRAS DE OURO\n"
        "- NUNCA ofereça um horário sem antes chamar consultar_horarios_disponiveis. Nunca invente.\n"
        "- NUNCA reaproveite uma lista de horários que você já deu antes na conversa, mesmo pra "
        "mesma data — o tempo passa e outros pacientes podem ter agendado nesse meio tempo. Chame a "
        "ferramenta de novo a cada vez que o paciente perguntar sobre disponibilidade.\n"
        "- NUNCA diga que um agendamento está 'confirmado', 'marcado', 'agendado' ou 'reservado' "
        "sem antes ter chamado a ferramenta correspondente (criar_agendamento, segurar_horario ou "
        "confirmar_horario_reservado) NESSA MESMA resposta e recebido sucesso dela. Dizer isso sem "
        "ter chamado a ferramenta é uma mentira que engana o paciente com algo que não existe de "
        "verdade no sistema.\n"
        "- SEMPRE use criar_agendamento quando o paciente confirmar explicitamente, na hora, um "
        "horário oferecido.\n"
        "- Se o paciente demonstrar interesse num horário mas hesitar ou pedir pra pensar/confirmar "
        "depois, ofereça segurar esse horário com segurar_horario em vez de deixar a conversa parar "
        "aí — diga até quando fica reservado (o campo expira_em do resultado). Quando ele voltar "
        "confirmando, use confirmar_horario_reservado com o sessao_id que você recebeu de "
        "segurar_horario nessa conversa.\n"
        "- Se consultar_horarios_disponiveis não achar nada bom pro que o paciente quer (ex: dia "
        "lotado), ofereça entrar na lista de espera com entrar_lista_espera em vez de só dizer que "
        "não tem horário.\n"
        "- NUNCA invente urgência (frases genéricas tipo 'os horários estão acabando rápido' sem "
        "isso ser verdade). A pressão real já vem do prazo de expiração do hold e da lista de "
        "espera em si — não precisa exagerar.\n"
        "- SEMPRE pergunte explicitamente sobre consentimento LGPD antes de chamar criar_agendamento "
        "ou segurar_horario se for a primeira sessão de um paciente novo, e só passe "
        "consentimento_lgpd=true depois que ele confirmar.\n"
        "- SEMPRE pergunte a data de nascimento do paciente (no mesmo momento em que perguntar o "
        "consentimento LGPD) se for a primeira sessão de um paciente novo, e passe em "
        "data_nascimento. Pra pacientes que já têm cadastro, não precisa perguntar de novo.\n"
        "- SEMPRE chame acolher_e_escalar imediatamente (sem tentar ajudar você mesmo) se o paciente "
        "relatar uma situação de crise ou pedir algo fora do escopo de agendamento (conselho "
        "clínico, diagnóstico, etc.)."
    )
```

- [ ] **Step 2: Verificar sintaxe**

Run: `python3 -c "import ast; ast.parse(open('backend/app/bot.py').read())" && echo "sintaxe OK"`
Expected: `sintaxe OK`

- [ ] **Step 3: Commit**

```bash
git add backend/app/bot.py
git commit -m "Reescreve tom de conversa do bot: perguntas graduais, hold e lista de espera"
```

---

### Task 9: Integração em `main.py`

**Files:**
- Modify: `backend/app/main.py`

- [ ] **Step 1: Importar `reservas`**

Localizar `from app import anamnese, auth, bot, db, evolution, google_calendar, lembretes, notificacoes` e substituir por:

```python
from app import anamnese, auth, bot, db, evolution, google_calendar, lembretes, notificacoes, reservas
```

- [ ] **Step 2: Registrar o loop de expiração de holds no lifespan**

Localizar:

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.connect()
    tarefa_lembretes = asyncio.create_task(lembretes.loop_lembretes())
    yield
    tarefa_lembretes.cancel()
    await db.disconnect()
```

Substituir por:

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.connect()
    tarefa_lembretes = asyncio.create_task(lembretes.loop_lembretes())
    tarefa_holds = asyncio.create_task(reservas.loop_expiracao_holds())
    yield
    tarefa_lembretes.cancel()
    tarefa_holds.cancel()
    await db.disconnect()
```

- [ ] **Step 3: Excluir sessões `reservado` das visões de agenda do painel**

Holds são um estado só-do-bot — o painel não tem UI pra distinguir "reservado" de "confirmada", então mostrar um hold ali confundiria a profissional com uma consulta que não existe de verdade ainda.

Localizar (em `listar_sessoes_hoje`):

```python
            WHERE s.profissional_id = $1
              AND s.data_hora::date = CURRENT_DATE
              AND s.status <> 'cancelada'
```

Substituir por:

```python
            WHERE s.profissional_id = $1
              AND s.data_hora::date = CURRENT_DATE
              AND s.status NOT IN ('cancelada', 'reservado')
```

Localizar (em `listar_sessoes_periodo`):

```python
            WHERE s.profissional_id = $1
              AND s.data_hora::date BETWEEN $2::date AND $3::date
              AND s.status <> 'cancelada'
```

Substituir por:

```python
            WHERE s.profissional_id = $1
              AND s.data_hora::date BETWEEN $2::date AND $3::date
              AND s.status NOT IN ('cancelada', 'reservado')
```

(`listar_sessoes_paciente`, o histórico de um paciente específico, continua sem filtro de status — mostrar um hold ali no histórico do próprio paciente não é confuso do mesmo jeito.)

- [ ] **Step 4: Disparar checagem da lista de espera quando uma sessão é cancelada pelo painel**

Localizar, dentro de `editar_sessao`, a busca do estado atual da sessão:

```python
        atual = await conn.fetchrow(
            "SELECT paciente_id, local_id, google_event_id, modalidade, link_teleconsulta FROM sessoes WHERE id = $1 AND profissional_id = $2",
            sessao_id, profissional_id,
        )
```

Substituir por (adiciona `status` ao SELECT, pra saber se é uma transição de verdade pra cancelada):

```python
        atual = await conn.fetchrow(
            "SELECT paciente_id, local_id, google_event_id, modalidade, link_teleconsulta, status FROM sessoes WHERE id = $1 AND profissional_id = $2",
            sessao_id, profissional_id,
        )
```

Localizar o bloco logo depois do `if row is None: raise HTTPException(...)`:

```python
    if tipo_notificacao:
        await notificacoes.enviar_email_sessao(
```

Substituir por (adiciona a checagem de lista de espera antes do envio de email, só quando a sessão realmente estava virando cancelada agora):

```python
    if body.status == "cancelada" and atual["status"] != "cancelada":
        await reservas.checar_lista_espera(
            profissional_id, body.local_id or atual["local_id"], row["data_hora"], row["duracao_minutos"]
        )

    if tipo_notificacao:
        await notificacoes.enviar_email_sessao(
```

- [ ] **Step 5: Verificar sintaxe**

Run: `python3 -c "import ast; ast.parse(open('backend/app/main.py').read())" && echo "sintaxe OK"`
Expected: `sintaxe OK`

- [ ] **Step 6: Commit**

```bash
git add backend/app/main.py
git commit -m "Integra holds e lista de espera em main.py: loop de fundo, filtro de agenda, gatilho de cancelamento"
```

---

### Task 10 (orquestrador — não delegar a subagent): Deploy e verificação ao vivo

**Contexto:** Igual às features anteriores desse projeto, deploy e teste em produção exigem acesso SSH à VPS (`179.199.133.37`, diretório `/opt/app`) e credenciais que só o orquestrador tem nessa sessão. Fazer isso diretamente, não via subagent.

- [ ] **Step 1: Deploy**

```bash
git push
ssh root@179.199.133.37 "cd /opt/app && git pull && docker compose up -d --build backend"
```
Expected: build e restart do container `app-backend-1` sem erro; `curl -s -o /dev/null -w "%{http_code}\n" https://api.nexosystem.online/health` retorna `200`.

- [ ] **Step 2: Testar hold + confirmação, com conversa real**

Escrever um script (`/tmp/test_hold.py`, copiar pro container via `docker cp`, mesma técnica já usada nas features anteriores) que:
1. Chama `bot.processar_mensagem` várias vezes simulando um paciente que hesita num horário oferecido (deve levar o modelo a chamar `segurar_horario`).
2. Confere no banco que a sessão criada tem `status='reservado'` e `expira_em` preenchido.
3. Manda uma mensagem seguinte confirmando (deve levar o modelo a chamar `confirmar_horario_reservado` com o `sessao_id` certo).
4. Confere que a sessão virou `status='confirmada'`.
5. Limpa os dados de teste (`DELETE FROM sessoes ...`, `DELETE FROM pacientes ...` pro telefone de teste).

Expected: conversa flui naturalmente oferecendo o hold quando o paciente hesita; sessão nasce `reservado`; confirma depois virando `confirmada`; sem exceções nos logs (`docker logs app-backend-1 --since 5m`).

- [ ] **Step 3: Testar expiração de hold + lista de espera**

Dentro do container, via script Python direto (sem esperar horas de verdade):
1. Inserir duas entradas em `lista_espera` pro mesmo `local_id`/período (telefones de teste distintos).
2. Criar uma sessão `status='reservado'` com `expira_em` já no passado (via SQL direto).
3. Chamar `reservas._verificar_expiracao_e_lembrete()` manualmente.
4. Conferir que a sessão expirada virou `cancelada`, que a entrada mais antiga da lista de espera ganhou um hold automático (nova sessão `reservado` em nome dela) e ficou com `atendido_em` preenchido, e que a segunda entrada continua com `atendido_em IS NULL`.
5. Limpar tudo (sessões e pacientes de teste, entradas de `lista_espera`).

Expected: exatamente uma sessão nova criada (FIFO — só a mais antiga da fila), sem exceção.

- [ ] **Step 4: Ler a conversa gerada no Step 2 e confirmar o tom**

Reler o log impresso no Step 2: o bot deve estar perguntando de forma gradual (não uma lista de exigências de uma vez), oferecendo o hold no momento certo, sem frases de urgência inventada.

- [ ] **Step 5: Limpeza final**

```bash
ssh root@179.199.133.37 "docker exec app-backend-1 rm -f /app/test_hold.py /app/test_*.py; rm -f /tmp/test_hold.py"
```
