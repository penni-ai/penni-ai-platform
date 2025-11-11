"""Callable Cloud Function for running the LLM fit scoring stage."""
from __future__ import annotations

import logging
import os
import statistics
from typing import Any, Dict, List, Optional

import search
from firebase_functions import https_fn
from pydantic import BaseModel, Field, ValidationError

from functions.runtime.config import log_runtime_status
from functions.runtime.core.pipeline.base import StageName
from functions.runtime.core.pipeline.stages.llm_fit_stage import LLMFitStage
from functions.runtime.core.pipeline.utils import normalized_profile_key
from functions.runtime.core.post_filter import ProfileFitAssessor
from functions.runtime.models.domain import CreatorProfile
from stage_utils import (
    StageDocumentNotFoundError,
    StageExecutionResult,
    build_stage_result,
    complete_pipeline_status,
    calculate_payload_size,
    ensure_completed_stages,
    get_stage_progress,
    read_stage_document,
    read_stage_profiles,
    record_stage_failure,
    sanitize_debug_output,
    save_stage_document,
    timed_operation,
    update_pipeline_status,
)


logger = logging.getLogger(__name__)


class LLMFitStagePayload(BaseModel):
    pipeline_id: str = Field(..., min_length=1)
    user_id: str = Field(..., min_length=1)
    input_stage: str = Field(default=StageName.BRIGHTDATA)
    completed_stages: List[str] = Field(default_factory=list)
    business_fit_query: str = Field(..., min_length=1)
    max_posts: int = Field(default=6, ge=1, le=20)
    model: str = Field(default="gpt-5-mini")
    verbosity: str = Field(default="medium")
    concurrency: int = Field(default=64, ge=1, le=128)
    debug_mode: bool = Field(default=False)


_llm_stage: Optional[LLMFitStage] = None
_status_logged = False


def _ensure_stage_ready() -> None:
    global _llm_stage
    _log_stage_status()
    if _llm_stage is not None:
        return
    try:
        _llm_stage = LLMFitStage(ProfileFitAssessor)
    except Exception as exc:  # pylint: disable=broad-except
        logger.exception("Failed to initialize LLM fit stage", exc_info=exc)
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAVAILABLE,
            message="LLM fit stage is not available",
        ) from exc


def _log_stage_status() -> None:
    global _status_logged
    if _status_logged:
        return
    log_runtime_status(logger, scope="llm_fit_stage")
    _status_logged = True


def _load_profiles(payload: LLMFitStagePayload) -> List[CreatorProfile]:
    try:
        return read_stage_profiles(payload.pipeline_id, payload.input_stage)
    except StageDocumentNotFoundError as exc:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            message=str(exc),
        ) from exc


def _apply_brightdata_filter(pipeline_id: str, profiles: List[CreatorProfile]) -> List[CreatorProfile]:
    if not profiles:
        return profiles
    try:
        doc = read_stage_document(pipeline_id, StageName.BRIGHTDATA)
    except StageDocumentNotFoundError:
        return profiles
    debug = doc.get("debug") or {}
    success_keys = {str(key).lower() for key in debug.get("success_keys", []) if isinstance(key, str)}
    if not success_keys:
        return profiles
    filtered = [profile for profile in profiles if normalized_profile_key(profile) in success_keys]
    return filtered if filtered else profiles


