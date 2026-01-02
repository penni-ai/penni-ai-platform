import { Timestamp, type Query } from 'firebase-admin/firestore';
import { firestore } from '$lib/server/core';

export type PipelineRunStatus = 'pending' | 'running' | 'completed' | 'error' | 'cancelled';
export type PipelineBatchType = 'cache' | 'brightdata';
export type PipelineBatchStatus = 'pending' | 'running' | 'triggered' | 'completed' | 'failed' | 'skipped';

export type PipelineRunFilters = {
	status?: PipelineRunStatus;
	uid?: string;
	campaignId?: string;
	startMs?: number;
	endMs?: number;
	limit?: number;
	cursor?: string;
};

export type PipelineRunRecord = {
	id: string;
	job_id?: string;
	uid?: string | null;
	campaign_id?: string | null;
	status?: string;
	current_stage?: string | null;
	overall_progress?: number;
	created_at?: number | null;
	updated_at?: number | null;
	start_time?: number | null;
	end_time?: number | null;
	profiles_count?: number;
	remaining_profiles_count?: number;
	progressive_profiles_count?: number;
	cache_batches_total?: number;
	cache_batches_completed?: number;
	cache_batches_failed?: number;
	brightdata_in_flight?: number;
	good_fit_count?: number;
	stop_requested?: boolean;
	pipeline_stats?: Record<string, unknown> | null;
	pipeline_summary?: string | null;
	pipeline_waterfall?: string | null;
	stages?: Record<string, unknown> | null;
	timing?: Record<string, unknown> | null;
	storage?: {
		profiles_storage_path?: string | null;
		remaining_profiles_storage_path?: string | null;
		progressive_profiles_storage_path?: string | null;
		candidates_storage_path?: string | null;
	};
};

export type PipelineBatchRecord = {
	id: string;
	batch_id?: number;
	type?: PipelineBatchType | string;
	platform?: string | null;
	status?: PipelineBatchStatus | string;
	urls?: string[];
	snapshot_id?: string | null;
	poll_attempts?: number;
	started_at?: number | null;
	triggered_at?: number | null;
	completed_at?: number | null;
	created_at?: number | null;
	updated_at?: number | null;
	last_error?: string | null;
};

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;
const PIPELINE_COLLECTION = 'pipeline_jobs';
const BATCH_COLLECTION = 'batches';

const toMillis = (value: unknown): number | null => {
	if (!value) return null;
	if (typeof value === 'number') return value;
	if (value instanceof Date) return value.getTime();
	if (typeof value === 'object' && 'toMillis' in value) {
		try {
			const result = (value as { toMillis: () => number }).toMillis();
			return typeof result === 'number' && Number.isFinite(result) ? result : null;
		} catch {
			return null;
		}
	}
	return null;
};

const toSerializable = (value: unknown): unknown => {
	if (value === null || value === undefined) return value;
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
	if (typeof value === 'bigint') return value.toString();

	const millis = toMillis(value);
	if (millis !== null) return millis;

	if (Array.isArray(value)) {
		return value.map((item) => toSerializable(item));
	}

	if (typeof value !== 'object') return null;

	const record: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
		record[key] = toSerializable(entry);
	}
	return record;
};

