# Anamnese de tDCS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enviar automaticamente o formulário de anamnese de tDCS certo (adulto ou infantil) pro paciente, por email ou WhatsApp, na confirmação da sessão e no lembrete de 24h — só quando o procedimento envolver estimulação/neuromodulação.

**Architecture:** Um módulo novo (`backend/app/anamnese.py`) concentra a decisão de qual arquivo mandar e a lógica de fallback de canal; reaproveita e estende os módulos de notificação (`notificacoes.py`, `evolution.py`) já existentes em vez de duplicar lógica de envio. Dois pontos de disparo já existentes (`POST /sessoes` e o loop de lembrete de 24h) chamam esse módulo depois do email de confirmação/lembrete que já mandam hoje.

**Tech Stack:** FastAPI + asyncpg (backend), Resend (email, pacote `resend` 2.35.0 já instalado), Evolution API (WhatsApp, self-hosted, verificado contra a instância real rodando na VPS), Next.js + TypeScript (frontend). Sem suíte de testes automatizados — verificação manual em cada tarefa.

**Formatos de API verificados contra as bibliotecas/serviço reais (não presumidos):**
- Resend Python 2.35.0: `resend.Emails.send({..., "attachments": [{"filename": str, "content": list(bytes)}]})` — confirmado lendo `resend/emails/_attachment.py` e `_emails.py` no `backend/.venv` instalado.
- Evolution API 2.3.7 (a instância rodando na VPS, `docker exec app-evolution-api-1`): `POST /message/sendMedia/{instance}` com corpo `{"number": str, "mediatype": "document", "mimetype": str, "media": <base64>, "fileName": str, "caption": str}` — confirmado lendo o código-fonte compilado do container (`whatsapp.baileys.service.js`, campos `.mediatype`, `.fileName`, `mimetype:`, `media:`).

---

## Task 1: Schema — `data_nascimento` e arquivos de anexo

**Files:**
- Modify: `schema.sql`
- Move: `testes_psicologicos/Anamnese_tDCS.docx` → `backend/app/anexos/Anamnese_tDCS.docx`
- Move: `testes_psicologicos/Anamnese_tDCS_Infantil.docx` → `backend/app/anexos/Anamnese_tDCS_Infantil.docx`

- [ ] **Step 1: Adicionar a coluna no `schema.sql`**

Localizar o bloco da tabela `pacientes` (procurar `CREATE TABLE pacientes`) e adicionar
`data_nascimento DATE` logo depois de `email VARCHAR(150)`:

```sql
CREATE TABLE pacientes (
    id SERIAL PRIMARY KEY,
    profissional_id INTEGER NOT NULL REFERENCES profissionais(id) ON DELETE CASCADE,
    nome VARCHAR(150) NOT NULL,
    telefone VARCHAR(20) NOT NULL, -- número de WhatsApp do paciente
    email VARCHAR(150),
    data_nascimento DATE, -- opcional; usado pra decidir a versão do formulário de anamnese
    tipo_atendimento VARCHAR(20) NOT NULL DEFAULT 'individual'
```

(o restante da tabela continua igual — só essa linha nova entra entre `email` e
`tipo_atendimento`).

- [ ] **Step 2: Aplicar a mudança no Neon**

```bash
cd backend && source .venv/bin/activate && python3 -c "
import asyncio, asyncpg, os
from dotenv import load_dotenv
load_dotenv('../.env')
async def main():
    conn = await asyncpg.connect(os.environ['DATABASE_URL'])
    await conn.execute('ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS data_nascimento DATE')
    print('coluna adicionada')
    await conn.close()
asyncio.run(main())
"
```
Expected: `coluna adicionada`.

- [ ] **Step 3: Mover os dois arquivos `.docx` pra dentro de `backend/app`**

```bash
mkdir -p backend/app/anexos
git mv testes_psicologicos/Anamnese_tDCS.docx backend/app/anexos/Anamnese_tDCS.docx
git mv testes_psicologicos/Anamnese_tDCS_Infantil.docx backend/app/anexos/Anamnese_tDCS_Infantil.docx
rmdir testes_psicologicos 2>/dev/null || true
```

Isso é obrigatório, não cosmético: `backend/Dockerfile` só copia `backend/app` pra dentro
da imagem (`COPY app ./app`) — arquivos fora dali não existem no container rodando na
VPS.

- [ ] **Step 4: Confirmar que os arquivos foram movidos**

Run: `ls backend/app/anexos/`
Expected:
```
Anamnese_tDCS.docx
Anamnese_tDCS_Infantil.docx
```

