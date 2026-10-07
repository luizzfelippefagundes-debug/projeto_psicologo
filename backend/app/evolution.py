import httpx

from app.config import settings


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
