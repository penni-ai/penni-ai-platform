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
import type { PipelineTimingData } from './timing-tracker.js';
import { createLogger } from './logger.js';

const db = getFirestoreInstance();
const storage = getStorageInstance();
const PIPELINE_COLLECTION = 'pipeline_jobs';
const STORAGE_BUCKET_NAME = resolvedStorageBucketName || storage.bucket().name;
const logger = createLogger({ component: 'firestore-tracker' });

// Log configuration for debugging
const pipelineServiceProjectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'unknown';
const pipelineServiceFirestoreEmulator = process.env.FIRESTORE_EMULATOR_HOST || 'none';
const pipelineServiceStorageBucket = STORAGE_BUCKET_NAME;
const pipelineServiceStorageEmulator = process.env.FIREBASE_STORAGE_EMULATOR_HOST || process.env.STORAGE_EMULATOR_HOST || 'none';

logger.info('firestore_storage_configuration', {
	projectId: pipelineServiceProjectId,
	firestoreEmulator: pipelineServiceFirestoreEmulator,
	storageBucket: pipelineServiceStorageBucket,
	storageEmulator: pipelineServiceStorageEmulator
});

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
  
  logger.info('pipeline_cancelled', { job_id: jobId });
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
  pipeline_description?: string;
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
  strict_location_matching?: boolean;
  tasks_execution_mode?: 'tasks';

  // Task orchestration helpers
  good_fit_count?: number;
  stop_requested?: boolean;
  cache_batches_total?: number;
  cache_batches_completed?: number;
  cache_batches_failed?: number;
  brightdata_batches_total?: number;
  brightdata_in_flight?: number;
  finalization_started?: boolean;

  // Centralized timing data
  timing?: PipelineTimingData;

  // Stage-specific data
  query_expansion?: {
    status: StageStatus;
    queries: string[];
    prompt?: string; // The full prompt sent to the LLM for query generation
    started_at?: Timestamp | null;
    completed_at?: Timestamp | null;
    error?: string | null;
  };

  weaviate_search?: {
    status: StageStatus;
    total_results: number;
    deduplicated_results: number;
    queries_executed: number;
    candidates_count?: number;
    started_at?: Timestamp | null;
    completed_at?: Timestamp | null;
    error?: string | null;
  };

  brightdata_collection?: {
    status: StageStatus;
    profiles_requested: number;
    profiles_collected: number;
    cache_hits?: number;
    api_calls?: number;
    batches_completed?: number;
    batches_processing?: number;
    batches_failed?: number;
    total_batches?: number;
    completed_batch_indices?: number[]; // Track which batch indices have completed (for out-of-order completion)
    started_at?: Timestamp | null;
    completed_at?: Timestamp | null;
    error?: string | null;
  };

  llm_analysis?: {
    status: StageStatus;
    profiles_analyzed: number;
    started_at?: Timestamp | null;
    completed_at?: Timestamp | null;
    error?: string | null;
  };

  // Results (stored in Storage for large datasets)
  profiles_signed_url?: string; // Signed URL for direct frontend access (7 days expiry)
  profiles_storage_path?: string;
  profiles_count?: number;
  remaining_profiles_signed_url?: string;
  remaining_profiles_storage_path?: string;
  remaining_profiles_count?: number;

  // Progressive results (updated after each batch completes)
  progressive_profiles_signed_url?: string;
  progressive_profiles_storage_path?: string;
  progressive_profiles_count?: number;
  progressive_profiles_revision?: number;
  progressive_is_complete?: boolean; // True when all batches are processed

  // Legacy: Keep for backwards compatibility, but will be empty for large datasets
  profiles?: Array<BrightDataUnifiedProfile & { fit_score?: number; fit_rationale?: string }>;

  // Metadata
  top_n?: number;
  weaviate_top_n?: number;
  llm_top_n?: number;
  pipeline_stats?: {
    queries_generated: number;
    total_search_results: number;
    deduplicated_results: number;
    profiles_collected: number;
    profiles_analyzed: number;
    // Cost tracking
    cache_hits?: number;
    api_calls?: number;
    brightdata_cost?: number;
    openai_cost?: number;
    total_cost?: number;
  };

  pipeline_summary?: string | null;
  pipeline_waterfall?: string | null;
}

/**
 * Create a new pipeline job document
 */
