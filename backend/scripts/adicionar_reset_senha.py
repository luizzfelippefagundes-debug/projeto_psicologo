import asyncio
import asyncpg
import os
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "../../.env"))

async def main():
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS reset_senha_tokens (
            token       TEXT PRIMARY KEY,
            profissional_id INTEGER NOT NULL REFERENCES profissionais(id) ON DELETE CASCADE,
            expira_em   TIMESTAMPTZ NOT NULL,
            usado       BOOLEAN NOT NULL DEFAULT FALSE
        )
    """)
    print("Tabela reset_senha_tokens criada (ou já existia).")
    await conn.close()

asyncio.run(main())
