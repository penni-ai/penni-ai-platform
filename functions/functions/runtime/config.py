"""Centralized runtime configuration and secret validation for Cloud Functions."""
from __future__ import annotations

import os
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from firebase_functions import options
from dotenv import load_dotenv
from pydantic import SecretStr

DEFAULT_BRIGHTDATA_BASE_URL = "https://api.brightdata.com/datasets/v3"
DEFAULT_BRIGHTDATA_POLL_INTERVAL = 30
DEFAULT_BRIGHTDATA_MAX_URLS = 50
DEFAULT_DEEPINFRA_BASE_URL = "https://api.deepinfra.com"
DEFAULT_DEEPINFRA_EMBED_PATH = "/v1/openai"
DEFAULT_DEEPINFRA_INFERENCE_PATH = "/v1/inference"
DEFAULT_DEEPINFRA_RERANKER_MODEL = "Qwen/Qwen3-Reranker-8B"
DEFAULT_DEEPINFRA_EMBEDDING_MODEL = "Qwen/Qwen3-Embedding-8B"
DEFAULT_WEAVIATE_COLLECTION_NAME = "influencer_profiles"
DEFAULT_WEAVIATE_TOP_N = 1000
DEFAULT_WEAVIATE_RESULTS_PER_QUERY = 500
DEFAULT_WEAVIATE_ALPHA_VALUES = "0.2,0.5,0.8"

LOGGER = logging.getLogger(__name__)


def _load_local_env() -> None:
    """Best-effort loader for repo-level .env files when running locally."""

    resolved = Path(__file__).resolve()
    env_files = [
        ".env.runtime.local",
        ".env.runtime",
        ".env.local",
        ".env",
    ]

    base_candidates = []
    for depth in (2, 3):
        try:
            base_candidates.append(resolved.parents[depth])
        except IndexError:  # pragma: no cover - defensive fallback
            continue

    for base in base_candidates:
        for filename in env_files:
            env_path = base / filename
            load_dotenv(env_path, override=False)


_load_local_env()


def _env(name: str, default: Optional[str] = None) -> Optional[str]:
    value = os.getenv(name)
    if value is None:
        return default
    stripped = value.strip()
    return stripped if stripped else default


