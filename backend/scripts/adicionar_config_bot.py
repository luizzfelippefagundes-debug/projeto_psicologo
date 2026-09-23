"""Adiciona os campos que o bot de agendamento usa pra se apresentar e informar o
valor da consulta (nome_secretaria, valor_consulta em profissionais — nenhum dos
dois é obrigatório, pra não quebrar profissionais que ainda não configuraram: sem
nome_secretaria o bot só não se apresenta por nome, sem valor_consulta ele
simplesmente não fala de preço, nunca inventa um valor), e amplia o motivo
aceito em conversas_escalonadas pra cobrir pedido especial de horário (não é
crise nem fora do escopo, mas também precisa de atenção da profissional).

Rodar uma única vez direto contra o banco de produção:
    cd backend && .venv/bin/python3 scripts/adicionar_config_bot.py
"""
import asyncio
import os

import asyncpg
from dotenv import load_dotenv

load_dotenv("../.env")


async def main():
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])

    await conn.execute("ALTER TABLE profissionais ADD COLUMN IF NOT EXISTS valor_consulta NUMERIC(10,2)")
    await conn.execute("ALTER TABLE profissionais ADD COLUMN IF NOT EXISTS nome_secretaria VARCHAR(100)")

    await conn.execute("ALTER TABLE conversas_escalonadas DROP CONSTRAINT IF EXISTS conversas_escalonadas_motivo_check")
    await conn.execute(
        """
        ALTER TABLE conversas_escalonadas ADD CONSTRAINT conversas_escalonadas_motivo_check
        CHECK (motivo IN ('crise', 'fora_do_escopo', 'pedido_especial'))
        """
    )

    # Configuração pedida pela própria Jamilly (profissional_id=1): bot se chama
    # Laura, consulta R$400.
    await conn.execute(
        "UPDATE profissionais SET nome_secretaria = 'Laura', valor_consulta = 400.00 WHERE id = 1"
    )

    print("Migração concluída.")
    await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
