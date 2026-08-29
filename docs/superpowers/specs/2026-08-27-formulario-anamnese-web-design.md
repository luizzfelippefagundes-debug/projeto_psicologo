# Formulário Web de Anamnese — Design

## Contexto

Hoje, quando um paciente agenda um procedimento de estimulação/neuromodulação, o sistema manda um arquivo `.docx` (versão adulto ou infantil, decidido pela idade) por email ou WhatsApp, pra ele preencher e trazer na consulta. Isso já funciona (`backend/app/anamnese.py`), mas os dados ficam soltos em arquivos — nada estruturado, nada visível no painel.

Este documento troca esse envio de arquivo por um **link de formulário web**: o paciente abre, preenche online, e as respostas ficam guardadas no sistema, visíveis em duas telas novas do painel (uma lista geral e uma aba dentro de cada paciente).

## Decisões já tomadas

- O link **substitui completamente** o envio do `.docx` (não há mais fallback de arquivo).
- Um token único **por paciente**, que **nunca expira**. Reenviar antes de responder manda o mesmo link (funciona como lembrete); depois de responder, novos envios são pulados.
- A lista nova em Pacientes mostra **só quem precisa preencher** (procedimento de estimulação/neuromodulação — mesmo filtro que já existe em `anamnese.PROCEDIMENTOS_COM_ANAMNESE`).
- Existem **duas telas**: uma sub-aba "Anamneses" ao lado de "Contatos" (lista geral, todos os pacientes que precisam), e uma aba "Anamnese" dentro da página de cada paciente (mostra as respostas dele).

## Arquitetura

### 1. Página pública do formulário

Rota nova `frontend/src/app/anamnese/[token]/page.tsx`, **fora** do grupo `(app)` (sem sidebar, sem checar sessão — o paciente não tem login). Ela:
1. Busca `GET {BACKEND_URL}/anamnese/{token}` direto no backend (fetch comum do browser — não usa o proxy `/api` porque não há cookie de sessão envolvido; o CORS do backend já libera a origem do frontend).
2. Se o token não existir → mensagem de erro genérica ("Link inválido").
3. Se já foi respondido (`respondido_em` não nulo) → mensagem "Você já respondeu esse formulário em DD/MM/AAAA. Obrigada!" (não reexibe as respostas — quem revê é a profissional, pelo painel).
4. Senão → renderiza o formulário certo (adulto ou infantil, conforme `tipo_formulario` que a API devolve) e, ao enviar, faz `POST {BACKEND_URL}/anamnese/{token}` com as respostas.

### 2. Backend — endpoints públicos

Dois endpoints novos em `main.py`, **sem** `Depends(auth.get_current_profissional_id)` (não são autenticados por sessão — o token na URL é a própria autenticação, como um link mágico):

- `GET /anamnese/{token}` → `{"paciente_nome": str, "tipo_formulario": "adulto" | "infantil", "respondido": bool}`. 404 se o token não existir.
- `POST /anamnese/{token}` → recebe `{"respostas": {...}}` (JSON livre, vindo do formulário do frontend), grava em `anamnese_respostas.respostas` e marca `respondido_em = now()`. 409 se já tiver sido respondido (evita reenvio duplicado por engano, ex: paciente clica "enviar" duas vezes). 404 se o token não existir.

O backend **não valida os campos individualmente** — só recebe e guarda o JSON como veio. Quem define e valida a forma dos campos é o frontend (schema único, ver seção 4). Isso evita duplicar a lista de ~48 campos em Python e TypeScript.

### 3. Modelo de dados

```sql
CREATE TABLE anamnese_respostas (
    id SERIAL PRIMARY KEY,
    paciente_id INTEGER NOT NULL UNIQUE REFERENCES pacientes(id) ON DELETE CASCADE,
    token VARCHAR(64) NOT NULL UNIQUE,
    tipo_formulario VARCHAR(10) NOT NULL CHECK (tipo_formulario IN ('adulto', 'infantil')),
    respostas JSONB,
    enviado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    respondido_em TIMESTAMPTZ
);
```

`paciente_id UNIQUE` garante uma linha por paciente (um token, uma resposta). `respostas` começa `NULL` e só é preenchido no `POST`.

### 4. `anamnese.py` — troca o anexo pelo link

