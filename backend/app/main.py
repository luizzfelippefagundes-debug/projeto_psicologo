from contextlib import asynccontextmanager

from fastapi import FastAPI

from app import db


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.connect()
    yield
    await db.disconnect()


app = FastAPI(title="Bot de Agendamento — API", lifespan=lifespan)


@app.get("/health")
async def health():
    async with db.pool.acquire() as conn:
        await conn.execute("SELECT 1")
    return {"status": "ok"}
