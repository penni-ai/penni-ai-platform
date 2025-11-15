"""Utility functions: field mapping and logging configuration."""

from __future__ import annotations

import logging
import re
from typing import Any, Dict, Iterable, List, Optional, Sequence

from pythonjsonlogger import jsonlogger

from app.models import CollectedData

# ============================================================================
# Logging Configuration
# ============================================================================


class ContextLoggerAdapter(logging.LoggerAdapter):
    """Logger adapter that merges structured context into log records."""

    def process(self, msg: str, kwargs: Dict[str, Any]):
        extra = kwargs.setdefault("extra", {})
        extra.update(self.extra)
        return msg, kwargs


def configure_logging(level: str = "INFO") -> logging.Logger:
    """Configure root logger for JSON output."""

    logger = logging.getLogger()
    logger.setLevel(level.upper())
    for handler in list(logger.handlers):
        logger.removeHandler(handler)

    handler = logging.StreamHandler()
    formatter = jsonlogger.JsonFormatter("%(levelname)s %(name)s %(message)s %(asctime)s", timestamp=True)
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    logger.debug("Logging configured", extra={"level": level})
    return logger


def get_logger(name: Optional[str] = None, **context: Any) -> ContextLoggerAdapter:
    base_logger = logging.getLogger(name)
    return ContextLoggerAdapter(base_logger, context)


# ============================================================================
# Field Mapping Utilities
# ============================================================================


def _clean(value: Any) -> Any:
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    return value


def infer_influencer_types(slots: Dict[str, Any]) -> str | None:
    about = slots.get("business_about") or ""
    if "restaurant" in about.lower():
        return "food"
    if "fashion" in about.lower():
        return "fashion"
    if "saas" in about.lower() or "software" in about.lower():
        return "tech"
    return None


def infer_keywords(messages: Sequence[str], existing: Iterable[str] | None = None) -> List[str]:
    words = []
    for text in messages:
        tokens = re.findall(r"[a-zA-Z]{4,}", text.lower())
        words.extend(tokens)
    freq: Dict[str, int] = {}
    for token in words:
        freq[token] = freq.get(token, 0) + 1
    sorted_tokens = sorted(freq, key=freq.get, reverse=True)
    base = list(existing or [])
    for token in sorted_tokens:
        if token in base:
            continue
        base.append(token)
        if len(base) >= 8:
            break
    return base


def generate_campaign_title(slots: Dict[str, Any]) -> str | None:
    website = slots.get("website")
    location = slots.get("business_location")
    about = slots.get("business_about")
    if not about and not website:
        return None
    core = about or "Campaign"
    if location:
        return f"{core} in {location}"
    return core


def generate_influencer_search_query(slots: Dict[str, Any]) -> str | None:
    about = slots.get("business_about")
    influencer_location = slots.get("influencer_location")
    follower_parts = []
    min_followers = slots.get("min_followers")
    max_followers = slots.get("max_followers")
    if min_followers:
        follower_parts.append(f"{min_followers:,}+ followers")
    if max_followers:
        follower_parts.append(f"up to {max_followers:,}")
    follower_text = " ".join(follower_parts)
    influencer_text = influencer_location or ""
    if not about and not influencer_text:
        return None
    return f"{about or ''} creators {follower_text} {influencer_text}".strip()


def map_slots_to_collected(
    slots: Dict[str, Any],
    field_status: Dict[str, str],
    message_texts: Sequence[str],
) -> CollectedData:
    slot_keywords = slots.get("keywords") if isinstance(slots.get("keywords"), list) else None
    keywords = slot_keywords or infer_keywords(message_texts)
    influencer_types = _clean(slots.get("influencerTypes")) or infer_influencer_types(slots)
    return CollectedData(
        website=_clean(slots.get("website")),
        business_location=_clean(slots.get("business_location")),
        business_about=_clean(slots.get("business_about")),
        influencer_location=_clean(slots.get("influencer_location")),
        min_followers=slots.get("min_followers"),
        max_followers=slots.get("max_followers"),
        keywords=keywords,
        influencerTypes=influencer_types,
        influencer_search_query=_clean(slots.get("influencer_search_query"))
        or generate_influencer_search_query(slots),
        campaign_title=_clean(slots.get("campaign_title")) or generate_campaign_title(slots),
        fieldStatus={k: v for k, v in field_status.items()},
    )

