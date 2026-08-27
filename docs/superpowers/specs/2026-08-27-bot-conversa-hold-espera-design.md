# Bot: hold de horário, lista de espera e tom de conversa — Design

## Contexto

O bot de agendamento pelo WhatsApp (`backend/app/bot.py`) hoje só sabe fazer duas coisas: consultar horários livres e criar um agendamento confirmado na hora. A conversa é funcional mas seca — pede várias informações de uma vez, não segura horário pro paciente pensar, não tem lista de espera, e não guia a conversa com perguntas abertas.

O usuário trouxe prints de um material de copywriting pra clínicas (@escoladaagendalotada) mostrando três técnicas de atendimento que aumentam conversão de agendamento:
1. Perguntas abertas e graduais em vez de listar exigências de uma vez.
2. Segurar (hold) um horário por um prazo curto quando o paciente hesita, criando compromisso sem forçar confirmação imediata.
3. Lista de espera: quando não há horário bom, oferecer avisar proativamente quando um abrir.

Este documento cobre as três. Uma quarta técnica dos prints — contornar objeção de preço — fica de fora: o sistema não tem noção de valores/preços em nenhuma tabela hoje, e criar uma política de preço não faz parte deste escopo.

## Arquitetura

### 1. Modelo de dados

**`sessoes` (schema.sql) — alterações:**
- `status` ganha um novo valor possível: `'reservado'` (constraint `CHECK` passa a aceitar `'confirmada', 'reservado', 'cancelada', 'concluida'`).
- Nova coluna `expira_em TIMESTAMPTZ` (nullable) — só preenchida quando `status = 'reservado'`; define o prazo do hold.
- Nova coluna `lembrete_expiracao_enviado BOOLEAN NOT NULL DEFAULT false` — evita mandar o aviso de "hold quase expirando" mais de uma vez pro mesmo hold.

A constraint de exclusão existente (`EXCLUDE ... WHERE (status <> 'cancelada')`) já protege `reservado` contra sobreposição sem precisar de nenhuma mudança — ela só ignora `cancelada`.

**Nova tabela `lista_espera`:**
```sql
CREATE TABLE lista_espera (
    id SERIAL PRIMARY KEY,
    profissional_id INTEGER NOT NULL REFERENCES profissionais(id) ON DELETE CASCADE,
    local_id INTEGER NOT NULL REFERENCES locais(id),
    paciente_telefone VARCHAR(20) NOT NULL,
    paciente_nome VARCHAR(150) NOT NULL,
    periodo_preferido VARCHAR(10) NOT NULL DEFAULT 'qualquer'
        CHECK (periodo_preferido IN ('manha', 'tarde', 'qualquer')),
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    atendido_em TIMESTAMPTZ -- preenchido quando essa entrada foi avisada de uma vaga (ainda que o hold expire depois)
);
```
`manha` = antes das 12:00, `tarde` = a partir das 12:00 (horário de Brasília). Uma entrada com `atendido_em` preenchido não é mais considerada candidata em novas checagens — se o hold que ela gerou expirar, o próximo da fila (não ela de novo) é quem recebe a próxima chamada.

### 2. Ciclo de vida do hold (`segurar_horario`)

**Prazo do hold**: expira às 21h de Brasília do dia em que a conversa está acontecendo (não do dia da consulta). Se a conversa já estiver depois das 21h quando o hold é criado, o prazo vira "agora + 2h" em vez disso, pra nunca nascer expirado ou com janela ridiculamente curta.

**Nova tool do bot: `segurar_horario`**
- Mesmos parâmetros de `criar_agendamento` (nome, local, data/hora, modalidade, duração, consentimento LGPD, data de nascimento).
- Usada quando o paciente demonstra interesse num horário oferecido por `consultar_horarios_disponiveis` mas não confirma de cara (ex: "deixa eu ver com calma", "vou confirmar já já").
- Cria a sessão com `status='reservado'` e `expira_em` calculado como acima. Reaproveita a mesma lógica de busca/criação de paciente que `criar_agendamento` já tem (paciente existente vs. novo, exigência de consentimento LGPD e coleta de data de nascimento pra paciente novo).
- **Não** dispara email de confirmação nem anamnese — isso só acontece quando o hold vira confirmado de fato (ver abaixo). Evita mandar formulário de anamnese pra uma reserva que pode nem virar consulta.

**Nova tool do bot: `confirmar_horario_reservado`**
- Parâmetro: `sessao_id` (o bot já tem esse id na resposta de `segurar_horario`, guardado no histórico da conversa).
- Faz `UPDATE sessoes SET status = 'confirmada' WHERE id = $1 AND status = 'reservado'`. Se a sessão não existir mais com `status='reservado'` (por exemplo, expirou entre o hold e a confirmação), retorna um erro claro pro bot explicar que o horário não está mais garantido e oferecer consultar de novo.
- Só na confirmação bem-sucedida dispara `notificacoes.enviar_email_sessao(tipo="confirmacao", ...)` e `anamnese.enviar_anamnese(...)` — o mesmo par de chamadas que hoje roda dentro de `criar_agendamento`.

**Job de expiração de holds** (mesmo padrão do `loop_lembretes` já existente em `lembretes.py`, roda a cada 15 min):
1. Busca `sessoes` com `status='reservado'`, `expira_em` entre agora e agora+1h, `lembrete_expiracao_enviado=false` → manda WhatsApp lembrando que o horário reservado expira em breve e pedindo confirmação → marca `lembrete_expiracao_enviado=true`.
2. Busca `sessoes` com `status='reservado'` e `expira_em < agora` → marca `status='cancelada'` → dispara a checagem de lista de espera (seção 3) pro `local_id`/horário que acabou de abrir.

