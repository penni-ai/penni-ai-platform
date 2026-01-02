# Pipeline Architecture (Cloud Tasks)

This document describes the current pipeline architecture. All background work is executed via Cloud Tasks.

## Current flow

```text
Client (SvelteKit)
  -> POST /pipeline/start
Cloud Run (pipeline-service orchestrator)
  -> Firestore: pipeline_jobs/{job_id}
  -> Cloud Tasks: enqueue /tasks/pipeline-stage

/tasks/pipeline-stage
  -> query expansion + Weaviate search
  -> store candidates
  -> create per-batch Firestore docs
  -> enqueue /tasks/pipeline-batch for each batch

/tasks/pipeline-batch (per batch)
  - cache batch: analyze immediately
  - brightdata batch: trigger snapshot if slot available
  -> enqueue /tasks/pipeline-poll for snapshot tracking

/tasks/pipeline-poll (per batch)
  -> poll BrightData snapshot
  -> download + cache + analyze
  -> write batch results and update counters
  -> finalize if complete/early-stopped
```

## Key properties

- Work is split into short, idempotent tasks.
- Parallelism comes from Cloud Tasks queues and Cloud Run autoscaling.
- Batches are tracked in Firestore under `pipeline_jobs/{job_id}/batches/{batch_id}`.
- Early stop and cancellation are enforced via Firestore flags:
  - `good_fit_count`, `stop_requested`, `cancel_requested`
- Finalization merges batch results once:
  - `batches_completed + batches_failed == total_batches`
  - or `stop_requested == true`

## Batching and stop condition

- BrightData batches: 20 URLs each.
- Max in flight: 5 (controlled by `BRIGHTDATA_MAX_IN_FLIGHT` and queue limits).
- LLM max concurrency: 100.
- Early stop: stop once `top_n` profiles with `fit_score >= 100` (10/10) are found.

## Config flags

**Cloud Tasks**
- `PIPELINE_TASKS_BASE_URL`
- `CLOUD_TASKS_LOCATION`
- `CLOUD_TASKS_SERVICE_ACCOUNT_EMAIL`
- `CLOUD_TASKS_OIDC_AUDIENCE`
- `PIPELINE_TASKS_QUEUE_STAGE`
- `PIPELINE_TASKS_QUEUE_BATCH`
- `PIPELINE_TASKS_QUEUE_POLL`

## Testing

- Stage/batch/poll task endpoints can be invoked directly.
- Cloud Tasks emulator can be used for full queue behavior.
