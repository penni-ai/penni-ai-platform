import { apiOk, handleApiRoute, requireUser } from '$lib/server/api';
import { getSearchUsage } from '$lib/server/search-usage';
import { getOutreachUsage } from '$lib/server/outreach-usage';

export const GET = handleApiRoute(async (event) => {
	const user = requireUser(event);
	const [searchUsage, outreachUsage] = await Promise.all([
		getSearchUsage(user.uid),
		getOutreachUsage(user.uid)
	]);
	return apiOk({
		search: searchUsage,
		outreach: outreachUsage
	});
}, { component: 'usage' });

