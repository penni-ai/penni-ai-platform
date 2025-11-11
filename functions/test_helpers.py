"""Utilities for generating deterministic payloads and mock data for local testing.

The helpers here make it easy to invoke individual Cloud Functions inside the
Firebase emulator or in unit tests without wiring up Firestore or external APIs.
Example usage:

    from test_helpers import build_search_stage_payload, create_test_callable_request

    payload = build_search_stage_payload(search={"query": "fitness"})
    request = create_test_callable_request({"data": payload}, authenticated=False)
"""
from __future__ import annotations

import os
import random
import uuid
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from functions.runtime.api.serializers import serialize_creator_profile
from functions.runtime.core.pipeline.base import StageName
from functions.runtime.models.domain import CreatorProfile
from functions.runtime.models.search import SearchPipelineRequest, SearchRequest
from stage_utils import generate_test_profiles as _base_generate_profiles


def generate_test_profile(index: int = 0, **overrides: Any) -> CreatorProfile:
    """Return a single deterministic `CreatorProfile` with optional overrides."""

    profile = _base_generate_profiles(index + 1)[index]
    for key, value in overrides.items():
        setattr(profile, key, value)
    return profile


def generate_test_profiles(count: int = 10, **overrides: Any) -> List[CreatorProfile]:
    """Return a list of deterministic profiles, applying keyword overrides to each."""

    profiles = _base_generate_profiles(count)
    if overrides:
        for profile in profiles:
            for key, value in overrides.items():
                setattr(profile, key, value)
    return profiles


def create_test_search_request(**overrides: Any) -> SearchRequest:
    """Build a `SearchRequest` with sensible defaults for emulator testing."""

    base = {
        "query": "beauty influencers",
        "method": "hybrid",
        "limit": 20,
        "min_followers": 1_000,
        "max_followers": 100_000,
    }
    base.update(overrides)
    return SearchRequest(**base)


def create_test_pipeline_request(**overrides: Any) -> SearchPipelineRequest:
    """Build a `SearchPipelineRequest` with debug mode enabled by default."""

    base = {
        "search": create_test_search_request().model_dump(),
        "business_fit_query": "Looking for creators promoting sustainable beauty products",
        "max_profiles": 25,
        "debug_mode": True,
    }
    base.update(overrides)
    return SearchPipelineRequest(**base)


def mock_search_api_response(query: str, limit: int = 10) -> List[Dict[str, Any]]:
    """Generate a mock search API response payload."""

    _ = query  # placeholder for potential future filtering
    profiles = generate_test_profiles(count=limit)
    return [serialize_creator_profile(profile) for profile in profiles]


@dataclass
class MockAuth:
    uid: str


@dataclass
class MockCallableRequest:
    data: Dict[str, Any]
    auth: Optional[MockAuth]


def create_test_callable_request(data: Dict[str, Any], authenticated: bool = True) -> MockCallableRequest:
    """Create a lightweight stand-in for `CallableRequest` in unit tests."""

    auth = MockAuth(uid="test-user-123") if authenticated else None
    return MockCallableRequest(data=data, auth=auth)


def mock_brightdata_response(profile_url: str) -> Dict[str, Any]:
    """Return a mock BrightData API response for a profile URL."""

    seed = sum(ord(char) for char in profile_url)
    rnd = random.Random(seed)
    return {
        "profile_url": profile_url,
        "followers": 10_000 + rnd.randint(0, 50_000),
        "following": rnd.randint(100, 5_000),
        "biography": "Test creator focused on sustainable beauty and wellness.",
        "business_email": f"hello+{rnd.randint(100, 999)}@example.com",
        "posts": [
            {
                "caption": f"Mock post {idx} about clean beauty routines",
                "likes": rnd.randint(100, 5_000),
                "comments": rnd.randint(5, 200),
            }
            for idx in range(3)
        ],
    }


def mock_llm_fit_response(profile: CreatorProfile, business_query: str) -> Dict[str, Any]:
    """Return a mock LLM fit assessment payload for a profile."""

    base_score = 60 if "sustain" in business_query.lower() else 50
    modifier = 5 if "beauty" in (profile.business_category_name or "").lower() else -5
    score = max(0, min(100, base_score + modifier))
    return {
        "account": profile.account,
        "profile_url": profile.profile_url,
        "score": score,
        "rationale": "Profile content aligns with sustainable beauty focus.",
        "prompt": business_query,
        "raw_response": "Mock response for testing purposes",
    }


