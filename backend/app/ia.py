"""backend/app/ia.py
Chamadas de IA (Claude, Anthropic) usadas pra pós-processar gravações da Plaud sob
demanda — gerar um texto curto a partir da transcrição, e tentar identificar dados
do paciente nela. Reaproveita a mesma ANTHROPIC_API_KEY e o mesmo modelo já usados
pelo bot do WhatsApp (app/bot.py)."""
import json

import anthropic

from app.config import settings

MODELO = "claude-haiku-4-5"


async def gerar_texto_curto(transcricao: str) -> str:
    """Resume a transcrição de uma sessão num parágrafo corrido, sem títulos nem
    listas — pensado pra colar direto nas observações clínicas da sessão. Deixa
    anthropic.APIError propagar pro chamador (é uma ação sob demanda que a
    profissional pediu clicando um botão — ela precisa saber se não funcionou, ao
    invés da falha ser escondida)."""
    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    resposta = await client.messages.create(
        model=MODELO,
        max_tokens=512,
        system=(
            "Você resume transcrições de sessões de psicologia em um único parágrafo "
            "corrido, direto, em português, sem títulos, sem listas numeradas e sem "
            "formatação markdown — só texto pronto pra colar nas observações clínicas "
            "da sessão. Foque no que for clinicamente relevante. Não invente nada que "
            "não esteja na transcrição."
        ),
        messages=[{"role": "user", "content": transcricao}],
    )
    return "".join(bloco.text for bloco in resposta.content if bloco.type == "text").strip()


async def extrair_dados_paciente(transcricao: str) -> dict:
    """Tenta identificar nome e data de nascimento do PACIENTE (não de quem mais
    estiver falando na sessão, como um responsável) na transcrição. Sempre retorna
    {"nome": ..., "data_nascimento": ...} — cada campo None quando não tiver
    certeza. Nunca inventa dado que não esteja claramente dito no texto; se só o
    dia/mês da data de nascimento aparecer (sem o ano), data_nascimento fica None,
    já que uma data sem ano não é válida pro cadastro (PacienteBody.data_nascimento
    é um date completo)."""
    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    resposta = await client.messages.create(
        model=MODELO,
        max_tokens=256,
        system=(
            'Você identifica dados do PACIENTE (não de quem mais estiver falando na '
            'sessão, como um responsável) numa transcrição de sessão de psicologia. '
            'Responda APENAS com um JSON, sem nenhum texto antes ou depois, no formato '
            'exato {"nome": string ou null, "data_nascimento": string "YYYY-MM-DD" ou '
            'null}. Só preencha um campo se estiver claramente dito na transcrição — '
            'nunca invente ou deduza. Se só o dia e o mês da data de nascimento forem '
            "mencionados, sem o ano, deixe data_nascimento como null."
        ),
        messages=[{"role": "user", "content": transcricao}],
    )
    texto = "".join(bloco.text for bloco in resposta.content if bloco.type == "text").strip()
    try:
        dados = json.loads(texto)
    except json.JSONDecodeError:
        return {"nome": None, "data_nascimento": None}
    if not isinstance(dados, dict):
        return {"nome": None, "data_nascimento": None}
    return {
        "nome": dados.get("nome") if isinstance(dados.get("nome"), str) else None,
        "data_nascimento": dados.get("data_nascimento")
        if isinstance(dados.get("data_nascimento"), str)
        else None,
    }
