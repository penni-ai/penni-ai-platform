"""Callable Cloud Function for reranking search results as an independent stage."""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Literal, Optional

import search
from firebase_functions import https_fn
from pydantic import BaseModel, Field, ValidationError

from functions.runtime.config import log_runtime_status
from functions.runtime.core.pipeline.base import StageName
from functions.runtime.core.pipeline.stages.rerank_stage import RerankStage
from functions.runtime.models.domain import CreatorProfile
from functions.runtime.services.rerank_client import RerankClient, RerankError
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


class RerankStagePayload(BaseModel):
    pipeline_id: str = Field(..., min_length=1)
    user_id: str = Field(..., min_length=1)
    input_stage: str = Field(default=StageName.SEARCH)
    query: str = Field(..., min_length=1)
    mode: Literal["bio", "posts", "bio+posts"] = "bio+posts"
    top_k: int = Field(default=200, ge=1, le=1000)
    completed_stages: List[str] = Field(default_factory=list)
    debug_mode: bool = Field(default=False)


_rerank_stage: Optional[RerankStage] = None
_status_logged = False


def _ensure_stage_ready() -> None:
    global _rerank_stage
    config = search._get_config()  # pylint: disable=protected-access
    _log_stage_status()
    if not config.RERANKER_ENABLED:
        logger.warning("Rerank stage disabled", extra={"reranker_enabled": False})
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            message="Rerank client is not configured",
        )
    if _rerank_stage is not None:
        return
    try:
        client = RerankClient()
    except Exception as exc:  # pylint: disable=broad-except
        logger.exception("Failed to initialize RerankClient", exc_info=exc)
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAVAILABLE,
            message="Rerank client is not available",
        ) from exc
    _rerank_stage = RerankStage(client)


def _log_stage_status() -> None:
    global _status_logged
    if _status_logged:
        return
    log_runtime_status(logger, scope="rerank_stage")
    _status_logged = True


def _load_profiles(payload: RerankStagePayload) -> List[CreatorProfile]:
    try:
        return read_stage_profiles(payload.pipeline_id, payload.input_stage)
    except StageDocumentNotFoundError as exc:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            message=str(exc),
        ) from exc


def execute_rerank_stage(payload: RerankStagePayload) -> StageExecutionResult:
    pipeline_id = payload.pipeline_id.strip()
    if not pipeline_id:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="pipeline_id is required",
        )

    _ensure_stage_ready()

    stage_name = "RERANK"
    timing_summary: Dict[str, Any] = {}
    profiles: List[CreatorProfile] = []
    output_profiles: List[CreatorProfile] = []
    metadata: Dict[str, Any] = {}
    raw_debug_payload: Dict[str, Any] = {}
    input_size = calculate_payload_size([])
    stage_result: Any = None

    with timed_operation("rerank_stage_total", logger) as total_timing:
        with timed_operation("load_input_profiles", logger) as load_timing:
            profiles = _load_profiles(payload)
        timing_summary["load_input_profiles"] = dict(load_timing)
        input_size = calculate_payload_size(profiles)

        if not profiles:
            metadata = {"reason": "no_profiles"}
            raw_debug_payload = {"skipped": True, "reason": "no_profiles", "input_stage": payload.input_stage}
            output_profiles = []
        else:
            try:
                with timed_operation("rerank_execution", logger) as rerank_timing:
                    stage_result = _rerank_stage.run(  # type: ignore[union-attr]
                        profiles,
                        progress_cb=None,
                        query=payload.query,
                        mode=payload.mode,
                        top_k=payload.top_k,
                    )
                timing_summary["rerank_execution"] = dict(rerank_timing)
                output_profiles = stage_result.profiles
            except RerankError as exc:
                logger.exception("Rerank stage failed", exc_info=exc)
                record_stage_failure(
                    pipeline_id=pipeline_id,
                    stage=stage_name,
                    user_id=payload.user_id,
                    error_message=str(exc),
                    progress=get_stage_progress(stage_name),
                )
                raise https_fn.HttpsError(
                    code=https_fn.FunctionsErrorCode.UNAVAILABLE,
                    message="Rerank stage execution failed",
                ) from exc
            except Exception as exc:  # pylint: disable=broad-except
                logger.exception("Rerank stage failed", exc_info=exc)
                record_stage_failure(
                    pipeline_id=pipeline_id,
                    stage=stage_name,
                    user_id=payload.user_id,
                    error_message=str(exc),
                    progress=get_stage_progress(stage_name),
                )
                raise https_fn.HttpsError(
                    code=https_fn.FunctionsErrorCode.INTERNAL,
                    message="Rerank stage execution failed",
                ) from exc

            metadata = {"io": stage_result.io.model_dump()} if stage_result and stage_result.io else {}
            raw_debug_payload = dict(stage_result.debug or {}) if stage_result else {}

    timing_summary["rerank_stage_total"] = dict(total_timing)

    output_size = calculate_payload_size(output_profiles)
    metadata = dict(metadata or {})
    metadata["input_size"] = input_size
    metadata["output_size"] = output_size

    logger.info(
        "Rerank stage I/O",
        extra={
            "pipeline_id": pipeline_id,
            "input_count": input_size["profile_count"],
            "output_count": output_size["profile_count"],
            "input_bytes_estimate": input_size["estimated_bytes"],
            "output_bytes_estimate": output_size["estimated_bytes"],
        },
    )

    if payload.debug_mode:
        rerank_scores = [
            {
                "profile_id": profile.lance_db_id or profile.id,
                "score": profile.rerank_score,
            }
            for profile in output_profiles
            if profile.rerank_score is not None
        ][:5]
        debug_payload = {
            **raw_debug_payload,
            "rerank_params": {
                "query": payload.query,
                "mode": payload.mode,
                "top_k": payload.top_k,
            },
            "timing": timing_summary,
            "input_stage": payload.input_stage,
            "rerank_scores": rerank_scores,
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
    timeout_sec=900,
)
def rerank_stage(request: https_fn.CallableRequest) -> Dict[str, Any]:
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
            "Rerank stage running in TEST MODE",
            extra={"emulator": is_emulator, "debug_mode": requested_debug_mode},
        )
    else:
        payload_dict["user_id"] = request.auth.uid
    try:
        payload = RerankStagePayload(**payload_dict)
    except ValidationError as exc:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message=str(exc),
        ) from exc

    logger.info(
        "Rerank stage invoked",
        extra={
            "pipeline_id": payload.pipeline_id,
            "query": payload.query,
            "mode": payload.mode,
            "debug_mode": payload.debug_mode,
        },
    )

    result = execute_rerank_stage(payload)
    logger.info(
        "Rerank stage completed",
        extra={
            "pipeline_id": payload.pipeline_id,
            "duration_ms": (result.timing or {})
            .get("rerank_stage_total", {})
            .get("duration_ms"),
            "output_count": result.count,
        },
    )
    return result.to_response()


__all__ = ["rerank_stage", "execute_rerank_stage", "RerankStagePayload"]
