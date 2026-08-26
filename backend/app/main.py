import asyncio
import json
import logging
import secrets
from contextlib import asynccontextmanager
from datetime import date, datetime, time

import asyncpg
from fastapi import Depends, FastAPI, HTTPException, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from google import genai
from google.genai import types as genai_types
from pydantic import BaseModel, EmailStr

from app import auth, bot, db, evolution, google_calendar, lembretes, notificacoes
from app.config import settings

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.connect()
    tarefa_lembretes = asyncio.create_task(lembretes.loop_lembretes())
    yield
    tarefa_lembretes.cancel()
    await db.disconnect()


app = FastAPI(title="Bot de Agendamento — API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://frontend-theta-weld-74.vercel.app",
    ],
    allow_origin_regex=r"https://frontend-.*-luiz-felippe-silva-fagundes-projects\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def set_session_cookie(response: Response, profissional_id: int) -> None:
    token = auth.criar_token(profissional_id)
    response.set_cookie(
        key=auth.COOKIE_NAME,
        value=token,
        httponly=True,
        # cross-site (Vercel + backend em outro domínio) só aceita cookie com SameSite=None,
        # que por sua vez exige Secure=True — local sem Docker usa Lax/http normalmente
        samesite="none" if settings.cookie_cross_site else "lax",
        secure=settings.cookie_cross_site,
        max_age=int(auth.EXPIRES_IN.total_seconds()),
        path="/",
    )


@app.get("/health")
async def health():
    async with db.pool.acquire() as conn:
        await conn.execute("SELECT 1")
    return {"status": "ok"}


class SignupBody(BaseModel):
    nome: str
    email: EmailStr
    senha: str


class LoginBody(BaseModel):
    email: EmailStr
    senha: str


@app.post("/auth/signup", status_code=status.HTTP_201_CREATED)
async def signup(body: SignupBody, response: Response):
    async with db.pool.acquire() as conn:
        existente = await conn.fetchval("SELECT id FROM profissionais WHERE email = $1", body.email)
        if existente:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="E-mail já cadastrado")

        profissional_id = await conn.fetchval(
            """
            INSERT INTO profissionais (nome, email, senha_hash)
            VALUES ($1, $2, $3)
            RETURNING id
            """,
            body.nome, body.email, auth.hash_senha(body.senha),
        )

    set_session_cookie(response, profissional_id)
    return {"id": profissional_id, "nome": body.nome, "email": body.email}


@app.post("/auth/login")
async def login(body: LoginBody, response: Response):
    async with db.pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, nome, senha_hash FROM profissionais WHERE email = $1", body.email
        )
    if row is None or not auth.verificar_senha(body.senha, row["senha_hash"]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="E-mail ou senha inválidos")

    set_session_cookie(response, row["id"])
    return {"id": row["id"], "nome": row["nome"], "email": body.email}


@app.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie(auth.COOKIE_NAME, path="/")
    return {"status": "ok"}


@app.get("/auth/me")
async def me(profissional_id: int = Depends(auth.get_current_profissional_id)):
    async with db.pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, nome, email FROM profissionais WHERE id = $1", profissional_id
        )
    return dict(row)


class LocalBody(BaseModel):
    nome: str
    endereco: str | None = None


@app.get("/locais")
async def listar_locais(profissional_id: int = Depends(auth.get_current_profissional_id)):
    async with db.pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, nome, endereco, criado_em FROM locais WHERE profissional_id = $1 ORDER BY nome",
            profissional_id,
        )
    return [dict(row) for row in rows]


@app.post("/locais", status_code=status.HTTP_201_CREATED)
async def criar_local(body: LocalBody, profissional_id: int = Depends(auth.get_current_profissional_id)):
    async with db.pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO locais (profissional_id, nome, endereco)
            VALUES ($1, $2, $3)
            RETURNING id, nome, endereco, criado_em
            """,
            profissional_id, body.nome, body.endereco,
        )
    return dict(row)


class RegraHorarioBody(BaseModel):
    local_id: int
    dias_semana: list[int]
    hora_inicio: time
    hora_fim: time


@app.get("/regras-horario")
async def listar_regras_horario(profissional_id: int = Depends(auth.get_current_profissional_id)):
    async with db.pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT r.id, r.local_id, l.nome AS local_nome, r.dia_semana,
                   r.hora_inicio, r.hora_fim, r.ativo
            FROM regras_horario r
            JOIN locais l ON l.id = r.local_id
            WHERE r.profissional_id = $1
            ORDER BY l.nome, r.dia_semana, r.hora_inicio
            """,
            profissional_id,
        )
    return [dict(row) for row in rows]


