# Contexto do Projeto — Status atual (2026-07-20)

> Este documento foi reescrito do zero nesta data porque a versão anterior descrevia um
> projeto single-tenant só pra Dra. Jamilly, e o escopo mudou bastante desde então. Se você é
> um agente/dev pegando isso pela primeira vez, leia isso inteiro antes de mexer em qualquer coisa.

## O que o projeto é hoje

Começou como um bot de agendamento no WhatsApp + painel web só pra Dra. Jamilly Tassinari
(psicóloga). Em 2026-07-20 o escopo virou **SaaS multi-tenant**: qualquer profissional pode
criar conta e usar o sistema, cada um com seus próprios dados isolados. O dono do projeto
(Luiz) está populando os dados ele mesmo, testando como se fosse o primeiro usuário real.

**Não está mais amarrado a nenhum cliente específico.** Um segundo cliente ("Hebert") chegou a
ser cogitado no meio do caminho mas não avançou — não é relevante pro estado atual.

## ⚠️ Atenção antes de continuar

1. Todo o trabalho até 2026-07-20 está commitado e no GitHub (`main`, commit `81d8749`). Se você
   está lendo isso a partir de um clone novo, já está tudo lá — não precisa reconstruir nada.
2. **O arquivo `.env` NÃO está no git (de propósito, tem segredo)** — se você está num ambiente
   novo (não a mesma máquina/pasta onde isso foi construído), o repositório sozinho não é
   suficiente pra rodar o backend. Você precisa pedir pro Luiz os valores de:
   - `DATABASE_URL` — connection string do Postgres no Neon
   - `JWT_SECRET` — string aleatória usada pra assinar os tokens de sessão (qualquer valor longo
     e aleatório serve se for gerar um novo do zero, mas aí as sessões antigas de quem já logou
     ficam inválidas)

   Formato esperado do `.env` (colocar na raiz do projeto, ao lado de `schema.sql`):
   ```
   DATABASE_URL=postgresql://usuario:senha@host.neon.tech/dbname?sslmode=require
   JWT_SECRET=<string aleatória longa>
   ```
   **Nunca peça pra colar esses valores num chat/arquivo que vá pro git.** Peça por um canal
   direto (ex: o próprio Luiz manda por mensagem) e escreva direto no `.env` local.
3. **Os servidores não ficam rodando sozinhos** — precisam ser subidos manualmente a cada sessão
   nova (comandos abaixo). Se `curl http://localhost:3000` ou `:8000/health` não responder, é
   só isso, não é bug.
4. Existe uma conta de teste real no banco: **email `luiz@teste.com` / senha `senha123`**.

## Stack técnica (decidida e em uso, não é mais "a definir")

- **Backend**: Python + FastAPI, em `backend/`. Conecta no Postgres via `asyncpg` (pool).
- **Banco**: PostgreSQL no **Neon** (serverless). Connection string em `.env` → `DATABASE_URL`
  (nunca commitado).
- **Frontend**: Next.js 16 (App Router, Turbopack) + Tailwind v4, em `frontend/`. **Substituiu
  completamente** o painel antigo em HTML estático (que foi deletado — `git rm`, ainda staged).
  Exige **Node 20+** (o sistema tinha Node 18; instalamos via `nvm`, não pelo apt do sistema).
- **Auth**: JWT em cookie httpOnly (`session`, 7 dias), senha com bcrypt. Rotas do painel
  protegidas por `frontend/src/proxy.ts` (⚠️ no Next.js 16 o arquivo se chama `proxy.ts` e a
  função exportada é `proxy`, não `middleware.ts`/`middleware` — API antiga foi deprecada. Isso
  pegou a gente de surpresa uma vez, cuidado com conhecimento desatualizado sobre Next.js aqui).
- **IA / WhatsApp**: nada disso foi implementado ainda. Ver seção "O que NÃO existe".

## Como rodar

```bash
# Backend
cd backend
source .venv/bin/activate
uvicorn app.main:app --port 8000 --reload

# Frontend (precisa do nvm carregado pra pegar Node 20)
export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
cd frontend
npm run dev
```

Frontend em `http://localhost:3000`, backend em `http://localhost:8000`.
`frontend/.env.local` já tem `API_URL` e `NEXT_PUBLIC_API_URL` apontando pro backend local.

## Schema do banco (multi-tenant)

