# Search API Endpoint

## Overview
Executes the full creator search pipeline via Cloud Functions, returning scored and enriched creator profiles.

## Endpoint
`POST /api/search`

## Authentication
Requires Firebase Authentication. Include session cookie or Authorization header.

## Request Format

**Content-Type:** `application/json`

**Body:** `SearchPipelineRequest`

### Required Fields
- `search.query` (string) - Search query for creators
- `business_fit_query` (string) - Business brief for LLM scoring

### Optional Fields
- `search.method` (string) - Search mode: 'lexical', 'semantic', or 'hybrid' (default: 'hybrid')
- `search.limit` (number) - Max results (default: 20, range: 1-50000)
- `search.min_followers` (number) - Minimum follower count filter
- `search.max_followers` (number) - Maximum follower count filter
- `search.min_engagement` (number) - Minimum engagement rate filter
- `search.max_engagement` (number) - Maximum engagement rate filter
- `search.location` (string) - Location filter
- `search.category` (string) - Category filter
- `search.is_verified` (boolean) - Verified account filter
- `search.is_business_account` (boolean) - Business account filter
- `search.lexical_scope` (string) - Lexical search scope: 'bio' or 'bio_posts' (default: 'bio')
- `max_profiles` (number) - Max profiles to process
- `max_posts` (number) - Max posts to analyze per profile (default: 6)
- `model` (string) - OpenAI model for LLM scoring (default: 'gpt-5-mini')
- `verbosity` (string) - LLM prompt verbosity (default: 'medium')
- `concurrency` (number) - Concurrent LLM API calls (default: 64)
- `debug_mode` (boolean) - Enable debug output (default: false)
- `stop_at_stage` (string) - Stop pipeline after this stage: 'SEARCH', 'BRIGHTDATA', or 'LLM_FIT' (default: run all stages)

> **Note:** Pipeline identifiers are generated on the server for tracking and cannot be supplied in the request payload.

### Example Request
```json
{
  "search": {
    "query": "beauty influencers in Los Angeles",
    "method": "hybrid",
    "limit": 20,
    "min_followers": 10000,
    "max_followers": 100000,
    "location": "Los Angeles"
  },
  "business_fit_query": "Looking for beauty influencers who focus on sustainable and eco-friendly products",
  "max_posts": 6,
  "debug_mode": false
}
```

## Early Stopping

You can stop the pipeline at any stage to get faster results that fit your budget.

**Stop after search (fastest, ~1-2s):**
```json
{
  "search": {
    "query": "beauty influencers",
    "limit": 20
  },
  "business_fit_query": "sustainable beauty",
  "stop_at_stage": "SEARCH"
}
```
**Stop after BrightData (~20-30s):**
```json
{
  "search": {"query": "beauty influencers"},
  "business_fit_query": "sustainable beauty",
  "stop_at_stage": "BRIGHTDATA"
}
```
Returns enriched profiles with fresh data but no LLM fit scores.

**Run all stages (default, ~30-60s):**
```json
{
  "search": {"query": "beauty influencers"},
  "business_fit_query": "sustainable beauty"
  // stop_at_stage omitted or set to "LLM_FIT"
}
```
Returns fully scored and ranked results.

**Use Cases:**
- Quick preview: Use `SEARCH` for fast initial results.
- Fresh data only: Use `BRIGHTDATA` to get updated profiles without LLM costs.
- Full analysis: Omit `stop_at_stage` for complete scoring.

## Response Format

**Content-Type:** `application/json`

**Body:** `SearchPipelineResponse`

### Fields
- `success` (boolean) - Whether the pipeline completed successfully
- `results` (array) - Array of creator profile objects, sorted by fit score
- `brightdata_results` (array) - Raw BrightData API responses
- `profile_fit` (array) - Detailed LLM fit assessments
- `stages` (array) - Pipeline stage events for debugging
- `count` (number) - Number of results returned
- `pipeline_id` (string) - Pipeline execution ID for tracking
- `pipeline_status_path` (string) - Firestore path to pipeline status document
- `debug_summary` (object) - Debug information (only if debug_mode=true)

### Example Response
```json
{
  "success": true,
  "results": [
    {
      "lance_db_id": "abc123",
      "account": "beauty_influencer",
      "profile_url": "https://instagram.com/beauty_influencer",
      "followers": 50000,
      "avg_engagement": 3.5,
      "biography": "Beauty & skincare enthusiast",
      "fit_score": 85,
      "fit_rationale": "Strong alignment with sustainable beauty focus..."
    }
  ],
  "brightdata_results": ["..."],
  "profile_fit": ["..."],
  "stages": [
    {"stage": "SEARCH", "data": {"...": "..."}},
    {"stage": "BRIGHTDATA", "data": {"...": "..."}},
    {"stage": "LLM_FIT", "data": {"...": "..."}}
  ],
  "count": 15,
  "pipeline_id": "1699564800a1b2c3d4e5f6"
}
```

