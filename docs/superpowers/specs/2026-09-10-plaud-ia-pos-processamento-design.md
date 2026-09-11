# Pós-processamento com IA das gravações Plaud

## Contexto

A integração com a Plaud (`backend/app/plaud.py`, tabela `plaud_gravacoes`, aba `/plaud`) já recebe
transcrição e resumo estruturado (formato clínico com seções numeradas: `## 1. Histórico Relevante`,
`## 2. Estado de uso de substâncias`, etc.) via webhook do Zapier, assim que a Plaud termina de
processar uma gravação.

Depois de usar por alguns dias em produção, a psicóloga (Jamilly) trouxe três pedidos, discutidos e
confirmados numa conversa de WhatsApp relayada nesta sessão:

1. O resumo estruturado é útil, mas longo demais pro dia a dia — ela quer um texto curto, corrido,
   pronto pra usar/colar, além dele (não no lugar dele — "o restante tem no Plaud se eu precisar").
2. Ela quer poder criar o cadastro de um paciente novo a partir dos dados pessoais que aparecem na
   gravação, sem digitar tudo de novo manualmente.
3. Ela quer o "mapa mental" que a Plaud mostra pra cada gravação, também dentro do nosso sistema.

Pro item 3, pesquisa confirmou que a Plaud não expõe o mapa mental via webhook/API/CLI — só
exportação manual dentro do app dela (PNG ou Markdown, via botão Compartilhar). Mas o resumo
estruturado que já recebemos É, na prática, um esboço em Markdown (títulos e subtítulos aninhados) —
o mesmo formato que a Plaud usa pra exportar o mapa mental dela. Então dá pra desenhar um mapa mental
visual de verdade a partir do dado que já temos, sem precisar de nenhuma chamada nova à Plaud.

## Escopo desta leva

1. **Texto pronto**: resumo curto gerado por IA (Claude Haiku, sob demanda) a partir da transcrição.
2. **Mapa mental visual**: desenha o resumo estruturado existente como mapa interativo (biblioteca
   Markmap), sem IA nova — só uma forma diferente de mostrar o dado que já existe.
3. **Detectar dados do paciente**: IA extrai nome (e data de nascimento, se mencionada) da
   transcrição, só em gravações ainda não vinculadas, e leva pro formulário de cadastro já existente
   em Pacientes, pré-preenchido — ela sempre revisa e confirma antes de qualquer coisa ser salva.

Fora de escopo: qualquer processamento automático no momento do webhook (tudo é sob demanda, ela
clica um botão); criação de paciente sem ela confirmar o formulário; exportar/importar o mapa mental
de dentro do app da Plaud.

## Arquitetura

Novo módulo `backend/app/ia.py`, único ponto de contato com a Claude API (Anthropic, SDK oficial
`anthropic`, modelo Haiku — rápido e barato, adequado pra resumir texto curto e extrair 1-2 campos).
Nova env var `ANTHROPIC_API_KEY`. As duas funções desse módulo:

- `gerar_texto_curto(transcricao: str) -> str` — prompt pedindo um parágrafo corrido, sem títulos
  nem listas, resumindo a sessão em linguagem natural, focado no que é relevante clinicamente.
- `extrair_dados_paciente(transcricao: str) -> dict` — prompt pedindo JSON estrito com `nome`
  (string ou `null`) e `data_nascimento` (string no formato `YYYY-MM-DD` ou `null` — o mesmo formato
  que o campo `date` do HTML/Pydantic já espera em `PacienteBody.data_nascimento`), ambos `null` se
  não tiver certeza, com instrução explícita de nunca inventar dado que não esteja claramente dito no
  texto — inclusive quando só o dia/mês são mencionados (ex: "15 de agosto", sem ano), caso em que
  `data_nascimento` fica `null` (ano é obrigatório pra uma data válida). Resposta parseada com
  `json.loads`; se vier em formato inesperado, trata como "nada encontrado" em vez de derrubar a
  requisição (mesmo espírito defensivo de `_extrair_campo` em `plaud.py` — nunca deixa um formato de
  IA inesperado quebrar o endpoint).

Ambas as funções propagam falha de forma que o endpoint retorne um erro claro (ex: "IA indisponível,
tenta de novo") em vez de mascarar problema — diferente da extração de campos do webhook (que é
best-effort por design), aqui é uma ação que a profissional pediu explicitamente clicando um botão,
então ela precisa saber se não funcionou.

## 1) Texto pronto

**Banco:** nova coluna `plaud_gravacoes.texto_curto TEXT` (nullable).

**Backend:** `POST /plaud/gravacoes/{id}/texto-curto` — busca a transcrição da gravação (404 se não
existir ou não tiver transcrição), chama `ia.gerar_texto_curto`, salva em `texto_curto`, retorna o
texto. Pode ser chamado de novo pra regenerar (sobrescreve).

