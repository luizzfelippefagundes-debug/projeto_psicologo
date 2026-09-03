# Agendamento web pro paciente (plano B do bot) — Design

## Contexto e objetivo

O bot de WhatsApp (Evolution API/Baileys, ferramenta não-oficial) já sofreu um banimento temporário hoje. Esse é um risco estrutural que não some — pode acontecer de novo, com qualquer número, a qualquer momento, sem aviso prévio.

Objetivo: dar ao paciente um jeito de marcar consulta sozinho por um link web, com conta própria (login), que funciona **independente do WhatsApp estar no ar ou não**. Isso vira o "plano B" real do sistema, não só um adendo cosmético.

## Escopo desta spec

Só o fluxo de autoagendamento do paciente (login, ver horários livres, marcar, cancelar, ver histórico). **Fora do escopo**: reagendar por edição direta (paciente cancela e marca de novo), notificação push, painel administrativo enxergar/gerenciar contas de paciente (fica pra depois se for preciso).

## Arquitetura

### Autenticação do paciente: Clerk

O sistema de auth atual (JWT + bcrypt, cookie de sessão) continua exatamente como está, exclusivo pra profissional logar no painel administrativo. Clerk entra como um **segundo sistema de auth, completamente separado**, só pro lado do paciente — são públicos diferentes, com necessidades diferentes (login social, cadastro simples, sem exigir email/senha).

Por quê Clerk e não construir na mão: o pedido explícito foi "entrar com Google" — fazer isso do zero significa implementar OAuth manualmente (o mesmo trabalho que já fizemos pra conexão do Google Calendar da profissional, só que agora pro lado do paciente). Clerk já resolve login social, sessão, componentes de UI prontos, e o usuário já tem familiaridade com a ferramenta (usada no projeto da barbearia).

Pacote: `@clerk/nextjs` no frontend. A API exata (middleware, hooks) muda de vez em quando — checar a documentação oficial atual antes de implementar, não confiar em conhecimento memorizado.

### Link por profissional (slug)

Cada profissional ganha uma coluna nova `slug` (`profissionais.slug`, único, gerado a partir do nome na primeira vez que a feature for usada — ex: "Jamilly Tassinari" → `jamilly-tassinari`). O link público fica `https://<domínio>/agendar/<slug>`. Esse link é fixo e reutilizável (diferente do link de anamnese, que é de uso único por paciente).

O link fica visível na página de Configurações do profissional, com botão de copiar, pra ela poder compartilhar.

### Ligação Clerk ↔ paciente

A tabela `pacientes` ganha uma coluna nova `clerk_user_id` (varchar, nullable). Um paciente cadastrado pelo bot ou pelo painel não tem esse campo preenchido. Quando alguém loga pela primeira vez pelo link de agendamento de um profissional e completa o cadastro (nome, nascimento, LGPD, procedimento), a linha de `pacientes` criada já nasce com o `clerk_user_id` preenchido.

Uma mesma conta Clerk pode, em tese, agendar com profissionais diferentes (multi-tenant) — nesse caso vira uma linha de `pacientes` por profissional, todas com o mesmo `clerk_user_id`. Índice único parcial garante no máximo um paciente por (profissional, clerk_user_id):

```sql
ALTER TABLE pacientes ADD COLUMN clerk_user_id VARCHAR;
CREATE UNIQUE INDEX pacientes_profissional_clerk_uniq
  ON pacientes (profissional_id, clerk_user_id)
  WHERE clerk_user_id IS NOT NULL;

ALTER TABLE profissionais ADD COLUMN slug VARCHAR UNIQUE;
```

### Reaproveitamento da lógica de agendamento (backend)

Hoje a lógica de "quais horários estão livres" (`horarios_disponiveis`) e "criar sessão pra paciente novo/existente" (`_buscar_ou_criar_paciente`, parte de `criar_agendamento`) vive dentro de `backend/app/bot.py`, escrita pensando só no fluxo do bot (function calling da Anthropic).

