"""Callable Cloud Function for running the search stage independently."""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

import search
from firebase_functions import https_fn
from pydantic import BaseModel, Field, ValidationError

from functions.runtime.config import log_runtime_status
from functions.runtime.core.pipeline.base import StageName
from functions.runtime.core.pipeline.stages.weaviate_search_stage import WeaviateSearchStage
from functions.runtime.models.domain import CreatorProfile
from functions.runtime.models.search import SearchRequest
from stage_utils import (
    StageExecutionResult,
    build_stage_result,
    calculate_payload_size,
    ensure_completed_stages,
    get_stage_progress,
    record_stage_failure,
    sanitize_debug_output,
    save_stage_document,
    timed_operation,
    update_pipeline_status,
)


logger = logging.getLogger(__name__)


class SearchStagePayload(BaseModel):
    pipeline_id: str = Field(..., min_length=1, description="Pipeline identifier for Firestore persistence")
    user_id: str = Field(..., min_length=1)
    search: SearchRequest
    max_profiles: Optional[int] = Field(default=None, ge=1, le=50000)
    completed_stages: List[str] = Field(default_factory=list)
    debug_mode: bool = Field(default=False, description="Enable debug output and detailed logging")


_search_stage: Optional[WeaviateSearchStage] = None
_status_logged = False


def _ensure_stage_ready() -> bool:
    global _search_stage
    _log_stage_status()
    if _search_stage is not None:
        return True

    logger.info("Search stage initializing Weaviate client")
    try:
        _search_stage = WeaviateSearchStage()
    except Exception:  # pylint: disable=broad-except
        logger.exception("Search stage failed to initialize Weaviate search stage")
        _search_stage = None
        return False

    logger.info("Search stage Weaviate wrapper created")
    return True


def _log_stage_status() -> None:
    global _status_logged
    if _status_logged:
        return
    log_runtime_status(logger, scope="search_stage")
    _status_logged = True


