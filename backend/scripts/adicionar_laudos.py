"""Cria a tabela laudos para armazenar metadados de arquivos enviados via Vercel Blob.

Rodar uma única vez direto contra o banco de produção:
    cd backend && .venv/bin/python3 scripts/adicionar_laudos.py
"""
import asyncio
import os

import asyncpg
from dotenv import load_dotenv

load_dotenv("../.env")


async def main():
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS laudos (
            id SERIAL PRIMARY KEY,
            profissional_id INTEGER NOT NULL REFERENCES profissionais(id) ON DELETE CASCADE,
            paciente_id INTEGER NOT NULL REFERENCES pacientes(id) ON DELETE CASCADE,
            nome VARCHAR(255) NOT NULL,
            url TEXT NOT NULL,
            tamanho_bytes INTEGER,
            criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS laudos_paciente_idx ON laudos (paciente_id)"
    )
    print("Tabela laudos criada (ou já existia).")
    await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
