# Pós-processamento com IA das gravações Plaud — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar três funcionalidades sob demanda em cima das gravações Plaud já recebidas: um
resumo curto gerado por IA ("texto pronto"), um mapa mental visual desenhado a partir do resumo que
já existe, e detecção de dados do paciente (nome/data de nascimento) pra pré-preencher o cadastro.

**Architecture:** Novo módulo `backend/app/ia.py` encapsula as duas chamadas à Claude API (Anthropic,
modelo `claude-haiku-4-5` — o mesmo já usado pelo bot do WhatsApp em `app/bot.py`, reaproveitando a
mesma `ANTHROPIC_API_KEY` já configurada em produção). Dois endpoints novos expõem essas chamadas sob
demanda. O mapa mental não usa IA nova — só uma biblioteca de renderização (Markmap) em cima do
`resumo` que já é salvo pelo webhook. No frontend, o card expandido de cada gravação em
`PlaudGravacoesLista.tsx` vira abas (Resumo / Texto pronto / Mapa mental / Transcrição) em vez de tudo
empilhado.

**Tech Stack:** FastAPI + asyncpg + `anthropic` SDK (Python, já em requirements.txt) no backend;
Next.js + `markmap-lib`/`markmap-view`/`d3` (novas dependências) no frontend.

**Convenção desta sessão:** trabalhar direto na `main`, sem worktree. **Nenhum subagente conecta em
produção** (nem SSH, nem banco de produção, nem chama a API da Anthropic com a chave real) — cada
task abaixo é verificada pelo subagente só com checagem estática (sintaxe/import). O orquestrador
(humano + Claude conduzindo o plano) roda as migrações de banco e os testes reais contra produção
pessoalmente, depois de cada task revisada.

---

### Task 1: Migração de banco — coluna `texto_curto`

**Files:**
- Create: `backend/scripts/adicionar_plaud_texto_curto.py`

- [ ] **Step 1: Escrever o script de migração**

Segue exatamente o padrão dos scripts existentes (`adicionar_plaud_titulo.py`, mesma pasta) — um
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, idempotente, feito pra rodar uma única vez contra produção.

```python
"""Adiciona plaud_gravacoes.texto_curto — resumo curto e corrido, gerado sob
demanda por IA (Claude Haiku) a partir da transcrição, pensado pra colar direto
nas observações da sessão em vez do resumo estruturado inteiro.

Rodar uma única vez direto contra o banco de produção:
    cd backend && .venv/bin/python3 scripts/adicionar_plaud_texto_curto.py
"""
import asyncio
import os

import asyncpg
from dotenv import load_dotenv

load_dotenv("../.env")


async def main():
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    await conn.execute("ALTER TABLE plaud_gravacoes ADD COLUMN IF NOT EXISTS texto_curto TEXT")
    print("Coluna texto_curto adicionada (ou já existia).")
    await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 2: Verificar sintaxe (sem conectar em nada)**

Run: `cd backend && .venv/bin/python3 -c "import ast; ast.parse(open('scripts/adicionar_plaud_texto_curto.py').read())"`
Expected: nenhuma saída (sem erro de sintaxe).

**NÃO rodar este script contra o banco — isso é feito pelo orquestrador depois que a task for revisada.**

- [ ] **Step 3: Atualizar `schema.sql`**

Troca, no `CREATE TABLE plaud_gravacoes` (~linha 104-115):

```sql
CREATE TABLE plaud_gravacoes (
    id SERIAL PRIMARY KEY,
    profissional_id INTEGER NOT NULL REFERENCES profissionais(id) ON DELETE CASCADE,
    sessao_id INTEGER REFERENCES sessoes(id) ON DELETE CASCADE, -- nulo até ser vinculada manualmente
    transcricao TEXT,
    resumo TEXT,
    titulo VARCHAR(255), -- título curto da gravação (campo "title" da Plaud), ajuda a reconhecer qual é qual
    gravado_em TIMESTAMPTZ, -- extraído do payload do Zapier quando disponível
    payload_bruto JSONB NOT NULL, -- corpo bruto recebido do Zapier, sempre guardado
    recebido_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    vinculado_em TIMESTAMPTZ
);
```

por:

```sql
CREATE TABLE plaud_gravacoes (
    id SERIAL PRIMARY KEY,
    profissional_id INTEGER NOT NULL REFERENCES profissionais(id) ON DELETE CASCADE,
    sessao_id INTEGER REFERENCES sessoes(id) ON DELETE CASCADE, -- nulo até ser vinculada manualmente
    transcricao TEXT,
    resumo TEXT,
    texto_curto TEXT, -- resumo curto gerado sob demanda por IA (Claude), a partir da transcrição
    titulo VARCHAR(255), -- título curto da gravação (campo "title" da Plaud), ajuda a reconhecer qual é qual
    gravado_em TIMESTAMPTZ, -- extraído do payload do Zapier quando disponível
    payload_bruto JSONB NOT NULL, -- corpo bruto recebido do Zapier, sempre guardado
    recebido_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    vinculado_em TIMESTAMPTZ
);
```

- [ ] **Step 4: Commit**

```bash
git add backend/scripts/adicionar_plaud_texto_curto.py schema.sql
git commit -m "Adiciona coluna plaud_gravacoes.texto_curto"
```

---

### Task 2: Módulo `backend/app/ia.py`

**Files:**
- Create: `backend/app/ia.py`

- [ ] **Step 1: Escrever o módulo**

```python
"""backend/app/ia.py
Chamadas de IA (Claude, Anthropic) usadas pra pós-processar gravações da Plaud sob
demanda — gerar um texto curto a partir da transcrição, e tentar identificar dados
do paciente nela. Reaproveita a mesma ANTHROPIC_API_KEY e o mesmo modelo já usados
pelo bot do WhatsApp (app/bot.py)."""
import json

