"""Callable Cloud Function that chains the pipeline stages with Firestore status updates."""
from __future__ import annotations

import logging
import os
import uuid
from typing import Any, Dict, List, Optional

import search
from firebase_functions import https_fn
from pydantic import ValidationError

from functions.runtime.core.pipeline.base import StageName
from functions.runtime.models.search import PipelineStageEvent, SearchPipelineRequest, SearchPipelineResponse
from stage_utils import (
    StageExecutionResult,
    complete_pipeline_status,
    create_pipeline_status,
    error_pipeline_status,
    pipeline_status_path,
    sanitize_debug_output,
    timed_operation,
)
from brightdata_stage import BrightDataStagePayload, execute_brightdata_stage
from llm_fit_stage import LLMFitStagePayload, execute_llm_fit_stage
from search_stage import SearchStagePayload, execute_search_stage


logger = logging.getLogger(__name__)


def _stage_event_payload(result: StageExecutionResult) -> PipelineStageEvent:
    data = {
        "status": result.status,
        "count": result.count,
        "stage_document_path": result.stage_document_path,
        "completed_stages": result.completed_stages,
    }
    return PipelineStageEvent(stage=result.stage, data=data)


def _stage_duration_ms(result: StageExecutionResult) -> Optional[float]:
    if not result.timing:
        return None
    for key, value in result.timing.items():
        if key.endswith("stage_total") and isinstance(value, dict):
            duration = value.get("duration_ms")
            if isinstance(duration, (int, float)):
                return float(duration)
    return None


def _extract_debug(result: Optional[StageExecutionResult], key: str) -> List[Dict[str, Any]]:
    if not result:
        return []
    payload = result.debug.get(key)
    if isinstance(payload, list):
        return payload
    return []


