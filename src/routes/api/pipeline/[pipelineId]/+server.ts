import { ApiProblem, apiOk, handleApiRoute, requireUser } from '$lib/server/core';
import {
	campaignProfilesCollectionRef,
	firestore,
	pipelineDocRef,
	pipelineProfileRefsCollectionRef
} from '$lib/server/core';
import { adminStorage } from '$lib/firebase/admin';
import { getProfileId } from '$lib/utils/campaign';
import { FieldValue } from 'firebase-admin/firestore';

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
	remaining_profiles_storage_url?: string;
	remaining_profiles_storage_path?: string;
	remaining_profiles_count?: number;
	candidates_storage_url?: string;
	candidates_storage_path?: string;
	// Progressive results (updated after each batch)
	progressive_profiles_storage_url?: string;
	progressive_profiles_storage_path?: string;
	progressive_profiles_count?: number;
	progressive_is_complete?: boolean;
	uid?: string | null;
	campaign_id?: string | null;
	query_expansion?: {
		status: string;
		queries?: string[];
		prompt?: string; // The full prompt sent to the LLM for query generation
		completed_at?: { toMillis?: () => number; toDate?: () => Date } | number | null;
		error?: string | null;
	};
	weaviate_search?: {
		status: string;
		total_results?: number;
		deduplicated_results?: number;
		queries_executed?: number;
		candidates_count?: number;
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

async function upsertPipelineDoc(options: {
	uid: string;
	campaignId: string;
	pipelineId: string;
	status: string;
	counts?: { final?: number; prelim?: number; contactable?: number };
	storage?: { profiles_path?: string | null; prelim_path?: string | null; remaining_path?: string | null };
	stageMeta?: Record<string, unknown>;
}) {
	const { uid, campaignId, pipelineId, status, counts, storage, stageMeta } = options;
	const docRef = pipelineDocRef(uid, campaignId, pipelineId);
	await docRef.set(
		{
			status,
			completed_at: Date.now(),
			counts: {
				final_count: counts?.final ?? FieldValue.delete(),
				prelim_count: counts?.prelim ?? FieldValue.delete(),
				contactable_count: counts?.contactable ?? FieldValue.delete()
			},
			storage: storage ?? FieldValue.delete(),
			stage_meta: stageMeta ?? FieldValue.delete()
		},
		{ merge: true }
	);
}

async function ingestProfiles(options: {
	uid: string;
	campaignId: string;
	pipelineId: string;
	profiles: any[];
}) {
	const { uid, campaignId, pipelineId, profiles } = options;
	if (!profiles || profiles.length === 0) return;
	const profileCol = campaignProfilesCollectionRef(uid, campaignId);
	const refsCol = pipelineProfileRefsCollectionRef(uid, campaignId, pipelineId);
	const chunks: any[][] = [];
	for (let i = 0; i < profiles.length; i += 400) {
		chunks.push(profiles.slice(i, i + 400));
	}
	for (const chunk of chunks) {
		const batch = firestore.batch();
		chunk.forEach((profile: any, index: number) => {
			const profileId = getProfileId(profile);
			const now = Date.now();
			const contactable = Boolean(profile?.email_address || profile?.business_email);
			const profileRef = profileCol.doc(profileId);
			batch.set(
				profileRef,
				{
					profile_url: profile.profile_url ?? null,
					platform: profile.platform ?? null,
					display_name: profile.display_name ?? null,
					followers: typeof profile.followers === 'number' ? profile.followers : null,
					bio: profile.bio ?? profile.biography ?? null,
					email_address: profile.email_address ?? null,
					business_email: profile.business_email ?? null,
					first_seen_at: FieldValue.serverTimestamp(),
					last_seen_at: now,
					first_pipeline_id: pipelineId,
					last_pipeline_id: pipelineId,
					times_seen: FieldValue.increment(1),
					best_fit_score: typeof profile.fit_score === 'number' ? profile.fit_score : FieldValue.delete(),
					contactable
				},
				{ merge: true }
			);

			const refDoc = refsCol.doc(profileId);
			batch.set(
				refDoc,
				{
					profile_id: profileId,
					fit_score: profile.fit_score ?? null,
					rank: profile.rank ?? index,
					contactable,
					profile_url: profile.profile_url ?? null
				},
				{ merge: true }
			);
		});
		await batch.commit();
	}

	// Mark pipeline ingested
	await pipelineDocRef(uid, campaignId, pipelineId).set({ ingested: true }, { merge: true });
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
		const resolvedProjectId =
			process.env.GOOGLE_CLOUD_PROJECT ||
			process.env.FIREBASE_PROJECT_ID ||
			(adminStorage.app.options.projectId || 'penni-ai-platform');
		const fallbackBucket = `${resolvedProjectId}.firebasestorage.app`;
		const bucketName =
			process.env.STORAGE_BUCKET ||
			process.env.FIREBASE_STORAGE_BUCKET ||
			adminStorage.app.options.storageBucket ||
			fallbackBucket;

		const bucket = adminStorage.bucket(bucketName);
		const file = bucket.file(storagePath);

		const [exists] = await file.exists();
		if (!exists) {
			return [];
		}

		const [contents] = await file.download();
		const parsed = JSON.parse(contents.toString('utf-8'));
		return Array.isArray(parsed) ? parsed : [];
	} catch (error) {
		return [];
	}
}