Ver `schema.sql`. Tabela `profissionais` (login: nome, email, senha_hash) é o tenant raiz.
Todas as outras tabelas carregam `profissional_id`: `locais`, `pacientes`, `sessoes`,
`regras_horario`, `bloqueios_horario`, `conversas_escalonadas`. Isolamento é feito por
`WHERE profissional_id = $1` em toda query do backend — não tem RLS do Postgres, é tudo
aplicação.

Detalhes que não são óbvios lendo o schema:
- `sessoes` tem uma `EXCLUDE USING gist` que impede duas sessões sobrepostas no mesmo local
  (testado, funciona). Precisou de um trigger (`trg_sessoes_calc_fim`) porque `timestamptz + interval`
  não é IMMUTABLE no Postgres e não pode entrar direto numa constraint desse tipo.
- `pacientes.telefone` é único **por profissional**, não globalmente.
- Datas são `TIMESTAMPTZ`. O frontend converte pra horário de Brasília na hora de exibir
  (`frontend/src/lib/format.ts`) — os dados no banco estão em UTC.

## Endpoints do backend (`backend/app/main.py`)

- `POST /auth/signup`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`
- `GET/POST /locais`
- `GET/POST /regras-horario`, `DELETE /regras-horario/{id}`
- `GET /pacientes` (inclui `proxima_sessao` calculada via join)
- `GET /sessoes/hoje`, `GET /sessoes?inicio=&fim=` (aceita `date`, não string — cuidado se
  mexer nisso, já quebrou uma vez por causa de tipagem do asyncpg)
- `POST /sessoes`, `PATCH /sessoes/{id}` (cria/edita sessão; detecta choque de horário e
  devolve 409)
- `GET /dashboard/stats`

Todas as rotas de dado (exceto `/health` e `/auth/*`) exigem cookie de sessão válido.

## Frontend — o que existe

Rotas em `frontend/src/app/`:
- `(auth)/login`, `(auth)/signup` — formulários reais, chamam o backend, sem sidebar
- `(app)/` (Dashboard), `(app)/pacientes`, `(app)/agenda`, `(app)/configuracoes` — todas atrás
  do proxy de auth, com sidebar

Não existem ainda: `/assistente` (bot), `/financeiro` (removido de propósito, não é mais escopo).

Pontos fortes de UX já implementados:
- Agenda: grid semanal real (não mockado), clique num espaço vazio abre modal de criar sessão,
  clique numa sessão existente abre modal de editar/cancelar. Navegação entre semanas por
  querystring (`?semana=YYYY-MM-DD`).
- Configurações: cadastro de locais + grade de horário (`regras_horario`) com formulário e
  lista com botão de remover.
- Paleta visual: rosé/mauve + dourado, inspirada nas fotos reais do consultório da Jamilly
  (não é mais o lilás genérico do mockup original nem o azul que foi tentado no meio do caminho
  pra uma reunião que não avançou).

## O que NÃO existe (não assuma que está pronto)

- Bot do WhatsApp (Evolution API) — zero código, nem decisão de infra tomada
- Integração com OpenAI / function calling — zero código, sem API key configurada ainda
- Geração de link de teleconsulta
- Lembrete automático
- Escalonamento de crise
- Fluxo de consentimento LGPD no cadastro (o campo existe no banco, não tem UI)
- Tela de cadastro/edição de paciente (hoje só dá pra ver a lista; criar paciente é só via API/SQL direto)
- Qualquer teste automatizado (unit, integração, e2e) — tudo foi validado manualmente via curl
  e navegador até agora

## Decisão em aberto

Luiz perguntou sobre usar um **número BR DID** (número virtual/VoIP brasileiro) em vez do
celular pessoal dele pra testar o WhatsApp/Evolution API — ainda não foi respondido nem decidido
nesta sessão. Vale retomar essa conversa antes de partir pra integração do bot.

## Recomendação de próximos passos

1. Decidir o que fazer com o git (commitar o que está pendente, ideal antes de qualquer coisa
   grande).
2. Decidir sobre o número BR DID (pergunta em aberto acima).
3. Construir a tela de cadastro/edição de paciente (falta pra fechar o CRUD básico do painel).
4. Só depois disso entrar em WhatsApp/Evolution API + OpenAI — é a parte mais arriscada e
   ainda não tem nenhuma base de código.
