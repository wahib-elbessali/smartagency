from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Systeme de Gestion des Agences & IoT"
    app_env: str = "development"
    debug: bool = True
    database_url: str = (
        "postgresql+psycopg2://postgres:mot_de_passe@localhost:5432/agence_iot"
    )
    secret_key: str = "change_me_in_local_env"
    access_token_expire_minutes: int = 30
    mqtt_host: str = "localhost"
    mqtt_port: int = 1883
    mqtt_username: str | None = None
    mqtt_password: str | None = None
    redis_url: str = "redis://localhost:6379/0"
    # ai/ and this backend both default to :8000 -- port 8001 avoids the
    # clash when running both locally.
    ai_service_ws_url: str = "ws://127.0.0.1:8001"
    discord_webhook_url: str | None = None
    # ai/ has no agency concept (single process, no multi-tenant). None =
    # ai/ alerts are dropped (see ai_alerts/consumer.py::_handle_frame).
    default_agency_id: str | None = None

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