**Frontend:** dentro do card expandido de cada gravação (`PlaudGravacoesLista.tsx` e no modal de
"Vincular gravação" em `AgendaList.tsx`), os blocos passam a ser abas em vez de tudo empilhado — evita
um card gigante quando todos existem ao mesmo tempo. Ordem das abas: **Resumo | Texto pronto | Mapa
mental | Transcrição**, "Resumo" ativa por padrão (comportamento atual). Na aba "Texto pronto" (nova):
se `texto_curto` for `null`, mostra botão "Gerar texto pronto"; depois de gerado, mostra o texto com
um botão "Gerar de novo".

**Vincular a uma sessão:** `plaud.vincular_a_sessao` passa a montar o bloco
`— Resumo automático (Plaud) —` que cai em `sessoes.observacoes` usando `texto_curto` quando ele
existir, e cai pro `resumo` estruturado como está hoje quando não existir. Isso é o que responde o
"tem como transferir só o texto pronto?" dela — o que vai pra ficha da sessão é o texto curto sempre
que ele já tiver sido gerado.

## 2) Mapa mental visual

Sem IA nova — usa o `resumo` (Markdown com títulos/subtítulos) que já está salvo.

**Frontend:** nova dependência `markmap-lib` + `markmap-view` + `d3`. Novo componente
`MapaMentalPlaud.tsx` (client component): recebe o texto do resumo, usa `Transformer` (markmap-lib)
pra converter em árvore de dados e `Markmap.create` (markmap-view) pra desenhar num `<svg>`, via
`useRef`+`useEffect` (só roda no mount, é manipulação direta de DOM/D3, não tem nada de servidor
aqui). Vira a aba "Mapa mental" ao lado de Resumo/Texto pronto/Transcrição — só monta quando essa aba
está ativa (economiza o custo de desenhar o SVG se ela nunca clicar ali). O `<svg>` fica dentro de um
contêiner com fundo claro fixo (não segue o tema escuro do site), porque o Markmap desenha texto
escuro por padrão e não vale a pena brigar com a paleta de cores dele pra um componente que é só
visualização.

## 3) Detectar dados do paciente → criar cadastro

Só aparece em gravações **sem** `sessao_id` (não vinculadas) — pra uma já vinculada o paciente já
existe.

**Backend:** `POST /plaud/gravacoes/{id}/extrair-paciente` — busca a transcrição, chama
`ia.extrair_dados_paciente`, retorna `{ nome: string | null, data_nascimento: string | null }`. Não
salva nada no banco — é só extração, pra pré-preencher um formulário que ela ainda vai revisar.

**Frontend:** botão "Detectar dados do paciente" na gravação não vinculada. Se a extração não achar
nada, mostra "Não conseguimos identificar automaticamente — cadastre manualmente" com um link pra
Pacientes em branco. Se achar, mostra os dados encontrados com um botão "Usar esses dados" que leva
pra `/pacientes` com os dados pré-preenchidos, reaproveitando o fluxo `abrirCriacao({ nome, telefone })`
que já existe em `PacientesTable.tsx` (hoje usado pra pré-preencher a partir de contatos do bot do
WhatsApp) — passa `nome` (e `data_nascimento`, novo parâmetro opcional nesse mesmo prefill) via query
string. Telefone, tipo de atendimento e o consentimento LGPD continuam sempre em branco/desmarcado,
preenchidos e confirmados por ela manualmente — a IA nunca marca consentimento, e nada é gravado no
banco até ela mesma revisar e apertar Salvar no formulário normal de paciente (mesma validação,
mesma checagem de telefone duplicado que já existe hoje).

## Erros e limites

- Sem `ANTHROPIC_API_KEY` configurada: os dois endpoints novos retornam 503 com mensagem clara, em
  vez de derrubar o processo — o resto do sistema (Plaud, agenda, etc.) continua funcionando normal.
- Falha de rede/timeout na chamada à Claude: erro 502 com mensagem "não foi possível gerar agora,
  tenta de novo" — sem retry automático (ação sob demanda, ela decide se tenta de novo).
- Gravação sem transcrição ainda (caso raro, `transcricao` nula): os dois botões ficam desabilitados
  com texto explicando que precisa da transcrição primeiro.

## Teste manual (sem suite automatizada, seguindo o padrão já usado nesta integração)

Com a `ANTHROPIC_API_KEY` configurada: gerar texto pronto numa gravação real (a do Lucas, já em
produção) e conferir que o texto sai coerente e curto; vincular essa gravação a uma sessão e conferir
que `sessoes.observacoes` recebeu o texto curto, não o resumo inteiro; abrir a aba mapa mental e
conferir visualmente que a árvore bate com as seções do resumo; rodar "detectar dados do paciente"
numa gravação de teste sem paciente vinculado e conferir que os dados (ou o "não encontrado") batem
com o conteúdo real da transcrição, e que o formulário de Pacientes abre pré-preenchido corretamente.