export async function createPipelineJob(
  businessDescription: string,
  llmTopN: number,
  metadata?: { uid?: string; campaignId?: string; weaviateTopN?: number }
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
    top_n: llmTopN, // top_n is the same as llm_top_n (final result count)
    llm_top_n: llmTopN,
    weaviate_top_n: metadata?.weaviateTopN,
  };
  if (metadata?.uid && typeof metadata.uid === 'string' && metadata.uid.trim()) {
    jobDoc.uid = metadata.uid.trim();
    logger.info('pipeline_uid_set', { job_id: jobId, uid: jobDoc.uid });
  } else {
    logger.warn('pipeline_uid_missing', { job_id: jobId, metadata });
  }
  if (metadata?.campaignId && typeof metadata.campaignId === 'string' && metadata.campaignId.trim()) {
    jobDoc.campaign_id = metadata.campaignId.trim();
  }
  
  await db.collection(PIPELINE_COLLECTION).doc(jobId).set(jobDoc);
  logger.info('pipeline_created', { job_id: jobId, uid: jobDoc.uid || 'none' });
  
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
  
  if (status === 'completed' || status === 'error' || status === 'cancelled') {
    updates.end_time = Timestamp.now();
  }

  if (status === 'cancelled') {
    updates.cancel_requested = true;
  }
  
  if (errorMessage !== undefined) {
    updates.error_message = errorMessage;
  }
  
  await db.collection(PIPELINE_COLLECTION).doc(jobId).update(updates);
  logger.info('pipeline_status_updated', { job_id: jobId, status });
}

/**
 * Calculate progress based on stage and substage
 * Progress milestones (0-100%):
 * - 0-10%: Query expansion (10%)
 * - 10-20%: Embedding generation (10%)
 * - 20-50%: Weaviate searches (30%)
 * - 50-90%: BrightData collection + LLM analysis (40%, incremental per batch)
 * - 90-100%: Finalization (10%)
 */
export function calculateProgress(
  stage: PipelineStage | null,
  subStage?: string,
  batchProgress?: { completed: number; total: number }
): number {
  // Query expansion: 0-10%
  if (stage === 'query_expansion') {
    return 10;
  }
  
  // Embedding generation: 10-20%
  if (stage === 'weaviate_search' && subStage === 'embedding_generation') {
    return 20;
  }
  
  // Weaviate searches complete: 20-50%
  if (stage === 'weaviate_search' && subStage === 'searches_complete') {
    return 50;
  }
  
  // BrightData collection + LLM analysis: 50-90% (incremental per batch)
  if (stage === 'brightdata_collection' || stage === 'llm_analysis') {
    if (batchProgress && batchProgress.total > 0) {
      // 50% base + (batch_completed/total_batches) * 40%
      const batchProgressPercent = (batchProgress.completed / batchProgress.total) * 40;
      return Math.min(90, 50 + batchProgressPercent);
    }
    return 50; // Starting point for batch processing
  }
  
  // Finalization: 90-100%
  if (stage === null) {
    return 100;
  }
  
  return 0;
}

/**
 * Update progress atomically in Firestore
 */
export async function updateProgress(
  jobId: string,
  stage: PipelineStage | null,
  subStage?: string,
  batchProgress?: { completed: number; total: number }
): Promise<void> {
  const progress = calculateProgress(stage, subStage, batchProgress);
  const clampedProgress = Math.min(100, Math.max(0, progress));
  
  const updates: any = {
    overall_progress: clampedProgress,
    updated_at: Timestamp.now(),
  };
  
  if (stage !== null) {
    updates.current_stage = stage;
  }
  
  await db.collection(PIPELINE_COLLECTION).doc(jobId).update(updates);
  logger.debug('pipeline_progress_updated', {
    job_id: jobId,
    overall_progress: clampedProgress,
    stage: stage || 'finalization',
    sub_stage: subStage || 'none',
  });
}

/**
 * Update current stage and progress (legacy function, use updateProgress instead)
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
  logger.debug('pipeline_stage_updated', { job_id: jobId, stage, progress });
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
  
  logger.info('pipeline_stage_completed', { job_id: jobId, stage });
}

/**
 * Update query expansion stage
 */