import anthropic

from app.config import settings

MODELO = "claude-haiku-4-5"


async def gerar_texto_curto(transcricao: str) -> str:
    """Resume a transcrição de uma sessão num parágrafo corrido, sem títulos nem
    listas — pensado pra colar direto nas observações clínicas da sessão. Deixa
    anthropic.APIError propagar pro chamador (é uma ação sob demanda que a
    profissional pediu clicando um botão — ela precisa saber se não funcionou, ao
    invés da falha ser escondida)."""
    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    resposta = await client.messages.create(
        model=MODELO,
        max_tokens=512,
        system=(
            "Você resume transcrições de sessões de psicologia em um único parágrafo "
            "corrido, direto, em português, sem títulos, sem listas numeradas e sem "
            "formatação markdown — só texto pronto pra colar nas observações clínicas "
            "da sessão. Foque no que for clinicamente relevante. Não invente nada que "
            "não esteja na transcrição."
        ),
        messages=[{"role": "user", "content": transcricao}],
    )
    return "".join(bloco.text for bloco in resposta.content if bloco.type == "text").strip()


async def extrair_dados_paciente(transcricao: str) -> dict:
    """Tenta identificar nome e data de nascimento do PACIENTE (não de quem mais
    estiver falando na sessão, como um responsável) na transcrição. Sempre retorna
    {"nome": ..., "data_nascimento": ...} — cada campo None quando não tiver
    certeza. Nunca inventa dado que não esteja claramente dito no texto; se só o
    dia/mês da data de nascimento aparecer (sem o ano), data_nascimento fica None,
    já que uma data sem ano não é válida pro cadastro (PacienteBody.data_nascimento
    é um date completo)."""
    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    resposta = await client.messages.create(
        model=MODELO,
        max_tokens=256,
        system=(
            'Você identifica dados do PACIENTE (não de quem mais estiver falando na '
            'sessão, como um responsável) numa transcrição de sessão de psicologia. '
            'Responda APENAS com um JSON, sem nenhum texto antes ou depois, no formato '
            'exato {"nome": string ou null, "data_nascimento": string "YYYY-MM-DD" ou '
            'null}. Só preencha um campo se estiver claramente dito na transcrição — '
            'nunca invente ou deduza. Se só o dia e o mês da data de nascimento forem '
            "mencionados, sem o ano, deixe data_nascimento como null."
        ),
        messages=[{"role": "user", "content": transcricao}],
    )
    texto = "".join(bloco.text for bloco in resposta.content if bloco.type == "text").strip()
    try:
        dados = json.loads(texto)
    except json.JSONDecodeError:
        return {"nome": None, "data_nascimento": None}
    if not isinstance(dados, dict):
        return {"nome": None, "data_nascimento": None}
    return {
        "nome": dados.get("nome") if isinstance(dados.get("nome"), str) else None,
        "data_nascimento": dados.get("data_nascimento")
        if isinstance(dados.get("data_nascimento"), str)
        else None,
    }