- [ ] **Step 5: Commit**

```bash
git add schema.sql backend/app/anexos/ testes_psicologicos
git commit -m "Adiciona data_nascimento em pacientes e move formulários de anamnese pra dentro do backend"
```

---

## Task 2: Email com anexo em `notificacoes.py`

**Files:**
- Modify: `backend/app/notificacoes.py`

- [ ] **Step 1: Adicionar `enviar_email_com_anexo`, logo depois de `enviar_email_sessao`**

Localizar o fim de `enviar_email_sessao` (o bloco `try/except` que chama
`resend.Emails.send`) e adicionar logo depois, antes de `enviar_alerta_crise`:

```python
async def enviar_email_com_anexo(
    *,
    destinatario: str,
    assunto: str,
    corpo_html: str,
    anexo_path: Path,
    anexo_nome: str,
) -> None:
    if not settings.resend_api_key:
        logger.warning("Email com anexo não enviado (Resend não configurado): %s", assunto)
        return

    resend.api_key = settings.resend_api_key

    try:
        await asyncio.to_thread(
            resend.Emails.send,
            {
                "from": settings.resend_from_email,
                "to": destinatario,
                "subject": assunto,
                "html": corpo_html,
                "attachments": [
                    {
                        "filename": anexo_nome,
                        "content": list(anexo_path.read_bytes()),
                    }
                ],
            },
        )
    except Exception:
        logger.exception("Falha ao enviar email com anexo (assunto=%s)", assunto)
```

- [ ] **Step 2: Adicionar o import de `Path`**

Localizar:

```python
import asyncio
import logging
from datetime import datetime, timedelta
from urllib.parse import urlencode
from zoneinfo import ZoneInfo
```

Substituir por:

```python
import asyncio
import logging
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urlencode
from zoneinfo import ZoneInfo
```

- [ ] **Step 3: Verificar que o arquivo compila**

Run: `cd backend && source .venv/bin/activate && python3 -c "import ast; ast.parse(open('app/notificacoes.py').read()); print('OK')"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/app/notificacoes.py
git commit -m "Adiciona enviar_email_com_anexo em notificacoes.py"
```

---

## Task 3: Envio de documento por WhatsApp em `evolution.py`

**Files:**
- Modify: `backend/app/evolution.py`

- [ ] **Step 1: Reescrever o arquivo inteiro**

```python
import base64
from pathlib import Path

import httpx

from app.config import settings


async def enviar_mensagem_texto(instance: str, numero: str, texto: str) -> None:
    """Envia uma mensagem de texto pelo WhatsApp via Evolution API.

    `numero` deve ser só dígitos com DDI (ex: 5527999999999) — sem '+' e sem o
    sufixo '@s.whatsapp.net' que vem no remoteJid do webhook.
    """
    url = f"{settings.evolution_api_url}/message/sendText/{instance}"
    headers = {"apikey": settings.evolution_api_key or ""}
    body = {"number": numero, "text": texto}

    async with httpx.AsyncClient(timeout=30) as client:
        resposta = await client.post(url, json=body, headers=headers)
        resposta.raise_for_status()


async def enviar_documento(instance: str, numero: str, caminho: Path, legenda: str = "") -> None:
    """Envia um arquivo (ex: .docx) como documento pelo WhatsApp via Evolution API.

    Formato do corpo verificado contra o código-fonte da Evolution API 2.3.7 rodando
    em produção (whatsapp.baileys.service.js) — não é um formato presumido.
    """
    url = f"{settings.evolution_api_url}/message/sendMedia/{instance}"
    headers = {"apikey": settings.evolution_api_key or ""}
    media_base64 = base64.b64encode(caminho.read_bytes()).decode()
    body = {
        "number": numero,
        "mediatype": "document",
        "mimetype": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "media": media_base64,
        "fileName": caminho.name,
        "caption": legenda,
    }

    async with httpx.AsyncClient(timeout=30) as client:
        resposta = await client.post(url, json=body, headers=headers)
        resposta.raise_for_status()
```

- [ ] **Step 2: Verificar que o arquivo compila**

Run: `cd backend && source .venv/bin/activate && python3 -c "import ast; ast.parse(open('app/evolution.py').read()); print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/app/evolution.py
git commit -m "Adiciona envio de documento (enviar_documento) na Evolution API"
```

---

## Task 4: Módulo `anamnese.py`

**Files:**
- Create: `backend/app/anamnese.py`

- [ ] **Step 1: Criar o arquivo**

