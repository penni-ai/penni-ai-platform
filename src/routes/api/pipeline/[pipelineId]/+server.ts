import { ApiProblem, apiOk, handleApiRoute, requireUser } from '$lib/server/core';
import { firestore } from '$lib/server/core';
import { adminStorage } from '$lib/firebase/admin';

const PIPELINE_COLLECTION = 'pipeline_jobs';

interface PipelineJobDocument {
	job_id: string;
	business_description: string;
	status: 'pending' | 'running' | 'completed' | 'error' | 'cancelled';
	current_stage: string | null;
	completed_stages: string[];
	overall_progress: number;
	start_time?: { toMillis?: () => number; toDate?: () => Date } | number;
	end_time?: { toMillis?: () => number; toDate?: () => Date } | number | null;
	error_message?: string | null;
	created_at?: { toMillis?: () => number; toDate?: () => Date } | number;
	updated_at?: { toMillis?: () => number; toDate?: () => Date } | number;
	profiles_storage_url?: string;
	profiles_storage_path?: string;
	profiles_count?: number;
	uid?: string | null;
	campaign_id?: string | null;
	query_expansion?: {
		status: string;
		queries?: string[];
		completed_at?: { toMillis?: () => number; toDate?: () => Date } | number | null;
		error?: string | null;
	};
	weaviate_search?: {
		status: string;
		total_results?: number;
		deduplicated_results?: number;
		queries_executed?: number;
		completed_at?: { toMillis?: () => number; toDate?: () => Date } | number | null;
		error?: string | null;
	};
	brightdata_collection?: {
		status: string;
		profiles_requested?: number;
		profiles_collected?: number;
		batches_completed?: number;
		batches_processing?: number;
		batches_failed?: number;
		total_batches?: number;
		completed_at?: { toMillis?: () => number; toDate?: () => Date } | number | null;
		error?: string | null;
	};
	llm_analysis?: {
		status: string;
		profiles_analyzed?: number;
		completed_at?: { toMillis?: () => number; toDate?: () => Date } | number | null;
		error?: string | null;
	};
	pipeline_stats?: {
		queries_generated?: number;
		total_search_results?: number;
		deduplicated_results?: number;
		profiles_collected?: number;
		profiles_analyzed?: number;
	};
}

function timestampToMillis(value: unknown): number | null {
	if (!value) return null;
	if (typeof value === 'number') return value;
	if (value && typeof value === 'object' && 'toMillis' in value) {
		try {
			const result = (value as { toMillis: () => number }).toMillis();
			return typeof result === 'number' && Number.isFinite(result) ? result : null;
		} catch {
			return null;
		}
	}
	return null;
}

async function loadProfilesFromStorage(storagePath: string): Promise<any[]> {
	try {
		// Get bucket name from environment or use default
		const bucketName = process.env.STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET || 'penni-ai-platform.firebasestorage.app';
		const bucket = adminStorage.bucket(bucketName);
		const file = bucket.file(storagePath);
		
		const [exists] = await file.exists();
		if (!exists) {
			console.log(`[API] Storage file does not exist: ${storagePath} in bucket ${bucketName}`);
			return [];
		}
		
		const [contents] = await file.download();
		const profiles = JSON.parse(contents.toString('utf-8'));
		
		if (!Array.isArray(profiles)) {
			console.error(`[API] Profiles data is not an array: ${typeof profiles}`);
			return [];
		}
		
		console.log(`[API] Loaded ${profiles.length} profiles from ${storagePath}`);
		return profiles;
	} catch (error) {
		console.error(`[API] Error loading profiles from ${storagePath}:`, error);
		if (error instanceof Error) {
			console.error(`[API] Error details: ${error.message}`, error.stack);
		}
		return [];
	}
}

