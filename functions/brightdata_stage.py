"""Callable Cloud Function for running the BrightData enrichment stage."""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

import requests
import search
from firebase_functions import https_fn
from pydantic import BaseModel, Field, ValidationError

from functions.runtime.config import log_runtime_status
from functions.runtime.core.pipeline.base import StageName
from functions.runtime.core.pipeline.stages.brightdata_stage import BrightDataStage
from functions.runtime.core.post_filter import BrightDataClient
from functions.runtime.models.domain import CreatorProfile
from stage_utils import (
    StageDocumentNotFoundError,
    StageExecutionResult,
    build_stage_result,
    calculate_payload_size,
    ensure_completed_stages,
    get_stage_progress,
    read_stage_profiles,
    record_stage_failure,
    sanitize_debug_output,
    save_stage_document,
    timed_operation,
    update_pipeline_status,
)


logger = logging.getLogger(__name__)


class BrightDataStagePayload(BaseModel):
    pipeline_id: str = Field(..., min_length=1)
    user_id: str = Field(..., min_length=1)
    input_stage: str = Field(default=StageName.SEARCH)
    completed_stages: List[str] = Field(default_factory=list)
    debug_mode: bool = Field(default=False)


_brightdata_stage: Optional[BrightDataStage] = None
_status_logged = False


def _ensure_stage_ready() -> None:
    global _brightdata_stage
    config = search._get_config()  # pylint: disable=protected-access
    _log_stage_status()
    dataset_ready = bool(
        config.BRIGHTDATA_API_KEY
        and (config.BRIGHTDATA_INSTAGRAM_DATASET_ID or config.BRIGHTDATA_TIKTOK_DATASET_ID)
    )
    if not dataset_ready:
        logger.warning("BrightData stage disabled", extra={"dataset_ready": False})
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            message="BrightData credentials are not configured",
        )
    if _brightdata_stage is not None:
        return
    try:
        client = BrightDataClient()
    except Exception as exc:  # pylint: disable=broad-except
        logger.exception("Failed to initialize BrightData client", exc_info=exc)
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAVAILABLE,
            message="BrightData client is not available",
        ) from exc
    _brightdata_stage = BrightDataStage(client)


def _log_stage_status() -> None:
    global _status_logged
    if _status_logged:
        return
    log_runtime_status(logger, scope="brightdata_stage")
    _status_logged = True


def _load_profiles(payload: BrightDataStagePayload) -> List[CreatorProfile]:
    try:
        return read_stage_profiles(payload.pipeline_id, payload.input_stage)
    except StageDocumentNotFoundError as exc:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            message=str(exc),
        ) from exc


