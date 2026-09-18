"""Corrige a CHECK constraint de pacientes.tipo_procedimento, que ainda tinha só
os valores antigos — travando no banco qualquer paciente novo com um dos tipos de
procedimento adicionados recentemente (consulta_psicologica,
plano_neurodesenvolvimento, plano_casal, plano_terapeutico), mesmo já validados
certinho no código do backend. Erro real visto em produção: "new row for relation
pacientes violates check constraint pacientes_tipo_procedimento_check".

Rodar uma única vez direto contra o banco de produção:
    cd backend && .venv/bin/python3 scripts/corrigir_check_tipo_procedimento.py
"""
import asyncio
import os

import asyncpg
from dotenv import load_dotenv

load_dotenv("../.env")


async def main():
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    await conn.execute("ALTER TABLE pacientes DROP CONSTRAINT IF EXISTS pacientes_tipo_procedimento_check")
    await conn.execute(
        """
        ALTER TABLE pacientes ADD CONSTRAINT pacientes_tipo_procedimento_check
        CHECK (tipo_procedimento IN (
            'consulta_psicologica',
            'avaliacao_neuropsicologica',
            'plano_neurodesenvolvimento',
            'plano_casal',
            'plano_terapeutico',
            'neuromodulacao',
            'terapia'
        ))
        """
    )
    print("Constraint corrigida.")
    await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
