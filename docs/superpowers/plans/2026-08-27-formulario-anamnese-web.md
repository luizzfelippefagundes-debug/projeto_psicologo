# Formulário Web de Anamnese Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar o envio do `.docx` de anamnese por um link de formulário web público (sem login), com as respostas guardadas e visíveis no painel.

**Architecture:** Nova tabela `anamnese_respostas` (um token permanente por paciente). Backend ganha 2 endpoints públicos (ler/responder pelo token) e 2 autenticados (lista + detalhe pro painel). `anamnese.py` passa a gerar/reaproveitar o token e mandar o link em vez do anexo. Frontend ganha uma página pública fora do grupo `(app)`, e o schema dos ~48 campos de cada formulário vira a fonte única de verdade (usada tanto pra renderizar o formulário quanto pra exibir as respostas no painel).

**Tech Stack:** FastAPI + asyncpg (Python 3.12), Next.js 16 App Router + TypeScript, Postgres (Neon, sem migration runner — schema alterado por script avulso).

**Spec:** `docs/superpowers/specs/2026-08-27-formulario-anamnese-web-design.md`

---

## Contexto pro engenheiro

Mesmo projeto das features anteriores: SaaS de agendamento pra psicólogos, bot de WhatsApp, painel Next.js. Sem suite de testes automatizada — verificação sempre manual (`python3 -c "import ast; ast.parse(...)"` / `npx tsc --noEmit` pra sintaxe, e simulação real pra comportamento). **Só o orquestrador (não os subagents) tem acesso SSH à VPS e às credenciais de deploy** — por isso as Tasks 1 a 11 são só código + verificação local/sintática, e a Task 12 (deploy + teste ao vivo) é do orquestrador.

**Uma nota importante sobre a spec**: a spec (seção 5) menciona que os campos de "detalhe" (ex: `avc_detalhe`) só apareceriam habilitados na UI quando o campo booleano correspondente (`avc`) estivesse marcado. Ao detalhar a implementação, ficou claro que os nomes desses campos não seguem uma convenção única (`avc_detalhe`, mas também `uso_alcool_frequencia`, `tabagismo_quantidade`, `convulsao_ultima_crise`) — não dá pra inferir o pareamento search-só-pelo-nome sem introduzir uma lista de pareamento paralela (mais uma fonte de duplicação/erro). **Este plano simplifica pra: todos os campos sempre visíveis**, na ordem/seção definida no schema — o próprio `.docx` de origem já mostra tudo de uma vez (é um formulário de papel), então isso não é uma regressão de UX, só uma simplificação de implementação. Isso não muda nenhuma pergunta nem a estrutura de dados, só a exibição condicional.

---

### Task 1: Schema — tabela `anamnese_respostas`

**Files:**
- Modify: `schema.sql`

- [ ] **Step 1: Atualizar `schema.sql`**

Adicionar, em qualquer lugar depois da definição de `pacientes` (por exemplo logo depois do bloco de `sessoes` e seus índices):

```sql
CREATE TABLE anamnese_respostas (
    id SERIAL PRIMARY KEY,
    paciente_id INTEGER NOT NULL UNIQUE REFERENCES pacientes(id) ON DELETE CASCADE,
    token VARCHAR(64) NOT NULL UNIQUE,
    tipo_formulario VARCHAR(10) NOT NULL CHECK (tipo_formulario IN ('adulto', 'infantil')),
    respostas JSONB,
    enviado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    respondido_em TIMESTAMPTZ
);
```

- [ ] **Step 2: Escrever e rodar o script avulso que aplica isso no banco de verdade**

Criar `/tmp/aplicar_schema_anamnese_web.py` (não versionar):

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
            """
            CREATE TABLE IF NOT EXISTS anamnese_respostas (
                id SERIAL PRIMARY KEY,
                paciente_id INTEGER NOT NULL UNIQUE REFERENCES pacientes(id) ON DELETE CASCADE,
                token VARCHAR(64) NOT NULL UNIQUE,
                tipo_formulario VARCHAR(10) NOT NULL CHECK (tipo_formulario IN ('adulto', 'infantil')),
                respostas JSONB,
                enviado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
                respondido_em TIMESTAMPTZ
            )
            """
        )
        print("OK — schema atualizado")
    finally:
        await conn.close()

asyncio.run(main())
```

Run: `python3 /tmp/aplicar_schema_anamnese_web.py`
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
    existe = await conn.fetchval(\"SELECT to_regclass('anamnese_respostas')\")
    print('tabela existe:', existe is not None)
    await conn.close()
asyncio.run(main())
"
```
Expected: `tabela existe: True`

- [ ] **Step 4: Commit**

```bash
git add schema.sql
git commit -m "Adiciona tabela anamnese_respostas"
```

---

### Task 2: `config.py`, `notificacoes.py`, `evolution.py` — preparar infraestrutura

**Files:**
- Modify: `backend/app/config.py`
- Modify: `backend/app/notificacoes.py`
- Modify: `backend/app/evolution.py`

- [ ] **Step 1: Adicionar `frontend_url` em `config.py`**

Localizar `evolution_api_key: str | None = None` em `Settings` e adicionar logo depois:

```python
    evolution_api_key: str | None = None
    frontend_url: str = "https://frontend-theta-weld-74.vercel.app"
```

- [ ] **Step 2: Adicionar `enviar_email_link` em `notificacoes.py`, e remover `enviar_email_com_anexo`**

Localizar a função `enviar_email_com_anexo` inteira (de `async def enviar_email_com_anexo(` até o `except Exception:` / `logger.exception(...)` final dela, antes de `async def enviar_alerta_crise`) e substituir por:

```python
async def enviar_email_link(*, destinatario: str, assunto: str, corpo_html: str) -> None:
    if not settings.resend_api_key:
        logger.warning("Email com link não enviado (Resend não configurado): %s", assunto)
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
            },
        )
    except Exception:
        logger.exception("Falha ao enviar email com link (assunto=%s)", assunto)
```

Se o import `from pathlib import Path` no topo do arquivo ficar sem nenhum outro uso depois dessa troca, remova-o também (ele só existia por causa de `enviar_email_com_anexo`).

- [ ] **Step 2b: Verificar se `Path` ainda é usado em `notificacoes.py`**

Run: `grep -n "Path" backend/app/notificacoes.py`
Expected: se a única ocorrência que sobrar for a linha do `import`, remova essa linha de import. Se `Path` ainda aparecer em outro lugar do arquivo, deixe o import.

- [ ] **Step 3: Remover `enviar_documento` de `evolution.py`**

Localizar e remover a função inteira `async def enviar_documento(...)` (de `async def enviar_documento(instance: str, numero: str, caminho: Path, legenda: str = "") -> None:` até o fim da função, incluindo a docstring). Se `import base64` e `from pathlib import Path` no topo do arquivo ficarem sem uso depois disso, remova-os também.

Run: `grep -n "base64\|Path" backend/app/evolution.py`
Expected: nenhuma ocorrência sobrando (a função que restar, `enviar_mensagem_texto`, não usa nenhum dos dois) — remova os dois imports.

- [ ] **Step 4: Verificar sintaxe**

Run: `python3 -c "import ast; ast.parse(open('backend/app/config.py').read())" && python3 -c "import ast; ast.parse(open('backend/app/notificacoes.py').read())" && python3 -c "import ast; ast.parse(open('backend/app/evolution.py').read())" && echo "sintaxe OK"`
Expected: `sintaxe OK`

- [ ] **Step 5: Commit**

```bash
git add backend/app/config.py backend/app/notificacoes.py backend/app/evolution.py
git commit -m "Adiciona frontend_url e enviar_email_link; remove envio de anexo/documento (não usados mais depois do formulário web)"
```

---

### Task 3: Reescrever `anamnese.py` — token e link em vez de arquivo

