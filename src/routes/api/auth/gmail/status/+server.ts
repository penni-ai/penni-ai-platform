import { handleApiRoute } from '$lib/server/api';
import { requireUser } from '$lib/server/api';
import { apiOk } from '$lib/server/api';
import { getGmailConnection, listGmailConnections } from '$lib/server/gmail-auth';

export const GET = handleApiRoute(async (event) => {
	const user = requireUser(event);
	
	const connections = await listGmailConnections(user.uid);
	let primaryConnection = null;
	try {
		primaryConnection = await getGmailConnection(user.uid);
	} catch (error) {
		primaryConnection = null;
	}
	return apiOk({
		connected: connections.length > 0,
		email: primaryConnection?.email ?? null,
		connectedAt: primaryConnection?.connected_at ?? null,
		lastRefreshedAt: primaryConnection?.last_refreshed_at ?? null,
		connections
	});
}, { component: 'gmail_oauth' });
