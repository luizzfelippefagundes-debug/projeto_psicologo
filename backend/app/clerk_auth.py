import logging

import jwt
from fastapi import Header, HTTPException, status

from app.config import settings

logger = logging.getLogger(__name__)

_jwks_client: jwt.PyJWKClient | None = None


def _get_jwks_client() -> jwt.PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        _jwks_client = jwt.PyJWKClient(f"{settings.clerk_issuer}/.well-known/jwks.json")
    return _jwks_client


async def get_current_clerk_user_id(authorization: str | None = Header(default=None)) -> str:
    """Dependency do FastAPI: exige um Bearer token do Clerk válido, devolve o
    user_id (claim 'sub'). Levanta 401 se faltar, for inválido ou expirado."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Não autenticado")

    token = authorization.removeprefix("Bearer ")
    try:
        signing_key = _get_jwks_client().get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token, signing_key.key, algorithms=["RS256"], issuer=settings.clerk_issuer,
            options={"verify_aud": False},
        )
    except jwt.PyJWTError:
        logger.exception("Token do Clerk inválido")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sessão inválida")

    return payload["sub"]
