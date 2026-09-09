"""Adiciona o suporte à integração com a Plaud: token de webhook por profissional
e a tabela que guarda as gravações recebidas.

Rodar uma única vez direto contra o banco de produção:
    cd backend && .venv/bin/python3 scripts/adicionar_plaud.py
"""
import asyncio
import os
import secrets

import asyncpg
from dotenv import load_dotenv

load_dotenv("../.env")


async def main():
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])

    await conn.execute(
        "ALTER TABLE profissionais ADD COLUMN IF NOT EXISTS plaud_webhook_token VARCHAR(64) UNIQUE"
    )
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS plaud_gravacoes (
            id SERIAL PRIMARY KEY,
            profissional_id INTEGER NOT NULL REFERENCES profissionais(id) ON DELETE CASCADE,
            sessao_id INTEGER REFERENCES sessoes(id) ON DELETE CASCADE,
            transcricao TEXT,
            resumo TEXT,
            gravado_em TIMESTAMPTZ,
            payload_bruto JSONB NOT NULL,
            recebido_em TIMESTAMPTZ NOT NULL DEFAULT now(),
            vinculado_em TIMESTAMPTZ
        )
        """
    )

    # Preenche o token de quem já existe e ainda não tem um.
    profissionais_sem_token = await conn.fetch(
        "SELECT id FROM profissionais WHERE plaud_webhook_token IS NULL"
    )
    for row in profissionais_sem_token:
        token = secrets.token_urlsafe(32)
        await conn.execute(
            "UPDATE profissionais SET plaud_webhook_token = $1 WHERE id = $2", token, row["id"]
        )
        print(f"profissional_id={row['id']}: token gerado")

    print("Migração concluída.")
    await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
