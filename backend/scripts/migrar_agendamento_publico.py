"""Rode uma vez: python3 scripts/migrar_agendamento_publico.py
Adiciona profissionais.slug e pacientes.clerk_user_id, com os índices únicos."""
import asyncio
import re
import sys
sys.path.insert(0, ".")

from app.config import settings
import asyncpg


def slugificar(nome: str) -> str:
    slug = nome.strip().lower()
    slug = re.sub(r"[àáâãäå]", "a", slug)
    slug = re.sub(r"[èéêë]", "e", slug)
    slug = re.sub(r"[ìíîï]", "i", slug)
    slug = re.sub(r"[òóôõö]", "o", slug)
    slug = re.sub(r"[ùúûü]", "u", slug)
    slug = re.sub(r"[ç]", "c", slug)
    slug = re.sub(r"[^a-z0-9]+", "-", slug).strip("-")
    return slug


async def main():
    conn = await asyncpg.connect(settings.database_url)

    await conn.execute("ALTER TABLE profissionais ADD COLUMN IF NOT EXISTS slug VARCHAR")
    await conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS profissionais_slug_uniq ON profissionais (slug) "
        "WHERE slug IS NOT NULL"
    )
    await conn.execute("ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS clerk_user_id VARCHAR")
    await conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS pacientes_profissional_clerk_uniq "
        "ON pacientes (profissional_id, clerk_user_id) WHERE clerk_user_id IS NOT NULL"
    )
    print("Colunas e índices criados.")

    # Backfill: gera slug pra quem ainda não tem
    profissionais = await conn.fetch("SELECT id, nome FROM profissionais WHERE slug IS NULL")
    for p in profissionais:
        base = slugificar(p["nome"])
        slug = base
        sufixo = 1
        while await conn.fetchval("SELECT 1 FROM profissionais WHERE slug = $1", slug):
            sufixo += 1
            slug = f"{base}-{sufixo}"
        await conn.execute("UPDATE profissionais SET slug = $1 WHERE id = $2", slug, p["id"])
        print(f"profissional {p['id']} ({p['nome']}) -> slug '{slug}'")

    await conn.close()


asyncio.run(main())
