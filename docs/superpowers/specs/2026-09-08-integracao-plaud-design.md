# Integração com a Plaud — Design

## Contexto

A profissional já grava as consultas usando o app/dispositivo Plaud (plaud.ai —
gravador de áudio com transcrição e resumo por IA). Ela tem conta Plaud ativa, mas
hoje essas gravações ficam isoladas no ecossistema Plaud, sem nenhuma ligação com o
sistema de agendamento/prontuário. O objetivo é trazer o resumo e a transcrição de
cada gravação pra dentro da sessão correspondente no nosso sistema.

A Plaud expõe isso via **Plaud Embedded**, uma developer platform em research preview
(portal.plaud.ai / dev.plaud.ai): registro de app (Client ID + Client Secret), geração
de API Key, e uma Transcription API que devolve transcrição + resumo em JSON a partir
de um áudio.

## Objetivo

Quando a profissional gravar uma consulta pela Plaud, ela deve conseguir, a partir da
tela da sessão no nosso sistema, buscar essa gravação, vincular à sessão certa, e ter:

1. O **resumo** da Plaud adicionado automaticamente ao final das observações da
   sessão (sem apagar o que ela já tiver escrito ali).
2. A **transcrição completa** guardada e disponível pra consulta a qualquer momento,
   separada das observações.

## Fora de escopo (YAGNI)

- **Sem sincronização automática/contínua.** Diferente do Google Calendar (que roda
  um loop de fundo puxando eventos periodicamente), aqui a busca de gravação é sempre
  uma ação manual da profissional, sessão por sessão. Não existe um "gatilho" que
  dispare sozinho.
- **Sem webhook.** Não confirmamos se a Plaud oferece notificação push de gravação
  pronta, e o fluxo manual escolhido não depende disso.
- **Sem tela de gerenciamento de gravações** (listar/desvincular/editar depois). Só a
  ação de buscar e vincular.
- **Sem novo campo de consentimento específico pra gravação.** O consentimento de
  gravar a sessão é conversa da profissional com o paciente, fora do sistema — o
  `consentimento_lgpd` que já existe em `pacientes` é sobre tratamento de dados em
  geral, não sobre isso especificamente, e não vamos criar um segundo checkbox agora.
  Cabe à profissional garantir esse consentimento antes de gravar.

## Arquitetura

### 1. Conexão com a Plaud (mesmo padrão do Google Calendar)

Um novo card em Configurações, "Plaud", espelhando o card já existente do Google
Calendar (`GoogleCalendarConexao.tsx`): botão "Conectar Plaud" inicia o fluxo de
autorização; ao voltar, as credenciais da profissional ficam guardadas numa tabela
nova:

```sql
CREATE TABLE plaud_conexoes (
    profissional_id INTEGER PRIMARY KEY REFERENCES profissionais(id) ON DELETE CASCADE,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    access_token_expira_em TIMESTAMPTZ,
    conectado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Os campos exatos do token (se é OAuth authorization-code como o Google, ou um modelo
mais simples de API Key por conta) só serão confirmados quando tivermos acesso real à
documentação completa da Plaud Embedded — a estrutura acima é a expectativa razoável
por analogia com o Google Calendar, mas pode precisar ajuste nessa fase.

Novo módulo backend `app/plaud.py`, espelhando a organização de `app/google_calendar.py`.

### 2. Vincular gravação a uma sessão

Na tela de edição da sessão (`AgendaList.tsx`, onde já existem as "Observações"), um
botão novo "Buscar gravação Plaud":

1. Chama um endpoint nosso (`GET /plaud/gravacoes?perto_de=<data_hora_da_sessao>`),
   que por sua vez consulta a API da Plaud pelas gravações recentes da profissional
   (filtradas por uma janela de tempo perto do horário da sessão, pra facilitar achar
   a certa — mas a escolha final é sempre dela, nunca automática).
2. Mostra uma lista simples (horário de início, duração) num modal.
3. Ela escolhe a gravação certa e confirma.
4. O backend busca a transcrição + resumo dessa gravação específica na Plaud, salva,
   e atualiza as observações da sessão.

### 3. Armazenamento

```sql
CREATE TABLE plaud_gravacoes (
    id SERIAL PRIMARY KEY,
    sessao_id INTEGER NOT NULL UNIQUE REFERENCES sessoes(id) ON DELETE CASCADE,
    plaud_recording_id VARCHAR(255) NOT NULL,
    transcricao TEXT,
    resumo TEXT,
    vinculado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`sessao_id UNIQUE` — uma gravação vinculada por sessão (se ela vincular de novo,
substitui a anterior; não empilha várias gravações na mesma sessão).

Ao vincular com sucesso:

- `sessoes.observacoes` recebe o resumo **adicionado ao final** do texto já existente,
  com um separador identificável:
  ```
  {observações já escritas por ela, se houver}

  — Resumo automático (Plaud) —
  {resumo}
  ```
- Se ela vincular uma gravação **de novo** na mesma sessão (trocando por outra), o
  bloco "— Resumo automático (Plaud) —" anterior é substituído pelo novo, não
  duplicado — o texto que ela escreveu por conta própria (antes ou depois desse
  bloco) nunca é tocado.
- A transcrição completa fica visível numa seção nova na tela da sessão (ex: abaixo
  das observações, algo como "Transcrição da consulta (Plaud)", colapsável pra não
  poluir a tela por padrão).

## Bloqueio para implementação

Preciso que a profissional (ou o usuário, em nome dela) crie acesso de desenvolvedor
em portal.plaud.ai / dev.plaud.ai e forneça Client ID, Client Secret e API Key antes
de qualquer teste de ponta a ponta contra a API real da Plaud ser possível. A
implementação do banco, dos endpoints e da tela pode avançar sem isso, mas fica sem
verificação real até as credenciais existirem.