export const GET = handleApiRoute(async (event) => {
	const user = requireUser(event);
	const pipelineId = event.params.pipelineId;
	
	if (!pipelineId) {
		throw new ApiProblem({
			status: 400,
			code: 'PIPELINE_ID_REQUIRED',
			message: 'Pipeline ID is required.'
		});
	}
	
	const doc = await firestore.collection(PIPELINE_COLLECTION).doc(pipelineId).get();
	
	if (!doc.exists) {
		console.log(`[API] Pipeline ${pipelineId} not found in Firestore for user ${user.uid}`);
		throw new ApiProblem({
			status: 404,
			code: 'PIPELINE_NOT_FOUND',
			message: 'Pipeline not found.'
		});
	}
	
	const data = doc.data() as PipelineJobDocument;
	console.log(`[API] Pipeline ${pipelineId} found. Document uid: ${data.uid}, Requesting user uid: ${user.uid}`);

	let userOwnsPipeline = data.uid === user.uid;
	if (!userOwnsPipeline && (!data.uid || data.uid === null)) {
		console.log(`[API] Pipeline ${pipelineId} has no uid, checking campaign fallback for user ${user.uid}`);
		const fallbackCampaignSnapshot = await firestore
			.collection('users')
			.doc(user.uid)
			.collection('campaigns')
			.where('pipeline_id', '==', pipelineId)
			.limit(1)
			.get();
		userOwnsPipeline = !fallbackCampaignSnapshot.empty;
		console.log(`[API] Campaign fallback check for ${pipelineId}: ${userOwnsPipeline ? 'found' : 'not found'}`);
	}

	if (!userOwnsPipeline) {
		console.log(`[API] User ${user.uid} does not own pipeline ${pipelineId} (document uid: ${data.uid})`);
		throw new ApiProblem({
			status: 404,
			code: 'PIPELINE_NOT_FOUND',
			message: 'Pipeline not found.'
		});
	}
	
	// Load profiles from Storage if available
	let profiles: any[] = [];
	if (data.profiles_storage_path) {
		console.log(`[API] Loading profiles from storage path: ${data.profiles_storage_path}`);
		profiles = await loadProfilesFromStorage(data.profiles_storage_path);
		profiles.sort((a, b) => (b.fit_score ?? 0) - (a.fit_score ?? 0));
		console.log(`[API] Loaded ${profiles.length} profiles for pipeline ${pipelineId}`);
	}
	
	return apiOk({
		pipeline_id: data.job_id,
		status: data.status,
		current_stage: data.current_stage,
		completed_stages: data.completed_stages ?? [],
		overall_progress: data.overall_progress ?? 0,
		start_time: timestampToMillis(data.start_time),
		end_time: timestampToMillis(data.end_time),
		error_message: data.error_message ?? null,
		profiles_count: data.profiles_count ?? profiles.length,
		profiles_storage_url: data.profiles_storage_url,
		profiles: profiles,
		stages: {
			query_expansion: data.query_expansion ? {
				status: data.query_expansion.status,
				queries: data.query_expansion.queries ?? [],
				completed_at: timestampToMillis(data.query_expansion.completed_at),
				error: data.query_expansion.error ?? null
			} : null,
			weaviate_search: data.weaviate_search ? {
				status: data.weaviate_search.status,
				total_results: data.weaviate_search.total_results,
				deduplicated_results: data.weaviate_search.deduplicated_results,
				queries_executed: data.weaviate_search.queries_executed,
				completed_at: timestampToMillis(data.weaviate_search.completed_at),
				error: data.weaviate_search.error ?? null
			} : null,
			brightdata_collection: data.brightdata_collection ? {
				status: data.brightdata_collection.status,
				profiles_requested: data.brightdata_collection.profiles_requested,
				profiles_collected: data.brightdata_collection.profiles_collected,
				batches_completed: data.brightdata_collection.batches_completed,
				batches_processing: data.brightdata_collection.batches_processing,
				batches_failed: data.brightdata_collection.batches_failed,
				total_batches: data.brightdata_collection.total_batches,
				completed_at: timestampToMillis(data.brightdata_collection.completed_at),
				error: data.brightdata_collection.error ?? null
			} : null,
			llm_analysis: data.llm_analysis ? {
				status: data.llm_analysis.status,
				profiles_analyzed: data.llm_analysis.profiles_analyzed,
				completed_at: timestampToMillis(data.llm_analysis.completed_at),
				error: data.llm_analysis.error ?? null
			} : null
		},
		pipeline_stats: data.pipeline_stats
	});
}, { component: 'pipeline' });
