"""Adiciona a coluna que controla se já foi mandado o lembrete único de
reengajamento (reengajamento.py) pra uma conversa do bot que ficou parada —
evita mandar esse lembrete mais de uma vez pra mesma pausa na conversa.

Rodar uma única vez direto contra o banco de produção:
    cd backend && .venv/bin/python3 scripts/adicionar_nudge_bot_conversas.py
"""
import asyncio
import os

import asyncpg
from dotenv import load_dotenv

load_dotenv("../.env")


async def main():
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    await conn.execute(
        "ALTER TABLE bot_conversas ADD COLUMN IF NOT EXISTS nudge_enviado BOOLEAN NOT NULL DEFAULT false"
    )
    print("Migração concluída.")
    await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
