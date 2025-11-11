import { apiOk, handleApiRoute, requireUser } from '$lib/server/api';
import { serializeCampaignSnapshot } from '$lib/server/campaigns';
import { userDocRef } from '$lib/server/firestore';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export const GET = handleApiRoute(async (event) => {
	const user = requireUser(event);

	const requestedLimit = Number.parseInt(event.url.searchParams.get('limit') ?? '', 10);
	const limit =
		Number.isFinite(requestedLimit) && requestedLimit > 0
			? Math.min(requestedLimit, MAX_LIMIT)
			: DEFAULT_LIMIT;

	const campaignsSnap = await userDocRef(user.uid)
		.collection('campaigns')
		.orderBy('updatedAtMs', 'desc')
		.limit(limit)
		.get();

	const campaigns = campaignsSnap.docs.map((doc) => serializeCampaignSnapshot(doc));

	return apiOk({ campaigns });
}, { component: 'campaigns' });
