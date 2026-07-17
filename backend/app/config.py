from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_ENV_FILE = Path(__file__).resolve().parent.parent.parent / ".env"


class Settings(BaseSettings):
    database_url: str

    model_config = SettingsConfigDict(env_file=ROOT_ENV_FILE)


settings = Settings()
