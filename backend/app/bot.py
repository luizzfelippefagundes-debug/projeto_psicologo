from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import asyncpg
from google import genai
from google.genai import types

from app import db
from app.config import settings

BRASILIA = ZoneInfo("America/Sao_Paulo")
MODELO = "gemini-flash-latest"
MAX_RODADAS_FERRAMENTA = 4


def _dia_semana_banco(d: date) -> int:
    # Python: segunda=0..domingo=6 | Banco: domingo=0..sábado=6
    return (d.weekday() + 1) % 7


async def horarios_disponiveis(
    profissional_id: int, local_nome: str, data_str: str, duracao_minutos: int = 50
) -> list[str]:
    async with db.pool.acquire() as conn:
        local = await conn.fetchrow(
            "SELECT id FROM locais WHERE profissional_id = $1 AND nome ILIKE $2",
            profissional_id, local_nome,
        )
        if local is None:
            raise ValueError(f"Não encontrei o local '{local_nome}'.")

        data = date.fromisoformat(data_str)
        dia_semana = _dia_semana_banco(data)

        regras = await conn.fetch(
            """
            SELECT hora_inicio, hora_fim FROM regras_horario
            WHERE profissional_id = $1 AND local_id = $2 AND dia_semana = $3 AND ativo
            ORDER BY hora_inicio
            """,
            profissional_id, local["id"], dia_semana,
        )
        if not regras:
            return []

        ocupados = await conn.fetch(
            """
            SELECT data_hora, duracao_minutos FROM sessoes
            WHERE profissional_id = $1 AND local_id = $2
              AND data_hora::date = $3 AND status <> 'cancelada'
            """,
            profissional_id, local["id"], data,
        )
        janelas_ocupadas = [
            (row["data_hora"], row["data_hora"] + timedelta(minutes=row["duracao_minutos"]))
            for row in ocupados
        ]

    livres: list[str] = []
    passo = timedelta(minutes=30)
    duracao = timedelta(minutes=duracao_minutos)

    for regra in regras:
        inicio = datetime.combine(data, regra["hora_inicio"], tzinfo=BRASILIA)
        fim_janela = datetime.combine(data, regra["hora_fim"], tzinfo=BRASILIA)
        candidato = inicio
        while candidato + duracao <= fim_janela:
            candidato_fim = candidato + duracao
            conflito = any(
                candidato < oc_fim and candidato_fim > oc_inicio
                for oc_inicio, oc_fim in janelas_ocupadas
            )
            if not conflito:
                livres.append(candidato.strftime("%H:%M"))
            candidato += passo

    return livres


async def criar_agendamento(
    profissional_id: int,
    nome_paciente: str,
    telefone_paciente: str,
    local_nome: str,
    data_hora_str: str,
    modalidade: str = "presencial",
    duracao_minutos: int = 50,
) -> dict:
    if modalidade not in ("presencial", "teleconsulta"):
        modalidade = "presencial"

    data_hora = datetime.fromisoformat(data_hora_str)
    if data_hora.tzinfo is None:
        data_hora = data_hora.replace(tzinfo=BRASILIA)

    async with db.pool.acquire() as conn:
        local = await conn.fetchrow(
            "SELECT id, nome FROM locais WHERE profissional_id = $1 AND nome ILIKE $2",
            profissional_id, local_nome,
        )
        if local is None:
            raise ValueError(f"Não encontrei o local '{local_nome}'.")

        paciente = await conn.fetchrow(
            "SELECT id, nome FROM pacientes WHERE profissional_id = $1 AND telefone = $2",
            profissional_id, telefone_paciente,
        )
        if paciente is None:
            paciente = await conn.fetchrow(
                """
                INSERT INTO pacientes (profissional_id, nome, telefone, tipo_atendimento)
                VALUES ($1, $2, $3, 'individual')
                RETURNING id, nome
                """,
                profissional_id, nome_paciente, telefone_paciente,
            )

        try:
            sessao = await conn.fetchrow(
                """
                INSERT INTO sessoes (profissional_id, paciente_id, local_id, data_hora, duracao_minutos, modalidade)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING id, data_hora, duracao_minutos, modalidade, status
                """,
                profissional_id, paciente["id"], local["id"], data_hora, duracao_minutos, modalidade,
            )
        except asyncpg.exceptions.ExclusionViolationError:
            raise ValueError("Esse horário acabou de ser ocupado por outra sessão. Escolha outro horário.")

    return {
        "sessao_id": sessao["id"],
        "paciente": paciente["nome"],
        "local": local["nome"],
        "data_hora": sessao["data_hora"].isoformat(),
        "modalidade": sessao["modalidade"],
    }


