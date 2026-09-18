# backend/app/plaud.py
"""Integração com a Plaud: recebe gravações via webhook (configurado pela
profissional no Zapier, gatilho "Transcript & Summary Ready") e permite vincular
manualmente uma gravação a uma sessão."""
import json
from datetime import datetime

from app import db


def _extrair_campo(payload: dict, *chaves_possiveis: str) -> str | None:
    """Tenta achar um campo em payload por uma lista de nomes possíveis — o formato
    exato que o Zapier manda depende de como a profissional mapeou os campos no Zap,
    então não dá pra saber o nome exato de antemão. payload_bruto é sempre guardado
    inteiro, então mesmo se isso não achar nada, a gravação não se perde."""
    for chave in chaves_possiveis:
        valor = payload.get(chave)
        if valor:
            return str(valor)
    return None


def _extrair_data(payload: dict, *chaves_possiveis: str) -> datetime | None:
    bruto = _extrair_campo(payload, *chaves_possiveis)
    if not bruto:
        return None
    try:
        return datetime.fromisoformat(bruto.replace("Z", "+00:00"))
    except ValueError:
        return None


async def processar_webhook(profissional_id: int, payload: dict) -> int:
    """Guarda uma gravação recebida via webhook. Sempre guarda payload_bruto
    inteiro; faz o melhor esforço pra extrair transcrição/resumo/data/título dos
    nomes de campo mais prováveis. Confirmado contra um payload real da Plaud via
    Zapier: as chaves reais são "transcript", "summary", "title" e "create_time"
    (nomes chutados antes de ver um payload real ficam mantidos como fallback, caso
    ela mapeie os campos diferente em outro Zap)."""
    transcricao = _extrair_campo(payload, "transcript", "transcription", "text")
    resumo = _extrair_campo(payload, "summary", "ai_summary")
    titulo = _extrair_campo(payload, "title")
    gravado_em = _extrair_data(payload, "create_time", "recorded_at", "created_at", "date")

    async with db.pool.acquire() as conn:
        gravacao_id = await conn.fetchval(
            """
            INSERT INTO plaud_gravacoes (profissional_id, transcricao, resumo, titulo, gravado_em, payload_bruto)
            VALUES ($1, $2, $3, $4, $5, $6::jsonb)
            RETURNING id
            """,
            profissional_id, transcricao, resumo, titulo, gravado_em, json.dumps(payload),
        )
    return gravacao_id


async def listar_disponiveis(profissional_id: int) -> list:
    """Gravações recebidas pra essa profissional que ainda não foram vinculadas a
    nenhuma sessão."""
    async with db.pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, titulo, resumo, gravado_em, recebido_em
            FROM plaud_gravacoes
            WHERE profissional_id = $1 AND sessao_id IS NULL
            ORDER BY recebido_em DESC
            """,
            profissional_id,
        )
    return [dict(row) for row in rows]


async def listar_todas(profissional_id: int) -> list:
    """Todas as gravações recebidas pra essa profissional, vinculadas ou não, mais
    recentes primeiro — usado na aba/página que lista tudo, diferente de
    listar_disponiveis (que é só o que falta vincular, usado no modal da sessão)."""
    async with db.pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT g.id, g.titulo, g.resumo, g.texto_curto, g.transcricao, g.gravado_em, g.recebido_em,
                   g.sessao_id, p.nome AS paciente_nome, s.data_hora AS sessao_data_hora
            FROM plaud_gravacoes g
            LEFT JOIN sessoes s ON s.id = g.sessao_id
            LEFT JOIN pacientes p ON p.id = s.paciente_id
            WHERE g.profissional_id = $1
            ORDER BY g.recebido_em DESC
            """,
            profissional_id,
        )
    return [dict(row) for row in rows]