```

- [ ] **Step 2: Verificar sintaxe e imports**

Run:
```bash
cd backend && .venv/bin/python3 -c "import ast; ast.parse(open('app/ia.py').read())"
cd backend && set -a && source ../.env 2>/dev/null; set +a && .venv/bin/python3 -c "from app import ia; print(ia.MODELO)"
```
Expected: `import ast` não gera erro; o segundo comando imprime `claude-haiku-4-5` (confirma que o
módulo importa sem erro — não faz nenhuma chamada de rede aqui, `AsyncAnthropic` só é instanciado
dentro das funções).

**NÃO chamar `gerar_texto_curto` nem `extrair_dados_paciente` de verdade nesta task — isso gastaria a
API key real. Essa verificação é feita pelo orquestrador depois.**

- [ ] **Step 3: Commit**

```bash
git add backend/app/ia.py
git commit -m "Adiciona módulo de IA pra pós-processar gravações Plaud"
```

---

### Task 3: `backend/app/plaud.py` — salvar texto curto e preferir ele ao vincular

**Files:**
- Modify: `backend/app/plaud.py`

- [ ] **Step 1: Adicionar `texto_curto` ao SELECT de `obter_gravacao`**

Troca (função `obter_gravacao`, ~linha 137-144):

```python
async def obter_gravacao(profissional_id: int, gravacao_id: int) -> dict | None:
    async with db.pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, sessao_id, transcricao, resumo, titulo, gravado_em, recebido_em "
            "FROM plaud_gravacoes WHERE id = $1 AND profissional_id = $2",
            gravacao_id, profissional_id,
        )
    return dict(row) if row else None
```

por:

```python
async def obter_gravacao(profissional_id: int, gravacao_id: int) -> dict | None:
    async with db.pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, sessao_id, transcricao, resumo, texto_curto, titulo, gravado_em, recebido_em "
            "FROM plaud_gravacoes WHERE id = $1 AND profissional_id = $2",
            gravacao_id, profissional_id,
        )
    return dict(row) if row else None
```

- [ ] **Step 2: Adicionar `g.texto_curto` ao SELECT de `listar_todas`**

Troca (função `listar_todas`, dentro do `conn.fetch`):

```python
            SELECT g.id, g.titulo, g.resumo, g.transcricao, g.gravado_em, g.recebido_em,
                   g.sessao_id, p.nome AS paciente_nome, s.data_hora AS sessao_data_hora
```

por:

```python
            SELECT g.id, g.titulo, g.resumo, g.texto_curto, g.transcricao, g.gravado_em, g.recebido_em,
                   g.sessao_id, p.nome AS paciente_nome, s.data_hora AS sessao_data_hora
```

- [ ] **Step 3: Adicionar `salvar_texto_curto`**

Nova função, logo depois de `obter_gravacao` (fim do arquivo):

```python
async def salvar_texto_curto(profissional_id: int, gravacao_id: int, texto_curto: str) -> bool:
    """Salva (ou regenera, sobrescrevendo) o texto curto de uma gravação. Retorna
    False se a gravação não existe/não pertence a essa profissional."""
    async with db.pool.acquire() as conn:
        resultado = await conn.execute(
            "UPDATE plaud_gravacoes SET texto_curto = $1 WHERE id = $2 AND profissional_id = $3",
            texto_curto, gravacao_id, profissional_id,
        )
    return resultado == "UPDATE 1"
```

- [ ] **Step 4: `vincular_a_sessao` passa a preferir `texto_curto`**

Troca (dentro de `vincular_a_sessao`):

```python
            gravacao = await conn.fetchrow(
                "SELECT id, resumo FROM plaud_gravacoes WHERE id = $1 AND profissional_id = $2",
                gravacao_id, profissional_id,
            )
```

por:

```python
            gravacao = await conn.fetchrow(
                "SELECT id, resumo, texto_curto FROM plaud_gravacoes WHERE id = $1 AND profissional_id = $2",
                gravacao_id, profissional_id,
            )
```

E troca:

```python
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
```

por:

```python
            # Prefere o texto curto (gerado sob demanda) sobre o resumo estruturado
            # inteiro — é o que efetivamente vai pras observações da sessão.
            texto_para_observacoes = gravacao["texto_curto"] or gravacao["resumo"]
            if texto_para_observacoes:
                observacoes_atuais = await conn.fetchval(
                    "SELECT observacoes FROM sessoes WHERE id = $1", sessao_id
                )
                # Remove um bloco de resumo automático anterior (se essa sessão já teve
                # outra gravação vinculada antes), preservando o texto que ela escreveu
                # por conta própria antes e depois desse bloco.
                marcador = "\n\n— Resumo automático (Plaud) —\n"
                texto_base = (observacoes_atuais or "").split(marcador)[0].rstrip()
                novo_texto = f"{texto_base}{marcador}{texto_para_observacoes}" if texto_base else (
                    f"— Resumo automático (Plaud) —\n{texto_para_observacoes}"
                )
                await conn.execute(
                    "UPDATE sessoes SET observacoes = $1 WHERE id = $2", novo_texto, sessao_id
                )
```

- [ ] **Step 5: Verificar sintaxe**

Run: `cd backend && .venv/bin/python3 -c "import ast; ast.parse(open('app/plaud.py').read())"`
Expected: nenhuma saída.

- [ ] **Step 6: Commit**

```bash
git add backend/app/plaud.py
git commit -m "plaud.py: salva texto curto e prefere ele ao montar observações da sessão"
```

---

### Task 4: Endpoints novos em `backend/app/main.py`

**Files:**
- Modify: `backend/app/main.py`

- [ ] **Step 1: Importar `anthropic` e `ia`**

Troca a linha de import (linha 12-16, área de imports):

```python
from google import genai
from google.genai import types as genai_types
from pydantic import BaseModel, EmailStr

