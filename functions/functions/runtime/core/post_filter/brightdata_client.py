"""BrightData client helper for refreshing Instagram profile snapshots."""
from __future__ import annotations

import csv
import io
import time
from dataclasses import dataclass, replace
from typing import Any, Callable, Dict, Iterable, List, Optional
from urllib.parse import urlparse

import requests

from functions.runtime.config import settings


@dataclass
class BrightDataConfig:
    """Runtime configuration for the BrightData client."""

    api_key: str
    dataset_id: str
    poll_interval: int = 30
    base_url: str = "https://api.brightdata.com/datasets/v3"
    max_urls: int = 50


class BrightDataClient:
    """Lightweight wrapper around the BrightData dataset API."""

    BASE_URL = "https://api.brightdata.com/datasets/v3"

    def __init__(self, config: Optional[BrightDataConfig] = None, dataset_id_override: Optional[str] = None) -> None:
        if config is not None:
            self.config = config
        else:
            api_secret = settings.BRIGHTDATA_API_KEY
            if api_secret is None:
                raise RuntimeError(
                    "BrightData configuration missing. Set BRIGHTDATA_API_KEY."
                )

            dataset_id = (
                dataset_id_override
                or settings.BRIGHTDATA_INSTAGRAM_DATASET_ID
                or settings.BRIGHTDATA_TIKTOK_DATASET_ID
            )
            if not dataset_id:
                raise RuntimeError(
                    "BrightData DATASET ID missing. Provide BRIGHTDATA_INSTAGRAM_DATASET_ID or BRIGHTDATA_TIKTOK_DATASET_ID."
                )

            api_key = api_secret.get_secret_value() if hasattr(api_secret, "get_secret_value") else str(api_secret)

            self.config = BrightDataConfig(
                api_key=api_key,
                dataset_id=dataset_id,
                poll_interval=settings.BRIGHTDATA_POLL_INTERVAL or BrightDataConfig.poll_interval,
                base_url=str(settings.BRIGHTDATA_BASE_URL or self.BASE_URL),
                max_urls=settings.BRIGHTDATA_MAX_URLS or BrightDataConfig.max_urls,
            )

        self.headers = {
            "Authorization": f"Bearer {self.config.api_key}",
            "Content-Type": "application/json",
        }

    def trigger_snapshot(self, profile_urls: Iterable[str]) -> str:
        """Trigger a BrightData snapshot and return its ID."""
        url_objects = self._prepare_urls(profile_urls)
        if not url_objects:
            raise ValueError("No profile URLs provided to BrightData")

        response = requests.post(
            f"{self.config.base_url}/trigger",
            headers=self.headers,
            params={
                "dataset_id": self.config.dataset_id,
                "include_errors": "true",
            },
            json=url_objects,
            timeout=30,
        )
        response.raise_for_status()
        data = response.json()
        snapshot_id = data.get("snapshot_id")
        if not snapshot_id:
            raise RuntimeError("Failed to trigger BrightData snapshot")
        return snapshot_id

    def wait_for_snapshot(self, snapshot_id: str) -> None:
        """Poll the snapshot until it is ready or failed."""
        while True:
            status_payload = self.get_snapshot_status(snapshot_id)
            status = status_payload.get("status")
            if status == "ready":
                return
            if status == "failed":
                raise RuntimeError(f"BrightData snapshot {snapshot_id} failed")
            time.sleep(self.config.poll_interval)

    def download_snapshot(self, snapshot_id: str) -> List[Dict[str, Any]]:
        """Download snapshot records as plain dicts."""
        response = requests.get(
            f"{self.config.base_url}/snapshot/{snapshot_id}",
            headers=self.headers,
            params={"format": "csv"},
            timeout=60,
        )
        response.raise_for_status()
        encoding = response.encoding or "utf-8"
        buffer = io.StringIO(response.content.decode(encoding))
        reader = csv.DictReader(buffer)
        return [row for row in reader if any(value for value in row.values())]

    def refresh_profiles(self, profile_urls: Iterable[str]) -> tuple[str, List[Dict[str, Any]]]:
        """Trigger, wait for, and download a snapshot for the provided URLs."""
        snapshot_id = self.trigger_snapshot(profile_urls)
        self.wait_for_snapshot(snapshot_id)
        records = self.download_snapshot(snapshot_id)
        return snapshot_id, records

    def fetch_profiles(
        self,
        profile_urls: Iterable[str],
        *,
        progress_cb: Optional[Callable[[str, Dict[str, Any]], None]] = None,
    ) -> List[Dict[str, Any]]:
        """Public interface expected by BrightDataStage (progress callback ignored)."""

        _ = progress_cb  # Maintains signature parity without emitting intermediate events.

        urls = [url for url in profile_urls if url]
        if not urls:
            return []

        frames: List[List[Dict[str, Any]]] = []
        error_records: List[Dict[str, Any]] = []
        grouped_urls = self._group_urls_by_platform(urls)

        for platform, subset in grouped_urls.items():
            dataset_id = self._dataset_id_for_platform(platform)
            if not dataset_id:
                error_records.extend(self._build_dataset_error_records(subset, platform))
                continue

            dataset_config = replace(self.config, dataset_id=dataset_id)
            temp_client = BrightDataClient(config=dataset_config)
            _, records = temp_client.refresh_profiles(subset)
            if records:
                frames.append(records)

        if error_records:
            frames.append(error_records)

        if not frames:
            return []

        merged: List[Dict[str, Any]] = []
        for chunk in frames:
            merged.extend(chunk)

        return merged

    def get_snapshot_status(self, snapshot_id: str) -> Dict[str, object]:
        """Fetch status details for an existing snapshot."""
        response = requests.get(
            f"{self.config.base_url}/progress/{snapshot_id}",
            headers=self.headers,
            timeout=30,
        )
        response.raise_for_status()
        return response.json()

    def _prepare_urls(self, profile_urls: Iterable[str]) -> List[Dict[str, str]]:
        cleaned: List[Dict[str, str]] = []
        seen: set[str] = set()

        for raw in profile_urls:
            if not raw:
                continue
            url = raw.strip()
            if not url:
                continue

            canonical = self._canonicalize_url(url)
            if not canonical:
                continue

            lowered = canonical.lower()
            if lowered in seen:
                continue

            seen.add(lowered)
            cleaned.append({"url": canonical})

            if len(cleaned) >= self.config.max_urls:
                break

        return cleaned

    @staticmethod
    def _canonicalize_url(url: str) -> Optional[str]:
        """Return a canonical social URL (Instagram or TikTok) or None if invalid."""
        try:
            parsed = urlparse(url.strip())
        except Exception:
            return None

        if not parsed.netloc:
            return None

        scheme = parsed.scheme or "https"
        host = parsed.netloc.lower()
        path = parsed.path.rstrip("/")

        social_hosts = ("instagram.com", "tiktok.com")
        if any(part in host for part in social_hosts) and path:
            if host.endswith("tiktok.com") and not path.startswith("/@"):
                path = f"/@{path.lstrip('/')}"
            return f"{scheme}://{host}{path}"

        return None

    @staticmethod
    def _detect_platform(url: str) -> Optional[str]:
        try:
            parsed = urlparse((url or "").strip())
        except Exception:  # pylint: disable=broad-except
            return None

        host = (parsed.netloc or "").lower()
        if not host:
            return None
        if "instagram.com" in host:
            return "instagram"
        if "tiktok.com" in host:
            return "tiktok"
        return None

    def _group_urls_by_platform(self, profile_urls: Iterable[str]) -> Dict[str, List[str]]:
        grouped: Dict[str, List[str]] = {"instagram": [], "tiktok": []}
        grouped["unknown"] = []
        for url in profile_urls:
            platform = self._detect_platform(url)
            if platform in ("instagram", "tiktok"):
                grouped[platform].append(url)
            else:
                grouped["unknown"].append(url)
        return {key: values for key, values in grouped.items() if values}

    @staticmethod
    def _build_dataset_error_records(urls: Iterable[str], platform: str) -> List[Dict[str, Any]]:
        message = "unsupported_platform" if platform == "unknown" else f"missing_{platform}_dataset_id"
        return [
            {
                "profile_url": url,
                "platform": platform,
                "error": message,
                "error_code": "dataset_not_configured",
            }
            for url in urls
        ]

    @staticmethod
    def _dataset_id_for_platform(platform: str) -> Optional[str]:
        if platform == "instagram":
            return settings.BRIGHTDATA_INSTAGRAM_DATASET_ID
        if platform == "tiktok":
            return settings.BRIGHTDATA_TIKTOK_DATASET_ID
        return None
