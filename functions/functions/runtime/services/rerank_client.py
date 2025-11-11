"""HTTP client for the unified DeepInfra rerank endpoint."""
from __future__ import annotations

from typing import List, Tuple

import requests

from functions.runtime.config import settings


class RerankError(RuntimeError):
    """Raised when the rerank service call fails."""


class RerankClient:
    """Lightweight wrapper around DeepInfra's reranker API."""

    def __init__(self) -> None:
        endpoint = getattr(settings, "DEEPINFRA_RERANKER_URL", None) or ""
        endpoint = str(endpoint).strip()
        if not endpoint:
            raise RerankError("DeepInfra reranker endpoint is not configured")

        secret = getattr(settings, "DEEPINFRA_API_KEY", None)
        api_key = secret.get_secret_value() if secret else None
        if not api_key:
            raise RerankError("DEEPINFRA_API_KEY is not configured")

        self.url = endpoint
        self.api_key = api_key
        self._session = requests.Session()

    def rerank(self, query: str, documents: List[str], top_k: int) -> List[Tuple[int, float]]:
        payload = {
            "queries": [query],
            "documents": documents,
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        response = self._session.post(self.url, json=payload, headers=headers, timeout=60)
        if not response.ok:
            raise RerankError(f"Rerank request failed ({response.status_code}): {response.text}")

        data = response.json() or {}
        scores = data.get("scores") or []
        ranking = sorted(
            [(idx, float(score)) for idx, score in enumerate(scores)],
            key=lambda item: item[1],
            reverse=True,
        )
        k = max(1, min(top_k, len(ranking))) if top_k else len(ranking)
        return ranking[:k]
