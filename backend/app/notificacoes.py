import asyncio
import logging
from datetime import datetime, timedelta
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

import resend

from app.config import settings

logger = logging.getLogger(__name__)

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
    tipo: str,  # "confirmacao" | "reagendamento" | "cancelamento" | "lembrete"
    paciente_email: str | None,
    paciente_nome: str,
    profissional_nome: str,
    data_hora: datetime,
    duracao_minutos: int,
    local_nome: str,
    modalidade: str,
    link_teleconsulta: str | None = None,
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
        rotulo_assunto = {
            "confirmacao": "Sessão confirmada",
            "reagendamento": "Sessão reagendada",
            "lembrete": "Lembrete de sessão",
        }.get(tipo, "Sessão")
        assunto = f"{rotulo_assunto} — {data_formatada}"

        if tipo == "lembrete":
            corpo_principal = (
                f"Passando pra lembrar: sua sessão com {profissional_nome} é "
                f"<strong>{data_formatada}</strong>, {modalidade_label}, em {local_nome} ({duracao_minutos} min)."
            )
        else:
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

    link_teleconsulta_html = ""
    if link_teleconsulta and modalidade == "teleconsulta" and tipo != "cancelamento":
        link_teleconsulta_html = (
            f'<p><a href="{link_teleconsulta}" target="_blank" rel="noopener">'
            f"Entrar na teleconsulta</a></p>"
        )

    html = f"""
    <div style="font-family: sans-serif; font-size: 15px; color: #2b2320;">
      <p>Olá, {paciente_nome}!</p>
      <p>{corpo_principal}</p>
      {link_teleconsulta_html}
      {link_calendario_html}
      <p style="color: #8a7f78; font-size: 13px;">Mensagem automática — não responda este email.</p>
    </div>
    """

    try:
        await asyncio.to_thread(
            resend.Emails.send,
            {
                "from": settings.resend_from_email,
                "to": paciente_email,
                "subject": assunto,
                "html": html,
            },
        )
    except Exception:
        logger.exception("Falha ao enviar email de notificação de sessão (tipo=%s)", tipo)


async def enviar_alerta_crise(
    *,
    profissional_email: str,
    profissional_nome: str,
    motivo: str,
    resumo_conversa: str,
    telefone_paciente: str,
) -> None:
    if not settings.resend_api_key:
        logger.warning("Alerta de crise não enviado por email (Resend não configurado): %s", resumo_conversa)
        return

    resend.api_key = settings.resend_api_key
    motivo_label = "situação de crise" if motivo == "crise" else "fora do escopo do atendimento"

    html = f"""
    <div style="font-family: sans-serif; font-size: 15px; color: #2b2320;">
      <p>Olá, {profissional_nome}.</p>
      <p><strong>O assistente identificou uma conversa que precisa da sua atenção imediata</strong>
      ({motivo_label}).</p>
      <p>Paciente (telefone): {telefone_paciente}</p>
      <p style="background:#f5ecd6; padding:12px; border-radius:8px;">{resumo_conversa}</p>
      <p style="color: #8a7f78; font-size: 13px;">Mensagem automática — não responda este email.</p>
    </div>
    """

    try:
        await asyncio.to_thread(
            resend.Emails.send,
            {
                "from": settings.resend_from_email,
                "to": profissional_email,
                "subject": f"⚠️ Atenção necessária — {motivo_label}",
                "html": html,
            },
        )
    except Exception:
        logger.exception("Falha ao enviar alerta de crise por email")
