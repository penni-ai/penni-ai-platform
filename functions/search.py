"""Firebase callable for running the creator discovery pipeline serverlessly."""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional

import requests
from firebase_functions import https_fn, params
from pydantic import SecretStr, ValidationError

from functions.runtime.api.serializers import serialize_creator_profile
from functions.runtime.config import (
    RuntimeSettings,
    log_runtime_status,
    settings as runtime_settings,
)
from functions.runtime.core.pipeline.orchestrator import CreatorDiscoveryPipeline
from functions.runtime.core.post_filter import BrightDataClient, ProfileFitAssessor
from functions.runtime.models.domain import CreatorProfile
from functions.runtime.models.search import (
    PipelineStageEvent,
    SearchPipelineRequest,
    SearchPipelineResponse,
)

logger = logging.getLogger(__name__)
if not logger.handlers:
    logging.basicConfig(level=logging.INFO)
logger.setLevel(logging.INFO)

OPENAI_API_KEY_SECRET = params.SecretParam("OPENAI_API_KEY")
BRIGHTDATA_API_KEY_SECRET = params.SecretParam("BRIGHTDATA_API_KEY")
DEEPINFRA_API_KEY_SECRET = params.SecretParam("DEEPINFRA_API_KEY")

DEFAULT_BRIGHTDATA_BASE_URL = "https://api.brightdata.com/datasets/v3"
DEFAULT_BRIGHTDATA_POLL_INTERVAL = 30
DEFAULT_BRIGHTDATA_MAX_URLS = 50
DEFAULT_DEEPINFRA_BASE_URL = "https://api.deepinfra.com"
DEFAULT_DEEPINFRA_EMBED_PATH = "/v1/openai"
DEFAULT_DEEPINFRA_INFERENCE_PATH = "/v1/inference"


def _secret_value(secret: Optional[SecretStr]) -> Optional[str]:
    if secret is None:
        return None
    try:
        return secret.get_secret_value()
    except AttributeError:
        return str(secret)

_config: RuntimeSettings = runtime_settings
_pipeline: Optional["CreatorDiscoveryPipeline"] = None
_stage_events: List[Dict[str, Any]] = []
_creator_profile_cls: Optional[type] = CreatorProfile
_serialize_creator_profile_fn: Optional[Callable[[Any], Any]] = serialize_creator_profile
_status_scopes_logged: set[str] = set()


def _get_config() -> RuntimeSettings:
    return _config


def _initialize_pipeline() -> bool:
    """Instantiate the pipeline orchestrator and optional clients once per instance."""

    global _pipeline
    _log_status_once("pipeline")
    if _pipeline is not None:
        return True

    try:
        brightdata_client = BrightDataClient()
    except Exception:  # pylint: disable=broad-except
        logger.exception("Failed to initialize BrightDataClient")
        return False

    try:
        _pipeline = CreatorDiscoveryPipeline(
            brightdata_client=brightdata_client,
            assessor_factory=ProfileFitAssessor,
        )
        logger.info(
            "Creator discovery pipeline ready",
            extra={
                "brightdata_enabled": True,
            },
        )
        return True
    except Exception:  # pylint: disable=broad-except
        logger.exception("Failed to initialize CreatorDiscoveryPipeline")
        _pipeline = None
        return False


def _log_status_once(scope: str) -> None:
    if scope in _status_scopes_logged:
        return
    log_runtime_status(logger, scope=scope)
    _status_scopes_logged.add(scope)


def _serialize_stage_data(data: Dict[str, Any]) -> Dict[str, Any]:
    if data is None:
        return {}

    profile_cls = _creator_profile_cls
    serializer = _serialize_creator_profile_fn

    def _coerce(value: Any) -> Any:
        if profile_cls and isinstance(value, profile_cls):
            return serializer(value) if serializer else value
        if hasattr(value, "model_dump") and callable(value.model_dump):
            return value.model_dump()
        if isinstance(value, list):
            return [_coerce(item) for item in value]
        if isinstance(value, dict):
            return {key: _coerce(val) for key, val in value.items()}
        return value

    return {key: _coerce(val) for key, val in data.items()}