```python
import logging
from datetime import date
from pathlib import Path

from app import evolution, notificacoes

logger = logging.getLogger(__name__)

PROCEDIMENTOS_COM_ANAMNESE = {"reabilitacao_com_estimulacao", "neuromodulacao"}
IDADE_CORTE_INFANTIL = 12

_DIR_ANEXOS = Path(__file__).resolve().parent / "anexos"
ARQUIVO_ADULTO = _DIR_ANEXOS / "Anamnese_tDCS.docx"
ARQUIVO_INFANTIL = _DIR_ANEXOS / "Anamnese_tDCS_Infantil.docx"


def _calcular_idade(data_nascimento: date, referencia: date) -> int:
    idade = referencia.year - data_nascimento.year
    if (referencia.month, referencia.day) < (data_nascimento.month, data_nascimento.day):
        idade -= 1
    return idade


def determinar_arquivo(tipo_procedimento: str | None, data_nascimento: date | None) -> Path | None:
    """None se o procedimento não precisa de anamnese de tDCS. Senão, o arquivo certo
    (infantil se a idade calculada for menor que IDADE_CORTE_INFANTIL; adulto por
    padrão, inclusive quando data_nascimento é desconhecida)."""
    if tipo_procedimento not in PROCEDIMENTOS_COM_ANAMNESE:
        return None
    if data_nascimento is None:
        return ARQUIVO_ADULTO
    idade = _calcular_idade(data_nascimento, date.today())
    return ARQUIVO_INFANTIL if idade < IDADE_CORTE_INFANTIL else ARQUIVO_ADULTO


async def enviar_anamnese(
    *,
    paciente_email: str | None,
    paciente_telefone: str,
    paciente_nome: str,
    tipo_procedimento: str | None,
    data_nascimento: date | None,
    whatsapp_instance: str | None,
) -> None:
    """Manda o formulário de anamnese certo pro paciente, por email (se tiver) ou
    WhatsApp (se o profissional tiver instância configurada). Não faz nada se o
    procedimento não precisar de anamnese de tDCS. Nunca levanta exceção — uma falha
    de envio não pode derrubar a criação/lembrete da sessão."""
    arquivo = determinar_arquivo(tipo_procedimento, data_nascimento)
    if arquivo is None:
        return

    if paciente_email:
        html = f"""
        <div style="font-family: sans-serif; font-size: 15px; color: #2b2320;">
          <p>Olá, {paciente_nome}!</p>
          <p>Antes da sua consulta, pedimos que preencha o formulário de anamnese em
          anexo e traga preenchido (ou envie de volta por aqui).</p>
          <p style="color: #8a7f78; font-size: 13px;">Mensagem automática — não responda este email.</p>
        </div>
        """
        await notificacoes.enviar_email_com_anexo(
            destinatario=paciente_email,
            assunto="Formulário de anamnese — antes da sua consulta",
            corpo_html=html,
            anexo_path=arquivo,
            anexo_nome=arquivo.name,
        )
        return

    if whatsapp_instance:
        try:
            await evolution.enviar_documento(
                whatsapp_instance,
                paciente_telefone,
                arquivo,
                legenda="Formulário de anamnese pra preencher antes da sua consulta 😊",
            )
        except Exception:
            logger.exception("Falha ao enviar anamnese por WhatsApp (telefone=%s)", paciente_telefone)
```

- [ ] **Step 2: Verificar que o arquivo compila**

Run: `cd backend && source .venv/bin/activate && python3 -c "import ast; ast.parse(open('app/anamnese.py').read()); print('OK')"`
Expected: `OK`

- [ ] **Step 3: Testar `determinar_arquivo` isoladamente**

Run:
```bash
cd backend && source .venv/bin/activate && python3 -c "
import sys; sys.path.insert(0, '.')
from datetime import date
from app.anamnese import determinar_arquivo, ARQUIVO_ADULTO, ARQUIVO_INFANTIL

# procedimento que não precisa de anamnese -> None
assert determinar_arquivo('terapia', None) is None

# sem data de nascimento -> adulto
assert determinar_arquivo('neuromodulacao', None) == ARQUIVO_ADULTO

# 10 anos -> infantil
dez_anos_atras = date.today().replace(year=date.today().year - 10)
assert determinar_arquivo('neuromodulacao', dez_anos_atras) == ARQUIVO_INFANTIL

# 20 anos -> adulto
vinte_anos_atras = date.today().replace(year=date.today().year - 20)
assert determinar_arquivo('reabilitacao_com_estimulacao', vinte_anos_atras) == ARQUIVO_ADULTO

print('todos os casos passaram')
"
```
Expected: `todos os casos passaram`.

