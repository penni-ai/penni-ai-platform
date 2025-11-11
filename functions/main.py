"""Firebase entrypoint wiring for penny-platform Cloud Functions."""

import json
import logging

from firebase_functions import https_fn
from firebase_functions.options import set_global_options
from firebase_admin import initialize_app
from google.cloud import logging as gcl

from cleanup_expired_pipelines import cleanup_expired_pipelines  # noqa: F401
from search import search_connectivity_check, search_pipeline  # noqa: F401
from orchestrator import search_pipeline_orchestrator  # noqa: F401
from search_stage import search_stage  # noqa: F401
from rerank_stage import rerank_stage  # noqa: F401
from brightdata_stage import brightdata_stage  # noqa: F401
from llm_fit_stage import llm_fit_stage  # noqa: F401

# For cost control, you can set the maximum number of containers that can be
# running at the same time. This helps mitigate the impact of unexpected
# traffic spikes by instead downgrading performance. This limit is a per-function
# limit. You can override the limit for each function using the max_instances
# parameter in the decorator, e.g. @https_fn.on_request(max_instances=5).
set_global_options(max_instances=10)

_logger = logging.getLogger(__name__)
try:
    _gcl_client = gcl.Client()
    _gcl_client.setup_logging()
except Exception:  # pragma: no cover - defensive config
    _logger.warning("Cloud Logging setup skipped", extra={"cloud_logging_setup": False})

initialize_app()

# Debug mode is toggled via the callable request payload's "debug_mode" field.
# Query-string debug flags are ignored for callable handlers to avoid accidental exposure.

# search_pipeline is registered via import above using the @https_fn.on_call decorator.
# The search pipeline orchestrator persists progress updates in Firestore at
# search_pipeline_runs/{pipeline_id}. Clients can subscribe to that document for
# real-time status as each stage Cloud Function completes.
# cleanup_expired_pipelines is scheduled hourly via Cloud Scheduler to delete
# documents where ttl < now(), keeping storage bounded automatically.


@https_fn.on_request()
def debug_ping(request: https_fn.Request) -> https_fn.Response:
    """Lightweight smoke-test endpoint to verify debug flag plumbing."""

    debug_param = request.args.get("debug", "")
    debug_enabled = str(debug_param).strip().lower() in {"1", "true", "yes", "on"}
    body = {
        "debug_mode": debug_enabled,
        "message": "Set debug_mode in callable payloads instead of query params.",
    }
    _logger.info("Debug ping invoked", extra={"debug_query_flag": debug_enabled})
    return https_fn.Response(
        json.dumps(body),
        status=200,
        headers={"Content-Type": "application/json"},
    )
