"""Zera os dados de teste do profissional_id=1 (conta usada pra testar a noite toda,
vinculada ao whatsapp_instance='jamilly') e reprovisiona essa mesma conta como a conta
de produção da Dra. Jamilly — mantém slug, whatsapp_instance, locais e regras_horario
intactos (não são "dados de teste de paciente", são configuração real da conta).

Rodar uma única vez, direto contra o banco de produção:
    cd backend && .venv/bin/python3 scripts/zerar_e_provisionar_jamilly.py
"""
import asyncio
import os
import secrets
import string

import asyncpg
import bcrypt
from dotenv import load_dotenv

load_dotenv("../.env")

PROFISSIONAL_ID = 1
NOME_JAMILLY = "Jamilly Tassinari"
EMAIL_JAMILLY = "jamillytassinari@yahoo.com.br"


def gerar_senha() -> str:
    alfabeto = string.ascii_letters + string.digits
    return "".join(secrets.choice(alfabeto) for _ in range(14))


async def main():
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    async with conn.transaction():
        n_anamnese = await conn.execute(
            "DELETE FROM anamnese_respostas WHERE paciente_id IN "
            "(SELECT id FROM pacientes WHERE profissional_id = $1)",
            PROFISSIONAL_ID,
        )
        n_escalonadas = await conn.execute(
            "DELETE FROM conversas_escalonadas WHERE profissional_id = $1", PROFISSIONAL_ID
        )
        n_sessoes = await conn.execute("DELETE FROM sessoes WHERE profissional_id = $1", PROFISSIONAL_ID)
        n_pacientes = await conn.execute("DELETE FROM pacientes WHERE profissional_id = $1", PROFISSIONAL_ID)
        n_bot = await conn.execute("DELETE FROM bot_conversas WHERE profissional_id = $1", PROFISSIONAL_ID)
        n_espera = await conn.execute("DELETE FROM lista_espera WHERE profissional_id = $1", PROFISSIONAL_ID)
        n_bloqueios = await conn.execute(
            "DELETE FROM bloqueios_horario WHERE profissional_id = $1", PROFISSIONAL_ID
        )
        n_google = await conn.execute("DELETE FROM google_conexoes WHERE profissional_id = $1", PROFISSIONAL_ID)

        senha = gerar_senha()
        senha_hash = bcrypt.hashpw(senha.encode(), bcrypt.gensalt()).decode()
        await conn.execute(
            "UPDATE profissionais SET nome = $1, email = $2, senha_hash = $3 WHERE id = $4",
            NOME_JAMILLY, EMAIL_JAMILLY, senha_hash, PROFISSIONAL_ID,
        )

    print("Limpeza concluída:")
    print(" ", n_anamnese)
    print(" ", n_escalonadas)
    print(" ", n_sessoes)
    print(" ", n_pacientes)
    print(" ", n_bot)
    print(" ", n_espera)
    print(" ", n_bloqueios)
    print(" ", n_google)
    print()
    print(f"Conta {PROFISSIONAL_ID} reprovisionada:")
    print(f"  nome: {NOME_JAMILLY}")
    print(f"  email: {EMAIL_JAMILLY}")
    print(f"  senha: {senha}")

    await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