`determinar_arquivo` (que hoje devolve um `Path` pro `.docx` certo) vira `determinar_tipo_formulario(tipo_procedimento, data_nascimento) -> "adulto" | "infantil" | None`, com a mesma lógica de corte de idade que já existe.

`enviar_anamnese` muda de "gerar arquivo e mandar anexo" pra "gerar/reaproveitar token e mandar link":
1. Se `determinar_tipo_formulario` retornar `None` → não faz nada (mesmo comportamento de hoje pra procedimentos sem anamnese).
2. Busca ou cria a linha em `anamnese_respostas` pro `paciente_id` (`ON CONFLICT (paciente_id) DO NOTHING` — se já existe, reaproveita o token existente em vez de gerar outro).
3. Se `respondido_em` já estiver preenchido → não manda nada (não reenvia pra quem já respondeu).
4. Monta o link: `{settings.frontend_url}/anamnese/{token}`.
5. Manda por email (`notificacoes.enviar_email_link`, novo — corpo HTML com um botão "Preencher formulário", em vez do anexo) ou WhatsApp (`evolution.enviar_mensagem_texto`, que já existe — mensagem de texto simples com o link), mesma prioridade de canal (email primeiro) já usada hoje.

**Mudança de assinatura**: pra fazer o `ON CONFLICT (paciente_id)` do passo 2, `enviar_anamnese` precisa saber o `paciente_id` — hoje ela não recebe isso (só recebe email/telefone/nome/tipo_procedimento/data_nascimento/whatsapp_instance). Isso exige adicionar um parâmetro `paciente_id: int` novo e atualizar os **4 pontos que já chamam essa função** hoje:
- `main.py:criar_sessao` — já tem `body.paciente_id` disponível.
- `bot.py:criar_agendamento` — já tem `paciente["id"]` disponível.
- `bot.py:confirmar_horario_reservado` — já tem `sessao["paciente_id"]` disponível (vem do `RETURNING` do próprio `UPDATE`).
- `lembretes.py` (loop de lembrete de 24h) — a query desse loop **não seleciona `paciente_id` hoje**, precisa adicionar `s.paciente_id` ao `SELECT` existente.

Todos os outros parâmetros de `enviar_anamnese` continuam os mesmos — só está sendo adicionado `paciente_id`, não removido nada.

Nova config `frontend_url: str` em `config.py` (default `"https://frontend-theta-weld-74.vercel.app"`), usada pra montar o link — hoje não existe nenhuma variável assim no backend.

`evolution.enviar_documento` (usado só pelo envio de `.docx`) fica sem uso depois dessa mudança — removido, junto com os dois arquivos `backend/app/anexos/*.docx` (não fazem mais sentido no repo).

### 5. Schema dos campos (fonte única de verdade: frontend)

Novo arquivo `frontend/src/lib/anamneseSchema.ts`, exportando `CAMPOS_ADULTO` e `CAMPOS_INFANTIL`: arrays de `{ id: string; secao: string; label: string; tipo: "texto" | "textarea" | "data" | "booleano" }`. Usado tanto pra **renderizar o formulário público** (gera um campo por entrada) quanto pra **exibir as respostas** na aba do paciente no painel (mapeia `id → label` pra mostrar de forma legível, não como JSON cru).

Campos derivados do `.docx` atual, **excluindo** a tabela de registro das aplicações de tDCS e as assinaturas (isso continua sendo preenchido pela profissional durante o tratamento, fora do formulário do paciente). Para perguntas do tipo "( ) Sim — Quando? ___", viram dois campos: um `booleano` e um `texto` de detalhe (o detalhe só aparece habilitado na UI quando o booleano está marcado).

**Formulário adulto** (`CAMPOS_ADULTO`):