**Files:**
- Modify: `backend/app/anamnese.py`
- Delete: `backend/app/anexos/Anamnese_tDCS.docx`
- Delete: `backend/app/anexos/Anamnese_tDCS_Infantil.docx`

**Contexto:** `determinar_arquivo` (que devolvia um `Path` pro `.docx` certo) vira `determinar_tipo_formulario` (devolve `"adulto"` | `"infantil"` | `None`, mesma lógica de idade). `enviar_anamnese` ganha um parâmetro novo `paciente_id: int` (ver Task 4 — os 4 lugares que chamam essa função precisam passar isso), e muda de "gerar arquivo e mandar anexo" pra "criar ou reaproveitar o token, montar o link, mandar por email ou WhatsApp".

- [ ] **Step 1: Substituir o arquivo inteiro**

```python
import logging
import secrets
from datetime import date

from app import db, evolution, notificacoes
from app.config import settings

logger = logging.getLogger(__name__)

PROCEDIMENTOS_COM_ANAMNESE = {"reabilitacao_com_estimulacao", "neuromodulacao"}
IDADE_CORTE_INFANTIL = 12


def _calcular_idade(data_nascimento: date, referencia: date) -> int:
    """Idade em anos completos na data de referência (considera se o aniversário
    deste ano já passou, comparando (mês, dia))."""
    idade = referencia.year - data_nascimento.year
    if (referencia.month, referencia.day) < (data_nascimento.month, data_nascimento.day):
        idade -= 1  # aniversário deste ano ainda não chegou
    return idade


def determinar_tipo_formulario(tipo_procedimento: str | None, data_nascimento: date | None) -> str | None:
    """None se o procedimento não precisa de anamnese de tDCS. Senão, 'infantil' se a
    idade calculada for menor que IDADE_CORTE_INFANTIL; 'adulto' por padrão, inclusive
    quando data_nascimento é desconhecida."""
    if tipo_procedimento not in PROCEDIMENTOS_COM_ANAMNESE:
        return None
    if data_nascimento is None:
        return "adulto"
    idade = _calcular_idade(data_nascimento, date.today())
    return "infantil" if idade < IDADE_CORTE_INFANTIL else "adulto"


async def enviar_anamnese(
    *,
    paciente_id: int,
    paciente_email: str | None,
    paciente_telefone: str,
    paciente_nome: str,
    tipo_procedimento: str | None,
    data_nascimento: date | None,
    whatsapp_instance: str | None,
) -> None:
    """Manda o link do formulário de anamnese certo pro paciente, por email (se tiver)
    ou WhatsApp (se o profissional tiver instância configurada). Não faz nada se o
    procedimento não precisar de anamnese de tDCS, nem se o paciente já respondeu (o
    mesmo link é reaproveitado enquanto ele não responde — funciona como lembrete).
    Nunca levanta exceção — uma falha de envio não pode derrubar a criação/lembrete da
    sessão."""
    tipo_formulario = determinar_tipo_formulario(tipo_procedimento, data_nascimento)
    if tipo_formulario is None:
        return

    token_novo = secrets.token_urlsafe(32)
    async with db.pool.acquire() as conn:
        # ON CONFLICT DO UPDATE (em vez de DO NOTHING) é de propósito: DO NOTHING não
        # devolve nada no RETURNING quando já existe a linha, e a gente precisa do
        # token (e do respondido_em) da linha existente pra decidir o que fazer.
        linha = await conn.fetchrow(
            """
            INSERT INTO anamnese_respostas (paciente_id, token, tipo_formulario)
            VALUES ($1, $2, $3)
            ON CONFLICT (paciente_id) DO UPDATE SET paciente_id = EXCLUDED.paciente_id
            RETURNING token, respondido_em
            """,
            paciente_id, token_novo, tipo_formulario,
        )

    if linha["respondido_em"] is not None:
        return

    link = f"{settings.frontend_url}/anamnese/{linha['token']}"

    if paciente_email:
        html = f"""
        <div style="font-family: sans-serif; font-size: 15px; color: #2b2320;">
          <p>Olá, {paciente_nome}!</p>
          <p>Antes da sua consulta, pedimos que preencha o formulário de anamnese pelo link abaixo:</p>
          <p><a href="{link}" target="_blank" rel="noopener">Preencher formulário de anamnese</a></p>
          <p style="color: #8a7f78; font-size: 13px;">Mensagem automática — não responda este email.</p>
        </div>
        """
        await notificacoes.enviar_email_link(
            destinatario=paciente_email,
            assunto="Formulário de anamnese — antes da sua consulta",
            corpo_html=html,
        )
        return

    if whatsapp_instance:
        try:
            await evolution.enviar_mensagem_texto(
                whatsapp_instance,
                paciente_telefone,
                f"Antes da sua consulta, pedimos que preencha o formulário de anamnese por esse "
                f"link: {link}",
            )
        except Exception:
            logger.exception("Falha ao enviar link de anamnese por WhatsApp (telefone=%s)", paciente_telefone)
        return

    logger.warning(
        "Anamnese necessária mas sem canal de envio disponível (paciente=%s, telefone=%s)",
        paciente_nome, paciente_telefone,
    )
```

- [ ] **Step 2: Remover os arquivos `.docx`**

```bash
git rm backend/app/anexos/Anamnese_tDCS.docx backend/app/anexos/Anamnese_tDCS_Infantil.docx
```

Se a pasta `backend/app/anexos/` ficar vazia depois disso, tudo bem deixá-la vazia (não precisa remover a pasta).

- [ ] **Step 3: Verificar sintaxe**

Run: `python3 -c "import ast; ast.parse(open('backend/app/anamnese.py').read())" && echo "sintaxe OK"`
Expected: `sintaxe OK`

- [ ] **Step 4: Commit**

```bash
git add backend/app/anamnese.py
git commit -m "anamnese.py: link de formulário web em vez de anexo .docx"
```

(o `git rm` dos `.docx` já deixou isso staged — vai junto no mesmo commit)

---

### Task 4: Atualizar os 4 pontos que chamam `anamnese.enviar_anamnese`

**Files:**
- Modify: `backend/app/lembretes.py`
- Modify: `backend/app/main.py`
- Modify: `backend/app/bot.py`

**Contexto:** `enviar_anamnese` agora exige `paciente_id`. Em 3 dos 4 lugares o id já está disponível numa variável existente; no lembrete de 24h, precisa adicionar `paciente_id` na query primeiro.

- [ ] **Step 1: `lembretes.py` — adicionar `s.paciente_id` na query e no `enviar_anamnese`**

Localizar:

```python
            SELECT s.id, s.data_hora, s.duracao_minutos, s.modalidade, s.link_teleconsulta,
                   p.nome AS paciente_nome, p.email AS paciente_email, p.telefone AS paciente_telefone,
                   p.tipo_procedimento, p.data_nascimento,
                   l.nome AS local_nome, pr.nome AS profissional_nome, pr.whatsapp_instance
```

Substituir por:

```python
            SELECT s.id, s.paciente_id, s.data_hora, s.duracao_minutos, s.modalidade, s.link_teleconsulta,
                   p.nome AS paciente_nome, p.email AS paciente_email, p.telefone AS paciente_telefone,
                   p.tipo_procedimento, p.data_nascimento,
                   l.nome AS local_nome, pr.nome AS profissional_nome, pr.whatsapp_instance
```

Localizar:

```python
            await anamnese.enviar_anamnese(
                paciente_email=sessao["paciente_email"],
                paciente_telefone=sessao["paciente_telefone"],
                paciente_nome=sessao["paciente_nome"],
                tipo_procedimento=sessao["tipo_procedimento"],
                data_nascimento=sessao["data_nascimento"],
                whatsapp_instance=sessao["whatsapp_instance"],
            )
```

Substituir por:

