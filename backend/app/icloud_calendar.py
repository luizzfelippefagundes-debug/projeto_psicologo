"""backend/app/icloud_calendar.py
Sincronização de LEITURA com o Calendário da Apple (iCloud), via CalDAV — pra
compromissos criados por voz (Siri) ou no app nativo do iPhone aparecerem como
horário ocupado no sistema, sem a profissional precisar reconfigurar nada no
aparelho (diferente do Google Calendar, que exige trocar o calendário padrão do
iPhone — na prática isso se mostrou frágil, daí essa integração).

Só leitura nessa fase — não escreve de volta pro iCloud. Sem OAuth possível (a
Apple não oferece isso pra CalDAV de terceiro): autenticação é Apple ID + uma
"senha de app" gerada manualmente em appleid.apple.com.

Todo evento novo passa pela IA (app/ia.py, ver detectar_agendamento_siri) pra
tentar identificar se é uma consulta com um paciente já cadastrado, pelo texto
do título — se for, vira uma sessão de verdade (já confirmada, vinculada ao
paciente), em vez de um bloqueio de agenda genérico.

CalDAV é um protocolo não-oficial pro iCloud (a Apple nunca declarou suporte
formal) — a biblioteca `caldav` é síncrona (bloqueante); todas as chamadas
rodam via asyncio.to_thread pra não travar o event loop do FastAPI.

Simplificação deliberada: em vez de sincronização incremental (via sync_token —
a coluna existe no banco pra uso futuro, mas não é usada aqui), cada ciclo busca
a janela inteira de 90 dias e reconcilia com o banco por comparação direta. Evita
depender de um detalhe do protocolo não totalmente confirmado (como o servidor
iCloud representa um evento excluído num relatório de sincronização) — mesmo
efeito prático de manter bloqueios_horario em dia, código bem mais simples."""
import asyncio
import logging
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import asyncpg
import caldav

from app import db, ia

logger = logging.getLogger(__name__)

BRASILIA = ZoneInfo("America/Sao_Paulo")
INTERVALO_SINCRONIZACAO = timedelta(minutes=1)
ICLOUD_URL = "https://caldav.icloud.com"


def _conectar_sincrono(apple_id: str, senha_app: str, calendar_url: str | None = None) -> caldav.Calendar:
    """Abre a conexão CalDAV e devolve o calendário principal. Bloqueante — só
    chamar de dentro de asyncio.to_thread. Se `calendar_url` for passado (já
    descoberto numa conexão anterior), reconstrói o objeto Calendar direto,
    sem precisar descobrir o principal de novo a cada sincronização."""
    client = caldav.DAVClient(url=ICLOUD_URL, username=apple_id, password=senha_app)
    if calendar_url:
        return caldav.Calendar(client=client, url=calendar_url)
    principal = client.principal()
    calendarios = principal.calendars()
    if not calendarios:
        raise ValueError("Nenhum calendário encontrado nessa conta iCloud.")
    return calendarios[0]


async def testar_conexao(apple_id: str, senha_app: str) -> str:
    """Testa as credenciais abrindo a conexão de verdade. Devolve a URL do
    calendário principal (pra cachear) se der certo; deixa a exceção propagar
    se falhar (credencial errada, conta sem calendário, etc.) — o chamador
    decide a mensagem de erro pro usuário."""
    calendario = await asyncio.to_thread(_conectar_sincrono, apple_id, senha_app)
    return str(calendario.url)


