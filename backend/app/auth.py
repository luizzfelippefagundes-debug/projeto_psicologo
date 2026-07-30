from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Cookie, HTTPException, status

from app.config import settings

COOKIE_NAME = "session"
ALGORITHM = "HS256"
EXPIRES_IN = timedelta(days=7)


def hash_senha(senha: str) -> str:
    return bcrypt.hashpw(senha.encode(), bcrypt.gensalt()).decode()


def verificar_senha(senha: str, senha_hash: str) -> bool:
    return bcrypt.checkpw(senha.encode(), senha_hash.encode())


def criar_token(profissional_id: int) -> str:
    payload = {
        "sub": str(profissional_id),
        "exp": datetime.now(timezone.utc) + EXPIRES_IN,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)


def get_current_profissional_id(session: str | None = Cookie(default=None)) -> int:
    if session is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Não autenticado")
    try:
        payload = jwt.decode(session, settings.jwt_secret, algorithms=[ALGORITHM])
        return int(payload["sub"])
    except jwt.PyJWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sessão inválida")
