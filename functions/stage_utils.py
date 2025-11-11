"""Shared Firestore helpers and serialization utilities for pipeline stages."""
from __future__ import annotations

import logging
import time
from copy import deepcopy
from contextlib import contextmanager
from dataclasses import asdict, dataclass, field, is_dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Generator, Iterable, List, Optional, Sequence

from firebase_admin import firestore

from functions.runtime.api.serializers import serialize_creator_profile
from functions.runtime.models.domain import CreatorProfile


logger = logging.getLogger(__name__)

PIPELINE_COLLECTION = "search_pipeline_runs"
STAGE_ORDER = ["SEARCH", "BRIGHTDATA", "LLM_FIT"]
_PROGRESS_STEP = int(100 / len(STAGE_ORDER))
_TTL_HOURS = 1
_MAX_DEBUG_STRING_LENGTH = 500
_SENSITIVE_DEBUG_KEYS = {"api_key", "token", "authorization", "password", "secret"}

_firestore_client: Optional[firestore.Client] = None


class StageDocumentNotFoundError(RuntimeError):
    """Raised when a required stage document is missing in Firestore."""


class StagePrerequisiteError(RuntimeError):
    """Raised when a required pipeline prerequisite is not satisfied."""


@dataclass
class StageExecutionResult:
    """Normalized payload returned by each stage execution."""

    stage: str
    profiles: List[CreatorProfile] = field(default_factory=list)
    serialized_profiles: List[Dict[str, Any]] = field(default_factory=list)
    debug: Dict[str, Any] = field(default_factory=dict)
    metadata: Dict[str, Any] = field(default_factory=dict)
    pipeline_id: Optional[str] = None
    stage_document_path: Optional[str] = None
    status: str = "completed"
    completed_stages: List[str] = field(default_factory=list)
    timing: Optional[Dict[str, Any]] = None
    input_size: Optional[Dict[str, int]] = None
    output_size: Optional[Dict[str, int]] = None

    @property
    def count(self) -> int:
        return len(self.serialized_profiles)

    def to_response(self) -> Dict[str, Any]:
        response = {
            "success": self.status != "error",
            "stage": self.stage,
            "status": self.status,
            "count": self.count,
            "pipeline_id": self.pipeline_id,
            "stage_document_path": self.stage_document_path,
            "results": self.serialized_profiles,
            "debug": self.debug,
            "metadata": self.metadata,
            "completed_stages": self.completed_stages,
        }
        if self.timing is not None:
            response["timing"] = self.timing
        if self.input_size is not None:
            response["input_size"] = self.input_size
        if self.output_size is not None:
            response["output_size"] = self.output_size
        return response


def _ttl_value() -> datetime:
    return datetime.now(timezone.utc) + timedelta(hours=_TTL_HOURS)


@contextmanager
def timed_operation(operation_name: str, log: logging.Logger = logger) -> Generator[Dict[str, Any], None, None]:
    """Context manager for timing a named operation with structured logging.

    Uses ``time.perf_counter`` for precise measurements as recommended by the
    standard library documentation on custom context managers, ensuring that
    cleanup occurs even when exceptions bubble up.
    """

    timing: Dict[str, Any] = {"operation": operation_name}
    start_perf = time.perf_counter()
    start_dt = datetime.now(timezone.utc)
    timing["start_time"] = start_dt.isoformat()
    error: Optional[str] = None
    try:
        yield timing
    except Exception as exc:  # pragma: no cover - passthrough with timing
        error = str(exc)
        timing["error"] = error
        raise
    finally:
        elapsed_ms = (time.perf_counter() - start_perf) * 1000
        end_dt = datetime.now(timezone.utc)
        timing["duration_ms"] = round(elapsed_ms, 3)
        timing["end_time"] = end_dt.isoformat()
        log.info(
            "Operation timing",
            extra={
                "operation": operation_name,
                "duration_ms": timing["duration_ms"],
                "start_time": timing["start_time"],
                "end_time": timing["end_time"],
                "error": bool(error),
            },
        )


def calculate_payload_size(profiles: Sequence[CreatorProfile]) -> Dict[str, int]:
    """Return approximate payload metrics for a sequence of profiles."""

    profile_count = len(profiles)
    has_posts = sum(1 for profile in profiles if getattr(profile, "posts_raw", None))
    has_bio = sum(1 for profile in profiles if getattr(profile, "biography", None))
    estimated_bytes = profile_count * 5000  # heuristic average per profile payload
    return {
        "profile_count": profile_count,
        "estimated_bytes": estimated_bytes,
        "has_posts": has_posts,
        "has_bio": has_bio,
    }