| Seção | id | Label | Tipo |
|---|---|---|---|
| Dados de identificação | `nome_completo` | Nome completo | texto |
| Dados de identificação | `data_nascimento` | Data de nascimento | data |
| Dados de identificação | `sexo` | Sexo | texto |
| Dados de identificação | `endereco` | Endereço | texto |
| Dados de identificação | `telefone` | Telefone | texto |
| Dados de identificação | `responsavel` | Responsável (se aplicável) | texto |
| Dados de identificação | `profissao` | Profissão | texto |
| Queixa principal | `motivo_aplicacao` | Motivo da aplicação da tDCS | textarea |
| História da doença atual | `inicio_sintomas` | Início dos sintomas | textarea |
| História da doença atual | `fatores_desencadeantes` | Fatores desencadeantes | textarea |
| História da doença atual | `frequencia_intensidade` | Frequência e intensidade | textarea |
| História da doença atual | `tratamentos_anteriores` | Tratamentos anteriores | textarea |
| Histórico médico — neurológico | `avc` | AVC | booleano |
| Histórico médico — neurológico | `avc_detalhe` | Quando? Sequelas? | texto |
| Histórico médico — neurológico | `traumatismo_craniano` | Traumatismo craniano | booleano |
| Histórico médico — neurológico | `traumatismo_detalhe` | Quando? | texto |
| Histórico médico — neurológico | `epilepsia` | Epilepsia/Convulsões | booleano |
| Histórico médico — neurológico | `epilepsia_detalhe` | Última crise | texto |
| Histórico médico — neurológico | `tumores_cerebrais` | Tumores cerebrais | booleano |
| Histórico médico — neurológico | `enxaquecas_frequentes` | Enxaquecas frequentes | booleano |
| Histórico médico — neurológico | `doenca_neurodegenerativa` | Doença neurodegenerativa | booleano |
| Histórico médico — neurológico | `doenca_neurodegenerativa_detalhe` | Qual? | texto |
| Histórico médico — cardíaco | `infarto` | Infarto | booleano |
| Histórico médico — cardíaco | `infarto_detalhe` | Quando? | texto |
| Histórico médico — cardíaco | `arritmia` | Arritmia | booleano |
| Histórico médico — cardíaco | `marca_passo` | Marca-passo | booleano |
| Histórico médico — cirurgias | `cirurgias` | Já realizou cirurgias? Quais? | textarea |
| Histórico médico — cirurgias | `implantes_metalicos` | Implantes metálicos na cabeça/face? | booleano |
| Histórico médico — cirurgias | `implante_coclear` | Implante coclear? | booleano |
| Histórico médico | `internacoes` | Já foi internado? Quando e por qual motivo? | textarea |
| Histórico médico | `medicamentos_atuais` | Quais medicamentos usa atualmente? | textarea |
| Histórico médico | `alergias` | Tem alergia a algum medicamento, metal ou cosmético? | textarea |
| Histórico médico — psiquiátrico | `depressao` | Depressão | booleano |
| Histórico médico — psiquiátrico | `ansiedade` | Ansiedade | booleano |
| Histórico médico — psiquiátrico | `tea` | TEA | booleano |
| Histórico médico — psiquiátrico | `tdah` | TDAH | booleano |
| Histórico médico — psiquiátrico | `outra_condicao_psiquiatrica` | Outra condição psiquiátrica | texto |
| Histórico médico — psiquiátrico | `internacoes_psiquiatricas` | Internações psiquiátricas | textarea |
| Histórico familiar | `doencas_neurologicas_familia` | Doenças neurológicas na família (AVC, epilepsia) | textarea |
| Histórico familiar | `transtornos_psiquiatricos_familia` | Transtornos psiquiátricos na família | textarea |
| Condições atuais | `febre_infeccao` | Febre ou infecção? | texto |
| Condições atuais | `feridas_couro_cabeludo` | Feridas no couro cabeludo? | texto |
| Condições atuais | `esta_gravida` | Está grávida? | texto |
| Condições atuais | `dor_cabeca_hoje` | Dor de cabeça intensa hoje? | texto |
| Hábitos de vida | `qualidade_sono` | Qualidade do sono | texto |
| Hábitos de vida | `uso_alcool` | Uso de álcool | booleano |
| Hábitos de vida | `uso_alcool_frequencia` | Frequência | texto |
| Hábitos de vida | `tabagismo` | Tabagismo | booleano |
| Hábitos de vida | `tabagismo_quantidade` | Quantidade por dia | texto |
| Hábitos de vida | `uso_drogas_ilicitas` | Uso de drogas ilícitas | texto |
| Contraindicações | `epilepsia_ativa` | Epilepsia ativa? | booleano |
| Contraindicações | `implantes_metalicos_cabeca` | Implantes metálicos na cabeça? | booleano |
| Contraindicações | `lesoes_couro_cabeludo` | Lesões ou infecções no couro cabeludo? | booleano |
| Objetivo do tratamento | `funcao_a_trabalhar` | Função a ser trabalhada (atenção, memória, linguagem, humor, controle motor, etc.) | texto |
| Objetivo do tratamento | `ja_fez_tdcs` | Já realizou tDCS antes? Como foi? | textarea |

