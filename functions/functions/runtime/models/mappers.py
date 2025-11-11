"""Shared conversion helpers for runtime models."""
from __future__ import annotations

import math
from typing import Any, Mapping

from .domain import CreatorProfile

_BOOL_TRUE = {"true", "1", "yes", "y", "on"}
_BOOL_FALSE = {"false", "0", "no", "n", "off"}


def _sanitize(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        if isinstance(value, float) or hasattr(value, "__float__"):
            try:
                numeric = float(value)
            except (TypeError, ValueError):
                numeric = value
            else:
                if math.isnan(numeric):
                    return None
                return numeric
        return value
    if isinstance(value, str):
        text = value.strip()
        if not text or text.lower() == "nan":
            return None
        return text
    return value


def _as_int(value: Any, *, default: int = 0) -> int:
    sanitized = _sanitize(value)
    if sanitized is None:
        return default
    if isinstance(sanitized, bool):
        return int(sanitized)
    try:
        return int(float(sanitized))
    except (TypeError, ValueError):
        return default


def _as_float(value: Any, *, default: float = 0.0) -> float:
    sanitized = _sanitize(value)
    if sanitized is None:
        return default
    try:
        return float(sanitized)
    except (TypeError, ValueError):
        return default


def _as_optional_float(value: Any) -> Any:
    sanitized = _sanitize(value)
    if sanitized is None:
        return None
    try:
        return float(sanitized)
    except (TypeError, ValueError):
        return None


def _as_str(value: Any, default: Any = None) -> Any:
    sanitized = _sanitize(value)
    if sanitized is None:
        return default
    return str(sanitized)


def _as_bool(value: Any) -> Any:
    sanitized = _sanitize(value)
    if sanitized is None:
        return None
    if isinstance(sanitized, bool):
        return sanitized
    if isinstance(sanitized, (int, float)):
        return bool(int(sanitized))
    text = str(sanitized).strip().lower()
    if text in _BOOL_TRUE:
        return True
    if text in _BOOL_FALSE:
        return False
    return None


def _coerce_mapping(payload: Any) -> Mapping[str, Any]:
    if isinstance(payload, Mapping):
        return dict(payload)

    if hasattr(payload, "model_dump") and callable(payload.model_dump):
        return dict(payload.model_dump())

    if hasattr(payload, "to_dict") and callable(payload.to_dict):
        return dict(payload.to_dict())

    try:
        return dict(payload)  # type: ignore[arg-type]
    except TypeError as exc:
        getter = getattr(payload, "get", None)
        keys = []
        if getter and hasattr(payload, "keys"):
            try:
                keys = list(payload.keys())  # type: ignore[arg-type]
            except TypeError:
                keys = []
        if getter and keys:
            return {key: getter(key) for key in keys}
        raise TypeError(f"Cannot convert payload of type {type(payload)!r} to CreatorProfile") from exc


def to_creator_profile(payload: Any) -> CreatorProfile:
    """Map an API or dataframe row payload to a CreatorProfile."""

    if isinstance(payload, CreatorProfile):
        return payload
    if payload is None:
        raise TypeError("Cannot convert None to CreatorProfile")

    raw: Mapping[str, Any] = _coerce_mapping(payload)

    account_value = _as_str(
        raw.get("account") or raw.get("username") or raw.get("display_name"),
        "",
    ) or ""
    profile_name_value = _as_str(
        raw.get("profile_name")
        or raw.get("display_name")
        or raw.get("username")
        or account_value,
        "",
    ) or ""
    lance_identifier = _as_str(raw.get("lance_db_id"))
    platform_value = _as_str(raw.get("platform"))
    posts_value = raw.get("posts_raw")
    if posts_value is None and raw.get("posts") is not None:
        posts_value = raw.get("posts")

    individual_score = _as_int(raw.get("individual_vs_org_score"), default=0)
    explicit_personal = _as_bool(raw.get("is_personal_creator"))
    is_personal_creator = bool(explicit_personal) if explicit_personal is not None else bool(individual_score < 5)

    profile = CreatorProfile(
        id=_as_int(raw.get("id") or lance_identifier, default=0),
        account=account_value,
        profile_name=profile_name_value,
        followers=_as_int(raw.get("followers"), default=0),
        avg_engagement=_as_float(
            raw.get("avg_engagement")
            or raw.get("avg_engagement_raw")
            or raw.get("engagement_rate"),
            default=0.0,
        ),
        business_category_name=_as_str(
            raw.get("business_category_name") or raw.get("occupation"),
            "",
        )
        or "",
        business_address=_as_str(raw.get("business_address") or raw.get("location"), "") or "",
        biography=_as_str(raw.get("biography") or raw.get("profile_text"), "") or "",
        profile_image_link=_as_str(
            raw.get("profile_image_link")
            or raw.get("profile_image_url")
            or raw.get("profile_pic"),
            "",
        )
        or "",
        profile_url=_as_str(raw.get("profile_url") or raw.get("url")),
        is_personal_creator=is_personal_creator,
        is_verified=_as_bool(raw.get("is_verified")),
        posts_raw=posts_value,
        lance_db_id=lance_identifier,
        platform=platform_value.lower() if isinstance(platform_value, str) else platform_value,
        platform_id=_as_str(raw.get("platform_id") or raw.get("external_id")),
        username=_as_str(raw.get("username") or raw.get("account")),
        display_name=_as_str(
            raw.get("display_name") or raw.get("profile_name") or raw.get("full_name")
        ),
        profile_image_url=_as_str(raw.get("profile_image_url") or raw.get("profile_image_link")),
        individual_vs_org_score=individual_score,
        generational_appeal_score=_as_int(raw.get("generational_appeal_score"), default=0),
        professionalization_score=_as_int(raw.get("professionalization_score"), default=0),
        relationship_status_score=_as_int(raw.get("relationship_status_score"), default=0),
        bm25_fts_score=_as_optional_float(raw.get("bm25_fts_score")),
        cos_sim_profile=_as_optional_float(raw.get("cos_sim_profile")),
        cos_sim_posts=_as_optional_float(raw.get("cos_sim_posts")),
        combined_score=_as_float(
            raw.get("combined_score") or raw.get("vector_similarity_score"),
            default=0.0,
        ),
        keyword_similarity=_as_optional_float(raw.get("keyword_similarity")),
        profile_similarity=_as_optional_float(raw.get("profile_similarity")),
        content_similarity=_as_optional_float(raw.get("content_similarity")),
        vector_similarity_score=_as_optional_float(raw.get("vector_similarity_score")),
        similarity_explanation=_as_str(raw.get("similarity_explanation"), "") or "",
        score_mode=_as_str(raw.get("score_mode"), "hybrid") or "hybrid",
        profile_fts_source=_as_str(raw.get("profile_fts_source")),
        posts_fts_source=_as_str(raw.get("posts_fts_source")),
        following=_as_int(raw.get("following"), default=0) if raw.get("following") is not None else None,
        business_email=_as_str(raw.get("business_email")),
        email_address=_as_str(raw.get("email_address")),
        rerank_score=_as_optional_float(raw.get("rerank_score")),
    )

    return profile


__all__ = ["to_creator_profile"]
