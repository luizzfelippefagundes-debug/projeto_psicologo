import asyncio
from datetime import datetime, timedelta
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

import resend

from app.config import settings

BRASILIA = ZoneInfo("America/Sao_Paulo")


def link_google_calendar(titulo: str, inicio: datetime, fim: datetime, local: str, detalhes: str) -> str:
    params = {
        "action": "TEMPLATE",
        "text": titulo,
        "dates": f"{inicio.strftime('%Y%m%dT%H%M%SZ')}/{fim.strftime('%Y%m%dT%H%M%SZ')}",
        "details": detalhes,
        "location": local,
    }
    return "https://calendar.google.com/calendar/render?" + urlencode(params)


def _formatar_data_hora_brasilia(dt: datetime) -> str:
    return dt.astimezone(BRASILIA).strftime("%d/%m/%Y às %H:%M")


async def enviar_email_sessao(
    *,
    tipo: str,  # "confirmacao" | "reagendamento" | "cancelamento"
    paciente_email: str | None,
    paciente_nome: str,
    profissional_nome: str,
    data_hora: datetime,
    duracao_minutos: int,
    local_nome: str,
    modalidade: str,
) -> None:
    if not paciente_email or not settings.resend_api_key:
        return

    resend.api_key = settings.resend_api_key

    data_formatada = _formatar_data_hora_brasilia(data_hora)
    modalidade_label = "presencial" if modalidade == "presencial" else "por teleconsulta"

    if tipo == "cancelamento":
        assunto = f"Sessão cancelada — {data_formatada}"
        corpo_principal = (
            f"Sua sessão com {profissional_nome}, marcada para {data_formatada}, foi cancelada."
        )
        link_calendario_html = ""
    else:
        assunto = (
            f"Sessão confirmada — {data_formatada}"
            if tipo == "confirmacao"
            else f"Sessão reagendada — {data_formatada}"
        )
        acao = "confirmada" if tipo == "confirmacao" else "reagendada"
        corpo_principal = (
            f"Sua sessão com {profissional_nome} foi {acao} para <strong>{data_formatada}</strong>, "
            f"{modalidade_label}, em {local_nome} ({duracao_minutos} min)."
        )
        fim = data_hora + timedelta(minutes=duracao_minutos)
        link = link_google_calendar(
            titulo=f"Sessão com {profissional_nome}",
            inicio=data_hora,
            fim=fim,
            local=local_nome,
            detalhes=f"Sessão {modalidade_label} com {profissional_nome}.",
        )
        link_calendario_html = (
            f'<p><a href="{link}" target="_blank" rel="noopener">Adicionar ao Google Calendar</a></p>'
        )

    html = f"""
    <div style="font-family: sans-serif; font-size: 15px; color: #2b2320;">
      <p>Olá, {paciente_nome}!</p>
      <p>{corpo_principal}</p>
      {link_calendario_html}
      <p style="color: #8a7f78; font-size: 13px;">Mensagem automática — não responda este email.</p>
    </div>
    """

    await asyncio.to_thread(
        resend.Emails.send,
        {
            "from": settings.resend_from_email,
            "to": paciente_email,
            "subject": assunto,
            "html": html,
        },
    )