from app import agendamento_publico, anamnese, auth, bot, db, evolution, google_calendar, lembretes, notificacoes, plaud, reservas
```

por:

```python
import anthropic
from google import genai
from google.genai import types as genai_types
from pydantic import BaseModel, EmailStr

from app import agendamento_publico, anamnese, auth, bot, db, evolution, google_calendar, ia, lembretes, notificacoes, plaud, reservas
```

- [ ] **Step 2: Adicionar os dois endpoints novos**

Logo depois do endpoint `vincular_gravacao_plaud` (depois da linha `return {"status": "vinculada"}`,
antes de `@app.get("/sessoes/dias")`):

```python
@app.post("/plaud/gravacoes/{gravacao_id}/texto-curto")
async def gerar_texto_curto_plaud(
    gravacao_id: int, profissional_id: int = Depends(auth.get_current_profissional_id)
):
    if not settings.anthropic_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="IA ainda não está configurada (falta a chave da API da Anthropic).",
        )
    gravacao = await plaud.obter_gravacao(profissional_id, gravacao_id)
    if gravacao is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gravação não encontrada")
    if not gravacao["transcricao"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Essa gravação ainda não tem transcrição"
        )
    try:
        texto_curto = await ia.gerar_texto_curto(gravacao["transcricao"])
    except anthropic.APIError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Não foi possível gerar o texto agora, tenta de novo",
        )
    await plaud.salvar_texto_curto(profissional_id, gravacao_id, texto_curto)
    return {"texto_curto": texto_curto}


@app.post("/plaud/gravacoes/{gravacao_id}/extrair-paciente")
async def extrair_dados_paciente_plaud(
    gravacao_id: int, profissional_id: int = Depends(auth.get_current_profissional_id)
):
    if not settings.anthropic_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="IA ainda não está configurada (falta a chave da API da Anthropic).",
        )
    gravacao = await plaud.obter_gravacao(profissional_id, gravacao_id)
    if gravacao is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gravação não encontrada")
    if not gravacao["transcricao"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Essa gravação ainda não tem transcrição"
        )
    try:
        return await ia.extrair_dados_paciente(gravacao["transcricao"])
    except anthropic.APIError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Não foi possível analisar agora, tenta de novo",
        )
```

- [ ] **Step 3: Verificar sintaxe e import (sem tocar banco/rede)**

Run:
```bash
cd backend && .venv/bin/python3 -c "import ast; ast.parse(open('app/main.py').read())"
cd backend && set -a && source ../.env 2>/dev/null; set +a && .venv/bin/python3 -c "import app.main"
```
Expected: ambos sem erro (o segundo comando importa o app inteiro — pega qualquer erro de referência
a nome não definido, mas não abre conexão de banco nem chama a Anthropic, já que isso só acontece
dentro de handlers de requisição).

**NÃO chamar esses endpoints de verdade (nem via curl local, nem contra produção) nesta task — isso é
feito pelo orquestrador depois.**

- [ ] **Step 4: Commit**

```bash
git add backend/app/main.py
git commit -m "Adiciona endpoints de texto curto e extração de dados do paciente (Plaud + IA)"
```

---

### Task 5: Dependências frontend + tipo + `MapaMentalPlaud.tsx`

**Files:**
- Modify: `frontend/package.json` (via npm install)
- Modify: `frontend/src/lib/api.ts`
- Create: `frontend/src/components/MapaMentalPlaud.tsx`

- [ ] **Step 1: Instalar as dependências**

Run: `cd frontend && npm install markmap-lib markmap-view d3 && npm install -D @types/d3`
Expected: instala sem erro, `package.json` e `package-lock.json` atualizados.

- [ ] **Step 2: Adicionar `texto_curto` ao tipo `PlaudGravacaoLista`**

Em `frontend/src/lib/api.ts`, troca:

```typescript
export type PlaudGravacaoLista = {
  id: number;
  titulo: string | null;
  resumo: string | null;
  transcricao: string | null;
  gravado_em: string | null;
  recebido_em: string;
  sessao_id: number | null;
  paciente_nome: string | null;
  sessao_data_hora: string | null;
};
```

por:

```typescript
export type PlaudGravacaoLista = {
  id: number;
  titulo: string | null;
  resumo: string | null;
  texto_curto: string | null;
  transcricao: string | null;
  gravado_em: string | null;
  recebido_em: string;
  sessao_id: number | null;
  paciente_nome: string | null;
  sessao_data_hora: string | null;
};
```

- [ ] **Step 3: Criar `MapaMentalPlaud.tsx`**

API confirmada em `markmap-view@0.18.12` (`Markmap.create(svg, opts?, data?)`, com métodos de
instância `destroy(): void` e `fit(maxScale?): Promise<void>`):

```tsx
"use client";