export async function updateQueryExpansionStage(
  jobId: string,
  status: StageStatus,
  queries?: string[],
  error?: string | null,
  prompt?: string,
  startTimeSeconds?: number,
  durationSeconds?: number
): Promise<void> {
  const updates: any = {
    'query_expansion.status': status,
    'query_expansion.completed_at': status === 'completed' ? Timestamp.now() : null,
    updated_at: Timestamp.now(),
  };

  if (status === 'running') {
    updates['query_expansion.started_at'] = Timestamp.now();
  }
  
  if (queries) {
    updates['query_expansion.queries'] = queries;
  }
  
  if (prompt !== undefined) {
    updates['query_expansion.prompt'] = prompt;
  }
  
  if (error !== undefined) {
    updates['query_expansion.error'] = error;
  }
  
  await db.collection(PIPELINE_COLLECTION).doc(jobId).update(updates);
  logger.info('pipeline_query_expansion_updated', { job_id: jobId, status });
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

  if (status === 'running') {
    updates['weaviate_search.started_at'] = Timestamp.now();
  }
  
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
  logger.info('pipeline_weaviate_search_updated', { job_id: jobId, status });
}

/**
 * Update BrightData collection stage
 */
export async function updateBrightDataStage(
  jobId: string,
  status: StageStatus,
  profilesRequested?: number,
  profilesCollected?: number,
  error?: string | null,
  cacheHits?: number,
  apiCalls?: number
): Promise<void> {
  const updates: any = {
    'brightdata_collection.status': status,
    'brightdata_collection.completed_at': status === 'completed' ? Timestamp.now() : null,
    updated_at: Timestamp.now(),
  };

  if (status === 'running') {
    updates['brightdata_collection.started_at'] = Timestamp.now();
  }

  if (profilesRequested !== undefined) {
    updates['brightdata_collection.profiles_requested'] = profilesRequested;
  }

  if (profilesCollected !== undefined) {
    updates['brightdata_collection.profiles_collected'] = profilesCollected;
  }

  if (error !== undefined) {
    updates['brightdata_collection.error'] = error;
  }

  if (cacheHits !== undefined) {
    updates['brightdata_collection.cache_hits'] = cacheHits;
  }

  if (apiCalls !== undefined) {
    updates['brightdata_collection.api_calls'] = apiCalls;
  }

  await db.collection(PIPELINE_COLLECTION).doc(jobId).update(updates);
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

  if (status === 'running') {
    updates['llm_analysis.started_at'] = Timestamp.now();
  }
  
  if (profilesAnalyzed !== undefined) {
    updates['llm_analysis.profiles_analyzed'] = profilesAnalyzed;
  }
  
  if (error !== undefined) {
    updates['llm_analysis.error'] = error;
  }
  
  await db.collection(PIPELINE_COLLECTION).doc(jobId).update(updates);
}

/**
 * Store remaining profiles (non-top-n) in Storage
 */
export async function storeRemainingProfiles(
  jobId: string,
  remainingProfiles: Array<BrightDataUnifiedProfile & { fit_score?: number; fit_rationale?: string; fit_summary?: string }>
): Promise<string> {
  if (!Array.isArray(remainingProfiles) || remainingProfiles.length === 0) {
    logger.debug('storage_remaining_profiles_empty', { job_id: jobId });
    return '';
  }
  
  const bucket = getBucket();
  const filePath = getRemainingProfilesStoragePath(jobId);
  const file = bucket.file(filePath);
  
  const jsonContent = JSON.stringify(remainingProfiles, null, 2);
  const buffer = Buffer.from(jsonContent, 'utf-8');
  
  await file.save(buffer, {
    contentType: 'application/json',
    metadata: {
      cacheControl: 'public, max-age=3600',
      metadata: {
        jobId,
        profileCount: remainingProfiles.length.toString(),
        updatedAt: new Date().toISOString(),
      },
    },
  });
  
  // Verify the file was saved correctly
  try {
    const [exists] = await file.exists();
    if (!exists) {
      throw new Error(`Remaining profiles storage file was not created: ${filePath}`);
    }

    const [contents] = await file.download();
    const savedProfiles = JSON.parse(contents.toString('utf-8'));
    if (!Array.isArray(savedProfiles) || savedProfiles.length !== remainingProfiles.length) {
      throw new Error(`Remaining profiles count mismatch: expected ${remainingProfiles.length}, saved ${savedProfiles.length}`);
    }
  } catch (error) {
    logger.error('storage_remaining_profiles_validation_failed', { job_id: jobId, error });
    throw error;
  }

  // Update Firestore with remaining profiles metadata
  // Note: Frontend API loads from storage path directly, no signed URL needed
  await db.collection(PIPELINE_COLLECTION).doc(jobId).update({
    remaining_profiles_storage_path: filePath,
    remaining_profiles_count: remainingProfiles.length,
    updated_at: Timestamp.now(),
  });

  logger.info('storage_remaining_profiles_saved', { job_id: jobId, count: remainingProfiles.length });
  return filePath;
}