- [ ] **Step 4: Commit**

```bash
git add backend/app/anamnese.py
git commit -m "Adiciona módulo anamnese.py (decide e envia o formulário de tDCS)"
```

---

## Task 5: Campo `data_nascimento` no CRUD de pacientes (backend)

**Files:**
- Modify: `backend/app/main.py`

- [ ] **Step 1: Adicionar `data_nascimento` nos dois `SELECT` de listagem/detalhe**

Localizar (em `listar_pacientes`):

```python
            SELECT p.id, p.nome, p.telefone, p.email, p.tipo_atendimento, p.tipo_procedimento, p.status, p.criado_em,
                   p.consentimento_lgpd, p.consentimento_lgpd_data,
                   prox.data_hora AS proxima_sessao
```

Substituir por:

```python
            SELECT p.id, p.nome, p.telefone, p.email, p.data_nascimento, p.tipo_atendimento, p.tipo_procedimento, p.status, p.criado_em,
                   p.consentimento_lgpd, p.consentimento_lgpd_data,
                   prox.data_hora AS proxima_sessao
```

Localizar (em `obter_paciente`):

```python
            SELECT p.id, p.nome, p.telefone, p.email, p.tipo_atendimento, p.tipo_procedimento,
                   p.status, p.criado_em, p.consentimento_lgpd, p.consentimento_lgpd_data,
                   prox.data_hora AS proxima_sessao
```

Substituir por:

```python
            SELECT p.id, p.nome, p.telefone, p.email, p.data_nascimento, p.tipo_atendimento, p.tipo_procedimento,
                   p.status, p.criado_em, p.consentimento_lgpd, p.consentimento_lgpd_data,
                   prox.data_hora AS proxima_sessao
```

- [ ] **Step 2: Adicionar `data_nascimento` nos modelos Pydantic**

Localizar:

```python
class PacienteBody(BaseModel):
    nome: str
    telefone: str
    email: EmailStr | None = None
    tipo_atendimento: str = "individual"
    tipo_procedimento: str
    consentimento_lgpd: bool = False


class PacienteUpdateBody(BaseModel):
    nome: str | None = None
    telefone: str | None = None
    email: EmailStr | None = None
    tipo_atendimento: str | None = None
    tipo_procedimento: str | None = None
    status: str | None = None
    consentimento_lgpd: bool | None = None
```

Substituir por:

```python
class PacienteBody(BaseModel):
    nome: str
    telefone: str
    email: EmailStr | None = None
    data_nascimento: date | None = None
    tipo_atendimento: str = "individual"
    tipo_procedimento: str
    consentimento_lgpd: bool = False


class PacienteUpdateBody(BaseModel):
    nome: str | None = None
    telefone: str | None = None
    email: EmailStr | None = None
    data_nascimento: date | None = None
    tipo_atendimento: str | None = None
    tipo_procedimento: str | None = None
    status: str | None = None
    consentimento_lgpd: bool | None = None
```

(`date` já está importado no topo do arquivo — `from datetime import date, datetime, time`.)

- [ ] **Step 3: Incluir no INSERT de `criar_paciente`**

Localizar:

```python
        row = await conn.fetchrow(
            """
            INSERT INTO pacientes (
                profissional_id, nome, telefone, email, tipo_atendimento, tipo_procedimento,
                consentimento_lgpd, consentimento_lgpd_data
            )
            VALUES ($1, $2, $3, $4, $5, $6, true, now())
            RETURNING id, nome, telefone, email, tipo_atendimento, tipo_procedimento, status, criado_em,
                      consentimento_lgpd, consentimento_lgpd_data
            """,
            profissional_id, body.nome, body.telefone, body.email, body.tipo_atendimento, body.tipo_procedimento,
        )
```

Substituir por:

```python
        row = await conn.fetchrow(
            """
            INSERT INTO pacientes (
                profissional_id, nome, telefone, email, data_nascimento, tipo_atendimento, tipo_procedimento,
                consentimento_lgpd, consentimento_lgpd_data
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, true, now())
            RETURNING id, nome, telefone, email, data_nascimento, tipo_atendimento, tipo_procedimento, status, criado_em,
                      consentimento_lgpd, consentimento_lgpd_data
            """,
            profissional_id, body.nome, body.telefone, body.email, body.data_nascimento,
            body.tipo_atendimento, body.tipo_procedimento,
        )
```

- [ ] **Step 4: Incluir no UPDATE de `editar_paciente`**

Localizar:

