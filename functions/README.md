# Firebase Cloud Functions – Creator Search Pipeline

Serverless Python 3.13 Cloud Functions power the creator search experience. The `search_pipeline` callable function ingests structured requests, runs multi-query hybrid search against Weaviate, and optionally layers rerankers, BrightData enrichment, and LLM-based fit scoring without dedicated infrastructure.

## Features
- Automatic scaling with Firebase Cloud Functions v2 callable trigger.
- Native Weaviate + DeepInfra integration removes the LanceDB snapshot and delivers instant cold starts.
- Sequential pipeline stages (search → rerank → enrichment → LLM scoring) already implemented in `search.py`.
- Built-in Firebase Authentication validation and parameterized secrets via `params.SecretParam`.
- Flexible pipeline execution – stop at any stage for faster results.

## Project Structure
```
functions/
├── main.py                   # Firebase entry point and admin initialization
├── search.py                 # Search pipeline and stage orchestration
├── requirements.txt          # Python dependencies (hosted API client, BrightData, etc.)
├── .env.example              # Environment variables template
├── DEPLOYMENT.md             # Detailed deployment workflow
└── runtime/                  # Shared pipeline modules (BrightData, reranker, serializers)
```

## Quick Start
1. Install prerequisites: Python 3.13, Firebase CLI (`npm -g install firebase-tools`), Google Cloud SDK.
2. `cd functions && pip install -r requirements.txt`.
3. Copy `.env.example` to `.env` for local emulator tests and fill non-secret values.
4. Configure the Weaviate + DeepInfra variables (`WEAVIATE_URL`, `WEAVIATE_API_KEY`, `WEAVIATE_COLLECTION_NAME`, embedding + reranker settings).
5. Configure secrets via Firebase CLI (see **Configuration** below).
6. Deploy the function: `firebase deploy --only functions:search_pipeline`.

## Local Development
- Start emulators: `firebase emulators:start --only functions` (loads `.env`).
- Use the Firebase Admin SDK to invoke callable functions locally for integration tests.
- Shared runtime modules live under `functions/runtime`; no additional path munging is required when running in the Firebase emulator.
- Inspect emulator logs for `WeaviateSearchStage initialized` to confirm configuration.

## Deployment
- Follow the step-by-step guide in `DEPLOYMENT.md` to prepare the dataset, bucket, secrets, and CLI configuration.
- Common commands:
  - Deploy everything: `firebase deploy --only functions`.
  - Deploy specific function: `firebase deploy --only functions:search_pipeline`.
  - Tail logs: `firebase functions:log --only search_pipeline`.
- Remember to set `WEAVIATE_URL`, `WEAVIATE_API_KEY`, `WEAVIATE_COLLECTION_NAME`, and DeepInfra/OpenAI/BrightData config per environment.

## Configuration
Environment variables (see `.env.example`):
- **Required**: `WEAVIATE_URL`, `WEAVIATE_API_KEY`, `WEAVIATE_COLLECTION_NAME`, `OPENAI_API_KEY`, `DEEPINFRA_API_KEY`, BrightData dataset IDs (when enrichment enabled).
- **Optional**: `DEEPINFRA_BASE_URL`, `DEEPINFRA_RERANKER_MODEL` (only needed if you deploy the standalone rerank stage), BrightData tuning knobs, etc.
- Set secrets with Firebase CLI (Context7-recommended workflow):
  ```bash
  cat secret.txt | firebase functions:secrets:set OPENAI_API_KEY
  firebase functions:secrets:set BRIGHTDATA_API_KEY
  firebase functions:secrets:set BRIGHTDATA_API_TOKEN
  firebase functions:secrets:set DEEPINFRA_API_KEY
  ```
- Non-secret params can be stored via `firebase functions:config:set` or environment variables defined in `firebase.json`.

## Function Details – `search_pipeline`
- **Trigger**: Callable HTTPS endpoint (`https_fn.on_call`).
- **Auth**: Requires Firebase Auth token supplied by client SDK.
- **Input**: `SearchPipelineRequest` (query string, filters, options) – see the model in `functions/runtime/models/search.py`.
- **Output**: JSON payload describing ranked creators plus metadata for each stage.
- **Timeout**: 60s by default (adjust via decorator options if large downloads occur).
- **Memory**: 256 MB by default; outbound API calls dominate runtime instead of local vector search.
- **Cold start**: <1 s (instantiates the HTTP client; no dataset download).
- **Warm start**: Reuses the cached `WeaviateSearchStage` helpers (Weaviate client + embedding + query expansion sessions).

