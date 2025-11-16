import { ApiProblem, apiOk, handleApiRoute, requireUser } from '$lib/server/core';
import { clearSelectionsForContacted } from '$lib/server/outreach/clear-selections';

/**
 * Sync selection state with outreach contacts
 * This endpoint clears selections for influencers that have been contacted
 * Can be called after bulk operations or to fix inconsistent state
 */
export const POST = handleApiRoute(async (event) => {
	const user = requireUser(event);
	const campaignId = event.params.campaignId;
	
	if (!campaignId) {
		throw new ApiProblem({
			status: 400,
			code: 'CAMPAIGN_ID_REQUIRED',
			message: 'Campaign ID is required.'
		});
	}
	
	try {
		// Get all influencer IDs and methods from the request body (optional)
		// If not provided, will sync based on all outreach contacts
		let body: {
			influencerIds?: string[];
			contactMethods?: string[];
		} = {};
		
		try {
			body = await event.request.json();
		} catch {
			// Body is optional - if not provided, will sync all contacts
		}
		
		// Sync selections based on outreach contacts
		await clearSelectionsForContacted(
			user.uid,
			campaignId,
			body.influencerIds || [],
			body.contactMethods || []
		);
		
		return apiOk({ success: true });
	} catch (error) {
		throw new ApiProblem({
			status: 500,
			code: 'SYNC_FAILED',
			message: 'Failed to sync selections with outreach contacts.',
			cause: error
		});
	}
}, { component: 'outreach-contacts' });