@app.post("/regras-horario", status_code=status.HTTP_201_CREATED)
async def criar_regra_horario(
    body: RegraHorarioBody, profissional_id: int = Depends(auth.get_current_profissional_id)
):
    dias = sorted(set(body.dias_semana))
    if not dias:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Selecione ao menos um dia")
    if any(not (0 <= dia <= 6) for dia in dias):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="dia_semana deve ser entre 0 e 6")
    if body.hora_inicio >= body.hora_fim:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="hora_inicio deve ser antes de hora_fim")

    async with db.pool.acquire() as conn:
        local = await conn.fetchval(
            "SELECT id FROM locais WHERE id = $1 AND profissional_id = $2", body.local_id, profissional_id
        )
        if local is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Local não encontrado")

        async with conn.transaction():
            rows = [
                await conn.fetchrow(
                    """
                    INSERT INTO regras_horario (profissional_id, local_id, dia_semana, hora_inicio, hora_fim)
                    VALUES ($1, $2, $3, $4, $5)
                    RETURNING id, local_id, dia_semana, hora_inicio, hora_fim, ativo
                    """,
                    profissional_id, body.local_id, dia, body.hora_inicio, body.hora_fim,
                )
                for dia in dias
            ]
    return [dict(row) for row in rows]


@app.delete("/regras-horario/{regra_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remover_regra_horario(
    regra_id: int, profissional_id: int = Depends(auth.get_current_profissional_id)
):
    async with db.pool.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM regras_horario WHERE id = $1 AND profissional_id = $2", regra_id, profissional_id
        )
    if result == "DELETE 0":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Regra não encontrada")


@app.get("/pacientes")
async def listar_pacientes(profissional_id: int = Depends(auth.get_current_profissional_id)):
    async with db.pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT p.id, p.nome, p.telefone, p.email, p.tipo_atendimento, p.tipo_procedimento, p.status, p.criado_em,
                   p.consentimento_lgpd, p.consentimento_lgpd_data,
                   prox.data_hora AS proxima_sessao
            FROM pacientes p
            LEFT JOIN LATERAL (
                SELECT data_hora FROM sessoes
                WHERE paciente_id = p.id AND status <> 'cancelada' AND data_hora >= now()
                ORDER BY data_hora ASC
                LIMIT 1
            ) prox ON true
            WHERE p.profissional_id = $1
            ORDER BY p.nome
            """,
            profissional_id,
        )
    return [dict(row) for row in rows]


TIPOS_PROCEDIMENTO = (
    "avaliacao_neuropsicologica",
    "terapia",
    "reabilitacao_com_estimulacao",
    "reabilitacao_sem_estimulacao",
    "neuromodulacao",
)


class PacienteBody(BaseModel):
    nome: str
    telefone: str
    email: EmailStr | None = None
    tipo_atendimento: str = "individual"
    tipo_procedimento: str
    consentimento_lgpd: bool = False


class PacienteUpdateBody(BaseModel):
    nome: str | None = None
    telefone: str | None = None
    email: EmailStr | None = None
    tipo_atendimento: str | None = None
    tipo_procedimento: str | None = None
    status: str | None = None
    consentimento_lgpd: bool | None = None


@app.post("/pacientes", status_code=status.HTTP_201_CREATED)
async def criar_paciente(body: PacienteBody, profissional_id: int = Depends(auth.get_current_profissional_id)):
    if body.tipo_atendimento not in ("individual", "casal"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="tipo_atendimento inválido")
    if body.tipo_procedimento not in TIPOS_PROCEDIMENTO:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="tipo_procedimento inválido")
    if not body.consentimento_lgpd:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Consentimento LGPD é obrigatório pra cadastrar um paciente",
        )

    async with db.pool.acquire() as conn:
        existente = await conn.fetchval(
            "SELECT id FROM pacientes WHERE profissional_id = $1 AND telefone = $2",
            profissional_id, body.telefone,
        )
        if existente:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Já existe um paciente com esse telefone"
            )

        row = await conn.fetchrow(
            """
            INSERT INTO pacientes (
                profissional_id, nome, telefone, email, tipo_atendimento, tipo_procedimento,
                consentimento_lgpd, consentimento_lgpd_data
            )
            VALUES ($1, $2, $3, $4, $5, $6, true, now())
            RETURNING id, nome, telefone, email, tipo_atendimento, tipo_procedimento, status, criado_em,
                      consentimento_lgpd, consentimento_lgpd_data
            """,
            profissional_id, body.nome, body.telefone, body.email, body.tipo_atendimento, body.tipo_procedimento,
        )
    return dict(row)


@app.patch("/pacientes/{paciente_id}")
async def editar_paciente(
    paciente_id: int,
    body: PacienteUpdateBody,
    profissional_id: int = Depends(auth.get_current_profissional_id),
):
    if body.tipo_atendimento is not None and body.tipo_atendimento not in ("individual", "casal"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="tipo_atendimento inválido")
    if body.tipo_procedimento is not None and body.tipo_procedimento not in TIPOS_PROCEDIMENTO:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="tipo_procedimento inválido")
    if body.status is not None and body.status not in ("ativo", "inativo"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="status inválido")

    async with db.pool.acquire() as conn:
        atual = await conn.fetchval(
            "SELECT id FROM pacientes WHERE id = $1 AND profissional_id = $2", paciente_id, profissional_id
        )
        if atual is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Paciente não encontrado")

        if body.telefone is not None:
            duplicado = await conn.fetchval(
                "SELECT id FROM pacientes WHERE profissional_id = $1 AND telefone = $2 AND id <> $3",
                profissional_id, body.telefone, paciente_id,
            )
            if duplicado:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT, detail="Já existe um paciente com esse telefone"
                )

        row = await conn.fetchrow(
            """
            UPDATE pacientes SET
                nome = COALESCE($1, nome),
                telefone = COALESCE($2, telefone),
                email = COALESCE($3, email),
                tipo_atendimento = COALESCE($4, tipo_atendimento),
                tipo_procedimento = COALESCE($5, tipo_procedimento),
                status = COALESCE($6, status),
                consentimento_lgpd = COALESCE($9, consentimento_lgpd),
                consentimento_lgpd_data = CASE
                    WHEN $9 = true AND consentimento_lgpd_data IS NULL THEN now()
                    ELSE consentimento_lgpd_data
                END
            WHERE id = $7 AND profissional_id = $8
            RETURNING id, nome, telefone, email, tipo_atendimento, tipo_procedimento, status, criado_em,
                      consentimento_lgpd, consentimento_lgpd_data
            """,
            body.nome, body.telefone, body.email, body.tipo_atendimento, body.tipo_procedimento, body.status,
            paciente_id, profissional_id, body.consentimento_lgpd,
        )
    return dict(row)


@app.get("/pacientes/{paciente_id}")
async def obter_paciente(paciente_id: int, profissional_id: int = Depends(auth.get_current_profissional_id)):
    async with db.pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT p.id, p.nome, p.telefone, p.email, p.tipo_atendimento, p.tipo_procedimento,
                   p.status, p.criado_em, p.consentimento_lgpd, p.consentimento_lgpd_data,
                   prox.data_hora AS proxima_sessao
            FROM pacientes p
            LEFT JOIN LATERAL (
                SELECT data_hora FROM sessoes
                WHERE paciente_id = p.id AND status <> 'cancelada' AND data_hora >= now()
                ORDER BY data_hora ASC
                LIMIT 1
            ) prox ON true
            WHERE p.id = $1 AND p.profissional_id = $2
            """,
            paciente_id, profissional_id,
        )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Paciente não encontrado")
    return dict(row)


