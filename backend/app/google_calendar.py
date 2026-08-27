import logging
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

import httpx

from app import db
from app.config import settings

logger = logging.getLogger(__name__)

BRASILIA = ZoneInfo("America/Sao_Paulo")

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
CALENDAR_API = "https://www.googleapis.com/calendar/v3"
SCOPE = "https://www.googleapis.com/auth/calendar"


def montar_url_autorizacao(profissional_id: int) -> str:
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.google_redirect_uri,
        "response_type": "code",
        "scope": SCOPE,
        "access_type": "offline",
        "prompt": "consent",
        "state": str(profissional_id),
    }
    return f"{AUTH_URL}?{urlencode(params)}"


async def trocar_code_por_tokens(code: str) -> dict:
    async with httpx.AsyncClient() as client:
        resposta = await client.post(
            TOKEN_URL,
            data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": settings.google_redirect_uri,
                "grant_type": "authorization_code",
            },
        )
        resposta.raise_for_status()
        return resposta.json()


async def _renovar_access_token(refresh_token: str) -> dict:
    async with httpx.AsyncClient() as client:
        resposta = await client.post(
            TOKEN_URL,
            data={
                "refresh_token": refresh_token,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "grant_type": "refresh_token",
            },
        )
        resposta.raise_for_status()
        return resposta.json()