def execute_brightdata_stage(payload: BrightDataStagePayload) -> StageExecutionResult:
    pipeline_id = payload.pipeline_id.strip()
    if not pipeline_id:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="pipeline_id is required",
        )

    _ensure_stage_ready()

    stage_name = StageName.BRIGHTDATA
    timing_summary: Dict[str, Any] = {}
    profiles: List[CreatorProfile] = []
    output_profiles: List[CreatorProfile] = []
    metadata: Dict[str, Any] = {}
    raw_debug_payload: Dict[str, Any] = {}
    input_size = calculate_payload_size([])
    stage_result: Optional[Any] = None

    with timed_operation("brightdata_stage_total", logger) as total_timing:
        with timed_operation("load_input_profiles", logger) as load_timing:
            profiles = _load_profiles(payload)
        timing_summary["load_input_profiles"] = dict(load_timing)
        input_size = calculate_payload_size(profiles)

        if not profiles:
            metadata = {"reason": "no_profiles"}
            raw_debug_payload = {"skipped": True, "reason": "no_profiles", "input_stage": payload.input_stage}
            output_profiles = []
        else:
            api_timing: Optional[Dict[str, Any]] = None
            try:
                with timed_operation("brightdata_api_calls", logger) as api_context:
                    api_timing = api_context
                    stage_result = _brightdata_stage.run(  # type: ignore[union-attr]
                        profiles,
                        progress_cb=None,
                    )
                if api_timing:
                    timing_summary["brightdata_api_calls"] = dict(api_timing)
                output_profiles = stage_result.profiles
            except Exception as exc:  # pylint: disable=broad-except
                if api_timing:
                    timing_summary["brightdata_api_calls"] = dict(api_timing)
                logger.exception("BrightData stage failed", exc_info=exc)
                if isinstance(exc, requests.Timeout):
                    code = https_fn.FunctionsErrorCode.UNAVAILABLE
                elif isinstance(exc, RuntimeError):
                    code = https_fn.FunctionsErrorCode.FAILED_PRECONDITION
                else:
                    code = https_fn.FunctionsErrorCode.INTERNAL
                record_stage_failure(
                    pipeline_id=pipeline_id,
                    stage=stage_name,
                    user_id=payload.user_id,
                    error_message=str(exc),
                    progress=get_stage_progress(stage_name),
                )
                raise https_fn.HttpsError(
                    code=code,
                    message="BrightData stage execution failed",
                ) from exc

            metadata = {"io": stage_result.io.model_dump()} if stage_result and stage_result.io else {}
            raw_debug_payload = dict(stage_result.debug or {}) if stage_result else {}

    timing_summary["brightdata_stage_total"] = dict(total_timing)

    output_size = calculate_payload_size(output_profiles)
    metadata = dict(metadata or {})
    metadata["input_size"] = input_size
    metadata["output_size"] = output_size

    urls_processed = sum(1 for profile in profiles if (profile.profile_url or profile.username))
    success_count = len(raw_debug_payload.get("success_keys", []))
    failed_count = max(urls_processed - success_count, 0)

    logger.info(
        "BrightData stage I/O",
        extra={
            "pipeline_id": pipeline_id,
            "input_count": input_size["profile_count"],
            "output_count": output_size["profile_count"],
            "urls_processed": urls_processed,
            "successful": success_count,
            "failed": failed_count,
        },
    )

    if payload.debug_mode:
        sample_responses = list(raw_debug_payload.get("brightdata_results", [])[:2])
        debug_payload = {
            **raw_debug_payload,
            "brightdata_params": {
                "chunk_size": getattr(_brightdata_stage, "_chunk_size", None),
                "input_stage": payload.input_stage,
            },
            "timing": timing_summary,
            "api_stats": {
                "urls_processed": urls_processed,
                "successful_enrichments": success_count,
                "failed_enrichments": failed_count,
                "error_count": len(raw_debug_payload.get("errors", [])),
            },
            "sample_responses": sample_responses,
            "error_summary": raw_debug_payload.get("errors", []),
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
    secrets=[search.BRIGHTDATA_API_KEY_SECRET],  # pylint: disable=protected-access
    timeout_sec=900,
)
def brightdata_stage(request: https_fn.CallableRequest) -> Dict[str, Any]:
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
            "BrightData stage running in TEST MODE",
            extra={"emulator": is_emulator, "debug_mode": requested_debug_mode},
        )
    else:
        payload_dict["user_id"] = request.auth.uid
    try:
        payload = BrightDataStagePayload(**payload_dict)
    except ValidationError as exc:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message=str(exc),
        ) from exc

    logger.info(
        "BrightData stage invoked",
        extra={
            "pipeline_id": payload.pipeline_id,
            "input_stage": payload.input_stage,
            "debug_mode": payload.debug_mode,
        },
    )

    result = execute_brightdata_stage(payload)
    logger.info(
        "BrightData stage completed",
        extra={
            "pipeline_id": payload.pipeline_id,
            "duration_ms": (result.timing or {})
            .get("brightdata_stage_total", {})
            .get("duration_ms"),
            "output_count": result.count,
        },
    )
    return result.to_response()


__all__ = ["brightdata_stage", "execute_brightdata_stage", "BrightDataStagePayload"]
