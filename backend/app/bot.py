import logging
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import anthropic
import asyncpg

from app import anamnese, db, notificacoes, reservas
from app.config import settings

logger = logging.getLogger(__name__)

MENSAGEM_ACOLHIMENTO = (
    "Entendo que isso é importante, e quero que você saiba que não está sozinho(a) nisso. "
    "Já avisei {profissional} agora mesmo, e ela(e) vai entrar em contato com você o quanto antes."
)
MENSAGEM_ERRO_IA = (
    "Estou com uma instabilidade técnica aqui do meu lado agora. "
    "Pode mandar sua mensagem de novo daqui a pouco?"
)
MENSAGEM_CONFIRMACAO_SEM_AGENDAMENTO = (
    "Peraí, deixa eu confirmar direitinho antes: qual horário e local você quer mesmo? "
    "Quero ter certeza de que registrei tudo certo antes de confirmar pra você."
)
_PALAVRAS_CONFIRMACAO = ("confirmad", "marcad", "agendad", "reservad")

_PREFIXOS_ACAO_REAL = (
    "Agendamento criado com sucesso",
    "Horário reservado com sucesso",
    "Reserva confirmada com sucesso",
)


def _alega_confirmacao_sem_ter_agendado(texto: str, acoes: list[str]) -> bool:
    """Detecta o modelo dizendo que um agendamento/reserva foi feito sem ter chamado a
    tool correspondente com sucesso nessa resposta — visto em produção (o bot confirmou
    uma consulta pro paciente "Gustavo" que nunca foi criada no banco)."""
    texto_lower = texto.lower()
    alegou_confirmacao = any(palavra in texto_lower for palavra in _PALAVRAS_CONFIRMACAO)
    agendamento_real = any(a.startswith(_PREFIXOS_ACAO_REAL) for a in acoes)
    return alegou_confirmacao and not agendamento_real

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


async def _buscar_local(conn, profissional_id: int, local_nome: str):
    local = await conn.fetchrow(
        "SELECT id, nome FROM locais WHERE profissional_id = $1 AND nome ILIKE $2",
        profissional_id, local_nome,
    )
    if local is None:
        raise ValueError(f"Não encontrei o local '{local_nome}'.")
    return local


async def _buscar_ou_criar_paciente(
    conn, profissional_id: int, nome_paciente: str, telefone_paciente: str,
    consentimento_lgpd: bool, data_nascimento,
):
    paciente = await conn.fetchrow(
        "SELECT id, nome, email, tipo_procedimento, data_nascimento FROM pacientes WHERE profissional_id = $1 AND telefone = $2",
        profissional_id, telefone_paciente,
    )
    if paciente is not None:
        return paciente
    if not consentimento_lgpd:
        raise ValueError(
            "Antes de agendar, preciso do consentimento explícito do paciente pra tratar "
            "os dados de saúde dele conforme a LGPD. Pergunte se ele concorda, e só chame "
            "essa ferramenta de novo com consentimento_lgpd=true depois que ele confirmar."
        )
    return await conn.fetchrow(
        """
        INSERT INTO pacientes (profissional_id, nome, telefone, data_nascimento, tipo_atendimento, consentimento_lgpd, consentimento_lgpd_data)
        VALUES ($1, $2, $3, $4, 'individual', true, now())
        RETURNING id, nome, email, tipo_procedimento, data_nascimento
        """,
        profissional_id, nome_paciente, telefone_paciente, data_nascimento,
    )


