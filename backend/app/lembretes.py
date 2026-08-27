import asyncio
import logging
from datetime import timedelta, timezone, datetime

from app import anamnese, db, notificacoes

logger = logging.getLogger(__name__)

INTERVALO_VERIFICACAO = timedelta(minutes=15)
ANTECEDENCIA_LEMBRETE = timedelta(hours=24)
JANELA_TOLERANCIA = timedelta(minutes=15)


async def verificar_e_enviar_lembretes() -> None:
    agora = datetime.now(timezone.utc)
    alvo_inicio = agora + ANTECEDENCIA_LEMBRETE
    alvo_fim = alvo_inicio + JANELA_TOLERANCIA

    async with db.pool.acquire() as conn:
        sessoes = await conn.fetch(
            """
            SELECT s.id, s.data_hora, s.duracao_minutos, s.modalidade, s.link_teleconsulta,
                   p.nome AS paciente_nome, p.email AS paciente_email, p.telefone AS paciente_telefone,
                   p.tipo_procedimento, p.data_nascimento,
                   l.nome AS local_nome, pr.nome AS profissional_nome, pr.whatsapp_instance
            FROM sessoes s
            JOIN pacientes p ON p.id = s.paciente_id
            JOIN locais l ON l.id = s.local_id
            JOIN profissionais pr ON pr.id = s.profissional_id
            WHERE s.status = 'confirmada'
              AND s.lembrete_enviado = false
              AND s.data_hora BETWEEN $1 AND $2
            """,
            alvo_inicio, alvo_fim,
        )

        for sessao in sessoes:
            await notificacoes.enviar_email_sessao(
                tipo="lembrete",
                paciente_email=sessao["paciente_email"],
                paciente_nome=sessao["paciente_nome"],
                profissional_nome=sessao["profissional_nome"],
                data_hora=sessao["data_hora"],
                duracao_minutos=sessao["duracao_minutos"],
                local_nome=sessao["local_nome"],
                modalidade=sessao["modalidade"],
                link_teleconsulta=sessao["link_teleconsulta"],
            )
            await anamnese.enviar_anamnese(
                paciente_email=sessao["paciente_email"],
                paciente_telefone=sessao["paciente_telefone"],
                paciente_nome=sessao["paciente_nome"],
                tipo_procedimento=sessao["tipo_procedimento"],
                data_nascimento=sessao["data_nascimento"],
                whatsapp_instance=sessao["whatsapp_instance"],
            )
            await conn.execute("UPDATE sessoes SET lembrete_enviado = true WHERE id = $1", sessao["id"])
            logger.info("Lembrete enviado pra sessão %s", sessao["id"])


async def loop_lembretes() -> None:
    while True:
        try:
            await verificar_e_enviar_lembretes()
        except Exception:
            logger.exception("Erro ao verificar lembretes")
        await asyncio.sleep(INTERVALO_VERIFICACAO.total_seconds())
