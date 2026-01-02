# Pipeline Service Logging

This service uses structured JSON logs tailored for Google Cloud Logging. The goal is to keep logs searchable, consistent, and low‑noise while still capturing the full pipeline timeline.

## Schema
Every log entry includes:
- `timestamp` (ISO 8601)
- `severity` (`DEBUG`, `INFO`, `WARN`, `ERROR`)
- `service` (`pipeline-service`)
- `component` (module name, e.g. `worker`, `tasks`, `brightdata`)
- `message` (short, stable identifier)

Recommended context fields (use when available):
- `request_id`
- `job_id`
- `batch_id`
- `snapshot_id`
- `uid`
- `campaign_id`

Cloud Logging trace fields (auto‑parsed when `x-cloud-trace-context` is present):
- `logging.googleapis.com/trace`
- `logging.googleapis.com/spanId`
- `logging.googleapis.com/trace_sampled`

## Levels
- `DEBUG`: per‑batch or high‑volume detail (cache stats, batch timings, polling loops)
- `INFO`: stage boundaries, batch summaries, pipeline start/finish, costs
- `WARN`: recoverable issues (partial failures, fallbacks, retries)
- `ERROR`: unrecoverable failures or terminal errors

## Redaction
Do not log secrets, tokens, or full API keys. Log lengths or masked identifiers instead.

## Request logging
Every HTTP request is logged once on completion with:
- `status`
- `duration_ms`
- `httpRequest` fields (method, URL, user agent, latency)

## Final run summary
The pipeline emits a single summary log per job with:
- status
- duration
- stage durations
- cost totals
- batch totals

## Usage
Use `createLogger()` from `services/pipeline-service/src/utils/logger.ts` and attach job/batch context early.

Example:
```
const logger = createLogger({ component: 'worker', job_id, request_id });
logger.info('pipeline_start', { uid, campaign_id });
```

## Local config
Set `LOG_LEVEL` in `.env` to control verbosity:
- `debug` (dev)
- `info` (prod)
- `warn`
- `error`
