import httpx

from app.config import settings


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