/**
 * Store final results in Storage (not Firestore due to size limits)
 * Profiles are stored in Firebase Storage, metadata in Firestore
 * Validates that profiles_count matches actual profiles
 */
export async function storePipelineResults(
  jobId: string,
  profiles: Array<BrightDataUnifiedProfile & { fit_score?: number; fit_rationale?: string; fit_summary?: string }>,
  pipelineStats?: {
    queries_generated: number;
    total_search_results: number;
    deduplicated_results: number;
    profiles_collected: number;
    profiles_analyzed: number;
    // Cost tracking
    cache_hits?: number;
    api_calls?: number;
    brightdata_cost?: number;
    openai_cost?: number;
    total_cost?: number;
  }
): Promise<void> {
  // Validate profiles array
  if (!Array.isArray(profiles)) {
    throw new Error(`Invalid profiles data: expected array, got ${typeof profiles}`);
  }

  // Save profiles to Storage
  const { path: storagePath } = await saveProfilesToStorage(jobId, profiles);

  // Verify the file was saved correctly by reading it back
  try {
    const bucket = getBucket();
    const file = bucket.file(storagePath);
    const [exists] = await file.exists();
    if (!exists) {
      throw new Error(`Storage file was not created: ${storagePath}`);
    }

    // Verify count matches
    const [contents] = await file.download();
    const savedProfiles = JSON.parse(contents.toString('utf-8'));
    if (!Array.isArray(savedProfiles) || savedProfiles.length !== profiles.length) {
      throw new Error(`Profile count mismatch: expected ${profiles.length}, saved ${savedProfiles.length}`);
    }
  } catch (error) {
    logger.error('storage_profiles_validation_failed', { job_id: jobId, error });
    throw error;
  }

  // Store metadata in Firestore (frontend API loads from storage path directly)
  const updates: any = {
    profiles_storage_path: storagePath,
    profiles_count: profiles.length,
    updated_at: Timestamp.now(),
  };

  if (pipelineStats) {
    updates.pipeline_stats = pipelineStats;
  }

  await db.collection(PIPELINE_COLLECTION).doc(jobId).update(updates);
  logger.info('storage_profiles_saved', { job_id: jobId, count: profiles.length });
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
 * Get Storage path for remaining profiles (non-top-n results)
 */
function getRemainingProfilesStoragePath(jobId: string): string {
  return `pipeline_jobs/${jobId}/profiles_remaining.json`;
}

/**
 * Get Storage path for Weaviate candidates (top N search results)
 */
function getCandidatesStoragePath(jobId: string): string {
  return `pipeline_jobs/${jobId}/candidates.json`;
}

/**
 * Get Storage path for a specific batch file
 */
function getBatchStoragePath(jobId: string, batchIndex: number): string {
  return `pipeline_jobs/${jobId}/profiles_batch_${batchIndex}.json`;
}

/**
 * Get Storage path for progressive top-N profiles (updated after each batch)
 */
function getProgressiveProfilesStoragePath(jobId: string): string {
  return `pipeline_jobs/${jobId}/profiles_progressive.json`;
}

/**
 * Load existing profiles from Storage
 */
/**
 * Save profiles to Storage and return storage path
 * Note: Frontend API loads from storage path directly, no signed URL needed
 */
async function saveProfilesToStorage(
  jobId: string,
  profiles: Array<BrightDataUnifiedProfile & { fit_score?: number; fit_rationale?: string }>
): Promise<{ path: string }> {
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

  return { path: filePath };
}

/**
 * Save Weaviate search candidates (top N results) to Storage
 * This allows the frontend to see search results before BrightData collection
 */
export async function saveWeaviateCandidates(
  jobId: string,
  candidates: Array<{
    id: string;
    score?: number;
    distance?: number;
    profile_url: string;
    platform?: string;
    display_name?: string;
    biography?: string;
    followers?: number;
  }>
): Promise<string> {
  const bucket = getBucket();
  const filePath = getCandidatesStoragePath(jobId);
  const file = bucket.file(filePath);
  
  // Normalize candidates data for frontend consumption
  const normalizedCandidates = candidates.map((candidate) => ({
    id: candidate.id,
    profile_url: candidate.profile_url,
    platform: candidate.platform || null,
    display_name: candidate.display_name || null,
    biography: candidate.biography || null,
    followers: candidate.followers || null,
    score: candidate.score || null,
    distance: candidate.distance || null,
  }));
  
  const jsonContent = JSON.stringify(normalizedCandidates, null, 2);
  const buffer = Buffer.from(jsonContent, 'utf-8');
  
  await file.save(buffer, {
    contentType: 'application/json',
    metadata: {
      cacheControl: 'public, max-age=3600',
      metadata: {
        jobId,
        candidateCount: candidates.length.toString(),
        updatedAt: new Date().toISOString(),
      },
    },
  });
  
  const publicUrl = `https://storage.googleapis.com/${STORAGE_BUCKET_NAME}/${filePath}`;
  
  // Update Firestore with candidates storage URL
  const jobRef = db.collection(PIPELINE_COLLECTION).doc(jobId);
  await jobRef.update({
    candidates_storage_url: publicUrl,
    candidates_storage_path: filePath,
    'weaviate_search.candidates_count': candidates.length,
    updated_at: Timestamp.now(),
  });
  
  return publicUrl;
}

/**
 * Save a single batch to its own Storage file (prevents race conditions)
 */
async function saveBatchToStorage(
  jobId: string,
  batchIndex: number,
  profiles: Array<BrightDataUnifiedProfile & { fit_score?: number; fit_rationale?: string; fit_summary?: string }>
): Promise<string> {
  const bucket = getBucket();
  const filePath = getBatchStoragePath(jobId, batchIndex);
  const file = bucket.file(filePath);
  
  const jsonContent = JSON.stringify(profiles, null, 2);
  const buffer = Buffer.from(jsonContent, 'utf-8');
  
  await file.save(buffer, {
    contentType: 'application/json',
    metadata: {
      cacheControl: 'public, max-age=3600',
      metadata: {
        jobId,
        batchIndex: batchIndex.toString(),
        profileCount: profiles.length.toString(),
        updatedAt: new Date().toISOString(),
      },
    },
  });
  
  const publicUrl = `https://storage.googleapis.com/${STORAGE_BUCKET_NAME}/${filePath}`;
  return publicUrl;
}

/**
 * Load a batch file from Storage
 */
async function loadBatchFromStorage(jobId: string, batchIndex: number): Promise<Array<BrightDataUnifiedProfile & { fit_score?: number; fit_rationale?: string; fit_summary?: string }>> {
  const bucket = getBucket();
  const filePath = getBatchStoragePath(jobId, batchIndex);
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
    logger.error('storage_batch_load_failed', { job_id: jobId, batch_index: batchIndex, path: filePath, error });
    return [];
  }
}