## Error Responses

### 400 Bad Request
**Code:** `INVALID_PAYLOAD`
**Message:** Request body validation failed
**Details:** Lists missing or invalid fields

### 401 Unauthorized
**Code:** `AUTH_REQUIRED`
**Message:** You must be signed in to access this resource

### 502 Bad Gateway
**Code:** `FUNCTION_ERROR`
**Message:** Cloud Function invocation failed
**Details:** Error details from the Cloud Function

### Example Error Response
```json
{
  "error": {
    "code": "INVALID_PAYLOAD",
    "message": "Request body must include 'search.query' and 'business_fit_query'",
    "hint": "Ensure both fields are non-empty strings",
    "details": {
      "missing_fields": ["business_fit_query"]
    }
  }
}
```

## Pipeline Stages

The endpoint executes three stages sequentially:

1. **Search Stage** - Vector/text search via external API at `https://pen.optimat.us/search/`
2. **BrightData Stage** - Enriches profiles with fresh data from Instagram/TikTok
3. **LLM Fit Stage** - Scores profiles against the business brief using OpenAI

Each stage writes intermediate results to Firestore for debugging and progress tracking.

## Real-time Progress Tracking

Clients can subscribe to Firestore for real-time pipeline progress:

```ts
import { doc, onSnapshot } from 'firebase/firestore';

const unsubscribe = onSnapshot(
  doc(firestore, 'search_pipeline_runs', pipelineId),
  (snapshot) => {
    const status = snapshot.data();
    console.log('Progress:', status.overall_progress);
    console.log('Current stage:', status.current_stage);
  }
);
```

## Performance

- **SEARCH stage only:** ~1-2s
- **SEARCH + BRIGHTDATA:** ~20-30s
- **Full pipeline (all stages):** ~30-60s depending on result count and API latency
- **Cold start:** ~1-2s (no dataset download required)
- **Warm start:** <1s
- **Timeout:** 600s (10 minutes)

## Rate Limits

No explicit rate limits, but consider:
- OpenAI API rate limits (concurrency=64 by default)
- BrightData API quotas
- Cloud Functions concurrent execution limits

## Testing

Use the Firebase emulator for local testing:

```bash
firebase emulators:start --only functions,firestore
curl -X POST http://localhost:5001/api/search \
  -H "Content-Type: application/json" \
  -d '{"search": {"query": "beauty", "limit": 5}, "business_fit_query": "sustainable products"}'
```

### Unaudited Stage Test Endpoint (Dev Only)

For quick manual checks without authentication, call `POST /api/public/test-search`. The endpoint runs the pipeline sequentially, stopping after each stage and reporting whether it succeeded.

**Request body (all fields optional):**

```json
{
  "stages": ["SEARCH", "BRIGHTDATA", "LLM_FIT"],
  "include_raw": false,
  "search": {
    "query": "sustainable beauty creators",
    "limit": 10
  },
  "business_fit_query": "Looking for sustainable beauty influencers for a holiday campaign"
}
```

- `stages` – Optional subset of stage names to test (defaults to all in order).
- `include_raw` – When `true`, the response includes each callable's full JSON envelope (can be large).
- Any `SearchPipelineRequest` fields not supplied fall back to sensible defaults geared toward testing.

**Response shape:**

```json
{
  "stages": ["SEARCH", "BRIGHTDATA"],
  "results": [
    {
      "stage": "SEARCH",
      "status": 200,
      "ok": true,
      "duration_ms": 1420.5,
      "response_summary": {
        "success": true,
        "result_count": 20,
        "stages_returned": ["SEARCH"],
        "brightdata_results": 0,
        "profile_fit": 0,
        "pipeline_id": "..."
      }
    },
    {
      "stage": "BRIGHTDATA",
      "status": 500,
      "ok": false,
      "duration_ms": 310.2,
      "error": "Function error"
    }
  ]
}
```

The endpoint halts once a stage fails (matching the behavior you would observe manually) so you can triage the first point of failure quickly.

## Related Documentation

- Cloud Functions: `/functions/README.md`
- Firestore Schema: `/functions/FIRESTORE_SCHEMA.md`
- Type Definitions: `/src/lib/types/search.ts`
