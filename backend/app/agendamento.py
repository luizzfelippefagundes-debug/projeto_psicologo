"""Lógica de agendamento reaproveitada tanto pelo bot do WhatsApp (bot.py) quanto
pelos endpoints públicos de autoagendamento do paciente (agendamento_publico.py)."""
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import asyncpg

from app import anamnese, db

BRASILIA = ZoneInfo("America/Sao_Paulo")


def _dia_semana_banco(d: date) -> int:
    # Python: segunda=0..domingo=6 | Banco: domingo=0..sábado=6
    return (d.weekday() + 1) % 7


async def horarios_disponiveis(
    profissional_id: int, local_id: int, data: date, duracao_minutos: int = 50
) -> list[str]:
    async with db.pool.acquire() as conn:
        dia_semana = _dia_semana_banco(data)

        regras = await conn.fetch(
            """
            SELECT hora_inicio, hora_fim FROM regras_horario
            WHERE profissional_id = $1 AND local_id = $2 AND dia_semana = $3 AND ativo
            ORDER BY hora_inicio
            """,
            profissional_id, local_id, dia_semana,
        )
        if not regras:
            return []

        ocupados = await conn.fetch(
            """
            SELECT data_hora, duracao_minutos FROM sessoes
            WHERE profissional_id = $1 AND local_id = $2
              AND data_hora::date = $3 AND status <> 'cancelada'
            """,
            profissional_id, local_id, data,
        )
        janelas_ocupadas = [
            (row["data_hora"], row["data_hora"] + timedelta(minutes=row["duracao_minutos"]))
            for row in ocupados
        ]

        bloqueios = await conn.fetch(
            """
            SELECT data_inicio, data_fim FROM bloqueios_horario
            WHERE profissional_id = $1 AND (local_id IS NULL OR local_id = $2)
              AND data_inicio::date <= $3 AND data_fim::date >= $3
            """,
            profissional_id, local_id, data,
        )
        janelas_ocupadas += [(row["data_inicio"], row["data_fim"]) for row in bloqueios]

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


async def criar_sessao_e_notificar(
    conn,
    *,
    profissional_id: int,
    paciente: asyncpg.Record,
    local: asyncpg.Record,
    data_hora: datetime,
    duracao_minutos: int,
    modalidade: str,
    whatsapp_instance: str | None,
) -> asyncpg.Record:
    """Insere a sessão e dispara o envio de anamnese (se o procedimento exigir).
    `paciente` precisa ter pelo menos: id, nome, email, tipo_procedimento, data_nascimento.
    `local` precisa ter pelo menos: id, nome. Levanta ExclusionViolationError se o
    horário já estiver ocupado (quem chama decide como tratar)."""
    sessao = await conn.fetchrow(
        """
        INSERT INTO sessoes (profissional_id, paciente_id, local_id, data_hora, duracao_minutos, modalidade)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, data_hora, duracao_minutos, modalidade, status
        """,
        profissional_id, paciente["id"], local["id"], data_hora, duracao_minutos, modalidade,
    )

    await anamnese.enviar_anamnese(
        paciente_id=paciente["id"],
        paciente_email=paciente["email"],
        paciente_telefone=paciente["telefone"],
        paciente_nome=paciente["nome"],
        tipo_procedimento=paciente["tipo_procedimento"],
        data_nascimento=paciente["data_nascimento"],
        whatsapp_instance=whatsapp_instance,
    )

    return sessao
