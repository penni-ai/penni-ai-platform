import { apiOk, handleApiRoute, requireUser } from '$lib/server/api';
import { getOutreachUsage } from '$lib/server/outreach-usage';

export const GET = handleApiRoute(async (event) => {
	const user = requireUser(event);
	const usage = await getOutreachUsage(user.uid);
	return apiOk(usage);
}, { component: 'outreach-usage' });

