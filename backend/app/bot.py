from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import anthropic
import asyncpg

from app import db, notificacoes
from app.config import settings

MENSAGEM_ACOLHIMENTO = (
    "Entendo que isso é importante, e quero que você saiba que não está sozinho(a) nisso. "
    "Já avisei {profissional} agora mesmo, e ela(e) vai entrar em contato com você o quanto antes."
)
MENSAGEM_ERRO_IA = (
    "Estou com uma instabilidade técnica aqui do meu lado agora. "
    "Pode mandar sua mensagem de novo daqui a pouco?"
)

BRASILIA = ZoneInfo("America/Sao_Paulo")
MODELO = "claude-haiku-4-5"
MAX_TOKENS_RESPOSTA = 1024
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
    agora = datetime.now(BRASILIA)

    for regra in regras:
        inicio = datetime.combine(data, regra["hora_inicio"], tzinfo=BRASILIA)
        fim_janela = datetime.combine(data, regra["hora_fim"], tzinfo=BRASILIA)
        candidato = inicio
        while candidato + duracao <= fim_janela:
            candidato_fim = candidato + duracao
            conflito = candidato < agora or any(
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
    consentimento_lgpd: bool = False,
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
            if not consentimento_lgpd:
                raise ValueError(
                    "Antes de agendar, preciso do consentimento explícito do paciente pra tratar "
                    "os dados de saúde dele conforme a LGPD. Pergunte se ele concorda, e só chame "
                    "essa ferramenta de novo com consentimento_lgpd=true depois que ele confirmar."
                )
            paciente = await conn.fetchrow(
                """
                INSERT INTO pacientes (profissional_id, nome, telefone, tipo_atendimento, consentimento_lgpd, consentimento_lgpd_data)
                VALUES ($1, $2, $3, 'individual', true, now())
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


async def escalar_conversa(
    profissional_id: int, telefone_paciente: str, motivo: str, resumo: str
) -> None:
    if motivo not in ("crise", "fora_do_escopo"):
        motivo = "fora_do_escopo"

    async with db.pool.acquire() as conn:
        paciente_id = await conn.fetchval(
            "SELECT id FROM pacientes WHERE profissional_id = $1 AND telefone = $2",
            profissional_id, telefone_paciente,
        )
        await conn.execute(
            """
            INSERT INTO conversas_escalonadas (profissional_id, paciente_id, telefone_paciente, previa_conversa, motivo)
            VALUES ($1, $2, $3, $4, $5)
            """,
            profissional_id, paciente_id, telefone_paciente, resumo, motivo,
        )
        profissional = await conn.fetchrow(
            "SELECT nome, email FROM profissionais WHERE id = $1", profissional_id
        )

    await notificacoes.enviar_alerta_crise(
        profissional_email=profissional["email"],
        profissional_nome=profissional["nome"],
        motivo=motivo,
        resumo_conversa=resumo,
        telefone_paciente=telefone_paciente,
    )


TOOLS = [
    {
        "name": "consultar_horarios_disponiveis",
        "description": (
            "Consulta os horários realmente livres para agendamento em um local, numa data "
            "específica. Sempre use esta ferramenta antes de oferecer um horário — nunca invente "
            "ou suponha disponibilidade."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "local_nome": {"type": "string", "description": "Nome do local de atendimento"},
                "data": {"type": "string", "description": "Data no formato YYYY-MM-DD"},
                "duracao_minutos": {"type": "integer", "description": "Duração da sessão em minutos (padrão 50)"},
            },
            "required": ["local_nome", "data"],
        },
    },
    {
        "name": "criar_agendamento",
        "description": (
            "Cria de fato o agendamento pro paciente, depois que ele confirmou um horário "
            "que veio de consultar_horarios_disponiveis."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "nome_paciente": {"type": "string", "description": "Nome do paciente"},
                "local_nome": {"type": "string"},
                "data_hora": {"type": "string", "description": "Data e hora no formato YYYY-MM-DDTHH:MM"},
                "modalidade": {"type": "string", "enum": ["presencial", "teleconsulta"]},
                "duracao_minutos": {"type": "integer"},
                "consentimento_lgpd": {
                    "type": "boolean",
                    "description": (
                        "Só true se for a primeira sessão desse paciente E ele já confirmou "
                        "explicitamente que concorda com o tratamento dos dados de saúde dele "
                        "conforme a LGPD. Pra pacientes que já têm cadastro, não precisa disso."
                    ),
                },
            },
            "required": ["nome_paciente", "local_nome", "data_hora"],
        },
    },
    {
        "name": "acolher_e_escalar",
        "description": (
            "Use quando o paciente relatar uma situação de crise (risco a si ou a terceiros, "
            "desespero agudo, etc.) ou pedir algo fora do escopo de um bot de agendamento (ex: "
            "orientação clínica, diagnóstico, aconselhamento). NÃO tente ajudar, aconselhar ou "
            "resolver — apenas chame esta ferramenta pra acolher e notificar a profissional."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "motivo": {"type": "string", "enum": ["crise", "fora_do_escopo"]},
                "resumo": {
                    "type": "string",
                    "description": "Breve resumo do que o paciente disse, pra dar contexto à profissional.",
                },
            },
            "required": ["motivo", "resumo"],
        },
    },
]


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
                entrada.get("consentimento_lgpd", False),
            )
            return f"Agendamento criado com sucesso: {resultado}"

        if nome == "acolher_e_escalar":
            await escalar_conversa(
                profissional_id, telefone_paciente, entrada["motivo"], entrada["resumo"]
            )
            return "ESCALADO"

        return f"Ferramenta desconhecida: {nome}"
    except ValueError as e:
        return f"Erro: {e}"


async def processar_mensagem(
    profissional_id: int, telefone_paciente: str, mensagem: str, historico: list[dict]
) -> dict:
    if not settings.anthropic_api_key:
        return {
            "resposta": (
                "Bot ainda não está configurado (falta a chave da API da Anthropic). "
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
    agora_str = datetime.now(BRASILIA).strftime("%Y-%m-%d %H:%M (%A)")

    system_prompt = (
        f"Você é o assistente de agendamento de {profissional['nome']}, respondendo pelo WhatsApp "
        f"a um paciente. Seja breve, cordial e direto, em português do Brasil.\n"
        f"Agora é {agora_str} (horário de Brasília).\n"
        f"Locais de atendimento disponíveis: {nomes_locais}.\n"
        "Sempre use consultar_horarios_disponiveis antes de oferecer um horário — nunca invente e "
        "nunca reaproveite uma lista de horários que você já deu antes na conversa, mesmo que seja "
        "pra mesma data: o tempo passa e outros pacientes podem ter agendado nesse meio tempo, "
        "então chame a ferramenta de novo a cada vez que o paciente perguntar sobre disponibilidade. "
        "Só use criar_agendamento depois que o paciente confirmar explicitamente um horário oferecido. "
        "Se faltar informação (local, data, nome do paciente), pergunte antes de usar as ferramentas. "
        "Se for a primeira sessão de um paciente novo, pergunte explicitamente se ele concorda com o "
        "tratamento dos dados de saúde dele conforme a LGPD antes de chamar criar_agendamento, e só "
        "passe consentimento_lgpd=true depois que ele confirmar.\n"
        "Se o paciente relatar uma situação de crise ou pedir algo fora do escopo de agendamento "
        "(conselho clínico, diagnóstico, etc.), NÃO tente ajudar — chame acolher_e_escalar imediatamente."
    )

    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    messages = [{"role": m["role"], "content": m["content"]} for m in historico]
    messages.append({"role": "user", "content": mensagem})
    acoes: list[str] = []

    for _ in range(MAX_RODADAS_FERRAMENTA):
        try:
            resposta = await client.messages.create(
                model=MODELO,
                max_tokens=MAX_TOKENS_RESPOSTA,
                system=system_prompt,
                tools=TOOLS,
                messages=messages,
            )
        except anthropic.APIError:
            return {"resposta": MENSAGEM_ERRO_IA, "acoes": acoes}

        chamadas = [b for b in resposta.content if b.type == "tool_use"]
        if not chamadas:
            texto = "".join(b.text for b in resposta.content if b.type == "text")
            return {"resposta": texto, "acoes": acoes}

        messages.append({"role": "assistant", "content": resposta.content})
        resultados_ferramenta = []
        for chamada in chamadas:
            resultado = await _executar_ferramenta(
                profissional_id, telefone_paciente, chamada.name, chamada.input
            )
            if chamada.name == "acolher_e_escalar" and resultado == "ESCALADO":
                # Mensagem fixa, não deixamos o modelo gerar a resposta numa situação sensível
                acoes.append(f"Escalado para a profissional (motivo: {chamada.input.get('motivo')})")
                return {
                    "resposta": MENSAGEM_ACOLHIMENTO.format(profissional=profissional["nome"]),
                    "acoes": acoes,
                }
            if chamada.name == "criar_agendamento" and not resultado.startswith("Erro:"):
                acoes.append(resultado)
            resultados_ferramenta.append(
                {"type": "tool_result", "tool_use_id": chamada.id, "content": resultado}
            )
        messages.append({"role": "user", "content": resultados_ferramenta})

    return {
        "resposta": "Desculpa, não consegui concluir agora — pode tentar reformular seu pedido?",
        "acoes": acoes,
    }
