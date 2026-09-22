import asyncpg

from app.config import settings

pool: asyncpg.Pool | None = None


async def connect() -> None:
    global pool
    # min_size=0 (o default do asyncpg é 10) — com um mínimo fixo, o pool mantém
    # essas conexões abertas pra sempre, mesmo sem uso nenhum, o que impede o
    # compute do banco (Neon) de suspender por inatividade (scale to zero) e
    # estoura a cota de horas de compute do plano bem antes do mês fechar. Com
    # min_size=0, as conexões ociosas fecham sozinhas (max_inactive_connection_lifetime,
    # 5 min por padrão) e o compute consegue dormir de verdade.
    pool = await asyncpg.create_pool(settings.database_url, min_size=0, max_size=10)


async def disconnect() -> None:
    if pool is not None:
        await pool.close()
