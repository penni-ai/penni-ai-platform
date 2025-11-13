# Streaming Batch Processing Plan

## Current Flow (Blocking)
```
1. Trigger all batches → Wait for ALL to complete
2. Download ALL batches → Wait for ALL downloads
3. Normalize ALL profiles → Wait for ALL normalization
4. LLM analyze ALL profiles → Wait for ALL analysis
5. Store ALL results → Return everything at once
```

**Problem**: Users wait for the slowest batch before seeing any results.

## New Flow (Streaming)
```
1. Trigger all batches (parallel)
2. For each batch as it completes:
   a. Download immediately when ready
   b. Normalize profiles
   c. LLM analyze profiles
   d. Store results in Firestore incrementally
   e. Update pipeline job with new results
3. Continue until all batches processed
```

**Benefit**: Users see results as soon as each batch completes (typically 30-60 seconds per batch).

## Implementation Strategy

### 1. Create Streaming Batch Processor
- New function: `processBatchedCollectionStreaming()`
- Returns an async generator or uses callbacks
- Processes batches independently as they complete

### 2. Batch Completion Detection
- Poll all snapshots in parallel
- As soon as a snapshot is "ready", immediately:
  - Download it
  - Process it
  - Don't wait for others

### 3. Independent Processing Pipeline
For each completed batch:
```
Batch Ready → Download → Normalize → LLM Analyze → Store in Firestore → Update Job Status
```

### 4. Firestore Updates
- Store profiles incrementally in `pipeline_jobs/{jobId}/batches/{batchId}`
- Update main job document with:
  - `profiles` array (append new profiles)
  - `batches_completed` counter
  - `batches_processing` counter
  - `batches_failed` counter

### 5. Progress Tracking
- Track per-batch status
- Update overall progress: `(batches_completed / total_batches) * 100`
- Show which batches are processing/completed/failed

## Architecture Changes

### New Functions Needed:
1. `processBatchedCollectionStreaming()` - Streaming version
2. `processBatchAsReady()` - Process single batch end-to-end
3. `storeBatchResults()` - Store batch results incrementally
4. `updateJobWithBatchResults()` - Update job document with new batch

### Firestore Structure:
```
pipeline_jobs/{jobId}
  ├── profiles: [] (incremental array)
  ├── batches_completed: number
  ├── batches_processing: number
  ├── batches_failed: number
  └── batches/{batchId}
      ├── status: 'processing' | 'completed' | 'error'
      ├── profiles: []
      ├── completed_at: timestamp
      └── error: string (if failed)
```

## Benefits
1. **Faster Time-to-First-Result**: Users see results in ~30-60s instead of waiting for all batches
2. **Better UX**: Progressive loading, can show "3/5 batches complete"
3. **Resilience**: Failed batches don't block successful ones
4. **Scalability**: Can handle 100+ batches efficiently

## Implementation Steps
1. Create streaming batch processor
2. Modify pipeline to use streaming processor
3. Add incremental Firestore storage
4. Update progress tracking
5. Test with multiple batches

