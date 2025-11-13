import { ApiProblem, apiOk, assertSameOrigin, handleApiRoute, requireUser } from '$lib/server/api';
import { getSearchUsage, incrementSearchUsage } from '$lib/server/search-usage';
import { functionsConfig, mintIdToken } from '$lib/server/functions-client';
import { campaignDocRef, serverTimestamp, firestore } from '$lib/server/firestore';

const PIPELINE_BIND_RETRY_DELAYS_MS = [0, 100, 500, 1000];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
}) {
	const { uid, campaignId, pipelineId, logger } = options;
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
					return { status: 'noop_other' as const, existingPipelineId };
				}
				tx.set(
					campaignRef,
					{ pipeline_id: pipelineId, updatedAt: serverTimestamp() },
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
				campaign_binding_ms: elapsed
			});
			return { ...result, attempts: attempt, campaign_binding_ms: elapsed };
		} catch (error) {
			logger?.warn('Campaign pipeline binding attempt failed (API)', {
				uid,
				campaignId,
				pipelineId,
				attempt,
				error: error instanceof Error ? error.message : String(error)
			});
			if (attempt === PIPELINE_BIND_RETRY_DELAYS_MS.length) {
				const elapsed = Date.now() - startedAt;
				logger?.error('Campaign pipeline binding failed after retries (API)', {
					uid,
					campaignId,
					pipelineId,
					attempts: attempt,
					campaign_binding_ms: elapsed
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

const INFLUENCER_ANALYSIS_FUNCTION_NAME = 'pipelineInfluencerAnalysis';

export const POST = handleApiRoute(async (event) => {
	assertSameOrigin(event);
	const user = requireUser(event);
	const logger = event.locals.logger?.child({ component: 'search/influencers' });
	const pipelineLogger = logger as ApiLogger | undefined;
	
	try {
		const body = await event.request.json();
		const { business_description, top_n, min_followers, max_followers, campaign_id } = body;
		
		// Validate required fields
		if (!business_description || typeof business_description !== 'string' || !business_description.trim()) {
			throw new ApiProblem({
				status: 400,
				code: 'INVALID_REQUEST',
				message: 'business_description is required and must be a non-empty string.'
			});
		}
		
		// Validate top_n (optional, default to 30, minimum 30)
		const topN = top_n !== undefined ? parseInt(String(top_n), 10) : 30;
		if (isNaN(topN) || topN < 30 || topN > 100) {
			throw new ApiProblem({
				status: 400,
				code: 'INVALID_REQUEST',
				message: 'top_n must be a number between 30 and 100.'
			});
		}
		
		// Validate follower counts (optional)
		const minFollowers = min_followers !== undefined ? parseInt(String(min_followers), 10) : null;
		const maxFollowers = max_followers !== undefined ? parseInt(String(max_followers), 10) : null;
		
		if (minFollowers !== null && (isNaN(minFollowers) || minFollowers < 0)) {
			throw new ApiProblem({
				status: 400,
				code: 'INVALID_REQUEST',
				message: 'min_followers must be a non-negative number.'
			});
		}
		
		if (maxFollowers !== null && (isNaN(maxFollowers) || maxFollowers < 0)) {
			throw new ApiProblem({
				status: 400,
				code: 'INVALID_REQUEST',
				message: 'max_followers must be a non-negative number.'
			});
		}
		
		if (minFollowers !== null && maxFollowers !== null && minFollowers > maxFollowers) {
			throw new ApiProblem({
				status: 400,
				code: 'INVALID_REQUEST',
				message: 'min_followers cannot be greater than max_followers.'
			});
		}

		let campaignId: string | null = null;
		if (campaign_id !== undefined && campaign_id !== null) {
			if (typeof campaign_id !== 'string') {
				throw new ApiProblem({
					status: 400,
					code: 'INVALID_REQUEST',
					message: 'campaign_id must be a string when provided.'
				});
			}
			campaignId = campaign_id.trim();
			if (!campaignId) {
				throw new ApiProblem({
					status: 400,
					code: 'INVALID_REQUEST',
					message: 'campaign_id must be a non-empty string when provided.'
				});
			}
		}
		
		// Check user's search usage limit
		const usage = await getSearchUsage(user.uid);
		if (usage.remaining < topN) {
			throw new ApiProblem({
				status: 403,
				code: 'SEARCH_LIMIT_EXCEEDED',
				message: `You have ${usage.remaining} searches remaining this month, but requested ${topN}. Your plan allows ${usage.limit} searches per month.`,
				details: {
					remaining: usage.remaining,
					requested: topN,
					limit: usage.limit
				}
			});
		}
		
		// Call the cloud function
		const functionUrl = `${functionsConfig.FUNCTION_BASE}/${INFLUENCER_ANALYSIS_FUNCTION_NAME}`;
		const idToken = await mintIdToken(user.uid);
		
		const requestBody: Record<string, unknown> = {
			business_description: business_description.trim(),
			top_n: topN,
			uid: user.uid
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
		
		logger?.info('Calling influencer analysis function', {
			userId: user.uid,
			topN,
			minFollowers,
			maxFollowers
		});
		
		const functionResponse = await fetch(functionUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${idToken}`
			},
			body: JSON.stringify(requestBody)
		});
		
		// Accept both 200 (success) and 202 (accepted - processing in background)
		if (!functionResponse.ok && functionResponse.status !== 202) {
			const errorText = await functionResponse.text();
			logger?.error('Cloud function call failed', {
				status: functionResponse.status,
				error: errorText
			});
			throw new ApiProblem({
				status: functionResponse.status,
				code: 'FUNCTION_ERROR',
				message: 'Failed to execute influencer search.',
				details: { error: errorText }
			});
		}
		
		const functionResult = await functionResponse.json();
		const pipelineId = functionResult.job_id;
		
		// For 202 Accepted, the pipeline is processing in background
		// Return minimal info - frontend will poll for status
		if (functionResponse.status === 202) {
			logger?.info('Pipeline job accepted, processing in background', {
				userId: user.uid,
				pipelineId
			});
		}
		
		// Save pipeline ID to campaign if campaign_id is provided
		if (campaignId) {
			const result = await bindCampaignPipelineId({
				uid: user.uid,
				campaignId,
				pipelineId,
				logger: pipelineLogger
			});
			if (result.status === 'missing_campaign') {
				logger?.warn('Campaign document missing while binding pipeline ID', {
					userId: user.uid,
					campaignId,
					pipelineId
				});
			} else if (result.status === 'failed') {
				logger?.error('Failed to bind pipeline ID to campaign after retries', {
					userId: user.uid,
					campaignId,
					pipelineId,
					attempts: result.attempts,
					campaign_binding_ms: result.campaign_binding_ms,
					error: result.error
				});
			}
		} else {
			logger?.warn('No campaign_id provided, skipping pipeline_id save', {
				userId: user.uid,
				campaign_id: campaign_id
			});
		}
		
		// Increment search usage (only count the top_n requested)
		await incrementSearchUsage(user.uid, topN);
		
		logger?.info('Search completed successfully', {
			userId: user.uid,
			topN,
			jobId: pipelineId
		});
		
		// For 202 Accepted, return minimal info - pipeline is processing in background
		// Frontend will poll /api/pipeline/[pipelineId] for status updates
		if (functionResponse.status === 202) {
			return apiOk({
				job_id: pipelineId,
				status: 'accepted',
				profiles_count: 0, // Not available yet
				profiles_storage_url: null,
				pipeline_stats: null,
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
			profiles_storage_url: functionResult.profiles_storage_url,
			pipeline_stats: functionResult.pipeline_stats,
			usage: {
				count: usage.count + topN,
				limit: usage.limit,
				remaining: usage.remaining - topN,
				resetDate: usage.resetDate
			}
		});
	} catch (error) {
		if (error instanceof ApiProblem) {
			throw error;
		}
		logger?.error('Unexpected error in search endpoint', { error });
		throw new ApiProblem({
			status: 500,
			code: 'INTERNAL_ERROR',
			message: 'An unexpected error occurred while processing your search request.',
			cause: error
		});
	}
}, { component: 'search/influencers' });

// GET endpoint to check usage
export const GET = handleApiRoute(async (event) => {
	const user = requireUser(event);
	const usage = await getSearchUsage(user.uid);
	return apiOk(usage);
}, { component: 'search/influencers' });