export const parsePipelineRunQuery = (params: URLSearchParams) => {
	const errors: string[] = [];
	const statusRaw = params.get('status');
	const statusValue = statusRaw ? statusRaw.toLowerCase() : null;
	const status = statusValue && isPipelineStatus(statusValue) ? (statusValue as PipelineRunStatus) : undefined;
	if (statusRaw && !status) {
		errors.push(`Invalid status: ${statusRaw}`);
	}

	const uid = cleanString(params.get('uid'));
	const campaignId = cleanString(params.get('campaign_id'));

	const startInput = params.get('start');
	const endInput = params.get('end');
	const startMs = startInput ? parseDateInput(startInput, false) : undefined;
	const endMs = endInput ? parseDateInput(endInput, true) : undefined;

	if (startInput && startMs === null) {
		errors.push(`Invalid start date: ${startInput}`);
	}
	if (endInput && endMs === null) {
		errors.push(`Invalid end date: ${endInput}`);
	}

	let limit = DEFAULT_LIMIT;
	const limitRaw = params.get('limit');
	if (limitRaw) {
		const parsed = Number(limitRaw);
		if (!Number.isFinite(parsed) || parsed <= 0) {
			errors.push(`Invalid limit: ${limitRaw}`);
		} else {
			limit = Math.min(Math.max(Math.floor(parsed), 1), MAX_LIMIT);
		}
	}

	const cursor = cleanString(params.get('cursor'));

	return {
		filters: {
			status,
			uid,
			campaignId,
			startMs: startMs ?? undefined,
			endMs: endMs ?? undefined,
			limit,
			cursor
		},
		inputs: {
			status: status ?? '',
			uid: uid ?? '',
			campaignId: campaignId ?? '',
			start: startInput ?? '',
			end: endInput ?? ''
		},
		errors
	};
};