### Real-time Progress Updates
The new `search_pipeline_orchestrator` callable splits the monolithic flow across three Cloud Functions (search, BrightData, LLM fit) and persists stage progress in Firestore.

1. **Call the orchestrator** – the response includes both `pipeline_id` and `pipeline_status_path`.
2. **Listen to the status document** – subscribe to `search_pipeline_runs/{pipeline_id}` via Firebase SDKs.
3. **Fields updated in real time**:
   - `status`: `running` → `completed`/`error`
   - `current_stage`: Current stage (`SEARCH`, `BRIGHTDATA`, `LLM_FIT`)
   - `completed_stages`: Ordered array of finished stages
   - `overall_progress`: Percentage (25/50/75/100)
   - `error_message`: Present if a stage fails
4. **Read final output** – when `status === 'completed'`, fetch the final stage document (e.g., `{pipeline_id}_LLM_FIT`).

```javascript
import { doc, onSnapshot } from 'firebase/firestore';

const ref = doc(db, 'search_pipeline_runs', pipelineId);
const unsubscribe = onSnapshot(ref, (snapshot) => {
  if (!snapshot.exists()) return;
  const status = snapshot.data();
  renderProgress(status.overall_progress, status.current_stage);
  if (status.status === 'completed') {
    loadFinalResults(pipelineId);
    unsubscribe();
  } else if (status.status === 'error') {
    showError(status.error_message);
    unsubscribe();
  }
});
```

**Progress breakdown**: `SEARCH` ≈ 33 %, `BRIGHTDATA` ≈ 66 %, `LLM_FIT` = 100 %. Skipped stages still update progress so the overall status reaches 100 % once the pipeline finishes.

**Standalone stages**: Each stage Cloud Function (`search_stage`, `brightdata_stage`, `llm_fit_stage`, plus the legacy `rerank_stage` for targeted testing) can run independently for debugging and always updates the shared status document so Firestore listeners stay accurate even outside the orchestrator flow.

## Firestore Integration
The orchestrated pipeline persists every stage hand-off in Firestore so clients can observe progress without polling Cloud Functions directly.

**Key features**
- Each stage writes its output to `search_pipeline_runs` via `save_stage_document()`, keyed by `pipeline_id` and `stage`.
- Subsequent stages read previous output with `read_stage_document()`/`read_stage_profiles()` to avoid recomputing expensive work.
- `create_pipeline_status()` and `update_pipeline_status()` keep `search_pipeline_runs/{pipeline_id}` updated for real-time subscriptions.
- TTL timestamps keep documents short-lived while the cleanup scheduler prevents unbounded growth.
- `_set_document()` centralizes atomic writes so concurrent stages cannot clobber each other.

**Collection layout**
- Collection: `search_pipeline_runs`
- Pipeline status document ID: `{pipeline_id}` – contains `status`, `current_stage`, `overall_progress`, timestamps, and error info.
- Stage document ID: `{pipeline_id}_{STAGE_NAME}` – contains serialized `profiles`, `debug`, `metadata`, and `status` for SEARCH/BRIGHTDATA/LLM_FIT.

**Client integration**
- Subscribe to `search_pipeline_runs/{pipeline_id}` to mirror `overall_progress`, `current_stage`, and `completed_stages` in UI components.
- Fetch `{pipeline_id}_LLM_FIT` (or any other stage doc) once the pipeline completes to display final creator results.

**Security**
- Firestore rules limit reads to authenticated users and block all client writes; only Cloud Functions (Admin SDK) write documents.
- Each document includes a `userId` field so security rules can enforce per-user isolation.

**Cleanup**
- `cleanup_expired_pipelines` runs hourly via Cloud Scheduler and deletes any document with `ttl < now()` in batches to stay within Firestore write quotas.
- See `FIRESTORE_SCHEMA.md` for the full schema, query patterns, and operational guidance.

## Debug Mode and Testing
### Debug Mode
All orchestrated and standalone stages accept a `debug_mode` flag that enables verbose metrics, timing traces, and sanitized debug payloads without breaking backwards compatibility (new response fields are optional).

- **Enable debug mode** by adding `"debug_mode": true` to any request payload:
  ```json
  {
    "pipeline_id": "test-pipeline-123",
    "search": {"query": "beauty influencers", "limit": 10},
    "debug_mode": true
  }
  ```