import { useEffect, useRef } from "react";
import { Transformer } from "markmap-lib";
import { Markmap } from "markmap-view";

const transformer = new Transformer();

export function MapaMentalPlaud({ texto }: { texto: string }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current) return;
    const { root } = transformer.transform(texto);
    const mm = Markmap.create(svgRef.current, undefined, root);
    mm.fit();
    return () => {
      mm.destroy();
    };
  }, [texto]);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-white">
      <svg ref={svgRef} className="h-[420px] w-full" />
    </div>
  );
}
```

O fundo fica fixo em branco (`bg-white`) mesmo no tema escuro do site — o Markmap desenha texto
escuro por padrão, e não vale a pena reconfigurar a paleta de cores dele pra um componente que é só
visualização.

- [ ] **Step 4: Verificar tipos**

Run: `cd frontend && npx tsc --noEmit`
Expected: nenhuma saída (sem erro de tipo).

- [ ] **Step 5: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/lib/api.ts frontend/src/components/MapaMentalPlaud.tsx
git commit -m "Adiciona markmap e componente de mapa mental visual pro resumo Plaud"
```

---

### Task 6: Abas no card de gravação (`PlaudGravacoesLista.tsx`)

**Files:**
- Modify: `frontend/src/components/PlaudGravacoesLista.tsx`

- [ ] **Step 1: Reescrever o arquivo inteiro**

Mantém `agruparPorPaciente`, `CHAVE_SEM_VINCULO` e o componente principal `PlaudGravacoesLista`
exatamente como estão hoje — só o componente `GravacaoCard` muda, pra ganhar abas e as duas ações
novas. Conteúdo completo do arquivo:

