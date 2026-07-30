from contextlib import asynccontextmanager
from datetime import date, datetime, time

import asyncpg
from fastapi import Depends, FastAPI, HTTPException, Response, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr

from app import auth, db


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.connect()
    yield
    await db.disconnect()


app = FastAPI(title="Bot de Agendamento — API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
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
        samesite="lax",
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
    dia_semana: int
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
    if not (0 <= body.dia_semana <= 6):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="dia_semana deve ser entre 0 e 6")
    if body.hora_inicio >= body.hora_fim:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="hora_inicio deve ser antes de hora_fim")

    async with db.pool.acquire() as conn:
        local = await conn.fetchval(
            "SELECT id FROM locais WHERE id = $1 AND profissional_id = $2", body.local_id, profissional_id
        )
        if local is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Local não encontrado")

        row = await conn.fetchrow(
            """
            INSERT INTO regras_horario (profissional_id, local_id, dia_semana, hora_inicio, hora_fim)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, local_id, dia_semana, hora_inicio, hora_fim, ativo
            """,
            profissional_id, body.local_id, body.dia_semana, body.hora_inicio, body.hora_fim,
        )
    return dict(row)


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
            SELECT p.id, p.nome, p.telefone, p.email, p.tipo_atendimento, p.status, p.criado_em,
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


class PacienteBody(BaseModel):
    nome: str
    telefone: str
    email: EmailStr | None = None
    tipo_atendimento: str = "individual"


class PacienteUpdateBody(BaseModel):
    nome: str | None = None
    telefone: str | None = None
    email: EmailStr | None = None
    tipo_atendimento: str | None = None
    status: str | None = None


@app.post("/pacientes", status_code=status.HTTP_201_CREATED)
async def criar_paciente(body: PacienteBody, profissional_id: int = Depends(auth.get_current_profissional_id)):
    if body.tipo_atendimento not in ("individual", "casal"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="tipo_atendimento inválido")

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
            INSERT INTO pacientes (profissional_id, nome, telefone, email, tipo_atendimento)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, nome, telefone, email, tipo_atendimento, status, criado_em
            """,
            profissional_id, body.nome, body.telefone, body.email, body.tipo_atendimento,
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
                status = COALESCE($5, status)
            WHERE id = $6 AND profissional_id = $7
            RETURNING id, nome, telefone, email, tipo_atendimento, status, criado_em
            """,
            body.nome, body.telefone, body.email, body.tipo_atendimento, body.status,
            paciente_id, profissional_id,
        )
    return dict(row)


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


@app.post("/sessoes", status_code=status.HTTP_201_CREATED)
async def criar_sessao(body: SessaoBody, profissional_id: int = Depends(auth.get_current_profissional_id)):
    if body.modalidade not in ("presencial", "teleconsulta"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="modalidade inválida")

    async with db.pool.acquire() as conn:
        await _validar_paciente_e_local(conn, profissional_id, body.paciente_id, body.local_id)
        try:
            row = await conn.fetchrow(
                """
                INSERT INTO sessoes (profissional_id, paciente_id, local_id, data_hora, duracao_minutos, modalidade, observacoes)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING id, data_hora, duracao_minutos, modalidade, status, observacoes
                """,
                profissional_id, body.paciente_id, body.local_id, body.data_hora,
                body.duracao_minutos, body.modalidade, body.observacoes,
            )
        except asyncpg.exceptions.ExclusionViolationError:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Já existe uma sessão nesse horário para esse local",
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
        if body.paciente_id is not None or body.local_id is not None:
            atual = await conn.fetchrow(
                "SELECT paciente_id, local_id FROM sessoes WHERE id = $1 AND profissional_id = $2",
                sessao_id, profissional_id,
            )
            if atual is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sessão não encontrada")
            await _validar_paciente_e_local(
                conn,
                profissional_id,
                body.paciente_id or atual["paciente_id"],
                body.local_id or atual["local_id"],
            )

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
                    status = COALESCE($7, status)
                WHERE id = $8 AND profissional_id = $9
                RETURNING id, data_hora, duracao_minutos, modalidade, status, observacoes
                """,
                body.paciente_id, body.local_id, body.data_hora, body.duracao_minutos,
                body.modalidade, body.observacoes, body.status, sessao_id, profissional_id,
            )
        except asyncpg.exceptions.ExclusionViolationError:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Já existe uma sessão nesse horário para esse local",
            )

    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sessão não encontrada")
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
    return {
        "consultas_hoje": consultas_hoje,
        "pacientes_ativos": pacientes_ativos,
    }