@app.get("/pacientes/{paciente_id}/sessoes")
async def listar_sessoes_paciente(paciente_id: int, profissional_id: int = Depends(auth.get_current_profissional_id)):
    async with db.pool.acquire() as conn:
        paciente = await conn.fetchval(
            "SELECT id FROM pacientes WHERE id = $1 AND profissional_id = $2", paciente_id, profissional_id
        )
        if paciente is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Paciente não encontrado")

        rows = await conn.fetch(
            """
            SELECT s.id, s.data_hora, s.duracao_minutos, s.modalidade, s.status, s.observacoes,
                   l.nome AS local_nome
            FROM sessoes s
            JOIN locais l ON l.id = s.local_id
            WHERE s.paciente_id = $1 AND s.profissional_id = $2
            ORDER BY s.data_hora DESC
            """,
            paciente_id, profissional_id,
        )
    return [dict(row) for row in rows]


@app.get("/sessoes/hoje")
async def listar_sessoes_hoje(profissional_id: int = Depends(auth.get_current_profissional_id)):
    async with db.pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT s.id, s.data_hora, s.duracao_minutos, s.modalidade, s.status,
                   p.nome AS paciente_nome, l.nome AS local_nome
            FROM sessoes s
            JOIN pacientes p ON p.id = s.paciente_id
            JOIN locais l ON l.id = s.local_id
            WHERE s.profissional_id = $1
              AND s.data_hora::date = CURRENT_DATE
              AND s.status <> 'cancelada'
            ORDER BY s.data_hora
            """,
            profissional_id,
        )
    return [dict(row) for row in rows]


@app.get("/sessoes")
async def listar_sessoes_periodo(
    inicio: date,
    fim: date,
    profissional_id: int = Depends(auth.get_current_profissional_id),
):
    async with db.pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT s.id, s.data_hora, s.duracao_minutos, s.modalidade, s.status, s.observacoes,
                   s.paciente_id, p.nome AS paciente_nome, l.id AS local_id, l.nome AS local_nome
            FROM sessoes s
            JOIN pacientes p ON p.id = s.paciente_id
            JOIN locais l ON l.id = s.local_id
            WHERE s.profissional_id = $1
              AND s.data_hora::date BETWEEN $2::date AND $3::date
              AND s.status <> 'cancelada'
            ORDER BY s.data_hora
            """,
            profissional_id, inicio, fim,
        )
    return [dict(row) for row in rows]