export async function listPipelineRuns(filters: PipelineRunFilters) {
	let query: Query = firestore.collection(PIPELINE_COLLECTION);

	if (filters.status) {
		query = query.where('status', '==', filters.status);
	}
	if (filters.uid) {
		query = query.where('uid', '==', filters.uid);
	}
	if (filters.campaignId) {
		query = query.where('campaign_id', '==', filters.campaignId);
	}
	if (typeof filters.startMs === 'number') {
		query = query.where('created_at', '>=', Timestamp.fromMillis(filters.startMs));
	}
	if (typeof filters.endMs === 'number') {
		query = query.where('created_at', '<=', Timestamp.fromMillis(filters.endMs));
	}

	query = query.orderBy('created_at', 'desc');

	if (filters.cursor) {
		const cursorSnap = await firestore.collection(PIPELINE_COLLECTION).doc(filters.cursor).get();
		if (cursorSnap.exists) {
			query = query.startAfter(cursorSnap);
		}
	}

	const limit = Math.min(filters.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
	query = query.limit(limit);

	const snapshot = await query.get();
	const runs = snapshot.docs.map((doc) => serializePipelineRun(doc.id, doc.data()));
	const nextCursor = snapshot.size === limit ? snapshot.docs[snapshot.docs.length - 1]?.id ?? null : null;

	return { runs, nextCursor };
}

export async function getPipelineRun(pipelineId: string): Promise<PipelineRunRecord | null> {
	const snap = await firestore.collection(PIPELINE_COLLECTION).doc(pipelineId).get();
	if (!snap.exists) return null;
	const data = snap.data();
	if (!data) return null;
	return serializePipelineRun(snap.id, data);
}

export async function listPipelineBatches(pipelineId: string): Promise<PipelineBatchRecord[]> {
	const snap = await firestore
		.collection(PIPELINE_COLLECTION)
		.doc(pipelineId)
		.collection(BATCH_COLLECTION)
		.orderBy('batch_id', 'asc')
		.get();

	if (snap.empty) return [];
	return snap.docs.map((doc) => serializePipelineBatch(doc.id, doc.data()));
}

const serializePipelineRun = (id: string, data: FirebaseFirestore.DocumentData): PipelineRunRecord => {
	return {
		id,
		job_id: typeof data.job_id === 'string' ? data.job_id : undefined,
		uid: typeof data.uid === 'string' ? data.uid : null,
		campaign_id: typeof data.campaign_id === 'string' ? data.campaign_id : null,
		status: typeof data.status === 'string' ? data.status : undefined,
		current_stage: typeof data.current_stage === 'string' ? data.current_stage : null,
		overall_progress: typeof data.overall_progress === 'number' ? data.overall_progress : undefined,
		created_at: toMillis(data.created_at),
		updated_at: toMillis(data.updated_at),
		start_time: toMillis(data.start_time),
		end_time: toMillis(data.end_time),
		profiles_count: typeof data.profiles_count === 'number' ? data.profiles_count : undefined,
		remaining_profiles_count:
			typeof data.remaining_profiles_count === 'number' ? data.remaining_profiles_count : undefined,
		progressive_profiles_count:
			typeof data.progressive_profiles_count === 'number' ? data.progressive_profiles_count : undefined,
		cache_batches_total: typeof data.cache_batches_total === 'number' ? data.cache_batches_total : undefined,
		cache_batches_completed:
			typeof data.cache_batches_completed === 'number' ? data.cache_batches_completed : undefined,
		cache_batches_failed: typeof data.cache_batches_failed === 'number' ? data.cache_batches_failed : undefined,
		brightdata_in_flight: typeof data.brightdata_in_flight === 'number' ? data.brightdata_in_flight : undefined,
		good_fit_count: typeof data.good_fit_count === 'number' ? data.good_fit_count : undefined,
		stop_requested: typeof data.stop_requested === 'boolean' ? data.stop_requested : undefined,
		pipeline_stats: data.pipeline_stats ? (data.pipeline_stats as Record<string, unknown>) : null,
		pipeline_summary: typeof data.pipeline_summary === 'string' ? data.pipeline_summary : null,
		pipeline_waterfall: typeof data.pipeline_waterfall === 'string' ? data.pipeline_waterfall : null,
		stages: toSerializable({
			query_expansion: data.query_expansion ?? null,
			weaviate_search: data.weaviate_search ?? null,
			brightdata_collection: data.brightdata_collection ?? null,
			llm_analysis: data.llm_analysis ?? null
		}) as Record<string, unknown>,
		timing: (data.timing ? toSerializable(data.timing) : null) as Record<string, unknown> | null,
		storage: {
			profiles_storage_path:
				typeof data.profiles_storage_path === 'string' ? data.profiles_storage_path : null,
			remaining_profiles_storage_path:
				typeof data.remaining_profiles_storage_path === 'string'
					? data.remaining_profiles_storage_path
					: null,
			progressive_profiles_storage_path:
				typeof data.progressive_profiles_storage_path === 'string'
					? data.progressive_profiles_storage_path
					: null,
			candidates_storage_path:
				typeof data.candidates_storage_path === 'string' ? data.candidates_storage_path : null
		}
	};
};

const serializePipelineBatch = (id: string, data: FirebaseFirestore.DocumentData): PipelineBatchRecord => {
	return {
		id,
		batch_id: typeof data.batch_id === 'number' ? data.batch_id : undefined,
		type: typeof data.type === 'string' ? data.type : undefined,
		platform: typeof data.platform === 'string' ? data.platform : null,
		status: typeof data.status === 'string' ? data.status : undefined,
		urls: Array.isArray(data.urls) ? data.urls.filter((value: unknown) => typeof value === 'string') : [],
		snapshot_id: typeof data.snapshot_id === 'string' ? data.snapshot_id : null,
		poll_attempts: typeof data.poll_attempts === 'number' ? data.poll_attempts : undefined,
		started_at: toMillis(data.started_at),
		triggered_at: toMillis(data.triggered_at),
		completed_at: toMillis(data.completed_at),
		created_at: toMillis(data.created_at),
		updated_at: toMillis(data.updated_at),
		last_error: typeof data.last_error === 'string' ? data.last_error : null
	};
};

const cleanString = (value: string | null): string | undefined => {
	if (!value) return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
};

const isPipelineStatus = (value: string): value is PipelineRunStatus =>
	value === 'pending' ||
	value === 'running' ||
	value === 'completed' ||
	value === 'error' ||
	value === 'cancelled';

const parseDateInput = (value: string, endOfDay: boolean): number | null => {
	if (!value) return null;

	if (/^\d+$/.test(value)) {
		const ms = Number(value);
		return Number.isFinite(ms) ? ms : null;
	}

	const parsed = Date.parse(value);
	if (Number.isNaN(parsed)) return null;

	const date = new Date(parsed);
	const hasTime = value.includes('T') || value.includes(':');
	if (!hasTime) {
		if (endOfDay) {
			date.setHours(23, 59, 59, 999);
		} else {
			date.setHours(0, 0, 0, 0);
		}
	}

	return date.getTime();
};
