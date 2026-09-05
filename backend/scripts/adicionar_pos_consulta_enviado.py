"""Adiciona a coluna sessoes.pos_consulta_enviado, usada pra controlar o envio da
mensagem de acompanhamento no dia seguinte à consulta (só uma vez por sessão).

Rodar uma única vez direto contra o banco de produção:
    cd backend && .venv/bin/python3 scripts/adicionar_pos_consulta_enviado.py
"""
import asyncio
import os

import asyncpg
from dotenv import load_dotenv

load_dotenv("../.env")


async def main():
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    await conn.execute(
        "ALTER TABLE sessoes ADD COLUMN IF NOT EXISTS pos_consulta_enviado BOOLEAN NOT NULL DEFAULT false"
    )
    print("Coluna pos_consulta_enviado adicionada (ou já existia).")
    await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
