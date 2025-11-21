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
	remaining_profiles_storage_url?: string;
	remaining_profiles_storage_path?: string;
	remaining_profiles_count?: number;
	candidates_storage_url?: string;
	candidates_storage_path?: string;
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
		// Use the same bucket resolution logic as pipeline-service
		// Import resolvedStorageBucketName from firebase-admin utils if available, otherwise resolve here
		const resolvedProjectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || (adminStorage.app.options.projectId || 'penni-ai-platform');
		const fallbackBucket = `${resolvedProjectId}.firebasestorage.app`;
		const bucketName = process.env.STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET || adminStorage.app.options.storageBucket || fallbackBucket;
		
		const bucket = adminStorage.bucket(bucketName);
		const file = bucket.file(storagePath);
		
		const storageEmulatorHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST || process.env.STORAGE_EMULATOR_HOST || 'none';
		
		console.log(`[API] Loading profiles from storage:`, {
			bucketName,
			storagePath,
			projectId: resolvedProjectId,
			storageEmulatorHost,
			// Compare with pipeline-service expected values
			expectedProjectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'none',
			expectedBucket: process.env.STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET || 'none'
		});
		
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
		
		console.log(`[API] Loaded ${profiles.length} profiles from ${storagePath} in bucket ${bucketName}`);
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
	const requestId = event.locals.requestId || `req_${Date.now()}`;
	
	if (!pipelineId) {
		throw new ApiProblem({
			status: 400,
			code: 'PIPELINE_ID_REQUIRED',
			message: 'Pipeline ID is required.',
			details: { request_id: requestId }
		});
	}
	
	// Log Firestore and Storage configuration for debugging
	const firestoreProjectId = (firestore as any).app?.options?.projectId || 'unknown';
	const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST || 'none';
	const googleCloudProject = process.env.GOOGLE_CLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'none';
	const storageBucket = process.env.STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET || (adminStorage.app.options.storageBucket || 'none');
	const storageEmulatorHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST || process.env.STORAGE_EMULATOR_HOST || 'none';
	
	console.log(`[API] Fetching pipeline ${pipelineId} for user ${user.uid}`, {
		firestoreProjectId,
		firestoreEmulatorHost,
		googleCloudProject,
		storageBucket,
		storageEmulatorHost,
		collection: PIPELINE_COLLECTION,
		pipelineId,
		request_id: event.locals.requestId
	});
	
	// Validate configuration consistency
	if (firestoreProjectId !== googleCloudProject && googleCloudProject !== 'none') {
		console.warn(`[API] Configuration mismatch: Firestore project ID (${firestoreProjectId}) differs from GOOGLE_CLOUD_PROJECT (${googleCloudProject})`);
	}
	
	const doc = await firestore.collection(PIPELINE_COLLECTION).doc(pipelineId).get();
	
	if (!doc.exists) {
		console.log(`[API] Pipeline ${pipelineId} not found in Firestore collection '${PIPELINE_COLLECTION}' for user ${user.uid}`, {
			firestoreProjectId,
			firestoreEmulatorHost,
			request_id: event.locals.requestId
		});
		
		// Try to help debug - check if document exists with different casing or in different collection
		console.log(`[API] Debug: Checking if pipeline exists in campaigns for user ${user.uid}`);
		const campaignCheck = await firestore
			.collection('users')
			.doc(user.uid)
			.collection('campaigns')
			.where('pipeline_id', '==', pipelineId)
			.limit(1)
			.get();
		
		if (!campaignCheck.empty) {
			const campaignDoc = campaignCheck.docs[0];
			const campaignData = campaignDoc.data();
			console.log(`[API] Debug: Found campaign ${campaignDoc.id} with pipeline_id ${pipelineId}, but pipeline document doesn't exist in ${PIPELINE_COLLECTION}`, {
				campaignId: campaignDoc.id,
				pipeline_id: campaignData?.pipeline_id,
				title: campaignData?.title,
				request_id: event.locals.requestId
			});
		} else {
			console.log(`[API] Debug: No campaign found with pipeline_id ${pipelineId} for user ${user.uid}`, {
				request_id: event.locals.requestId
			});
		}
		
		// Additional debug: Try to list recent pipeline jobs to see if there's a pattern
		try {
			const recentJobs = await firestore
				.collection(PIPELINE_COLLECTION)
				.orderBy('created_at', 'desc')
				.limit(5)
				.get();
			console.log(`[API] Debug: Recent pipeline jobs in collection:`, {
				total: recentJobs.size,
				jobIds: recentJobs.docs.map(d => d.id),
				jobUids: recentJobs.docs.map(d => d.data()?.uid || 'null'),
				request_id: event.locals.requestId
			});
		} catch (error) {
			console.warn(`[API] Debug: Failed to query recent jobs:`, error);
		}
		
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
	console.log(`[API] Pipeline ${pipelineId} found. Document fields:`, {
		uid: data.uid || 'null',
		campaign_id: data.campaign_id || 'null',
		created_at: data.created_at ? (typeof data.created_at === 'object' && 'toMillis' in data.created_at ? data.created_at.toMillis() : data.created_at) : 'null',
		requesting_user_uid: user.uid,
		request_id: event.locals.requestId
	});

	let userOwnsPipeline = data.uid === user.uid;
	
	// If uid doesn't match (or is null), check campaign fallback
	// This handles cases where:
	// 1. Pipeline document has no uid set
	// 2. Pipeline document has wrong uid (e.g., from emulator or migration)
	// 3. Campaign has pipeline_id but pipeline document uid wasn't set correctly
	if (!userOwnsPipeline) {
		console.log(`[API] Pipeline ${pipelineId} uid mismatch or missing, checking campaign fallback for user ${user.uid}`);
		
		// First, check if pipeline has a campaign_id and if user owns that campaign
		if (data.campaign_id) {
			console.log(`[API] Pipeline has campaign_id ${data.campaign_id}, checking if user owns it`);
			try {
				const campaignDoc = await firestore
					.collection('users')
					.doc(user.uid)
					.collection('campaigns')
					.doc(data.campaign_id)
					.get();
				
				if (campaignDoc.exists) {
					const campaignData = campaignDoc.data();
					const campaignPipelineId = campaignData?.pipeline_id;
					console.log(`[API] Campaign ${data.campaign_id} found. Campaign pipeline_id: ${campaignPipelineId || 'null'}, Requested pipeline_id: ${pipelineId}`);
					
					// If campaign's pipeline_id matches, user owns it
					if (campaignPipelineId === pipelineId) {
						userOwnsPipeline = true;
						console.log(`[API] User owns pipeline via campaign ownership`);
					}
				} else {
					console.log(`[API] Campaign ${data.campaign_id} not found for user ${user.uid}`);
				}
			} catch (error) {
				console.warn(`[API] Error checking campaign ownership:`, error);
			}
		}
		
		// Also check by searching campaigns with this pipeline_id (backward compatibility)
		if (!userOwnsPipeline) {
			const fallbackCampaignSnapshot = await firestore
				.collection('users')
				.doc(user.uid)
				.collection('campaigns')
				.where('pipeline_id', '==', pipelineId)
				.limit(1)
				.get();
			userOwnsPipeline = !fallbackCampaignSnapshot.empty;
			console.log(`[API] Campaign fallback check (by pipeline_id query) for ${pipelineId}: ${userOwnsPipeline ? 'found' : 'not found'}`);
		}
		
		// If campaign fallback found it, optionally update the pipeline document with correct uid
		if (userOwnsPipeline && (!data.uid || data.uid !== user.uid)) {
			console.log(`[API] Updating pipeline ${pipelineId} with correct uid:`, {
				event: 'pipeline_uid_updated',
				pipelineId,
				old_uid: data.uid || 'null',
				new_uid: user.uid,
				campaign_id: data.campaign_id || 'null',
				request_id: event.locals.requestId,
				reason: 'uid_mismatch_fixed_via_campaign_ownership'
			});
			try {
				await firestore.collection(PIPELINE_COLLECTION).doc(pipelineId).update({
					uid: user.uid
				});
				console.log(`[API] Successfully updated pipeline uid for ${pipelineId}`, {
					event: 'pipeline_uid_update_success',
					pipelineId,
					request_id: event.locals.requestId
				});
			} catch (error) {
				// Log but don't fail - this is a best-effort update
				console.warn(`[API] Failed to update pipeline uid (non-critical):`, {
					event: 'pipeline_uid_update_failed',
					pipelineId,
					error: error instanceof Error ? error.message : String(error),
					request_id: event.locals.requestId
				});
			}
		}
	}

	if (!userOwnsPipeline) {
		// Enhanced logging to help distinguish between replication delay and structural mismatch
		const pipelineCreatedAt = timestampToMillis(data.created_at);
		const now = Date.now();
		const ageMs = pipelineCreatedAt ? now - pipelineCreatedAt : null;
		const isRecentlyCreated = ageMs !== null && ageMs < 10000; // Less than 10 seconds old
		
		// Check if user owns any campaign with this pipeline_id (for correlation)
		let userCampaignWithPipeline: { id: string; pipeline_id: string } | null = null;
		try {
			const userCampaignsSnapshot = await firestore
				.collection('users')
				.doc(user.uid)
				.collection('campaigns')
				.where('pipeline_id', '==', pipelineId)
				.limit(1)
				.get();
			
			if (!userCampaignsSnapshot.empty) {
				const campaignDoc = userCampaignsSnapshot.docs[0];
				userCampaignWithPipeline = {
					id: campaignDoc.id,
					pipeline_id: campaignDoc.data()?.pipeline_id || 'null'
				};
			}
		} catch (error) {
			console.warn(`[API] Error checking user campaigns for pipeline correlation:`, error);
		}
		
		console.warn(`[API] PIPELINE_FORBIDDEN: User ${user.uid} does not own pipeline ${pipelineId}`, {
			event: 'pipeline_forbidden',
			request_id: event.locals.requestId,
			job_id: pipelineId,
			document_uid: data.uid || 'null',
			document_campaign_id: data.campaign_id || 'null',
			requesting_user_uid: user.uid,
			pipeline_created_at: pipelineCreatedAt,
			pipeline_age_ms: ageMs,
			is_recently_created: isRecentlyCreated,
			user_has_campaign_with_pipeline: !!userCampaignWithPipeline,
			user_campaign_id: userCampaignWithPipeline?.id || null,
			likely_cause: isRecentlyCreated 
				? 'replication_delay_or_metadata_not_synced' 
				: userCampaignWithPipeline 
					? 'uid_mismatch_in_pipeline_document' 
					: 'structural_mismatch_or_wrong_user',
			firestoreProjectId,
			firestoreEmulatorHost
		});
		
		throw new ApiProblem({
			status: 403,
			code: 'PIPELINE_FORBIDDEN',
			message: 'You do not have permission to access this pipeline.',
			details: {
				pipelineId,
				request_id: event.locals.requestId,
				job_id: pipelineId
			}
		});
	}
	
	// Load preliminary candidates from Storage if available (before LLM analysis)
	let preliminaryCandidates: any[] = [];
	if (data.candidates_storage_path) {
		console.log(`[API] Loading preliminary candidates from storage path: ${data.candidates_storage_path}`, {
			pipelineId,
			user_uid: user.uid,
			campaign_id: data.campaign_id || null,
			request_id: requestId
		});
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
		
		console.log(`[API] Loaded and transformed ${preliminaryCandidates.length} preliminary candidates for pipeline ${pipelineId}`, {
			request_id: requestId
		});
	}
	
	// Load profiles from Storage if available (final LLM-analyzed profiles)
	let profiles: any[] = [];
	if (data.profiles_storage_path) {
		console.log(`[API] Loading profiles from storage path: ${data.profiles_storage_path}`, {
			pipelineId,
			user_uid: user.uid,
			campaign_id: data.campaign_id || null,
			request_id: requestId
		});
		profiles = await loadProfilesFromStorage(data.profiles_storage_path);
		profiles.sort((a, b) => (b.fit_score ?? 0) - (a.fit_score ?? 0));
		console.log(`[API] Loaded ${profiles.length} profiles for pipeline ${pipelineId}`, {
			request_id: requestId
		});
	}
	
	// Load remaining profiles from Storage if available
	let remainingProfiles: any[] = [];
	if (data.remaining_profiles_storage_path) {
		console.log(`[API] Loading remaining profiles from storage path: ${data.remaining_profiles_storage_path}`, {
			pipelineId,
			request_id: requestId
		});
		remainingProfiles = await loadProfilesFromStorage(data.remaining_profiles_storage_path);
		remainingProfiles.sort((a, b) => (b.fit_score ?? 0) - (a.fit_score ?? 0));
		console.log(`[API] Loaded ${remainingProfiles.length} remaining profiles for pipeline ${pipelineId}`, {
			request_id: requestId
		});
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
		remaining_profiles_count: data.remaining_profiles_count ?? remainingProfiles.length,
		remaining_profiles_storage_url: data.remaining_profiles_storage_url,
		candidates_storage_url: data.candidates_storage_url,
		profiles: profiles,
		preliminary_candidates: preliminaryCandidates.length > 0 ? preliminaryCandidates : undefined,
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
	});
}, { component: 'pipeline' });
