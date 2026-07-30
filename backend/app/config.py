from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_ENV_FILE = Path(__file__).resolve().parent.parent.parent / ".env"


class Settings(BaseSettings):
    database_url: str
    jwt_secret: str
    anthropic_api_key: str | None = None
    resend_api_key: str | None = None
    resend_from_email: str = "Consultório <onboarding@resend.dev>"

    model_config = SettingsConfigDict(env_file=ROOT_ENV_FILE)


settings = Settings()