async def salvar_conexao(profissional_id: int, tokens: dict) -> None:
    expira_em = datetime.now(timezone.utc) + timedelta(seconds=tokens.get("expires_in", 3600))
    async with db.pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO google_conexoes (profissional_id, refresh_token, access_token, access_token_expira_em)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (profissional_id) DO UPDATE SET
                refresh_token = COALESCE(EXCLUDED.refresh_token, google_conexoes.refresh_token),
                access_token = EXCLUDED.access_token,
                access_token_expira_em = EXCLUDED.access_token_expira_em
            """,
            profissional_id, tokens.get("refresh_token"), tokens.get("access_token"), expira_em,
        )


async def obter_conexao(profissional_id: int):
    async with db.pool.acquire() as conn:
        return await conn.fetchrow(
            "SELECT * FROM google_conexoes WHERE profissional_id = $1", profissional_id
        )


async def _access_token_valido(profissional_id: int) -> str | None:
    conexao = await obter_conexao(profissional_id)
    if conexao is None:
        return None

    agora = datetime.now(timezone.utc)
    if conexao["access_token"] and conexao["access_token_expira_em"] and conexao["access_token_expira_em"] > agora + timedelta(minutes=1):
        return conexao["access_token"]

    try:
        tokens = await _renovar_access_token(conexao["refresh_token"])
    except Exception:
        # refresh_token revogado/expirado no lado do Google — sem isso, criar/editar/
        # cancelar sessão quebrava com 500 pra qualquer profissional nessa situação,
        # mesmo a sessão sendo criada normalmente por trás (visto em produção)
        logger.exception(
            "Falha ao renovar token do Google Calendar (profissional_id=%s) — sincronização pulada",
            profissional_id,
        )
        return None
    expira_em = agora + timedelta(seconds=tokens.get("expires_in", 3600))
    async with db.pool.acquire() as conn:
        await conn.execute(
            "UPDATE google_conexoes SET access_token = $1, access_token_expira_em = $2 WHERE profissional_id = $3",
            tokens["access_token"], expira_em, profissional_id,
        )
    return tokens["access_token"]


def _evento_payload(paciente_nome: str, local_nome: str, data_hora, data_hora_fim, observacoes, sessao_id: int) -> dict:
    return {
        "summary": f"Consulta - {paciente_nome}",
        "description": observacoes or "",
        "location": local_nome,
        "start": {"dateTime": data_hora.isoformat()},
        "end": {"dateTime": data_hora_fim.isoformat()},
        "extendedProperties": {"private": {"origem": "sistema", "sessao_id": str(sessao_id)}},
    }


async def sincronizar_sessao_para_google(
    profissional_id: int, sessao_id: int, paciente_nome: str, local_nome: str,
    data_hora, data_hora_fim, observacoes: str | None, google_event_id: str | None,
) -> str | None:
    access_token = await _access_token_valido(profissional_id)
    if access_token is None:
        return google_event_id

    conexao = await obter_conexao(profissional_id)
    payload = _evento_payload(paciente_nome, local_nome, data_hora, data_hora_fim, observacoes, sessao_id)
    headers = {"Authorization": f"Bearer {access_token}"}

    async with httpx.AsyncClient() as client:
        if google_event_id:
            resposta = await client.patch(
                f"{CALENDAR_API}/calendars/{conexao['calendar_id']}/events/{google_event_id}",
                json=payload, headers=headers,
            )
        else:
            resposta = await client.post(
                f"{CALENDAR_API}/calendars/{conexao['calendar_id']}/events",
                json=payload, headers=headers,
            )
        if resposta.status_code >= 400:
            return google_event_id
        return resposta.json().get("id", google_event_id)


async def remover_evento_google(profissional_id: int, google_event_id: str) -> None:
    access_token = await _access_token_valido(profissional_id)
    if access_token is None or not google_event_id:
        return
    conexao = await obter_conexao(profissional_id)
    async with httpx.AsyncClient() as client:
        await client.delete(
            f"{CALENDAR_API}/calendars/{conexao['calendar_id']}/events/{google_event_id}",
            headers={"Authorization": f"Bearer {access_token}"},
        )


async def puxar_eventos_do_google(profissional_id: int) -> dict:
    access_token = await _access_token_valido(profissional_id)
    if access_token is None:
        return {"erro": "Não conectado ao Google Calendar."}

    conexao = await obter_conexao(profissional_id)
    headers = {"Authorization": f"Bearer {access_token}"}
    params = {"singleEvents": "true", "showDeleted": "true"}
    if conexao["sync_token"]:
        params["syncToken"] = conexao["sync_token"]
    else:
        # Sync inicial (sem syncToken): limita a janela pra não puxar décadas de eventos
        # recorrentes (ex: aniversário anual vira um evento por ano, indo até o fim dos tempos).
        agora = datetime.now(timezone.utc)
        params["timeMin"] = agora.isoformat()
        params["timeMax"] = (agora + timedelta(days=90)).isoformat()

    criados = atualizados = removidos = ignorados = 0
    novo_sync_token = conexao["sync_token"]

    async with httpx.AsyncClient() as client:
        url = f"{CALENDAR_API}/calendars/{conexao['calendar_id']}/events"
        while url:
            resposta = await client.get(url, params=params, headers=headers)
            if resposta.status_code == 410:
                # syncToken expirado — reseta e faz sync completo na próxima chamada
                async with db.pool.acquire() as conn:
                    await conn.execute(
                        "UPDATE google_conexoes SET sync_token = NULL WHERE profissional_id = $1",
                        profissional_id,
                    )
                return {"erro": "Sincronização expirada, tente novamente."}
            resposta.raise_for_status()
            corpo = resposta.json()

            async with db.pool.acquire() as conn:
                for evento in corpo.get("items", []):
                    event_id = evento["id"]
                    origem = evento.get("extendedProperties", {}).get("private", {}).get("origem")

                    if evento.get("status") == "cancelled":
                        resultado = await conn.execute(
                            "DELETE FROM bloqueios_horario WHERE profissional_id = $1 AND google_event_id = $2",
                            profissional_id, event_id,
                        )
                        if resultado != "DELETE 0":
                            removidos += 1
                        continue

                    if origem == "sistema":
                        ignorados += 1
                        continue

                    inicio_str = evento.get("start", {}).get("dateTime")
                    fim_str = evento.get("end", {}).get("dateTime")
                    if inicio_str and fim_str:
                        inicio = datetime.fromisoformat(inicio_str)
                        fim = datetime.fromisoformat(fim_str)
                    else:
                        # evento de dia inteiro: só tem "date" (sem hora) — bloqueia o dia todo,
                        # no fuso de Brasília. O "end.date" do Google já é exclusivo (dia seguinte).
                        data_inicio_str = evento.get("start", {}).get("date")
                        data_fim_str = evento.get("end", {}).get("date")
                        if not data_inicio_str or not data_fim_str:
                            continue
                        inicio = datetime.fromisoformat(data_inicio_str).replace(tzinfo=BRASILIA)
                        fim = datetime.fromisoformat(data_fim_str).replace(tzinfo=BRASILIA)

                    motivo = evento.get("summary", "Compromisso pessoal")
                    existente = await conn.fetchval(
                        "SELECT id FROM bloqueios_horario WHERE profissional_id = $1 AND google_event_id = $2",
                        profissional_id, event_id,
                    )
                    if existente:
                        await conn.execute(
                            """
                            UPDATE bloqueios_horario SET data_inicio = $1, data_fim = $2, motivo = $3
                            WHERE id = $4
                            """,
                            inicio, fim, motivo, existente,
                        )
                        atualizados += 1
                    else:
                        await conn.execute(
                            """
                            INSERT INTO bloqueios_horario (profissional_id, data_inicio, data_fim, motivo, google_event_id)
                            VALUES ($1, $2, $3, $4, $5)
                            """,
                            profissional_id, inicio, fim, motivo, event_id,
                        )
                        criados += 1

            novo_sync_token = corpo.get("nextSyncToken", novo_sync_token)
            url = corpo.get("nextPageToken") and f"{CALENDAR_API}/calendars/{conexao['calendar_id']}/events"
            params = {"pageToken": corpo["nextPageToken"]} if corpo.get("nextPageToken") else params
            if not corpo.get("nextPageToken"):
                break

    async with db.pool.acquire() as conn:
        await conn.execute(
            "UPDATE google_conexoes SET sync_token = $1 WHERE profissional_id = $2",
            novo_sync_token, profissional_id,
        )

    return {"criados": criados, "atualizados": atualizados, "removidos": removidos, "ignorados": ignorados}
