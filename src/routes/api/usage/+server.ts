import { apiOk, handleApiRoute, requireUser } from '$lib/server/core';
import { getSearchUsage } from '$lib/server/usage';
import { getOutreachUsage } from '$lib/server/usage';

export const GET = handleApiRoute(async (event) => {
	const user = requireUser(event);
	const [searchUsage, outreachUsage] = await Promise.all([
		getSearchUsage(user.uid),
		getOutreachUsage(user.uid)
	]);
	return apiOk({
		influencersFound: searchUsage,
		outreachSent: outreachUsage
	});
}, { component: 'usage' });

