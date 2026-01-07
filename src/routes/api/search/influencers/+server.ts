import { randomUUID } from 'crypto';
import { ApiProblem, apiOk, assertSameOrigin, handleApiRoute, requireUser } from '$lib/server/core';
import { getSearchUsage, incrementSearchUsage } from '$lib/server/usage';
import { getServiceAccountAccessToken, getCloudRunPipelineUrl } from '$lib/server/firebase';
import {
	campaignDocRef,
	campaignProfilesCollectionRef,
	pipelineDocRef,
	serverTimestamp,
	firestore
} from '$lib/server/core';

const PIPELINE_BIND_RETRY_DELAYS_MS = [0, 100, 500, 1000];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const EXCLUSION_FETCH_LIMIT = 1000; // cap of URLs sent to pipeline service

type ApiLogger = {
	info: (message: string, meta?: Record<string, unknown>) => void;
	warn: (message: string, meta?: Record<string, unknown>) => void;
	error: (message: string, meta?: Record<string, unknown>) => void;
};

async function bindCampaignPipelineId(options: {
	uid: string;
	campaignId: string;
	pipelineId: string;
	logger?: ApiLogger;
	requestId?: string;
}) {
	const { uid, campaignId, pipelineId, logger, requestId } = options;
	const startedAt = Date.now();
	const campaignRef = campaignDocRef(uid, campaignId);
	for (let attempt = 1; attempt <= PIPELINE_BIND_RETRY_DELAYS_MS.length; attempt++) {
		const delay = PIPELINE_BIND_RETRY_DELAYS_MS[attempt - 1];
		if (delay > 0) {
			await sleep(delay);
		}
		try {
			const result = await firestore.runTransaction(async (tx) => {
				const snapshot = await tx.get(campaignRef);
				if (!snapshot.exists) {
					return { status: 'missing_campaign' as const };
				}
				const existingPipelineId = snapshot.get('pipeline_id');
				if (typeof existingPipelineId === 'string' && existingPipelineId.trim()) {
					if (existingPipelineId === pipelineId) {
						return { status: 'noop_same' as const };
					}
					// If there's an existing pipeline_id but it's different, update it
					// This handles rerunning pipelines - the new pipeline_id should replace the old one
					tx.set(
						campaignRef,
						{ pipeline_id: pipelineId, status: 'searching', updatedAt: serverTimestamp() },
						{ merge: true }
					);
					return { status: 'updated' as const, existingPipelineId };
				}
				tx.set(
				campaignRef,
				{ pipeline_id: pipelineId, status: 'searching', updatedAt: serverTimestamp() },
				{ merge: true }
			);
				return { status: 'updated' as const };
			});
			const elapsed = Date.now() - startedAt;
			logger?.info('Campaign pipeline binding result (API)', {
				uid,
				campaignId,
				pipelineId,
				attempt,
				status: result.status,
				existingPipelineId: result.existingPipelineId,
				campaign_binding_ms: elapsed,
				request_id: requestId
			});
			return { ...result, attempts: attempt, campaign_binding_ms: elapsed };
		} catch (error) {
			logger?.warn('Campaign pipeline binding attempt failed (API)', {
				uid,
				campaignId,
				pipelineId,
				attempt,
				error: error instanceof Error ? error.message : String(error),
				request_id: requestId
			});
			if (attempt === PIPELINE_BIND_RETRY_DELAYS_MS.length) {
				const elapsed = Date.now() - startedAt;
				logger?.error('Campaign pipeline binding failed after retries (API)', {
					uid,
					campaignId,
					pipelineId,
					attempts: attempt,
					campaign_binding_ms: elapsed,
					request_id: requestId
				});
				return {
					status: 'failed' as const,
					attempts: attempt,
					campaign_binding_ms: elapsed,
					error: error instanceof Error ? error.message : String(error)
				};
			}
		}
	}
	const elapsed = Date.now() - startedAt;
	return { status: 'failed' as const, attempts: PIPELINE_BIND_RETRY_DELAYS_MS.length, campaign_binding_ms: elapsed };
}

