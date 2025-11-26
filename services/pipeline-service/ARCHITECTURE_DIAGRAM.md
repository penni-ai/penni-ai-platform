# Pipeline Service Architecture Diagram

## Complete System Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          CLIENT APPLICATION (SvelteKit)                      │
│                                                                               │
│  User initiates pipeline request with:                                       │
│  - business_description                                                       │
│  - top_n (default: 30)                                                       │
│  - uid, campaign_id, platform, follower filters                              │
└───────────────────────────────┬───────────────────────────────────────────────┘
                                │
                                │ POST /pipeline/start
                                │ (HTTP Request)
                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    ORCHESTRATOR ENDPOINT (/pipeline/start)                   │
│                    Cloud Run Service - HTTP Handler                          │
│                                                                               │
│  1. ✅ Pre-flight health checks (all services)                              │
│  2. ✅ Validate request schema (Zod validation)                             │
│  3. ✅ Validate campaign exists (if provided)                                 │
│  4. ✅ Create Firestore job document (status: "pending")                    │
│  5. ✅ Publish message to Pub/Sub topic "pipeline.start"                     │
│  6. ✅ Return 202 Accepted immediately with job_id                           │
│                                                                               │
│  Response Time: < 500ms                                                      │
└───────────────────────────────┬───────────────────────────────────────────────┘
                                │
                                │ Publish Message
                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    PUB/SUB TOPIC: pipeline.start                            │
│                                                                               │
│  Message Format:                                                             │
│  {                                                                           │
│    job_id: "job_123...",                                                    │
│    uid: "user-123",                                                          │
│    business_description: "...",                                             │
│    top_n: 30,                                                                │
│    min_followers, max_followers, platform, campaign_id                      │
│  }                                                                           │
│                                                                               │
│  Features:                                                                   │
│  - 7-day message retention                                                   │
│  - Automatic retry with exponential backoff                                   │
│  - Dead letter queue for failed messages                                     │
└───────────────────────────────┬───────────────────────────────────────────────┘
                                │
                                │ Push Subscription
                                │ (pipeline-worker-sub)
                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                  WORKER ENDPOINT (/pubsub/pipeline-start)                   │
│                    Cloud Run Service - Pub/Sub Handler                      │
│                                                                               │
│  1. ✅ Decode base64 Pub/Sub message                                         │
│  2. ✅ Return 204 No Content immediately (acknowledge message)               │
│  3. ✅ Execute pipeline asynchronously (non-blocking)                       │
└───────────────────────────────┬───────────────────────────────────────────────┘
                                │
                                │ Async Execution
                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        PIPELINE EXECUTION STAGES                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  STAGE 1: QUERY EXPANSION (Progress: 5%)                                    │
