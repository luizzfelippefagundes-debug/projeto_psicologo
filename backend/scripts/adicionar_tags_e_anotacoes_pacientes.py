"""Adiciona tags (array de texto) e anotacoes (texto livre) à tabela pacientes.

Rodar uma única vez direto contra o banco de produção:
    cd backend && .venv/bin/python3 scripts/adicionar_tags_e_anotacoes_pacientes.py
"""
import asyncio
import os

import asyncpg
from dotenv import load_dotenv

load_dotenv("../.env")


async def main():
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    await conn.execute(
        "ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}'"
    )
    print("Coluna tags adicionada (ou já existia).")
    await conn.execute(
        "ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS anotacoes TEXT"
    )
    print("Coluna anotacoes adicionada (ou já existia).")
    await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