async def criar_agendamento(
    profissional_id: int,
    nome_paciente: str,
    telefone_paciente: str,
    local_nome: str,
    data_hora_str: str,
    modalidade: str = "presencial",
    duracao_minutos: int = 50,
    consentimento_lgpd: bool = False,
    data_nascimento_str: str | None = None,
) -> dict:
    if modalidade not in ("presencial", "teleconsulta"):
        modalidade = "presencial"

    data_hora = datetime.fromisoformat(data_hora_str)
    if data_hora.tzinfo is None:
        data_hora = data_hora.replace(tzinfo=BRASILIA)

    data_nascimento = date.fromisoformat(data_nascimento_str) if data_nascimento_str else None

    async with db.pool.acquire() as conn:
        local = await _buscar_local(conn, profissional_id, local_nome)
        paciente = await _buscar_ou_criar_paciente(
            conn, profissional_id, nome_paciente, telefone_paciente, consentimento_lgpd, data_nascimento
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

        whatsapp_instance = await conn.fetchval(
            "SELECT whatsapp_instance FROM profissionais WHERE id = $1", profissional_id
        )

    # Mesmo hook de main.py:criar_sessao — aqui cobre agendamentos feitos pelo próprio bot,
    # que não passam pelo endpoint POST /sessoes (visto em produção: paciente agendava pelo
    # WhatsApp e só recebia a anamnese no lembrete de 24h, não na hora da confirmação).
    await anamnese.enviar_anamnese(
        paciente_email=paciente["email"],
        paciente_telefone=telefone_paciente,
        paciente_nome=paciente["nome"],
        tipo_procedimento=paciente["tipo_procedimento"],
        data_nascimento=paciente["data_nascimento"],
        whatsapp_instance=whatsapp_instance,
    )

    return {
        "sessao_id": sessao["id"],
        "paciente": paciente["nome"],
        "local": local["nome"],
        # sessao["data_hora"] volta do banco em UTC — sem converter pra Brasília aqui, a IA
        # acaba repetindo a hora UTC crua pro paciente como se fosse hora local (bug real visto
        # em produção: agendou 11:00 mas confirmou "14:00" pro paciente)
        "data_hora": sessao["data_hora"].astimezone(BRASILIA).strftime("%d/%m/%Y %H:%M"),
        "modalidade": sessao["modalidade"],
    }


async def segurar_horario(
    profissional_id: int,
    nome_paciente: str,
    telefone_paciente: str,
    local_nome: str,
    data_hora_str: str,
    modalidade: str = "presencial",
    duracao_minutos: int = 50,
    consentimento_lgpd: bool = False,
    data_nascimento_str: str | None = None,
) -> dict:
    if modalidade not in ("presencial", "teleconsulta"):
        modalidade = "presencial"

    data_hora = datetime.fromisoformat(data_hora_str)
    if data_hora.tzinfo is None:
        data_hora = data_hora.replace(tzinfo=BRASILIA)

    data_nascimento = date.fromisoformat(data_nascimento_str) if data_nascimento_str else None
    expira_em = reservas.calcular_expiracao_hold()

    async with db.pool.acquire() as conn:
        local = await _buscar_local(conn, profissional_id, local_nome)
        paciente = await _buscar_ou_criar_paciente(
            conn, profissional_id, nome_paciente, telefone_paciente, consentimento_lgpd, data_nascimento
        )

        try:
            sessao = await conn.fetchrow(
                """
                INSERT INTO sessoes (profissional_id, paciente_id, local_id, data_hora, duracao_minutos, modalidade, status, expira_em)
                VALUES ($1, $2, $3, $4, $5, $6, 'reservado', $7)
                RETURNING id, data_hora, duracao_minutos, modalidade, status
                """,
                profissional_id, paciente["id"], local["id"], data_hora, duracao_minutos, modalidade, expira_em,
            )
        except asyncpg.exceptions.ExclusionViolationError:
            raise ValueError("Esse horário acabou de ser ocupado por outra sessão. Escolha outro horário.")

    # Nada de anamnese/email de confirmação aqui de propósito — isso só dispara quando
    # o hold vira confirmado de verdade, em confirmar_horario_reservado. Mandar antes
    # seria enviar formulário/email pra uma reserva que pode nem virar consulta.
    return {
        "sessao_id": sessao["id"],
        "paciente": paciente["nome"],
        "local": local["nome"],
        "data_hora": sessao["data_hora"].astimezone(BRASILIA).strftime("%d/%m/%Y %H:%M"),
        "modalidade": sessao["modalidade"],
        "expira_em": expira_em.strftime("%H:%M"),
    }


async def entrar_lista_espera(
    profissional_id: int, telefone_paciente: str, nome_paciente: str, local_nome: str, periodo_preferido: str,
) -> None:
    if periodo_preferido not in ("manha", "tarde", "qualquer"):
        periodo_preferido = "qualquer"

    async with db.pool.acquire() as conn:
        local = await _buscar_local(conn, profissional_id, local_nome)

        existente = await conn.fetchval(
            """
            SELECT id FROM lista_espera
            WHERE profissional_id = $1 AND local_id = $2 AND paciente_telefone = $3 AND atendido_em IS NULL
            """,
            profissional_id, local["id"], telefone_paciente,
        )
        if existente:
            await conn.execute(
                "UPDATE lista_espera SET periodo_preferido = $1 WHERE id = $2",
                periodo_preferido, existente,
            )
            return

        await conn.execute(
            """
            INSERT INTO lista_espera (profissional_id, local_id, paciente_telefone, paciente_nome, periodo_preferido)
            VALUES ($1, $2, $3, $4, $5)
            """,
            profissional_id, local["id"], telefone_paciente, nome_paciente, periodo_preferido,
        )


async def confirmar_horario_reservado(profissional_id: int, telefone_paciente: str, sessao_id: int) -> dict:
    async with db.pool.acquire() as conn:
        # WHERE por telefone (via subquery) garante que só o dono do hold consegue
        # confirmá-lo — sem isso, um paciente poderia adivinhar/testar sessao_id alheio.
        sessao = await conn.fetchrow(
            """
            UPDATE sessoes SET status = 'confirmada'
            WHERE id = $1 AND profissional_id = $2 AND status = 'reservado'
              AND paciente_id = (SELECT id FROM pacientes WHERE telefone = $3 AND profissional_id = $2)
            RETURNING id, paciente_id, local_id, data_hora, duracao_minutos, modalidade, link_teleconsulta
            """,
            sessao_id, profissional_id, telefone_paciente,
        )
        if sessao is None:
            raise ValueError(
                "Esse horário reservado não existe mais, já expirou, ou não é seu. Quer que eu "
                "consulte os horários disponíveis de novo?"
            )

        paciente = await conn.fetchrow(
            "SELECT nome, email, telefone, tipo_procedimento, data_nascimento FROM pacientes WHERE id = $1",
            sessao["paciente_id"],
        )
        local = await conn.fetchrow("SELECT nome FROM locais WHERE id = $1", sessao["local_id"])
        profissional = await conn.fetchrow(
            "SELECT nome, whatsapp_instance FROM profissionais WHERE id = $1", profissional_id
        )

    await notificacoes.enviar_email_sessao(
        tipo="confirmacao",
        paciente_email=paciente["email"],
        paciente_nome=paciente["nome"],
        profissional_nome=profissional["nome"],
        data_hora=sessao["data_hora"],
        duracao_minutos=sessao["duracao_minutos"],
        local_nome=local["nome"],
        modalidade=sessao["modalidade"],
        link_teleconsulta=sessao["link_teleconsulta"],
    )
    await anamnese.enviar_anamnese(
        paciente_email=paciente["email"],
        paciente_telefone=paciente["telefone"],
        paciente_nome=paciente["nome"],
        tipo_procedimento=paciente["tipo_procedimento"],
        data_nascimento=paciente["data_nascimento"],
        whatsapp_instance=profissional["whatsapp_instance"],
    )

    return {
        "sessao_id": sessao["id"],
        "paciente": paciente["nome"],
        "local": local["nome"],
        "data_hora": sessao["data_hora"].astimezone(BRASILIA).strftime("%d/%m/%Y %H:%M"),
        "modalidade": sessao["modalidade"],
    }


async def escalar_conversa(
    profissional_id: int,
    telefone_paciente: str,
    motivo: str,
    resumo: str,
    nome_paciente: str | None = None,
) -> None:
    if motivo not in ("crise", "fora_do_escopo"):
        motivo = "fora_do_escopo"

    async with db.pool.acquire() as conn:
        paciente = await conn.fetchrow(
            "SELECT id, nome FROM pacientes WHERE profissional_id = $1 AND telefone = $2",
            profissional_id, telefone_paciente,
        )
        # Paciente ainda não identificado no sistema, mas deu o nome na conversa: cadastra
        # o mínimo (sem consentimento LGPD — aqui é acolhimento de emergência, não agendamento)
        # pra profissional ver quem é ao receber o alerta, em vez de só um número de telefone.
        if paciente is None and nome_paciente:
            paciente = await conn.fetchrow(
                """
                INSERT INTO pacientes (profissional_id, nome, telefone, tipo_atendimento)
                VALUES ($1, $2, $3, 'individual')
                RETURNING id, nome
                """,
                profissional_id, nome_paciente, telefone_paciente,
            )

        paciente_id = paciente["id"] if paciente else None
        nome_para_alerta = paciente["nome"] if paciente else nome_paciente

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
        paciente_nome=nome_para_alerta,
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
                "data_nascimento": {
                    "type": "string",
                    "description": (
                        "Data de nascimento do paciente, no formato YYYY-MM-DD. Só preencha se "
                        "for a primeira sessão de um paciente novo (mesmo momento em que se "
                        "pergunta o consentimento LGPD) — usada depois pra decidir qual versão "
                        "de formulário de anamnese enviar antes da consulta, quando aplicável. "
                        "Pra pacientes que já têm cadastro, não precisa perguntar de novo."
                    ),
                },
            },
            "required": ["nome_paciente", "local_nome", "data_hora"],
        },
    },
    {
        "name": "segurar_horario",
        "description": (
            "Segura (reserva temporariamente) um horário pro paciente, sem confirmar de vez, "
            "quando ele demonstra interesse num horário oferecido por consultar_horarios_disponiveis "
            "mas ainda não confirmou de cara (ex: pediu pra pensar, disse que confirma depois). "
            "A reserva expira sozinha ainda hoje se ele não confirmar."
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
                "data_nascimento": {
                    "type": "string",
                    "description": (
                        "Data de nascimento do paciente, no formato YYYY-MM-DD. Só preencha se "
                        "for a primeira sessão de um paciente novo. Pra pacientes que já têm "
                        "cadastro, não precisa perguntar de novo."
                    ),
                },
            },
            "required": ["nome_paciente", "local_nome", "data_hora"],
        },
    },
    {
        "name": "confirmar_horario_reservado",
        "description": (
            "Confirma de vez um horário que já estava reservado (segurado) nessa conversa, "
            "convertendo a reserva numa consulta confirmada de verdade. Use quando o paciente "
            "voltar dizendo que quer confirmar o horário que você segurou pra ele."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "sessao_id": {
                    "type": "integer",
                    "description": "O sessao_id que veio no resultado de segurar_horario, nessa mesma conversa.",
                },
            },
            "required": ["sessao_id"],
        },
    },
    {
        "name": "entrar_lista_espera",
        "description": (
            "Coloca o paciente na lista de espera de um local, quando não há horário bom "
            "disponível pro que ele quer. Ele é avisado automaticamente por WhatsApp assim que "
            "um horário compatível abrir (por cancelamento de outra sessão, por exemplo)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "nome_paciente": {"type": "string", "description": "Nome do paciente"},
                "local_nome": {"type": "string"},
                "periodo_preferido": {
                    "type": "string",
                    "enum": ["manha", "tarde", "qualquer"],
                    "description": "Período do dia que o paciente prefere, ou 'qualquer' se não tiver preferência.",
                },
            },
            "required": ["nome_paciente", "local_nome", "periodo_preferido"],
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
                "nome_paciente": {
                    "type": "string",
                    "description": (
                        "Nome do paciente, SE ele já tiver mencionado em algum momento da conversa. "
                        "NÃO pare pra perguntar o nome antes de escalar — isso pode atrasar o acolhimento "
                        "numa situação de crise. Só preencha se o nome já apareceu naturalmente."
                    ),
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
                entrada.get("data_nascimento"),
            )
            return f"Agendamento criado com sucesso: {resultado}"

        if nome == "segurar_horario":
            resultado = await segurar_horario(
                profissional_id,
                entrada["nome_paciente"],
                telefone_paciente,
                entrada["local_nome"],
                entrada["data_hora"],
                entrada.get("modalidade", "presencial"),
                entrada.get("duracao_minutos", 50),
                entrada.get("consentimento_lgpd", False),
                entrada.get("data_nascimento"),
            )
            return f"Horário reservado com sucesso: {resultado}"

        if nome == "confirmar_horario_reservado":
            resultado = await confirmar_horario_reservado(
                profissional_id, telefone_paciente, entrada["sessao_id"]
            )
            return f"Reserva confirmada com sucesso: {resultado}"

        if nome == "entrar_lista_espera":
            await entrar_lista_espera(
                profissional_id, telefone_paciente, entrada["nome_paciente"],
                entrada["local_nome"], entrada["periodo_preferido"],
            )
            return "Paciente adicionado à lista de espera com sucesso."

        if nome == "acolher_e_escalar":
            await escalar_conversa(
                profissional_id, telefone_paciente, entrada["motivo"], entrada["resumo"],
                entrada.get("nome_paciente"),
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
        "Se faltar informação (local, data, nome do paciente, modalidade), pergunte antes de usar "
        "as ferramentas.\n"
        "\n"
        "# REGRAS DE OURO\n"
        "- NUNCA ofereça um horário sem antes chamar consultar_horarios_disponiveis. Nunca invente.\n"
        "- NUNCA reaproveite uma lista de horários que você já deu antes na conversa, mesmo pra "
        "mesma data — o tempo passa e outros pacientes podem ter agendado nesse meio tempo. Chame a "
        "ferramenta de novo a cada vez que o paciente perguntar sobre disponibilidade.\n"
        "- NUNCA diga que um agendamento está 'confirmado', 'marcado' ou 'agendado' sem antes ter "
        "chamado criar_agendamento NESSA MESMA resposta e recebido sucesso dela. Assim que o "
        "paciente confirmar horário (e consentimento LGPD, se aplicável), sua próxima ação é chamar "
        "criar_agendamento — não é escrever uma mensagem de confirmação em texto. Dizer que está "
        "confirmado sem ter chamado a ferramenta é uma mentira que engana o paciente com uma "
        "consulta que não existe de verdade no sistema.\n"
        "- SEMPRE use criar_agendamento só depois que o paciente confirmar explicitamente um "
        "horário oferecido.\n"
        "- SEMPRE pergunte explicitamente sobre consentimento LGPD antes de chamar criar_agendamento "
        "se for a primeira sessão de um paciente novo, e só passe consentimento_lgpd=true depois que "
        "ele confirmar.\n"
        "- SEMPRE pergunte a data de nascimento do paciente (no mesmo momento em que perguntar o "
        "consentimento LGPD) se for a primeira sessão de um paciente novo, e passe em "
        "data_nascimento. Pra pacientes que já têm cadastro, não precisa perguntar de novo.\n"
        "- SEMPRE chame acolher_e_escalar imediatamente (sem tentar ajudar você mesmo) se o paciente "
        "relatar uma situação de crise ou pedir algo fora do escopo de agendamento (conselho "
        "clínico, diagnóstico, etc.)."
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
            if _alega_confirmacao_sem_ter_agendado(texto, acoes):
                logger.warning(
                    "Bot tentou confirmar agendamento sem chamar criar_agendamento (telefone=%s): %s",
                    telefone_paciente, texto,
                )
                return {"resposta": MENSAGEM_CONFIRMACAO_SEM_AGENDAMENTO, "acoes": acoes}
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
            if chamada.name in ("criar_agendamento", "segurar_horario", "confirmar_horario_reservado") \
                    and not resultado.startswith("Erro:"):
                acoes.append(resultado)
            resultados_ferramenta.append(
                {"type": "tool_result", "tool_use_id": chamada.id, "content": resultado}
            )
        messages.append({"role": "user", "content": resultados_ferramenta})

    return {
        "resposta": "Desculpa, não consegui concluir agora — pode tentar reformular seu pedido?",
        "acoes": acoes,
    }
