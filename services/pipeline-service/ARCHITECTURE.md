# Pipeline Service Architecture

## Overview

The Pipeline Service is a **monolithic Cloud Run service** that combines HTTP orchestration and Pub/Sub-triggered background processing into a single application. This architecture provides fast response times for job creation while enabling long-running asynchronous pipeline execution.

## Architecture Pattern: Orchestrator-Worker with Pub/Sub

```
┌─────────────────┐
│  Client App     │
│  (SvelteKit)   │
└────────┬────────┘
         │ HTTP POST /pipeline/start
         │ (with business_description, top_n, etc.)
         ▼
┌─────────────────────────────────────────┐
│  Cloud Run Service (Monolithic)         │
│  ┌───────────────────────────────────┐ │
│  │  ORCHESTRATOR                     │ │
│  │  POST /pipeline/start             │ │
│  │  - Validates request              │ │
│  │  - Creates Firestore job          │ │
│  │  - Publishes to Pub/Sub           │ │
│  │  - Returns 202 Accepted           │ │
│  └──────────────┬────────────────────┘ │
│                 │                       │
│                 │ Publishes message     │
│                 ▼                       │
│  ┌──────────────────────────────────┐  │
│  │  Google Cloud Pub/Sub             │  │
│  │  Topic: pipeline.start           │  │
│  └──────────────┬───────────────────┘  │
│                 │                       │
│                 │ Triggers via push     │
│                 │ subscription          │
│                 ▼                       │
│  ┌──────────────────────────────────┐  │
│  │  WORKER                          │  │
│  │  POST /pubsub/pipeline-start     │  │
│  │  - Decodes Pub/Sub message       │  │
│  │  - Executes full pipeline        │  │
│  │  - Updates Firestore status     │  │
│  │  - Returns 204 immediately       │  │
│  └──────────────────────────────────┘  │
└─────────────────────────────────────────┘
         │
         │ Updates job status
         ▼
┌─────────────────┐
│   Firestore     │
│   (Job metadata)│
└─────────────────┘
         │
         │ Stores large results
         ▼
┌─────────────────┐
│ Cloud Storage   │
│ (Profile data)  │
└─────────────────┘
```

## Components

### 1. Orchestrator (`/pipeline/start`)

**Purpose**: Fast HTTP endpoint that accepts pipeline requests and queues them for processing.

**Responsibilities**:
- ✅ **Request Validation**: Validates input using Zod schema
- ✅ **Business Logic Validation**: Checks campaign existence, follower bounds
- ✅ **Job Creation**: Creates Firestore document with job metadata
- ✅ **Pub/Sub Publishing**: Publishes message to trigger background processing
- ✅ **Fast Response**: Returns `202 Accepted` immediately (typically < 500ms)

**Flow**:
```
1. Receive HTTP POST /pipeline/start
2. Validate request body (Zod schema)
3. Validate campaign exists (if campaign_id provided)
4. Validate follower bounds (if provided)
5. Create Firestore job document (status: "pending")
6. Publish message to Pub/Sub topic "pipeline.start"
7. Return 202 Accepted with job_id
```

**Key Characteristics**:
- **Synchronous**: Waits for Firestore write and Pub/Sub publish
- **Fast**: Completes in < 500ms typically
- **Idempotent**: Can be retried safely (creates new job each time)
- **Non-blocking**: Doesn't wait for pipeline execution

### 2. Pub/Sub Topic (`pipeline.start`)

**Purpose**: Decouples job creation from job execution, enabling:
- Asynchronous processing
- Retry handling
- Scalability (multiple workers can process messages)
- Reliability (messages persist if service is down)

**Message Format**:
```json
{
  "job_id": "job_1234567890_abc123",
  "uid": "user-123",
  "campaign_id": "campaign-456",
  "business_description": "coffee shop in San Francisco",
  "top_n": 30,
  "min_followers": 10000,
  "max_followers": 1000000,
  "platform": "instagram",
  "request_id": "req_1234567890_xyz789"
}
```