```python
            await anamnese.enviar_anamnese(
                paciente_id=sessao["paciente_id"],
                paciente_email=sessao["paciente_email"],
                paciente_telefone=sessao["paciente_telefone"],
                paciente_nome=sessao["paciente_nome"],
                tipo_procedimento=sessao["tipo_procedimento"],
                data_nascimento=sessao["data_nascimento"],
                whatsapp_instance=sessao["whatsapp_instance"],
            )
```

- [ ] **Step 2: `main.py` (`criar_sessao`) — passar `paciente_id`**

Localizar:

```python
    await anamnese.enviar_anamnese(
        paciente_email=paciente["email"],
        paciente_telefone=paciente["telefone"],
        paciente_nome=paciente["nome"],
        tipo_procedimento=paciente["tipo_procedimento"],
        data_nascimento=paciente["data_nascimento"],
        whatsapp_instance=profissional["whatsapp_instance"],
```

(essa é a ocorrência dentro de `criar_sessao` — é a única em `main.py`; confirme com `grep -n "anamnese.enviar_anamnese" backend/app/main.py` que só aparece uma vez antes de editar)

Substituir por:

```python
    await anamnese.enviar_anamnese(
        paciente_id=body.paciente_id,
        paciente_email=paciente["email"],
        paciente_telefone=paciente["telefone"],
        paciente_nome=paciente["nome"],
        tipo_procedimento=paciente["tipo_procedimento"],
        data_nascimento=paciente["data_nascimento"],
        whatsapp_instance=profissional["whatsapp_instance"],
```

(a linha de fechamento `)` logo depois não muda)

- [ ] **Step 3: `bot.py` (`criar_agendamento`) — passar `paciente_id`**

Localizar (dentro de `criar_agendamento`, é a primeira das duas ocorrências de `anamnese.enviar_anamnese` em `bot.py`):

```python
    await anamnese.enviar_anamnese(
        paciente_email=paciente["email"],
        paciente_telefone=telefone_paciente,
        paciente_nome=paciente["nome"],
        tipo_procedimento=paciente["tipo_procedimento"],
        data_nascimento=paciente["data_nascimento"],
        whatsapp_instance=whatsapp_instance,
    )
```

Substituir por:

```python
    await anamnese.enviar_anamnese(
        paciente_id=paciente["id"],
        paciente_email=paciente["email"],
        paciente_telefone=telefone_paciente,
        paciente_nome=paciente["nome"],
        tipo_procedimento=paciente["tipo_procedimento"],
        data_nascimento=paciente["data_nascimento"],
        whatsapp_instance=whatsapp_instance,
    )
```

- [ ] **Step 4: `bot.py` (`confirmar_horario_reservado`) — passar `paciente_id`**

Localizar (dentro de `confirmar_horario_reservado`, é a segunda ocorrência de `anamnese.enviar_anamnese` em `bot.py`):

```python
    await anamnese.enviar_anamnese(
        paciente_email=paciente["email"],
        paciente_telefone=paciente["telefone"],
        paciente_nome=paciente["nome"],
        tipo_procedimento=paciente["tipo_procedimento"],
        data_nascimento=paciente["data_nascimento"],
        whatsapp_instance=profissional["whatsapp_instance"],
    )
```

Substituir por:

```python
    await anamnese.enviar_anamnese(
        paciente_id=sessao["paciente_id"],
        paciente_email=paciente["email"],
        paciente_telefone=paciente["telefone"],
        paciente_nome=paciente["nome"],
        tipo_procedimento=paciente["tipo_procedimento"],
        data_nascimento=paciente["data_nascimento"],
        whatsapp_instance=profissional["whatsapp_instance"],
    )
```

(`sessao["paciente_id"]` já vem do `RETURNING` do `UPDATE` no início da função — não precisa buscar de novo)

- [ ] **Step 5: Verificar sintaxe**

Run: `python3 -c "import ast; ast.parse(open('backend/app/lembretes.py').read())" && python3 -c "import ast; ast.parse(open('backend/app/main.py').read())" && python3 -c "import ast; ast.parse(open('backend/app/bot.py').read())" && echo "sintaxe OK"`
Expected: `sintaxe OK`

- [ ] **Step 6: Commit**

```bash
git add backend/app/lembretes.py backend/app/main.py backend/app/bot.py
git commit -m "Passa paciente_id nas 4 chamadas de anamnese.enviar_anamnese"
```

---

### Task 5: Endpoints públicos `GET`/`POST /anamnese/{token}`

**Files:**
- Modify: `backend/app/main.py`

- [ ] **Step 1: Adicionar os dois endpoints**

Localizar o final do dicionário `LABELS_PROCEDIMENTO` (termina em `"neuromodulacao": "Neuromodulação",\n}`, logo antes de `class ChatMensagem(BaseModel):`). Inserir logo depois:

```python
class AnamneseRespostaBody(BaseModel):
    respostas: dict


@app.get("/anamnese/{token}")
async def obter_anamnese_publica(token: str):
    async with db.pool.acquire() as conn:
        linha = await conn.fetchrow(
            """
            SELECT ar.tipo_formulario, ar.respondido_em, p.nome AS paciente_nome
            FROM anamnese_respostas ar
            JOIN pacientes p ON p.id = ar.paciente_id
            WHERE ar.token = $1
            """,
            token,
        )
    if linha is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Link inválido")
    return {
        "paciente_nome": linha["paciente_nome"],
        "tipo_formulario": linha["tipo_formulario"],
        "respondido": linha["respondido_em"] is not None,
    }


@app.post("/anamnese/{token}")
async def responder_anamnese_publica(token: str, body: AnamneseRespostaBody):
    async with db.pool.acquire() as conn:
        atual = await conn.fetchrow(
            "SELECT respondido_em FROM anamnese_respostas WHERE token = $1", token
        )
        if atual is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Link inválido")
        if atual["respondido_em"] is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Esse formulário já foi respondido"
            )

        await conn.execute(
            "UPDATE anamnese_respostas SET respostas = $1::jsonb, respondido_em = now() WHERE token = $2",
            json.dumps(body.respostas), token,
        )
    return {"ok": True}
```

Note que **nenhum dos dois endpoints tem `Depends(auth.get_current_profissional_id)`** — são públicos de propósito, o token na URL é a própria autenticação (link mágico).

- [ ] **Step 2: Verificar sintaxe**

Run: `python3 -c "import ast; ast.parse(open('backend/app/main.py').read())" && echo "sintaxe OK"`
Expected: `sintaxe OK`

- [ ] **Step 3: Commit**

```bash
git add backend/app/main.py
git commit -m "Adiciona endpoints públicos GET/POST /anamnese/{token}"
```

---

### Task 6: Endpoints autenticados pro painel — lista e detalhe

**Files:**
- Modify: `backend/app/main.py`

- [ ] **Step 1: Adicionar os dois endpoints**

Localizar o final de `listar_sessoes_paciente` (termina em `return [dict(row) for row in rows]`, logo antes de `@app.get("/sessoes/hoje")`). Inserir logo depois:

```python
@app.get("/pacientes-anamnese")
async def listar_pacientes_anamnese(profissional_id: int = Depends(auth.get_current_profissional_id)):
    async with db.pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT p.id, p.nome, p.telefone, ar.enviado_em, ar.respondido_em
            FROM pacientes p
            LEFT JOIN anamnese_respostas ar ON ar.paciente_id = p.id
            WHERE p.profissional_id = $1
              AND p.tipo_procedimento = ANY($2::text[])
            ORDER BY p.nome
            """,
            profissional_id, list(anamnese.PROCEDIMENTOS_COM_ANAMNESE),
        )
    return [dict(row) for row in rows]


@app.get("/pacientes/{paciente_id}/anamnese")
async def obter_anamnese_paciente(
    paciente_id: int, profissional_id: int = Depends(auth.get_current_profissional_id)
):
    async with db.pool.acquire() as conn:
        existe = await conn.fetchval(
            "SELECT id FROM pacientes WHERE id = $1 AND profissional_id = $2", paciente_id, profissional_id
        )
        if existe is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Paciente não encontrado")

        linha = await conn.fetchrow(
            "SELECT tipo_formulario, respostas, enviado_em, respondido_em FROM anamnese_respostas WHERE paciente_id = $1",
            paciente_id,
        )
    if linha is None:
        return None
    resultado = dict(linha)
    resultado["respostas"] = json.loads(resultado["respostas"]) if resultado["respostas"] else None
    return resultado
```

