/**
 * Email Queue API
 *
 * GET /api/outreach/queue - List user's queued emails
 */

import { apiOk, handleApiRoute, requireUser } from '$lib/server/core';
import { getUserEmailQueue, getQueueStats } from '$lib/server/email-queue/queue-service';
import type { EmailQueueStatus } from '$lib/server/core/firestore';

export const GET = handleApiRoute(
	async (event) => {
		const user = requireUser(event);

		// Parse query params
		const url = event.url;
		const statusParam = url.searchParams.get('status');
		const connectionId = url.searchParams.get('connectionId');
		const campaignId = url.searchParams.get('campaignId');
		const limitParam = url.searchParams.get('limit');
		const includeStats = url.searchParams.get('includeStats') === 'true';

		// Parse status (can be comma-separated for multiple)
		let status: EmailQueueStatus | EmailQueueStatus[] | undefined;
		if (statusParam) {
			const statuses = statusParam.split(',') as EmailQueueStatus[];
			status = statuses.length === 1 ? statuses[0] : statuses;
		}

		const limit = limitParam ? parseInt(limitParam, 10) : undefined;

		// Get queue items
		const items = await getUserEmailQueue(user.uid, {
			status,
			connectionId: connectionId ?? undefined,
			campaignId: campaignId ?? undefined,
			limit
		});

		// Optionally include stats
		let stats;
		if (includeStats) {
			stats = await getQueueStats(user.uid);
		}

		return apiOk({
			items,
			count: items.length,
			stats
		});
	},
	{ component: 'outreach-queue' }
);