async function buildExclusionList(uid: string, campaignId: string, limit = EXCLUSION_FETCH_LIMIT): Promise<string[]> {
	try {
		const snapshot = await campaignProfilesCollectionRef(uid, campaignId)
			.orderBy('last_seen_at', 'desc')
			.limit(limit)
			.get();
		return snapshot.docs
			.map((doc) => doc.get('profile_url'))
			.filter((url): url is string => typeof url === 'string' && url.trim().length > 0);
	} catch (error) {
		console.warn('[search] failed to build exclusion list', { error });
		return [];
	}
}

async function createPipelineDoc(options: {
	uid: string;
	campaignId: string;
	pipelineId: string;
	params: Record<string, unknown>;
	status: 'pending' | 'running' | 'completed' | 'error' | 'cancelled';
	exclusionCount: number;
	logger?: ApiLogger;
}) {
	const { uid, campaignId, pipelineId, params, status, exclusionCount, logger } = options;
	const docRef = pipelineDocRef(uid, campaignId, pipelineId);
	try {
		await docRef.set(
			{
				user_id: uid,
				campaign_id: campaignId,
				pipeline_id: pipelineId,
				created_at: Date.now(),
				status,
				params: {
					business_description: params.business_description ?? null,
					top_n: params.top_n ?? null,
					min_followers: params.min_followers ?? null,
					max_followers: params.max_followers ?? null,
					platforms: params.platforms ?? null,
					locations: params.locations ?? null,
					exclude_profile_urls: exclusionCount
				}
			},
			{ merge: true }
		);
		// Mark campaign pipeline for quick lookup and set status to searching
		await campaignDocRef(uid, campaignId).set(
			{ pipeline_id: pipelineId, status: 'searching', updatedAt: serverTimestamp() },
			{ merge: true }
		);
		logger?.info('Pipeline doc created', { pipelineId, campaignId, exclusionCount });
	} catch (error) {
		logger?.warn('Failed to create pipeline doc', { pipelineId, campaignId, error });
	}
}