class SessaoBody(BaseModel):
    paciente_id: int
    local_id: int
    data_hora: datetime
    duracao_minutos: int = 50
    modalidade: str = "presencial"
    observacoes: str | None = None


class SessaoUpdateBody(BaseModel):
    paciente_id: int | None = None
    local_id: int | None = None
    data_hora: datetime | None = None
    duracao_minutos: int | None = None
    modalidade: str | None = None
    observacoes: str | None = None
    status: str | None = None
    notificar: bool = True


def _gerar_link_teleconsulta() -> str:
    return f"https://meet.jit.si/consulta-{secrets.token_urlsafe(9)}"


async def _validar_paciente_e_local(conn, profissional_id: int, paciente_id: int, local_id: int):
    paciente = await conn.fetchval(
        "SELECT id FROM pacientes WHERE id = $1 AND profissional_id = $2", paciente_id, profissional_id
    )
    if paciente is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Paciente não encontrado")
    local = await conn.fetchval(
        "SELECT id FROM locais WHERE id = $1 AND profissional_id = $2", local_id, profissional_id
    )
    if local is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Local não encontrado")


async def _buscar_info_notificacao(conn, profissional_id: int, paciente_id: int, local_id: int):
    paciente = await conn.fetchrow("SELECT nome, email FROM pacientes WHERE id = $1", paciente_id)
    local = await conn.fetchrow("SELECT nome FROM locais WHERE id = $1", local_id)
    profissional = await conn.fetchrow("SELECT nome FROM profissionais WHERE id = $1", profissional_id)
    return paciente, local, profissional


@app.post("/sessoes", status_code=status.HTTP_201_CREATED)
async def criar_sessao(body: SessaoBody, profissional_id: int = Depends(auth.get_current_profissional_id)):
    if body.modalidade not in ("presencial", "teleconsulta"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="modalidade inválida")

    link_teleconsulta = _gerar_link_teleconsulta() if body.modalidade == "teleconsulta" else None

    async with db.pool.acquire() as conn:
        await _validar_paciente_e_local(conn, profissional_id, body.paciente_id, body.local_id)
        try:
            row = await conn.fetchrow(
                """
                INSERT INTO sessoes (profissional_id, paciente_id, local_id, data_hora, duracao_minutos, modalidade, observacoes, link_teleconsulta)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING id, data_hora, data_hora_fim, duracao_minutos, modalidade, status, observacoes, link_teleconsulta
                """,
                profissional_id, body.paciente_id, body.local_id, body.data_hora,
                body.duracao_minutos, body.modalidade, body.observacoes, link_teleconsulta,
            )
        except asyncpg.exceptions.ExclusionViolationError:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Já existe uma sessão nesse horário para esse local",
            )

        paciente, local, profissional = await _buscar_info_notificacao(
            conn, profissional_id, body.paciente_id, body.local_id
        )

    await notificacoes.enviar_email_sessao(
        tipo="confirmacao",
        paciente_email=paciente["email"],
        paciente_nome=paciente["nome"],
        profissional_nome=profissional["nome"],
        data_hora=row["data_hora"],
        duracao_minutos=row["duracao_minutos"],
        local_nome=local["nome"],
        modalidade=row["modalidade"],
        link_teleconsulta=row["link_teleconsulta"],
    )

    google_event_id = await google_calendar.sincronizar_sessao_para_google(
        profissional_id, row["id"], paciente["nome"], local["nome"],
        row["data_hora"], row["data_hora_fim"], row["observacoes"], None,
    )
    if google_event_id:
        async with db.pool.acquire() as conn:
            await conn.execute(
                "UPDATE sessoes SET google_event_id = $1 WHERE id = $2", google_event_id, row["id"]
            )

    return dict(row)