`list(anamnese.PROCEDIMENTOS_COM_ANAMNESE)` reaproveita o mesmo conjunto de procedimentos já usado em `anamnese.py`, em vez de escrever a tupla `('reabilitacao_com_estimulacao', 'neuromodulacao')` uma terceira vez no código (já existe um comentário em `TIPOS_PROCEDIMENTO`, mais acima nesse arquivo, avisando que essas duas listas não são derivadas automaticamente uma da outra — não adicione uma quarta cópia).

- [ ] **Step 2: Verificar sintaxe**

Run: `python3 -c "import ast; ast.parse(open('backend/app/main.py').read())" && echo "sintaxe OK"`
Expected: `sintaxe OK`

- [ ] **Step 3: Commit**

```bash
git add backend/app/main.py
git commit -m "Adiciona GET /pacientes-anamnese e GET /pacientes/{id}/anamnese"
```

---

### Task 7: `frontend/src/lib/anamneseSchema.ts` — schema dos campos

**Files:**
- Create: `frontend/src/lib/anamneseSchema.ts`

- [ ] **Step 1: Criar o arquivo completo**

```typescript
export type CampoAnamnese = {
  id: string;
  secao: string;
  label: string;
  tipo: "texto" | "textarea" | "data" | "booleano";
};

export const CAMPOS_ADULTO: CampoAnamnese[] = [
  { id: "nome_completo", secao: "Dados de identificação", label: "Nome completo", tipo: "texto" },
  { id: "data_nascimento", secao: "Dados de identificação", label: "Data de nascimento", tipo: "data" },
  { id: "sexo", secao: "Dados de identificação", label: "Sexo", tipo: "texto" },
  { id: "endereco", secao: "Dados de identificação", label: "Endereço", tipo: "texto" },
  { id: "telefone", secao: "Dados de identificação", label: "Telefone", tipo: "texto" },
  { id: "responsavel", secao: "Dados de identificação", label: "Responsável (se aplicável)", tipo: "texto" },
  { id: "profissao", secao: "Dados de identificação", label: "Profissão", tipo: "texto" },
  { id: "motivo_aplicacao", secao: "Queixa principal", label: "Motivo da aplicação da tDCS", tipo: "textarea" },
  { id: "inicio_sintomas", secao: "História da doença atual", label: "Início dos sintomas", tipo: "textarea" },
  { id: "fatores_desencadeantes", secao: "História da doença atual", label: "Fatores desencadeantes", tipo: "textarea" },
  { id: "frequencia_intensidade", secao: "História da doença atual", label: "Frequência e intensidade", tipo: "textarea" },
  { id: "tratamentos_anteriores", secao: "História da doença atual", label: "Tratamentos anteriores", tipo: "textarea" },
  { id: "avc", secao: "Histórico médico — neurológico", label: "AVC", tipo: "booleano" },
  { id: "avc_detalhe", secao: "Histórico médico — neurológico", label: "AVC — quando? sequelas?", tipo: "texto" },
  { id: "traumatismo_craniano", secao: "Histórico médico — neurológico", label: "Traumatismo craniano", tipo: "booleano" },
  { id: "traumatismo_detalhe", secao: "Histórico médico — neurológico", label: "Traumatismo craniano — quando?", tipo: "texto" },
  { id: "epilepsia", secao: "Histórico médico — neurológico", label: "Epilepsia/Convulsões", tipo: "booleano" },
  { id: "epilepsia_detalhe", secao: "Histórico médico — neurológico", label: "Epilepsia/Convulsões — última crise", tipo: "texto" },
  { id: "tumores_cerebrais", secao: "Histórico médico — neurológico", label: "Tumores cerebrais", tipo: "booleano" },
  { id: "enxaquecas_frequentes", secao: "Histórico médico — neurológico", label: "Enxaquecas frequentes", tipo: "booleano" },
  { id: "doenca_neurodegenerativa", secao: "Histórico médico — neurológico", label: "Doença neurodegenerativa", tipo: "booleano" },
  { id: "doenca_neurodegenerativa_detalhe", secao: "Histórico médico — neurológico", label: "Doença neurodegenerativa — qual?", tipo: "texto" },
  { id: "infarto", secao: "Histórico médico — cardíaco", label: "Infarto", tipo: "booleano" },
  { id: "infarto_detalhe", secao: "Histórico médico — cardíaco", label: "Infarto — quando?", tipo: "texto" },
  { id: "arritmia", secao: "Histórico médico — cardíaco", label: "Arritmia", tipo: "booleano" },
  { id: "marca_passo", secao: "Histórico médico — cardíaco", label: "Marca-passo", tipo: "booleano" },
  { id: "cirurgias", secao: "Histórico médico — cirurgias", label: "Já realizou cirurgias? Quais?", tipo: "textarea" },
  { id: "implantes_metalicos", secao: "Histórico médico — cirurgias", label: "Implantes metálicos na cabeça/face?", tipo: "booleano" },
  { id: "implante_coclear", secao: "Histórico médico — cirurgias", label: "Implante coclear?", tipo: "booleano" },
  { id: "internacoes", secao: "Histórico médico", label: "Já foi internado? Quando e por qual motivo?", tipo: "textarea" },
  { id: "medicamentos_atuais", secao: "Histórico médico", label: "Quais medicamentos usa atualmente?", tipo: "textarea" },
  { id: "alergias", secao: "Histórico médico", label: "Tem alergia a algum medicamento, metal ou cosmético?", tipo: "textarea" },
  { id: "depressao", secao: "Histórico médico — psiquiátrico", label: "Depressão", tipo: "booleano" },
  { id: "ansiedade", secao: "Histórico médico — psiquiátrico", label: "Ansiedade", tipo: "booleano" },
  { id: "tea", secao: "Histórico médico — psiquiátrico", label: "TEA", tipo: "booleano" },
  { id: "tdah", secao: "Histórico médico — psiquiátrico", label: "TDAH", tipo: "booleano" },
  { id: "outra_condicao_psiquiatrica", secao: "Histórico médico — psiquiátrico", label: "Outra condição psiquiátrica", tipo: "texto" },
  { id: "internacoes_psiquiatricas", secao: "Histórico médico — psiquiátrico", label: "Internações psiquiátricas", tipo: "textarea" },
  { id: "doencas_neurologicas_familia", secao: "Histórico familiar", label: "Doenças neurológicas na família (AVC, epilepsia)", tipo: "textarea" },
  { id: "transtornos_psiquiatricos_familia", secao: "Histórico familiar", label: "Transtornos psiquiátricos na família", tipo: "textarea" },
  { id: "febre_infeccao", secao: "Condições atuais", label: "Febre ou infecção?", tipo: "texto" },
  { id: "feridas_couro_cabeludo", secao: "Condições atuais", label: "Feridas no couro cabeludo?", tipo: "texto" },
  { id: "esta_gravida", secao: "Condições atuais", label: "Está grávida?", tipo: "texto" },
  { id: "dor_cabeca_hoje", secao: "Condições atuais", label: "Dor de cabeça intensa hoje?", tipo: "texto" },
  { id: "qualidade_sono", secao: "Hábitos de vida", label: "Qualidade do sono", tipo: "texto" },
  { id: "uso_alcool", secao: "Hábitos de vida", label: "Uso de álcool", tipo: "booleano" },
  { id: "uso_alcool_frequencia", secao: "Hábitos de vida", label: "Uso de álcool — frequência", tipo: "texto" },
  { id: "tabagismo", secao: "Hábitos de vida", label: "Tabagismo", tipo: "booleano" },
  { id: "tabagismo_quantidade", secao: "Hábitos de vida", label: "Tabagismo — quantidade por dia", tipo: "texto" },
  { id: "uso_drogas_ilicitas", secao: "Hábitos de vida", label: "Uso de drogas ilícitas", tipo: "texto" },
  { id: "epilepsia_ativa", secao: "Contraindicações", label: "Epilepsia ativa?", tipo: "booleano" },
  { id: "implantes_metalicos_cabeca", secao: "Contraindicações", label: "Implantes metálicos na cabeça?", tipo: "booleano" },
  { id: "lesoes_couro_cabeludo", secao: "Contraindicações", label: "Lesões ou infecções no couro cabeludo?", tipo: "booleano" },
  { id: "funcao_a_trabalhar", secao: "Objetivo do tratamento", label: "Função a ser trabalhada (atenção, memória, linguagem, humor, controle motor, etc.)", tipo: "texto" },
  { id: "ja_fez_tdcs", secao: "Objetivo do tratamento", label: "Já realizou tDCS antes? Como foi?", tipo: "textarea" },
];

export const CAMPOS_INFANTIL: CampoAnamnese[] = [
  { id: "nome_crianca", secao: "Dados de identificação", label: "Nome completo da criança", tipo: "texto" },
  { id: "data_nascimento", secao: "Dados de identificação", label: "Data de nascimento", tipo: "data" },
  { id: "sexo", secao: "Dados de identificação", label: "Sexo", tipo: "texto" },
  { id: "nome_responsavel", secao: "Dados de identificação", label: "Nome do responsável", tipo: "texto" },
  { id: "telefone_contato", secao: "Dados de identificação", label: "Telefone para contato", tipo: "texto" },
  { id: "endereco", secao: "Dados de identificação", label: "Endereço", tipo: "texto" },
  { id: "escola", secao: "Dados de identificação", label: "Escola", tipo: "texto" },
  { id: "ano_escolar", secao: "Dados de identificação", label: "Ano escolar", tipo: "texto" },
  { id: "profissionais_acompanham", secao: "Dados de identificação", label: "Profissionais que acompanham a criança", tipo: "textarea" },
  { id: "dificuldade_preocupa_familia", secao: "Queixa principal", label: "Qual a principal dificuldade ou comportamento que preocupa a família?", tipo: "textarea" },
  { id: "motivo_busca_tdcs", secao: "Queixa principal", label: "O que motivou a busca pela aplicação do tDCS?", tipo: "textarea" },
  { id: "gestacao_parto", secao: "Desenvolvimento", label: "Como foi a gestação e o parto? (prematuridade, intercorrências, medicamentos)", tipo: "textarea" },
  { id: "internacao_uti_neonatal", secao: "Desenvolvimento", label: "Houve internação na UTI neonatal?", tipo: "texto" },
  { id: "marcos_motores", secao: "Desenvolvimento", label: "Quando começou a sentar, engatinhar e andar?", tipo: "texto" },
  { id: "primeiras_palavras", secao: "Desenvolvimento", label: "Quando falou as primeiras palavras?", tipo: "texto" },
  { id: "fala_comunicacao_atual", secao: "Desenvolvimento", label: "Como está a fala e a comunicação atualmente?", tipo: "textarea" },
  { id: "usa_frases_conversas", secao: "Desenvolvimento", label: "A criança usa frases? Consegue manter conversas?", tipo: "texto" },
  { id: "diagnostico_tea", secao: "Condições médicas", label: "TEA", tipo: "booleano" },
  { id: "diagnostico_tdah", secao: "Condições médicas", label: "TDAH", tipo: "booleano" },
  { id: "diagnostico_atraso_linguagem", secao: "Condições médicas", label: "Atraso de linguagem", tipo: "booleano" },
  { id: "diagnostico_apraxia_fala", secao: "Condições médicas", label: "Apraxia de fala", tipo: "booleano" },
  { id: "diagnostico_epilepsia", secao: "Condições médicas", label: "Epilepsia", tipo: "booleano" },
  { id: "diagnostico_outro", secao: "Condições médicas", label: "Outro diagnóstico", tipo: "texto" },
  { id: "episodio_convulsao", secao: "Condições médicas", label: "Algum episódio de convulsão?", tipo: "booleano" },
  { id: "convulsao_ultima_crise", secao: "Condições médicas", label: "Convulsão — última crise", tipo: "texto" },
  { id: "historico_avc_tce_lesoes", secao: "Condições médicas", label: "Histórico de AVC, traumatismo craniano ou lesões cerebrais?", tipo: "textarea" },
  { id: "cirurgias", secao: "Condições médicas", label: "Já realizou cirurgias? Quais?", tipo: "textarea" },
  { id: "internacoes", secao: "Condições médicas", label: "Já ficou internado? Por qual motivo?", tipo: "textarea" },
  { id: "medicamentos_atuais", secao: "Condições médicas", label: "Faz uso de algum medicamento atualmente? Quais? Horários?", tipo: "textarea" },
  { id: "alergias", secao: "Condições médicas", label: "Tem alergia a algum medicamento ou material?", tipo: "textarea" },
  { id: "crianca_fala", secao: "Fono e psicológico", label: "A criança fala?", tipo: "booleano" },
  { id: "usa_comunicacao_alternativa", secao: "Fono e psicológico", label: "Usa Comunicação Alternativa (figuras, tablet)?", tipo: "texto" },
  { id: "compreensao_ordens_simples", secao: "Fono e psicológico", label: 'Como é a compreensão de ordens simples (ex: "traz a bola")?', tipo: "textarea" },
  { id: "interage_outras_pessoas", secao: "Fono e psicológico", label: "A criança interage com outras pessoas? (olha nos olhos, brinca junto)", tipo: "textarea" },
  { id: "comportamentos_repetitivos", secao: "Fono e psicológico", label: "Tem comportamentos repetitivos (balanço, bater as mãos)?", tipo: "textarea" },
  { id: "dificuldades_sensoriais", secao: "Fono e psicológico", label: "Tem dificuldades com barulhos, texturas ou sabores?", tipo: "textarea" },
  { id: "sono", secao: "Fono e psicológico", label: "Como é o sono? Dorme bem?", tipo: "textarea" },
  { id: "alimentacao", secao: "Fono e psicológico", label: "Como é a alimentação? Aceita alimentos variados?", tipo: "textarea" },
  { id: "comportamento_escola", secao: "Rotina e comportamento", label: "Frequenta escola? Como se comporta lá?", tipo: "textarea" },
  { id: "atencao_atividades", secao: "Rotina e comportamento", label: "Consegue manter atenção em atividades? Por quanto tempo?", tipo: "textarea" },
  { id: "crises_irritacao", secao: "Rotina e comportamento", label: "Tem crises de irritação? O que desencadeia?", tipo: "textarea" },
  { id: "brincadeiras_favoritas", secao: "Rotina e comportamento", label: "O que a criança gosta de fazer (brincadeiras favoritas)?", tipo: "textarea" },
  { id: "funcao_atencao", secao: "Objetivo do tratamento", label: "Atenção", tipo: "booleano" },
  { id: "funcao_controle_impulsos", secao: "Objetivo do tratamento", label: "Controle de impulsos", tipo: "booleano" },
  { id: "funcao_linguagem_fala", secao: "Objetivo do tratamento", label: "Linguagem e fala", tipo: "booleano" },
  { id: "funcao_comportamento", secao: "Objetivo do tratamento", label: "Comportamento", tipo: "booleano" },
  { id: "funcao_memoria", secao: "Objetivo do tratamento", label: "Memória", tipo: "booleano" },
  { id: "funcao_humor", secao: "Objetivo do tratamento", label: "Humor", tipo: "booleano" },
  { id: "ja_fez_tdcs_crianca", secao: "Objetivo do tratamento", label: "A criança já fez tDCS antes? Como foi a experiência?", tipo: "textarea" },
];
```

