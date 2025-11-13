/**
 * Firestore tracking for pipeline jobs
 * Tracks status and stores data at each stage of the pipeline
 */

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { BrightDataUnifiedProfile } from '../types/brightdata.js';
import {
  getFirestoreInstance,
  getStorageInstance,
  resolvedStorageBucketName,
} from './firebase-admin.js';

const db = getFirestoreInstance();
const storage = getStorageInstance();
const PIPELINE_COLLECTION = 'pipeline_jobs';
const STORAGE_BUCKET_NAME = resolvedStorageBucketName || storage.bucket().name;

/**
 * Pipeline job status
 */
export type PipelineJobStatus = 'pending' | 'running' | 'completed' | 'error' | 'cancelled';

/**
 * Check if a pipeline job has been cancelled
 */
export async function isJobCancelled(jobId: string): Promise<boolean> {
  const doc = await db.collection(PIPELINE_COLLECTION).doc(jobId).get();
  
  if (!doc.exists) {
    return false;
  }
  
  const data = doc.data() as PipelineJobDocument;
  return data.status === 'cancelled' || data.cancel_requested === true;
}

/**
 * Cancel a pipeline job
 */
export async function cancelPipelineJob(jobId: string): Promise<void> {
  await db.collection(PIPELINE_COLLECTION).doc(jobId).update({
    status: 'cancelled',
    cancel_requested: true,
    end_time: Timestamp.now(),
    updated_at: Timestamp.now(),
  });
  
  console.log(`[Firestore] Cancelled pipeline job ${jobId}`);
}

/**
 * Pipeline stage status
 */
export type StageStatus = 'pending' | 'running' | 'completed' | 'error';

/**
 * Pipeline stages
 */
export type PipelineStage = 
  | 'query_expansion'
  | 'weaviate_search'
  | 'brightdata_collection'
  | 'llm_analysis';

/**
 * Pipeline job document structure
 */
export interface PipelineJobDocument {
  job_id: string;
  business_description: string;
  status: PipelineJobStatus;
  current_stage: PipelineStage | null;
  completed_stages: PipelineStage[];
  overall_progress: number; // 0-100
  start_time: Timestamp;
  end_time?: Timestamp | null;
  error_message?: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  cancel_requested?: boolean;
  uid?: string | null;
  campaign_id?: string | null;
  
  // Stage-specific data
  query_expansion?: {
    status: StageStatus;
    queries: string[];
    completed_at?: Timestamp | null;
    error?: string | null;
  };
  
  weaviate_search?: {
    status: StageStatus;
    total_results: number;
    deduplicated_results: number;
    queries_executed: number;
    completed_at?: Timestamp | null;
    error?: string | null;
  };
  
  brightdata_collection?: {
    status: StageStatus;
    profiles_requested: number;
    profiles_collected: number;
    completed_at?: Timestamp | null;
    error?: string | null;
  };
  
  llm_analysis?: {
    status: StageStatus;
    profiles_analyzed: number;
    completed_at?: Timestamp | null;
    error?: string | null;
  };
  
  // Results (stored in Storage for large datasets)
  profiles_storage_url?: string;
  profiles_storage_path?: string;
  profiles_count?: number;
  
  // Legacy: Keep for backwards compatibility, but will be empty for large datasets
  profiles?: Array<BrightDataUnifiedProfile & { fit_score?: number; fit_rationale?: string }>;
  
  // Metadata
  top_n?: number;
  pipeline_stats?: {
    queries_generated: number;
    total_search_results: number;
    deduplicated_results: number;
    profiles_collected: number;
    profiles_analyzed: number;
  };
}

/**
 * Create a new pipeline job document
 */
export async function createPipelineJob(
  businessDescription: string,
  topN: number,
  metadata?: { uid?: string; campaignId?: string }
): Promise<string> {
  const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const now = Timestamp.now();
  
  const jobDoc: PipelineJobDocument = {
    job_id: jobId,
    business_description: businessDescription,
    status: 'pending',
    current_stage: null,
    completed_stages: [],
    overall_progress: 0,
    start_time: now,
    end_time: null,
    error_message: null,
    created_at: now,
    updated_at: now,
    top_n: topN,
  };
  if (metadata?.uid && typeof metadata.uid === 'string' && metadata.uid.trim()) {
    jobDoc.uid = metadata.uid.trim();
  }
  if (metadata?.campaignId && typeof metadata.campaignId === 'string' && metadata.campaignId.trim()) {
    jobDoc.campaign_id = metadata.campaignId.trim();
  }
  
  await db.collection(PIPELINE_COLLECTION).doc(jobId).set(jobDoc);
  console.log(`[Firestore] Created pipeline job: ${jobId}`);
  
  return jobId;
}

