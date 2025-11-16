import { ApiProblem, apiOk, assertSameOrigin, handleApiRoute, requireUser } from '$lib/server/core';
import { campaignDocRef } from '$lib/server/core';

/**
 * GET /api/outreach/[campaignId]
 * Get outreach data for a campaign
 */
export const GET = handleApiRoute(async (event) => {
	const user = requireUser(event);
	const campaignId = event.params.campaignId;
	
	if (!campaignId) {
		throw new ApiProblem({
			status: 400,
			code: 'CAMPAIGN_ID_REQUIRED',
			message: 'Campaign ID is required.'
		});
	}

	const logger = event.locals.logger.child({
		campaignId,
		userId: user.uid
	});

	try {
		const campaignRef = campaignDocRef(user.uid, campaignId);
		const campaignDoc = await campaignRef.get();
		
		if (!campaignDoc.exists) {
			throw new ApiProblem({
				status: 404,
				code: 'CAMPAIGN_NOT_FOUND',
				message: 'Campaign not found.'
			});
		}

		const campaignData = campaignDoc.data();
		
		// Return campaign outreach-related data
		return apiOk({
			campaignId,
			pipelineId: campaignData?.pipeline_id ?? null,
			// Add other outreach-related fields as needed
		});
	} catch (error) {
		if (error instanceof ApiProblem) {
			throw error;
		}
		logger.error('Failed to get campaign outreach data', { error });
		throw new ApiProblem({
			status: 500,
			code: 'OUTREACH_DATA_FETCH_FAILED',
			message: 'Failed to fetch outreach data.',
			cause: error
		});
	}
}, { component: 'outreach' });