- **Features** include per-stage timing breakdowns, input/output payload sizing, API stats, and sample responses when available (e.g., BrightData chunk summaries, LLM fit assessments).
- **Security**: `sanitize_debug_output()` removes API keys, tokens, and truncates long strings to 500 characters so sensitive values never hit Firestore or responses.

### Test Mode (Emulator)
When running inside the Firebase emulator (`FUNCTIONS_EMULATOR=true`) with `debug_mode` enabled, callable functions skip auth checks and use the synthetic user `test-user` to accelerate local testing.

1. Start the emulator: `firebase emulators:start --only functions,firestore`.
2. Call any stage via `firebase functions:shell`:
   ```bash
   > search_stage({data: {pipeline_id: "test-123", search: {query: "beauty", limit: 5}, debug_mode: true}})
   ```
3. Watch logs for `TEST MODE` warnings so you know requests bypassed authentication.

### Test Helpers
Use `functions/test_helpers.py` to generate mock profiles, payloads, and callable-style requests without bootstrapping Firestore data:

```python
from test_helpers import build_brightdata_stage_payload, generate_test_profiles

profiles = generate_test_profiles(10)
payload = build_brightdata_stage_payload("test-pipeline", debug_mode=True)
```

Helpers exist for every stage as well as `create_test_pipeline_request()` for end-to-end orchestrator invocations.

### Timing Metrics
Every stage logs and stores timing data when debug mode is enabled. Responses include a `timing` field with sub-operation timings (e.g., `search_stage_total`, `brightdata_api_calls`, `llm_api_calls`). The orchestrator also returns a `debug_summary` containing the total pipeline duration and per-stage metrics.

### Input/Output Size Tracking
Stage responses now expose `input_size` and `output_size` dictionaries that describe profile counts, estimated payload bytes, and high-level content flags (bios/posts present). Use these metrics to spot bloated payloads or skewed intermediate results.

### Structured Logging
All stages log structured messages that include `pipeline_id`, stage names, counts, durations, and debug mode flags. Filter logs with commands such as `firebase functions:log | grep "debug_mode=True"` to isolate verbose runs.

### Testing Individual Stages
- **Search stage**: `> search_stage({data: {..., debug_mode: true}})`
- **Rerank stage**: `> rerank_stage({data: {..., debug_mode: true}})`
- **BrightData stage**: `> brightdata_stage({data: {..., debug_mode: true}})`
- **LLM fit stage**: `> llm_fit_stage({data: {..., debug_mode: true}})`

Each function reads its upstream Firestore document, so you can seed emulator documents once and repeatedly test downstream logic.

### Debugging Tips
- Look for operations with `duration_ms > 1000` inside the `timing` blocks to locate bottlenecks.
- Compare `input_size.estimated_bytes` vs `output_size.estimated_bytes` to confirm filters are behaving as expected.
- Enable Python's verbose logging locally (`logging.basicConfig(level=logging.DEBUG)`) to surface progress callbacks.
- When API errors occur, review the `debug` payload inside the corresponding stage document—error summaries and sample responses are included automatically.

## Architecture Details
### Cold Start Flow
1. Instance boots and initializes Firebase Admin in `main.py`.
2. `WeaviateSearchStage` wires up the Weaviate client, DeepInfra embedding session, and `QueryExpansionService` once per instance.
3. Pipeline components (reranker, BrightData poller, LLM scoring) are created once per instance.

### Warm Start Flow
- Cached HTTP session + pipeline objects are reused, keeping latency sub‑second for most requests.

### Pipeline Stages
1. **Search**: Hosted API call with Weaviate hybrid search + filtering.
2. **BrightData** (optional): Dataset enrichment for social profiles.
3. **LLM Fit Scoring** (optional): OpenAI-powered evaluation of campaign fit.

```
Client → search_pipeline_orchestrator
        ↓ create search_pipeline_runs/{pipeline_id}
SEARCH stage  → writes {pipeline_id}_SEARCH   → status 33 %
BRIGHTDATA    → writes {pipeline_id}_BRIGHTDATA → status 66 %
LLM_FIT       → writes {pipeline_id}_LLM_FIT  → status 100 %
        ↓ client listens to search_pipeline_runs/{pipeline_id}
        ↓ fetch final stage document on completion
```

## Early Stopping