def _progress_callback(stage: str, data: Dict[str, Any]) -> None:
    serialized = _serialize_stage_data(data)
    _stage_events.append({"stage": stage, "data": serialized})
    logger.info("Stage telemetry", extra={"stage": stage, "meta": serialized})


def _check_openai_access(config: RuntimeSettings) -> Dict[str, Any]:
    api_key = _secret_value(config.OPENAI_API_KEY)
    if not api_key:
        return {
            "ok": False,
            "error": "OPENAI_API_KEY is not configured.",
        }

    try:
        from openai import OpenAI
    except ImportError as exc:  # pragma: no cover - defensive on packaging
        return {"ok": False, "error": f"OpenAI client unavailable: {exc}"}

    client = OpenAI(api_key=api_key)
    try:
        response = client.models.list()
        models = list(response.data or [])
        sample_model = models[0].id if models else None
        return {
            "ok": True,
            "models_seen": len(models),
            "sample_model": sample_model,
        }
    except Exception as exc:  # pylint: disable=broad-except
        logger.warning("OpenAI connectivity check failed", exc_info=True)
        return {"ok": False, "error": str(exc)}


def _check_deepinfra_access(config: RuntimeSettings) -> Dict[str, Any]:
    api_key = _secret_value(config.DEEPINFRA_API_KEY)
    base_url = (config.DEEPINFRA_BASE_URL or DEFAULT_DEEPINFRA_BASE_URL).rstrip("/")
    embed_path = (config.DEEPINFRA_EMBED_PATH or DEFAULT_DEEPINFRA_EMBED_PATH).strip()
    if not embed_path.startswith("/"):
        embed_path = f"/{embed_path}"
    endpoint = f"{base_url}{embed_path}".rstrip("/")
    metadata: Dict[str, Any] = {"base_url": base_url, "embed_path": embed_path, "endpoint": endpoint}

    if not api_key:
        metadata.update({"ok": False, "error": "DEEPINFRA_API_KEY is not configured."})
        return metadata

    try:
        from openai import OpenAI
    except ImportError as exc:  # pragma: no cover
        metadata.update({"ok": False, "error": f"OpenAI client unavailable: {exc}"})
        return metadata

    client = OpenAI(api_key=api_key, base_url=endpoint)
    try:
        response = client.models.list()
        models = list(response.data or [])
        metadata.update(
            {
                "ok": True,
                "models_seen": len(models),
                "sample_model": models[0].id if models else None,
            }
        )
    except Exception as exc:  # pylint: disable=broad-except
        logger.warning("DeepInfra connectivity check failed", exc_info=True)
        metadata.update({"ok": False, "error": str(exc)})
    return metadata


def _check_brightdata_access(config: RuntimeSettings) -> Dict[str, Any]:
    api_key = (config.BRIGHTDATA_API_KEY or "").strip() if config.BRIGHTDATA_API_KEY else ""
    dataset_id = config.BRIGHTDATA_INSTAGRAM_DATASET_ID or config.BRIGHTDATA_TIKTOK_DATASET_ID
    base_url = str(config.BRIGHTDATA_BASE_URL or DEFAULT_BRIGHTDATA_BASE_URL).rstrip("/")

    result: Dict[str, Any] = {
        "dataset_id": dataset_id,
        "base_url": base_url,
    }

    if not api_key:
        result.update({"ok": False, "error": "BRIGHTDATA_API_KEY is not configured."})
        return result

    if not dataset_id:
        result.update({"ok": False, "error": "No BrightData dataset ID configured."})
        return result

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    probe_url = f"{base_url}/progress/healthcheck"
    try:
        response = requests.get(probe_url, headers=headers, timeout=15)
    except requests.RequestException as exc:
        logger.warning("BrightData connectivity check failed", exc_info=True)
        result.update({"ok": False, "error": str(exc)})
        return result

    status = response.status_code
    truncated_body = (response.text or "")[:200]

    if status in {200, 404}:
        message = "BrightData API reachable" if status == 200 else "Authenticated but placeholder snapshot not found"
        result.update({
            "ok": True,
            "status_code": status,
            "message": message,
        })
    elif status in {401, 403}:
        result.update({
            "ok": False,
            "status_code": status,
            "error": "BrightData rejected the provided credentials.",
            "response_text": truncated_body,
        })
    else:
        result.update({
            "ok": False,
            "status_code": status,
            "error": "Unexpected BrightData status code.",
            "response_text": truncated_body,
        })

    return result


