import asyncio
import logging
from datetime import timedelta, timezone, datetime

from app import anamnese, db, evolution, notificacoes

logger = logging.getLogger(__name__)

INTERVALO_VERIFICACAO = timedelta(minutes=15)
ANTECEDENCIA_LEMBRETE = timedelta(hours=24)
JANELA_TOLERANCIA = timedelta(minutes=15)

# Mesma ideia do lembrete de antes da consulta, só que pra depois: ~24h após o horário
# da sessão (não um horário fixo tipo "amanhã de manhã") — checado no mesmo loop de
# 15min, com a mesma janela de tolerância.
ATRASO_POS_CONSULTA = timedelta(hours=24)


async def verificar_e_enviar_lembretes() -> None:
    agora = datetime.now(timezone.utc)
    alvo_inicio = agora + ANTECEDENCIA_LEMBRETE
    alvo_fim = alvo_inicio + JANELA_TOLERANCIA

    async with db.pool.acquire() as conn:
        sessoes = await conn.fetch(
            """
            SELECT s.id, s.paciente_id, s.data_hora, s.duracao_minutos, s.modalidade, s.link_teleconsulta,
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
                paciente_id=sessao["paciente_id"],
                paciente_email=sessao["paciente_email"],
                paciente_telefone=sessao["paciente_telefone"],
                paciente_nome=sessao["paciente_nome"],
                tipo_procedimento=sessao["tipo_procedimento"],
                data_nascimento=sessao["data_nascimento"],
                whatsapp_instance=sessao["whatsapp_instance"],
            )
            await conn.execute("UPDATE sessoes SET lembrete_enviado = true WHERE id = $1", sessao["id"])
            logger.info("Lembrete enviado pra sessão %s", sessao["id"])


async def verificar_e_enviar_pos_consulta() -> None:
    agora = datetime.now(timezone.utc)
    # A sessão precisa ter acontecido há ~24h — janela pra trás, não pra frente.
    alvo_fim = agora - ATRASO_POS_CONSULTA
    alvo_inicio = alvo_fim - JANELA_TOLERANCIA

    async with db.pool.acquire() as conn:
        sessoes = await conn.fetch(
            """
            SELECT s.id, p.nome AS paciente_nome, p.telefone AS paciente_telefone, pr.whatsapp_instance
            FROM sessoes s
            JOIN pacientes p ON p.id = s.paciente_id
            JOIN profissionais pr ON pr.id = s.profissional_id
            WHERE s.status IN ('confirmada', 'concluida')
              AND s.pos_consulta_enviado = false
              AND s.data_hora BETWEEN $1 AND $2
            """,
            alvo_inicio, alvo_fim,
        )

        for sessao in sessoes:
            if not sessao["whatsapp_instance"]:
                continue
            primeiro_nome = sessao["paciente_nome"].split(" ")[0]
            mensagem = (
                f"Oi, {primeiro_nome}! Passando pra saber como você está depois da consulta. "
                "Ficou alguma dúvida sobre as orientações ou existe algo em que possamos te ajudar?"
            )
            try:
                await evolution.enviar_mensagem_texto(
                    sessao["whatsapp_instance"], sessao["paciente_telefone"], mensagem
                )
            except Exception:
                logger.exception("Falha ao enviar mensagem pós-consulta (sessão=%s)", sessao["id"])
                continue
            await conn.execute("UPDATE sessoes SET pos_consulta_enviado = true WHERE id = $1", sessao["id"])
            logger.info("Mensagem pós-consulta enviada pra sessão %s", sessao["id"])


async def verificar_e_enviar_aniversarios() -> None:
    """Envia mensagem de parabéns no WhatsApp no dia do aniversário do paciente.
    Roda diariamente: um único envio por paciente por ano (coluna aniversario_enviado_ano).
    """
    agora = datetime.now(timezone.utc)
    # Converte pra horário de Brasília pra pegar o dia/mês correto
    from zoneinfo import ZoneInfo
    brasilia = ZoneInfo("America/Sao_Paulo")
    hoje = agora.astimezone(brasilia)
    dia_hoje = hoje.day
    mes_hoje = hoje.month
    ano_hoje = hoje.year

    async with db.pool.acquire() as conn:
        pacientes = await conn.fetch(
            """
            SELECT p.id, p.nome, p.telefone, p.data_nascimento,
                   p.aniversario_enviado_ano,
                   pr.whatsapp_instance
            FROM pacientes p
            JOIN profissionais pr ON pr.id = p.profissional_id
            WHERE p.status = 'ativo'
              AND p.data_nascimento IS NOT NULL
              AND EXTRACT(MONTH FROM p.data_nascimento) = $1
              AND EXTRACT(DAY FROM p.data_nascimento) = $2
              AND (p.aniversario_enviado_ano IS NULL OR p.aniversario_enviado_ano < $3)
              AND pr.whatsapp_instance IS NOT NULL
            """,
            mes_hoje, dia_hoje, ano_hoje,
        )

        for paciente in pacientes:
            primeiro_nome = paciente["nome"].split(" ")[0]
            mensagem = (
                f"Feliz aniversário, {primeiro_nome}! 🎉 "
                "Que esse novo ano de vida seja repleto de saúde, alegria e conquistas. "
                "É um prazer cuidar de você!"
            )
            try:
                await evolution.enviar_mensagem_texto(
                    paciente["whatsapp_instance"], paciente["telefone"], mensagem
                )
            except Exception:
                logger.exception("Falha ao enviar parabéns (paciente=%s)", paciente["id"])
                continue
            await conn.execute(
                "UPDATE pacientes SET aniversario_enviado_ano = $1 WHERE id = $2",
                ano_hoje, paciente["id"],
            )
            logger.info("Parabéns enviado pro paciente %s", paciente["id"])


async def loop_lembretes() -> None:
    while True:
        try:
            await verificar_e_enviar_lembretes()
        except Exception:
            logger.exception("Erro ao verificar lembretes")
        try:
            await verificar_e_enviar_pos_consulta()
        except Exception:
            logger.exception("Erro ao verificar mensagens pós-consulta")
        try:
            await verificar_e_enviar_aniversarios()
        except Exception:
            logger.exception("Erro ao verificar aniversários")
        await asyncio.sleep(INTERVALO_VERIFICACAO.total_seconds())
