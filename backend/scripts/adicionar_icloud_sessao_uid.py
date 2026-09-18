"""Adiciona a coluna que identifica, em sessoes, quando ela foi criada
automaticamente a partir de um evento do Calendário iCloud (agendamento por Siri
detectado como consulta com um paciente cadastrado) — mesmo padrão já usado em
bloqueios_horario.icloud_event_uid.

Rodar uma única vez direto contra o banco de produção:
    cd backend && .venv/bin/python3 scripts/adicionar_icloud_sessao_uid.py
"""
import asyncio
import os

import asyncpg
from dotenv import load_dotenv

load_dotenv("../.env")


async def main():
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])

    await conn.execute(
        "ALTER TABLE sessoes ADD COLUMN IF NOT EXISTS icloud_event_uid VARCHAR(255)"
    )
    await conn.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'sessoes_icloud_uid_unique'
            ) THEN
                ALTER TABLE sessoes
                ADD CONSTRAINT sessoes_icloud_uid_unique UNIQUE (profissional_id, icloud_event_uid);
            END IF;
        END $$;
        """
    )

    print("Migração concluída.")
    await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
