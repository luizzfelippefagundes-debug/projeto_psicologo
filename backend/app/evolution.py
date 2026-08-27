import base64
from pathlib import Path

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


async def enviar_documento(instance: str, numero: str, caminho: Path, legenda: str = "") -> None:
    """Envia um arquivo (ex: .docx) como documento pelo WhatsApp via Evolution API.

    Formato do corpo verificado contra o código-fonte da Evolution API 2.3.7 rodando
    em produção (whatsapp.baileys.service.js) — não é um formato presumido.
    """
    url = f"{settings.evolution_api_url}/message/sendMedia/{instance}"
    headers = {"apikey": settings.evolution_api_key or ""}
    media_base64 = base64.b64encode(caminho.read_bytes()).decode()
    body = {
        "number": numero,
        "mediatype": "document",
        "mimetype": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "media": media_base64,
        "fileName": caminho.name,
        "caption": legenda,
    }

    async with httpx.AsyncClient(timeout=30) as client:
        resposta = await client.post(url, json=body, headers=headers)
        resposta.raise_for_status()
