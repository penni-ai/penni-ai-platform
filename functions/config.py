"""Lightweight configuration helpers for Cloud Functions decorators."""
from __future__ import annotations

import os

from firebase_functions import options


def _default_region() -> str:
    value = (os.getenv("FUNCTION_REGION") or "").strip()
    return value or options.SupportedRegion.US_CENTRAL1.value


REGION = _default_region()

__all__ = ["REGION"]
