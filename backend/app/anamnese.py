import logging
from datetime import date
from pathlib import Path

from app import evolution, notificacoes

logger = logging.getLogger(__name__)

PROCEDIMENTOS_COM_ANAMNESE = {"reabilitacao_com_estimulacao", "neuromodulacao"}
IDADE_CORTE_INFANTIL = 12

_DIR_ANEXOS = Path(__file__).resolve().parent / "anexos"
ARQUIVO_ADULTO = _DIR_ANEXOS / "Anamnese_tDCS.docx"
ARQUIVO_INFANTIL = _DIR_ANEXOS / "Anamnese_tDCS_Infantil.docx"


def _calcular_idade(data_nascimento: date, referencia: date) -> int:
    idade = referencia.year - data_nascimento.year
    if (referencia.month, referencia.day) < (data_nascimento.month, data_nascimento.day):
        idade -= 1
    return idade


def determinar_arquivo(tipo_procedimento: str | None, data_nascimento: date | None) -> Path | None:
    """None se o procedimento não precisa de anamnese de tDCS. Senão, o arquivo certo
    (infantil se a idade calculada for menor que IDADE_CORTE_INFANTIL; adulto por
    padrão, inclusive quando data_nascimento é desconhecida)."""
    if tipo_procedimento not in PROCEDIMENTOS_COM_ANAMNESE:
        return None
    if data_nascimento is None:
        return ARQUIVO_ADULTO
    idade = _calcular_idade(data_nascimento, date.today())
    return ARQUIVO_INFANTIL if idade < IDADE_CORTE_INFANTIL else ARQUIVO_ADULTO


async def enviar_anamnese(
    *,
    paciente_email: str | None,
    paciente_telefone: str,
    paciente_nome: str,
    tipo_procedimento: str | None,
    data_nascimento: date | None,
    whatsapp_instance: str | None,
) -> None:
    """Manda o formulário de anamnese certo pro paciente, por email (se tiver) ou
    WhatsApp (se o profissional tiver instância configurada). Não faz nada se o
    procedimento não precisar de anamnese de tDCS. Nunca levanta exceção — uma falha
    de envio não pode derrubar a criação/lembrete da sessão."""
    arquivo = determinar_arquivo(tipo_procedimento, data_nascimento)
    if arquivo is None:
        return

    if paciente_email:
        html = f"""
        <div style="font-family: sans-serif; font-size: 15px; color: #2b2320;">
          <p>Olá, {paciente_nome}!</p>
          <p>Antes da sua consulta, pedimos que preencha o formulário de anamnese em
          anexo e traga preenchido (ou envie de volta por aqui).</p>
          <p style="color: #8a7f78; font-size: 13px;">Mensagem automática — não responda este email.</p>
        </div>
        """
        await notificacoes.enviar_email_com_anexo(
            destinatario=paciente_email,
            assunto="Formulário de anamnese — antes da sua consulta",
            corpo_html=html,
            anexo_path=arquivo,
            anexo_nome=arquivo.name,
        )
        return

    if whatsapp_instance:
        try:
            await evolution.enviar_documento(
                whatsapp_instance,
                paciente_telefone,
                arquivo,
                legenda="Formulário de anamnese pra preencher antes da sua consulta 😊",
            )
        except Exception:
            logger.exception("Falha ao enviar anamnese por WhatsApp (telefone=%s)", paciente_telefone)