export const POST = handleApiRoute(async (event) => {
	assertSameOrigin(event);
	const user = requireUser(event);
	const requestId = randomUUID();
	let functionRequestId: string = requestId;
	const logger = event.locals.logger?.child({ component: 'search/influencers', requestId });
	const pipelineLogger = logger as ApiLogger | undefined;
	
	try {
		logger?.info('Search request received', { userId: user.uid, request_id: requestId });
		
		const body = await event.request.json();
		const { business_description, top_n, min_followers, max_followers, campaign_id, exclude_profile_urls, strict_location_matching } = body;
		
		// Validate required fields
		if (!business_description || typeof business_description !== 'string' || !business_description.trim()) {
			throw new ApiProblem({
				status: 400,
				code: 'INVALID_REQUEST',
				message: 'business_description is required and must be a non-empty string.',
				details: { request_id: requestId }
			});
		}
		
		// Validate top_n (optional, default to 10, minimum 10, maximum 1000)
		const topN = top_n !== undefined ? parseInt(String(top_n), 10) : 10;
		if (isNaN(topN) || topN < 10 || topN > 1000) {
			throw new ApiProblem({
				status: 400,
				code: 'INVALID_REQUEST',
				message: 'top_n must be a number between 10 and 1000.',
				details: { request_id: requestId }
			});
		}
		
		// Validate follower counts (optional)
		const minFollowers = min_followers !== undefined ? parseInt(String(min_followers), 10) : null;
		const maxFollowers = max_followers !== undefined ? parseInt(String(max_followers), 10) : null;
		
		if (minFollowers !== null && (isNaN(minFollowers) || minFollowers < 0)) {
			throw new ApiProblem({
				status: 400,
				code: 'INVALID_REQUEST',
				message: 'min_followers must be a non-negative number.',
				details: { request_id: requestId }
			});
		}
		
		if (maxFollowers !== null && (isNaN(maxFollowers) || maxFollowers < 0)) {
			throw new ApiProblem({
				status: 400,
				code: 'INVALID_REQUEST',
				message: 'max_followers must be a non-negative number.',
				details: { request_id: requestId }
			});
		}
		
		if (minFollowers !== null && maxFollowers !== null && minFollowers > maxFollowers) {
			throw new ApiProblem({
				status: 400,
				code: 'INVALID_REQUEST',
				message: 'min_followers cannot be greater than max_followers.',
				details: { request_id: requestId }
			});
		}

		let campaignId: string | null = null;
		if (campaign_id !== undefined && campaign_id !== null) {
			if (typeof campaign_id !== 'string') {
				throw new ApiProblem({
					status: 400,
					code: 'INVALID_REQUEST',
					message: 'campaign_id must be a string when provided.',
					details: { request_id: requestId }
				});
			}
			campaignId = campaign_id.trim();
			if (!campaignId) {
				throw new ApiProblem({
					status: 400,
					code: 'INVALID_REQUEST',
					message: 'campaign_id must be a non-empty string when provided.',
					details: { request_id: requestId }
				});
			}
		}
		
		// Check user's search usage limit
		logger?.info('Checking search usage', { userId: user.uid, request_id: requestId });
		let usage;
		try {
			usage = await getSearchUsage(user.uid);
			logger?.info('Search usage retrieved', { 
				userId: user.uid, 
				usage: { count: usage.count, limit: usage.limit, remaining: usage.remaining },
				request_id: requestId 
			});
		} catch (error) {
			logger?.error('Failed to get search usage', { 
				userId: user.uid, 
				error: error instanceof Error ? error.message : String(error),
				request_id: requestId 
			});
			throw new ApiProblem({
				status: 500,
				code: 'USAGE_CHECK_FAILED',
				message: 'Failed to check search usage limit.',
				cause: error,
				details: { request_id: requestId }
			});
		}
		
		if (usage.remaining < topN) {
			throw new ApiProblem({
				status: 403,
				code: 'SEARCH_LIMIT_EXCEEDED',
				message: `You have ${usage.remaining} searches remaining this month, but requested ${topN}. Your plan allows ${usage.limit} searches per month.`,
				details: {
					remaining: usage.remaining,
					requested: topN,
					limit: usage.limit,
					request_id: requestId
				}
			});
		}
		
		// Build exclusion list automatically when campaign provided and caller did not pass one
		let exclusionUrls: string[] | undefined;
		if (campaignId && (!exclude_profile_urls || !Array.isArray(exclude_profile_urls))) {
			exclusionUrls = await buildExclusionList(user.uid, campaignId, EXCLUSION_FETCH_LIMIT);
			logger?.info('Auto-built exclusion list', { size: exclusionUrls.length, request_id: requestId });
		} else if (Array.isArray(exclude_profile_urls)) {
			exclusionUrls = exclude_profile_urls.filter((url) => typeof url === 'string');
		}

		// Use Cloud Run pipeline service
		// Note: Using service account authentication (no user ID token needed)
		// User is already verified in hooks.server.ts via session cookie
		const cloudRunBaseUrl = getCloudRunPipelineUrl();
		const serviceUrl = `${cloudRunBaseUrl}/pipeline/start`;
		
		logger?.info('Calling Cloud Run pipeline service', {
			serviceUrl,
			request_id: requestId
		});
		
		const requestBody: Record<string, unknown> = {
			business_description: business_description.trim(),
			top_n: topN,
			uid: user.uid, // User ID already verified in hooks.server.ts
			request_id: requestId
		};
		
		if (minFollowers !== null) {
			requestBody.min_followers = minFollowers;
		}
		if (maxFollowers !== null) {
			requestBody.max_followers = maxFollowers;
		}
		if (campaignId) {
			requestBody.campaign_id = campaignId;
		}
		// Pass excluded profile URLs for "find more influencers" functionality
		if (exclusionUrls && exclusionUrls.length > 0) {
			requestBody.exclude_profile_urls = exclusionUrls;
		}
		// Pass strict location matching option
		if (strict_location_matching === true) {
			requestBody.strict_location_matching = true;
		}
		
		logger?.info('Calling Cloud Run pipeline service', {
			userId: user.uid,
			serviceUrl,
			topN,
			minFollowers,
			maxFollowers,
			campaignId,
			request_id: requestId
		});
		
		let functionResponse: Response;
		try {
			// Get service account ID token for Cloud Run authentication (required for private invokers)
			const idToken = await getServiceAccountAccessToken(serviceUrl);
			
			// Call Cloud Run pipeline service with service account token
			// User ID is passed in request body (already verified by App Hosting)
			functionResponse = await fetch(serviceUrl, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${idToken}`
				},
				body: JSON.stringify(requestBody)
			});
		} catch (error) {
			logger?.error('Failed to call Cloud Run pipeline service', {
				userId: user.uid,
				serviceUrl,
				error: error instanceof Error ? error.message : String(error),
				errorName: error instanceof Error ? error.name : undefined,
				request_id: requestId
			});
			throw new ApiProblem({
				status: 500,
				code: 'PIPELINE_SERVICE_FAILED',
				message: 'Failed to reach pipeline service. The service may be temporarily unavailable.',
				cause: error,
				details: { 
					serviceUrl,
					request_id: requestId 
				}
			});
		}

		const rawFunctionResponse = await functionResponse.text();
		let functionResult: Record<string, unknown> = {};
		if (rawFunctionResponse) {
			try {
				functionResult = JSON.parse(rawFunctionResponse);
			} catch {
				functionResult = { raw: rawFunctionResponse };
			}
		}
		functionRequestId =
			typeof functionResult?.request_id === 'string' && (functionResult.request_id as string).trim()
				? (functionResult.request_id as string).trim()
				: requestId;

		if (!functionResponse.ok) {
			logger?.error('Cloud Run pipeline service call failed', {
				status: functionResponse.status,
				error: functionResult,
				request_id: functionRequestId
			});
			const errorCode =
				typeof functionResult?.error === 'string'
					? (functionResult.error as string)
					: 'PIPELINE_ERROR';
			const message =
				typeof functionResult?.message === 'string'
					? (functionResult.message as string)
					: 'Failed to execute influencer search.';
			throw new ApiProblem({
				status: functionResponse.status,
				code: errorCode,
				message,
				details: {
					pipeline_response: functionResult,
					request_id: functionRequestId
				}
			});
		}

		const pipelineId = typeof functionResult.job_id === 'string' ? (functionResult.job_id as string) : undefined;

		// Persist pipeline stub so we can support multiple runs and exclusions
		if (campaignId && pipelineId) {
			void createPipelineDoc({
				uid: user.uid,
				campaignId,
				pipelineId,
				status: 'pending',
				params: {
					business_description,
					top_n: topN,
					min_followers: minFollowers,
					max_followers: maxFollowers,
					platforms: undefined,
					locations: undefined,
					exclude_profile_urls: exclusionUrls?.length ?? 0
				},
				exclusionCount: exclusionUrls?.length ?? 0,
				logger: pipelineLogger
			});
		}
		
		// For 202 Accepted, the pipeline is processing in background
		// Return minimal info - frontend will poll for status
		if (functionResponse.status === 202) {
			logger?.info('Pipeline job accepted, processing in background', {
				userId: user.uid,
				pipelineId,
				request_id: functionRequestId
			});
		}
		
		// Save pipeline ID to campaign if campaign_id is provided (non-critical - don't fail if this fails)
		let campaignBindingStatus: { status: string; existingPipelineId?: string; error?: string } | null = null;
		if (campaignId && pipelineId) {
			try {
				const result = await bindCampaignPipelineId({
					uid: user.uid,
					campaignId,
					pipelineId,
					logger: pipelineLogger,
					requestId: functionRequestId
				});
				const existingPipelineId = 'existingPipelineId' in result ? result.existingPipelineId : undefined;
				const resultError = 'error' in result ? result.error : undefined;
				campaignBindingStatus = {
					status: result.status,
					existingPipelineId,
					error: resultError
				};
				
				if (result.status === 'missing_campaign') {
					logger?.warn('Campaign document missing while binding pipeline ID', {
						userId: user.uid,
						campaignId,
						pipelineId,
						request_id: functionRequestId
					});
				} else if (result.status === 'failed') {
					logger?.error('Failed to bind pipeline ID to campaign after retries', {
						userId: user.uid,
						campaignId,
						pipelineId,
						attempts: result.attempts,
						campaign_binding_ms: result.campaign_binding_ms,
						error: result.error,
						request_id: functionRequestId
					});
					// Don't throw - this is non-critical
				} else if (result.status === 'noop_same') {
					logger?.info('Campaign pipeline binding already satisfied (API fallback)', {
						userId: user.uid,
						campaignId,
						pipelineId,
						status: result.status,
						existingPipelineId,
						request_id: functionRequestId
					});
				} else if (result.status === 'updated') {
					logger?.info('Campaign pipeline binding successful', {
						userId: user.uid,
						campaignId,
						pipelineId,
						request_id: functionRequestId
					});
				}
			} catch (error) {
				// Log but don't fail the request - campaign binding is non-critical
				campaignBindingStatus = {
					status: 'failed',
					error: error instanceof Error ? error.message : String(error)
				};
				logger?.warn('Campaign pipeline binding failed (non-critical)', {
					userId: user.uid,
					campaignId,
					pipelineId,
					error: error instanceof Error ? error.message : String(error),
					request_id: functionRequestId
				});
			}
		} else if (campaignId && !pipelineId) {
			logger?.warn('Function response missing job_id, skipping API binding', {
				userId: user.uid,
				campaignId,
				request_id: functionRequestId
			});
		} else {
			logger?.info('No campaign_id provided, skipping pipeline_id save', {
				userId: user.uid,
				campaign_id: campaign_id ?? null,
				request_id: functionRequestId
			});
		}
		
		// Increment search usage (non-critical - log but don't fail if this fails)
		try {
			await incrementSearchUsage(user.uid, topN);
			logger?.info('Search usage incremented', { userId: user.uid, topN, request_id: functionRequestId });
		} catch (error) {
			// Log but don't fail - usage tracking is non-critical for the request
			logger?.warn('Failed to increment search usage (non-critical)', {
				userId: user.uid,
				topN,
				error: error instanceof Error ? error.message : String(error),
				request_id: functionRequestId
			});
		}
		
		logger?.info('Search completed successfully', {
			userId: user.uid,
			topN,
			jobId: pipelineId,
			request_id: functionRequestId
		});
		
		// For 202 Accepted, return minimal info - pipeline is processing in background
		// Frontend will poll /api/pipeline/[pipelineId] for status updates
		if (functionResponse.status === 202) {
			return apiOk({
				job_id: pipelineId,
				status: 'accepted',
				profiles_count: 0, // Not available yet
				pipeline_stats: null,
				request_id: functionRequestId,
				campaign_binding_status: campaignBindingStatus?.status || null,
				existingPipelineId: campaignBindingStatus?.existingPipelineId || null,
				usage: {
					count: usage.count + topN,
					limit: usage.limit,
					remaining: usage.remaining - topN,
					resetDate: usage.resetDate
				}
			});
		}
		
		// For 200 OK, pipeline completed synchronously (shouldn't happen with new implementation)
		return apiOk({
			job_id: pipelineId,
			status: functionResult.status,
			profiles_count: functionResult.profiles_count ?? 0,
			pipeline_stats: functionResult.pipeline_stats,
			request_id: functionRequestId,
			campaign_binding_status: campaignBindingStatus?.status || null,
			existingPipelineId: campaignBindingStatus?.existingPipelineId || null,
			usage: {
				count: usage.count + topN,
				limit: usage.limit,
				remaining: usage.remaining - topN,
				resetDate: usage.resetDate
			}
		});
	} catch (error) {
		if (error instanceof ApiProblem) {
			// Re-throw ApiProblem as-is (already properly formatted)
			throw error;
		}
		
		// Log unexpected errors with full context
		logger?.error('Unexpected error in search endpoint', { 
			error: error instanceof Error ? {
				name: error.name,
				message: error.message,
				stack: error.stack
			} : String(error),
			request_id: functionRequestId,
			userId: user?.uid
		});
		
		// Return a user-friendly error with request ID for support
		throw new ApiProblem({
			status: 500,
			code: 'INTERNAL_ERROR',
			message: 'An unexpected error occurred while processing your search request.',
			cause: error,
			details: { 
				request_id: functionRequestId,
				error_type: error instanceof Error ? error.name : typeof error
			}
		});
	}
}, { component: 'search/influencers' });

// GET endpoint to check usage
export const GET = handleApiRoute(async (event) => {
	const user = requireUser(event);
	const usage = await getSearchUsage(user.uid);
	return apiOk(usage);
}, { component: 'search/influencers' });
