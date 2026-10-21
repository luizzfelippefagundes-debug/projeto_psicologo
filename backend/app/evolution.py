import json
import logging

import httpx

from app import db
from app.config import settings

logger = logging.getLogger(__name__)

HISTORICO_MAX_MENSAGENS = 20  # últimos N turnos (user+assistant) mantidos por conversa do bot


async def connection_state(instance: str) -> str:
    """Retorna o estado da conexão WhatsApp: 'open', 'close', 'connecting'."""
    url = f"{settings.evolution_api_url}/instance/connectionState/{instance}"
    headers = {"apikey": settings.evolution_api_key or ""}
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            r = await client.get(url, headers=headers)
            if r.status_code == 200:
                data = r.json()
                return data.get("instance", {}).get("state", "close")
        except Exception:
            pass
    return "close"


async def get_qrcode(instance: str) -> str | None:
    """Retorna o QR code como string base64 (sem prefixo data:image) pra reconectar."""
    url = f"{settings.evolution_api_url}/instance/connect/{instance}"
    headers = {"apikey": settings.evolution_api_key or ""}
    async with httpx.AsyncClient(timeout=15) as client:
        try:
            r = await client.get(url, headers=headers)
            if r.status_code == 200:
                data = r.json()
                return data.get("base64") or data.get("qrcode", {}).get("base64")
        except Exception:
            pass
    return None


async def enviar_mensagem_texto(instance: str, numero: str, texto: str) -> None:
    """Envia uma mensagem de texto pelo WhatsApp via Evolution API.

    `numero` deve ser só dígitos com DDI (ex: 5527999999999) — sem '+' e sem o
    sufixo '@s.whatsapp.net' que vem no remoteJid do webhook.
    """
    url = f"{settings.evolution_api_url}/message/sendText/{instance}"
    headers = {"apikey": settings.evolution_api_key or ""}
    body = {"number": numero, "text": texto}

    async with httpx.AsyncClient(timeout=30) as client:
        resposta = await client.post(url, json=body, headers=headers)
        resposta.raise_for_status()


async def enviar_mensagem_proativa(instance: str, numero: str, texto: str) -> None:
    """Envia uma mensagem que o sistema iniciou (lembrete, pós-consulta, parabéns, aviso de
    vaga...) e registra no histórico do bot. Sem isso, quando o paciente responde, o bot não
    sabe que a conversa foi retomada por essa mensagem e continua um assunto antigo."""
    await enviar_mensagem_texto(instance, numero, texto)
    try:
        await _registrar_no_historico(instance, numero, texto)
    except Exception:
        # a mensagem já foi enviada — falhar aqui só deixa o bot sem esse contexto
        logger.exception("Falha ao registrar mensagem proativa no histórico (telefone=%s)", numero)


async def _registrar_no_historico(instance: str, numero: str, texto: str) -> None:
    async with db.pool.acquire() as conn:
        profissional_id = await conn.fetchval(
            "SELECT id FROM profissionais WHERE whatsapp_instance = $1", instance
        )
        if profissional_id is None:
            return
        atual = await conn.fetchval(
            "SELECT historico FROM bot_conversas WHERE profissional_id = $1 AND telefone_paciente = $2",
            profissional_id, numero,
        )
        historico = json.loads(atual) if atual else []
        historico.append({"role": "assistant", "content": texto})
        historico = historico[-HISTORICO_MAX_MENSAGENS:]
        # nudge_enviado = true: o lembrete de reengajamento ("podemos continuar no
        # agendamento?") não faz sentido logo depois de uma mensagem proativa dessas
        await conn.execute(
            """
            INSERT INTO bot_conversas (profissional_id, telefone_paciente, historico, atualizado_em, nudge_enviado)
            VALUES ($1, $2, $3::jsonb, now(), true)
            ON CONFLICT (profissional_id, telefone_paciente)
            DO UPDATE SET historico = $3::jsonb, atualizado_em = now(), nudge_enviado = true
            """,
            profissional_id, numero, json.dumps(historico),
        )