def execute_search_stage(payload: SearchStagePayload) -> StageExecutionResult:
    pipeline_id = payload.pipeline_id.strip()
    if not pipeline_id:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="pipeline_id is required",
        )

    logger.info(
        "Search stage ensuring engine",
        extra={"pipeline_id": pipeline_id},
    )
    if not _ensure_stage_ready():
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            message="Search engine is not initialized",
        )
    logger.info(
        "Search stage engine ready",
        extra={
            "pipeline_id": pipeline_id,
        },
    )

    stage_name = StageName.SEARCH
    timing_summary: Dict[str, Any] = {}
    profiles: List[CreatorProfile] = []
    stage_result: Any = None

    try:
        with timed_operation("search_stage_total", logger) as total_timing:
            with timed_operation("search_execution", logger) as search_timing:
                stage_result = _search_stage.run(  # type: ignore[union-attr]
                    [],
                    progress_cb=None,
                    query=payload.search.query,
                    method=payload.search.method,
                    limit=payload.search.limit,
                    min_followers=payload.search.min_followers,
                    max_followers=payload.search.max_followers,
                    min_engagement=payload.search.min_engagement,
                    max_engagement=payload.search.max_engagement,
                    location=payload.search.location,
                    category=payload.search.category,
                    is_verified=payload.search.is_verified,
                    is_business_account=payload.search.is_business_account,
                    lexical_scope=payload.search.lexical_scope,
                )
            timing_summary["search_execution"] = dict(search_timing)

            profiles = list(stage_result.profiles)
            if payload.max_profiles is not None and profiles:
                keep = max(1, min(payload.max_profiles, len(profiles)))
                profiles = profiles[:keep]

        logger.info(
            "Search stage completed run loop",
            extra={
                "pipeline_id": pipeline_id,
                "result_count": len(profiles),
                "timing_ms": total_timing.get("duration_ms") if isinstance(total_timing, dict) else None,
            },
        )

        timing_summary["search_stage_total"] = dict(total_timing)
    except Exception as exc:  # pylint: disable=broad-except
        logger.exception("Search stage failed", exc_info=exc)
        record_stage_failure(
            pipeline_id=pipeline_id,
            stage=stage_name,
            user_id=payload.user_id,
            error_message=str(exc),
            progress=get_stage_progress(stage_name),
        )
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message="Search stage execution failed",
        ) from exc

    metadata: Dict[str, Any] = {}
    if stage_result and getattr(stage_result, "io", None):
        metadata["io"] = stage_result.io.model_dump()
    input_size = calculate_payload_size([])
    output_size = calculate_payload_size(profiles)
    metadata["input_size"] = input_size
    metadata["output_size"] = output_size
    logger.info(
        "Search stage I/O",
        extra={
            "pipeline_id": pipeline_id,
            "input_count": input_size["profile_count"],
            "output_count": output_size["profile_count"],
            "output_bytes_estimate": output_size["estimated_bytes"],
        },
    )

    raw_debug_payload: Dict[str, Any] = dict(stage_result.debug or {}) if stage_result else {}
    if payload.debug_mode:
        debug_payload = {
            **raw_debug_payload,
            "search_params": payload.search.model_dump(),
            "timing": timing_summary,
            "engine_stats": {
                "method": payload.search.method,
                "limit": payload.search.limit,
                "result_count": len(profiles),
            },
        }
    else:
        debug_payload = {}
    sanitized_debug = sanitize_debug_output(debug_payload)

    stage_doc_path = save_stage_document(
        pipeline_id,
        stage_name,
        user_id=payload.user_id,
        profiles=profiles,
        status="completed",
        debug=sanitized_debug,
        metadata=metadata,
    )

    completed = ensure_completed_stages(payload.completed_stages, stage_name)
    update_pipeline_status(
        pipeline_id=pipeline_id,
        user_id=payload.user_id,
        current_stage=stage_name,
        progress=get_stage_progress(stage_name),
        completed_stages=completed,
    )

    return build_stage_result(
        stage=stage_name,
        pipeline_id=pipeline_id,
        profiles=profiles,
        status="completed",
        debug=sanitized_debug,
        metadata=metadata,
        completed_stages=completed,
        stage_document_path=stage_doc_path,
        timing=timing_summary,
        input_size=input_size,
        output_size=output_size,
    )


@https_fn.on_call(
    region=search._get_config().REGION,  # pylint: disable=protected-access
    enforce_app_check=False,
    timeout_sec=900,
)
def search_stage(request: https_fn.CallableRequest) -> Dict[str, Any]:
    payload_dict = dict(request.data or {})
    raw_debug_flag = payload_dict.get("debug_mode")
    if isinstance(raw_debug_flag, str):
        requested_debug_mode = raw_debug_flag.strip().lower() in {"true", "1", "yes", "on"}
    else:
        requested_debug_mode = bool(raw_debug_flag)
    is_emulator = os.getenv("FUNCTIONS_EMULATOR") == "true"

    if request.auth is None and not (requested_debug_mode and is_emulator):
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Authentication required",
        )

    if request.auth is None:
        payload_dict["user_id"] = "test-user"
        logger.warning(
            "Search stage running in TEST MODE",
            extra={"emulator": is_emulator, "debug_mode": requested_debug_mode},
        )
    else:
        payload_dict["user_id"] = request.auth.uid
    try:
        payload = SearchStagePayload(**payload_dict)
    except ValidationError as exc:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message=str(exc),
        ) from exc

    logger.info(
        "Search stage invoked",
        extra={
            "pipeline_id": payload.pipeline_id,
            "query": payload.search.query,
            "debug_mode": payload.debug_mode,
        },
    )

    result = execute_search_stage(payload)
    logger.info(
        "Search stage completed",
        extra={
            "pipeline_id": payload.pipeline_id,
            "duration_ms": (result.timing or {})
            .get("search_stage_total", {})
            .get("duration_ms"),
            "result_count": result.count,
        },
    )
    return result.to_response()


__all__ = ["search_stage", "execute_search_stage", "SearchStagePayload"]
