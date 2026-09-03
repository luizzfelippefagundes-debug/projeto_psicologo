"""Endpoints públicos de autoagendamento do paciente (autenticados via Clerk),
usados pelo frontend do paciente — não confundir com os endpoints internos do
profissional em main.py (autenticados via cookie de sessão)."""
from datetime import date, datetime

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app import agendamento, db
from app.clerk_auth import get_current_clerk_user_id

router = APIRouter(prefix="/publico", tags=["agendamento-publico"])


async def _buscar_profissional_por_slug(conn, slug: str):
    profissional = await conn.fetchrow(
        "SELECT id, nome FROM profissionais WHERE slug = $1", slug
    )
    if profissional is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Link inválido")
    return profissional


@router.get("/profissional/{slug}")
async def obter_profissional_publico(slug: str):
    async with db.pool.acquire() as conn:
        profissional = await _buscar_profissional_por_slug(conn, slug)
        locais = await conn.fetch(
            "SELECT id, nome FROM locais WHERE profissional_id = $1 ORDER BY nome", profissional["id"]
        )
    return {"nome": profissional["nome"], "locais": [dict(l) for l in locais]}


@router.get("/horarios")
async def horarios_publico(
    slug: str, local_id: int, data: date, duracao_minutos: int = 50,
    clerk_user_id: str = Depends(get_current_clerk_user_id),
):
    async with db.pool.acquire() as conn:
        profissional = await _buscar_profissional_por_slug(conn, slug)
        local = await conn.fetchval(
            "SELECT id FROM locais WHERE id = $1 AND profissional_id = $2", local_id, profissional["id"]
        )
        if local is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Local não encontrado")
    livres = await agendamento.horarios_disponiveis(profissional["id"], local_id, data, duracao_minutos)
    return {"horarios": livres}


class AgendarBody(BaseModel):
    slug: str
    local_id: int
    data_hora: datetime
    duracao_minutos: int = 50
    modalidade: str = "presencial"
    # só obrigatório na primeira consulta desse paciente com esse profissional
    nome: str | None = None
    telefone: str | None = None
    email: str | None = None
    data_nascimento: date | None = None
    consentimento_lgpd: bool = False
    procedimento_estimulacao: bool = False


@router.post("/agendar", status_code=status.HTTP_201_CREATED)
async def agendar_publico(body: AgendarBody, clerk_user_id: str = Depends(get_current_clerk_user_id)):
    if body.modalidade not in ("presencial", "teleconsulta"):
        body.modalidade = "presencial"

    async with db.pool.acquire() as conn:
        profissional = await _buscar_profissional_por_slug(conn, body.slug)
        local = await conn.fetchrow(
            "SELECT id, nome FROM locais WHERE id = $1 AND profissional_id = $2",
            body.local_id, profissional["id"],
        )
        if local is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Local não encontrado")

        paciente = await conn.fetchrow(
            "SELECT id, nome, email, telefone, tipo_procedimento, data_nascimento FROM pacientes "
            "WHERE profissional_id = $1 AND clerk_user_id = $2",
            profissional["id"], clerk_user_id,
        )
        if paciente is None:
            if not body.nome or not body.telefone or not body.consentimento_lgpd:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Primeira consulta: informe nome, telefone e consentimento LGPD.",
                )
            # Mesmo telefone + primeiro nome já pode existir sem clerk_user_id — cadastrado
            # antes pelo bot do WhatsApp ou pelo painel. profissional_id + telefone é único
            # no banco, então inserir direto quebraria pra quem já é paciente e só está
            # entrando pela primeira vez pelo link web (mesmo bug já corrigido no bot — ver
            # comentário de _buscar_ou_criar_paciente em bot.py). Nesse caso só vincula a
            # conta Clerk ao cadastro existente em vez de duplicar.
            paciente_existente = await conn.fetchrow(
                "SELECT id FROM pacientes WHERE profissional_id = $1 AND telefone = $2 "
                "AND split_part(nome, ' ', 1) ILIKE split_part($3, ' ', 1)",
                profissional["id"], body.telefone, body.nome,
            )
            if paciente_existente is not None:
                paciente = await conn.fetchrow(
                    "UPDATE pacientes SET clerk_user_id = $1 WHERE id = $2 "
                    "RETURNING id, nome, email, telefone, tipo_procedimento, data_nascimento",
                    clerk_user_id, paciente_existente["id"],
                )
            else:
                tipo_procedimento = "neuromodulacao" if body.procedimento_estimulacao else None
                paciente = await conn.fetchrow(
                    """
                    INSERT INTO pacientes (
                        profissional_id, nome, telefone, email, data_nascimento, tipo_procedimento,
                        tipo_atendimento, consentimento_lgpd, consentimento_lgpd_data, clerk_user_id
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, 'individual', true, now(), $7)
                    RETURNING id, nome, email, telefone, tipo_procedimento, data_nascimento
                    """,
                    profissional["id"], body.nome, body.telefone, body.email, body.data_nascimento,
                    tipo_procedimento, clerk_user_id,
                )

        whatsapp_instance = await conn.fetchval(
            "SELECT whatsapp_instance FROM profissionais WHERE id = $1", profissional["id"]
        )

        try:
            sessao = await agendamento.criar_sessao_e_notificar(
                conn,
                profissional_id=profissional["id"],
                paciente=paciente,
                local=local,
                data_hora=body.data_hora,
                duracao_minutos=body.duracao_minutos,
                modalidade=body.modalidade,
                whatsapp_instance=whatsapp_instance,
            )
        except asyncpg.exceptions.ExclusionViolationError:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Esse horário acabou de ser ocupado. Escolha outro.",
            )

    return {"sessao_id": sessao["id"], "data_hora": sessao["data_hora"].isoformat()}