/**
 * Append batch results incrementally to Storage using separate batch files
 * This prevents race conditions by storing each batch in its own file
 */
export async function appendBatchResults(
  jobId: string,
  batchIndex: number,
  newProfiles: Array<BrightDataUnifiedProfile & { fit_score?: number; fit_rationale?: string; fit_summary?: string }>
): Promise<void> {
  const jobRef = db.collection(PIPELINE_COLLECTION).doc(jobId);
  const jobDoc = await jobRef.get();
  
  if (!jobDoc.exists) {
    throw new Error(`Pipeline job ${jobId} not found`);
  }
  
  // Save batch to its own file (no race condition)
  await saveBatchToStorage(jobId, batchIndex, newProfiles);
  
  // Update Firestore with batch completion tracking
  // Use Firestore transaction for atomic updates
  await db.runTransaction(async (transaction) => {
    const doc = await transaction.get(jobRef);
    if (!doc.exists) {
      throw new Error(`Pipeline job ${jobId} not found`);
    }
    
    const data = doc.data() as PipelineJobDocument;
    const currentBatchesCompleted = data.brightdata_collection?.batches_completed || 0;
    const currentProfilesCollected = data.brightdata_collection?.profiles_collected || 0;
    const currentProfilesAnalyzed = data.llm_analysis?.profiles_analyzed || 0;
    
    // Get current completed batch indices array
    const currentCompletedIndices = data.brightdata_collection?.completed_batch_indices || [];

    // Update counters atomically, including the batch index
    transaction.update(jobRef, {
      [`brightdata_collection.batches_completed`]: currentBatchesCompleted + 1,
      [`brightdata_collection.profiles_collected`]: currentProfilesCollected + newProfiles.length,
      [`brightdata_collection.completed_batch_indices`]: [...currentCompletedIndices, batchIndex],
      [`llm_analysis.profiles_analyzed`]: currentProfilesAnalyzed + newProfiles.filter(p => p.fit_score !== undefined).length,
      updated_at: Timestamp.now(),
    });
  });
  
  logger.debug('storage_batch_saved', { job_id: jobId, batch_index: batchIndex, count: newProfiles.length });
}

