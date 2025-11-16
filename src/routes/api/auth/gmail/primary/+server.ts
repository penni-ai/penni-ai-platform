import { handleApiRoute, requireUser, apiOk, ApiProblem } from '$lib/server/core';
import { setPrimaryGmailConnection } from '$lib/server/gmail';

export const POST = handleApiRoute(async (event) => {
	const user = requireUser(event);
	let body: { connectionId?: string };
	try {
		body = await event.request.json();
	} catch (error) {
		body = {};
	}
	const connectionId = body.connectionId;
	if (!connectionId) {
		throw new ApiProblem({
			status: 400,
			code: 'MISSING_CONNECTION_ID',
			message: 'connectionId is required to set the primary Gmail account.'
		});
	}
	await setPrimaryGmailConnection(user.uid, connectionId);
	return apiOk({ success: true, connectionId });
}, { component: 'gmail_oauth' });
