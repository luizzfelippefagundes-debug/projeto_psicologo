"""Adiciona plaud_gravacoes.titulo — descoberto depois de ver um payload real da
Plaud/Zapier que o campo "title" (ex: "08-28 Avaliação: Lucas - Dificuldades...")
é um jeito bem melhor da profissional reconhecer a gravação certa na hora de
vincular do que só o início do resumo.

Rodar uma única vez direto contra o banco de produção:
    cd backend && .venv/bin/python3 scripts/adicionar_plaud_titulo.py
"""
import asyncio
import os

import asyncpg
from dotenv import load_dotenv

load_dotenv("../.env")


async def main():
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    await conn.execute("ALTER TABLE plaud_gravacoes ADD COLUMN IF NOT EXISTS titulo VARCHAR(255)")
    print("Coluna titulo adicionada (ou já existia).")
    await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