```tsx
"use client";

import { useState } from "react";
import { ChevronDown, Folder, FolderOpen } from "lucide-react";
import type { PlaudGravacaoLista } from "@/lib/api";
import { formatDataHoraBrasilia } from "@/lib/format";
import { MarkdownTexto, textoSimples } from "@/components/MarkdownTexto";
import { TranscricaoChat } from "@/components/TranscricaoChat";
import { MapaMentalPlaud } from "@/components/MapaMentalPlaud";

const API_URL = "/api"; // passa pelo rewrite do Next.js — cookie de sessão nasce no domínio do site
const CHAVE_SEM_VINCULO = "__sem_vinculo__";

type Grupo = { chave: string; nome: string; gravacoes: PlaudGravacaoLista[] };
type Aba = "resumo" | "texto" | "mapa" | "transcricao";
type DadosPaciente = { nome: string | null; data_nascimento: string | null };

const ABAS: [Aba, string][] = [
  ["resumo", "Resumo"],
  ["texto", "Texto pronto"],
  ["mapa", "Mapa mental"],
  ["transcricao", "Transcrição"],
];

function agruparPorPaciente(gravacoes: PlaudGravacaoLista[]): Grupo[] {
  const mapa = new Map<string, Grupo>();
  for (const g of gravacoes) {
    const chave = g.paciente_nome ?? CHAVE_SEM_VINCULO;
    if (!mapa.has(chave)) {
      mapa.set(chave, { chave, nome: g.paciente_nome ?? "Não vinculadas", gravacoes: [] });
    }
    mapa.get(chave)!.gravacoes.push(g);
  }
  // gravacoes já chega ordenada por mais recente primeiro — preserva essa ordem entre
  // pastas (paciente com gravação mais recente aparece primeiro), só a pasta "Não
  // vinculadas" vai sempre pro topo por precisar de ação.
  return [...mapa.values()].sort((a, b) =>
    a.chave === CHAVE_SEM_VINCULO ? -1 : b.chave === CHAVE_SEM_VINCULO ? 1 : 0
  );
}

function AcaoDetectarPaciente({ gravacaoId, temTranscricao }: { gravacaoId: number; temTranscricao: boolean }) {
  const [dados, setDados] = useState<DadosPaciente | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function detectar() {
    setCarregando(true);
    setErro(null);
    const res = await fetch(`${API_URL}/plaud/gravacoes/${gravacaoId}/extrair-paciente`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErro(data.detail ?? "Não foi possível analisar agora, tenta de novo.");
      setCarregando(false);
      return;
    }
    setDados(await res.json());
    setCarregando(false);
  }

  if (dados) {
    if (!dados.nome) {
      return (
        <div className="rounded-xl bg-black/5 p-3.5 text-[13.5px] text-muted">
          Não conseguimos identificar automaticamente.{" "}
          <a href="/pacientes" className="font-semibold text-accent-dark hover:underline">
            Cadastrar manualmente
          </a>
        </div>
      );
    }
    const params = new URLSearchParams({ prefill_nome: dados.nome });
    if (dados.data_nascimento) params.set("prefill_nascimento", dados.data_nascimento);
    return (
      <div className="rounded-xl bg-accent-soft p-3.5 text-[13.5px]">
        <p className="font-bold text-fg">
          {dados.nome}
          {dados.data_nascimento ? ` · nascido em ${dados.data_nascimento}` : ""}
        </p>
        <a
          href={`/pacientes?${params.toString()}`}
          className="mt-2 inline-block rounded-xl bg-accent px-3.5 py-2 text-[13px] font-bold text-white hover:bg-accent-dark"
        >
          Usar esses dados pra criar cadastro
        </a>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={detectar}
        disabled={carregando || !temTranscricao}
        className="rounded-xl border border-border px-3.5 py-2 text-[13px] font-bold text-muted hover:bg-accent-soft hover:text-fg disabled:opacity-60"
      >
        {carregando ? "Analisando..." : "Detectar dados do paciente"}
      </button>
      {erro && <p className="mt-2 text-[13px] font-semibold text-red-600">{erro}</p>}
    </div>
  );
}

function GravacaoCard({ g, aberto, onToggle }: { g: PlaudGravacaoLista; aberto: boolean; onToggle: () => void }) {
  const [aba, setAba] = useState<Aba>("resumo");
  const [textoCurto, setTextoCurto] = useState(g.texto_curto);
  const [gerando, setGerando] = useState(false);
  const [erroTexto, setErroTexto] = useState<string | null>(null);

  const rotulo =
    g.titulo || (g.gravado_em ? formatDataHoraBrasilia(g.gravado_em) : formatDataHoraBrasilia(g.recebido_em));

  async function gerarTextoCurto() {
    setGerando(true);
    setErroTexto(null);
    const res = await fetch(`${API_URL}/plaud/gravacoes/${g.id}/texto-curto`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErroTexto(data.detail ?? "Não foi possível gerar o texto agora, tenta de novo.");
      setGerando(false);
      return;
    }
    const data: { texto_curto: string } = await res.json();
    setTextoCurto(data.texto_curto);
    setGerando(false);
  }

  return (
    <li className="rounded-2xl border border-border bg-card shadow-[0_8px_24px_var(--color-shadow)]">
      <button type="button" onClick={onToggle} className="flex w-full items-start justify-between gap-4 p-5 text-left">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14.5px] font-bold">{rotulo}</div>
          <div className="mt-1 text-[12.5px] text-muted">
            {g.gravado_em ? formatDataHoraBrasilia(g.gravado_em) : formatDataHoraBrasilia(g.recebido_em)}
          </div>
          {!aberto && (
            <div className="mt-2 truncate text-[13.5px] text-muted">
              {g.resumo ? textoSimples(g.resumo) : "Sem resumo disponível."}
            </div>
          )}
        </div>
      </button>

      {aberto && (
        <div className="border-t border-border p-5 pt-4">
          <div className="mb-4 flex gap-1.5 overflow-x-auto">
            {ABAS.map(([valor, label]) => (
              <button
                key={valor}
                type="button"
                onClick={() => setAba(valor)}
                className={`shrink-0 whitespace-nowrap rounded-xl px-3.5 py-2 text-[13px] font-bold ${
                  aba === valor ? "bg-accent text-white" : "border border-border bg-card text-muted"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {aba === "resumo" &&
            (g.resumo ? <MarkdownTexto texto={g.resumo} /> : <p className="text-[13.5px] text-muted">Sem resumo disponível.</p>)}

          {aba === "texto" && (
            <div>
              {textoCurto ? (
                <>
                  <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-muted">{textoCurto}</p>
                  <button
                    type="button"
                    onClick={gerarTextoCurto}
                    disabled={gerando}
                    className="mt-3 text-[13px] font-semibold text-accent-dark hover:underline disabled:opacity-60"
                  >
                    {gerando ? "Gerando..." : "Gerar de novo"}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={gerarTextoCurto}
                  disabled={gerando || !g.transcricao}
                  className="rounded-xl bg-accent px-4 py-2.5 text-[13.5px] font-bold text-white hover:bg-accent-dark disabled:opacity-60"
                >
                  {gerando ? "Gerando..." : "Gerar texto pronto"}
                </button>
              )}
              {!g.transcricao && !textoCurto && (
                <p className="mt-2 text-[12.5px] text-muted">Essa gravação ainda não tem transcrição.</p>
              )}
              {erroTexto && <p className="mt-2 text-[13px] font-semibold text-red-600">{erroTexto}</p>}
            </div>
          )}

          {aba === "mapa" &&
            (g.resumo ? (
              <MapaMentalPlaud texto={g.resumo} />
            ) : (
              <p className="text-[13.5px] text-muted">Sem resumo disponível pra desenhar o mapa mental.</p>
            ))}

          {aba === "transcricao" &&
            (g.transcricao ? (
              <TranscricaoChat texto={g.transcricao} />
            ) : (
              <p className="text-[13.5px] text-muted">Sem transcrição disponível.</p>
            ))}

          {!g.sessao_id && (
            <div className="mt-5 border-t border-border pt-4">
              <AcaoDetectarPaciente gravacaoId={g.id} temTranscricao={!!g.transcricao} />
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function PlaudGravacoesLista({ gravacoes }: { gravacoes: PlaudGravacaoLista[] }) {
  const [expandidoId, setExpandidoId] = useState<number | null>(null);
  const [pastasAbertas, setPastasAbertas] = useState<Set<string>>(new Set());

  if (gravacoes.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-[0_8px_24px_var(--color-shadow)]">
        <p className="text-[14px] text-muted">
          Nenhuma gravação recebida ainda. Configure o Zap no Zapier (Configurações → Plaud) pra elas
          aparecerem aqui.
        </p>
      </div>
    );
  }

  const grupos = agruparPorPaciente(gravacoes);

  function alternarPasta(chave: string) {
    setPastasAbertas((atual) => {
      const nova = new Set(atual);
      if (nova.has(chave)) nova.delete(chave);
      else nova.add(chave);
      return nova;
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {grupos.map((grupo) => {
        const pastaAberta = pastasAbertas.has(grupo.chave);
        const semVinculo = grupo.chave === CHAVE_SEM_VINCULO;

        return (
          <div key={grupo.chave} className="rounded-2xl border border-border bg-card shadow-[0_8px_24px_var(--color-shadow)]">
            <button
              type="button"
              onClick={() => alternarPasta(grupo.chave)}
              className="flex w-full items-center gap-3 p-5 text-left"
            >
              {pastaAberta ? (
                <FolderOpen className="h-[18px] w-[18px] shrink-0 text-accent" strokeWidth={2} />
              ) : (
                <Folder className="h-[18px] w-[18px] shrink-0 text-accent" strokeWidth={2} />
              )}
              <span className={`flex-1 truncate text-[14.5px] font-bold ${semVinculo ? "text-muted" : ""}`}>
                {grupo.nome}
              </span>
              <span className="shrink-0 rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-bold text-accent-dark">
                {grupo.gravacoes.length}
              </span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-muted transition-transform ${pastaAberta ? "rotate-180" : ""}`}
                strokeWidth={2}
              />
            </button>

            {pastaAberta && (
              <ul className="flex flex-col gap-3 border-t border-border p-5 pt-4">
                {grupo.gravacoes.map((g) => (
                  <GravacaoCard
                    key={g.id}
                    g={g}
                    aberto={expandidoId === g.id}
                    onToggle={() => setExpandidoId(expandidoId === g.id ? null : g.id)}
                  />
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Verificar tipos**

Run: `cd frontend && npx tsc --noEmit`
Expected: nenhuma saída.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/PlaudGravacoesLista.tsx
git commit -m "PlaudGravacoesLista: abas (Resumo/Texto pronto/Mapa mental/Transcrição) + detectar paciente"
```

---

### Task 7: Pré-preencher cadastro de paciente a partir da Plaud

**Files:**
- Modify: `frontend/src/components/PacientesTable.tsx`
- Modify: `frontend/src/app/(app)/pacientes/page.tsx`

- [ ] **Step 1: `PacientesTable.tsx` — importar `useEffect` e aceitar prop de prefill**

Troca a linha de import (linha 5):

```typescript
import { useState } from "react";
```

por:

```typescript
import { useEffect, useState } from "react";
```

- [ ] **Step 2: Estender `abrirCriacao` pra aceitar `dataNascimento`**

Troca:

```typescript
  function abrirCriacao(prefill?: { nome: string; telefone: string }) {
    setPacienteEditando(null);
    setForm(prefill ? { ...formStateVazio(), ...prefill } : formStateVazio());
    setErro(null);
    setModalAberto(true);
  }
```

por:

```typescript
  function abrirCriacao(prefill?: { nome?: string; telefone?: string; dataNascimento?: string }) {
    setPacienteEditando(null);
    setForm(prefill ? { ...formStateVazio(), ...prefill } : formStateVazio());
    setErro(null);
    setModalAberto(true);
  }
```

- [ ] **Step 3: Aceitar a prop `prefillNovoPaciente` e abrir o modal sozinho no carregamento**

Troca a assinatura do componente:

```typescript
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

por:

```typescript
export function PacientesTable({
  pacientes,
  contatos,
  anamneses,
  abaAtiva,
  prefillNovoPaciente,
}: {
  pacientes: Paciente[];
  contatos: ContatoBot[];
  anamneses: AnamneseListaItem[];
  abaAtiva: "pacientes" | "contatos" | "anamneses";
  prefillNovoPaciente?: { nome?: string; dataNascimento?: string };
}) {
```

E logo depois da declaração dos `useState` (antes de `function abrirCriacao`), adiciona:

```typescript
  useEffect(() => {
    if (prefillNovoPaciente) {
      abrirCriacao(prefillNovoPaciente);
    }
    // roda só uma vez, no carregamento — abrirCriacao muda a cada render mas não
    // precisa disparar o efeito de novo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

(Segue o mesmo padrão de `// eslint-disable-next-line react-hooks/exhaustive-deps` já usado em
`frontend/src/components/PerfilPaciente.tsx`.)

- [ ] **Step 4: `pacientes/page.tsx` — ler os query params novos e repassar**

Conteúdo completo do arquivo:

```tsx
import { ThemeToggle } from "@/components/ThemeToggle";
import { PacientesTable } from "@/components/PacientesTable";
import { getContatosBot, getPacientes, getPacientesAnamnese } from "@/lib/api";

export default async function PacientesPage({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string; prefill_nome?: string; prefill_nascimento?: string }>;
}) {
  const { aba, prefill_nome, prefill_nascimento } = await searchParams;
  const abaAtiva = aba === "contatos" ? "contatos" : aba === "anamneses" ? "anamneses" : "pacientes";
  const prefillNovoPaciente = prefill_nome
    ? { nome: prefill_nome, dataNascimento: prefill_nascimento }
    : undefined;

  const [pacientes, contatos, anamneses] = await Promise.all([
    getPacientes(),
    getContatosBot(),
    getPacientesAnamnese(),
  ]);

  return (
    <div>
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
        prefillNovoPaciente={prefillNovoPaciente}
      />
    </div>
  );
}
```

- [ ] **Step 5: Verificar tipos**

Run: `cd frontend && npx tsc --noEmit`
Expected: nenhuma saída.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/PacientesTable.tsx "frontend/src/app/(app)/pacientes/page.tsx"
git commit -m "Pré-preenche cadastro de paciente a partir de dados detectados na Plaud"
```

---

## Depois de todas as tasks (orquestrador, não subagente)

1. Rodar `backend/scripts/adicionar_plaud_texto_curto.py` contra produção (`.venv/bin/python3
   scripts/adicionar_plaud_texto_curto.py`).
2. Deploy do backend (`git push` → SSH → `git pull && docker compose up -d --build backend` →
   `curl .../health`) e do frontend (`git push` → `cd frontend && vercel --prod --yes`).
3. Teste real contra produção, usando a gravação do Lucas já existente:
   - `POST /plaud/gravacoes/{id}/texto-curto` — conferir que o texto sai curto e coerente, e que
     `plaud_gravacoes.texto_curto` foi salvo.
   - Vincular essa gravação a uma sessão e conferir que `sessoes.observacoes` recebeu o texto curto,
     não o resumo inteiro.
   - Abrir a aba "Plaud" no navegador, expandir a gravação, checar a aba "Mapa mental" — árvore deve
     bater com as seções do resumo.
   - Rodar "Detectar dados do paciente" numa gravação de teste sem paciente vinculado (criar uma nova
     via curl simulando o webhook, com uma transcrição de teste contendo um nome claro) e conferir que
     os dados batem, que o link "Usar esses dados" abre `/pacientes` com o formulário pré-preenchido,
     e que nada foi salvo no banco até o formulário ser enviado manualmente.
   - Limpar a gravação de teste depois.

## Self-Review

**Cobertura da spec:** texto pronto (Tasks 1-4, 6) ✓; mapa mental visual (Task 5-6) ✓; detectar dados
+ pré-preencher cadastro (Tasks 4, 6-7) ✓; abas no card (Task 6) ✓; vincular prefere texto_curto
(Task 3) ✓; erros 503/502/400 (Task 4) ✓.

**Escopo reduzido conscientemente:** a spec original mencionava "o modal de vincular em
AgendaList.tsx" junto com o card expandido. Na prática, o modal de vincular em `AgendaList.tsx` é uma
lista compacta de seleção (não um card expandido por gravação como em `PlaudGravacoesLista.tsx`) — não
faz sentido colocar abas ali. As três funcionalidades novas (texto pronto, mapa mental, detectar
paciente) ficam só na aba dedicada `/plaud`, que é onde elas fazem sentido de verdade; o toggle "Ver
transcrição" que já existe dentro da edição de sessão em `AgendaList.tsx` fica como está.
