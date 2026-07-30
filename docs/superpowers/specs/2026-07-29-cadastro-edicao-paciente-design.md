# Cadastro e edição de paciente

## Contexto

O painel hoje só lista pacientes (`GET /pacientes`). Criar ou editar um paciente só é
possível via API/SQL direto. Este spec fecha essa lacuna do CRUD básico, seguindo os
padrões já estabelecidos no painel (modal de criar/editar como em `AgendaGrid.tsx`,
formulários como em `NovoLocalForm.tsx`).

## Escopo

**Dentro do escopo:**
- Criar paciente (nome, telefone, email, tipo de atendimento).
- Editar paciente (mesmos campos + status ativo/inativo).
- Modal único reaproveitado para criação e edição, no mesmo estilo do `AgendaGrid.tsx`.

**Fora do escopo (decisão explícita):**
- Checkbox de consentimento LGPD no formulário — mesmo a coluna `consentimento_lgpd`
  existindo no banco, fica para uma spec futura.
- Exclusão permanente de paciente — só toggle de status ativo/inativo (soft-delete).
  Motivo: `sessoes.paciente_id` tem `ON DELETE CASCADE`; excluir um paciente de verdade
  apagaria o histórico de sessões dele junto.

## Backend (`backend/app/main.py`)

### `POST /pacientes` (201)

```python
class PacienteBody(BaseModel):
    nome: str
    telefone: str
    email: str | None = None
    tipo_atendimento: str = "individual"
```

- Valida `tipo_atendimento in ('individual', 'casal')` → 400 se inválido.
- `INSERT INTO pacientes (profissional_id, nome, telefone, email, tipo_atendimento) ...`
- Captura `asyncpg.exceptions.UniqueViolationError` (constraint `UNIQUE (profissional_id, telefone)`)
  → 409 com detail "Já existe um paciente com esse telefone".
- Retorna o paciente criado (id, nome, telefone, email, tipo_atendimento, status, criado_em).

### `PATCH /pacientes/{id}`

```python
class PacienteUpdateBody(BaseModel):
    nome: str | None = None
    telefone: str | None = None
    email: str | None = None
    tipo_atendimento: str | None = None
    status: str | None = None
```

- Confere que o paciente pertence ao `profissional_id` da sessão (senão 404), mesmo
  padrão de `_validar_paciente_e_local`.
- Valida `tipo_atendimento` (se informado) e `status` (se informado, `in ('ativo', 'inativo')`)
  → 400 se inválido.
- Update dinâmico só dos campos informados (mesmo padrão do `PATCH /sessoes/{id}` existente).
- Mesmo tratamento de `UniqueViolationError` → 409.

### Ajuste em `GET /pacientes`

Adicionar `p.email` ao SELECT existente — hoje não vem, e o modal de edição precisa
pré-preencher esse campo.

## Frontend

### `frontend/src/lib/format.ts`

`Paciente` ganha `email: string | null`.

### `frontend/src/components/PacientesTable.tsx`

Mesmo arquivo (a página `pacientes/page.tsx` não muda o import), passa a ser dono do
fluxo completo de listar + criar + editar, no mesmo espírito do `AgendaGrid.tsx`:

- Estado local: `modalAberto`, `pacienteEditando: Paciente | null`, `form`, `erro`, `salvando`.
- Botão "+ Novo paciente" acima da tabela (mesma posição/estilo do "+ Nova sessão" na agenda)
  → abre modal vazio.
- Clique numa linha da tabela → abre modal pré-preenchido com os dados do paciente.
- Modal (componente `Modal.tsx` existente) com campos:
  - Nome (text, required)
  - Telefone (tel, required)
  - Email (email, opcional)
  - Tipo de atendimento (select: individual/casal)
  - Status (select: ativo/inativo) — **só aparece no modo edição**, não faz sentido no
    modo criação (paciente sempre nasce ativo).
- Submit: `POST` (criação) ou `PATCH /pacientes/{id}` (edição), `credentials: "include"`,
  mesmo padrão de tratamento de erro do `AgendaGrid.tsx` (mostra `data.detail` da resposta,
  incluindo o 409 de telefone duplicado). Ao salvar: fecha modal e `router.refresh()`.

## Testes

Sem suíte automatizada no projeto ainda (consistente com o resto do painel). Validação
manual via curl (endpoints novos) e navegador (fluxo completo criar → listar → editar →
inativar → listar).