@app.patch("/sessoes/{sessao_id}")
async def editar_sessao(
    sessao_id: int,
    body: SessaoUpdateBody,
    profissional_id: int = Depends(auth.get_current_profissional_id),
):
    if body.modalidade is not None and body.modalidade not in ("presencial", "teleconsulta"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="modalidade inválida")
    if body.status is not None and body.status not in ("confirmada", "cancelada", "concluida"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="status inválido")

    async with db.pool.acquire() as conn:
        atual = await conn.fetchrow(
            "SELECT paciente_id, local_id, google_event_id, modalidade, link_teleconsulta FROM sessoes WHERE id = $1 AND profissional_id = $2",
            sessao_id, profissional_id,
        )
        if atual is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sessão não encontrada")

        if body.paciente_id is not None or body.local_id is not None:
            await _validar_paciente_e_local(
                conn,
                profissional_id,
                body.paciente_id or atual["paciente_id"],
                body.local_id or atual["local_id"],
            )

        nova_modalidade = body.modalidade or atual["modalidade"]
        novo_link_teleconsulta = None
        if nova_modalidade == "teleconsulta" and not atual["link_teleconsulta"]:
            novo_link_teleconsulta = _gerar_link_teleconsulta()

        try:
            row = await conn.fetchrow(
                """
                UPDATE sessoes SET
                    paciente_id = COALESCE($1, paciente_id),
                    local_id = COALESCE($2, local_id),
                    data_hora = COALESCE($3, data_hora),
                    duracao_minutos = COALESCE($4, duracao_minutos),
                    modalidade = COALESCE($5, modalidade),
                    observacoes = COALESCE($6, observacoes),
                    status = COALESCE($7, status),
                    link_teleconsulta = COALESCE($10, link_teleconsulta)
                WHERE id = $8 AND profissional_id = $9
                RETURNING id, data_hora, data_hora_fim, duracao_minutos, modalidade, status, observacoes, link_teleconsulta
                """,
                body.paciente_id, body.local_id, body.data_hora, body.duracao_minutos,
                body.modalidade, body.observacoes, body.status, sessao_id, profissional_id,
                novo_link_teleconsulta,
            )
        except asyncpg.exceptions.ExclusionViolationError:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Já existe uma sessão nesse horário para esse local",
            )

        tipo_notificacao = None
        if body.notificar:
            if body.status == "cancelada":
                tipo_notificacao = "cancelamento"
            elif body.data_hora is not None:
                tipo_notificacao = "reagendamento"

        paciente = local = profissional = None
        if row is not None:
            paciente, local, profissional = await _buscar_info_notificacao(
                conn,
                profissional_id,
                body.paciente_id or atual["paciente_id"],
                body.local_id or atual["local_id"],
            )

    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sessão não encontrada")

    if tipo_notificacao:
        await notificacoes.enviar_email_sessao(
            tipo=tipo_notificacao,
            paciente_email=paciente["email"],
            paciente_nome=paciente["nome"],
            profissional_nome=profissional["nome"],
            data_hora=row["data_hora"],
            duracao_minutos=row["duracao_minutos"],
            local_nome=local["nome"],
            modalidade=row["modalidade"],
            link_teleconsulta=row["link_teleconsulta"],
        )

    if row["status"] == "cancelada":
        if atual["google_event_id"]:
            await google_calendar.remover_evento_google(profissional_id, atual["google_event_id"])
    else:
        novo_event_id = await google_calendar.sincronizar_sessao_para_google(
            profissional_id, row["id"], paciente["nome"], local["nome"],
            row["data_hora"], row["data_hora_fim"], row["observacoes"], atual["google_event_id"],
        )
        if novo_event_id and novo_event_id != atual["google_event_id"]:
            async with db.pool.acquire() as conn:
                await conn.execute(
                    "UPDATE sessoes SET google_event_id = $1 WHERE id = $2", novo_event_id, row["id"]
                )

    return dict(row)


@app.get("/dashboard/stats")
async def dashboard_stats(profissional_id: int = Depends(auth.get_current_profissional_id)):
    async with db.pool.acquire() as conn:
        consultas_hoje = await conn.fetchval(
            """
            SELECT count(*) FROM sessoes
            WHERE profissional_id = $1 AND data_hora::date = CURRENT_DATE AND status <> 'cancelada'
            """,
            profissional_id,
        )
        pacientes_ativos = await conn.fetchval(
            "SELECT count(*) FROM pacientes WHERE profissional_id = $1 AND status = 'ativo'",
            profissional_id,
        )
        novos_pacientes_30d = await conn.fetchval(
            """
            SELECT count(*) FROM pacientes
            WHERE profissional_id = $1 AND criado_em >= now() - interval '30 days'
            """,
            profissional_id,
        )
        sessoes_mes = await conn.fetchval(
            """
            SELECT count(*) FROM sessoes
            WHERE profissional_id = $1
                AND status <> 'cancelada'
                AND date_trunc('month', data_hora AT TIME ZONE 'America/Sao_Paulo')
                    = date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')
            """,
            profissional_id,
        )
    return {
        "consultas_hoje": consultas_hoje,
        "pacientes_ativos": pacientes_ativos,
        "novos_pacientes_30d": novos_pacientes_30d,
        "sessoes_mes": sessoes_mes,
    }