/**
 * Update pipeline job status
 */
export async function updatePipelineJobStatus(
  jobId: string,
  status: PipelineJobStatus,
  errorMessage?: string | null
): Promise<void> {
  const updates: Partial<PipelineJobDocument> = {
    status,
    updated_at: Timestamp.now(),
  };
  
  if (status === 'completed' || status === 'error') {
    updates.end_time = Timestamp.now();
  }
  
  if (errorMessage !== undefined) {
    updates.error_message = errorMessage;
  }
  
  await db.collection(PIPELINE_COLLECTION).doc(jobId).update(updates);
  console.log(`[Firestore] Updated pipeline job ${jobId} status: ${status}`);
}

/**
 * Update current stage and progress
 */
export async function updatePipelineStage(
  jobId: string,
  stage: PipelineStage,
  progress: number
): Promise<void> {
  await db.collection(PIPELINE_COLLECTION).doc(jobId).update({
    current_stage: stage,
    overall_progress: Math.min(100, Math.max(0, progress)),
    updated_at: Timestamp.now(),
  });
  console.log(`[Firestore] Updated pipeline job ${jobId} stage: ${stage} (${progress}%)`);
}

/**
 * Mark stage as completed
 */
export async function completeStage(
  jobId: string,
  stage: PipelineStage
): Promise<void> {
  const jobRef = db.collection(PIPELINE_COLLECTION).doc(jobId);
  const jobDoc = await jobRef.get();
  
  if (!jobDoc.exists) {
    throw new Error(`Pipeline job ${jobId} not found`);
  }
  
  const currentData = jobDoc.data() as PipelineJobDocument;
  const completedStages = [...(currentData.completed_stages || []), stage];
  
  // Calculate progress based on completed stages
  const totalStages = 4; // query_expansion, weaviate_search, brightdata_collection, llm_analysis
  const progress = Math.round((completedStages.length / totalStages) * 100);
  
  await jobRef.update({
    completed_stages: completedStages,
    overall_progress: progress,
    updated_at: Timestamp.now(),
  });
  
  console.log(`[Firestore] Completed stage ${stage} for pipeline job ${jobId}`);
}

/**
 * Update query expansion stage
 */
export async function updateQueryExpansionStage(
  jobId: string,
  status: StageStatus,
  queries?: string[],
  error?: string | null
): Promise<void> {
  const updates: any = {
    'query_expansion.status': status,
    'query_expansion.completed_at': status === 'completed' ? Timestamp.now() : null,
    updated_at: Timestamp.now(),
  };
  
  if (queries) {
    updates['query_expansion.queries'] = queries;
  }
  
  if (error !== undefined) {
    updates['query_expansion.error'] = error;
  }
  
  await db.collection(PIPELINE_COLLECTION).doc(jobId).update(updates);
  console.log(`[Firestore] Updated query expansion stage for ${jobId}: ${status}`);
}

/**
 * Update Weaviate search stage
 */
export async function updateWeaviateSearchStage(
  jobId: string,
  status: StageStatus,
  totalResults?: number,
  deduplicatedResults?: number,
  queriesExecuted?: number,
  error?: string | null
): Promise<void> {
  const updates: any = {
    'weaviate_search.status': status,
    'weaviate_search.completed_at': status === 'completed' ? Timestamp.now() : null,
    updated_at: Timestamp.now(),
  };
  
  if (totalResults !== undefined) {
    updates['weaviate_search.total_results'] = totalResults;
  }
  
  if (deduplicatedResults !== undefined) {
    updates['weaviate_search.deduplicated_results'] = deduplicatedResults;
  }
  
  if (queriesExecuted !== undefined) {
    updates['weaviate_search.queries_executed'] = queriesExecuted;
  }
  
  if (error !== undefined) {
    updates['weaviate_search.error'] = error;
  }
  
  await db.collection(PIPELINE_COLLECTION).doc(jobId).update(updates);
  console.log(`[Firestore] Updated Weaviate search stage for ${jobId}: ${status}`);
}

