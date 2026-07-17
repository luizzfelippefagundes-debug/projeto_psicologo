# Contexto do Projeto — Bot de Agendamento + Painel (Dra. Jamilly Tassinari)

## O que é
Bot de agendamento no WhatsApp (IA + function calling) integrado a um painel web de gestão,
para uma psicóloga autônoma, sem secretária, que atende em 2 locais físicos e por teleconsulta.

Contrato fechado: R$ 140/mês (pacote completo — bot + painel).
Prazo total do projeto: 5 semanas (17/07 a 21/08/2026).

## Stack técnica
- **WhatsApp**: Evolution API (self-hosted, open-source) — não é o WhatsApp Cloud API oficial.
  Número será separado do pessoal da Jamilly. **Bloqueio atual**: ela ainda não comprou o chip
  do número definitivo — desenvolver e testar com um número de teste/sandbox até lá.
- **Backend**: Python (FastAPI) ou Node.js — a definir.
- **IA**: OpenAI API (GPT-4o-mini), usando function calling para ações de agendamento.
- **Banco de dados**: PostgreSQL hospedado no **Neon** (serverless, tier gratuito, sem servidor
  próprio pra gerenciar). Agenda é **nativa** (não usa Google Calendar — ela não usa
  nenhuma ferramenta hoje, tudo é manual, então não há nada externo para espelhar).
- **Frontend do painel**: a definir (React/Next.js sugerido).
- **Teleconsulta**: gerar link de chamada (Meet/Zoom) automaticamente ao confirmar a sessão.

## Regras de negócio confirmadas com a Jamilly

### Locais de atendimento
- 2 locais: **Barra de São Francisco** e **Vitória (ES)**.
- Cada local tem sua própria grade de horário.
- O bot precisa perguntar/informar o local no momento do agendamento.

### Disponibilidade
- Não atende sábado e domingo.
- Quarta e quinta: só depois das 18h (por causa de plantão em outro local).
- Demais dias: horário a definir por local (perguntar à Jamilly se ainda não tiver isso).

### Modalidade
- Atende por teleconsulta (e presencial nos 2 locais).
- Sessão individual e sessão de casal — podem ter duração e/ou valor diferentes.

### Autonomia do bot
- O bot **fecha o agendamento sozinho**, sem etapa de confirmação manual da Jamilly.
- Cada sessão é agendada **separadamente** — sem recorrência automática (cada paciente
  tem necessidade diferente).

### Situações delicadas (crise / fora do escopo)
- O bot **não tenta responder** — acolhe brevemente com uma mensagem padrão.
- Notifica a Jamilly imediatamente, incluindo uma **prévia da conversa** que motivou a
  transferência.

### Pagamento
- Somente Pix ou dinheiro — sem cartão. Sem gateway de pagamento necessário no MVP.

### Pacientes
- Público: geralmente adultos, ou filhos de adultos.
- Atende terapia individual e de casal.
- Prontuário: ela já usa o Claude para registrar anotações de sessão — **não entra no MVP**,
  fica como possibilidade futura.

### LGPD
- Consentimento explícito no cadastro do paciente (checkbox + timestamp de aceite),
  já que é dado de saúde sensível.

## Escopo do MVP (o que construir agora)

1. Bot de agendamento no WhatsApp (IA + function calling)
2. Agenda nativa no banco (2 locais, regras de horário por dia)
3. Geração automática de link de teleconsulta
4. Lembrete automático antes da sessão
5. Escalonamento de crise (acolhimento + notificação com prévia)
6. Consentimento LGPD no cadastro
7. Painel web: Dashboard, Pacientes, Agenda (calendário + bloqueio de horário), Configurações

**Fora do MVP (roadmap futuro)**: prontuário com criptografia, ficha de anamnese digital,
histórico de conversas por paciente, sessões recorrentes automáticas, lista de espera,
controle de pagamentos/recibos, taxa de no-show.

## Schema do banco de dados

Ver `schema.sql` — tabelas: `pacientes`, `locais`, `regras_horario`, `sessoes`,
`bloqueios_horario`, `conversas_escalonadas`.

## Cronograma (5 semanas — 17/07 a 21/08/2026)

- **Semana 1**: banco de dados, backend base, integração OpenAI (com número de teste)
- **Semana 2**: function calling (consultar/criar agendamento), regras de horário por local/dia
- **Semana 3**: link de teleconsulta, escalonamento de crise, lembrete automático, LGPD
- **Semana 4**: painel web (Dashboard, Pacientes, Agenda, Configurações)
- **Semana 5**: testes end-to-end, configurar número real (Evolution API), deploy, início do piloto de 2 semanas

Board completo no ClickUp: lista "Cronograma — Bot Dra. Jamilly".

## Ponto de partida desta sessão
Começando pelo **banco de dados** — ver `schema.sql` para o modelo proposto.
