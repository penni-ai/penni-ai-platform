/**
 * Shared TypeScript types for campaign-related functionality
 */

export type MessageSource = {
	title?: string;
	url: string;
	query?: string;
};

export type ApiMessage = {
	id: string;
	role: 'assistant' | 'user';
	content: string;
	type?: 'intro' | 'text' | 'summary';
	createdAt: string;
	sources?: MessageSource[];
};

export type ConversationResponse = {
	conversation: {
		id: string;
		status: 'collecting' | 'ready' | 'searching' | 'complete' | 'needs_config' | 'error';
		collected: Record<string, string | undefined>;
		missing: string[];
		search?: {
			status: 'idle' | 'pending' | 'complete' | 'error' | 'needs_config';
			results?: unknown;
			lastError?: string | null;
		};
		messages: ApiMessage[];
		keywords: string[];
		followerRange: { min: number | null; max: number | null };
	};
};

export type PipelineStageStatus = {
	status: string;
	queries?: string[];
	deduplicated_results?: number;
	profiles_collected?: number;
	batches_completed?: number;
	total_batches?: number;
	profiles_analyzed?: number;
};

export type PipelineStages = {
	query_expansion?: PipelineStageStatus | null;
	weaviate_search?: PipelineStageStatus | null;
	brightdata_collection?: PipelineStageStatus | null;
	llm_analysis?: PipelineStageStatus | null;
};

export type InfluencerProfile = {
	profile_url?: string;
	display_name?: string;
	followers?: number;
	fit_score?: number;
	fit_rationale?: string;
	platform?: string;
	biography?: string;
	bio?: string;
	email_address?: string;
	business_email?: string;
	_id?: string; // Unique identifier for tracking
	[key: string]: unknown; // Allow additional properties
};

export type PipelineStatus = {
	status: 'pending' | 'running' | 'completed' | 'error' | 'cancelled';
	current_stage: string | null;
	completed_stages: string[];
	overall_progress: number;
	profiles_count: number;
	profiles: InfluencerProfile[];
	preliminary_candidates?: InfluencerProfile[]; // Low-fidelity candidates from Weaviate search (before LLM analysis)
	stages: PipelineStages;
	error_message?: string | null;
};

export type Influencer = {
	_id?: string;
	display_name?: string;
	platform?: string;
	email_address?: string;
	business_email?: string;
	profile_url?: string;
	biography?: string;
	bio?: string;
	followers?: number;
	fit_score?: number;
	fit_rationale?: string;
	[key: string]: unknown; // Allow additional properties
};

export type SearchUsage = {
	count: number;
	limit: number;
	remaining: number;
	resetDate: number;
};

export type SearchParams = {
	business_description: string;
	top_n: number;
	min_followers: number | null;
	max_followers: number | null;
	campaign_id: string | null;
};

export type SearchResult = {
	job_id: string;
	profiles_count: number;
	profiles_storage_url: string | null;
};

export type FollowerRange = {
	min: number | null;
	max: number | null;
};

export type CollectedData = Record<string, string | undefined>;

