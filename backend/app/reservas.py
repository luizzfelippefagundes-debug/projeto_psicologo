import asyncio
import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import asyncpg

from app import db, evolution

logger = logging.getLogger(__name__)

BRASILIA = ZoneInfo("America/Sao_Paulo")
INTERVALO_VERIFICACAO = timedelta(minutes=15)
JANELA_LEMBRETE_EXPIRACAO = timedelta(hours=1)


def calcular_expiracao_hold() -> datetime:
    """Hold expira às 21h de Brasília do dia da conversa. Se a conversa já estiver
    depois das 21h, dá uma janela mínima de 2h a partir de agora, pra nunca nascer
    já expirado ou com prazo curto demais pro paciente decidir."""
    agora = datetime.now(BRASILIA)
    prazo = agora.replace(hour=21, minute=0, second=0, microsecond=0)
    if prazo <= agora:
        prazo = agora + timedelta(hours=2)
    return prazo


async def checar_lista_espera(
    profissional_id: int, local_id: int, data_hora_liberada: datetime, duracao_minutos: int
) -> None:
    """Chamada sempre que uma sessão vira 'cancelada' (cancelamento manual ou hold
    expirado). Se alguém na lista de espera bate com o horário que abriu, cria um
    hold automático em nome dela e avisa por WhatsApp. FIFO: só a entrada mais
    antiga que bate é atendida — se o hold dela expirar sem confirmação, essa mesma
    função roda de novo (via loop_expiracao_holds) e naturalmente pega a próxima,
    porque a entrada anterior já ficou marcada com atendido_em."""
    periodo = "manha" if data_hora_liberada.astimezone(BRASILIA).hour < 12 else "tarde"

    async with db.pool.acquire() as conn:
        candidato = await conn.fetchrow(
            """
            SELECT id, paciente_telefone, paciente_nome
            FROM lista_espera
            WHERE profissional_id = $1 AND local_id = $2 AND atendido_em IS NULL
              AND periodo_preferido IN ('qualquer', $3)
            ORDER BY criado_em
            LIMIT 1
            """,
            profissional_id, local_id, periodo,
        )
        if candidato is None:
            return

        paciente = await conn.fetchrow(
            "SELECT id FROM pacientes WHERE profissional_id = $1 AND telefone = $2",
            profissional_id, candidato["paciente_telefone"],
        )
        if paciente is None:
            paciente = await conn.fetchrow(
                """
                INSERT INTO pacientes (profissional_id, nome, telefone, tipo_atendimento)
                VALUES ($1, $2, $3, 'individual')
                RETURNING id
                """,
                profissional_id, candidato["paciente_nome"], candidato["paciente_telefone"],
            )

        expira_em = calcular_expiracao_hold()
        try:
            await conn.execute(
                """
                INSERT INTO sessoes (profissional_id, paciente_id, local_id, data_hora, duracao_minutos, status, expira_em)
                VALUES ($1, $2, $3, $4, $5, 'reservado', $6)
                """,
                profissional_id, paciente["id"], local_id, data_hora_liberada, duracao_minutos, expira_em,
            )
        except asyncpg.exceptions.ExclusionViolationError:
            logger.warning(
                "Não deu pra reservar horário da lista de espera pro paciente %s — horário %s já ocupado",
                candidato["paciente_telefone"], data_hora_liberada,
            )
            return

        await conn.execute("UPDATE lista_espera SET atendido_em = now() WHERE id = $1", candidato["id"])

        whatsapp_instance = await conn.fetchval(
            "SELECT whatsapp_instance FROM profissionais WHERE id = $1", profissional_id
        )

    if not whatsapp_instance:
        return

    data_formatada = data_hora_liberada.astimezone(BRASILIA).strftime("%d/%m/%Y às %H:%M")
    prazo_formatado = expira_em.strftime("%H:%M")
    try:
        await evolution.enviar_mensagem_texto(
            whatsapp_instance,
            candidato["paciente_telefone"],
            f"Boa notícia! Abriu um horário pra você: {data_formatada}. Deixei reservado até as "
            f"{prazo_formatado} de hoje — é só me confirmar por aqui que eu garanto pra você.",
        )
    except Exception:
        logger.exception(
            "Falha ao avisar paciente da lista de espera (telefone=%s)", candidato["paciente_telefone"]
        )


async def _verificar_expiracao_e_lembrete() -> None:
    agora = datetime.now(BRASILIA)

    async with db.pool.acquire() as conn:
        proximos_de_expirar = await conn.fetch(
            """
            SELECT s.id, s.expira_em, p.telefone AS paciente_telefone, pr.whatsapp_instance
            FROM sessoes s
            JOIN pacientes p ON p.id = s.paciente_id
            JOIN profissionais pr ON pr.id = s.profissional_id
            WHERE s.status = 'reservado' AND s.lembrete_expiracao_enviado = false
              AND s.expira_em BETWEEN $1 AND $2
            """,
            agora, agora + JANELA_LEMBRETE_EXPIRACAO,
        )
        for sessao in proximos_de_expirar:
            if sessao["whatsapp_instance"]:
                prazo_formatado = sessao["expira_em"].astimezone(BRASILIA).strftime("%H:%M")
                try:
                    await evolution.enviar_mensagem_texto(
                        sessao["whatsapp_instance"],
                        sessao["paciente_telefone"],
                        f"Só lembrando: seu horário reservado expira às {prazo_formatado} de hoje. "
                        "Confirma pra garantir?",
                    )
                except Exception:
                    logger.exception(
                        "Falha ao mandar lembrete de expiração de hold (sessao_id=%s)", sessao["id"]
                    )
            await conn.execute(
                "UPDATE sessoes SET lembrete_expiracao_enviado = true WHERE id = $1", sessao["id"]
            )

        expirados = await conn.fetch(
            """
            UPDATE sessoes SET status = 'cancelada'
            WHERE status = 'reservado' AND expira_em < $1
            RETURNING id, profissional_id, local_id, data_hora, duracao_minutos
            """,
            agora,
        )

    for sessao in expirados:
        logger.info("Hold expirado e liberado (sessao_id=%s)", sessao["id"])
        await checar_lista_espera(
            sessao["profissional_id"], sessao["local_id"], sessao["data_hora"], sessao["duracao_minutos"]
        )


async def loop_expiracao_holds() -> None:
    while True:
        try:
            await _verificar_expiracao_e_lembrete()
        except Exception:
            logger.exception("Erro ao verificar expiração de holds")
        await asyncio.sleep(INTERVALO_VERIFICACAO.total_seconds())