/**
 * Update BrightData collection stage
 */
export async function updateBrightDataStage(
  jobId: string,
  status: StageStatus,
  profilesRequested?: number,
  profilesCollected?: number,
  error?: string | null
): Promise<void> {
  const updates: any = {
    'brightdata_collection.status': status,
    'brightdata_collection.completed_at': status === 'completed' ? Timestamp.now() : null,
    updated_at: Timestamp.now(),
  };
  
  if (profilesRequested !== undefined) {
    updates['brightdata_collection.profiles_requested'] = profilesRequested;
  }
  
  if (profilesCollected !== undefined) {
    updates['brightdata_collection.profiles_collected'] = profilesCollected;
  }
  
  if (error !== undefined) {
    updates['brightdata_collection.error'] = error;
  }
  
  await db.collection(PIPELINE_COLLECTION).doc(jobId).update(updates);
  console.log(`[Firestore] Updated BrightData stage for ${jobId}: ${status}`);
}

/**
 * Update LLM analysis stage
 */
export async function updateLLMAnalysisStage(
  jobId: string,
  status: StageStatus,
  profilesAnalyzed?: number,
  error?: string | null
): Promise<void> {
  const updates: any = {
    'llm_analysis.status': status,
    'llm_analysis.completed_at': status === 'completed' ? Timestamp.now() : null,
    updated_at: Timestamp.now(),
  };
  
  if (profilesAnalyzed !== undefined) {
    updates['llm_analysis.profiles_analyzed'] = profilesAnalyzed;
  }
  
  if (error !== undefined) {
    updates['llm_analysis.error'] = error;
  }
  
  await db.collection(PIPELINE_COLLECTION).doc(jobId).update(updates);
  console.log(`[Firestore] Updated LLM analysis stage for ${jobId}: ${status}`);
}

/**
 * Store final results in Storage (not Firestore due to size limits)
 * Profiles are stored in Firebase Storage, metadata in Firestore
 */
export async function storePipelineResults(
  jobId: string,
  profiles: Array<BrightDataUnifiedProfile & { fit_score?: number; fit_rationale?: string }>,
  pipelineStats?: {
    queries_generated: number;
    total_search_results: number;
    deduplicated_results: number;
    profiles_collected: number;
    profiles_analyzed: number;
  }
): Promise<void> {
  // Save profiles to Storage
  const storageUrl = await saveProfilesToStorage(jobId, profiles);
  
  // Store metadata in Firestore (not the actual profiles)
  const updates: any = {
    profiles_storage_url: storageUrl,
    profiles_storage_path: getProfilesStoragePath(jobId),
    profiles_count: profiles.length,
    updated_at: Timestamp.now(),
  };
  
  if (pipelineStats) {
    updates.pipeline_stats = pipelineStats;
  }
  
  await db.collection(PIPELINE_COLLECTION).doc(jobId).update(updates);
  console.log(`[Storage] Stored ${profiles.length} profiles in Storage for pipeline job ${jobId}`);
  console.log(`[Storage] Storage URL: ${storageUrl}`);
}

/**
 * Get pipeline job document
 */
export async function getPipelineJob(jobId: string): Promise<PipelineJobDocument | null> {
  const doc = await db.collection(PIPELINE_COLLECTION).doc(jobId).get();
  
  if (!doc.exists) {
    return null;
  }
  
  return doc.data() as PipelineJobDocument;
}

/**
 * Get or create Storage bucket
 */
function getBucket() {
  return storage.bucket(STORAGE_BUCKET_NAME);
}

/**
 * Get Storage path for pipeline profiles
 */
function getProfilesStoragePath(jobId: string): string {
  return `pipeline_jobs/${jobId}/profiles.json`;
}

/**
 * Load existing profiles from Storage
 */