async def vincular_a_sessao(profissional_id: int, gravacao_id: int, sessao_id: int) -> dict | None:
    """Vincula uma gravação a uma sessão e atualiza sessoes.observacoes com o
    resumo — adicionado ao final do que já existir, sem apagar nada. Se a sessão já
    tinha outra gravação vinculada, desvincula a anterior (sessao_id = NULL nela) em
    vez de deixar duas gravações apontando pra mesma sessão. Devolve a gravação
    vinculada, ou None se ela não existe/já pertence a outra profissional."""
    async with db.pool.acquire() as conn:
        async with conn.transaction():
            gravacao = await conn.fetchrow(
                "SELECT id, resumo, texto_curto FROM plaud_gravacoes WHERE id = $1 AND profissional_id = $2",
                gravacao_id, profissional_id,
            )
            if gravacao is None:
                return None

            await conn.execute(
                "UPDATE plaud_gravacoes SET sessao_id = NULL, vinculado_em = NULL "
                "WHERE sessao_id = $1 AND profissional_id = $2",
                sessao_id, profissional_id,
            )
            await conn.execute(
                "UPDATE plaud_gravacoes SET sessao_id = $1, vinculado_em = now() WHERE id = $2",
                sessao_id, gravacao_id,
            )

            # Prefere o texto curto (gerado sob demanda) sobre o resumo estruturado
            # inteiro — é o que efetivamente vai pras observações da sessão.
            texto_para_observacoes = gravacao["texto_curto"] or gravacao["resumo"]
            if texto_para_observacoes:
                observacoes_atuais = await conn.fetchval(
                    "SELECT observacoes FROM sessoes WHERE id = $1", sessao_id
                )
                # Remove um bloco de resumo automático anterior (se essa sessão já teve
                # outra gravação vinculada antes), preservando o texto que ela escreveu
                # por conta própria antes e depois desse bloco.
                marcador = "\n\n— Resumo automático (Plaud) —\n"
                texto_base = (observacoes_atuais or "").split(marcador)[0].rstrip()
                novo_texto = f"{texto_base}{marcador}{texto_para_observacoes}" if texto_base else (
                    f"— Resumo automático (Plaud) —\n{texto_para_observacoes}"
                )
                await conn.execute(
                    "UPDATE sessoes SET observacoes = $1 WHERE id = $2", novo_texto, sessao_id
                )

    return dict(gravacao)


async def obter_gravacao(profissional_id: int, gravacao_id: int) -> dict | None:
    async with db.pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, sessao_id, transcricao, resumo, texto_curto, titulo, gravado_em, recebido_em "
            "FROM plaud_gravacoes WHERE id = $1 AND profissional_id = $2",
            gravacao_id, profissional_id,
        )
    return dict(row) if row else None


async def atualizar_titulo(profissional_id: int, gravacao_id: int, titulo: str) -> bool:
    """Renomeia uma gravação — o título que a Plaud manda costuma vir bagunçado
    (data/hora coladas, aspas soltas), então ela pode ajustar por aqui. Retorna
    False se a gravação não existe/não pertence a essa profissional."""
    async with db.pool.acquire() as conn:
        resultado = await conn.execute(
            "UPDATE plaud_gravacoes SET titulo = $1 WHERE id = $2 AND profissional_id = $3",
            titulo, gravacao_id, profissional_id,
        )
    return resultado == "UPDATE 1"


async def excluir_gravacao(profissional_id: int, gravacao_id: int) -> bool:
    """Apaga uma gravação recebida. Não mexe na sessão vinculada (se houver) nem
    nas observações que já foram copiadas pra lá — só remove o registro da
    gravação em si. Pensado pro caso da profissional querer descartar uma
    gravação que saiu errada e pedir pra Plaud reprocessar/reenviar (o Zap dela
    dispara de novo em re-transcrição/re-resumo, criando uma entrada nova aqui).
    Retorna False se a gravação não existe/não pertence a essa profissional."""
    async with db.pool.acquire() as conn:
        resultado = await conn.execute(
            "DELETE FROM plaud_gravacoes WHERE id = $1 AND profissional_id = $2",
            gravacao_id, profissional_id,
        )
    return resultado == "DELETE 1"


async def salvar_texto_curto(profissional_id: int, gravacao_id: int, texto_curto: str) -> bool:
    """Salva (ou regenera, sobrescrevendo) o texto curto de uma gravação. Retorna
    False se a gravação não existe/não pertence a essa profissional."""
    async with db.pool.acquire() as conn:
        resultado = await conn.execute(
            "UPDATE plaud_gravacoes SET texto_curto = $1 WHERE id = $2 AND profissional_id = $3",
            texto_curto, gravacao_id, profissional_id,
        )
    return resultado == "UPDATE 1"
