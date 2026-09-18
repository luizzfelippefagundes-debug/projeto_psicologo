"""backend/app/ia.py
Chamadas de IA (Claude, Anthropic) usadas pra pós-processar gravações da Plaud sob
demanda — gerar um texto curto a partir da transcrição, e tentar identificar dados
do paciente nela. Reaproveita a mesma ANTHROPIC_API_KEY e o mesmo modelo já usados
pelo bot do WhatsApp (app/bot.py)."""
import json
import re

import anthropic

from app.config import settings

MODELO = "claude-haiku-4-5"


def _extrair_json(texto: str) -> dict | None:
    """Extrai o primeiro objeto JSON de um texto, mesmo se vier envolto em
    ```json ... ``` ou com texto antes/depois — confirmado contra uma chamada real
    que a Claude, apesar da instrução de "responda só com JSON", devolveu o objeto
    dentro de um bloco de código markdown."""
    encontrado = re.search(r"\{.*\}", texto, re.DOTALL)
    if not encontrado:
        return None
    try:
        dados = json.loads(encontrado.group(0))
    except json.JSONDecodeError:
        return None
    return dados if isinstance(dados, dict) else None


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
    dados = _extrair_json(texto)
    if dados is None:
        return {"nome": None, "data_nascimento": None}
    return {
        "nome": dados.get("nome") if isinstance(dados.get("nome"), str) else None,
        "data_nascimento": dados.get("data_nascimento")
        if isinstance(dados.get("data_nascimento"), str)
        else None,
    }


async def detectar_agendamento_siri(
    titulo: str, pacientes: list[dict], locais: list[dict]
) -> dict:
    """Tenta identificar, pelo título de um evento criado por voz (Siri) no
    Calendário iCloud, se é uma consulta com algum paciente já cadastrado — e, se
    for, com qual e em qual local. Usado na sincronização do iCloud pra decidir se
    um evento novo vira uma sessão de verdade (vinculada a um paciente) ou só um
    bloqueio de agenda genérico (compromisso pessoal). Sempre retorna
    {"paciente_id": ..., "local_id": ..., "nome_sugerido": ...}, cada campo None
    quando não tiver certeza — nunca inventa um paciente/local que não bate com o
    texto, e nunca devolve um id fora das listas passadas (defesa contra
    alucinação). `nome_sugerido` só vem preenchido quando o evento claramente
    parece uma consulta (ex: "Consulta com Fulano", "Sessão — Beltrana") mas o nome
    não bateu com nenhum paciente cadastrado — útil pra sugerir cadastrar esse
    paciente, em vez de simplesmente virar um bloqueio genérico sem explicação."""
    ids_pacientes_validos = {p["id"] for p in pacientes}
    ids_locais_validos = {l["id"] for l in locais}

    lista_pacientes = "\n".join(f"- id {p['id']}: {p['nome']}" for p in pacientes) or "(nenhum paciente cadastrado)"
    lista_locais = "\n".join(f"- id {l['id']}: {l['nome']}" for l in locais) or "(nenhum local cadastrado)"

    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    resposta = await client.messages.create(
        model=MODELO,
        max_tokens=192,
        system=(
            "Você recebe o título de um evento criado por voz (Siri) no Calendário de "
            "uma psicóloga, junto com a lista de pacientes e de locais de atendimento "
            "já cadastrados no sistema dela (cada um com id e nome). Determine se o "
            "título indica claramente uma consulta com um desses pacientes — considere "
            "variações razoáveis do nome (apelido óbvio, nome incompleto), mas nunca "
            "invente um paciente que não bate com o texto. Se o título também deixar "
            "claro em qual dos locais cadastrados é, identifique o local também. Se o "
            "título claramente parece uma consulta (palavras como \"consulta\", "
            "\"sessão\", \"atendimento\", ou só um nome de pessoa sozinho) mas o nome "
            "citado NÃO bate com nenhum paciente da lista, extraia esse nome em "
            "nome_sugerido — mas só nesse caso; pra compromissos pessoais comuns "
            "(mercado, dentista, almoço com alguém, etc.) deixe nome_sugerido null. "
            'Responda APENAS com um JSON, sem texto antes ou depois, no formato exato '
            '{"paciente_id": id do paciente ou null, "local_id": id do local ou null, '
            '"nome_sugerido": nome da pessoa ou null}. Use sempre os ids exatos das '
            "listas recebidas."
        ),
        messages=[{
            "role": "user",
            "content": f"Título do evento: {titulo}\n\nPacientes cadastrados:\n{lista_pacientes}\n\n"
                       f"Locais cadastrados:\n{lista_locais}",
        }],
    )
    texto = "".join(bloco.text for bloco in resposta.content if bloco.type == "text").strip()
    dados = _extrair_json(texto)
    if dados is None:
        return {"paciente_id": None, "local_id": None, "nome_sugerido": None}

    paciente_id = dados.get("paciente_id")
    local_id = dados.get("local_id")
    nome_sugerido = dados.get("nome_sugerido")
    return {
        "paciente_id": paciente_id if paciente_id in ids_pacientes_validos else None,
        "local_id": local_id if local_id in ids_locais_validos else None,
        "nome_sugerido": nome_sugerido if isinstance(nome_sugerido, str) and nome_sugerido.strip() else None,
    }
