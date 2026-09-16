"""Adiciona suporte à integração de leitura com o Calendário Apple (iCloud/CalDAV):
tabela de conexão por profissional e a coluna em bloqueios_horario que identifica
eventos vindos de lá (mesmo padrão já usado pro Google Calendar, que usa
google_event_id).

Rodar uma única vez direto contra o banco de produção:
    cd backend && .venv/bin/python3 scripts/adicionar_icloud_calendar.py
"""
import asyncio
import os

import asyncpg
from dotenv import load_dotenv

load_dotenv("../.env")


async def main():
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])

    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS icloud_conexoes (
            profissional_id INTEGER PRIMARY KEY REFERENCES profissionais(id) ON DELETE CASCADE,
            apple_id VARCHAR(255) NOT NULL,
            senha_app TEXT NOT NULL,
            calendar_url TEXT,
            sync_token TEXT,
            conectado_em TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    await conn.execute(
        "ALTER TABLE bloqueios_horario ADD COLUMN IF NOT EXISTS icloud_event_uid VARCHAR(255)"
    )
    await conn.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'bloqueios_horario_icloud_uid_unique'
            ) THEN
                ALTER TABLE bloqueios_horario
                ADD CONSTRAINT bloqueios_horario_icloud_uid_unique UNIQUE (profissional_id, icloud_event_uid);
            END IF;
        END $$;
        """
    )

    print("Migração concluída.")
    await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
