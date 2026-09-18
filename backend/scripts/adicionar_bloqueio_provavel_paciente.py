"""Adiciona a coluna que guarda o nome sugerido pela IA quando um evento puxado
do iCloud (Siri) parece uma consulta mas o nome citado não bate com nenhum
paciente cadastrado — usada pra mostrar um aviso na Agenda sugerindo cadastrar
esse paciente, em vez de o evento virar só mais um bloqueio genérico sem
explicação.

Rodar uma única vez direto contra o banco de produção:
    cd backend && .venv/bin/python3 scripts/adicionar_bloqueio_provavel_paciente.py
"""
import asyncio
import os

import asyncpg
from dotenv import load_dotenv

load_dotenv("../.env")


async def main():
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    await conn.execute(
        "ALTER TABLE bloqueios_horario ADD COLUMN IF NOT EXISTS provavel_paciente_nome VARCHAR(255)"
    )
    print("Migração concluída.")
    await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
