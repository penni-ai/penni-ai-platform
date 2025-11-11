/**
 * Shared type definitions for the creator search pipeline.
 *
 * Mirrors the Pydantic models defined in functions/runtime/models/search.py so
 * that both the API layer and frontend share a single contract.
 */

/**
 * Search parameters used by the pipeline's first stage.
 *
 * The `query` string is a natural-language brief that the backend expands into
 * 12 influencer queries (4 broad + 2 specific + 6 adjacent). Each query is
 * executed with 3 alpha blends (0.2, 0.5, 0.8), resulting in 36 Weaviate hybrid
 * searches per request.
 *
 * Defaults (managed by the Cloud Function):
 * - method: 'hybrid'
 * - limit: 20 (min 1, max 50_000)
 * - lexical_scope: 'bio'
 *
 * Advanced Weaviate tuning parameters (`weaviate_*`) are optional and should only
 * be set when you need to override the platform-wide defaults for search depth
 * or hybrid blending behavior.
 */
export interface SearchRequest {
  /** Natural-language brand brief expanded into 12 influencer queries (4 broad + 2 specific + 6 adjacent). */
  query: string;
  /** Search strategy: vector, lexical, or blended. */
  method?: 'lexical' | 'semantic' | 'hybrid';
  /** Maximum number of raw results to pull before reranking. */
  limit?: number;
  min_followers?: number | null;
  max_followers?: number | null;
  min_engagement?: number | null;
  max_engagement?: number | null;
  location?: string | null;
  category?: string | null;
  is_verified?: boolean | null;
  is_business_account?: boolean | null;
  /** Whether lexical search should look at bio only or include recent posts. */
  lexical_scope?: 'bio' | 'bio_posts';
  /**
   * Maximum unique profiles to collect across the 12-query x 3-alpha (36 total) Weaviate searches
   * before sorting and applying the final limit. Must be between 1 and 10,000.
   * @default 1000
   */
  weaviate_top_n?: number | null;
  /**
   * Number of results to fetch per individual query x alpha combination in Weaviate.
   * With 12 queries and 3 alphas, the default 500 setting can return up to 18,000 raw
   * results before deduplication. Higher values add recall but increase latency and cost.
   * Must be between 1 and 1,000.
   * @default 500
   */
  weaviate_results_per_query?: number | null;
  /**
   * Alpha values for Weaviate hybrid search. Each value controls the blend between
   * keyword (0.0) and semantic (1.0) matching. Multiple values enable multi-strategy
   * searches. Every value must be between 0.0 and 1.0.
   * @default [0.2, 0.5, 0.8]
   * @example [0.2, 0.5, 0.8] // Default triple: keyword-heavy, balanced, semantic-heavy
   * @example [0.0, 1.0]
   */
  weaviate_alpha_values?: number[] | null;
}

/**
 * Request payload forwarded to the Cloud Function orchestrator.
 *
 * Set `stop_at_stage` when you want to return results after SEARCH or BRIGHTDATA
 * without running the entire pipeline.
 */
export const STAGE_NAMES = ['SEARCH', 'BRIGHTDATA', 'LLM_FIT'] as const;
export type StageName = (typeof STAGE_NAMES)[number];

export interface SearchPipelineRequest {
  /** Search parameters forwarded to the search stage. */
  search: SearchRequest;
  /** Business or campaign brief used by the LLM fit stage (required). */
  business_fit_query: string;
  max_profiles?: number | null;
  max_posts?: number;
  model?: string;
  verbosity?: string;
  concurrency?: number;
  debug_mode?: boolean;
  /** Stop pipeline execution after this stage (optional, defaults to full pipeline). */
  stop_at_stage?: StageName | null;
}

export const PIPELINE_RUN_STATUSES = ['running', 'completed', 'error'] as const;
export type PipelineRunStatus = (typeof PIPELINE_RUN_STATUSES)[number];

export const PIPELINE_STAGE_STATUSES = ['pending', 'running', 'completed', 'error'] as const;
export type PipelineStageStatus = (typeof PIPELINE_STAGE_STATUSES)[number];

type TimestampLike = Date | { toDate: () => Date } | null;

export interface PipelineStatus {
  pipeline_id: string;
  userId: string;
  status: PipelineRunStatus;
  current_stage: StageName | null;
  completed_stages: StageName[];
  overall_progress: number;
  start_time?: TimestampLike;
  end_time?: TimestampLike;
  error_message?: string | null;
  created_at?: TimestampLike;
  updated_at?: TimestampLike;
}

export interface PipelineStageDocument {
  pipeline_id: string;
  userId: string;
  stage: StageName;
  status: PipelineStageStatus;
  profiles: CreatorProfile[];
  debug: Record<string, unknown>;
  metadata: Record<string, unknown>;
  error_message?: string | null;
  created_at?: TimestampLike;
  updated_at?: TimestampLike;
}

export interface ProgressEvent {
  type: 'progress';
  pipeline_id: string;
  status: PipelineRunStatus;
  stage: StageName | null;
  completed_stages: StageName[];
  progress: number;
}

