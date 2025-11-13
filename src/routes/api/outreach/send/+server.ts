import { ApiProblem, apiOk, handleApiRoute, requireUser } from '$lib/server/api';
import { getOutreachUsage, incrementOutreachUsage } from '$lib/server/outreach-usage';

export const POST = handleApiRoute(async (event) => {
	const user = requireUser(event);
	
	let body: { influencerIds: string[] };
	try {
		body = await event.request.json();
	} catch (error) {
		throw new ApiProblem({
			status: 400,
			code: 'INVALID_JSON',
			message: 'Request body must be valid JSON.',
			hint: 'Send a JSON payload with an "influencerIds" array.',
			cause: error
		});
	}

	if (!Array.isArray(body.influencerIds) || body.influencerIds.length === 0) {
		throw new ApiProblem({
			status: 400,
			code: 'INVALID_INFLUENCER_IDS',
			message: 'influencerIds must be a non-empty array.'
		});
	}

	// Check current usage
	const usage = await getOutreachUsage(user.uid);
	const requestedCount = body.influencerIds.length;
	
	if (usage.remaining < requestedCount) {
		throw new ApiProblem({
			status: 403,
			code: 'OUTREACH_LIMIT_EXCEEDED',
			message: `You have ${usage.remaining} outreach emails remaining, but requested ${requestedCount}.`,
			hint: 'Upgrade your plan or wait for the monthly reset.'
		});
	}

	// Increment usage
	await incrementOutreachUsage(user.uid, requestedCount);

	// TODO: Actually send the outreach emails
	// For now, just return success
	return apiOk({
		success: true,
		sent: requestedCount,
		remaining: usage.remaining - requestedCount
	});
}, { component: 'outreach-send' });