def sanitize_debug_output(debug: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Deep copy and scrub sensitive values from debug metadata."""

    if not debug:
        return {}

    def _sanitize(value: Any) -> Any:
        if isinstance(value, dict):
            sanitized_dict: Dict[str, Any] = {}
            for key, inner_value in value.items():
                if key.lower() in _SENSITIVE_DEBUG_KEYS:
                    sanitized_dict[key] = "***redacted***"
                else:
                    sanitized_dict[key] = _sanitize(inner_value)
            return sanitized_dict
        if isinstance(value, list):
            return [_sanitize(item) for item in value]
        if isinstance(value, str) and len(value) > _MAX_DEBUG_STRING_LENGTH:
            return f"{value[:_MAX_DEBUG_STRING_LENGTH]}...truncated"
        return value

    return _sanitize(deepcopy(debug))


def generate_test_profiles(count: int = 5) -> List[CreatorProfile]:
    """Create deterministic test profiles for emulator mode and unit tests."""

    profiles: List[CreatorProfile] = []
    base_id = 1000
    for index in range(count):
        followers = 10_000 + (index * 5_000)
        engagement = 2.5 + (index * 0.3)
        profile = CreatorProfile(
            id=base_id + index,
            account=f"test_influencer_{index}",
            profile_name=f"Test Influencer {index}",
            followers=followers,
            avg_engagement=engagement,
            business_category_name="Beauty",
            business_address="123 Test St, Test City",
            biography=f"Beauty & lifestyle creator {index} with focus on sustainability.",
            profile_image_link="https://example.com/test.jpg",
            profile_url=f"https://instagram.com/test_influencer_{index}",
            is_personal_creator=True,
            is_verified=index % 2 == 0,
            posts_raw=f"Sample post summary for profile {index}",
            lance_db_id=f"test-profile-{index}",
            platform="instagram",
            platform_id=f"test_influencer_{index}",
            username=f"test_influencer_{index}",
            display_name=f"Test Influencer {index}",
            individual_vs_org_score=80 - index,
            generational_appeal_score=70 + index,
            professionalization_score=60 + (index * 2),
            relationship_status_score=50 + index,
            combined_score=0.0,
        )
        profiles.append(profile)
    return profiles


def get_firestore_client() -> firestore.Client:
    global _firestore_client
    if _firestore_client is None:
        _firestore_client = firestore.client()
    return _firestore_client


def _collection_ref():
    return get_firestore_client().collection(PIPELINE_COLLECTION)


def pipeline_status_path(pipeline_id: str) -> str:
    return f"{PIPELINE_COLLECTION}/{pipeline_id}"


def stage_document_id(pipeline_id: str, stage: str) -> str:
    return f"{pipeline_id}_{stage.upper()}"


def stage_document_path(pipeline_id: str, stage: str) -> str:
    return f"{PIPELINE_COLLECTION}/{stage_document_id(pipeline_id, stage)}"


def _set_document(doc_ref: firestore.DocumentReference, payload: Dict[str, Any]) -> None:
    snapshot = doc_ref.get()
    base = {
        **payload,
        "updated_at": firestore.SERVER_TIMESTAMP,
        "ttl": _ttl_value(),
    }
    if snapshot.exists:
        doc_ref.update(base)
    else:
        base["created_at"] = firestore.SERVER_TIMESTAMP
        doc_ref.set(base)


def create_pipeline_status(pipeline_id: str, user_id: str, status: str = "running") -> str:
    doc_ref = _collection_ref().document(pipeline_id)
    payload = {
        "pipeline_id": pipeline_id,
        "userId": user_id,
        "status": status,
        "current_stage": None,
        "completed_stages": [],
        "overall_progress": 0,
        "start_time": firestore.SERVER_TIMESTAMP,
        "end_time": None,
        "error_message": None,
    }
    _set_document(doc_ref, payload)
    logger.info("Pipeline status initialized", extra={"pipeline_id": pipeline_id})
    return doc_ref.path


def update_pipeline_status(
    pipeline_id: str,
    user_id: str,
    current_stage: Optional[str],
    progress: int,
    completed_stages: Optional[Sequence[str]] = None,
) -> None:
    doc_ref = _collection_ref().document(pipeline_id)
    normalized = normalize_completed_stages(completed_stages or [], current_stage)
    payload = {
        "status": "running",
        "current_stage": current_stage,
        "completed_stages": normalized,
        "overall_progress": max(0, min(progress, 100)),
        "userId": user_id,
    }
    _set_document(doc_ref, payload)
    logger.info(
        "Pipeline status updated",
        extra={
            "pipeline_id": pipeline_id,
            "stage": current_stage,
            "progress": payload["overall_progress"],
            "completed": normalized,
        },
    )


def complete_pipeline_status(pipeline_id: str, user_id: str, final_progress: int = 100) -> None:
    doc_ref = _collection_ref().document(pipeline_id)
    payload = {
        "status": "completed",
        "current_stage": None,
        "overall_progress": max(0, min(final_progress, 100)),
        "end_time": firestore.SERVER_TIMESTAMP,
        "userId": user_id,
    }
    _set_document(doc_ref, payload)
    logger.info("Pipeline marked completed", extra={"pipeline_id": pipeline_id})


def error_pipeline_status(
    pipeline_id: str,
    user_id: str,
    error_message: str,
    progress: Optional[int] = None,
) -> None:
    doc_ref = _collection_ref().document(pipeline_id)
    payload: Dict[str, Any] = {
        "status": "error",
        "current_stage": None,
        "error_message": error_message,
        "end_time": firestore.SERVER_TIMESTAMP,
        "userId": user_id,
    }
    if progress is not None:
        payload["overall_progress"] = max(0, min(progress, 100))
    _set_document(doc_ref, payload)
    logger.warning("Pipeline marked error", extra={"pipeline_id": pipeline_id, "error": error_message})


def read_pipeline_status(pipeline_id: str) -> Dict[str, Any]:
    doc = _collection_ref().document(pipeline_id).get()
    if not doc.exists:
        raise ValueError(f"Pipeline {pipeline_id} not found")
    data = doc.to_dict() or {}
    data["path"] = doc.reference.path
    return data


def serialize_profiles_for_firestore(profiles: Sequence[CreatorProfile]) -> List[Dict[str, Any]]:
    serialized: List[Dict[str, Any]] = []
    for profile in profiles:
        if is_dataclass(profile):
            serialized.append(asdict(profile))
        else:
            serialized.append(dict(profile))  # type: ignore[arg-type]
    return serialized


def deserialize_profiles(records: Optional[Sequence[Dict[str, Any]]]) -> List[CreatorProfile]:
    if not records:
        return []
    profiles: List[CreatorProfile] = []
    for record in records:
        try:
            profiles.append(CreatorProfile(**record))
        except TypeError as exc:
            logger.warning("Failed to deserialize profile", extra={"error": str(exc)})
    return profiles


def serialize_profiles_for_response(profiles: Sequence[CreatorProfile]) -> List[Dict[str, Any]]:
    return [serialize_creator_profile(profile) for profile in profiles]


def save_stage_document(
    pipeline_id: str,
    stage: str,
    *,
    user_id: str,
    profiles: Sequence[CreatorProfile],
    status: str,
    debug: Optional[Dict[str, Any]] = None,
    metadata: Optional[Dict[str, Any]] = None,
    error_message: Optional[str] = None,
) -> str:
    stage_name = stage.upper()
    doc_ref = _collection_ref().document(stage_document_id(pipeline_id, stage_name))
    payload = {
        "pipeline_id": pipeline_id,
        "userId": user_id,
        "stage": stage_name,
        "status": status,
        "profiles": serialize_profiles_for_firestore(profiles),
        "debug": debug or {},
        "metadata": metadata or {},
        "error_message": error_message,
    }
    _set_document(doc_ref, payload)
    logger.info(
        "Stage document saved",
        extra={"pipeline_id": pipeline_id, "stage": stage_name, "status": status, "count": len(profiles)},
    )
    return doc_ref.path


def record_stage_failure(
    *,
    pipeline_id: str,
    stage: str,
    user_id: str,
    error_message: str,
    profiles: Optional[Sequence[CreatorProfile]] = None,
    debug: Optional[Dict[str, Any]] = None,
    metadata: Optional[Dict[str, Any]] = None,
    progress: Optional[int] = None,
) -> None:
    try:
        save_stage_document(
            pipeline_id,
            stage,
            user_id=user_id,
            profiles=profiles or [],
            status="error",
            debug=debug or {},
            metadata=metadata or {},
            error_message=error_message,
        )
    except Exception:  # pragma: no cover - defensive logging
        logger.exception("Failed to persist stage failure document", extra={"pipeline_id": pipeline_id, "stage": stage})

    try:
        error_pipeline_status(pipeline_id, user_id, error_message, progress=progress)
    except Exception:  # pragma: no cover - defensive logging
        logger.exception("Failed to update pipeline status", extra={"pipeline_id": pipeline_id, "stage": stage})


def read_stage_document(pipeline_id: str, stage: str) -> Dict[str, Any]:
    doc_id = stage_document_id(pipeline_id, stage)
    snapshot = _collection_ref().document(doc_id).get()
    if not snapshot.exists:
        raise StageDocumentNotFoundError(f"Stage {stage} for pipeline {pipeline_id} not found")
    data = snapshot.to_dict() or {}
    data["path"] = snapshot.reference.path
    return data


def read_stage_profiles(pipeline_id: str, stage: str) -> List[CreatorProfile]:
    document = read_stage_document(pipeline_id, stage)
    return deserialize_profiles(document.get("profiles"))


def normalize_completed_stages(existing: Iterable[str], stage: Optional[str]) -> List[str]:
    order_map = {name: idx for idx, name in enumerate(STAGE_ORDER)}
    seen: Dict[str, bool] = {}
    normalized: List[str] = []
    for name in existing:
        upper = name.upper()
        if upper not in seen:
            seen[upper] = True
            normalized.append(upper)
    if stage:
        upper_stage = stage.upper()
        if upper_stage not in seen:
            normalized.append(upper_stage)
    normalized.sort(key=lambda item: order_map.get(item, len(order_map)))
    return normalized


def ensure_completed_stages(completed: Optional[Sequence[str]], stage: str) -> List[str]:
    return normalize_completed_stages(completed or [], stage)


def get_stage_progress(stage_name: str) -> int:
    upper = stage_name.upper()
    if upper not in STAGE_ORDER:
        return 0
    idx = STAGE_ORDER.index(upper)
    if idx == len(STAGE_ORDER) - 1:
        return 100
    return min(100, (idx + 1) * _PROGRESS_STEP)


def build_stage_result(
    *,
    stage: str,
    pipeline_id: Optional[str],
    profiles: Sequence[CreatorProfile],
    status: str,
    debug: Optional[Dict[str, Any]] = None,
    metadata: Optional[Dict[str, Any]] = None,
    completed_stages: Optional[Sequence[str]] = None,
    stage_document_path: Optional[str] = None,
    timing: Optional[Dict[str, Any]] = None,
    input_size: Optional[Dict[str, int]] = None,
    output_size: Optional[Dict[str, int]] = None,
) -> StageExecutionResult:
    return StageExecutionResult(
        stage=stage,
        pipeline_id=pipeline_id,
        profiles=list(profiles),
        serialized_profiles=serialize_profiles_for_response(profiles),
        debug=debug or {},
        metadata=metadata or {},
        status=status,
        stage_document_path=stage_document_path,
        completed_stages=ensure_completed_stages(completed_stages or [], stage),
        timing=timing,
        input_size=input_size,
        output_size=output_size,
    )


def profiles_from_payload(payload: Optional[Sequence[Dict[str, Any]]]) -> List[CreatorProfile]:
    if not payload:
        return []
    profiles: List[CreatorProfile] = []
    for record in payload:
        if not isinstance(record, dict):
            continue
        try:
            profiles.append(CreatorProfile(**record))
        except TypeError as exc:
            logger.warning("Skipping invalid profile payload", extra={"error": str(exc)})
    return profiles


__all__ = [
    "StageDocumentNotFoundError",
    "StagePrerequisiteError",
    "StageExecutionResult",
    "PIPELINE_COLLECTION",
    "STAGE_ORDER",
    "build_stage_result",
    "complete_pipeline_status",
    "create_pipeline_status",
    "calculate_payload_size",
    "deserialize_profiles",
    "ensure_completed_stages",
    "error_pipeline_status",
    "get_firestore_client",
    "get_stage_progress",
    "generate_test_profiles",
    "normalize_completed_stages",
    "pipeline_status_path",
    "record_stage_failure",
    "profiles_from_payload",
    "read_pipeline_status",
    "read_stage_document",
    "read_stage_profiles",
    "sanitize_debug_output",
    "save_stage_document",
    "serialize_profiles_for_firestore",
    "serialize_profiles_for_response",
    "stage_document_id",
    "stage_document_path",
    "timed_operation",
    "update_pipeline_status",
]
