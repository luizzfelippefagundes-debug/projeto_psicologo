"""backend/app/reengajamento.py
Manda UM lembrete de reengajamento (nunca mais que isso pra mesma pausa na
conversa) pra conversas do bot que ficaram paradas — o bot respondeu, o paciente
nunca mais voltou. Pedido da profissional: "se não responder, não insista" — por
isso é sempre um único lembrete por pausa, nunca repete.

Só considera conversas paradas há mais de INTERVALO_SILENCIO E só manda durante
horário comercial (INICIO_EXPEDIENTE–FIM_EXPEDIENTE, horário de Brasília) — se a
pausa completar o tempo fora desse horário, o lembrete só sai no próximo ciclo
que já estiver dentro do expediente (o loop roda de novo a cada
INTERVALO_VERIFICACAO, a condição de tempo parado continua batendo até lá)."""
import asyncio
import json
import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app import db, evolution

logger = logging.getLogger(__name__)

BRASILIA = ZoneInfo("America/Sao_Paulo")
INTERVALO_SILENCIO = timedelta(hours=2)
INTERVALO_VERIFICACAO = timedelta(minutes=10)
INICIO_EXPEDIENTE = 8
FIM_EXPEDIENTE = 20


async def _enviar_nudges() -> None:
    agora_brasilia = datetime.now(BRASILIA)
    if not (INICIO_EXPEDIENTE <= agora_brasilia.hour < FIM_EXPEDIENTE):
        return

    async with db.pool.acquire() as conn:
        candidatas = await conn.fetch(
            """
            SELECT bc.id, bc.profissional_id, bc.telefone_paciente, bc.nome_whatsapp, bc.historico,
                   pr.whatsapp_instance
            FROM bot_conversas bc
            JOIN profissionais pr ON pr.id = bc.profissional_id
            WHERE bc.nudge_enviado = false
              AND bc.atualizado_em <= now() - $1::interval
              AND pr.whatsapp_instance IS NOT NULL
            """,
            INTERVALO_SILENCIO,
        )

        for conversa in candidatas:
            historico = json.loads(conversa["historico"])
            # Só faz sentido reengajar se quem falou por último foi o bot (paciente
            # ficou devendo resposta) — historico vazio ou terminando em "user" não
            # deveria acontecer nesse fluxo, mas confere por segurança.
            if not historico or historico[-1]["role"] != "assistant":
                continue

            saudacao = f"Oi, {conversa['nome_whatsapp']}" if conversa["nome_whatsapp"] else "Oi"
            texto = f"{saudacao}, podemos continuar no agendamento ou te ajudar em outra questão?"

            try:
                await evolution.enviar_mensagem_texto(
                    conversa["whatsapp_instance"], conversa["telefone_paciente"], texto
                )
            except Exception:
                logger.exception(
                    "Falha ao mandar lembrete de reengajamento (telefone=%s)", conversa["telefone_paciente"]
                )
                continue

            await conn.execute(
                "UPDATE bot_conversas SET nudge_enviado = true WHERE id = $1", conversa["id"]
            )


async def loop_reengajamento() -> None:
    while True:
        try:
            await _enviar_nudges()
        except Exception:
            logger.exception("Erro no loop de reengajamento do bot")
        await asyncio.sleep(INTERVALO_VERIFICACAO.total_seconds())