PERIODOS_VALIDOS = (1, 7, 30, 90)


@app.get("/dashboard/analytics")
async def dashboard_analytics(
    dias: int = 30, profissional_id: int = Depends(auth.get_current_profissional_id)
):
    if dias not in PERIODOS_VALIDOS:
        dias = 30

    async with db.pool.acquire() as conn:
        cutoff = await conn.fetchval(
            """
            SELECT CASE WHEN $1 = 1
                THEN date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'
                ELSE now() - make_interval(days => $1)
            END
            """,
            dias,
        )

        por_dia_semana = await conn.fetch(
            """
            SELECT dia.dia_semana, COALESCE(count(s.id), 0) AS total
            FROM generate_series(0, 6) AS dia(dia_semana)
            LEFT JOIN sessoes s
                ON EXTRACT(DOW FROM s.data_hora AT TIME ZONE 'America/Sao_Paulo') = dia.dia_semana
                AND s.profissional_id = $1
                AND s.status <> 'cancelada'
                AND s.data_hora >= $2
            GROUP BY dia.dia_semana
            ORDER BY dia.dia_semana
            """,
            profissional_id,
            cutoff,
        )
        por_modalidade = await conn.fetch(
            """
            SELECT modalidade, count(*) AS total FROM sessoes
            WHERE profissional_id = $1 AND status <> 'cancelada' AND data_hora >= $2
            GROUP BY modalidade
            """,
            profissional_id,
            cutoff,
        )
        por_status = await conn.fetch(
            """
            SELECT status, count(*) AS total FROM sessoes
            WHERE profissional_id = $1 AND data_hora >= $2
            GROUP BY status
            """,
            profissional_id,
            cutoff,
        )
        novos_pacientes = await conn.fetch(
            """
            SELECT semana.inicio::date AS semana_inicio, COALESCE(count(p.id), 0) AS total
            FROM generate_series(
                date_trunc('week', $2 AT TIME ZONE 'America/Sao_Paulo'),
                date_trunc('week', now() AT TIME ZONE 'America/Sao_Paulo'),
                interval '1 week'
            ) AS semana(inicio)
            LEFT JOIN pacientes p
                ON date_trunc('week', p.criado_em AT TIME ZONE 'America/Sao_Paulo') = semana.inicio
                AND p.profissional_id = $1
            GROUP BY semana.inicio
            ORDER BY semana.inicio
            """,
            profissional_id,
            cutoff,
        )

    modalidade_counts = {"presencial": 0, "teleconsulta": 0}
    for r in por_modalidade:
        modalidade_counts[r["modalidade"]] = r["total"]

    status_counts = {"confirmada": 0, "concluida": 0, "cancelada": 0}
    for r in por_status:
        status_counts[r["status"]] = r["total"]

    return {
        "sessoes_por_dia_semana": [
            {"dia_semana": r["dia_semana"], "total": r["total"]} for r in por_dia_semana
        ],
        "sessoes_por_modalidade": modalidade_counts,
        "sessoes_por_status": status_counts,
        "novos_pacientes_por_semana": [
            {"semana_inicio": r["semana_inicio"].isoformat(), "total": r["total"]}
            for r in novos_pacientes
        ],
        "periodo_dias": dias,
    }


LABELS_PROCEDIMENTO = {
    "avaliacao_neuropsicologica": "Avaliação neuropsicológica",
    "terapia": "Terapia",
    "reabilitacao_com_estimulacao": "Reabilitação com estimulação transcraniana",
    "reabilitacao_sem_estimulacao": "Reabilitação sem estimulação transcraniana",
    "neuromodulacao": "Neuromodulação",
}


class ChatMensagem(BaseModel):
    role: str
    content: str


class AssistenteChatBody(BaseModel):
    mensagem: str
    paciente_id: int | None = None
    historico: list[ChatMensagem] = []