**Formulário infantil** (`CAMPOS_INFANTIL`):

| Seção | id | Label | Tipo |
|---|---|---|---|
| Dados de identificação | `nome_crianca` | Nome completo da criança | texto |
| Dados de identificação | `data_nascimento` | Data de nascimento | data |
| Dados de identificação | `sexo` | Sexo | texto |
| Dados de identificação | `nome_responsavel` | Nome do responsável | texto |
| Dados de identificação | `telefone_contato` | Telefone para contato | texto |
| Dados de identificação | `endereco` | Endereço | texto |
| Dados de identificação | `escola` | Escola | texto |
| Dados de identificação | `ano_escolar` | Ano escolar | texto |
| Dados de identificação | `profissionais_acompanham` | Profissionais que acompanham a criança | textarea |
| Queixa principal | `dificuldade_preocupa_familia` | Qual a principal dificuldade ou comportamento que preocupa a família? | textarea |
| Queixa principal | `motivo_busca_tdcs` | O que motivou a busca pela aplicação do tDCS? | textarea |
| Desenvolvimento | `gestacao_parto` | Como foi a gestação e o parto? (prematuridade, intercorrências, medicamentos) | textarea |
| Desenvolvimento | `internacao_uti_neonatal` | Houve internação na UTI neonatal? | texto |
| Desenvolvimento | `marcos_motores` | Quando começou a sentar, engatinhar e andar? | texto |
| Desenvolvimento | `primeiras_palavras` | Quando falou as primeiras palavras? | texto |
| Desenvolvimento | `fala_comunicacao_atual` | Como está a fala e a comunicação atualmente? | textarea |
| Desenvolvimento | `usa_frases_conversas` | A criança usa frases? Consegue manter conversas? | texto |
| Condições médicas | `diagnostico_tea` | TEA | booleano |
| Condições médicas | `diagnostico_tdah` | TDAH | booleano |
| Condições médicas | `diagnostico_atraso_linguagem` | Atraso de linguagem | booleano |
| Condições médicas | `diagnostico_apraxia_fala` | Apraxia de fala | booleano |
| Condições médicas | `diagnostico_epilepsia` | Epilepsia | booleano |
| Condições médicas | `diagnostico_outro` | Outro diagnóstico | texto |
| Condições médicas | `episodio_convulsao` | Algum episódio de convulsão? | booleano |
| Condições médicas | `convulsao_ultima_crise` | Última crise | texto |
| Condições médicas | `historico_avc_tce_lesoes` | Histórico de AVC, traumatismo craniano ou lesões cerebrais? | textarea |
| Condições médicas | `cirurgias` | Já realizou cirurgias? Quais? | textarea |
| Condições médicas | `internacoes` | Já ficou internado? Por qual motivo? | textarea |
| Condições médicas | `medicamentos_atuais` | Faz uso de algum medicamento atualmente? Quais? Horários? | textarea |
| Condições médicas | `alergias` | Tem alergia a algum medicamento ou material? | textarea |
| Fono e psicológico | `crianca_fala` | A criança fala? | booleano |
| Fono e psicológico | `usa_comunicacao_alternativa` | Usa Comunicação Alternativa (figuras, tablet)? | texto |
| Fono e psicológico | `compreensao_ordens_simples` | Como é a compreensão de ordens simples (ex: "traz a bola")? | textarea |
| Fono e psicológico | `interage_outras_pessoas` | A criança interage com outras pessoas? (olha nos olhos, brinca junto) | textarea |
| Fono e psicológico | `comportamentos_repetitivos` | Tem comportamentos repetitivos (balanço, bater as mãos)? | textarea |
| Fono e psicológico | `dificuldades_sensoriais` | Tem dificuldades com barulhos, texturas ou sabores? | textarea |
| Fono e psicológico | `sono` | Como é o sono? Dorme bem? | textarea |
| Fono e psicológico | `alimentacao` | Como é a alimentação? Aceita alimentos variados? | textarea |
| Rotina e comportamento | `comportamento_escola` | Frequenta escola? Como se comporta lá? | textarea |
| Rotina e comportamento | `atencao_atividades` | Consegue manter atenção em atividades? Por quanto tempo? | textarea |
| Rotina e comportamento | `crises_irritacao` | Tem crises de irritação? O que desencadeia? | textarea |
| Rotina e comportamento | `brincadeiras_favoritas` | O que a criança gosta de fazer (brincadeiras favoritas)? | textarea |
| Objetivo do tratamento | `funcao_atencao` | Atenção | booleano |
| Objetivo do tratamento | `funcao_controle_impulsos` | Controle de impulsos | booleano |
| Objetivo do tratamento | `funcao_linguagem_fala` | Linguagem e fala | booleano |
| Objetivo do tratamento | `funcao_comportamento` | Comportamento | booleano |
| Objetivo do tratamento | `funcao_memoria` | Memória | booleano |
| Objetivo do tratamento | `funcao_humor` | Humor | booleano |
| Objetivo do tratamento | `ja_fez_tdcs_crianca` | A criança já fez tDCS antes? Como foi a experiência? | textarea |