def execute_llm_fit_stage(payload: LLMFitStagePayload) -> StageExecutionResult:
    pipeline_id = payload.pipeline_id.strip()
    if not pipeline_id:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="pipeline_id is required",
        )

    _ensure_stage_ready()

    stage_name = StageName.LLM_FIT
    timing_summary: Dict[str, Any] = {}
    profiles: List[CreatorProfile] = []
    output_profiles: List[CreatorProfile] = []
    raw_debug_payload: Dict[str, Any] = {}
    metadata: Dict[str, Any] = {}
    input_size = calculate_payload_size([])
    stage_result: Optional[Any] = None
    skip_reason: Optional[str] = None

    with timed_operation("llm_fit_stage_total", logger) as total_timing:
        with timed_operation("load_input_profiles", logger) as load_timing:
            profiles = _load_profiles(payload)
        timing_summary["load_input_profiles"] = dict(load_timing)
        input_size = calculate_payload_size(profiles)

        with timed_operation("brightdata_filter", logger) as filter_timing:
            profiles = _apply_brightdata_filter(pipeline_id, profiles)
        timing_summary["brightdata_filter"] = dict(filter_timing)

        if not profiles:
            skip_reason = "no_profiles"
            raw_debug_payload = {
                "skipped": True,
                "reason": skip_reason,
                "input_stage": payload.input_stage,
            }
        else:
            try:
                with timed_operation("llm_api_calls", logger) as llm_timing:
                    stage_result = _llm_stage.run(  # type: ignore[union-attr]
                        profiles,
                        progress_cb=None,
                        business_fit_query=payload.business_fit_query,
                        max_posts=payload.max_posts,
                        concurrency=payload.concurrency,
                        model=payload.model,
                        verbosity=payload.verbosity,
                    )
                timing_summary["llm_api_calls"] = dict(llm_timing)
                output_profiles = stage_result.profiles
            except Exception as exc:  # pylint: disable=broad-except
                logger.exception("LLM fit stage failed", exc_info=exc)
                record_stage_failure(
                    pipeline_id=pipeline_id,
                    stage=stage_name,
                    user_id=payload.user_id,
                    error_message=str(exc),
                    progress=get_stage_progress(stage_name),
                )
                raise https_fn.HttpsError(
                    code=https_fn.FunctionsErrorCode.INTERNAL,
                    message="LLM fit stage execution failed",
                ) from exc

            metadata = {"io": stage_result.io.model_dump()} if stage_result and stage_result.io else {}
            raw_debug_payload = dict(stage_result.debug or {}) if stage_result else {}

    timing_summary["llm_fit_stage_total"] = dict(total_timing)

    if skip_reason:
        metadata = dict(metadata or {})
        metadata["reason"] = skip_reason
        output_size = calculate_payload_size([])
        metadata["input_size"] = input_size
        metadata["output_size"] = output_size
        if payload.debug_mode:
            debug_payload = {**raw_debug_payload, "timing": timing_summary}
        else:
            debug_payload = {}
        sanitized_debug = sanitize_debug_output(debug_payload)
        stage_path = save_stage_document(
            pipeline_id,
            stage_name,
            user_id=payload.user_id,
            profiles=[],
            status="completed",
            debug=sanitized_debug,
            metadata=metadata,
        )
        completed = ensure_completed_stages(payload.completed_stages, stage_name)
        update_pipeline_status(
            pipeline_id,
            user_id=payload.user_id,
            current_stage=stage_name,
            progress=get_stage_progress(stage_name),
            completed_stages=completed,
        )
        complete_pipeline_status(pipeline_id, payload.user_id)
        return build_stage_result(
            stage=stage_name,
            pipeline_id=pipeline_id,
            profiles=[],
            status="completed",
            debug=sanitized_debug,
            metadata=metadata,
            completed_stages=completed,
            stage_document_path=stage_path,
            timing=timing_summary,
            input_size=input_size,
            output_size=output_size,
        )

    output_size = calculate_payload_size(output_profiles)
    metadata = dict(metadata or {})
    metadata["input_size"] = input_size
    metadata["output_size"] = output_size
    scores = [profile.fit_score for profile in output_profiles if profile.fit_score is not None]
    scored_count = len(output_profiles)
    avg_score = round(statistics.mean(scores), 2) if scores else None
    top_score = max(scores) if scores else None
    median_score = round(statistics.median(scores), 2) if scores else None
    api_calls_made = len(raw_debug_payload.get("profile_fit", []))

    logger.info(
        "LLM fit stage I/O",
        extra={
            "pipeline_id": pipeline_id,
            "input_count": input_size["profile_count"],
            "scored_count": scored_count,
            "avg_score": avg_score,
            "api_calls": api_calls_made,
        },
    )

    if payload.debug_mode:
        sample_assessments = list(raw_debug_payload.get("profile_fit", [])[:3])
        debug_payload = {
            **raw_debug_payload,
            "llm_params": {
                "model": payload.model,
                "max_posts": payload.max_posts,
                "concurrency": payload.concurrency,
                "verbosity": payload.verbosity,
            },
            "timing": timing_summary,
            "scoring_stats": {
                "count": scored_count,
                "min": min(scores) if scores else None,
                "max": top_score,
                "avg": avg_score,
                "median": median_score,
            },
            "sample_assessments": sample_assessments,
            "api_usage": {
                "profile_fit_records": api_calls_made,
                "max_posts": payload.max_posts,
            },
            "business_query": payload.business_fit_query[:100],
        }
    else:
        debug_payload = {}

    sanitized_debug = sanitize_debug_output(debug_payload)

    stage_path = save_stage_document(
        pipeline_id,
        stage_name,
        user_id=payload.user_id,
        profiles=output_profiles,
        status="completed",
        debug=sanitized_debug,
        metadata=metadata,
    )

    completed = ensure_completed_stages(payload.completed_stages, stage_name)
    update_pipeline_status(
        pipeline_id,
        user_id=payload.user_id,
        current_stage=stage_name,
        progress=get_stage_progress(stage_name),
        completed_stages=completed,
    )
    complete_pipeline_status(pipeline_id, payload.user_id)

    return build_stage_result(
        stage=stage_name,
        pipeline_id=pipeline_id,
        profiles=output_profiles,
        status="completed",
        debug=sanitized_debug,
        metadata=metadata,
        completed_stages=completed,
        stage_document_path=stage_path,
        timing=timing_summary,
        input_size=input_size,
        output_size=output_size,
    )


@https_fn.on_call(
    region=search._get_config().REGION,  # pylint: disable=protected-access
    enforce_app_check=False,
    secrets=[
        search.OPENAI_API_KEY_SECRET,  # pylint: disable=protected-access
        search.DEEPINFRA_API_KEY_SECRET,  # pylint: disable=protected-access
    ],
    timeout_sec=900,
)
def llm_fit_stage(request: https_fn.CallableRequest) -> Dict[str, Any]:
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
            "LLM fit stage running in TEST MODE",
            extra={"emulator": is_emulator, "debug_mode": requested_debug_mode},
        )
    else:
        payload_dict["user_id"] = request.auth.uid
    try:
        payload = LLMFitStagePayload(**payload_dict)
    except ValidationError as exc:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message=str(exc),
        ) from exc

    logger.info(
        "LLM fit stage invoked",
        extra={
            "pipeline_id": payload.pipeline_id,
            "query_preview": payload.business_fit_query[:60],
            "debug_mode": payload.debug_mode,
        },
    )

    result = execute_llm_fit_stage(payload)
    logger.info(
        "LLM fit stage completed",
        extra={
            "pipeline_id": payload.pipeline_id,
            "duration_ms": (result.timing or {})
            .get("llm_fit_stage_total", {})
            .get("duration_ms"),
            "scored_count": result.count,
        },
    )
    return result.to_response()


__all__ = ["llm_fit_stage", "execute_llm_fit_stage", "LLMFitStagePayload"]
