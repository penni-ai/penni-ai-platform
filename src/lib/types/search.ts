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
  /**
   * Natural-language business brief describing your brand, audience, and desired creator traits. The backend expands
   * this single description into 12 influencer queries automatically.
   */
  query: string;
  /** Search strategy: vector, lexical, or blended. */
  method?: 'lexical' | 'semantic' | 'hybrid';
  /**
   * Fallback cap for the search stage when `max_profiles` is not supplied.
   * The backend uses whichever bound (this or `max_profiles`) is tighter when
   * slicing the final Weaviate result set.
   */
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

export const STAGE_NAMES = ['SEARCH', 'LIVE_ANALYSIS'] as const;
export type StageName = (typeof STAGE_NAMES)[number];

export interface SearchPipelineRequest {
  /** Provide the same business brief you would tell a teammate; backend expands it for discovery. */
  search: SearchRequest;
  /** Optional override for LLM fit; defaults to the same business brief as search.query. */
  business_fit_query: string;
  max_profiles?: number | null;
  max_posts?: number;
  model?: string;
  verbosity?: string;
  concurrency?: number;
}

export const PIPELINE_RUN_STATUSES = ['running', 'completed', 'error', 'cancelled'] as const;
export type PipelineRunStatus = (typeof PIPELINE_RUN_STATUSES)[number];

export const PIPELINE_STAGE_STATUSES = ['pending', 'running', 'completed', 'error'] as const;
export type PipelineStageStatus = (typeof PIPELINE_STAGE_STATUSES)[number];

export type TimestampLike = Date | { toDate: () => Date } | null;

export type StageMetadata = Record<string, unknown> & {
  expanded_queries?: string[];
};

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
  flow_metrics?: FlowMetrics;
  cancel_requested?: boolean;
  failed_batches?: {
    brightdata: number[];
    llm: number[];
  };
}

export interface PipelineStageDocument {
  pipeline_id: string;
  userId: string;
  stage: StageName;
  status: PipelineStageStatus;
  profiles: CreatorProfile[];
  debug: Record<string, unknown>;
  metadata: StageMetadata;
  error_message?: string | null;
  artifacts?: PipelineStageArtifacts;
  profiles_snapshot?: PipelineStageProfileSnapshot[];
  created_at?: TimestampLike;
  updated_at?: TimestampLike;
}

export interface PipelineStageProfileSnapshot {
  lance_db_id?: string | null;
  account?: string | null;
  username?: string | null;
  profile_url?: string | null;
  fit_score?: number | null;
  combined_score?: number | null;
  email_address?: string | null;
}

export interface StageArtifactRef {
  bucket?: string;
  name: string;
  size_bytes?: number;
  updated?: string | null;
}

export interface PipelineStageArtifacts {
  profiles?: StageArtifactRef;
  debug?: StageArtifactRef;
}

export interface PipelineStageSummaryMetadata {
  expanded_queries?: string[];
  input_size?: Record<string, number>;
  output_size?: Record<string, number>;
}

export interface PipelineStageSummary {
  stage: StageName;
  status: PipelineStageStatus;
  count: number;
  /** Firestore document path for the persisted stage payload. */
  stage_document_path: string;
  metadata?: PipelineStageSummaryMetadata;
}

export interface PipelineBatchDocument {
  pipeline_id: string;
  userId: string;
  /** Legacy sequential index (0-based). */
  seq?: number;
  /** Canonical batch index used by the UI listeners. */
  batch_index?: number;
  input_count?: number;
  deduped_kept?: number;
  deduped_discarded?: number;
  brightdata_success?: number;
  brightdata_dead?: number;
  llm_above_5?: number;
  llm_below_5?: number;
  /** Slim per-batch delta emitted to the UI. */
  profiles?: BatchProfileDelta[];
  profiles_snapshot_count?: number;
  profiles_total_in_batch?: number;
  metrics?: {
    llm_above_5?: number;
    llm_below_5?: number;
    [key: string]: number | undefined;
  };
  storage_paths?: Array<{
    batch_index: number;
    brightdata?: string | null;
    llm?: string | null;
  }>;
  timing?: {
    brightdata_ms?: number | null;
    llm_ms?: number | null;
    total_ms?: number | null;
  };
  errors?: string[];
  status?: string;
  created_at?: TimestampLike;
  updated_at?: TimestampLike;
}