export interface StageCompleteEvent {
  type: 'stage_complete';
  pipeline_id: string;
  stage: StageName;
  count?: number;
}

export interface CompleteEvent {
  type: 'complete';
  pipeline_id: string;
  /**
   * Full pipeline stage documents for every stage (SEARCH -> LLM_FIT) that completed.
   * This intentionally includes intermediate stages so clients can inspect metadata
   * and debug information without issuing additional API requests. Pipelines stopped
   * early via `stop_at_stage` will only include the stages that actually ran.
   */
  stages: PipelineStageDocument[];
}

export interface ErrorEvent {
  type: 'error';
  pipeline_id: string;
  message: string;
  stage?: StageName | null;
}

export type StreamEvent = ProgressEvent | StageCompleteEvent | CompleteEvent | ErrorEvent;

/**
 * Telemetry emitted for each stage of the pipeline.
 */
export interface PipelineStageEvent {
  stage: StageName;
  data: Record<string, unknown>;
}

/**
 * Shape of individual creator records returned by the pipeline.
 */
export interface CreatorProfile {
  lance_db_id?: string;
  account?: string;
  username?: string;
  display_name?: string;
  profile_url?: string;
  business_email?: string;
  email_address?: string;
  platform?: string;
  platform_type?: string;
  url?: string;
  followers?: number;
  avg_engagement?: number;
  biography?: string;
  fit_score?: number;
  fit_rationale?: string;
  [key: string]: unknown;
}

/**
 * Response body returned to clients once the pipeline completes (or fails).
 */
export interface SearchPipelineResponse {
  success: boolean;
  results: CreatorProfile[];
  brightdata_results: Array<Record<string, unknown>>;
  profile_fit: Array<Record<string, unknown>>;
  stages: PipelineStageEvent[];
  count: number;
  pipeline_id?: string | null;
  pipeline_status_path?: string | null;
  debug_summary?: Record<string, unknown> | null;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object';

const isStageName = (value: unknown): value is StageName =>
  typeof value === 'string' && STAGE_NAMES.includes(value as StageName);

const isPipelineRunStatus = (value: unknown): value is PipelineRunStatus =>
  typeof value === 'string' && PIPELINE_RUN_STATUSES.includes(value as PipelineRunStatus);

const isPipelineStageStatus = (value: unknown): value is PipelineStageStatus =>
  typeof value === 'string' && PIPELINE_STAGE_STATUSES.includes(value as PipelineStageStatus);

export const isPipelineStatus = (value: unknown): value is PipelineStatus => {
  if (!isObject(value)) return false;
  if (typeof value.pipeline_id !== 'string') return false;
  if (typeof value.userId !== 'string') return false;
  if (!isPipelineRunStatus(value.status)) return false;
  if (
    value.current_stage !== null &&
    value.current_stage !== undefined &&
    !isStageName(value.current_stage)
  ) {
    return false;
  }
  if (!Array.isArray(value.completed_stages) || !value.completed_stages.every(isStageName)) {
    return false;
  }
  if (typeof value.overall_progress !== 'number') {
    return false;
  }
  return true;
};

export const isPipelineStageDocument = (value: unknown): value is PipelineStageDocument => {
  if (!isObject(value)) return false;
  if (typeof value.pipeline_id !== 'string') return false;
  if (typeof value.userId !== 'string') return false;
  if (!isStageName(value.stage)) return false;
  if (!isPipelineStageStatus(value.status)) return false;
  if (!Array.isArray(value.profiles) || !value.profiles.every(isObject)) return false;
  if (!isObject(value.debug)) return false;
  if (!isObject(value.metadata)) return false;
  if (
    value.error_message !== undefined &&
    value.error_message !== null &&
    typeof value.error_message !== 'string'
  ) {
    return false;
  }
  return true;
};

/**
 * Runtime type guard for SearchPipelineRequest payloads.
 */
export const isSearchPipelineRequest = (
  value: unknown
): value is SearchPipelineRequest => {
  if (!isObject(value)) return false;
  if (!isObject(value.search)) return false;
  if (typeof (value as Record<string, unknown>).business_fit_query !== 'string') {
    return false;
  }

  const stopAtStage = (value as Record<string, unknown>).stop_at_stage;
  if (stopAtStage !== undefined && stopAtStage !== null) {
    if (typeof stopAtStage !== 'string' || !STAGE_NAMES.includes(stopAtStage as StageName)) {
      return false;
    }
  }

  const search = value.search as Record<string, unknown>;
  return typeof search.query === 'string' && search.query.trim().length > 0;
};

/**
 * Runtime type guard for SearchPipelineResponse payloads.
 */
export const isSearchPipelineResponse = (
  value: unknown
): value is SearchPipelineResponse => {
  if (!isObject(value)) return false;

  const record = value as Record<string, unknown>;
  return (
    typeof record.success === 'boolean' &&
    Array.isArray(record.results) &&
    typeof record.count === 'number'
  );
};
