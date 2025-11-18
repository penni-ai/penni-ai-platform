import { createCampaign } from '$lib/server/campaigns';
import { ApiProblem, apiOk, assertSameOrigin, handleApiRoute, requireUser } from '$lib/server/core';
import { serializeCampaignSnapshot } from '$lib/server/campaigns';
import { userDocRef } from '$lib/server/core';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 1000;

export const GET = handleApiRoute(async (event) => {
	const user = requireUser(event);

	const requestedLimit = Number.parseInt(event.url.searchParams.get('limit') ?? '', 10);
	const limit =
		Number.isFinite(requestedLimit) && requestedLimit > 0
			? Math.min(requestedLimit, MAX_LIMIT)
			: DEFAULT_LIMIT;

	const campaignsSnap = await userDocRef(user.uid)
		.collection('campaigns')
		.orderBy('updatedAt', 'desc')
		.limit(limit)
		.get();

	const campaigns = await Promise.all(
		campaignsSnap.docs.map((doc) => serializeCampaignSnapshot(doc, user.uid))
	);

	return apiOk({ campaigns });
}, { component: 'campaigns' });

export const POST = handleApiRoute(async (event) => {
	const user = requireUser(event);
	assertSameOrigin(event);

	const logger = event.locals.logger.child({ component: 'campaigns', action: 'create_campaign' });

	try {
		const campaignId = await createCampaign(user.uid, logger);
		logger.info('Campaign created', { campaignId });
		return apiOk({ campaignId });
	} catch (error) {
		logger.error('Failed to create campaign', { error });
		throw new ApiProblem({
			status: 500,
			code: 'CAMPAIGN_CREATE_FAILED',
			message: 'Failed to create a new campaign.',
			hint: 'Please retry in a moment.',
			cause: error
		});
	}
}, { component: 'campaigns' });
