"""Adiciona plaud_gravacoes.texto_curto — resumo curto e corrido, gerado sob
demanda por IA (Claude Haiku) a partir da transcrição, pensado pra colar direto
nas observações da sessão em vez do resumo estruturado inteiro.

Rodar uma única vez direto contra o banco de produção:
    cd backend && .venv/bin/python3 scripts/adicionar_plaud_texto_curto.py
"""
import asyncio
import os

import asyncpg
from dotenv import load_dotenv

load_dotenv("../.env")


async def main():
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    await conn.execute("ALTER TABLE plaud_gravacoes ADD COLUMN IF NOT EXISTS texto_curto TEXT")
    print("Coluna texto_curto adicionada (ou já existia).")
    await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
