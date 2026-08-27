# Envio automático da anamnese de tDCS antes da consulta

## Contexto

O usuário adicionou uma pasta `testes_psicologicos/` na raiz do projeto com dois
formulários Word de anamnese pra tDCS (estimulação transcraniana): `Anamnese_tDCS.docx`
(adulto) e `Anamnese_tDCS_Infantil.docx` (infantil). Esses formulários precisam chegar
ao paciente automaticamente antes da consulta, pra ele preencher com calma.

Já existem dois pontos de contato automatizado com o paciente:
- Confirmação de sessão, disparada em `POST /sessoes` (`backend/app/main.py`), que já
  chama `notificacoes.enviar_email_sessao(tipo="confirmacao", ...)`.
- Lembrete de 24h antes da sessão, um loop de fundo em `backend/app/lembretes.py` que
  roda a cada 15 minutos e chama `notificacoes.enviar_email_sessao(tipo="lembrete", ...)`.

## Decisões (confirmadas com o usuário)

1. **Quem recebe**: só pacientes com `tipo_procedimento` igual a
   `reabilitacao_com_estimulacao` ou `neuromodulacao` — os únicos que envolvem tDCS de
   fato.
2. **Qual versão**: baseado na idade calculada a partir de um novo campo
   `pacientes.data_nascimento`. Corte em **12 anos** (abaixo, infantil; a partir de,
   adulto). Se `data_nascimento` for `NULL` (paciente cadastrado antes dessa mudança),
   assume **adulto** por padrão.
3. **Quando enviar**: nos dois momentos já existentes — na confirmação da sessão E no
   lembrete de 24h. Pode resultar em envio duplicado pro mesmo paciente; é intencional
   (reforça que não passe batido).
4. **Canal**: email se o paciente tiver (anexado ao mesmo email que já é enviado);
   WhatsApp como alternativa se não tiver email — só funciona se o profissional tiver
   `whatsapp_instance` configurado.

## Arquitetura

### Novo módulo: `backend/app/anamnese.py`

Duas responsabilidades isoladas:

```python
def determinar_arquivo(tipo_procedimento: str | None, data_nascimento: date | None) -> Path | None:
    """None se o procedimento não precisa de anamnese de tDCS. Senão, o Path do
    .docx certo (adulto ou infantil, baseado na idade — adulto se data_nascimento
    for None)."""

async def enviar_anamnese(
    *,
    paciente_email: str | None,
    paciente_telefone: str,
    paciente_nome: str,
    tipo_procedimento: str | None,
    data_nascimento: date | None,
    whatsapp_instance: str | None,
) -> None:
    """Decide o arquivo via determinar_arquivo (retorna cedo se None), decide o canal
    (email > WhatsApp), e envia. Nunca levanta exceção pro chamador — captura e loga,
    igual ao padrão já usado em enviar_alerta_crise/enviar_email_sessao (uma falha de
    notificação não pode derrubar a criação/lembrete da sessão)."""
```

Os dois arquivos `.docx` saem de `testes_psicologicos/` (raiz do repo) e vão pra
`backend/app/anexos/` — **isso é obrigatório, não cosmético**: o `Dockerfile` do backend
só copia `backend/app` pra dentro da imagem (`COPY app ./app`), então os arquivos
precisam estar dentro dessa pasta pra existir de verdade no container rodando na VPS.

### Banco (`schema.sql`)

```sql
ALTER TABLE pacientes ADD COLUMN data_nascimento DATE;
```

Aplicado manualmente no Neon, como todo o resto do schema neste projeto (sem migration
runner).

### Envio por email

Estende `notificacoes.enviar_email_sessao` (ou adiciona uma função irmã) pra aceitar um
anexo opcional, usando o suporte a `attachments` do SDK Python do Resend
(`resend.Emails.send({..., "attachments": [...]})`). **A implementação precisa verificar
o formato exato esperado (nome do campo, se é base64 ou path, etc.) na documentação
atual do pacote `resend` instalado — não presumir a partir de memória.**

### Envio por WhatsApp

Nova função em `backend/app/evolution.py`, ao lado de `enviar_mensagem_texto`, pra
mandar documento (a API hoje só manda texto). **A implementação precisa verificar o
endpoint e formato exato de envio de mídia da Evolution API rodando neste projeto (ex:
`POST /message/sendMedia/{instance}`, mas o schema de campos exige confirmação — não
presumir a partir de memória, ver `docker-compose.yml`/painel do Evolution Manager ou a
documentação oficial da versão em uso).**

### Pontos de disparo

- `POST /sessoes` (main.py, função `criar_sessao`): `_buscar_info_notificacao` passa a
  também trazer `tipo_procedimento`, `data_nascimento`, `telefone` do paciente e
  `whatsapp_instance` do profissional. Depois do `enviar_email_sessao` de confirmação já
  existente, chama `anamnese.enviar_anamnese(...)`.
- `backend/app/lembretes.py` (`verificar_e_enviar_lembretes`): a query já faz `JOIN
  pacientes p` — adiciona `p.tipo_procedimento, p.data_nascimento, p.telefone` ao
  `SELECT`, e `pr.whatsapp_instance` ao join de `profissionais`. Depois do
  `enviar_email_sessao` de lembrete já existente, chama `anamnese.enviar_anamnese(...)`.

### Frontend

`frontend/src/components/PacientesTable.tsx`: o formulário de criar/editar paciente
ganha um campo **"Data de nascimento"** (`type="date"`, opcional — sem `required`, já
que pacientes existentes não têm esse dado e não devem ser bloqueados de editar outra
coisa por causa disso). Segue o mesmo padrão visual dos outros campos do formulário.
`frontend/src/lib/format.ts`: tipo `Paciente` ganha `data_nascimento: string | null`.

## Fora de escopo

- Nenhuma tela nova — só um campo a mais no formulário que já existe.
- Sem conversão de `.docx` pra PDF — envia o Word original.
- Sem reenvio manual pelo painel (ex: botão "reenviar anamnese") — só os dois disparos
  automáticos já descritos.
- Sem lógica de "já enviei, não manda de novo" — o duplo envio (confirmação + lembrete)
  é intencional, conforme decidido.

## Plano de verificação

- Criar/editar um paciente com `tipo_procedimento = neuromodulacao` e uma
  `data_nascimento` que dê menos de 12 anos; criar uma sessão pra esse paciente; conferir
  que o email de confirmação chega com o anexo infantil (ou que, sem email cadastrado, a
  mensagem de WhatsApp com o documento chega).
- Repetir com idade acima de 12 anos e conferir que vem o adulto.
- Conferir que um paciente com `tipo_procedimento = terapia` NÃO recebe nada.
- Conferir que um paciente com `data_nascimento` nula recebe a versão adulto.
- Esperar o loop de lembrete rodar (ou simular manualmente) e conferir que o anexo
  também chega no lembrete de 24h.