TOOLS = types.Tool(function_declarations=[
    types.FunctionDeclaration(
        name="consultar_horarios_disponiveis",
        description=(
            "Consulta os horários realmente livres para agendamento em um local, numa data "
            "específica. Sempre use esta ferramenta antes de oferecer um horário — nunca invente "
            "ou suponha disponibilidade."
        ),
        parametersJsonSchema={
            "type": "object",
            "properties": {
                "local_nome": {"type": "string", "description": "Nome do local de atendimento"},
                "data": {"type": "string", "description": "Data no formato YYYY-MM-DD"},
                "duracao_minutos": {"type": "integer", "description": "Duração da sessão em minutos (padrão 50)"},
            },
            "required": ["local_nome", "data"],
        },
    ),
    types.FunctionDeclaration(
        name="criar_agendamento",
        description=(
            "Cria de fato o agendamento pro paciente, depois que ele confirmou um horário "
            "que veio de consultar_horarios_disponiveis."
        ),
        parametersJsonSchema={
            "type": "object",
            "properties": {
                "nome_paciente": {"type": "string", "description": "Nome do paciente"},
                "local_nome": {"type": "string"},
                "data_hora": {"type": "string", "description": "Data e hora no formato YYYY-MM-DDTHH:MM"},
                "modalidade": {"type": "string", "enum": ["presencial", "teleconsulta"]},
                "duracao_minutos": {"type": "integer"},
            },
            "required": ["nome_paciente", "local_nome", "data_hora"],
        },
    ),
])


async def _executar_ferramenta(profissional_id: int, telefone_paciente: str, nome: str, entrada: dict) -> str:
    try:
        if nome == "consultar_horarios_disponiveis":
            horarios = await horarios_disponiveis(
                profissional_id,
                entrada["local_nome"],
                entrada["data"],
                entrada.get("duracao_minutos", 50),
            )
            if not horarios:
                return "Nenhum horário livre nesse dia."
            return "Horários livres: " + ", ".join(horarios)

        if nome == "criar_agendamento":
            resultado = await criar_agendamento(
                profissional_id,
                entrada["nome_paciente"],
                telefone_paciente,
                entrada["local_nome"],
                entrada["data_hora"],
                entrada.get("modalidade", "presencial"),
                entrada.get("duracao_minutos", 50),
            )
            return f"Agendamento criado com sucesso: {resultado}"

        return f"Ferramenta desconhecida: {nome}"
    except ValueError as e:
        return f"Erro: {e}"


def _historico_para_content(historico: list[dict]) -> list[types.Content]:
    papel = {"user": "user", "assistant": "model"}
    return [
        types.Content(role=papel.get(m["role"], "user"), parts=[types.Part.from_text(text=m["content"])])
        for m in historico
    ]


async def processar_mensagem(
    profissional_id: int, telefone_paciente: str, mensagem: str, historico: list[dict]
) -> dict:
    if not settings.gemini_api_key:
        return {
            "resposta": (
                "Bot ainda não está configurado (falta a chave da API do Gemini). "
                "Assim que a chave for adicionada, o agendamento por function calling funciona de verdade."
            ),
            "acoes": [],
        }

    async with db.pool.acquire() as conn:
        locais = await conn.fetch(
            "SELECT nome FROM locais WHERE profissional_id = $1 ORDER BY nome", profissional_id
        )
        profissional = await conn.fetchrow(
            "SELECT nome FROM profissionais WHERE id = $1", profissional_id
        )

    nomes_locais = ", ".join(l["nome"] for l in locais) or "nenhum local cadastrado ainda"
    hoje = datetime.now(BRASILIA).strftime("%Y-%m-%d (%A)")

    system_prompt = (
        f"Você é o assistente de agendamento de {profissional['nome']}, respondendo pelo WhatsApp "
        f"a um paciente. Seja breve, cordial e direto, em português do Brasil.\n"
        f"Hoje é {hoje}.\n"
        f"Locais de atendimento disponíveis: {nomes_locais}.\n"
        "Sempre use consultar_horarios_disponiveis antes de oferecer um horário — nunca invente. "
        "Só use criar_agendamento depois que o paciente confirmar explicitamente um horário oferecido. "
        "Se faltar informação (local, data, nome do paciente), pergunte antes de usar as ferramentas."
    )

    client = genai.Client(api_key=settings.gemini_api_key)
    config = types.GenerateContentConfig(system_instruction=system_prompt, tools=[TOOLS])
    contents = _historico_para_content(historico)
    contents.append(types.Content(role="user", parts=[types.Part.from_text(text=mensagem)]))
    acoes: list[str] = []

    for _ in range(MAX_RODADAS_FERRAMENTA):
        resposta = await client.aio.models.generate_content(
            model=MODELO, contents=contents, config=config
        )

        chamadas = resposta.function_calls
        if not chamadas:
            return {"resposta": resposta.text or "", "acoes": acoes}

        contents.append(resposta.candidates[0].content)
        partes_resultado = []
        for chamada in chamadas:
            resultado = await _executar_ferramenta(
                profissional_id, telefone_paciente, chamada.name, chamada.args
            )
            if chamada.name == "criar_agendamento" and not resultado.startswith("Erro:"):
                acoes.append(resultado)
            partes_resultado.append(
                types.Part.from_function_response(name=chamada.name, response={"resultado": resultado})
            )
        contents.append(types.Content(role="user", parts=partes_resultado))

    return {
        "resposta": "Desculpa, não consegui concluir agora — pode tentar reformular seu pedido?",
        "acoes": acoes,
    }