@router.get("/meu-perfil")
async def meu_perfil(slug: str, clerk_user_id: str = Depends(get_current_clerk_user_id)):
    async with db.pool.acquire() as conn:
        profissional = await _buscar_profissional_por_slug(conn, slug)
        paciente = await conn.fetchrow(
            "SELECT nome, telefone, email FROM pacientes WHERE profissional_id = $1 AND clerk_user_id = $2",
            profissional["id"], clerk_user_id,
        )
    # Sem paciente vinculado ainda é um estado válido — logou via Clerk mas nunca
    # completou um agendamento (dados de contato entram nesse primeiro agendamento,
    # não no login). Devolve nulo em vez de 404 pra não exigir tratamento de erro à
    # toa no front.
    if paciente is None:
        return {"nome": None, "telefone": None, "email": None}
    return dict(paciente)


@router.get("/minhas-sessoes")
async def minhas_sessoes(slug: str, clerk_user_id: str = Depends(get_current_clerk_user_id)):
    async with db.pool.acquire() as conn:
        profissional = await _buscar_profissional_por_slug(conn, slug)
        sessoes = await conn.fetch(
            """
            SELECT s.id, s.data_hora, s.duracao_minutos, s.modalidade, s.status, l.nome AS local_nome
            FROM sessoes s
            JOIN pacientes p ON p.id = s.paciente_id
            JOIN locais l ON l.id = s.local_id
            WHERE s.profissional_id = $1 AND p.clerk_user_id = $2
            ORDER BY s.data_hora DESC
            """,
            profissional["id"], clerk_user_id,
        )
    return [dict(s) for s in sessoes]


@router.patch("/sessoes/{sessao_id}/cancelar")
async def cancelar_sessao_publico(
    sessao_id: int, slug: str, clerk_user_id: str = Depends(get_current_clerk_user_id)
):
    async with db.pool.acquire() as conn:
        profissional = await _buscar_profissional_por_slug(conn, slug)
        resultado = await conn.execute(
            """
            UPDATE sessoes SET status = 'cancelada'
            WHERE id = $1 AND profissional_id = $2
              AND paciente_id = (SELECT id FROM pacientes WHERE clerk_user_id = $3 AND profissional_id = $2)
            """,
            sessao_id, profissional["id"], clerk_user_id,
        )
    if resultado == "UPDATE 0":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sessão não encontrada")
    return {"status": "cancelada"}
