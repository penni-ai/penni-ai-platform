import { handleApiRoute } from '$lib/server/api';
import { requireUser } from '$lib/server/api';
import { apiOk, ApiProblem } from '$lib/server/api';
import { revokeGmailTokens } from '$lib/server/gmail-auth';

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
			message: 'connectionId is required to disconnect Gmail.'
		});
	}
	await revokeGmailTokens(user.uid, connectionId);
	return apiOk({
		success: true,
		connectionId
	});
}, { component: 'gmail_oauth' });
