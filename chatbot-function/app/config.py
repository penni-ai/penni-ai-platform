"""Centralized configuration for the penni-chatbot service."""

from __future__ import annotations

from functools import lru_cache
from typing import List, Optional

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Pydantic-powered settings object loaded from env/.env."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", case_sensitive=False)

    google_cloud_project: str = Field(alias="GOOGLE_CLOUD_PROJECT")
    google_cloud_region: str = Field(default="us-central1", alias="GOOGLE_CLOUD_REGION")

    # Vertex AI specific region (defaults to global for Gemini models)
    vertex_ai_region: str = Field(default="global", alias="VERTEX_AI_REGION")

    vertex_model: str = Field(default="gemini-2.5-flash-preview-09-2025", alias="VERTEX_MODEL")

    api_host: str = Field(default="0.0.0.0", alias="API_HOST")
    api_port: int = Field(default=8080, alias="API_PORT")

    cors_origins: str = Field(default="", alias="CORS_ORIGINS")

    log_level: str = Field(default="INFO", alias="LOG_LEVEL")

    service_name: str = Field(default="penni-chatbot", alias="CHATBOT_SERVICE_NAME")

    # LangSmith configuration
    langsmith_tracing: str = Field(default="false", alias="LANGSMITH_TRACING")
    langsmith_endpoint: Optional[str] = Field(default=None, alias="LANGSMITH_ENDPOINT")
    langsmith_api_key: Optional[str] = Field(default=None, alias="LANGSMITH_API_KEY")
    langsmith_project: Optional[str] = Field(default=None, alias="LANGSMITH_PROJECT")
    
    # Web Search (Tavily) configuration
    tavily_api_key: Optional[str] = Field(default=None, alias="TAVILY_API_KEY")

    @property
    def langsmith_enabled(self) -> bool:
        """Check if LangSmith tracing is enabled."""
        return self.langsmith_tracing.lower() in ("true", "1", "yes", "on")

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: Optional[str]) -> str:
        """Keep as string for pydantic-settings, will be split in property."""
        if isinstance(value, list):
            return ",".join(value)
        return value or ""

    @property
    def cors_origins_list(self) -> List[str]:
        """Return CORS origins as a list."""
        if not self.cors_origins:
            return []
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def firestore_project(self) -> str:
        """Firestore project ID (uses GOOGLE_CLOUD_PROJECT)."""
        return self.google_cloud_project

    @property
    def firebase_project(self) -> str:
        """Firebase project ID (uses GOOGLE_CLOUD_PROJECT)."""
        return self.google_cloud_project


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return cached Settings instance."""

    return Settings()  # type: ignore[call-arg]