Extrai essas duas peças pra um módulo novo, `backend/app/agendamento.py`, sem depender de nada específico do bot:
- `horarios_disponiveis(profissional_id, local_id, data, duracao_minutos)` — mesma lógica de hoje (já considera `sessoes` e `bloqueios_horario`), só que recebendo `local_id` direto em vez de `local_nome` (quem chama já resolveu o local antes).
- `buscar_ou_criar_paciente_por_clerk(conn, profissional_id, clerk_user_id, nome, telefone, data_nascimento, consentimento_lgpd, procedimento_estimulacao)` — variante da função existente, casando por `clerk_user_id` em vez de telefone+nome.
- `criar_sessao(...)` — a parte de inserir em `sessoes` e dar reuse a partir de `criar_agendamento` do bot e do novo endpoint público.

`bot.py` passa a importar e chamar essas funções em vez de ter a lógica duplicada.

### Endpoints novos (backend)

Router novo `backend/app/agendamento_publico.py` (`APIRouter`, registrado em `main.py` via `app.include_router`) — mantém esses endpoints fora do `main.py`, que já está grande (1300+ linhas). Todos exigem um clerk JWT válido (verificado via SDK do Clerk pro Python, `svix`/`clerk-backend-api` — confirmar o pacote oficial atual na hora de implementar) exceto a resolução do slug, que é pública:

- `GET /publico/profissional/{slug}` — dados básicos do profissional e seus locais (nome, locais de atendimento), sem exigir login. Usado pra montar a tela antes do paciente logar.
- `GET /publico/horarios?slug=...&local_id=...&data=...` — horários livres daquele dia/local. Exige login (paciente já autenticado via Clerk).
- `POST /publico/agendar` — cria a sessão. Body: `slug`, `local_id`, `data_hora`, `duracao_minutos`, `modalidade`, e (se for a primeira vez desse `clerk_user_id` nesse profissional) `nome`, `data_nascimento`, `consentimento_lgpd`, `procedimento_estimulacao`.
- `GET /publico/minhas-sessoes?slug=...` — sessões (futuras e passadas) do paciente logado com aquele profissional.
- `PATCH /publico/sessoes/{id}/cancelar` — cancela uma sessão do próprio paciente (confere que a sessão pertence ao `clerk_user_id` logado antes de cancelar).

### Páginas novas (frontend)

Sob `frontend/src/app/agendar/[slug]/`, fora do grupo `(app)` (que exige a sessão de profissional) — mesmo padrão já usado pro formulário de anamnese, liberado no `proxy.ts`.

- `agendar/[slug]/page.tsx` — landing: nome do profissional, botão de entrar (Clerk). Depois de logado, mostra o calendário de horários livres (reaproveita visualmente o padrão de lista por horário que já existe na Agenda administrativa, mas somente leitura de horários livres + botão de marcar).
- `agendar/[slug]/nova-sessao` (ou modal na mesma página) — formulário de primeira consulta (nome, nascimento, LGPD, é estimulação/tDCS?), só aparece se o paciente ainda não tem cadastro nesse profissional.
- `agendar/[slug]/minhas-sessoes` — lista de consultas do paciente, com botão de cancelar.

### Envio de anamnese

Continua exatamente como já funciona — `criar_sessao` (a função compartilhada) chama `anamnese.enviar_anamnese` do mesmo jeito que já faz hoje, então o fluxo de anamnese por email/WhatsApp não muda nada.

## Erros e casos de borda

- Slug não encontrado → página 404 amigável ("link inválido").
- Paciente tenta marcar um horário que ficou de outro alguém no meio do processo → mesmo tratamento de hoje (`ExclusionViolationError` do Postgres vira erro 409, mensagem "esse horário acabou de ser ocupado").
- Paciente sem cadastro ainda tentando ver `/minhas-sessoes` → lista vazia, sem erro.

## Testes

Sem suite automatizada (convenção já usada no resto do projeto) — verificação manual: criar conta de teste no Clerk, percorrer o fluxo completo (login → marcar primeira consulta → ver na lista → cancelar), e confirmar que a sessão criada aparece igual na Agenda administrativa e no Google Calendar sincronizado.
