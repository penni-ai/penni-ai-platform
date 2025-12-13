/**
 * Single Inbox Usage API
 *
 * GET /api/outreach/inbox-usage/[connectionId] - Get daily usage for specific Gmail inbox
 */

import { ApiProblem, apiOk, handleApiRoute, requireUser } from '$lib/server/core';
import { gmailConnectionDocRef } from '$lib/server/core/firestore';
import { getDailyInboxUsage, DAILY_INBOX_LIMIT } from '$lib/server/usage/daily-inbox-usage';

export const GET = handleApiRoute(
	async (event) => {
		const user = requireUser(event);
		const connectionId = event.params.connectionId;

		if (!connectionId) {
			throw new ApiProblem({
				status: 400,
				code: 'INVALID_CONNECTION_ID',
				message: 'Connection ID is required.'
			});
		}

		// Verify the connection exists and belongs to this user
		const connectionDoc = await gmailConnectionDocRef(user.uid, connectionId).get();

		if (!connectionDoc.exists) {
			throw new ApiProblem({
				status: 404,
				code: 'CONNECTION_NOT_FOUND',
				message: 'Gmail connection not found.'
			});
		}

		const connectionData = connectionDoc.data();
		const email = connectionData?.email || 'Unknown';

		// Get daily usage
		const usage = await getDailyInboxUsage(user.uid, connectionId);

		return apiOk({
			connectionId,
			email,
			date: usage.date,
			sendCount: usage.sendCount,
			remaining: usage.remaining,
			resetAt: usage.resetAt,
			dailyLimit: DAILY_INBOX_LIMIT
		});
	},
	{ component: 'outreach-inbox-usage-single' }
);