- [ ] **Step 2: Verificar tipo**

Run: `cd frontend && npx tsc --noEmit 2>&1 | grep -i "anamneseSchema" || echo "sem erros"`
Expected: `sem erros`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/anamneseSchema.ts
git commit -m "Adiciona schema dos campos de anamnese (adulto e infantil)"
```

---

### Task 8: Tipos e funções de API no frontend

**Files:**
- Modify: `frontend/src/lib/format.ts`
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Adicionar tipos em `format.ts`**

Localizar `export type ContatoBot = {` (bloco inteiro, termina em `};`) e adicionar logo depois:

```typescript
export type AnamneseListaItem = {
  id: number;
  nome: string;
  telefone: string;
  enviado_em: string | null;
  respondido_em: string | null;
};

export type AnamneseDetalhe = {
  tipo_formulario: "adulto" | "infantil";
  respostas: Record<string, string | boolean> | null;
  enviado_em: string;
  respondido_em: string | null;
} | null;
```

- [ ] **Step 2: Adicionar funções em `api.ts`**

Localizar `export function getContatosBot() {` (bloco inteiro) e adicionar logo depois:

```typescript
export function getPacientesAnamnese() {
  return apiFetch<AnamneseListaItem[]>("/pacientes-anamnese");
}

export function getAnamnesePaciente(id: number) {
  return apiFetch<AnamneseDetalhe>(`/pacientes/${id}/anamnese`);
}
```

E adicionar `AnamneseDetalhe` e `AnamneseListaItem` à lista de imports de tipo no topo do arquivo (junto de `ContatoBot`, `ConversaEscalonada`, etc.).

- [ ] **Step 3: Verificar tipo**

Run: `cd frontend && npx tsc --noEmit 2>&1 | grep -iE "format.ts|api.ts" || echo "sem erros"`
Expected: `sem erros`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/format.ts frontend/src/lib/api.ts
git commit -m "Adiciona tipos e fetchers de anamnese no frontend"
```

---

### Task 9: Página pública `frontend/src/app/anamnese/[token]/page.tsx`

**Files:**
- Create: `frontend/src/app/anamnese/[token]/page.tsx`

**Contexto:** Fica fora dos grupos `(app)`/`(auth)` — usa só o layout raiz (`frontend/src/app/layout.tsx`), sem sidebar. Não tem sessão/cookie envolvido, então busca os dados direto do backend via `fetch` do navegador, usando `NEXT_PUBLIC_API_URL` (variável já configurada na Vercel, aponta pra `https://api.nexosystem.online` em produção).

- [ ] **Step 1: Criar o arquivo completo**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { CAMPOS_ADULTO, CAMPOS_INFANTIL, type CampoAnamnese } from "@/lib/anamneseSchema";

const API_URL = process.env.NEXT_PUBLIC_API_URL;

type EstadoPagina =
  | { tipo: "carregando" }
  | { tipo: "erro"; mensagem: string }
  | { tipo: "ja_respondido"; pacienteNome: string }
  | { tipo: "formulario"; pacienteNome: string; campos: CampoAnamnese[] }
  | { tipo: "enviado" };

export default function AnamnesePage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [estado, setEstado] = useState<EstadoPagina>({ tipo: "carregando" });
  const [respostas, setRespostas] = useState<Record<string, string | boolean>>({});
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/anamnese/${token}`)
      .then((res) => {
        if (!res.ok) throw new Error("not_found");
        return res.json();
      })
      .then((data: { paciente_nome: string; tipo_formulario: "adulto" | "infantil"; respondido: boolean }) => {
        if (data.respondido) {
          setEstado({ tipo: "ja_respondido", pacienteNome: data.paciente_nome });
        } else {
          const campos = data.tipo_formulario === "infantil" ? CAMPOS_INFANTIL : CAMPOS_ADULTO;
          setEstado({ tipo: "formulario", pacienteNome: data.paciente_nome, campos });
        }
      })
      .catch(() => setEstado({ tipo: "erro", mensagem: "Link inválido ou não encontrado." }));
  }, [token]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEnviando(true);
    const res = await fetch(`${API_URL}/anamnese/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ respostas }),
    });
    setEnviando(false);
    if (res.ok) {
      setEstado({ tipo: "enviado" });
    }
  }

  if (estado.tipo === "carregando") {
    return (
      <TelaCentralizada>
        <p className="text-[14.5px] text-muted">Carregando...</p>
      </TelaCentralizada>
    );
  }

  if (estado.tipo === "erro") {
    return (
      <TelaCentralizada>
        <p className="text-[14.5px] text-muted">{estado.mensagem}</p>
      </TelaCentralizada>
    );
  }

  if (estado.tipo === "ja_respondido") {
    return (
      <TelaCentralizada>
        <p className="text-[15px] font-bold">
          Você já respondeu esse formulário. Obrigada, {estado.pacienteNome}!
        </p>
      </TelaCentralizada>
    );
  }

  if (estado.tipo === "enviado") {
    return (
      <TelaCentralizada>
        <p className="text-[15px] font-bold">Formulário enviado com sucesso. Obrigada!</p>
      </TelaCentralizada>
    );
  }

  const secoes = Array.from(new Set(estado.campos.map((c) => c.secao)));
  const campoNomeId = estado.campos[0].id;

  return (
    <div className="flex min-h-full flex-1 justify-center p-6">
      <div className="w-full max-w-[640px] rounded-3xl border border-border bg-card p-8 shadow-[0_10px_30px_var(--color-shadow)]">
        <h1 className="text-xl font-extrabold">Formulário de anamnese</h1>
        <p className="mt-1 text-[14px] text-muted">
          Olá, {estado.pacienteNome}! Preencha com calma — só o nome é obrigatório.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-6">
          {secoes.map((secao) => (
            <div key={secao}>
              <h2 className="mb-3 text-[13px] font-bold uppercase tracking-wide text-muted">{secao}</h2>
              <div className="flex flex-col gap-3">
                {estado.campos
                  .filter((c) => c.secao === secao)
                  .map((campo) => (
                    <CampoInput
                      key={campo.id}
                      campo={campo}
                      obrigatorio={campo.id === campoNomeId}
                      valor={respostas[campo.id]}
                      onChange={(valor) => setRespostas((r) => ({ ...r, [campo.id]: valor }))}
                    />
                  ))}
              </div>
            </div>
          ))}

          <button
            type="submit"
            disabled={enviando}
            className="rounded-xl bg-accent px-5 py-3 text-[14.5px] font-bold text-white transition-colors hover:bg-accent-dark disabled:opacity-60"
          >
            {enviando ? "Enviando..." : "Enviar formulário"}
          </button>
        </form>
      </div>
    </div>
  );
}

