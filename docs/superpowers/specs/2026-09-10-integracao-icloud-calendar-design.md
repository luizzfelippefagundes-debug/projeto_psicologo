# Integração com o Calendário da Apple (iCloud / CalDAV) — Design

## Contexto

A profissional quer marcar consultas falando com a Siri ("Hey Siri, marca consulta
com fulano às 15h"). A Siri só cria eventos no app Calendário nativo do iPhone —
que sincroniza com o iCloud — não em apps de terceiros. Ela não quer trocar o
calendário padrão do iPhone pra uma conta Google (que já está integrada e
funcionando hoje), então pra esse fluxo funcionar o sistema precisa ler o
Calendário iCloud dela diretamente.

O iCloud expõe (de forma não-oficial — a Apple nunca declarou suporte formal a
isso) acesso via **CalDAV**, um protocolo aberto (extensão do WebDAV), no servidor
`caldav.icloud.com`. Autenticação é feita com o Apple ID (e-mail) + uma **senha
específica de app** (gerada manualmente em appleid.apple.com — não é a senha normal
da conta). Vamos usar a biblioteca Python `caldav` (PyPI: `python-caldav`, versão
estável 3.2.x), que abstrai boa parte da complexidade do protocolo.

**Risco conhecido:** por ser engenharia reversa não-oficial (diferente do Google
Calendar, que é uma API REST documentada e oficial, ou da Plaud, que expõe um
gatilho oficial no Zapier), o suporte a iCloud tem histórico de instabilidade — a
própria biblioteca `caldav` registra que não é testada contra iCloud há um bom
tempo, e mantém uma lista separada de "quirks" (comportamentos estranhos)
específicos desse servidor. É esperado precisar de ajustes depois de testar contra
a conta real da profissional — não é sinal de que o design está errado.

## Objetivo (escopo desta fase)

Compromissos que a profissional criar no Calendário da Apple (por voz via Siri, ou
manualmente no app) devem aparecer como horário ocupado (`bloqueios_horario`) no
sistema — mesmo efeito que o Google Calendar já tem hoje, só que só na direção de
leitura.

## Fora de escopo (YAGNI, por agora)

- **Escrever de volta (push pro iCloud).** Sessões marcadas no sistema não vão
  aparecer no Calendário da Apple dela nessa fase — só a leitura. Essa direção é
  mais arriscada tecnicamente (criar/atualizar/apagar eventos via CalDAV é mais
  propenso a dar errado que só ler), e faz mais sentido provar que a leitura
  funciona de verdade contra a conta real dela antes de investir na escrita. Fica
  pra uma fase 2, decidida depois que essa primeira fase estiver validada em
  produção.
- **Mais de um calendário por conta.** Só o calendário principal/padrão da conta —
  mesma simplificação já feita pro Google Calendar (que sempre usa `'primary'`).
- **Reconexão automática / aviso se a senha de app for revogada.** Se a
  autenticação falhar, o ciclo de sincronização só loga o erro e tenta de novo no
  próximo ciclo (mesmo padrão do loop do Google) — sem notificar a profissional
  automaticamente por enquanto.
- **Sincronização incremental garantida.** A biblioteca `caldav` suporta
  sync-collection (um `sync_token`, parecido com o do Google), mas não há garantia
  de que o servidor do iCloud aceite isso direito (é um dos "quirks" conhecidos).
  O design já assume que pode cair pro modo "busca tudo de novo a cada ciclo" — ver
  seção de Sincronização.

## Arquitetura

### 1. Autenticação — formulário em Configurações

Sem OAuth possível (a Apple não oferece isso pra CalDAV de terceiros), um card novo
"Calendário Apple (iCloud)" em Configurações, com:

- Um formulário simples: campo de Apple ID (e-mail) + campo de senha de app.
- Um passo a passo (texto, mesmo estilo do card da Plaud) explicando como gerar a
  senha de app em appleid.apple.com — ela nunca usa a senha normal da conta aqui.
- Botão "Conectar" que testa a conexão (tenta descobrir o calendário principal) e,
  se der certo, salva; se der erro, mostra mensagem clara sem salvar.

As credenciais são enviadas direto do formulário pro backend — nunca passam por
conversa/chat.

### 2. Armazenamento

```sql
CREATE TABLE icloud_conexoes (
    profissional_id INTEGER PRIMARY KEY REFERENCES profissionais(id) ON DELETE CASCADE,
    apple_id VARCHAR(255) NOT NULL,
    senha_app TEXT NOT NULL,
    calendar_url TEXT, -- URL do calendário descoberta na primeira conexão, cacheada
    sync_token TEXT, -- token de sincronização incremental, se o servidor aceitar (senão fica sempre nulo)
    conectado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE bloqueios_horario ADD COLUMN icloud_event_uid VARCHAR(255);
ALTER TABLE bloqueios_horario ADD CONSTRAINT bloqueios_horario_icloud_uid_unique
    UNIQUE (profissional_id, icloud_event_uid);
```

`bloqueios_horario` já é a tabela compartilhada de "horário ocupado" — o Google
Calendar já escreve nela via `google_event_id`. Eventos do iCloud escrevem na mesma
tabela, distinguidos por `icloud_event_uid` em vez de `google_event_id` (as duas
colunas ficam nulas uma pra outra dependendo da origem — não há conflito, Postgres
permite múltiplos `NULL` numa coluna `UNIQUE`).

### 3. Sincronização (leitura, por polling)

Novo módulo `backend/app/icloud_calendar.py`, espelhando a organização de
`backend/app/google_calendar.py`:

- `conectar(profissional_id)`: abre uma conexão CalDAV com as credenciais salvas,
  descobre o calendário principal (usa `calendar_url` já cacheada se existir, senão
  descobre e salva pra próxima vez).
- `puxar_eventos_do_icloud(profissional_id)`: tenta sincronização incremental via
  `sync_token` se houver um salvo; se o servidor rejeitar o token (quirk conhecido
  do iCloud) ou não houver token ainda, faz uma busca completa numa janela fixa
  (mesma ideia dos 90 dias já usados no Google) e tenta guardar um `sync_token`
  novo pra próxima vez, se o servidor devolver um. Cada evento vira ou atualiza uma
  linha em `bloqueios_horario` (chave: `profissional_id` + `icloud_event_uid`).
  Eventos que sumiram do calendário (comparados com o que já estava salvo) viram
  `DELETE` em `bloqueios_horario`.
- Uma função de loop (`loop_sincronizacao`), registrada no `lifespan` do
  `main.py` junto dos loops já existentes (lembretes, Google Calendar,
  expiração de holds) — mesmo intervalo de checagem já usado pro Google (1min).

A API exata da biblioteca `caldav` (nomes de método pra sync-collection, discovery,
etc.) será confirmada lendo a documentação atual dela durante a implementação, não
assumida de antemão — mesma cautela já usada nesta sessão pra outras bibliotecas de
terceiro (Clerk, Plaud).

### 4. UI — card em Configurações

Depois de conectado, o card mostra "Conectado" (mesmo padrão visual do card do
Google Calendar) e um botão "Sincronizar agora" pra forçar uma checagem manual, além
de uma opção de desconectar (remove a linha de `icloud_conexoes` e os bloqueios que
vieram de lá, via `icloud_event_uid IS NOT NULL`).

## Bloqueio para implementação

Preciso que a profissional gere a senha de app dela em appleid.apple.com e informe
o Apple ID + essa senha através do formulário em Configurações (não pelo chat) antes
de qualquer teste de ponta a ponta ser possível. A implementação do banco, do
módulo e da tela pode avançar sem isso, mas fica sem verificação real contra uma
conta de verdade até essas credenciais existirem.