@app.post("/assistente/chat")
async def assistente_chat(
    body: AssistenteChatBody, profissional_id: int = Depends(auth.get_current_profissional_id)
):
    system_prompt = (
        "Você é um assistente de apoio para uma psicóloga que usa um sistema de gestão de "
        "pacientes. Responda em português, de forma breve e profissional."
    )

    if body.paciente_id is not None:
        async with db.pool.acquire() as conn:
            paciente = await conn.fetchrow(
                """
                SELECT nome, tipo_atendimento, tipo_procedimento, status
                FROM pacientes WHERE id = $1 AND profissional_id = $2
                """,
                body.paciente_id, profissional_id,
            )
            if paciente is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Paciente não encontrado")

            sessoes = await conn.fetch(
                """
                SELECT s.data_hora, s.status, s.modalidade, s.observacoes, l.nome AS local_nome
                FROM sessoes s
                JOIN locais l ON l.id = s.local_id
                WHERE s.paciente_id = $1 AND s.profissional_id = $2
                ORDER BY s.data_hora DESC
                LIMIT 10
                """,
                body.paciente_id, profissional_id,
            )

        procedimento_label = LABELS_PROCEDIMENTO.get(paciente["tipo_procedimento"], "não definido")
        contexto_sessoes = "\n".join(
            f"- {s['data_hora'].strftime('%d/%m/%Y %H:%M')} ({s['status']}, {s['modalidade']} em "
            f"{s['local_nome']})" + (f": {s['observacoes']}" if s["observacoes"] else "")
            for s in sessoes
        ) or "Nenhuma sessão registrada ainda."

        system_prompt += (
            f"\n\nVocê está conversando sobre o paciente {paciente['nome']}. "
            f"Tipo de atendimento: {paciente['tipo_atendimento']}. "
            f"Tipo de procedimento: {procedimento_label}. "
            f"Status: {paciente['status']}.\n"
            f"Histórico de sessões (mais recentes primeiro):\n{contexto_sessoes}"
        )

    if not settings.gemini_api_key:
        return {
            "resposta": (
                "Assistente de IA ainda não está configurado (falta a chave da API do Gemini). "
                "Assim que a chave for adicionada, esta tela passa a responder de verdade."
            )
        }

    papel = {"user": "user", "assistant": "model"}
    client = genai.Client(api_key=settings.gemini_api_key)
    contents = [
        genai_types.Content(role=papel.get(m.role, "user"), parts=[genai_types.Part.from_text(text=m.content)])
        for m in body.historico
    ]
    contents.append(genai_types.Content(role="user", parts=[genai_types.Part.from_text(text=body.mensagem)]))

    resposta = await client.aio.models.generate_content(
        model="gemini-flash-latest",
        contents=contents,
        config=genai_types.GenerateContentConfig(system_instruction=system_prompt),
    )
    return {"resposta": resposta.text or ""}


class BotSimularBody(BaseModel):
    telefone_paciente: str
    mensagem: str
    historico: list[ChatMensagem] = []


@app.post("/bot/simular")
async def bot_simular(
    body: BotSimularBody, profissional_id: int = Depends(auth.get_current_profissional_id)
):
    historico = [{"role": m.role, "content": m.content} for m in body.historico]
    resultado = await bot.processar_mensagem(
        profissional_id, body.telefone_paciente, body.mensagem, historico
    )
    return resultado


HISTORICO_MAX_MENSAGENS = 20  # últimos N turnos (user+assistant) mantidos por conversa


def _extrair_mensagem_whatsapp(payload: dict) -> tuple[str | None, str | None, bool, str | None]:
    """Extrai (remoteJid, texto, from_me, message_id) de um webhook da Evolution API.

    O formato exato de aninhamento varia entre versões da Evolution API — tenta as
    duas variações documentadas antes de desistir.
    """
    dados = payload.get("data") or {}

    # variação A: data.key / data.message.conversation
    chave = dados.get("key")
    mensagem_obj = dados.get("message")

    # variação B: data.message.key / data.message.message.conversation
    if chave is None and isinstance(mensagem_obj, dict):
        chave = mensagem_obj.get("key")
        mensagem_obj = mensagem_obj.get("message")

    if not isinstance(chave, dict) or not isinstance(mensagem_obj, dict):
        return None, None, False, None

    remote_jid = chave.get("remoteJid")
    from_me = bool(chave.get("fromMe"))
    message_id = chave.get("id")
    texto = (
        mensagem_obj.get("conversation")
        or (mensagem_obj.get("extendedTextMessage") or {}).get("text")
    )
    return remote_jid, texto, from_me, message_id