│  ──────────────────────────────────────────────────────────────────────────  │
│                                                                               │
│  Service: OpenAI (gpt-4o-mini)                                               │
│  Input: business_description                                                 │
│  Output: 12 optimized search queries                                         │
│    - 4 broad queries                                                         │
│    - 2 specific queries                                                      │
│    - 6 adjacent/related queries                                              │
│                                                                               │
│  Duration: ~2-5 seconds                                                     │
│                                                                               │
│  Updates Firestore:                                                          │
│    - query_expansion.status = "running" → "completed"                       │
│    - query_expansion.queries = [12 queries]                                  │
│    - query_expansion.duration_seconds                                        │
└───────────────────────────────┬───────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  STAGE 2: PARALLEL HYBRID SEARCH (Progress: 25%)                            │
│  ──────────────────────────────────────────────────────────────────────────  │
│                                                                               │
│  Service: Weaviate (Vector Database)                                         │
│  Input: 12 queries × 2 alpha values (0.2, 0.8) = 24 searches                │
│  Output: Deduplicated profile URLs sorted by relevance                      │
│                                                                               │
│  Process:                                                                    │
│    1. Perform 24 parallel hybrid searches                                    │
│    2. Deduplicate results by profile_url                                     │
│    3. Sort by relevance score                                                │
│    4. Filter by platform/followers if specified                              │
│                                                                               │
│  Duration: ~10-30 seconds (with batch embedding generation)                 │
│  Concurrency: MAX_CONCURRENT_WEAVIATE_SEARCHES (default: 12)                 │
│                                                                               │
│  Updates Firestore:                                                          │
│    - weaviate_search.status = "running" → "completed"                       │
│    - weaviate_search.total_results, unique_results                           │
│    - weaviate_search.queries_executed = 24                                   │
│    - weaviate_search.duration_seconds                                        │
└───────────────────────────────┬───────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  STAGE 3: PROFILE EXTRACTION (Progress: 30%)                                │
│  ──────────────────────────────────────────────────────────────────────────  │
│                                                                               │
│  Extract top N profile URLs from search results                              │
│  Filter by platform if specified                                             │
│                                                                               │
│  Output: Array of profile URLs (e.g., top 30)                                │
└───────────────────────────────┬───────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  STAGE 4 & 5: CONCURRENT PROCESSING (Progress: 50% → 100%)                  │
│  ──────────────────────────────────────────────────────────────────────────  │
│                                                                               │
│  ┌──────────────────────────────────┐  ┌──────────────────────────────────┐ │
│  │  STAGE 4: BRIGHTDATA COLLECTION  │  │  STAGE 5: LLM FIT ANALYSIS      │ │
│  │  (Streaming Batches)             │  │  (Concurrent Processing)        │ │
│  │                                  │  │                                  │ │
│  │  Service: BrightData API         │  │  Service: OpenAI (gpt-4o-mini)   │ │
│  │  Input: Profile URLs             │  │  Input: Normalized profiles +    │ │
│  │  Output: Normalized profiles     │  │        business_description      │ │
│  │                                  │  │  Output: Fit scores (0-100),     │ │
│  │  Process:                        │  │        rationale, summary         │ │
│  │  - Process in batches (size: 20) │  │                                  │ │
│  │  - Stream results as batches      │  │  Process:                        │ │
│  │    complete                      │  │  - Analyze profiles concurrently  │ │
│  │  - Update Firestore incrementally│  │  - Max 5 concurrent requests     │ │
│  │                                  │  │  - Overlaps with BrightData      │ │
│  │  Duration: ~5-30 minutes         │  │                                  │ │
│  │  (depends on batch size)         │  │  Duration: Overlaps with         │ │
│  │                                  │  │        BrightData collection    │ │
│  │  Updates Firestore:              │  │                                  │ │
│  │  - brightdata.status = "running" │  │  Updates Firestore:              │ │
│  │  - brightdata.batches_completed  │  │  - llm_analysis.status          │ │
│  │  - brightdata.profiles_collected │  │  - llm_analysis.profiles_analyzed│ │
│  │  - Incremental batch results     │  │  - llm_analysis.duration_seconds │ │
│  └──────────────┬───────────────────┘  └──────────────┬───────────────────┘ │
│                 │                                      │                      │
│                 └──────────────┬───────────────────────┘                      │
│                                │                                              │
│                                ▼                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  STAGE 6: RESULT STORAGE                                              │  │
│  │  ───────────────────────────────────────────────────────────────────  │  │
│  │                                                                        │  │
│  │  Storage: Cloud Storage                                                │  │
│  │    Path: pipeline_jobs/{job_id}/profiles.json                         │  │
│  │    Format: JSON array of profiles with fit scores                     │  │
│  │                                                                        │  │
│  │  Metadata: Firestore                                                   │  │
│  │    Document: pipeline_jobs/{job_id}                                    │  │
│  │    Fields:                                                             │  │
│  │      - status: "completed"                                            │  │
│  │      - overall_progress: 100                                           │  │
│  │      - current_stage: null                                             │  │
│  │      - stage data (queries, results, timing)                           │  │
│  │      - summary statistics                                              │  │
│  │                                                                        │  │
│  │  Final Status Update:                                                  │  │
│  │    - status = "completed"                                              │  │
│  │    - completed_at = timestamp                                          │  │
│  │    - total_duration_seconds                                            │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                          CLIENT POLLING                                      │
│                                                                               │
│  Client polls Firestore document: pipeline_jobs/{job_id}                    │
│                                                                               │
│  Status values:                                                               │
│    - "pending" → Job created, waiting for Pub/Sub                            │
│    - "running" → Pipeline execution in progress                              │
│    - "completed" → All stages finished, results available                    │
│    - "error" → Pipeline failed at some stage                                 │
│    - "cancelled" → Job was cancelled by user                                 │
│                                                                               │
│  Progress tracking:                                                          │
│    - overall_progress: 0-100                                                  │
│    - current_stage: "query_expansion" | "weaviate_search" | ...              │
│    - Stage-specific data (queries, results, timing)                          │
│                                                                               │
│  Download results:                                                            │
│    GET Cloud Storage: pipeline_jobs/{job_id}/profiles.json                   │
└─────────────────────────────────────────────────────────────────────────────┘