def _int_env(name: str, default: int) -> int:
    raw = _env(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _parse_float_list(name: str, default: str) -> Tuple[float, ...]:
    def _parse(value: str, *, source: str) -> Tuple[float, ...]:
        parts = [segment.strip() for segment in (value or "").split(",")]
        floats: list[float] = []
        for part in parts:
            if not part:
                continue
            try:
                number = float(part)
            except ValueError as exc:  # pragma: no cover - defensive logging
                raise ValueError(f"{source} contains a non-float segment: '{part}'") from exc
            if not 0.0 <= number <= 1.0:
                raise ValueError(f"{source} value {number} must be between 0.0 and 1.0")
            floats.append(number)
        if not floats:
            raise ValueError(f"{source} did not yield any alpha values")
        return tuple(floats)

    raw_value = _env(name, default) or default
    try:
        return _parse(raw_value, source=name)
    except ValueError as exc:
        if raw_value != default:
            LOGGER.warning("Invalid %s value '%s': %s. Falling back to default.", name, raw_value, exc)
        return _parse(default, source=f"default {name}")


def _secret(name: str) -> Optional[SecretStr]:
    value = _env(name)
    return SecretStr(value) if value else None


@dataclass(frozen=True)
class RuntimeSettings:
    """Validated runtime settings loaded from environment variables."""

    REGION: str = field(
        default_factory=lambda: _env("FUNCTION_REGION", options.SupportedRegion.US_CENTRAL1.value)
    )
    OPENAI_API_KEY: Optional[SecretStr] = field(default_factory=lambda: _secret("OPENAI_API_KEY"))
    DEEPINFRA_API_KEY: Optional[SecretStr] = field(default_factory=lambda: _secret("DEEPINFRA_API_KEY"))
    BRIGHTDATA_API_KEY: Optional[SecretStr] = field(default_factory=lambda: _secret("BRIGHTDATA_API_KEY"))

    DEEPINFRA_BASE_URL: str = field(default_factory=lambda: _env("DEEPINFRA_BASE_URL", DEFAULT_DEEPINFRA_BASE_URL))
    DEEPINFRA_EMBED_PATH: str = field(default_factory=lambda: _env("DEEPINFRA_EMBED_PATH", DEFAULT_DEEPINFRA_EMBED_PATH))
    DEEPINFRA_INFERENCE_PATH: str = field(
        default_factory=lambda: _env("DEEPINFRA_INFERENCE_PATH", DEFAULT_DEEPINFRA_INFERENCE_PATH)
    )
    DEEPINFRA_RERANKER_MODEL: str = field(
        default_factory=lambda: _env("DEEPINFRA_RERANKER_MODEL", DEFAULT_DEEPINFRA_RERANKER_MODEL)
    )
    DEEPINFRA_EMBEDDING_MODEL: str = field(
        default_factory=lambda: _env("DEEPINFRA_EMBEDDING_MODEL", DEFAULT_DEEPINFRA_EMBEDDING_MODEL)
    )
    DEEPINFRA_RERANKER_URL: Optional[str] = field(
        default_factory=lambda: _env("DEEPINFRA_RERANKER_URL")
    )

    WEAVIATE_URL: str = field(default_factory=lambda: _env("WEAVIATE_URL"))
    WEAVIATE_API_KEY: Optional[SecretStr] = field(default_factory=lambda: _secret("WEAVIATE_API_KEY"))
    WEAVIATE_COLLECTION_NAME: str = field(
        default_factory=lambda: _env("WEAVIATE_COLLECTION_NAME", DEFAULT_WEAVIATE_COLLECTION_NAME)
    )
    WEAVIATE_TOP_N: int = field(
        default_factory=lambda: _int_env("WEAVIATE_TOP_N", DEFAULT_WEAVIATE_TOP_N)
    )
    WEAVIATE_RESULTS_PER_QUERY: int = field(
        default_factory=lambda: _int_env("WEAVIATE_RESULTS_PER_QUERY", DEFAULT_WEAVIATE_RESULTS_PER_QUERY)
    )
    WEAVIATE_ALPHA_VALUES: Tuple[float, ...] = field(
        default_factory=lambda: _parse_float_list("WEAVIATE_ALPHA_VALUES", DEFAULT_WEAVIATE_ALPHA_VALUES)
    )

    BRIGHTDATA_INSTAGRAM_DATASET_ID: Optional[str] = field(
        default_factory=lambda: _env("BRIGHTDATA_INSTAGRAM_DATASET_ID")
    )
    BRIGHTDATA_TIKTOK_DATASET_ID: Optional[str] = field(
        default_factory=lambda: _env("BRIGHTDATA_TIKTOK_DATASET_ID")
    )
    BRIGHTDATA_BASE_URL: str = field(
        default_factory=lambda: _env("BRIGHTDATA_BASE_URL", DEFAULT_BRIGHTDATA_BASE_URL)
    )
    BRIGHTDATA_POLL_INTERVAL: int = field(
        default_factory=lambda: _int_env("BRIGHTDATA_POLL_INTERVAL", DEFAULT_BRIGHTDATA_POLL_INTERVAL)
    )
    BRIGHTDATA_MAX_URLS: int = field(
        default_factory=lambda: _int_env("BRIGHTDATA_MAX_URLS", DEFAULT_BRIGHTDATA_MAX_URLS)
    )

    RERANKER_ENABLED: bool = field(default=False)

    def __post_init__(self) -> None:
        weaviate_url = (self.WEAVIATE_URL or "").strip()
        if weaviate_url:
            object.__setattr__(self, "WEAVIATE_URL", weaviate_url.rstrip("/"))

        embed_path = self.DEEPINFRA_EMBED_PATH or DEFAULT_DEEPINFRA_EMBED_PATH
        if not embed_path.startswith("/"):
            embed_path = f"/{embed_path}"
        object.__setattr__(self, "DEEPINFRA_EMBED_PATH", embed_path)

        inference_path = self.DEEPINFRA_INFERENCE_PATH or DEFAULT_DEEPINFRA_INFERENCE_PATH
        if not inference_path.startswith("/"):
            inference_path = f"/{inference_path}"
        object.__setattr__(self, "DEEPINFRA_INFERENCE_PATH", inference_path.rstrip("/"))

        reranker_url = self.DEEPINFRA_RERANKER_URL
        if not reranker_url and self.DEEPINFRA_RERANKER_MODEL:
            reranker_url = (
                f"{self.DEEPINFRA_BASE_URL.rstrip('/')}{self.DEEPINFRA_INFERENCE_PATH}/{self.DEEPINFRA_RERANKER_MODEL}"
            )
        object.__setattr__(self, "DEEPINFRA_RERANKER_URL", reranker_url)

        rerank_enabled = bool(reranker_url and self.DEEPINFRA_API_KEY)
        object.__setattr__(self, "RERANKER_ENABLED", rerank_enabled)

        missing = [
            name
            for name, value in [
                ("OPENAI_API_KEY", self.OPENAI_API_KEY),
                ("BRIGHTDATA_API_KEY", self.BRIGHTDATA_API_KEY),
            ]
            if not value
        ]
        if missing:
            joined = ", ".join(missing)
            raise RuntimeError(f"Missing required runtime environment variables: {joined}")

        if rerank_enabled and not self.DEEPINFRA_API_KEY:
            raise RuntimeError("DEEPINFRA_API_KEY is required when the reranker is enabled")

        if not (
            (self.BRIGHTDATA_INSTAGRAM_DATASET_ID and self.BRIGHTDATA_INSTAGRAM_DATASET_ID.strip())
            or (self.BRIGHTDATA_TIKTOK_DATASET_ID and self.BRIGHTDATA_TIKTOK_DATASET_ID.strip())
        ):
            raise RuntimeError(
                "Either BRIGHTDATA_INSTAGRAM_DATASET_ID or BRIGHTDATA_TIKTOK_DATASET_ID must be configured"
            )

        if not (0 < self.WEAVIATE_TOP_N <= 10_000):
            raise RuntimeError("WEAVIATE_TOP_N must be between 1 and 10,000")

        if not (0 < self.WEAVIATE_RESULTS_PER_QUERY <= 1_000):
            raise RuntimeError("WEAVIATE_RESULTS_PER_QUERY must be between 1 and 1,000")

        if not self.WEAVIATE_ALPHA_VALUES:
            raise RuntimeError("WEAVIATE_ALPHA_VALUES must include at least one value")


settings = RuntimeSettings()


def _secret_present(secret: Optional[SecretStr]) -> bool:
    return bool(secret)


def runtime_status_snapshot(cfg: RuntimeSettings = settings) -> Dict[str, Any]:
    """Summarize critical runtime configuration for structured logging."""

    brightdata_sources = list(
        filter(
            None,
            [
                (cfg.BRIGHTDATA_INSTAGRAM_DATASET_ID or "").strip(),
                (cfg.BRIGHTDATA_TIKTOK_DATASET_ID or "").strip(),
            ],
        )
    )

    return {
        "reranker": {
            "enabled": cfg.RERANKER_ENABLED,
            "has_api_key": _secret_present(cfg.DEEPINFRA_API_KEY),
            "endpoint": cfg.DEEPINFRA_RERANKER_URL,
        },
        "brightdata": {
            "dataset_count": len(brightdata_sources),
            "has_api_key": _secret_present(cfg.BRIGHTDATA_API_KEY),
            "status": "ok" if brightdata_sources else "missing_dataset",
        },
        "weaviate": {
            "status": "ok"
            if ((cfg.WEAVIATE_URL or "").strip() and _secret_present(cfg.WEAVIATE_API_KEY))
            else "missing_config",
            "has_api_key": _secret_present(cfg.WEAVIATE_API_KEY),
            "has_url": bool((cfg.WEAVIATE_URL or "").strip()),
            "embedding_model": cfg.DEEPINFRA_EMBEDDING_MODEL,
            "collection_name": cfg.WEAVIATE_COLLECTION_NAME,
            "top_n": cfg.WEAVIATE_TOP_N,
            "results_per_query": cfg.WEAVIATE_RESULTS_PER_QUERY,
            "alpha_values": list(cfg.WEAVIATE_ALPHA_VALUES),
        },
        "llm": {
            "has_openai_api_key": _secret_present(cfg.OPENAI_API_KEY),
        },
    }


def log_runtime_status(logger: logging.Logger, *, scope: str = "runtime") -> None:
    """Emit structured logs that show which env/config values are present."""

    snapshot = runtime_status_snapshot(settings)
    for component, details in snapshot.items():
        logger.info(
            "Runtime status check",
            extra={"scope": scope, "component": component, **details},
        )


__all__ = ["RuntimeSettings", "settings", "runtime_status_snapshot", "log_runtime_status"]
