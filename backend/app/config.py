from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_ENV_FILE = Path(__file__).resolve().parent.parent.parent / ".env"


class Settings(BaseSettings):
    database_url: str
    jwt_secret: str
    anthropic_api_key: str | None = None
    gemini_api_key: str | None = None
    resend_api_key: str | None = None
    resend_from_email: str = "Consultório <onboarding@resend.dev>"
    google_client_id: str | None = None
    google_client_secret: str | None = None
    clerk_issuer: str | None = None  # ex: https://exemplo-123.clerk.accounts.dev
    google_redirect_uri: str = "http://localhost:8000/google/callback"
    evolution_api_url: str = "http://evolution-api:8080"
    evolution_api_key: str | None = None
    frontend_url: str = "https://frontend-theta-weld-74.vercel.app"
    # True quando front (Vercel) e back vivem em domínios diferentes (exige HTTPS de verdade).
    # Só desativar pra rodar local sem Docker, com front e back em http://localhost.
    cookie_cross_site: bool = True
    # lista separada por vírgula de números liberados pro bot responder (modo teste).
    # vazio/None = responde qualquer número (produção de verdade)
    bot_telefones_permitidos: str | None = None

    model_config = SettingsConfigDict(env_file=ROOT_ENV_FILE, extra="ignore")


settings = Settings()