```python
        row = await conn.fetchrow(
            """
            UPDATE pacientes SET
                nome = COALESCE($1, nome),
                telefone = COALESCE($2, telefone),
                email = COALESCE($3, email),
                tipo_atendimento = COALESCE($4, tipo_atendimento),
                tipo_procedimento = COALESCE($5, tipo_procedimento),
                status = COALESCE($6, status),
                consentimento_lgpd = COALESCE($9, consentimento_lgpd),
                consentimento_lgpd_data = CASE
                    WHEN $9 = true AND consentimento_lgpd_data IS NULL THEN now()
                    ELSE consentimento_lgpd_data
                END
            WHERE id = $7 AND profissional_id = $8
            RETURNING id, nome, telefone, email, tipo_atendimento, tipo_procedimento, status, criado_em,
                      consentimento_lgpd, consentimento_lgpd_data
            """,
            body.nome, body.telefone, body.email, body.tipo_atendimento, body.tipo_procedimento, body.status,
            paciente_id, profissional_id, body.consentimento_lgpd,
        )
```

Substituir por:

```python
        row = await conn.fetchrow(
            """
            UPDATE pacientes SET
                nome = COALESCE($1, nome),
                telefone = COALESCE($2, telefone),
                email = COALESCE($3, email),
                tipo_atendimento = COALESCE($4, tipo_atendimento),
                tipo_procedimento = COALESCE($5, tipo_procedimento),
                status = COALESCE($6, status),
                consentimento_lgpd = COALESCE($9, consentimento_lgpd),
                consentimento_lgpd_data = CASE
                    WHEN $9 = true AND consentimento_lgpd_data IS NULL THEN now()
                    ELSE consentimento_lgpd_data
                END,
                data_nascimento = COALESCE($10, data_nascimento)
            WHERE id = $7 AND profissional_id = $8
            RETURNING id, nome, telefone, email, data_nascimento, tipo_atendimento, tipo_procedimento, status, criado_em,
                      consentimento_lgpd, consentimento_lgpd_data
            """,
            body.nome, body.telefone, body.email, body.tipo_atendimento, body.tipo_procedimento, body.status,
            paciente_id, profissional_id, body.consentimento_lgpd, body.data_nascimento,
        )
```

- [ ] **Step 5: Verificar que o arquivo compila**

Run: `cd backend && source .venv/bin/activate && python3 -c "import ast; ast.parse(open('app/main.py').read()); print('OK')"`
Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add backend/app/main.py
git commit -m "Adiciona data_nascimento no CRUD de pacientes"
```

---

## Task 6: Disparo na confirmação da sessão

**Files:**
- Modify: `backend/app/main.py`

- [ ] **Step 1: Importar `anamnese`**

Localizar:

```python
from app import auth, bot, db, evolution, google_calendar, lembretes, notificacoes
```

Substituir por:

```python
from app import anamnese, auth, bot, db, evolution, google_calendar, lembretes, notificacoes
```

- [ ] **Step 2: Trazer os campos novos em `_buscar_info_notificacao`**

Localizar:

```python
async def _buscar_info_notificacao(conn, profissional_id: int, paciente_id: int, local_id: int):
    paciente = await conn.fetchrow("SELECT nome, email FROM pacientes WHERE id = $1", paciente_id)
    local = await conn.fetchrow("SELECT nome FROM locais WHERE id = $1", local_id)
    profissional = await conn.fetchrow("SELECT nome FROM profissionais WHERE id = $1", profissional_id)
    return paciente, local, profissional
```

Substituir por:

```python
async def _buscar_info_notificacao(conn, profissional_id: int, paciente_id: int, local_id: int):
    paciente = await conn.fetchrow(
        "SELECT nome, email, telefone, tipo_procedimento, data_nascimento FROM pacientes WHERE id = $1",
        paciente_id,
    )
    local = await conn.fetchrow("SELECT nome FROM locais WHERE id = $1", local_id)
    profissional = await conn.fetchrow(
        "SELECT nome, whatsapp_instance FROM profissionais WHERE id = $1", profissional_id
    )
    return paciente, local, profissional