export interface BatchProfileDelta {
  id?: number | null;
  lance_db_id?: string | null;
  account?: string | null;
  username?: string | null;
  profile_url?: string | null;
  display_name?: string | null;
  profile_name?: string | null;
  platform?: string | null;
  fit_score?: number | null;
  fit_rationale?: string | null;
  email_address?: string | null;
  business_email?: string | null;
}

export interface FlowMetrics {
  initial_count: number;
  deduped_kept: number;
  deduped_discarded: number;
  brightdata_success: number;
  brightdata_dead: number;
  llm_above_5: number;
  llm_below_5: number;
  completed_batches: number;
  total_batches: number;
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

export interface SearchMetricsEvent {
  type: 'search_metrics';
  pipeline_id: string;
  initial_found: number;
  deduped_kept: number;
  deduped_discarded: number;
}

export interface BatchCompleteEvent {
  type: 'batch_complete';
  pipeline_id: string;
  batch: PipelineBatchDocument;
}

export interface FlowMetricsEvent {
  type: 'flow_metrics';
  pipeline_id: string;
  metrics: FlowMetrics;
}

export interface ExpandedQueriesEvent {
  type: 'expanded_queries';
  pipeline_id: string;
  queries: string[];
}

export interface CompleteEvent {
  type: 'complete';
  pipeline_id: string;
  /** Lightweight summaries for every completed stage. */
  summary: PipelineStageSummary[];
  /** Full documents for each stage. */
  stages?: PipelineStageDocument[];
  flow_metrics?: FlowMetrics;
}

export interface ErrorEvent {
  type: 'error';
  pipeline_id: string;
  message: string;
  stage?: StageName | null;
}

export interface CancelledEvent {
  type: 'cancelled';
  pipeline_id: string;
  message?: string;
  stage?: StageName | null;
}

export type StreamEvent =
  | ProgressEvent
  | StageCompleteEvent
  | CompleteEvent
  | ErrorEvent
  | CancelledEvent
  | SearchMetricsEvent
  | BatchCompleteEvent
  | FlowMetricsEvent
  | ExpandedQueriesEvent;

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
  profile_name?: string;
  profile_url?: string;
  business_email?: string;
  email_address?: string;
  business_address?: string;
  location?: string;
  platform?: string;
  platform_type?: string;
  url?: string;
  followers?: number;
  avg_engagement?: number;
  engagement_rate?: number;
  biography?: string;
  bio?: string;
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

/**
 * Minimal acknowledgment returned immediately after the orchestrator starts running.
 */
export interface SearchPipelineAcknowledgment {
  pipeline_id: string;
  pipeline_status_path: string;
  status: 'running';
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object';

const isStageName = (value: unknown): value is StageName =>
  typeof value === 'string' && STAGE_NAMES.includes(value as StageName);

const isPipelineRunStatus = (value: unknown): value is PipelineRunStatus =>
  typeof value === 'string' && PIPELINE_RUN_STATUSES.includes(value as PipelineRunStatus);

const isPipelineStageStatus = (value: unknown): value is PipelineStageStatus =>
  typeof value === 'string' && PIPELINE_STAGE_STATUSES.includes(value as PipelineStageStatus);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const isFlowMetrics = (value: unknown): value is FlowMetrics => {
  if (!isObject(value)) return false;
  const requiredKeys: Array<keyof FlowMetrics> = [
    'initial_count',
    'deduped_kept',
    'deduped_discarded',
    'brightdata_success',
    'brightdata_dead',
    'llm_above_5',
    'llm_below_5',
    'completed_batches',
    'total_batches'
  ];
  return requiredKeys.every((key) => typeof value[key] === 'number');
};

const isStageArtifactRef = (value: unknown): value is StageArtifactRef => {
  if (!isObject(value)) return false;
  if (typeof (value as Record<string, unknown>).name !== 'string') return false;
  const bucket = (value as Record<string, unknown>).bucket;
  if (bucket !== undefined && bucket !== null && typeof bucket !== 'string') return false;
  const size = (value as Record<string, unknown>).size_bytes;
  if (size !== undefined && size !== null && typeof size !== 'number') return false;
  const updated = (value as Record<string, unknown>).updated;
  if (updated !== undefined && updated !== null && typeof updated !== 'string') return false;
  return true;
};

const isPipelineStageArtifacts = (value: unknown): value is PipelineStageArtifacts => {
  if (!isObject(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.profiles !== undefined && record.profiles !== null && !isStageArtifactRef(record.profiles)) {
    return false;
  }
  if (record.debug !== undefined && record.debug !== null && !isStageArtifactRef(record.debug)) {
    return false;
  }
  return true;
};

const isPipelineStageProfileSnapshot = (value: unknown): value is PipelineStageProfileSnapshot => {
  if (!isObject(value)) return false;
  const record = value as Record<string, unknown>;
  const stringKeys = ['lance_db_id', 'account', 'username', 'profile_url', 'email_address'];
  for (const key of stringKeys) {
    const raw = record[key];
    if (raw !== undefined && raw !== null && typeof raw !== 'string') {
      return false;
    }
  }
  const numberKeys = ['fit_score', 'combined_score'];
  for (const key of numberKeys) {
    const raw = record[key];
    if (raw !== undefined && raw !== null && typeof raw !== 'number') {
      return false;
    }
  }
  return true;
};

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
  if (value.flow_metrics !== undefined && value.flow_metrics !== null && !isFlowMetrics(value.flow_metrics)) {
    return false;
  }
  if (
    value.cancel_requested !== undefined &&
    value.cancel_requested !== null &&
    typeof value.cancel_requested !== 'boolean'
  ) {
    return false;
  }
  if (value.failed_batches !== undefined && value.failed_batches !== null) {
    const failed = value.failed_batches as Record<string, unknown>;
    const bright = failed.brightdata;
    const llm = failed.llm;
    const isNumberArray = (input: unknown) => Array.isArray(input) && input.every((item) => typeof item === 'number');
    if (!isNumberArray(bright) || !isNumberArray(llm)) {
      return false;
    }
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
  const metadata = value.metadata as Record<string, unknown>;
  if (
    metadata.expanded_queries !== undefined &&
    metadata.expanded_queries !== null &&
    !isStringArray(metadata.expanded_queries)
  ) {
    return false;
  }
  if (
    value.error_message !== undefined &&
    value.error_message !== null &&
    typeof value.error_message !== 'string'
  ) {
    return false;
  }
  if (
    value.artifacts !== undefined &&
    value.artifacts !== null &&
    !isPipelineStageArtifacts(value.artifacts)
  ) {
    return false;
  }
  if (
    value.profiles_snapshot !== undefined &&
    value.profiles_snapshot !== null &&
    (!Array.isArray(value.profiles_snapshot) ||
      !value.profiles_snapshot.every(isPipelineStageProfileSnapshot))
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

  const search = value.search as Record<string, unknown>;
  return typeof search.query === 'string' && search.query.trim().length > 0;
};

/**
 * Runtime type guard for SearchPipelineAcknowledgment payloads.
 */
export const isSearchPipelineAcknowledgment = (
  value: unknown
): value is SearchPipelineAcknowledgment => {
  if (!isObject(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.pipeline_id === 'string' &&
    typeof record.pipeline_status_path === 'string' &&
    record.status === 'running'
  );
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
