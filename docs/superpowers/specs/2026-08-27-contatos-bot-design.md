# Contatos do bot (pessoas que conversaram mas não agendaram)

## Contexto

Hoje o sistema só cria um registro em `pacientes` quando um agendamento é criado
(`criar_agendamento`) ou quando uma conversa é escalada por crise/fora do escopo
(`escalar_conversa`, já ajustado pra capturar nome quando disponível). Qualquer pessoa
que só bateu papo com o bot — perguntou horário, tirou dúvida, e não chegou a agendar
nem foi escalada — não deixa nenhum registro visível no painel, mesmo que a conversa
inteira esteja salva em `bot_conversas`.

O usuário quer ver essas pessoas separadamente dos pacientes reais, pra poder fazer
follow-up manual com quem demonstrou interesse mas não fechou.

## Decisão de arquitetura

Reaproveitar `bot_conversas` em vez de criar uma tabela nova. Essa tabela já tem
`profissional_id`, `telefone_paciente` e `atualizado_em` para todo telefone que já
trocou mensagem com o bot — é exatamente a lista de "contatos". Falta só o nome de
exibição do WhatsApp, que a Evolution API já manda em `data.pushName` no payload do
webhook e hoje é ignorado.

Uma tabela `contatos` separada foi considerada e descartada: duplicaria telefone/nome
que já existem em `bot_conversas`, exigindo sincronização manual entre as duas sem
ganho real.

"Contato" = qualquer linha de `bot_conversas` cujo `telefone_paciente` não bate com
nenhum `pacientes.telefone` do mesmo profissional. Assim que alguém vira paciente
(agendamento criado), ela desaparece da lista de contatos automaticamente — não precisa
de nenhuma flag de "convertido" pra manter sincronizada.

## Backend

### Schema (`schema.sql`)

```sql
ALTER TABLE bot_conversas ADD COLUMN nome_whatsapp VARCHAR(100);
```

Aplicar direto no Neon (não tem migration runner no projeto — mudanças de schema são
aplicadas manualmente, como já é prática aqui).

### Captura do nome (`main.py`, dentro de `_extrair_mensagem_whatsapp` e `webhook_whatsapp`)

`_extrair_mensagem_whatsapp` passa a devolver também `push_name` (extraído de
`dados.get("pushName")` — mesmo nível de `data.key`/`data.message`, confirmado no
formato real de payload já visto em produção). O `INSERT ... ON CONFLICT DO UPDATE` que
salva `bot_conversas` passa a incluir `nome_whatsapp = COALESCE($4, bot_conversas.nome_whatsapp)`
— atualiza se vier um nome novo, mantém o que já tinha se o payload não trouxer (alguns
eventos da Evolution API não repetem o pushName).

### Endpoint novo

```
GET /contatos-bot
```

Requer sessão válida (mesmo padrão de auth das outras rotas). Retorna:

```sql
SELECT bc.telefone_paciente, bc.nome_whatsapp, bc.atualizado_em
FROM bot_conversas bc
WHERE bc.profissional_id = $1
  AND NOT EXISTS (
    SELECT 1 FROM pacientes p
    WHERE p.profissional_id = bc.profissional_id AND p.telefone = bc.telefone_paciente
  )
ORDER BY bc.atualizado_em DESC
```

## Frontend

### `/pacientes` — abas

A página ganha duas abas no topo, acima da tabela atual: **"Pacientes"** (comportamento
atual, sem mudanças) e **"Contatos"** (nova). Estado da aba ativa fica em query string
(`?aba=contatos`) pra poder linkar direto, seguindo o padrão já usado em `/agenda?semana=`.

### Aba Contatos

Tabela simples: Nome (ou "Não informado" se `nome_whatsapp` for null), Telefone, Última
mensagem (formatada via `formatDataHoraBrasilia`, já existe em `lib/format.ts`), e um
botão **"Cadastrar como paciente"** por linha.

O botão abre o mesmo modal de criar paciente que já existe em `PacientesTable.tsx`
(reaproveitado, não duplicado), com `nome` e `telefone` pré-preenchidos a partir da linha
clicada. Depois de salvar, a lista de contatos recarrega (o telefone some de lá porque
agora existe em `pacientes`).

### Novo endpoint no client

`frontend/src/lib/api.ts` ganha `getContatosBot()`, seguindo o mesmo padrão de
`getPacientes()`.

## Fora de escopo

- Nenhuma mudança em `criar_agendamento` ou `escalar_conversa`.
- Sem paginação na lista de contatos (mesmo padrão da lista de pacientes hoje).
- Sem exclusão manual de contatos da lista — some sozinho quando vira paciente.
- Sem histórico de conversa visível nessa tela (já existe em outro lugar, se precisar
  no futuro é ponto de partida separado).

## Plano de verificação

Depois de implementado, testar manualmente:
- Simular uma mensagem nova de um telefone que nunca conversou (via `/bot/simular` ou
  WhatsApp real) e confirmar que `nome_whatsapp` é salvo em `bot_conversas`.
- Conferir que esse telefone aparece na aba "Contatos" do painel.
- Clicar em "Cadastrar como paciente", preencher o resto e salvar.
- Confirmar que o telefone some da aba "Contatos" e aparece na aba "Pacientes".