@https_fn.on_call(
    region=_get_config().REGION,
    enforce_app_check=False,
    secrets=[
        OPENAI_API_KEY_SECRET,
        BRIGHTDATA_API_KEY_SECRET,
        DEEPINFRA_API_KEY_SECRET,
    ],
    timeout_sec=900,
)
def search_pipeline(request: https_fn.CallableRequest) -> Dict[str, Any]:
    """Callable function entry point that runs the creator discovery pipeline synchronously."""

    global _stage_events

    if request.auth is None:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Authentication required",
        )

    if not _initialize_pipeline():
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            message="Search service not available",
        )

    payload = request.data or {}
    try:
        pipeline_request = SearchPipelineRequest(**payload)
    except ValidationError as exc:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message=str(exc),
        ) from exc

    _stage_events = []

    try:
        profiles, debug = _pipeline.run(pipeline_request, progress_cb=_progress_callback)  # type: ignore[arg-type]
    except ValueError as exc:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message=str(exc),
        ) from exc
    except Exception as exc:  # pylint: disable=broad-except
        logger.exception("Creator discovery pipeline failed", exc_info=exc)
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message="Pipeline execution failed",
        ) from exc

    serializer_fn = _serialize_creator_profile_fn or serialize_creator_profile
    debug = debug or {}
    serialized_profiles = [serializer_fn(profile) for profile in profiles or []]
    stage_models = [PipelineStageEvent(**event) for event in _stage_events]
    response_model = SearchPipelineResponse(
        success=True,
        results=serialized_profiles,
        brightdata_results=debug.get("brightdata_results", []),
        profile_fit=debug.get("profile_fit", []),
        stages=stage_models,
        count=len(serialized_profiles),
    )
    logger.info(
        "Search pipeline completed",
        extra={"count": response_model.count, "uid": request.auth.uid},
    )
    return response_model.model_dump()


@https_fn.on_call(
    region=_get_config().REGION,
    enforce_app_check=False,
    secrets=[
        OPENAI_API_KEY_SECRET,
        BRIGHTDATA_API_KEY_SECRET,
        DEEPINFRA_API_KEY_SECRET,
    ],
)
def search_connectivity_check(request: https_fn.CallableRequest) -> Dict[str, Any]:
    """Lightweight callable that verifies external service credentials."""

    if request.auth is None:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Authentication required",
        )

    config = _get_config()

    payload = request.data or {}
    raw_targets = payload.get("targets")

    if isinstance(raw_targets, str):
        requested_targets = [part.strip().lower() for part in raw_targets.split(",") if part.strip()]
    elif isinstance(raw_targets, (list, tuple, set)):
        requested_targets = [str(item).strip().lower() for item in raw_targets if str(item).strip()]
    else:
        requested_targets = []

    available_checks: Dict[str, Callable[[RuntimeSettings], Dict[str, Any]]] = {
        "openai": _check_openai_access,
        "deepinfra": _check_deepinfra_access,
        "brightdata": _check_brightdata_access,
    }

    targets = requested_targets or list(available_checks.keys())
    results: Dict[str, Dict[str, Any]] = {}

    for target in targets:
        checker = available_checks.get(target)
        if checker is None:
            results[target] = {"ok": False, "error": f"Unknown target '{target}'"}
            continue
        results[target] = checker(config)

    success = bool(results) and all(entry.get("ok") for entry in results.values())
    return {
        "success": success,
        "results": results,
        "checked": list(results.keys()),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
