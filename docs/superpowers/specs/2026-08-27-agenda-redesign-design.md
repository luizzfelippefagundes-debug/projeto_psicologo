# Redesign visual da tela de Agenda

## Contexto

A tela de Agenda (`frontend/src/app/(app)/agenda/page.tsx` + `frontend/src/components/AgendaGrid.tsx`)
funciona bem tecnicamente (grid semanal, drag-and-drop pra reagendar, modais de criar/editar/visualizar
sessão), mas o visual foi considerado "nada profissional": linhas de horário finas (32px), texto
pequeno, cards de sessão discretos (fundo suave + borda esquerda fina), sem indicação de "agora", 7
colunas sempre visíveis (mesmo sábado/domingo vazios), e botões de navegação genéricos.

Esse documento cobre só a camada visual — nenhuma mudança de lógica de negócio, endpoint de backend,
ou comportamento de drag-and-drop/modais.

## Decisões (confirmadas com o usuário)

1. **Dias exibidos**: só segunda a sexta (5 colunas em vez de 7) — a clínica não atende fim de semana.
2. **Estilo dos cards de sessão**: sólido com sombra — fundo na cor de destaque (accent), texto branco,
   sombra suave elevando o card do restante do grid.
3. **Diferenciação de modalidade**: cor diferente — presencial usa `--color-accent` (rosa/mauve atual),
   teleconsulta usa `--color-gold` (já existe na paleta validada, dourado). Evita introduzir uma cor
   nova sem passar pelo validador de paleta.
4. **Cabeçalho/navegação**: compacto, com setas de ícone (‹ ›) num grupo ao lado de um botão **"Hoje"**
   que leva de volta pra semana atual (usa `hojeISO` já calculado na página).
5. **Extra incluído**: linha do "agora" — uma linha horizontal fina na cor de destaque, cruzando a
   coluna do dia de hoje na altura do horário atual, atualizando a cada minuto no client. Só aparece
   quando "hoje" está dentro da semana visível.
6. **Fora de escopo** (perguntado e recusado): contador de sessões da semana, destaque de fundo na
   coluna inteira de hoje.

## Design

### Grid (dias e dimensões)

- `weekDates` passa a conter só 5 datas (seg-sex) em vez de 7. Isso é calculado em
  `frontend/src/lib/format.ts` (`getWeekDates`) — hoje gera 7 dias a partir da segunda; muda pra gerar
  5. `getWeekStart` continua igual (semana ainda começa na segunda, só não lista sáb/dom).
- Grid CSS colunas: `grid-cols-[64px_repeat(5,1fr)]` (era `repeat(7,1fr)`), coluna de horário um pouco
  mais larga (64px vs 56px) pra caber o texto maior.
- Altura de cada slot de 30min sobe de `32px` pra `44px` (`gridTemplateRows: repeat(N, 44px)`).
- Texto do rótulo de hora sobe de `11.5px` pra `13px`.

### Cabeçalho da página (`agenda/page.tsx`)

- Título "Agenda" e o intervalo de datas mantêm posição, mas o bloco de navegação muda:
  - Botão "Hoje" (só aparece/fica desabilitado sutilmente se a semana visível já é a atual) — link pra
    `/agenda` sem query string (ou `?semana=<hojeISO da segunda-feira>`).
  - Dois botões de ícone (‹ e ›) lado a lado, visualmente agrupados (mesmo `div` com borda única em vez
    de dois cards separados), substituindo "← Semana anterior" / "Próxima semana →".

### Cards de sessão (`AgendaGrid.tsx`)

- Fundo passa a ser sólido: `bg-accent` (presencial) ou `var(--color-gold)` inline (teleconsulta), com
  `text-white`.
- Sombra: `shadow-[0_4px_10px_var(--color-shadow)]` no lugar do fundo suave atual.
- Remove a borda esquerda colorida (`border-l-[3px]`) — com fundo sólido ela fica redundante; a cor de
  fundo já comunica a modalidade, e a sombra já dá profundidade suficiente.
- Cantos: `rounded-lg` → `rounded-xl`.
- Hierarquia de texto dentro do card: horário pequeno (like hoje), nome do paciente em destaque
  (`font-bold`, tamanho maior que hoje), local como terceira linha secundária (opacidade reduzida,
  já existe).

### Linha do "agora"

- Novo elemento absolutamente posicionado dentro do grid de horários (não dentro de uma célula), calculado
  a partir da hora atual em `America/Sao_Paulo`: `top` proporcional à posição entre `HORAS[0]` e
  `HORAS[last]+1`, `left`/`width` limitados à coluna do dia de hoje (`gridColumn` calculado a partir do
  índice de `hojeISO` em `weekDates`, só renderiza se esse índice existir).
- Implementado com `useEffect` + `setInterval(60_000)` dentro de `AgendaGrid` (client component) pra
  recalcular a cada minuto — não precisa de WebSocket/polling do backend, é só relógio local.
- Estilo: linha de 2px na cor `--color-accent`, com uma bolinha pequena na ponta esquerda (na borda da
  coluna de horário) pra ficar visualmente clara mesmo em telas pequenas.

## Fora de escopo

- Nenhuma mudança em `backend/`, endpoints, schema, ou nos componentes de modal (`Modal.tsx`, formulário
  de criar/editar sessão) além de ajustes triviais de estilo se algo quebrar visualmente com o grid novo.
- Nenhuma visão alternativa (lista, mês) — só a semana atual, como já existe.
- Sem testes automatizados novos (o projeto não tem suíte de testes; validação é manual no navegador,
  como já é prática nesse projeto).

## Plano de verificação

Depois de implementado: rodar o frontend localmente (ou usar o preview deploy), abrir `/agenda` logado
como `luiz@teste.com`, conferir:
- Só 5 colunas (seg-sex), sem sábado/domingo.
- Cards de sessão existentes (ex: a sessão de 31/08 11:00 criada via bot) aparecem sólidos com sombra.
- Se houver sessão de teleconsulta, cor dourada; presencial, cor rosa/accent.
- Linha do "agora" aparece na coluna de hoje (se hoje for seg-sex) na altura certa, e desaparece se
  navegar pra outra semana.
- Botão "Hoje" volta pra semana atual; setas ‹ › navegam semana anterior/próxima.
- Drag-and-drop e modais de criar/editar/cancelar continuam funcionando sem regressão.