**Integração com a rede de segurança existente**: `bot.py` já tem `_alega_confirmacao_sem_ter_agendado`, que intercepta o bot dizendo "confirmado"/"agendado" sem ter chamado `criar_agendamento` com sucesso na mesma resposta (bug real já visto em produção). Ela hoje só reconhece o prefixo `"Agendamento criado com sucesso"`. Precisa passar a reconhecer também os resultados de `segurar_horario` (ex: prefixo `"Horário reservado com sucesso"`) e de `confirmar_horario_reservado` (ex: `"Reserva confirmada com sucesso"`) como prova de ação real — senão o bot fica proibido de confessar que segurou/confirmou um horário de verdade, ou (pior) o guard não pega quando ele inventa isso sem ter chamado a tool.

### 3. Ciclo de vida da lista de espera

**Nova tool do bot: `entrar_lista_espera`**
- Parâmetros: `local_nome`, `periodo_preferido` (`manha` | `tarde` | `qualquer`).
- Oferecida pelo bot quando `consultar_horarios_disponiveis` não retorna nada bom pro que o paciente pediu (ex: "hoje já lotou").
- Cria uma linha em `lista_espera`. Se já existir uma entrada ativa (`atendido_em IS NULL`) pro mesmo `paciente_telefone` + `local_id`, não duplica — atualiza o `periodo_preferido` dessa entrada existente em vez de criar outra.

**Gatilho de "abriu vaga"** — função nova `checar_lista_espera(profissional_id, local_id, data_hora_liberada, duracao_minutos)`, chamada em dois pontos:
1. No job de expiração de holds (seção 2), quando um hold expira.
2. Em `main.py:editar_sessao`, quando uma sessão transiciona pra `status='cancelada'` (cancelamento feito pelo painel).

A função busca a entrada mais antiga (`ORDER BY criado_em`) em `lista_espera` desse `local_id`, com `atendido_em IS NULL`, cujo `periodo_preferido` bate com o horário liberado (`qualquer` sempre bate; `manha`/`tarde` batem com a faixa correspondente). Se achar:
- Cria um hold automático (`status='reservado'`, mesma `duracao_minutos` da sessão que acabou de liberar o horário, mesmo `expira_em` da seção 2) nesse horário, em nome do paciente da lista de espera (mesma lógica de buscar-ou-criar paciente).
- Manda WhatsApp: "Abriu um horário pra você — [data/hora] no [local]. Deixei reservado até as [prazo], só confirmar por aqui."
- Marca essa entrada da lista de espera com `atendido_em = now()`.

Se esse hold expirar sem confirmação, o próprio job de expiração de holds já dispara `checar_lista_espera` de novo pro mesmo horário — e como a entrada anterior já está com `atendido_em` preenchido, naturalmente pega a próxima da fila. Isso cobre o requisito de fallback sem precisar de lógica extra.

### 4. Tom de conversa

Reescrita do `system_prompt` em `bot.py:processar_mensagem`:
- Trocar a regra atual de "pergunte tudo que falta" por uma que guia perguntas uma de cada vez, priorizando perguntas abertas (ex: período do dia) antes de pedir dados de cadastro.
- Nova regra: quando o paciente demonstrar interesse mas hesitar em confirmar um horário oferecido, oferecer proativamente segurar (`segurar_horario`) em vez de deixar a conversa murchar.
- Nova regra: quando não houver horário bom pro que o paciente quer, oferecer proativamente a lista de espera (`entrar_lista_espera`) em vez de só dizer "não tem".
- Instrução explícita pra **não inventar urgência falsa** (não dizer "os horários estão sumindo rápido" como frase genérica fixa) — a pressão real já vem da mecânica do hold/lista de espera em si, não precisa de exagero verbal. Isso é uma escolha deliberada: é um contexto de saúde mental, e uma pressão de vendas artificial seria deslocada.

## Fora de escopo

- Objeção de preço / desconto: não há tabela de valores no sistema.
- Notificar todo mundo da lista de espera ao mesmo tempo: decidido que é FIFO, um de cada vez.
- Editar holds pelo painel/dashboard: o painel continua só criando sessões `confirmada` diretamente; `reservado` é um estado que só o bot cria e resolve.

## Testes / verificação manual

Sem suite automatizada nesse projeto (mesmo padrão já usado nas features anteriores). Verificação via conversa real com o bot (mesmo método usado pra validar a pergunta de data de nascimento):
1. Hold: pedir horário, hesitar, confirmar depois → checar que a sessão nasce `reservado` sem mandar anamnese/confirmação, e que confirmar depois muda pra `confirmada` e manda os dois.
2. Expiração: criar um hold com `expira_em` já no passado (via SQL direto, pra não esperar horas de verdade) → rodar o job manualmente → checar que vira `cancelada` e que dispara lembrete pré-expiração corretamente quando ainda não passou.
3. Lista de espera: colocar duas entradas na fila pro mesmo local/período, cancelar uma sessão que bate com as duas → checar que só a mais antiga recebe o hold automático e o aviso, e que a segunda só é chamada se o hold da primeira expirar.
4. Tom: ler a conversa real gerada nos testes acima e confirmar que o bot está perguntando de forma gradual/aberta, oferecendo hold/espera nos momentos certos, sem frases de urgência inventada.