### Stop at Stage Parameter

Add `stop_at_stage` to any `SearchPipelineRequest` payload to short-circuit the pipeline once a stage completes:

```json
{
  "search": {"query": "beauty influencers", "limit": 20},
  "business_fit_query": "sustainable products",
  "stop_at_stage": "BRIGHTDATA"
}
```

### Available Stages

1. **SEARCH** – Vector/text search only (~1‑2 s). Returns raw search results for the fastest preview.
2. **BRIGHTDATA** – Search + enrichment (~20‑30 s). Updates social stats while skipping LLM scoring.
3. **LLM_FIT** – Full pipeline (~30‑60 s). Includes OpenAI scoring and rationales for each profile.

### Default Behavior

If `stop_at_stage` is omitted or explicitly set to `"LLM_FIT"`, all three stages run (backward compatible with existing clients).

### Response Differences

- **Stopped at SEARCH** – `results` contains raw search hits; `brightdata_results` and `profile_fit` remain empty, and `stages` only list SEARCH.
- **Stopped at BRIGHTDATA** – `results` reflects enriched profiles; `brightdata_results` includes API payloads while `profile_fit` stays empty.
- **Full pipeline (LLM_FIT)** – All arrays populate with enriched, scored profiles plus telemetry from every stage.

### Cost Optimization

Early stopping reduces downstream API calls and execution time:

- SEARCH only: Weaviate hybrid search + DeepInfra embeddings (no enrichment/LLM spend).
- BRIGHTDATA: Adds dataset enrichment but skips OpenAI scoring.
- Full pipeline: Includes every external call (Weaviate, DeepInfra, BrightData, OpenAI).

Pick the shallowest stage that answers the user's question to minimize spend and latency.

## Monitoring & Debugging
- Logs: `firebase functions:log --only search_pipeline --limit 100`.
- Google Cloud console → Cloud Functions → Logs for structured metadata.
- Watch for messages about `WeaviateSearchStage initialized` to confirm connectivity on cold starts.
- Enable Cloud Monitoring alerts for high error rates or long durations.

## Performance Optimization
- Use `set_global_options(min_instances=1)` only if Weaviate latency is highly sensitive to cold starts (most deployments stay at 0).
- Right-size memory allocation based on downstream stages (BrightData/LLM) rather than a local database footprint.
- Configure Weaviate/DeepInfra timeouts in `WeaviateClient` if you need longer-running hybrid searches.
- Keep BrightData/LLM stages optional for workloads that only need raw search results.

## Troubleshooting
| Symptom | Fix |
| --- | --- |
| Weaviate connection errors | Verify `WEAVIATE_URL`/`WEAVIATE_API_KEY`, confirm the cluster is reachable, and ensure the service account egress rules allow outbound HTTPS. |
| Embedding generation fails | Confirm `DEEPINFRA_API_KEY`, `DEEPINFRA_BASE_URL`, and embedding model names; look for `DeepInfra embedding request failed` logs. |
| Query expansion errors | Ensure `OPENAI_API_KEY` is configured and that the selected OpenAI model is available in the target region. |
| BrightData requests fail | Confirm dataset IDs and API tokens; inspect `BRIGHTDATA_BASE_URL`. |
| Secrets unavailable | Re-run `firebase functions:secrets:set` and redeploy; confirm decorator `secrets` list includes each key. |

## Cost Considerations
- Cloud Functions invocations (first 2M free / month) + GB-s execution.
- Weaviate cluster usage (managed service or self-hosted) + DeepInfra embeddings usage.
- External API costs (OpenAI, BrightData, DeepInfra) per call; disable optional stages to save costs.
- Use separate Firebase projects or configs to isolate experimentation costs.

## Security
- Callable functions enforce Firebase Auth and rely on backend secret storage.
- The Cloud Functions service account only needs Firestore + Secrets Manager + logging roles; outbound HTTPS to Weaviate/DeepInfra/BrightData is handled automatically (no Cloud Storage permissions required).
- Keep `.env` local only; never commit secrets.

## Related Docs
- `DEPLOYMENT.md`: Complete deployment walkthrough.
- `FIRESTORE_SCHEMA.md`: Detailed schema, indexes, rules, and cleanup notes for `search_pipeline_runs`.
- Firebase Functions docs: https://firebase.google.com/docs/functions

## Support & Contributions
- File issues or feature requests in this repository.
- Keep documentation updated with every deployment change.
