/**
 * Inbox Usage API
 *
 * GET /api/outreach/inbox-usage - Get daily usage for all Gmail inboxes
 */

import { apiOk, handleApiRoute, requireUser } from '$lib/server/core';
import { gmailConnectionsCollectionRef } from '$lib/server/core/firestore';
import {
	getAllInboxesDailyUsage,
	DAILY_INBOX_LIMIT
} from '$lib/server/usage/daily-inbox-usage';

export const GET = handleApiRoute(
	async (event) => {
		const user = requireUser(event);

		// Get all Gmail connections for this user
		const connectionsSnap = await gmailConnectionsCollectionRef(user.uid).get();

		if (connectionsSnap.empty) {
			return apiOk({
				connections: {},
				dailyLimit: DAILY_INBOX_LIMIT,
				message: 'No Gmail connections found'
			});
		}

		// Get connection IDs and emails
		const connections: Array<{ id: string; email: string }> = [];
		for (const doc of connectionsSnap.docs) {
			const data = doc.data();
			connections.push({
				id: doc.id,
				email: data.email || 'Unknown'
			});
		}

		// Get daily usage for all connections
		const connectionIds = connections.map((c) => c.id);
		const usageByConnection = await getAllInboxesDailyUsage(user.uid, connectionIds);

		// Combine connection info with usage
		const result: Record<
			string,
			{
				email: string;
				sendCount: number;
				remaining: number;
				resetAt: number;
			}
		> = {};

		for (const conn of connections) {
			const usage = usageByConnection[conn.id];
			result[conn.id] = {
				email: conn.email,
				sendCount: usage?.sendCount ?? 0,
				remaining: usage?.remaining ?? DAILY_INBOX_LIMIT,
				resetAt: usage?.resetAt ?? 0
			};
		}

		return apiOk({
			connections: result,
			dailyLimit: DAILY_INBOX_LIMIT
		});
	},
	{ component: 'outreach-inbox-usage' }
);