/**
 * Merge all batch files into final profiles.json
 * This should be called once at the end after all batches are complete
 */
export async function mergeBatchResults(
  jobId: string,
  totalBatches?: number
): Promise<Array<BrightDataUnifiedProfile & { fit_score?: number; fit_rationale?: string; fit_summary?: string }>> {
  const allProfiles: Array<BrightDataUnifiedProfile & { fit_score?: number; fit_rationale?: string; fit_summary?: string }> = [];

  const jobRef = db.collection(PIPELINE_COLLECTION).doc(jobId);
  const jobDoc = await jobRef.get();

  let batchIndices: number[] = [];
  let expectedCount = 0;

  if (jobDoc.exists) {
    const data = jobDoc.data() as PipelineJobDocument;
    expectedCount = data.brightdata_collection?.profiles_collected || 0;

    const completedBatchIndices = data.brightdata_collection?.completed_batch_indices;
    if (Array.isArray(completedBatchIndices) && completedBatchIndices.length > 0) {
      batchIndices = Array.from(
        new Set(completedBatchIndices.filter((idx) => typeof idx === 'number' && Number.isFinite(idx)))
      ).sort((a, b) => a - b);
    } else if (typeof totalBatches === 'number' && Number.isFinite(totalBatches) && totalBatches > 0) {
      batchIndices = Array.from({ length: totalBatches }, (_, i) => i);
    } else {
      const completedCount = data.brightdata_collection?.batches_completed;
      if (typeof completedCount === 'number' && Number.isFinite(completedCount) && completedCount > 0) {
        batchIndices = Array.from({ length: completedCount }, (_, i) => i);
      }
    }
  } else if (typeof totalBatches === 'number' && Number.isFinite(totalBatches) && totalBatches > 0) {
    batchIndices = Array.from({ length: totalBatches }, (_, i) => i);
  }

  // Load only the actually completed batch files when possible (handles gaps/out-of-order completion)
  for (const batchIndex of batchIndices) {
    try {
      const batchProfiles = await loadBatchFromStorage(jobId, batchIndex);
      allProfiles.push(...batchProfiles);
    } catch (err) {
      logger.warn('storage_batch_load_skipped', { job_id: jobId, batch_index: batchIndex, error: err });
    }
  }

  // Validate total count matches expected
  if (jobDoc.exists) {
    if (allProfiles.length !== expectedCount) {
      logger.warn('storage_profile_count_mismatch', {
        job_id: jobId,
        expected: expectedCount,
        found: allProfiles.length,
      });
    }
  }

  // Save merged results to main profiles.json
  const { path: storagePath } = await saveProfilesToStorage(jobId, allProfiles);

  // Update Firestore with storage path (frontend API loads from storage path directly)
  await jobRef.update({
    profiles_storage_path: storagePath,
    profiles_count: allProfiles.length,
    updated_at: Timestamp.now(),
  });

  logger.info('storage_batches_merged', { job_id: jobId, batch_count: batchIndices.length, profile_count: allProfiles.length });

  return allProfiles;
}

/**
 * Update batch processing counters
 * Note: This is now handled atomically in appendBatchResults, but kept for backwards compatibility
 */