async def salvar_conexao(profissional_id: int, apple_id: str, senha_app: str, calendar_url: str) -> None:
    async with db.pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO icloud_conexoes (profissional_id, apple_id, senha_app, calendar_url)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (profissional_id) DO UPDATE SET
                apple_id = EXCLUDED.apple_id,
                senha_app = EXCLUDED.senha_app,
                calendar_url = EXCLUDED.calendar_url,
                sync_token = NULL
            """,
            profissional_id, apple_id, senha_app, calendar_url,
        )


async def obter_conexao(profissional_id: int):
    async with db.pool.acquire() as conn:
        return await conn.fetchrow(
            "SELECT * FROM icloud_conexoes WHERE profissional_id = $1", profissional_id
        )


async def desconectar(profissional_id: int) -> None:
    async with db.pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "DELETE FROM bloqueios_horario WHERE profissional_id = $1 AND icloud_event_uid IS NOT NULL",
                profissional_id,
            )
            # Sessões (consultas de verdade, com paciente vinculado) não são
            # apagadas — só canceladas, pra manter o histórico do paciente.
            await conn.execute(
                "UPDATE sessoes SET status = 'cancelada' "
                "WHERE profissional_id = $1 AND icloud_event_uid IS NOT NULL AND status <> 'cancelada'",
                profissional_id,
            )
            await conn.execute(
                "DELETE FROM icloud_conexoes WHERE profissional_id = $1", profissional_id
            )


def _extrair_datas(componente) -> tuple[datetime, datetime] | None:
    """Extrai início/fim de um VEVENT do icalendar. Eventos de dia inteiro vêm
    como `date` (sem hora) em vez de `datetime` — nesse caso assume meia-noite a
    meia-noite no fuso de Brasília, mesmo tratamento já usado pro Google
    Calendar em backend/app/google_calendar.py."""
    dtstart = componente.get("dtstart")
    dtend = componente.get("dtend")
    if dtstart is None or dtend is None:
        return None
    inicio = dtstart.dt
    fim = dtend.dt
    if not isinstance(inicio, datetime):
        inicio = datetime(inicio.year, inicio.month, inicio.day, tzinfo=BRASILIA)
        fim = datetime(fim.year, fim.month, fim.day, tzinfo=BRASILIA)
    return inicio, fim


def _sincronizar_sincrono(apple_id: str, senha_app: str, calendar_url: str) -> list[dict]:
    """Busca a janela de 90 dias e devolve os eventos já convertidos pra tipos
    Python puros (nada de objetos da lib caldav saindo daqui) — o resto (gravar
    no banco) roda async, fora desta função. Bloqueante — só chamar de dentro
    de asyncio.to_thread."""
    calendario = _conectar_sincrono(apple_id, senha_app, calendar_url)
    agora = datetime.now(timezone.utc)
    objetos = calendario.date_search(start=agora, end=agora + timedelta(days=90))

    eventos = []
    for objeto in objetos:
        componente = objeto.icalendar_component
        datas = _extrair_datas(componente)
        if datas is None:
            continue
        inicio, fim = datas
        uid = componente.get("uid")
        if not uid:
            continue
        eventos.append({
            "uid": str(uid),
            "motivo": str(componente.get("summary", "Compromisso pessoal")),
            "inicio": inicio,
            "fim": fim,
        })
    return eventos


async def _tentar_criar_sessao(conn, profissional_id: int, evento: dict, cache: dict) -> bool:
    """Tenta identificar (via IA) se o evento é uma consulta com um paciente já
    cadastrado e, se for, cria a sessão direto (já confirmada, vinculada ao
    paciente). Devolve True se criou a sessão; False se não identificou ninguém
    (o chamador cria um bloqueio genérico nesse caso) ou se o horário já estava
    ocupado por outra sessão no mesmo local — cai pra bloqueio também, pra não
    perder o evento e ela conferir manualmente. `cache` guarda pacientes/locais
    já buscados nessa mesma sincronização, pra não repetir a consulta a cada
    evento novo."""
    if "pacientes" not in cache:
        pacientes_rows = await conn.fetch(
            "SELECT id, nome FROM pacientes WHERE profissional_id = $1 AND status = 'ativo'",
            profissional_id,
        )
        locais_rows = await conn.fetch(
            "SELECT id, nome FROM locais WHERE profissional_id = $1", profissional_id
        )
        cache["pacientes"] = [dict(r) for r in pacientes_rows]
        cache["locais"] = [dict(r) for r in locais_rows]

    if not cache["pacientes"]:
        return False

    deteccao = await ia.detectar_agendamento_siri(evento["motivo"], cache["pacientes"], cache["locais"])
    if deteccao["paciente_id"] is None:
        return False

    local_id = deteccao["local_id"] or (cache["locais"][0]["id"] if cache["locais"] else None)
    if local_id is None:
        return False

    duracao_minutos = max(int((evento["fim"] - evento["inicio"]).total_seconds() / 60), 1)

    try:
        await conn.execute(
            """
            INSERT INTO sessoes (profissional_id, paciente_id, local_id, data_hora, duracao_minutos,
                                  modalidade, status, observacoes, icloud_event_uid)
            VALUES ($1, $2, $3, $4, $5, 'presencial', 'confirmada', $6, $7)
            """,
            profissional_id, deteccao["paciente_id"], local_id, evento["inicio"], duracao_minutos,
            "Agendada automaticamente via Siri/Calendário iCloud.", evento["uid"],
        )
    except asyncpg.exceptions.ExclusionViolationError:
        logger.warning(
            "Evento do iCloud identificado como consulta mas horário já ocupado nesse local "
            "(profissional_id=%s, uid=%s) — virou bloqueio genérico pra ela conferir.",
            profissional_id, evento["uid"],
        )
        return False
    return True


async def puxar_eventos_do_icloud(profissional_id: int) -> dict:
    conexao = await obter_conexao(profissional_id)
    if conexao is None:
        return {"erro": "Não conectado ao Calendário iCloud."}

    try:
        eventos = await asyncio.to_thread(
            _sincronizar_sincrono, conexao["apple_id"], conexao["senha_app"], conexao["calendar_url"],
        )
    except Exception:
        logger.exception("Falha ao sincronizar iCloud Calendar (profissional_id=%s)", profissional_id)
        return {"erro": "Não foi possível sincronizar agora — confira a senha de app."}

    uids_atuais = [evento["uid"] for evento in eventos]
    criados = atualizados = sessoes_criadas = 0
    cache: dict = {}

    async with db.pool.acquire() as conn:
        for evento in eventos:
            sessao_existente = await conn.fetchval(
                "SELECT id FROM sessoes WHERE profissional_id = $1 AND icloud_event_uid = $2",
                profissional_id, evento["uid"],
            )
            if sessao_existente:
                await conn.execute(
                    "UPDATE sessoes SET data_hora = $1, duracao_minutos = $2 "
                    "WHERE id = $3 AND status <> 'cancelada'",
                    evento["inicio"], max(int((evento["fim"] - evento["inicio"]).total_seconds() / 60), 1),
                    sessao_existente,
                )
                atualizados += 1
                continue

            bloqueio_existente = await conn.fetchval(
                "SELECT id FROM bloqueios_horario WHERE profissional_id = $1 AND icloud_event_uid = $2",
                profissional_id, evento["uid"],
            )
            if bloqueio_existente:
                await conn.execute(
                    "UPDATE bloqueios_horario SET data_inicio = $1, data_fim = $2, motivo = $3 WHERE id = $4",
                    evento["inicio"], evento["fim"], evento["motivo"], bloqueio_existente,
                )
                atualizados += 1
                continue

            # Evento novo — nunca visto nem como sessão nem como bloqueio. Tenta
            # identificar se é uma consulta com um paciente cadastrado antes de
            # cair no comportamento padrão (bloqueio genérico).
            if await _tentar_criar_sessao(conn, profissional_id, evento, cache):
                sessoes_criadas += 1
            else:
                await conn.execute(
                    """
                    INSERT INTO bloqueios_horario (profissional_id, data_inicio, data_fim, motivo, icloud_event_uid)
                    VALUES ($1, $2, $3, $4, $5)
                    """,
                    profissional_id, evento["inicio"], evento["fim"], evento["motivo"], evento["uid"],
                )
                criados += 1

        removidos = await conn.fetchval(
            """
            WITH apagados AS (
                DELETE FROM bloqueios_horario
                WHERE profissional_id = $1 AND icloud_event_uid IS NOT NULL
                  AND NOT (icloud_event_uid = ANY($2::text[]))
                RETURNING id
            )
            SELECT count(*) FROM apagados
            """,
            profissional_id, uids_atuais,
        )

        # Evento de consulta removido/cancelado direto no iCloud: cancela a sessão
        # em vez de apagar, pra manter o histórico (mesmo tratamento que cancelar
        # uma sessão manualmente).
        sessoes_canceladas = await conn.fetchval(
            """
            WITH atualizadas AS (
                UPDATE sessoes SET status = 'cancelada'
                WHERE profissional_id = $1 AND icloud_event_uid IS NOT NULL AND status <> 'cancelada'
                  AND NOT (icloud_event_uid = ANY($2::text[]))
                RETURNING id
            )
            SELECT count(*) FROM atualizadas
            """,
            profissional_id, uids_atuais,
        )

    return {
        "criados": criados,
        "atualizados": atualizados,
        "removidos": removidos,
        "sessoes_criadas": sessoes_criadas,
        "sessoes_canceladas": sessoes_canceladas,
    }


async def _sincronizar_todos_conectados() -> None:
    async with db.pool.acquire() as conn:
        profissionais_ids = await conn.fetchval("SELECT array_agg(profissional_id) FROM icloud_conexoes")
    for profissional_id in profissionais_ids or []:
        try:
            await puxar_eventos_do_icloud(profissional_id)
        except Exception:
            logger.exception(
                "Erro na sincronização automática do iCloud Calendar (profissional_id=%s)", profissional_id
            )


async def loop_sincronizacao() -> None:
    while True:
        try:
            await _sincronizar_todos_conectados()
        except Exception:
            logger.exception("Erro no loop de sincronização do iCloud Calendar")
        await asyncio.sleep(INTERVALO_SINCRONIZACAO.total_seconds())