```

(essa função é usada tanto por `criar_sessao` quanto por `editar_sessao` — está tudo
bem, os campos extras só são lidos onde forem necessários.)

- [ ] **Step 3: Chamar `anamnese.enviar_anamnese` só em `criar_sessao`, depois do email de confirmação**

Localizar (dentro de `criar_sessao`):

```python
    await notificacoes.enviar_email_sessao(
        tipo="confirmacao",
        paciente_email=paciente["email"],
        paciente_nome=paciente["nome"],
        profissional_nome=profissional["nome"],
        data_hora=row["data_hora"],
        duracao_minutos=row["duracao_minutos"],
        local_nome=local["nome"],
        modalidade=row["modalidade"],
        link_teleconsulta=row["link_teleconsulta"],
    )

    google_event_id = await google_calendar.sincronizar_sessao_para_google(
```

Substituir por:

```python
    await notificacoes.enviar_email_sessao(
        tipo="confirmacao",
        paciente_email=paciente["email"],
        paciente_nome=paciente["nome"],
        profissional_nome=profissional["nome"],
        data_hora=row["data_hora"],
        duracao_minutos=row["duracao_minutos"],
        local_nome=local["nome"],
        modalidade=row["modalidade"],
        link_teleconsulta=row["link_teleconsulta"],
    )

    await anamnese.enviar_anamnese(
        paciente_email=paciente["email"],
        paciente_telefone=paciente["telefone"],
        paciente_nome=paciente["nome"],
        tipo_procedimento=paciente["tipo_procedimento"],
        data_nascimento=paciente["data_nascimento"],
        whatsapp_instance=profissional["whatsapp_instance"],
    )

    google_event_id = await google_calendar.sincronizar_sessao_para_google(
```

**Não** adicionar essa chamada em `editar_sessao` — o disparo de anamnese é só na
criação, conforme a spec (reagendamento/cancelamento não reenvia).

- [ ] **Step 4: Verificar que o arquivo compila**

Run: `cd backend && source .venv/bin/activate && python3 -c "import ast; ast.parse(open('app/main.py').read()); print('OK')"`
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add backend/app/main.py
git commit -m "Envia anamnese de tDCS na confirmação da sessão, quando aplicável"
```

---

## Task 7: Disparo no lembrete de 24h

**Files:**
- Modify: `backend/app/lembretes.py`

- [ ] **Step 1: Importar `anamnese`**

Localizar:

```python
from app import db, notificacoes
```

Substituir por:

```python
from app import anamnese, db, notificacoes
```

- [ ] **Step 2: Trazer os campos novos na query e chamar `anamnese.enviar_anamnese` no loop**

Localizar:

```python
        sessoes = await conn.fetch(
            """
            SELECT s.id, s.data_hora, s.duracao_minutos, s.modalidade, s.link_teleconsulta,
                   p.nome AS paciente_nome, p.email AS paciente_email,
                   l.nome AS local_nome, pr.nome AS profissional_nome
            FROM sessoes s
            JOIN pacientes p ON p.id = s.paciente_id
            JOIN locais l ON l.id = s.local_id
            JOIN profissionais pr ON pr.id = s.profissional_id
            WHERE s.status = 'confirmada'
              AND s.lembrete_enviado = false
              AND s.data_hora BETWEEN $1 AND $2
            """,
            alvo_inicio, alvo_fim,
        )

        for sessao in sessoes:
            await notificacoes.enviar_email_sessao(
                tipo="lembrete",
                paciente_email=sessao["paciente_email"],
                paciente_nome=sessao["paciente_nome"],
                profissional_nome=sessao["profissional_nome"],
                data_hora=sessao["data_hora"],
                duracao_minutos=sessao["duracao_minutos"],
                local_nome=sessao["local_nome"],
                modalidade=sessao["modalidade"],
                link_teleconsulta=sessao["link_teleconsulta"],
            )
            await conn.execute("UPDATE sessoes SET lembrete_enviado = true WHERE id = $1", sessao["id"])
            logger.info("Lembrete enviado pra sessão %s", sessao["id"])
```

Substituir por:

```python
        sessoes = await conn.fetch(
            """
            SELECT s.id, s.data_hora, s.duracao_minutos, s.modalidade, s.link_teleconsulta,
                   p.nome AS paciente_nome, p.email AS paciente_email, p.telefone AS paciente_telefone,
                   p.tipo_procedimento, p.data_nascimento,
                   l.nome AS local_nome, pr.nome AS profissional_nome, pr.whatsapp_instance
            FROM sessoes s
            JOIN pacientes p ON p.id = s.paciente_id
            JOIN locais l ON l.id = s.local_id
            JOIN profissionais pr ON pr.id = s.profissional_id
            WHERE s.status = 'confirmada'
              AND s.lembrete_enviado = false
              AND s.data_hora BETWEEN $1 AND $2
            """,
            alvo_inicio, alvo_fim,
        )

        for sessao in sessoes:
            await notificacoes.enviar_email_sessao(
                tipo="lembrete",
                paciente_email=sessao["paciente_email"],
                paciente_nome=sessao["paciente_nome"],
                profissional_nome=sessao["profissional_nome"],
                data_hora=sessao["data_hora"],
                duracao_minutos=sessao["duracao_minutos"],
                local_nome=sessao["local_nome"],
                modalidade=sessao["modalidade"],
                link_teleconsulta=sessao["link_teleconsulta"],
            )
            await anamnese.enviar_anamnese(
                paciente_email=sessao["paciente_email"],
                paciente_telefone=sessao["paciente_telefone"],
                paciente_nome=sessao["paciente_nome"],
                tipo_procedimento=sessao["tipo_procedimento"],
                data_nascimento=sessao["data_nascimento"],
                whatsapp_instance=sessao["whatsapp_instance"],
            )
            await conn.execute("UPDATE sessoes SET lembrete_enviado = true WHERE id = $1", sessao["id"])
            logger.info("Lembrete enviado pra sessão %s", sessao["id"])
```

- [ ] **Step 3: Verificar que o arquivo compila**

Run: `cd backend && source .venv/bin/activate && python3 -c "import ast; ast.parse(open('app/lembretes.py').read()); print('OK')"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/app/lembretes.py
git commit -m "Envia anamnese de tDCS junto do lembrete de 24h, quando aplicável"
```

---

## Task 8: Deploy do backend

**Files:** nenhum

- [ ] **Step 1: Push e deploy**

```bash
git push origin main
ssh -i ~/.ssh/hostinger_vps_jamily root@179.199.133.37 "cd /opt/app && git pull origin main && docker compose up -d --build backend"
```

- [ ] **Step 2: Smoke check**

Run: `curl -s -o /dev/null -w "%{http_code}\n" https://api.nexosystem.online/health`
Expected: `200`

- [ ] **Step 3: Confirmar que os arquivos de anexo existem dentro do container em produção**

```bash
ssh -i ~/.ssh/hostinger_vps_jamily root@179.199.133.37 "docker exec app-backend-1 ls /app/app/anexos/"
```
Expected:
```
Anamnese_tDCS.docx
Anamnese_tDCS_Infantil.docx
```

---

## Task 9: Tipo `Paciente` no frontend

**Files:**
- Modify: `frontend/src/lib/format.ts`

- [ ] **Step 1: Adicionar `data_nascimento` ao tipo `Paciente`**

Localizar:

```ts
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
  consentimento_lgpd: boolean;
  consentimento_lgpd_data: string | null;
};
```

Substituir por:

```ts
export type Paciente = {
  id: number;
  nome: string;
  telefone: string;
  email: string | null;
  data_nascimento: string | null;
  tipo_atendimento: "individual" | "casal";
  tipo_procedimento: string | null;
  status: "ativo" | "inativo";
  criado_em: string;
  proxima_sessao: string | null;
  consentimento_lgpd: boolean;
  consentimento_lgpd_data: string | null;
};
```

- [ ] **Step 2: Verificar que o TypeScript compila**

Run: `cd frontend && npx tsc --noEmit 2>&1 | grep -i "format.ts" || echo "sem erros"`
Expected: `sem erros` (o componente que usa esse tipo só é corrigido na próxima tarefa —
é esperado dar erro em `PacientesTable.tsx` até lá, não em `format.ts`).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/format.ts
git commit -m "Adiciona data_nascimento ao tipo Paciente"
```

---

## Task 10: Campo "Data de nascimento" no formulário de paciente

**Files:**
- Modify: `frontend/src/components/PacientesTable.tsx`

- [ ] **Step 1: Adicionar o campo em `FormState`**

Localizar:

```tsx
type FormState = {
  nome: string;
  telefone: string;
  email: string;
  tipoAtendimento: "individual" | "casal";
  tipoProcedimento: string;
  status: "ativo" | "inativo";
  consentimentoLgpd: boolean;
};
```

Substituir por:

```tsx
type FormState = {
  nome: string;
  telefone: string;
  email: string;
  dataNascimento: string;
  tipoAtendimento: "individual" | "casal";
  tipoProcedimento: string;
  status: "ativo" | "inativo";
  consentimentoLgpd: boolean;
};
```

- [ ] **Step 2: Preencher/inicializar o campo em `pacienteParaFormState` e `formStateVazio`**

Localizar:

```tsx
function pacienteParaFormState(paciente: Paciente): FormState {
  return {
    nome: paciente.nome,
    telefone: paciente.telefone,
    email: paciente.email ?? "",
    tipoAtendimento: paciente.tipo_atendimento,
    tipoProcedimento: paciente.tipo_procedimento ?? "",
    status: paciente.status,
    consentimentoLgpd: paciente.consentimento_lgpd,
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
    consentimentoLgpd: false,
  };
}
```

Substituir por:

```tsx
function pacienteParaFormState(paciente: Paciente): FormState {
  return {
    nome: paciente.nome,
    telefone: paciente.telefone,
    email: paciente.email ?? "",
    dataNascimento: paciente.data_nascimento ?? "",
    tipoAtendimento: paciente.tipo_atendimento,
    tipoProcedimento: paciente.tipo_procedimento ?? "",
    status: paciente.status,
    consentimentoLgpd: paciente.consentimento_lgpd,
  };
}

function formStateVazio(): FormState {
  return {
    nome: "",
    telefone: "",
    email: "",
    dataNascimento: "",
    tipoAtendimento: "individual",
    tipoProcedimento: "",
    status: "ativo",
    consentimentoLgpd: false,
  };
}
```

- [ ] **Step 3: Incluir no payload de `handleSubmit`**

Localizar:

```tsx
    const payload: Record<string, unknown> = {
      nome: form.nome,
      telefone: form.telefone,
      email: form.email || null,
      tipo_atendimento: form.tipoAtendimento,
      consentimento_lgpd: form.consentimentoLgpd,
    };
```

Substituir por:

```tsx
    const payload: Record<string, unknown> = {
      nome: form.nome,
      telefone: form.telefone,
      email: form.email || null,
      data_nascimento: form.dataNascimento || null,
      tipo_atendimento: form.tipoAtendimento,
      consentimento_lgpd: form.consentimentoLgpd,
    };
```

- [ ] **Step 4: Adicionar o campo no formulário (JSX), logo depois do grid de telefone/email**

Localizar:

```tsx
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

          <div className="flex flex-col">
            <label htmlFor="tipo-procedimento" className="mb-1.5 text-sm font-semibold">
```

Substituir por:

```tsx
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

          <div className="flex flex-col">
            <label htmlFor="data-nascimento" className="mb-1.5 text-sm font-semibold">
              Data de nascimento
            </label>
            <input
              id="data-nascimento"
              type="date"
              value={form.dataNascimento}
              onChange={(e) => setForm({ ...form, dataNascimento: e.target.value })}
              className="rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-3 py-2.5 text-[14.5px] outline-none focus:border-accent"
            />
          </div>

          <div className="flex flex-col">
            <label htmlFor="tipo-procedimento" className="mb-1.5 text-sm font-semibold">
```

- [ ] **Step 5: Verificar que o TypeScript compila**

Run: `cd frontend && npx tsc --noEmit 2>&1 | grep -i "PacientesTable" || echo "sem erros"`
Expected: `sem erros`

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/PacientesTable.tsx
git commit -m "Adiciona campo Data de nascimento no formulário de paciente"
```

---

## Task 11: Verificação manual e deploy do frontend

**Files:** nenhum

- [ ] **Step 1: Deploy de produção**

```bash
git push origin main
cd frontend && vercel --prod --yes
```

- [ ] **Step 2: Smoke check**

Run: `curl -s -o /dev/null -w "%{http_code}\n" https://frontend-theta-weld-74.vercel.app/api/health`
Expected: `200`

- [ ] **Step 3: Checklist manual em produção**

Logado como `luiz@teste.com` em `https://frontend-theta-weld-74.vercel.app/pacientes`:
- [ ] O formulário de criar/editar paciente mostra o campo "Data de nascimento" (opcional,
  sem quebrar o cadastro de quem não preencher)
- [ ] Criar um paciente com `tipo_procedimento = neuromodulacao` e uma data de nascimento
  de menos de 12 anos atrás
- [ ] Criar uma sessão pra esse paciente (`POST /sessoes` pela Agenda) e conferir que o
  email de confirmação chega com o anexo `Anamnese_tDCS_Infantil.docx` (se o paciente
  tiver email) — ou que chega como documento no WhatsApp (se não tiver email, mas o
  profissional tiver `whatsapp_instance` configurada)
- [ ] Repetir com um paciente de mais de 12 anos e conferir que vem
  `Anamnese_tDCS.docx`
- [ ] Criar uma sessão pra um paciente com `tipo_procedimento = terapia` e conferir que
  **não** chega nenhum anexo de anamnese
- [ ] Testar um paciente sem `data_nascimento` preenchida e conferir que recebe a versão
  adulto