**Delivery**:
- Push subscription to Cloud Run endpoint `/pubsub/pipeline-start`
- Pub/Sub automatically retries failed deliveries
- Messages are acknowledged with `204 No Content`

### 3. Worker (`/pubsub/pipeline-start`)

**Purpose**: Executes the full pipeline asynchronously when triggered by Pub/Sub.

**Responsibilities**:
- ✅ **Message Parsing**: Decodes base64 Pub/Sub message
- ✅ **Pipeline Execution**: Runs all 5 pipeline stages
- ✅ **Status Updates**: Updates Firestore with progress
- ✅ **Error Handling**: Catches errors and updates job status
- ✅ **Quick Acknowledgment**: Returns `204` immediately (doesn't await pipeline)

**Flow**:
```
1. Receive Pub/Sub push notification
2. Decode base64 message data
3. Parse JSON payload
4. Return 204 immediately (acknowledge message)
5. Execute pipeline asynchronously:
   a. Query Expansion (OpenAI)
   b. Parallel Hybrid Search (Weaviate)
   c. Extract Top N Profiles
   d. BrightData Collection (streaming batches)
   e. LLM Analysis (concurrent)
6. Store results in Firestore + Cloud Storage
7. Update job status to "completed"
```

**Key Characteristics**:
- **Asynchronous**: Pipeline runs in background after acknowledging message
- **Long-running**: Can take 5-30 minutes depending on batch size
- **Resilient**: Errors are caught and logged, job status updated
- **Cancellable**: Checks for cancellation at each stage
- **Progress Tracking**: Updates Firestore with stage progress

## Pipeline Stages (Worker Execution)

### Stage 1: Query Expansion (5% progress)
- **Service**: OpenAI (gpt-4o-mini)
- **Input**: Business description
- **Output**: 12 search queries (4 broad + 2 specific + 6 adjacent)
- **Duration**: ~2-5 seconds
- **Updates**: `query_expansion` stage in Firestore

### Stage 2: Parallel Hybrid Search (25% progress)
- **Service**: Weaviate (vector database)
- **Input**: 12 queries × 2 alpha values (0.2, 0.8) = 24 searches
- **Output**: Deduplicated profile URLs sorted by relevance
- **Duration**: ~10-30 seconds
- **Updates**: `weaviate_search` stage in Firestore

### Stage 3: Extract Top N Profiles
- **Logic**: Filters and extracts top N profile URLs
- **Output**: Array of Instagram/TikTok profile URLs
- **Duration**: < 1 second

### Stage 4: BrightData Collection (50% progress)
- **Service**: BrightData API
- **Input**: Top N profile URLs
- **Output**: Detailed profile data (followers, posts, engagement, etc.)
- **Duration**: ~5-20 minutes (depends on batch size)
- **Pattern**: Streaming batches (processes as data becomes available)
- **Updates**: `brightdata_collection` stage in Firestore

### Stage 5: LLM Analysis (60% progress)
- **Service**: OpenAI (gpt-4o-mini)
- **Input**: Normalized profiles + business description
- **Output**: Fit scores, rationale, summaries for each profile
- **Duration**: ~2-10 minutes (concurrent batch processing)
- **Updates**: `llm_analysis` stage in Firestore

### Finalization
- **Storage**: Results stored in Cloud Storage (large data) + Firestore (metadata)
- **Status**: Job status updated to "completed"
- **Progress**: Finalized at 100%

## Why This Architecture?

### Benefits

1. **Fast Response Times**
   - Orchestrator returns in < 500ms
   - Client doesn't wait for long-running pipeline

2. **Scalability**
   - Multiple Cloud Run instances can process Pub/Sub messages
   - Pub/Sub handles message distribution
   - Worker can scale independently

3. **Reliability**
   - Pub/Sub retries failed messages
   - Job status tracked in Firestore
   - Errors don't crash the service

4. **Observability**
   - Job status visible in Firestore
   - Progress tracking at each stage
   - Detailed logging for debugging

5. **Cost Efficiency**
   - Single service (simpler than separate functions)
   - Pay only for execution time
   - No idle costs

### Trade-offs

1. **Monolithic Service**
   - ✅ Simpler deployment and management
   - ✅ Shared code and dependencies
   - ❌ Can't scale orchestrator and worker independently
   - ❌ Both share same resource limits

2. **Pub/Sub Push**
   - ✅ Automatic retries
   - ✅ Decoupled architecture
   - ❌ Requires public endpoint (Cloud Run handles this)
   - ❌ Message acknowledgment complexity

## Request/Response Flow

### Client Request
```http
POST /pipeline/start
Content-Type: application/json

{
  "business_description": "coffee shop in San Francisco",
  "top_n": 30,
  "uid": "user-123",
  "min_followers": 10000,
  "max_followers": 1000000,
  "platform": "instagram"
}
```

### Orchestrator Response (202 Accepted)
```json
{
  "job_id": "job_1763585287849_wdg3d93",
  "status": "accepted",
  "message": "Pipeline job accepted and processing in background",
  "request_id": "req_1763585287849_ys6llbz"
}
```

### Client Polling
```http
GET /firestore/pipeline_jobs/{job_id}
```

Response:
```json
{
  "status": "running",
  "progress": 45,
  "current_stage": "brightdata_collection",
  "stages": {
    "query_expansion": { "status": "completed", ... },
    "weaviate_search": { "status": "completed", ... },
    "brightdata_collection": { "status": "running", ... }
  }
}
```

## Error Handling

### Orchestrator Errors
- **Validation Errors**: Returns `400 Bad Request` with details
- **Firestore Errors**: Returns `500 Internal Server Error`
- **Pub/Sub Errors**: Returns `500 Internal Server Error`

### Worker Errors
- **Message Parsing Errors**: Logs error, returns `204` (acknowledges to prevent retries)
- **Pipeline Errors**: 
  - Updates job status to "error" in Firestore
  - Logs detailed error information
  - Returns `204` (acknowledges message)
- **Cancellation**: Checks at each stage, updates status to "cancelled"

## Deployment

### Cloud Run Configuration
- **Memory**: 2Gi (for concurrent processing)
- **CPU**: 2 (for parallel operations)
- **Timeout**: 3600s (1 hour, for long-running pipelines)
- **Concurrency**: 1 (one request per instance)
- **Min Instances**: 0 (scale to zero when idle)
- **Max Instances**: 10 (auto-scales based on Pub/Sub load)

### Environment Variables
- `PUBSUB_TOPIC_NAME`: `pipeline.start`
- `WEAVIATE_COLLECTION_NAME`: `influencer_profiles`
- `MAX_CONCURRENT_WEAVIATE_SEARCHES`: `12`
- `MAX_CONCURRENT_LLM_REQUESTS`: `5`

### Secrets (via Secret Manager)
- `OPENAI_API_KEY`
- `WEAVIATE_API_KEY`
- `WEAVIATE_URL`
- `DEEPINFRA_API_KEY`
- `BRIGHTDATA_API_KEY`

## Monitoring

### Key Metrics
- **Orchestrator Latency**: P50, P95, P99 response times
- **Worker Duration**: Pipeline execution time distribution
- **Job Success Rate**: Completed vs failed jobs
- **Stage Durations**: Time per pipeline stage
- **Pub/Sub Message Age**: Time between publish and processing

### Logging
- Structured JSON logs for all operations
- Request IDs for tracing across services
- Job IDs for tracking pipeline execution
- Stage progress updates

## Future Improvements

1. **Separate Services**: Split orchestrator and worker into separate Cloud Run services for independent scaling
2. **Dead Letter Queue**: Route failed messages to DLQ for manual inspection
3. **Batch Processing**: Process multiple jobs in single worker invocation
4. **Caching**: Cache query expansion results for similar business descriptions
5. **Webhooks**: Notify client when job completes instead of polling