export const GET = handleApiRoute(async (event) => {
	const user = requireUser(event);
	const pipelineId = event.params.pipelineId;
	const requestId = event.locals.requestId || `req_${Date.now()}`;
	const metaOnly = event.url.searchParams.get('meta') === '1' || event.url.searchParams.get('meta') === 'true';
	const logger = event.locals.logger.child({ component: 'pipeline', action: 'get', pipelineId });
	
	if (!pipelineId) {
		throw new ApiProblem({
			status: 400,
			code: 'PIPELINE_ID_REQUIRED',
			message: 'Pipeline ID is required.',
			details: { request_id: requestId }
		});
	}

	const doc = await firestore.collection(PIPELINE_COLLECTION).doc(pipelineId).get();
	
	if (!doc.exists) {
		throw new ApiProblem({
			status: 404,
			code: 'PIPELINE_NOT_FOUND',
			message: 'Pipeline not found.',
			details: {
				pipelineId,
				request_id: event.locals.requestId,
				job_id: pipelineId
			}
		});
	}
	
	const data = doc.data() as PipelineJobDocument;
	const ownerUid = typeof data.uid === 'string' ? data.uid : null;
	if (!ownerUid || ownerUid !== user.uid) {
		// Return 404 to avoid leaking pipeline existence across tenants.
		throw new ApiProblem({
			status: 404,
			code: 'PIPELINE_NOT_FOUND',
			message: 'Pipeline not found.',
			details: { pipelineId, request_id: requestId, job_id: pipelineId }
		});
	}
	
	// Load preliminary candidates from Storage if available (before LLM analysis)
	if (metaOnly) {
		return apiOk({
			pipeline_id: data.job_id,
			status: data.status,
			current_stage: data.current_stage,
			completed_stages: data.completed_stages ?? [],
			overall_progress: data.overall_progress ?? 0,
			start_time: timestampToMillis(data.start_time),
			end_time: timestampToMillis(data.end_time),
			error_message: data.error_message ?? null,
			profiles_count: data.profiles_count ?? 0,
			progressive_profiles_count: data.progressive_profiles_count ?? 0,
			progressive_profiles_revision: (data as any).progressive_profiles_revision ?? 0,
			stages: {
				query_expansion: data.query_expansion ? {
					status: data.query_expansion.status,
					queries: data.query_expansion.queries ?? [],
					prompt: data.query_expansion.prompt ?? undefined,
					completed_at: timestampToMillis(data.query_expansion.completed_at),
					error: data.query_expansion.error ?? null
				} : null,
				weaviate_search: data.weaviate_search ? {
					status: data.weaviate_search.status,
					total_results: data.weaviate_search.total_results,
					deduplicated_results: data.weaviate_search.deduplicated_results,
					queries_executed: data.weaviate_search.queries_executed,
					candidates_count: data.weaviate_search.candidates_count ?? 0,
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
		}, { headers: { 'cache-control': 'no-store' } });
	}

	let preliminaryCandidates: any[] = [];
	if (data.candidates_storage_path) {
		const rawCandidates = await loadProfilesFromStorage(data.candidates_storage_path);
		
		// Transform candidates to InfluencerProfile format
		// Candidates from Weaviate now include: {id, profile_url, platform, display_name, biography, followers, score, distance}
		preliminaryCandidates = rawCandidates.map((candidate: any) => {
			// Use display_name from Weaviate if available, otherwise extract from URL
			let displayName = candidate.display_name;
			if (!displayName && candidate.profile_url) {
				try {
					const url = new URL(candidate.profile_url);
					const pathParts = url.pathname.split('/').filter(p => p);
					if (pathParts.length > 0) {
						const username = pathParts[pathParts.length - 1].replace(/^@/, '');
						if (username && username !== '') {
							displayName = username;
						}
					}
				} catch {
					// If URL parsing fails, try regex fallback
					const urlMatch = candidate.profile_url.match(/\/([^\/\?]+)\/?$/);
					if (urlMatch && urlMatch[1]) {
						displayName = urlMatch[1].replace(/^@/, '');
					}
				}
			}
			
			return {
				_id: candidate.id || candidate._id || candidate.profile_url, // Use id as _id
				profile_url: candidate.profile_url,
				platform: candidate.platform || null,
				display_name: displayName || 'Loading...',
				biography: candidate.biography || undefined,
				bio: candidate.biography || undefined, // Map biography to bio for compatibility
				followers: typeof candidate.followers === 'number' ? candidate.followers : undefined,
				fit_score: undefined, // No fit score yet - this is preliminary
				// Keep original fields for reference
				score: candidate.score,
				distance: candidate.distance
			};
		});
		
	}
	
		// Load profiles from Storage if available (final LLM-analyzed profiles)
		let profiles: any[] = [];
		let isProgressiveResults = false;

		// Use progressive results when we don't have finalized results yet.
		// This is used while running, and also for cancelled/errored pipelines so users can still see partial results.
		const shouldUseProgressiveResults =
			(data.status === 'running' || data.status === 'cancelled' || data.status === 'error') &&
			!data.profiles_storage_path &&
			data.progressive_profiles_storage_path &&
			(data.current_stage === 'brightdata_collection' || data.current_stage === 'llm_analysis');

	if (shouldUseProgressiveResults && data.progressive_profiles_storage_path) {
		// Load progressive results (best profiles found so far during analysis)
		profiles = await loadProfilesFromStorage(data.progressive_profiles_storage_path);
		profiles.sort((a, b) => (b.fit_score ?? 0) - (a.fit_score ?? 0));
		isProgressiveResults = true;
	} else if (data.profiles_storage_path) {
		// Load final results
		profiles = await loadProfilesFromStorage(data.profiles_storage_path);
		profiles.sort((a, b) => (b.fit_score ?? 0) - (a.fit_score ?? 0));
	}
	
	// Load remaining profiles from Storage if available
	let remainingProfiles: any[] = [];
	if (data.remaining_profiles_storage_path) {
		remainingProfiles = await loadProfilesFromStorage(data.remaining_profiles_storage_path);
		remainingProfiles.sort((a, b) => (b.fit_score ?? 0) - (a.fit_score ?? 0));
	}

// Persist pipeline snapshot and ingest profiles into new per-campaign index
	const campaignId = data.campaign_id || null;
	if (campaignId) {
		try {
			await upsertPipelineDoc({
				uid: user.uid,
				campaignId,
				pipelineId,
				status: data.status,
				counts: {
					final: data.profiles_count ?? profiles.length ?? null,
					prelim: preliminaryCandidates.length ?? null,
					contactable: profiles.filter((p: any) => p?.email_address || p?.business_email).length
				},
				storage: {
					profiles_path: data.profiles_storage_path ?? null,
					prelim_path: data.candidates_storage_path ?? null,
					remaining_path: data.remaining_profiles_storage_path ?? null
				},
				stageMeta: {
					query_expansion: data.query_expansion ?? null,
					weaviate_search: data.weaviate_search ?? null,
					brightdata_collection: data.brightdata_collection ?? null,
					llm_analysis: data.llm_analysis ?? null
				}
			});

			const pipelineDocSnap = await pipelineDocRef(user.uid, campaignId, pipelineId).get();
			const alreadyIngested = pipelineDocSnap.exists && pipelineDocSnap.get('ingested') === true;
			if (!alreadyIngested && data.status === 'completed' && profiles.length > 0) {
				await ingestProfiles({
					uid: user.uid,
					campaignId,
					pipelineId,
					profiles
				});
			}
		} catch (error) {
			logger.warn('pipeline_ingest_failed', { error, pipelineId, campaignId, request_id: requestId });
		}
	}
	
		// While the pipeline is still running, only surface top-tier matches from the progressive preview.
		// Final results (status=completed) should always return the full best top-N.
		const progressiveFilteredProfiles =
			isProgressiveResults && data.status === 'running'
				? profiles.filter((profile: any) => typeof profile?.fit_score === 'number' && profile.fit_score >= 90)
				: profiles;

		// During progressive execution, keep showing preliminary candidates until we have at least one 9/10+ match.
		const showPreliminaryCandidates =
			preliminaryCandidates.length > 0 && (!isProgressiveResults || progressiveFilteredProfiles.length === 0);

		return apiOk({
			pipeline_id: data.job_id,
			status: data.status,
			current_stage: data.current_stage,
			completed_stages: data.completed_stages ?? [],
			overall_progress: data.overall_progress ?? 0,
		start_time: timestampToMillis(data.start_time),
		end_time: timestampToMillis(data.end_time),
		error_message: data.error_message ?? null,
		profiles_count: isProgressiveResults ? (data.progressive_profiles_count ?? profiles.length) : (data.profiles_count ?? profiles.length),
		remaining_profiles_count: data.remaining_profiles_count ?? remainingProfiles.length,
		profiles: progressiveFilteredProfiles,
		// Flag to indicate these are progressive (partial) results
		is_progressive: isProgressiveResults,
		// Don't show preliminary candidates when we have progressive results
		preliminary_candidates: showPreliminaryCandidates ? preliminaryCandidates : undefined,
		remaining_profiles: remainingProfiles.length > 0 ? remainingProfiles : undefined,
		stages: {
			query_expansion: data.query_expansion ? {
				status: data.query_expansion.status,
				queries: data.query_expansion.queries ?? [],
				prompt: data.query_expansion.prompt ?? undefined,
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
		}, { headers: { 'cache-control': 'no-store' } });
	}, { component: 'pipeline' });
