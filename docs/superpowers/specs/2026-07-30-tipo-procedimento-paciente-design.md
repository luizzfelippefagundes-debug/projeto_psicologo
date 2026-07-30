# Tipo de procedimento no cadastro de paciente

## Contexto

A prática atende com procedimentos distintos (avaliação neuropsicológica, terapia,
reabilitação com/sem estimulação transcraniana, neuromodulação). Isso ainda não existe
no sistema — o cadastro de paciente (recém implementado) só tem `tipo_atendimento`
(individual/casal), que é uma dimensão diferente (quem participa da sessão, não qual
serviço é prestado).

## Escopo

**Dentro do escopo:**
- Campo `tipo_procedimento` no cadastro/edição de paciente, seleção única, obrigatório
  para pacientes novos.
- Coluna "Procedimento" na tabela de listagem de pacientes.

**Decisões explícitas (via brainstorming com o usuário):**
- 5 valores independentes, não 4 com sub-toggle:
  - Avaliação neuropsicológica
  - Terapia
  - Reabilitação com estimulação transcraniana
  - Reabilitação sem estimulação transcraniana
  - Neuromodulação
- Seleção única por paciente (não multi-select). Um paciente não pode estar em mais de
  um tipo de procedimento ao mesmo tempo, dentro deste escopo.
- Obrigatório na aplicação para cadastros novos e edições que alterem esse campo, mas
  **não** `NOT NULL` no banco — pacientes já existentes ficam com `NULL` até serem
  editados (evita quebrar dados atuais numa migração).

## Banco de dados

### Migração (rodar direto no Neon, não só editar `schema.sql`)

```sql
ALTER TABLE pacientes ADD COLUMN tipo_procedimento VARCHAR(60)
    CHECK (tipo_procedimento IN (
        'avaliacao_neuropsicologica',
        'terapia',
        'reabilitacao_com_estimulacao',
        'reabilitacao_sem_estimulacao',
        'neuromodulacao'
    ));
```

`schema.sql` (documento de referência do schema) precisa refletir essa coluna também,
para que um `CREATE TABLE` novo a partir do zero já saia correto.

## Backend (`backend/app/main.py`)

- Constante de módulo com os 5 valores válidos (usada na validação de `POST` e `PATCH`).
- `PacienteBody` ganha `tipo_procedimento: str` (obrigatório, sem default — request sem
  esse campo falha validação do Pydantic com 422).
- `PacienteUpdateBody` ganha `tipo_procedimento: str | None = None` (opcional, como os
  outros campos de update parcial).
- Validação explícita contra a lista de valores válidos em ambos os endpoints → 400 se
  fora da lista (mesmo padrão já usado para `tipo_atendimento` e `status`).
- `GET /pacientes`: `p.tipo_procedimento` incluído no `SELECT`.
- `INSERT`/`UPDATE` incluem a coluna (mesmo padrão `COALESCE` já usado no `PATCH`).

## Frontend

### `frontend/src/lib/format.ts`

- `Paciente.tipo_procedimento: string | null`.
- Nova constante exportada, na mesma linha de `DIAS_SEMANA`:

```typescript
export const PROCEDIMENTOS = [
  { value: "avaliacao_neuropsicologica", label: "Avaliação neuropsicológica" },
  { value: "terapia", label: "Terapia" },
  { value: "reabilitacao_com_estimulacao", label: "Reabilitação com estimulação transcraniana" },
  { value: "reabilitacao_sem_estimulacao", label: "Reabilitação sem estimulação transcraniana" },
  { value: "neuromodulacao", label: "Neuromodulação" },
];
```

### `frontend/src/components/PacientesTable.tsx`

- Nova coluna "Procedimento" na tabela, entre "Tipo" e "Próxima sessão". Mostra o
  `label` correspondente ao `value` salvo, ou "—" se `null` (paciente antigo ainda não
  editado).
- Novo campo no formulário (criação e edição): select "Tipo de procedimento", com uma
  primeira opção desabilitada "Selecione..." (mesmo padrão do select de paciente no
  `AgendaGrid.tsx`) para forçar escolha explícita — `required`.
- Ao editar um paciente que já tinha `tipo_procedimento = null`, o select abre na opção
  "Selecione..." (sem seleção), forçando o usuário a escolher antes de salvar (o
  `required` do HTML barra o submit até isso).

## Testes

Sem suíte automatizada (mesmo padrão do resto do projeto). Verificação manual:
- `curl`: criar paciente sem `tipo_procedimento` → 422 (Pydantic); criar com valor
  inválido → 400; criar com valor válido → 201; editar só esse campo → 200.
- Navegador: cadastrar paciente novo (campo obrigatório barra o submit vazio); editar
  paciente antigo sem valor prévio (mostra "—" na tabela, select abre em branco);
  confirmar coluna nova na tabela.
