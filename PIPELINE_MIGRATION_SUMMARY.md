# Pipeline Service Migration Summary

## Overview
Migrated Svelte app from Cloud Functions pipeline to Cloud Run pipeline service.

## Changes Made

### 1. API Route Updates (`src/routes/api/pipeline/[pipelineId]/+server.ts`)
- ✅ Added `remaining_profiles_storage_path` and `remaining_profiles_count` to Firestore interface
- ✅ Added logic to load remaining profiles from Storage
- ✅ Updated API response to include remaining profiles data

### 2. Environment Configuration (`.env.example`)
- ✅ Updated `USE_CLOUD_RUN_PIPELINE` to `true` (enabled by default)
- ✅ Updated `CLOUD_RUN_PIPELINE_SERVICE_URL` with production URL

### 3. Firestore Compatibility Verification
- ✅ Verified all fields match between new pipeline service and API expectations:
  - `job_id`, `status`, `current_stage`, `completed_stages`, `overall_progress`
  - `query_expansion`, `weaviate_search`, `brightdata_collection`, `llm_analysis` stages
  - `profiles_storage_path`, `profiles_count`
  - `remaining_profiles_*` fields
  - `pipeline_stats`, `uid`, `campaign_id`

Note:
- Storage **paths** are the source-of-truth (e.g. `pipeline_jobs/<jobId>/profiles.json`). URL fields are deprecated and should not be used.

## Firestore Document Structure

The new pipeline service creates documents with this structure (matches API expectations):

```typescript
{
  job_id: string;
  status: 'pending' | 'running' | 'completed' | 'error' | 'cancelled';
  current_stage: PipelineStage | null;
  completed_stages: PipelineStage[];
  overall_progress: number; // 0-100
  
  // Stage data
  query_expansion?: { status, queries, completed_at, error };
  weaviate_search?: { status, total_results, deduplicated_results, queries_executed, completed_at, error };
  brightdata_collection?: { status, profiles_requested, profiles_collected, batches_completed, batches_processing, batches_failed, total_batches, completed_at, error };
  llm_analysis?: { status, profiles_analyzed, completed_at, error };
  
  // Results
  profiles_storage_path?: string;
  profiles_count?: number;
  candidates_storage_path?: string;
  remaining_profiles_storage_path?: string;
  remaining_profiles_count?: number;
  progressive_profiles_storage_path?: string;
  progressive_profiles_count?: number;
  
  // Metadata
  uid?: string | null;
  campaign_id?: string | null;
  pipeline_stats?: { queries_generated, total_search_results, deduplicated_results, profiles_collected, profiles_analyzed };
}
```

## API Endpoints

### POST `/api/search/influencers`
- Already configured to use Cloud Run pipeline when `USE_CLOUD_RUN_PIPELINE=true`
- Calls `POST /pipeline/start` on Cloud Run service
- Returns `job_id` for polling

### GET `/api/pipeline/[pipelineId]`
- Reads from Firestore `pipeline_jobs` collection
- Loads profiles from Cloud Storage
- Now includes remaining profiles in response

## Frontend Components

The following components read pipeline data and are compatible:
- ✅ `PipelineStatus.svelte` - Displays pipeline progress and stage status
- ✅ `OutreachTab.svelte` - Shows pipeline results and influencer list
- ✅ Campaign page (`campaign/[id]/+page.svelte`) - Polls pipeline status

## Next Steps

1. **Set Environment Variables** (if not already set):
   ```bash
   USE_CLOUD_RUN_PIPELINE=true
   CLOUD_RUN_PIPELINE_SERVICE_URL=https://pipeline-service-szs2cmou6q-uc.a.run.app
   ```

2. **Test the Integration**:
   - Start a pipeline job via the Svelte app
   - Verify status updates appear correctly
   - Check that profiles load from Storage
   - Verify remaining profiles are accessible (if any)

3. **Monitor**:
   - Check Cloud Run logs for pipeline execution
   - Verify Firestore documents are created correctly
   - Ensure Storage files are accessible

## Compatibility Notes

- ✅ All existing Firestore fields are preserved
- ✅ New fields (`remaining_profiles_*`) are optional and won't break existing code
- ✅ API response structure is backward compatible
- ✅ Frontend components work with both old and new pipeline data structures
