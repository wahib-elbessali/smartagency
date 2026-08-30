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
    ai_service_url: str = "http://127.0.0.1:8001"
    ai_alerts_enabled: bool = True
    ai_reconnect_delay_seconds: float = 5.0
    ai_source_sync_interval_seconds: float = 15.0

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
