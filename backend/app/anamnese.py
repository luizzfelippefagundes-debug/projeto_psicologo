import logging
import secrets
from datetime import date

from app import db, evolution, notificacoes
from app.config import settings

logger = logging.getLogger(__name__)

PROCEDIMENTOS_COM_ANAMNESE = {"reabilitacao_com_estimulacao", "neuromodulacao"}
IDADE_CORTE_INFANTIL = 12


def _calcular_idade(data_nascimento: date, referencia: date) -> int:
    """Idade em anos completos na data de referência (considera se o aniversário
    deste ano já passou, comparando (mês, dia))."""
    idade = referencia.year - data_nascimento.year
    if (referencia.month, referencia.day) < (data_nascimento.month, data_nascimento.day):
        idade -= 1  # aniversário deste ano ainda não chegou
    return idade


def determinar_tipo_formulario(tipo_procedimento: str | None, data_nascimento: date | None) -> str | None:
    """None se o procedimento não precisa de anamnese de tDCS. Senão, 'infantil' se a
    idade calculada for menor que IDADE_CORTE_INFANTIL; 'adulto' por padrão, inclusive
    quando data_nascimento é desconhecida."""
    if tipo_procedimento not in PROCEDIMENTOS_COM_ANAMNESE:
        return None
    if data_nascimento is None:
        return "adulto"
    idade = _calcular_idade(data_nascimento, date.today())
    return "infantil" if idade < IDADE_CORTE_INFANTIL else "adulto"


async def enviar_anamnese(
    *,
    paciente_id: int,
    paciente_email: str | None,
    paciente_telefone: str,
    paciente_nome: str,
    tipo_procedimento: str | None,
    data_nascimento: date | None,
    whatsapp_instance: str | None,
) -> None:
    """Manda o link do formulário de anamnese certo pro paciente, por email (se tiver)
    ou WhatsApp (se o profissional tiver instância configurada). Não faz nada se o
    procedimento não precisar de anamnese de tDCS, nem se o paciente já respondeu (o
    mesmo link é reaproveitado enquanto ele não responde — funciona como lembrete).
    Nunca levanta exceção — uma falha de envio não pode derrubar a criação/lembrete da
    sessão."""
    tipo_formulario = determinar_tipo_formulario(tipo_procedimento, data_nascimento)
    if tipo_formulario is None:
        return

    token_novo = secrets.token_urlsafe(32)
    async with db.pool.acquire() as conn:
        # ON CONFLICT DO UPDATE (em vez de DO NOTHING) é de propósito: DO NOTHING não
        # devolve nada no RETURNING quando já existe a linha, e a gente precisa do
        # token (e do respondido_em) da linha existente pra decidir o que fazer.
        linha = await conn.fetchrow(
            """
            INSERT INTO anamnese_respostas (paciente_id, token, tipo_formulario)
            VALUES ($1, $2, $3)
            ON CONFLICT (paciente_id) DO UPDATE SET paciente_id = EXCLUDED.paciente_id
            RETURNING token, respondido_em
            """,
            paciente_id, token_novo, tipo_formulario,
        )

    if linha["respondido_em"] is not None:
        return

    link = f"{settings.frontend_url}/anamnese/{linha['token']}"

    if paciente_email:
        html = f"""
        <div style="font-family: sans-serif; font-size: 15px; color: #2b2320;">
          <p>Olá, {paciente_nome}!</p>
          <p>Antes da sua consulta, pedimos que preencha o formulário de anamnese pelo link abaixo:</p>
          <p><a href="{link}" target="_blank" rel="noopener">Preencher formulário de anamnese</a></p>
          <p style="color: #8a7f78; font-size: 13px;">Mensagem automática — não responda este email.</p>
        </div>
        """
        await notificacoes.enviar_email_link(
            destinatario=paciente_email,
            assunto="Formulário de anamnese — antes da sua consulta",
            corpo_html=html,
        )
        return

    if whatsapp_instance:
        try:
            await evolution.enviar_mensagem_texto(
                whatsapp_instance,
                paciente_telefone,
                f"Antes da sua consulta, pedimos que preencha o formulário de anamnese por esse "
                f"link: {link}",
            )
        except Exception:
            logger.exception("Falha ao enviar link de anamnese por WhatsApp (telefone=%s)", paciente_telefone)
        return

    logger.warning(
        "Anamnese necessária mas sem canal de envio disponível (paciente=%s, telefone=%s)",
        paciente_nome, paciente_telefone,
    )
