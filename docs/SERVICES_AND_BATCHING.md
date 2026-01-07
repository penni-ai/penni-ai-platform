# Services and Pipeline Batching Overview

This document summarizes the services used in Penny Platform, why each service exists, how the pipeline subdivides work and data, and the expected time savings from the current pipeline design.

## Service catalog (what and why)

### Core app and platform

- Firebase App Hosting (Cloud Run) - hosts the SvelteKit app with server-side routes, auth session handling, and API endpoints.
- Firebase Authentication - client auth (email/password + Google) and server auth via Admin SDK.
- Firestore - primary datastore for users, campaigns, pipeline jobs, subscriptions, usage, and realtime status updates.
- Cloud Storage (Firebase Storage bucket) - large pipeline payloads (candidates, progressive results, final results) and batch artifacts.

### Pipeline execution

- Cloud Run: pipeline-service - single service that exposes the HTTP orchestrator and the background worker.
- Cloud Tasks: queues `pipeline-stage`, `pipeline-batch`, `pipeline-poll` - decouples job creation from execution and provides retries + rate limits.
- Secret Manager - stores API keys for OpenAI, Weaviate, DeepInfra, BrightData (used by pipeline-service).

### Search and enrichment providers

- Weaviate - vector/hybrid search over indexed influencer profiles.
- DeepInfra - embedding API used to generate vectors for Weaviate searches.
- BrightData - social profile collection (Instagram, TikTok).
- OpenAI - query expansion and fit analysis (LLM scoring).

### Billing and email

- Stripe - subscriptions, plan limits, and billing events.
- Gmail API (OAuth) - sending email on behalf of user accounts.
- Cloud Scheduler - triggers the email queue processing endpoint on a schedule.

### Supporting services

- Cloud Logging/Monitoring - logs and metrics for Cloud Run and pipeline execution.
- Cloud Build - builds and deploys pipeline-service (and App Hosting deployments).

## Pipeline batching and data subdivision

The pipeline is designed to return fast previews, stream progressive results, and stop early when it already has enough perfect matches.

### Candidate pool sizing

- Query expansion generates 12 queries (broad + specific + adjacent).
- Weaviate runs parallel hybrid searches across all queries.
- Candidate pool size is derived as:
  - `weaviate_top_n = max(500, top_n * 4)`
- This ensures enough headroom for dedupe, filtering, and early-stop behavior.

### Cache-first + BrightData batching

1. Pull cached profiles first from Firestore `brightdata_cache`.
2. Normalize and LLM-score cached profiles immediately.
3. If still short of `top_n` perfect matches, start BrightData batches for cache misses.

Batching rules (current worker):

- Batch size: 20 urls per batch.
- Concurrency: up to 5 batches in flight (about 100 urls at once).
- LLM concurrency: capped at 100 profiles at a time.
- Early stop: when `top_n` profiles with `fit_score >= 100` (10/10) are found.

### Storage subdivision (large payloads)

Per job, Storage is used for files that are too large for Firestore:

- `pipeline_jobs/{job_id}/candidates.json`
  - Preliminary Weaviate candidates for early UI preview.
- `pipeline_jobs/{job_id}/profiles_batch_{i}.json`
  - One file per BrightData or cache batch, written incrementally.
- `pipeline_jobs/{job_id}/profiles_progressive.json`
  - Progressive top-N, updated after every batch.
- `pipeline_jobs/{job_id}/profiles.json`
  - Final merged results after completion.
- `pipeline_jobs/{job_id}/profiles_remaining.json`
  - Remaining (non-top-N) profiles for optional "find more" use.

Firestore `pipeline_jobs/{job_id}` keeps status, counters, and pointers:

- `current_stage`, `overall_progress`
- `weaviate_search` and `brightdata_collection` metadata
- `batches_completed`, `total_batches`, `batches_failed`
- storage paths for candidates, progressive results, final results, remaining results
- cost stats (BrightData + OpenAI)

### Data flow summary (simplified)

1. `POST /pipeline/start` creates a Firestore job and enqueues a stage task.
2. Task handlers execute the pipeline in stages.
3. Firestore is updated continuously; Storage holds large arrays.
4. The UI listens to Firestore and fetches Storage payloads via `/api/pipeline/{job_id}`.

## Expected time savings (model and examples)

These are estimates based on the current batching rules and stop conditions. Actual times vary with BrightData latency, cache hit rate, and LLM throughput.

### Simplified timing model

- Let `B` be total BrightData batches needed (uncached only).
- Batch size is fixed at 20.
- In-flight concurrency is 5.
- Average BrightData snapshot time is `T_bd` seconds.

Estimated BrightData duration:

```
brightdata_time ~= ceil(B / 5) * T_bd
```

The early-stop rule reduces `B` once enough 10/10 fits are found.

### Example scenarios (replace T_bd with real data)

Assume:

- `top_n = 100` -> `weaviate_top_n = 500`
- `T_bd = 90s` (example)
- Max concurrency = 5 batches

Scenario A - No cache, full pool:

- 500 candidates -> 25 batches
- `ceil(25/5) * 90s = 5 * 90s = ~7.5 min`
- Sequential (no concurrency) would be ~37.5 min
- Expected savings vs sequential: ~30 min (about 80%)

Scenario B - 50% cache hits:

- 12-13 BrightData batches remain
- `ceil(13/5) * 90s = 3 * 90s = ~4.5 min`
- Expected savings vs no cache: ~3 min (about 40%)

Scenario C - Early stop after 10 batches:

- `ceil(10/5) * 90s = 2 * 90s = ~3 min`
- Expected savings vs full pool: ~4.5 min (about 60%)

### Summary of where the time savings come from

- Cache-first execution eliminates BrightData calls for repeated profiles.
- Early stop avoids processing the full candidate pool when enough 10/10s are found.
- Fixed batch size + in-flight cap keeps throughput predictable without overloading BrightData or LLM limits.

## Implementation pointers

Key files for reference:

- Pipeline architecture: `services/pipeline-service/ARCHITECTURE.md`
- Worker batching logic: `services/pipeline-service/src/handlers/worker.ts`
- Orchestrator + Tasks: `services/pipeline-service/src/handlers/orchestrator.ts`
- Firestore + Storage schema helpers: `services/pipeline-service/src/utils/firestore-tracker.ts`
- App pipeline API bridge: `src/routes/api/search/influencers/+server.ts`
- Pipeline result loader: `src/routes/api/pipeline/[pipelineId]/+server.ts`
