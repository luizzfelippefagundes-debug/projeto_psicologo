import asyncpg

from app.config import settings

pool: asyncpg.Pool | None = None


async def connect() -> None:
    global pool
    pool = await asyncpg.create_pool(settings.database_url)


async def disconnect() -> None:
    if pool is not None:
        await pool.close()