Só `nome_completo`/`nome_crianca` são obrigatórios pra enviar o formulário — o resto é opcional (pais/pacientes às vezes não sabem responder tudo, e travar o envio nisso seria pior que ter uma resposta incompleta).

### 6. Telas do painel

**Sub-aba "Anamneses"** (`frontend/src/components/PacientesTable.tsx`, terceira aba ao lado de Pacientes/Contatos): tabela com nome do paciente, telefone, status (`Não enviado` / `Aguardando resposta` desde [data] / `Respondido em` [data]), e um link "ver respostas" pra quem já respondeu (abre a aba do paciente).

Endpoint novo `GET /pacientes-anamnese`: junta `pacientes` (filtrado por `tipo_procedimento` em `('reabilitacao_com_estimulacao', 'neuromodulacao')`) com `anamnese_respostas` (`LEFT JOIN`, pode não existir linha ainda se nunca foi enviado).

**Aba "Anamnese"** dentro de `PacienteDetalhe.tsx` (nova aba na lista `ABAS`, ao lado de "Visão geral"/"Histórico de sessões"): se não há resposta ainda, mostra "Ainda não respondeu" (com a data de envio, se já foi enviado). Se respondeu, mostra os campos agrupados por seção, usando `CAMPOS_ADULTO`/`CAMPOS_INFANTIL` (conforme `tipo_formulario`) pra traduzir `id → label`, pulando campos de detalhe vazios quando o booleano correspondente for falso/vazio.

Endpoint novo `GET /pacientes/{id}/anamnese`: devolve a linha de `anamnese_respostas` desse paciente (ou 404 se nunca foi criada).

## Fora de escopo

- Edição de resposta pelo paciente depois de enviado (ele só vê "já respondeu").
- Edição das respostas pelo painel (a profissional só visualiza; se precisar corrigir algo, é conversa direta com o paciente, não uma tela de edição).
- Validação client-side rígida além de "nome é obrigatório" — sem exigir preencher os ~48 campos.
- Pré-preencher `nome`/`data_nascimento` a partir do cadastro existente do paciente — o formulário pergunta de novo, igual o `.docx` já fazia.
- Exportar as respostas em PDF/imprimir — só visualização na tela por enquanto.

## Testes / verificação manual

Sem suite automatizada (mesmo padrão do projeto). Verificação via:
1. Gerar um link de teste, abrir no navegador, preencher e enviar — conferir que a resposta aparece na sub-aba Anamneses e na aba do paciente.
2. Abrir o mesmo link de novo depois de responder — conferir que mostra "já respondeu" e não deixa reenviar (o `POST` retorna 409 se tentado diretamente).
3. Criar uma sessão pra um paciente com procedimento de estimulação — conferir que o email/WhatsApp chega com o link (não mais com anexo).
4. Testar com o mesmo paciente numa segunda sessão (ex: lembrete de 24h) sem ter respondido ainda — conferir que reenvia o **mesmo** link. Depois de responder, testar que um novo gatilho não manda nada.