@https_fn.on_call(
    region=search._get_config().REGION,  # pylint: disable=protected-access
    enforce_app_check=False,
    secrets=[
        search.OPENAI_API_KEY_SECRET,  # pylint: disable=protected-access
        search.BRIGHTDATA_API_KEY_SECRET,  # pylint: disable=protected-access
        search.DEEPINFRA_API_KEY_SECRET,  # pylint: disable=protected-access
    ],
    timeout_sec=900,
)
def search_pipeline_orchestrator(request: https_fn.CallableRequest) -> Dict[str, Any]:
    payload_dict = dict(request.data or {})
    pipeline_id = str(payload_dict.get("pipeline_id", "")).strip() or uuid.uuid4().hex
    log = logging.LoggerAdapter(logger, {"pipeline_id": pipeline_id})
    raw_debug_flag = payload_dict.get("debug_mode")
    if isinstance(raw_debug_flag, str):
        requested_debug_mode = raw_debug_flag.strip().lower() in {"true", "1", "yes", "on"}
    else:
        requested_debug_mode = bool(raw_debug_flag)
    is_emulator = os.getenv("FUNCTIONS_EMULATOR") == "true"

    if request.auth is None and not (requested_debug_mode and is_emulator):
        error_pipeline_status(
            pipeline_id,
            user_id="unknown",
            error_message="Authentication required",
        )
        log.warning(
            "Rejected unauthenticated pipeline invocation",
            extra={"requested_debug_mode": requested_debug_mode},
        )
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Authentication required",
        )

    test_mode = request.auth is None
    user_id = request.auth.uid if request.auth else "test-user"
    if test_mode:
        log.warning(
            "Pipeline orchestrator running in TEST MODE",
            extra={"emulator": is_emulator, "debug_mode": requested_debug_mode},
        )
    payload_dict.pop("pipeline_id", None)

    try:
        pipeline_request = SearchPipelineRequest(**payload_dict)
    except ValidationError as exc:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message=str(exc),
        ) from exc

    create_pipeline_status(pipeline_id, user_id=user_id)
    completed: List[str] = []
    stage_results: Dict[str, StageExecutionResult] = {}
    stage_events: List[PipelineStageEvent] = []
    final_result: Optional[StageExecutionResult] = None
    stage_timings_summary: Dict[str, Any] = {}
    stage_counts: Dict[str, Dict[str, Optional[int]]] = {}
    pipeline_timing: Dict[str, Any] = {}

    stop_at_stage = pipeline_request.stop_at_stage
    log.info(
        "Pipeline configuration",
        extra={"pipeline_id": pipeline_id, "stop_at_stage": stop_at_stage},
    )

    stage_sequence = (
        StageName.SEARCH,
        StageName.BRIGHTDATA,
        StageName.LLM_FIT,
    )
    stage_rank = {stage: index for index, stage in enumerate(stage_sequence)}

    def _should_run_stage(stage_name: str, stop_at: Optional[str]) -> bool:
        if stop_at is None:
            return True
        stop_rank = stage_rank.get(stop_at)
        current_rank = stage_rank.get(stage_name)
        if stop_rank is None or current_rank is None:
            return True
        return current_rank <= stop_rank

    def _record_stage_result(result: StageExecutionResult) -> None:
        nonlocal completed, final_result
        stage_key = str(result.stage)
        completed = result.completed_stages
        stage_events.append(_stage_event_payload(result))
        stage_results[result.stage] = result
        final_result = result
        stage_timings_summary[stage_key] = result.timing or {}
        stage_counts[stage_key] = {
            "input": (result.input_size or {}).get("profile_count") if result.input_size else None,
            "output": (result.output_size or {}).get("profile_count") if result.output_size else None,
        }
        log.info(
            "Stage completed",
            extra={
                "pipeline_id": pipeline_id,
                "stage": stage_key,
                "duration_ms": _stage_duration_ms(result),
                "input_count": stage_counts[stage_key]["input"],
                "output_count": stage_counts[stage_key]["output"],
                "status": result.status,
            },
        )

    with timed_operation("pipeline_orchestrator_total", log) as pipeline_timer:
        try:
            search_result = execute_search_stage(
                SearchStagePayload(
                    pipeline_id=pipeline_id,
                    user_id=user_id,
                    search=pipeline_request.search,
                    max_profiles=pipeline_request.max_profiles,
                    completed_stages=completed,
                    debug_mode=pipeline_request.debug_mode,
                )
            )
            _record_stage_result(search_result)

            if _should_run_stage(StageName.BRIGHTDATA, stop_at_stage):
                brightdata_result = execute_brightdata_stage(
                    BrightDataStagePayload(
                        pipeline_id=pipeline_id,
                        user_id=user_id,
                        input_stage=StageName.SEARCH,
                        completed_stages=completed,
                        debug_mode=pipeline_request.debug_mode,
                    )
                )
                _record_stage_result(brightdata_result)

            if _should_run_stage(StageName.LLM_FIT, stop_at_stage):
                llm_result = execute_llm_fit_stage(
                    LLMFitStagePayload(
                        pipeline_id=pipeline_id,
                        user_id=user_id,
                        input_stage=StageName.BRIGHTDATA,
                        completed_stages=completed,
                        business_fit_query=pipeline_request.business_fit_query,
                        max_posts=pipeline_request.max_posts,
                        model=pipeline_request.model,
                        verbosity=pipeline_request.verbosity,
                        concurrency=pipeline_request.concurrency,
                        debug_mode=pipeline_request.debug_mode,
                    )
                )
                _record_stage_result(llm_result)

            if stop_at_stage and stop_at_stage != StageName.LLM_FIT:
                log.info(
                    "Pipeline stopped early",
                    extra={
                        "pipeline_id": pipeline_id,
                        "stop_at_stage": stop_at_stage,
                        "last_stage": final_result.stage if final_result else None,
                    },
                )

            complete_pipeline_status(pipeline_id, user_id=user_id)
        except https_fn.HttpsError as exc:
            error_pipeline_status(pipeline_id, user_id, exc.message or "Pipeline failed")
            log.warning(
                "Pipeline orchestrator raised HttpsError",
                extra={"error_code": getattr(exc, "code", None)},
            )
            raise
        except Exception as exc:  # pylint: disable=broad-except
            log.exception("Pipeline orchestrator failed", exc_info=exc)
            error_pipeline_status(pipeline_id, user_id, str(exc))
            raise https_fn.HttpsError(
                code=https_fn.FunctionsErrorCode.INTERNAL,
                message="Pipeline orchestration failed",
            ) from exc

    pipeline_timing = dict(pipeline_timer)

    final_result = final_result or stage_results.get(StageName.SEARCH)
    if final_result is None:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message="Pipeline produced no results",
        )

    brightdata_results = _extract_debug(stage_results.get(StageName.BRIGHTDATA), "brightdata_results")
    profile_fit = _extract_debug(stage_results.get(StageName.LLM_FIT), "profile_fit")

    debug_summary: Optional[Dict[str, Any]] = None
    if pipeline_request.debug_mode:
        debug_summary = sanitize_debug_output(
            {
                "pipeline_id": pipeline_id,
                "total_duration_ms": pipeline_timing.get("duration_ms"),
                "stage_timings": stage_timings_summary,
                "stage_counts": stage_counts,
                "test_mode": test_mode,
            }
        )

    response_model = SearchPipelineResponse(
        success=True,
        results=final_result.serialized_profiles,
        brightdata_results=brightdata_results,
        profile_fit=profile_fit,
        stages=stage_events,
        count=final_result.count,
        pipeline_id=pipeline_id,
        pipeline_status_path=pipeline_status_path(pipeline_id),
        debug_summary=debug_summary,
    )
    log.info(
        "Pipeline orchestrator completed",
        extra={
            "pipeline_id": pipeline_id,
            "result_count": response_model.count,
            "duration_ms": pipeline_timing.get("duration_ms"),
        },
    )
    return response_model.model_dump()


__all__ = ["search_pipeline_orchestrator"]