export async function updateBatchCounters(
  jobId: string,
  batchesCompleted: number,
  batchesProcessing: number,
  batchesFailed: number,
  totalBatches: number
): Promise<void> {
  // Use standardized progress calculation
  await updateProgress(jobId, 'brightdata_collection', undefined, {
    completed: batchesCompleted,
    total: totalBatches,
  });
  
  await db.collection(PIPELINE_COLLECTION).doc(jobId).update({
    'brightdata_collection.batches_completed': batchesCompleted,
    'brightdata_collection.batches_processing': batchesProcessing,
    'brightdata_collection.batches_failed': batchesFailed,
    'brightdata_collection.total_batches': totalBatches,
    updated_at: Timestamp.now(),
  });
  
  logger.debug('pipeline_batch_counters_updated', { job_id: jobId, completed: batchesCompleted, total: totalBatches });
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
  logger.info('pipeline_progress_finalized', { job_id: jobId });
}

/**
 * Update progressive top-N profiles after each batch completes
 * This merges all completed batches, sorts by fit_score, and saves the top N
 * so the frontend can display evaluated results incrementally
 */
export async function updateProgressiveTopN(
  jobId: string,
  batchesCompleted: number,
  topN: number
): Promise<void> {
  if (batchesCompleted === 0) {
    logger.debug('storage_progressive_update_skipped', { job_id: jobId, reason: 'no_batches_completed' });
    return;
  }

  // Get the actual completed batch indices from Firestore
  const jobDoc = await db.collection(PIPELINE_COLLECTION).doc(jobId).get();
  if (!jobDoc.exists) {
    logger.error('storage_progressive_job_missing', { job_id: jobId });
    return;
  }

  const jobData = jobDoc.data() as PipelineJobDocument;
  const completedBatchIndices: number[] = jobData.brightdata_collection?.completed_batch_indices || [];

  if (completedBatchIndices.length === 0) {
    logger.debug('storage_progressive_update_skipped', { job_id: jobId, reason: 'no_completed_batches' });
    return;
  }

  const allProfiles: Array<BrightDataUnifiedProfile & { fit_score?: number; fit_rationale?: string; fit_summary?: string }> = [];

  // Load only the actually completed batch files (handles out-of-order completion)
  for (const batchIndex of completedBatchIndices) {
    try {
      const batchProfiles = await loadBatchFromStorage(jobId, batchIndex);
      allProfiles.push(...batchProfiles);
    } catch (err) {
      logger.warn('storage_progressive_batch_load_failed', { job_id: jobId, batch_index: batchIndex, error: err });
    }
  }

  if (allProfiles.length === 0) {
    logger.debug('storage_progressive_no_profiles', { job_id: jobId, batch_count: batchesCompleted });
    return;
  }

  // Sort by fit_score descending (highest first)
  allProfiles.sort((a, b) => (b.fit_score || 0) - (a.fit_score || 0));

  // Take only top N profiles
  const progressiveTopN = allProfiles.slice(0, topN);

  // Save to progressive storage file
  const bucket = getBucket();
  const filePath = getProgressiveProfilesStoragePath(jobId);
  const file = bucket.file(filePath);

  const jsonContent = JSON.stringify(progressiveTopN, null, 2);
  const buffer = Buffer.from(jsonContent, 'utf-8');

  await file.save(buffer, {
    contentType: 'application/json',
    metadata: {
      cacheControl: 'no-cache', // Don't cache progressive results
      metadata: {
        jobId,
        profileCount: progressiveTopN.length.toString(),
        batchesCompleted: batchesCompleted.toString(),
        totalProfilesAnalyzed: allProfiles.length.toString(),
        updatedAt: new Date().toISOString(),
      },
    },
  });

  // Update Firestore with progressive profiles metadata
  // Note: Frontend API loads from storage path directly, no signed URL needed
  await db.collection(PIPELINE_COLLECTION).doc(jobId).update({
    progressive_profiles_storage_path: filePath,
    progressive_profiles_count: progressiveTopN.length,
    progressive_profiles_revision: FieldValue.increment(1),
    progressive_is_complete: false,
    updated_at: Timestamp.now(),
  });

  logger.info('storage_progressive_top_n_updated', {
    job_id: jobId,
    top_n: topN,
    profiles: progressiveTopN.length,
    batches_completed: batchesCompleted,
    total_analyzed: allProfiles.length,
  });
}

/**
 * Mark progressive results as complete (called when all batches finish)
 */
export async function finalizeProgressiveResults(jobId: string): Promise<void> {
  await db.collection(PIPELINE_COLLECTION).doc(jobId).update({
    progressive_is_complete: true,
    updated_at: Timestamp.now(),
  });
  logger.info('pipeline_progressive_complete', { job_id: jobId });
}