## External Services Integration

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         EXTERNAL SERVICES                                    │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   OpenAI     │  │   Weaviate  │  │  BrightData  │  │  DeepInfra   │
│              │  │              │  │              │  │              │
│ - Query      │  │ - Vector     │  │ - Instagram  │  │ - Embeddings │
│   Expansion  │  │   Search     │  │   Profiles   │  │   (Qwen)     │
│              │  │              │  │              │  │              │
│ - LLM        │  │ - Hybrid     │  │ - TikTok     │  │              │
│   Analysis   │  │   Search     │  │   Profiles   │  │              │
│              │  │              │  │              │  │              │
│ Model:       │  │ Collection:  │  │ Datasets:    │  │ Model:       │
│ gpt-4o-mini  │  │ influencer_ │  │ - Instagram  │  │ Qwen/Qwen3-  │
│              │  │ profiles     │  │ - TikTok     │  │ Embedding-8B │
└──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘
```

## GCP Services Integration

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            GCP SERVICES                                      │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  Cloud Run   │  │   Pub/Sub    │  │  Firestore   │  │   Storage    │
│              │  │              │  │              │  │              │
│ - HTTP       │  │ - Topic:     │  │ - Job        │  │ - Results    │
│   Orchestrator│  │   pipeline. │  │   tracking   │  │   storage    │
│              │  │   start      │  │              │  │              │
│ - Pub/Sub    │  │ - Push       │  │ - Status     │  │ - Profiles   │
│   Worker     │  │   Subscription│  │   updates    │  │   JSON       │
│              │  │              │  │              │  │              │
│ - Health     │  │ - Dead       │  │ - Stage      │  │              │
│   Checks     │  │   Letter Q   │  │   progress   │  │              │
└──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘
```

## Error Handling & Retry Logic

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      ERROR HANDLING FLOW                                     │
└─────────────────────────────────────────────────────────────────────────────┘

Pipeline Execution Error:
  │
  ├─→ Update Firestore: status = "error", error_message
  │
  ├─→ Log error with request_id, job_id
  │
  └─→ If Pub/Sub message fails:
        │
        ├─→ Pub/Sub retries (exponential backoff: 10s → 600s)
        │
        ├─→ After 3 retries → Dead Letter Topic (pipeline.failed)
        │
        └─→ Manual replay possible from dead letter queue

Health Check Failure:
  │
  ├─→ Orchestrator: Return 503 Service Unavailable
  │
  └─→ Worker: Update job status = "error", throw error

Job Cancellation:
  │
  ├─→ Check isJobCancelled() at each stage
  │
  ├─→ If cancelled: Update status = "cancelled", return early
  │
  └─→ Clean up in-progress operations
```

## Docker Local Testing Setup

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    DOCKER CONTAINER SETUP                                   │
└─────────────────────────────────────────────────────────────────────────────┘

Container: pipeline-service-test
Port: 8080 (host) → 8080 (container)

Environment Variables:
  - Loaded from .env file
  - All API keys and configuration

Volume Mounts:
  - ~/.config/gcloud → /app/.config/gcloud:ro
    (For GCP credentials/Firestore access)

Health Check:
  GET http://localhost:8080/health
  - Validates all external services
  - Returns 200 if all healthy, 503 if degraded

Endpoints:
  - POST /pipeline/start (HTTP orchestrator)
  - POST /pubsub/pipeline-start (Pub/Sub worker)
  - GET /health (health checks)
```

## Key Design Patterns

1. **Asynchronous Processing**: HTTP orchestrator returns immediately, pipeline runs in background
2. **Pub/Sub Decoupling**: Separates job creation from execution, enables retries and scaling
3. **Streaming Processing**: BrightData batches processed incrementally for better UX
4. **Concurrent Stages**: LLM analysis overlaps with BrightData collection for efficiency
5. **Progress Tracking**: Real-time updates to Firestore for client polling
6. **Error Recovery**: Comprehensive error handling with dead letter queue
7. **Health Checks**: Pre-flight validation before starting pipeline
8. **Cancellation Support**: Jobs can be cancelled mid-execution

## Performance Characteristics

- **Orchestrator Response**: < 500ms (synchronous, fast)
- **Query Expansion**: ~2-5 seconds
- **Hybrid Search**: ~10-30 seconds (24 parallel searches)
- **BrightData Collection**: ~5-30 minutes (depends on batch size)
- **LLM Analysis**: Overlaps with BrightData (concurrent)
- **Total Pipeline**: ~5-30 minutes (dominated by BrightData)

## Scalability

- **Cloud Run**: Auto-scales based on request volume
- **Pub/Sub**: Handles high message throughput
- **Concurrent Processing**: Configurable concurrency limits
- **Batch Processing**: Efficient API usage with batching