def mock_query_expansion_response(business_inquiry: str, num_queries: int = 5) -> List[str]:
    """Generate deterministic influencer search queries for a business inquiry."""

    inquiry = (business_inquiry or "").strip()
    if not inquiry:
        return []

    try:
        target = max(1, int(num_queries))
    except (TypeError, ValueError):
        target = 5

    tokens = [token.strip().lower() for token in inquiry.replace("/", " ").split() if token.strip()]
    keywords: List[str] = []
    for token in tokens:
        cleaned = "".join(ch for ch in token if ch.isalnum())
        if cleaned and cleaned not in keywords:
            keywords.append(cleaned)
    if not keywords:
        keywords = ["influencer"]

    templates = [
        "{term} influencer",
        "{term} content creator",
        "social media {term}",
        "{term} brand ambassador",
        "{term} community storyteller",
        "discover {term} creators",
        "{term} partnerships",
    ]

    seed = sum((idx + 1) * ord(char) for idx, char in enumerate(inquiry.lower())) or 42
    rnd = random.Random(seed)

    queries: List[str] = []
    for idx in range(target):
        term = keywords[idx % len(keywords)]
        template = templates[rnd.randint(0, len(templates) - 1)]
        query = template.format(term=term.replace("_", " ")).strip()
        queries.append(query)
    return queries


def build_search_stage_payload(pipeline_id: Optional[str] = None, **overrides: Any) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "pipeline_id": pipeline_id or uuid.uuid4().hex,
        "user_id": overrides.pop("user_id", "test-user"),
        "search": overrides.pop("search", create_test_search_request().model_dump()),
        "max_profiles": overrides.pop("max_profiles", 25),
        "completed_stages": overrides.pop("completed_stages", []),
        "debug_mode": overrides.pop("debug_mode", True),
    }
    payload.update(overrides)
    return payload


def build_rerank_stage_payload(pipeline_id: str, **overrides: Any) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "pipeline_id": pipeline_id,
        "user_id": overrides.pop("user_id", "test-user"),
        "input_stage": overrides.pop("input_stage", StageName.SEARCH),
        "query": overrides.pop("query", "beauty influencers"),
        "mode": overrides.pop("mode", "bio+posts"),
        "top_k": overrides.pop("top_k", 200),
        "completed_stages": overrides.pop("completed_stages", []),
        "debug_mode": overrides.pop("debug_mode", True),
    }
    payload.update(overrides)
    return payload


def build_brightdata_stage_payload(pipeline_id: str, **overrides: Any) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "pipeline_id": pipeline_id,
        "user_id": overrides.pop("user_id", "test-user"),
        "input_stage": overrides.pop("input_stage", StageName.SEARCH),
        "completed_stages": overrides.pop("completed_stages", []),
        "debug_mode": overrides.pop("debug_mode", True),
    }
    payload.update(overrides)
    return payload


def build_llm_fit_stage_payload(pipeline_id: str, **overrides: Any) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "pipeline_id": pipeline_id,
        "user_id": overrides.pop("user_id", "test-user"),
        "input_stage": overrides.pop("input_stage", StageName.BRIGHTDATA),
        "completed_stages": overrides.pop("completed_stages", []),
        "business_fit_query": overrides.pop(
            "business_fit_query",
            "Looking for beauty creators who champion sustainability",
        ),
        "max_posts": overrides.pop("max_posts", 6),
        "model": overrides.pop("model", "gpt-5-mini"),
        "verbosity": overrides.pop("verbosity", "medium"),
        "concurrency": overrides.pop("concurrency", 32),
        "debug_mode": overrides.pop("debug_mode", True),
    }
    payload.update(overrides)
    return payload


def is_emulator() -> bool:
    """Return True when running inside the Firebase functions emulator."""

    return os.getenv("FUNCTIONS_EMULATOR") == "true"


def enable_test_mode() -> None:
    """Force-enable emulator mode for local unit tests."""

    os.environ["FUNCTIONS_EMULATOR"] = "true"


__all__ = [
    "MockCallableRequest",
    "create_test_callable_request",
    "create_test_pipeline_request",
    "create_test_search_request",
    "enable_test_mode",
    "generate_test_profile",
    "generate_test_profiles",
    "build_search_stage_payload",
    "build_rerank_stage_payload",
    "build_brightdata_stage_payload",
    "build_llm_fit_stage_payload",
    "mock_brightdata_response",
    "mock_llm_fit_response",
    "mock_query_expansion_response",
    "is_emulator",
]
