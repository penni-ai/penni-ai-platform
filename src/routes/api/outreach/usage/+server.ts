import { apiOk, handleApiRoute, requireUser } from '$lib/server/core';
import { getOutreachUsage } from '$lib/server/usage';

export const GET = handleApiRoute(async (event) => {
	const user = requireUser(event);
	const usage = await getOutreachUsage(user.uid);
	return apiOk(usage);
}, { component: 'outreach-usage' });

