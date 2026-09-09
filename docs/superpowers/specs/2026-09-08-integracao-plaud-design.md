# Integração com a Plaud — Design

## Contexto

A profissional já grava as consultas usando o app/dispositivo Plaud (plaud.ai —
gravador de áudio com transcrição e resumo por IA). Ela tem conta Plaud ativa, mas
hoje essas gravações ficam isoladas no ecossistema Plaud, sem nenhuma ligação com o
sistema de agendamento/prontuário. O objetivo é trazer o resumo e a transcrição de
cada gravação pra dentro da sessão correspondente no nosso sistema.

A Plaud tem uma developer platform própria (Plaud Embedded, portal.plaud.ai) — mas
ela é só pra **enviar um áudio novo pra ser transcrito** (upload + polling de
resultado), não pra **buscar gravações que já existem** na conta da profissional. Não
existe endpoint de "listar minhas gravações". Por isso essa via foi descartada.

O caminho real é a **integração oficial da Plaud com o Zapier**: existe um gatilho
("Transcript & Summary Ready") que dispara automaticamente toda vez que uma
transcrição/resumo termina de processar na conta dela. Ligando esse gatilho a uma
ação "Webhooks by Zapier → POST", dá pra mandar esses dados pro nosso backend assim
que ficam prontos — sem precisar de credencial de desenvolvedor da Plaud, sem OAuth,
só a profissional configurando 1 Zap (uma vez) na conta Zapier dela.

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
- **Sem tela de gerenciamento de gravações** (listar todas/desvincular/editar depois,
  fora da tela da sessão). Só a ação de vincular, a partir da sessão.
- **Sem novo campo de consentimento específico pra gravação.** O consentimento de
  gravar a sessão é conversa da profissional com o paciente, fora do sistema — o
  `consentimento_lgpd` que já existe em `pacientes` é sobre tratamento de dados em
  geral, não sobre isso especificamente, e não vamos criar um segundo checkbox agora.
  Cabe à profissional garantir esse consentimento antes de gravar.

## Arquitetura

### 1. Recebendo gravações — webhook do Zapier

Cada profissional ganha uma **URL de webhook própria e secreta**, construída com um
token aleatório (mesmo padrão já usado pro token da anamnese —
`secrets.token_urlsafe(32)`), gerado uma vez e guardado em
`profissionais.plaud_webhook_token`:

```
POST https://api.nexosystem.online/plaud/webhook/<token>
```

Um card novo em Configurações, "Plaud", mostra essa URL (com botão de copiar, mesmo
componente `LinkAgendamentoCopiar.tsx` já usado pro link de agendamento) e o passo a
passo pra ela configurar o Zap:

1. Criar um Zap no Zapier.
2. Gatilho: Plaud → "Transcript & Summary Ready".
3. Ação: "Webhooks by Zapier" → POST, URL = a URL copiada daqui.

Cada gravação que chega vira uma linha "solta" (sem sessão vinculada ainda) em
`plaud_gravacoes`. O corpo exato que o Zapier envia só será confirmado na prática
(depende de como ela mapear os campos no próprio Zap) — por isso o endpoint guarda o
payload bruto inteiro (`payload_bruto JSONB`) sempre, e faz o melhor esforço pra
extrair `resumo`/`transcricao`/`gravado_em` dos campos mais prováveis. Isso garante
que nenhuma gravação é perdida mesmo se o mapeamento inicial não pegar 100% dos
campos — dá pra reprocessar `payload_bruto` depois sem perder dado.

Novo módulo backend `app/plaud.py`.

### 2. Vincular gravação a uma sessão

Na tela de edição da sessão (`AgendaList.tsx`, onde já existem as "Observações"), um
botão novo "Vincular gravação Plaud":

1. Chama `GET /plaud/gravacoes-disponiveis` — lista as gravações que chegaram via
   webhook pra essa profissional e **ainda não foram vinculadas a nenhuma sessão**,
   ordenadas por proximidade do horário da sessão atual (mais perto primeiro), mas
   sempre mostrando todas as não vinculadas — a escolha final é sempre dela.
2. Mostra um modal com a lista (horário de recebimento, resumo curto como prévia).
3. Ela escolhe a gravação certa e confirma.
4. `PATCH /plaud/gravacoes/{id}/vincular` com `{sessao_id}` grava o vínculo e atualiza
   as observações da sessão.

### 3. Armazenamento

```sql
CREATE TABLE plaud_gravacoes (
    id SERIAL PRIMARY KEY,
    profissional_id INTEGER NOT NULL REFERENCES profissionais(id) ON DELETE CASCADE,
    sessao_id INTEGER REFERENCES sessoes(id) ON DELETE CASCADE, -- nulo até ser vinculada
    transcricao TEXT,
    resumo TEXT,
    gravado_em TIMESTAMPTZ, -- extraído do payload quando disponível; senão nulo
    payload_bruto JSONB NOT NULL,
    recebido_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    vinculado_em TIMESTAMPTZ
);
```

`sessao_id` é nulo até ela vincular manualmente — o Postgres permite múltiplos `NULL`
numa coluna, então não precisa de índice único parcial pra isso funcionar. Uma sessão
só pode ter uma gravação vinculada por vez: antes de vincular, o backend desvincula
(`sessao_id = NULL`) qualquer gravação anterior que já apontava pra essa sessão.

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

Não sabemos ainda o formato exato do JSON que o Zapier manda no POST — isso só se
confirma configurando o Zap de verdade e mandando um payload real pro endpoint. Por
isso o design guarda `payload_bruto` sempre (nunca perde a gravação mesmo que a
extração de campos específicos falhe) e o plano de implementação separa "receber e
guardar o payload bruto" (não depende de nada externo, dá pra construir e testar
agora) de "extrair os campos certos do payload" (só dá pra fazer certo depois de ver
um payload real — a profissional precisa configurar o Zap e disparar uma gravação de
teste nessa fase).