@app.post("/webhook/whatsapp")
async def webhook_whatsapp(request: Request):
    payload = await request.json()

    if payload.get("event") not in ("messages.upsert", "MESSAGES_UPSERT"):
        return {"status": "ignorado"}

    instance = payload.get("instance")
    remote_jid, texto, from_me, message_id = _extrair_mensagem_whatsapp(payload)

    if not instance or from_me or not remote_jid or not texto:
        return {"status": "ignorado"}

    telefone_paciente = remote_jid.split("@")[0]

    if message_id:
        async with db.pool.acquire() as conn:
            inserida = await conn.fetchval(
                """
                INSERT INTO whatsapp_mensagens_processadas (message_id)
                VALUES ($1)
                ON CONFLICT (message_id) DO NOTHING
                RETURNING message_id
                """,
                message_id,
            )
        if inserida is None:
            # a Evolution API às vezes reenvia o mesmo evento de webhook — sem isso,
            # o bot respondia a mesma mensagem mais de uma vez (visto em produção)
            logger.info("Mensagem duplicada ignorada: %s", message_id)
            return {"status": "duplicado"}

    if settings.bot_telefones_permitidos:
        permitidos = {t.strip() for t in settings.bot_telefones_permitidos.split(",") if t.strip()}
        if telefone_paciente not in permitidos:
            logger.info("Mensagem ignorada (modo teste, número fora da lista): %s", telefone_paciente)
            return {"status": "ignorado_modo_teste"}

    async with db.pool.acquire() as conn:
        profissional_id = await conn.fetchval(
            "SELECT id FROM profissionais WHERE whatsapp_instance = $1", instance
        )
        if profissional_id is None:
            logger.warning("Webhook recebido para instância desconhecida: %s", instance)
            return {"status": "instancia_desconhecida"}

        linha = await conn.fetchrow(
            "SELECT historico FROM bot_conversas WHERE profissional_id = $1 AND telefone_paciente = $2",
            profissional_id, telefone_paciente,
        )
        historico = json.loads(linha["historico"]) if linha else []

    try:
        resultado = await bot.processar_mensagem(profissional_id, telefone_paciente, texto, historico)
    except Exception:
        logger.exception("Erro processando mensagem do bot (telefone=%s)", telefone_paciente)
        return {"status": "erro"}

    resposta = resultado.get("resposta") or ""
    novo_historico = (
        historico + [{"role": "user", "content": texto}, {"role": "assistant", "content": resposta}]
    )[-HISTORICO_MAX_MENSAGENS:]

    async with db.pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO bot_conversas (profissional_id, telefone_paciente, historico, atualizado_em)
            VALUES ($1, $2, $3::jsonb, now())
            ON CONFLICT (profissional_id, telefone_paciente)
            DO UPDATE SET historico = $3::jsonb, atualizado_em = now()
            """,
            profissional_id, telefone_paciente, json.dumps(novo_historico),
        )

    if resposta:
        try:
            await evolution.enviar_mensagem_texto(instance, telefone_paciente, resposta)
        except Exception:
            logger.exception("Erro enviando resposta via Evolution API (telefone=%s)", telefone_paciente)

    return {"status": "ok"}


@app.get("/google/conectar")
async def google_conectar(profissional_id: int = Depends(auth.get_current_profissional_id)):
    url = google_calendar.montar_url_autorizacao(profissional_id)
    return RedirectResponse(url)


@app.get("/google/callback")
async def google_callback(code: str, state: str):
    profissional_id = int(state)
    tokens = await google_calendar.trocar_code_por_tokens(code)
    await google_calendar.salvar_conexao(profissional_id, tokens)
    return RedirectResponse("http://localhost:3000/configuracoes?google=conectado")


@app.get("/google/status")
async def google_status(profissional_id: int = Depends(auth.get_current_profissional_id)):
    conexao = await google_calendar.obter_conexao(profissional_id)
    return {"conectado": conexao is not None}


@app.post("/google/sincronizar")
async def google_sincronizar(profissional_id: int = Depends(auth.get_current_profissional_id)):
    return await google_calendar.puxar_eventos_do_google(profissional_id)


@app.get("/conversas-escalonadas")
async def listar_conversas_escalonadas(
    apenas_pendentes: bool = True,
    profissional_id: int = Depends(auth.get_current_profissional_id),
):
    async with db.pool.acquire() as conn:
        rows = await conn.fetch(
            f"""
            SELECT c.id, c.telefone_paciente, c.previa_conversa, c.motivo, c.resolvido, c.notificado_em,
                   p.nome AS paciente_nome
            FROM conversas_escalonadas c
            LEFT JOIN pacientes p ON p.id = c.paciente_id
            WHERE c.profissional_id = $1
            {"AND c.resolvido = false" if apenas_pendentes else ""}
            ORDER BY c.notificado_em DESC
            """,
            profissional_id,
        )
    return [dict(row) for row in rows]


@app.patch("/conversas-escalonadas/{conversa_id}")
async def resolver_conversa_escalonada(
    conversa_id: int, profissional_id: int = Depends(auth.get_current_profissional_id)
):
    async with db.pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            UPDATE conversas_escalonadas SET resolvido = true
            WHERE id = $1 AND profissional_id = $2
            RETURNING id, resolvido
            """,
            conversa_id, profissional_id,
        )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Não encontrado")
    return dict(row)
