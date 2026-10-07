"""Adiciona a coluna aniversario_enviado_ano à tabela pacientes para evitar envios
duplicados de mensagem de parabéns no WhatsApp no mesmo ano.

Rodar uma única vez direto contra o banco de produção:
    cd backend && .venv/bin/python3 scripts/adicionar_aniversario_enviado_ano.py
"""
import asyncio
import os

import asyncpg
from dotenv import load_dotenv

load_dotenv("../.env")


async def main():
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    await conn.execute(
        "ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS aniversario_enviado_ano INTEGER"
    )
    print("Coluna aniversario_enviado_ano adicionada (ou já existia).")
    await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
