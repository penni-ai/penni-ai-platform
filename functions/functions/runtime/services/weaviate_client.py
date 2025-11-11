"""Weaviate service client wrapper with Cloud Functions friendly connection reuse."""
from __future__ import annotations

import logging
from typing import List, Optional

import requests
import weaviate
from requests import Response
from requests.exceptions import RequestException, Timeout
from weaviate.classes.init import Auth, Timeout as WeaviateTimeout
from weaviate.config import AdditionalConfig
from weaviate.client import WeaviateClient as BaseWeaviateClient
from weaviate.exceptions import UnexpectedStatusCodeException, WeaviateGRPCUnavailableError

from functions.runtime.config import settings


logger = logging.getLogger("weaviate_client")


class WeaviateClientError(RuntimeError):
    """Raised for configuration or connectivity issues with Weaviate."""


class WeaviateClient:
    """Thin wrapper around the official Weaviate Python client for reuse in Cloud Functions."""

    DEFAULT_INIT_TIMEOUT = 10
    DEFAULT_QUERY_TIMEOUT = 30
    DEFAULT_INSERT_TIMEOUT = 30
    DEFAULT_EMBED_TIMEOUT = 30

    def __init__(
        self,
        *,
        cluster_url: Optional[str] = None,
        api_key: Optional[str] = None,
        embedding_model: Optional[str] = None,
        init_timeout: Optional[int] = None,
        query_timeout: Optional[int] = None,
        insert_timeout: Optional[int] = None,
    ) -> None:
        cfg_url = cluster_url or getattr(settings, "WEAVIATE_URL", "") or ""
        cleaned_url = self._normalize_cluster_url(cfg_url)
        if not cleaned_url:
            raise WeaviateClientError("WEAVIATE_URL is not configured")

        secret = api_key
        if secret is None:
            cfg_secret = getattr(settings, "WEAVIATE_API_KEY", None)
            secret = cfg_secret.get_secret_value() if cfg_secret else None
        if not secret:
            raise WeaviateClientError("WEAVIATE_API_KEY is not configured")

        embed_model = embedding_model or getattr(settings, "DEEPINFRA_EMBEDDING_MODEL", None)
        if not embed_model:
            raise WeaviateClientError("DEEPINFRA_EMBEDDING_MODEL is not configured")

        self.cluster_url = cleaned_url
        self.api_key = secret
        self.embedding_model = embed_model
        self.init_timeout = float(init_timeout or self.DEFAULT_INIT_TIMEOUT)
        self.query_timeout = float(query_timeout or self.DEFAULT_QUERY_TIMEOUT)
        self.insert_timeout = float(insert_timeout or self.DEFAULT_INSERT_TIMEOUT)
        self.embedding_timeout = float(self.DEFAULT_EMBED_TIMEOUT)

        self._client: Optional[BaseWeaviateClient] = None
        self._embedding_session = requests.Session()
        self._embedding_endpoint = self._build_embedding_endpoint()

        logger.debug(
            "WeaviateClient configured",
            extra={
                "cluster_url": self.cluster_url,
                "init_timeout": self.init_timeout,
                "query_timeout": self.query_timeout,
                "insert_timeout": self.insert_timeout,
                "embedding_model": self.embedding_model,
            },
        )

    @staticmethod
    def _normalize_cluster_url(raw_url: str) -> str:
        cleaned = (raw_url or "").strip().rstrip("/")
        if cleaned.startswith("https://"):
            cleaned = cleaned[len("https://") :]
        elif cleaned.startswith("http://"):
            cleaned = cleaned[len("http://") :]
        return cleaned

    def _build_embedding_endpoint(self) -> str:
        base_url = getattr(settings, "DEEPINFRA_BASE_URL", "https://api.deepinfra.com") or "https://api.deepinfra.com"
        embed_path = getattr(settings, "DEEPINFRA_EMBED_PATH", "/v1/openai") or "/v1/openai"
        trimmed_base = base_url.rstrip("/")
        trimmed_path = embed_path.rstrip("/")
        return f"{trimmed_base}{trimmed_path}/embeddings"

    def _client_is_connected(self) -> bool:
        if not self._client:
            return False
        checker = getattr(self._client, "is_connected", None)
        if checker is None or not callable(checker):
            return True
        try:
            return bool(checker())
        except Exception:  # pragma: no cover - defensive connectivity check
            logger.warning("Unable to verify Weaviate client connection status", exc_info=True)
            return False

    def _teardown_client(self) -> None:
        if not self._client:
            return
        try:
            self._client.close()
        except Exception:  # pragma: no cover - defensive cleanup
            logger.warning("Error closing Weaviate client", exc_info=True)
        finally:
            logger.debug("Weaviate client connection closed", extra={"cluster_url": self.cluster_url})
            self._client = None

    def connect(self) -> BaseWeaviateClient:
        """Establish and cache the Weaviate connection if needed."""

        if self._client is not None:
            if self._client_is_connected():
                return self._client
            logger.info(
                "Cached Weaviate client is disconnected; reconnecting",
                extra={"cluster_url": self.cluster_url},
            )
            self._teardown_client()

        try:
            logger.info(
                "Connecting to Weaviate endpoint",
                extra={"cluster_url": f"https://{self.cluster_url}"},
            )
            timeout = WeaviateTimeout(
                init=self.init_timeout,
                query=self.query_timeout,
                insert=self.insert_timeout,
            )
            additional_config = AdditionalConfig(
                timeout=timeout,
                use_grpc=False,
                grpc_secure=False,
            )
            client = weaviate.connect_to_weaviate_cloud(
                cluster_url=f"https://{self.cluster_url}",
                auth_credentials=Auth.api_key(self.api_key),
                additional_config=additional_config,
                skip_init_checks=True,
            )
        except WeaviateGRPCUnavailableError as exc:
            logger.error("Weaviate gRPC unavailable", exc_info=True)
            raise WeaviateClientError("Weaviate cluster is unavailable via gRPC") from exc
        except UnexpectedStatusCodeException as exc:
            logger.error("Weaviate returned unexpected status", exc_info=True)
            raise WeaviateClientError("Weaviate connection failed due to HTTP status") from exc
        except Exception as exc:  # pylint: disable=broad-except
            logger.error("Unexpected error while connecting to Weaviate", exc_info=True)
            raise WeaviateClientError("Unexpected error during Weaviate connection") from exc

        self._client = client
        if not self._client_is_connected():
            self._teardown_client()
            raise WeaviateClientError("Weaviate client failed to establish a connection")
        logger.info("Weaviate client connected", extra={"cluster_url": self.cluster_url})
        return client

    def close(self) -> None:
        """Close the underlying Weaviate client if it exists."""

        self._teardown_client()

        session = self._embedding_session
        if not session:
            return
        try:
            session.close()
        except Exception:  # pragma: no cover - defensive cleanup
            logger.warning("Error closing embedding session", exc_info=True)
        finally:
            self._embedding_session = requests.Session()

    def get_client(self) -> BaseWeaviateClient:
        """Retrieve an active Weaviate client, establishing a connection if needed."""

        return self.connect()

    def generate_embedding(self, text: str) -> Optional[List[float]]:
        """Generate an embedding via DeepInfra's OpenAI-compatible endpoint."""

        normalized = (text or "").strip()
        if not normalized:
            return None

        secret = getattr(settings, "DEEPINFRA_API_KEY", None)
        api_key = secret.get_secret_value() if secret else None
        if not api_key:
            logger.warning("DEEPINFRA_API_KEY missing; cannot build embeddings")
            return None

        payload = {
            "input": normalized,
            "model": self.embedding_model,
        }
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

        try:
            response: Response = self._embedding_session.post(
                self._embedding_endpoint,
                json=payload,
                headers=headers,
                timeout=self.embedding_timeout,
            )
            response.raise_for_status()
        except Timeout as exc:  # pragma: no cover - network dependent
            logger.warning("DeepInfra embedding request timed out", extra={"timeout": self.embedding_timeout})
            return None
        except RequestException as exc:  # pragma: no cover - network dependent
            logger.warning("DeepInfra embedding request failed", extra={"error": str(exc)})
            return None

        try:
            body = response.json()
        except ValueError:
            logger.warning("DeepInfra response did not contain valid JSON")
            return None

        data = body.get("data") or []
        if not data:
            logger.warning("DeepInfra embedding response missing data")
            return None

        first = data[0] or {}
        vector = first.get("embedding")
        if not isinstance(vector, list):
            logger.warning("DeepInfra embedding payload missing vector")
            return None

        try:
            return [float(value) for value in vector]
        except (TypeError, ValueError):
            logger.warning("DeepInfra embedding vector contained non-numeric values")
            return None


__all__ = ["WeaviateClient", "WeaviateClientError"]