function TelaCentralizada({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 items-center justify-center p-6">
      <div className="w-full max-w-[440px] rounded-3xl border border-border bg-card p-10 text-center shadow-[0_10px_30px_var(--color-shadow)]">
        {children}
      </div>
    </div>
  );
}

function CampoInput({
  campo,
  obrigatorio,
  valor,
  onChange,
}: {
  campo: CampoAnamnese;
  obrigatorio: boolean;
  valor: string | boolean | undefined;
  onChange: (valor: string | boolean) => void;
}) {
  if (campo.tipo === "booleano") {
    return (
      <label className="flex items-center gap-2.5 text-[14px]">
        <input
          type="checkbox"
          checked={Boolean(valor)}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 shrink-0 accent-accent"
        />
        {campo.label}
      </label>
    );
  }

  const inputClass =
    "rounded-xl border-[1.5px] border-border bg-[var(--color-accent-soft)] px-3 py-2.5 text-[14.5px] outline-none focus:border-accent";

  return (
    <div className="flex flex-col">
      <label htmlFor={campo.id} className="mb-1.5 text-[13.5px] font-semibold">
        {campo.label}
      </label>
      {campo.tipo === "textarea" ? (
        <textarea
          id={campo.id}
          required={obrigatorio}
          rows={2}
          value={typeof valor === "string" ? valor : ""}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        />
      ) : (
        <input
          id={campo.id}
          type={campo.tipo === "data" ? "date" : "text"}
          required={obrigatorio}
          value={typeof valor === "string" ? valor : ""}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verificar tipo**

Run: `cd frontend && npx tsc --noEmit 2>&1 | grep -i "anamnese/\[token\]" || echo "sem erros"`
Expected: `sem erros`

- [ ] **Step 3: Commit**

```bash
git add "frontend/src/app/anamnese/[token]/page.tsx"
git commit -m "Adiciona página pública do formulário de anamnese"
```

---

### Task 10: Sub-aba "Anamneses" em Pacientes

**Files:**
- Modify: `frontend/src/components/PacientesTable.tsx`
- Modify: `frontend/src/app/(app)/pacientes/page.tsx`

- [ ] **Step 1: Adicionar o componente `AnamnesesCard` em `PacientesTable.tsx`**

Localizar o import no topo do arquivo:

```typescript
import {
  formatDataHoraBrasilia,
  iniciais,
  labelProcedimento,
  PROCEDIMENTOS,
  type ContatoBot,
  type Paciente,
} from "@/lib/format";
```

Substituir por:

```typescript
import {
  formatDataHoraBrasilia,
  iniciais,
  labelProcedimento,
  PROCEDIMENTOS,
  type AnamneseListaItem,
  type ContatoBot,
  type Paciente,
} from "@/lib/format";
```

Localizar o final do componente `ContatosCard` (fecha em `}` logo antes de `function PacientesCard({`). Adicionar logo depois:

```tsx
function AnamnesesCard({
  itens,
  onVer,
}: {
  itens: AnamneseListaItem[];
  onVer: (id: number) => void;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card shadow-[0_8px_24px_var(--color-shadow)]">
      <div className="border-b border-border p-6">
        <h2 className="text-[16px] font-bold">Anamneses de tDCS</h2>
        <p className="mt-1 text-[13px] text-muted">
          Pacientes com procedimento de estimulação/neuromodulação e o status do formulário.
        </p>
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {["Paciente", "Telefone", "Status", ""].map((col) => (
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
          {itens.map((item) => (
            <tr key={item.id}>
              <td className="border-b border-border px-6 py-4 text-[14.5px] font-bold last:border-0">
                {item.nome}
              </td>
              <td className="border-b border-border px-6 py-4 text-[14.5px] text-muted">
                {item.telefone}
              </td>
              <td className="border-b border-border px-6 py-4">
                <span
                  className={`inline-block rounded-full px-3 py-1 text-[12.5px] font-bold ${
                    item.respondido_em
                      ? "bg-accent-soft text-accent-dark"
                      : item.enviado_em
                        ? "bg-gold-soft text-gold"
                        : "bg-black/5 text-muted"
                  }`}
                >
                  {item.respondido_em
                    ? `Respondido em ${formatDataHoraBrasilia(item.respondido_em)}`
                    : item.enviado_em
                      ? "Aguardando resposta"
                      : "Não enviado"}
                </span>
              </td>
              <td className="border-b border-border px-6 py-4 text-right">
                {item.respondido_em && (
                  <button
                    type="button"
                    onClick={() => onVer(item.id)}
                    className="rounded-xl border border-border px-3 py-1.5 text-[13px] font-bold text-fg hover:bg-accent-soft"
                  >
                    Ver respostas
                  </button>
                )}
              </td>
            </tr>
          ))}
          {itens.length === 0 && (
            <tr>
              <td colSpan={4} className="px-6 py-8 text-center text-[14px] text-muted">
                Nenhum paciente com procedimento de estimulação cadastrado ainda.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Adicionar a aba nova e a prop `anamneses`**

Localizar a assinatura do componente principal:

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

Substituir por:

```tsx
export function PacientesTable({
  pacientes,
  contatos,
  anamneses,
  abaAtiva,
}: {
  pacientes: Paciente[];
  contatos: ContatoBot[];
  anamneses: AnamneseListaItem[];
  abaAtiva: "pacientes" | "contatos" | "anamneses";
}) {
```

Localizar (dentro do JSX, os dois `<Link>` de abas):

```tsx
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
```

Substituir por:

```tsx
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
        <Link
          href="/pacientes?aba=anamneses"
          className={`rounded-xl px-4 py-2 text-[13.5px] font-bold ${
            abaAtiva === "anamneses"
              ? "bg-accent text-white"
              : "border border-border bg-card text-fg"
          }`}
        >
          Anamneses
        </Link>
      </div>
```

Localizar:

```tsx
      {abaAtiva === "contatos" ? (
        <ContatosCard
          contatos={contatos}
          onCadastrar={(c) =>
            abrirCriacao({ nome: c.nome_whatsapp ?? "", telefone: c.telefone_paciente })
          }
        />
      ) : (
        <PacientesCard
          pacientes={pacientes}
          busca={busca}
          onBuscaChange={setBusca}
          onSelecionar={(p) => router.push(`/pacientes/${p.id}`)}
          onEditar={abrirEdicao}
        />
      )}
```

Substituir por:

```tsx
      {abaAtiva === "contatos" ? (
        <ContatosCard
          contatos={contatos}
          onCadastrar={(c) =>
            abrirCriacao({ nome: c.nome_whatsapp ?? "", telefone: c.telefone_paciente })
          }
        />
      ) : abaAtiva === "anamneses" ? (
        <AnamnesesCard itens={anamneses} onVer={(id) => router.push(`/pacientes/${id}`)} />
      ) : (
        <PacientesCard
          pacientes={pacientes}
          busca={busca}
          onBuscaChange={setBusca}
          onSelecionar={(p) => router.push(`/pacientes/${p.id}`)}
          onEditar={abrirEdicao}
        />
      )}
```

- [ ] **Step 3: Atualizar `page.tsx` pra buscar e passar `anamneses`**

Substituir o arquivo inteiro `frontend/src/app/(app)/pacientes/page.tsx` por:

```tsx
import { ThemeToggle } from "@/components/ThemeToggle";
import { PacientesTable } from "@/components/PacientesTable";
import { getContatosBot, getPacientes, getPacientesAnamnese } from "@/lib/api";

export default async function PacientesPage({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string }>;
}) {
  const { aba } = await searchParams;
  const abaAtiva = aba === "contatos" ? "contatos" : aba === "anamneses" ? "anamneses" : "pacientes";

  const [pacientes, contatos, anamneses] = await Promise.all([
    getPacientes(),
    getContatosBot(),
    getPacientesAnamnese(),
  ]);

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

      <PacientesTable
        pacientes={pacientes}
        contatos={contatos}
        anamneses={anamneses}
        abaAtiva={abaAtiva}
      />
    </div>
  );
}
```

- [ ] **Step 4: Verificar tipo**

Run: `cd frontend && npx tsc --noEmit 2>&1 | grep -iE "PacientesTable|pacientes/page" || echo "sem erros"`
Expected: `sem erros`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/PacientesTable.tsx "frontend/src/app/(app)/pacientes/page.tsx"
git commit -m "Adiciona sub-aba Anamneses em Pacientes"
```

---

### Task 11: Aba "Anamnese" na página do paciente

**Files:**
- Modify: `frontend/src/components/PacienteDetalhe.tsx`
- Modify: `frontend/src/app/(app)/pacientes/[id]/page.tsx`

- [ ] **Step 1: Atualizar imports e `ABAS`**

Localizar:

```tsx
import { ChatAssistente } from "@/components/ChatAssistente";
import {
  formatDataHoraBrasilia,
  iniciais,
  labelProcedimento,
  type Paciente,
  type SessaoHistorico,
} from "@/lib/format";

const ABAS = ["Visão geral", "Histórico de sessões", "Assistente IA"] as const;
```

Substituir por:

```tsx
import { ChatAssistente } from "@/components/ChatAssistente";
import { CAMPOS_ADULTO, CAMPOS_INFANTIL } from "@/lib/anamneseSchema";
import {
  formatDataHoraBrasilia,
  iniciais,
  labelProcedimento,
  type AnamneseDetalhe,
  type Paciente,
  type SessaoHistorico,
} from "@/lib/format";

const ABAS = ["Visão geral", "Histórico de sessões", "Anamnese", "Assistente IA"] as const;
```

- [ ] **Step 2: Adicionar a prop `anamnese`**

Localizar:

```tsx
export function PacienteDetalhe({
  paciente,
  sessoes,
}: {
  paciente: Paciente;
  sessoes: SessaoHistorico[];
}) {
```

Substituir por:

```tsx
export function PacienteDetalhe({
  paciente,
  sessoes,
  anamnese,
}: {
  paciente: Paciente;
  sessoes: SessaoHistorico[];
  anamnese: AnamneseDetalhe;
}) {
```

- [ ] **Step 3: Adicionar o conteúdo da aba**

Localizar o bloco `{aba === "Assistente IA" && (` (o último bloco de aba, antes do `</div>` de fechamento do componente). Adicionar **antes** dele:

```tsx
      {aba === "Anamnese" && (
        <div className="rounded-2xl border border-border bg-card p-6 shadow-[0_8px_24px_var(--color-shadow)]">
          {!anamnese ? (
            <p className="text-[14px] text-muted">Anamnese ainda não foi enviada pra esse paciente.</p>
          ) : !anamnese.respondido_em ? (
            <p className="text-[14px] text-muted">
              Formulário enviado em {formatDataHoraBrasilia(anamnese.enviado_em)}, aguardando resposta.
            </p>
          ) : (
            <>
              <p className="mb-5 text-[13px] text-muted">
                Respondido em {formatDataHoraBrasilia(anamnese.respondido_em)}
              </p>
              {Array.from(
                new Set(
                  (anamnese.tipo_formulario === "infantil" ? CAMPOS_INFANTIL : CAMPOS_ADULTO).map(
                    (c) => c.secao
                  )
                )
              ).map((secao) => (
                <div key={secao} className="mb-5 last:mb-0">
                  <h3 className="mb-2 text-[12.5px] font-bold uppercase tracking-wide text-muted">
                    {secao}
                  </h3>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {(anamnese.tipo_formulario === "infantil" ? CAMPOS_INFANTIL : CAMPOS_ADULTO)
                      .filter((c) => c.secao === secao)
                      .map((campo) => {
                        const valor = anamnese.respostas?.[campo.id];
                        if (valor === undefined || valor === "" || valor === null) return null;
                        return (
                          <div key={campo.id}>
                            <p className="text-[12px] font-bold text-muted">{campo.label}</p>
                            <p className="mt-0.5 text-[14px]">
                              {typeof valor === "boolean" ? (valor ? "Sim" : "Não") : valor}
                            </p>
                          </div>
                        );
                      })}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {aba === "Assistente IA" && (
```

(repare que a linha `{aba === "Assistente IA" && (` que já existia continua exatamente igual — só está sendo usada aqui como âncora de onde inserir o bloco novo antes dela)

- [ ] **Step 4: Atualizar `frontend/src/app/(app)/pacientes/[id]/page.tsx`**

Substituir o arquivo inteiro por:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PacienteDetalhe } from "@/components/PacienteDetalhe";
import { getAnamnesePaciente, getPaciente, getSessoesPaciente } from "@/lib/api";

export default async function PacienteDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const pacienteId = Number(id);

  let paciente;
  let sessoes;
  let anamnese;
  try {
    [paciente, sessoes, anamnese] = await Promise.all([
      getPaciente(pacienteId),
      getSessoesPaciente(pacienteId),
      getAnamnesePaciente(pacienteId),
    ]);
  } catch {
    notFound();
  }

  return (
    <div className="pl-12 md:pl-0">
      <div className="mb-5 flex items-center justify-between gap-5">
        <Link href="/pacientes" className="text-[13.5px] font-semibold text-muted hover:text-fg">
          ← Voltar pra Pacientes
        </Link>
        <ThemeToggle />
      </div>

      <PacienteDetalhe paciente={paciente} sessoes={sessoes} anamnese={anamnese} />
    </div>
  );
}
```

- [ ] **Step 5: Verificar tipo**

Run: `cd frontend && npx tsc --noEmit 2>&1 | grep -iE "PacienteDetalhe|pacientes/\[id\]" || echo "sem erros"`
Expected: `sem erros`

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/PacienteDetalhe.tsx "frontend/src/app/(app)/pacientes/[id]/page.tsx"
git commit -m "Adiciona aba Anamnese na página do paciente"
```

---

### Task 12 (orquestrador — não delegar a subagent): Deploy e verificação ao vivo

**Contexto:** Deploy exige SSH na VPS e credenciais da Vercel que só o orquestrador tem nessa sessão.

- [ ] **Step 1: Deploy do backend**

```bash
git push
ssh root@179.199.133.37 "cd /opt/app && git pull && docker compose up -d --build backend"
```
Expected: build sem erro; `curl -s -o /dev/null -w "%{http_code}\n" https://api.nexosystem.online/health` retorna `200`.

- [ ] **Step 2: Deploy do frontend**

```bash
cd frontend && vercel --prod --yes
```
Expected: deploy `READY`.

- [ ] **Step 3: Testar o fluxo completo com um paciente de teste**

1. Criar um paciente de teste (`tipo_procedimento='neuromodulacao'`, com email de teste real) direto no banco ou via API.
2. Chamar `anamnese.enviar_anamnese(...)` pra esse paciente (dentro do container, mesma técnica já usada nas features anteriores) e conferir que chega o link (verificar no email de teste, ou pelo menos conferir no banco que `anamnese_respostas` ganhou uma linha com `token` preenchido e `respondido_em` nulo).
3. Abrir `https://frontend-theta-weld-74.vercel.app/anamnese/{token}` no navegador (usando o token real gravado no banco) — conferir que carrega o formulário certo (infantil ou adulto, conforme a idade do paciente de teste), preencher alguns campos e enviar.
4. Conferir no banco que `anamnese_respostas.respostas` foi preenchido e `respondido_em` não é mais nulo.
5. Abrir o mesmo link de novo — conferir que mostra "você já respondeu" (não deixa reenviar).
6. Tentar `POST` direto no mesmo token via curl — conferir que retorna `409`.
7. Chamar `anamnese.enviar_anamnese(...)` de novo pro mesmo paciente — conferir que não manda nada (paciente já respondeu).
8. Conferir no painel (login real): a sub-aba "Anamneses" em Pacientes mostra esse paciente como "Respondido em ...", e a aba "Anamnese" dentro da página desse paciente mostra as respostas preenchidas, organizadas por seção.
9. Limpar os dados de teste (`DELETE FROM anamnese_respostas ...`, `DELETE FROM pacientes ...` pro paciente de teste).

Expected: fluxo completo funciona ponta a ponta, sem exceções nos logs (`docker logs app-backend-1 --since 10m`).