async function loadProfilesFromStorage(jobId: string): Promise<Array<BrightDataUnifiedProfile & { fit_score?: number; fit_rationale?: string }>> {
  const bucket = getBucket();
  const filePath = getProfilesStoragePath(jobId);
  const file = bucket.file(filePath);
  
  try {
    const [exists] = await file.exists();
    if (!exists) {
      return [];
    }
    
    const [contents] = await file.download();
    const profiles = JSON.parse(contents.toString('utf-8'));
    return Array.isArray(profiles) ? profiles : [];
  } catch (error) {
    console.error(`[Storage] Error loading profiles from ${filePath}:`, error);
    return [];
  }
}

/**
 * Save profiles to Storage
 */
async function saveProfilesToStorage(
  jobId: string,
  profiles: Array<BrightDataUnifiedProfile & { fit_score?: number; fit_rationale?: string }>
): Promise<string> {
  const bucket = getBucket();
  const filePath = getProfilesStoragePath(jobId);
  const file = bucket.file(filePath);
  
  const jsonContent = JSON.stringify(profiles, null, 2);
  const buffer = Buffer.from(jsonContent, 'utf-8');
  
  await file.save(buffer, {
    contentType: 'application/json',
    metadata: {
      cacheControl: 'public, max-age=3600',
      metadata: {
        jobId,
        profileCount: profiles.length.toString(),
        updatedAt: new Date().toISOString(),
      },
    },
  });
  
  // Make file publicly readable (or use signed URLs if needed)
  await file.makePublic();
  
  const publicUrl = `https://storage.googleapis.com/${STORAGE_BUCKET_NAME}/${filePath}`;
  console.log(`[Storage] Saved ${profiles.length} profiles to ${filePath}`);
  
  return publicUrl;
}

/**
 * Append batch results incrementally to Storage
 * This allows users to see results as they come in
 * Profiles are stored in Firebase Storage, not Firestore (to handle large datasets)
 */
export async function appendBatchResults(
  jobId: string,
  newProfiles: Array<BrightDataUnifiedProfile & { fit_score?: number; fit_rationale?: string }>
): Promise<void> {
  const jobRef = db.collection(PIPELINE_COLLECTION).doc(jobId);
  const jobDoc = await jobRef.get();
  
  if (!jobDoc.exists) {
    throw new Error(`Pipeline job ${jobId} not found`);
  }
  
  // Load existing profiles from Storage
  const existingProfiles = await loadProfilesFromStorage(jobId);
  
  // Append new profiles
  const updatedProfiles = [...existingProfiles, ...newProfiles];
  
  // Save to Storage
  const storageUrl = await saveProfilesToStorage(jobId, updatedProfiles);
  
  // Update Firestore with metadata and Storage URL
  await jobRef.update({
    profiles_storage_url: storageUrl,
    profiles_storage_path: getProfilesStoragePath(jobId),
    'brightdata_collection.profiles_collected': updatedProfiles.length,
    'llm_analysis.profiles_analyzed': updatedProfiles.filter(p => p.fit_score !== undefined).length,
    updated_at: Timestamp.now(),
  });
  
  console.log(`[Storage] Appended ${newProfiles.length} profiles to job ${jobId} (total: ${updatedProfiles.length})`);
}

/**
 * Update batch processing counters
 */
export async function updateBatchCounters(
  jobId: string,
  batchesCompleted: number,
  batchesProcessing: number,
  batchesFailed: number,
  totalBatches: number
): Promise<void> {
  const progress = totalBatches > 0 ? Math.round((batchesCompleted / totalBatches) * 50) + 50 : 50; // 50-100% range
  
  await db.collection(PIPELINE_COLLECTION).doc(jobId).update({
    'brightdata_collection.batches_completed': batchesCompleted,
    'brightdata_collection.batches_processing': batchesProcessing,
    'brightdata_collection.batches_failed': batchesFailed,
    'brightdata_collection.total_batches': totalBatches,
    overall_progress: progress,
    updated_at: Timestamp.now(),
  });
  
  console.log(`[Firestore] Updated batch counters for ${jobId}: ${batchesCompleted}/${totalBatches} completed`);
}

/**
 * Finalize pipeline progress at 100% without mutating stage state
 */
export async function finalizePipelineProgress(jobId: string): Promise<void> {
  await db.collection(PIPELINE_COLLECTION).doc(jobId).update({
    overall_progress: 100,
    current_stage: null,
    updated_at: Timestamp.now(),
  });
  console.log(`[Firestore] Finalized pipeline job ${jobId} progress at 100%`);
}
