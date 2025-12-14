import type { PageServerLoad } from './$types';
import { getUserEmailQueue, getQueueStats } from '$lib/server/email-queue/queue-service';
import type { QueuedEmail } from '$lib/server/core/firestore';

export interface InboxData {
	outreachEmails: QueuedEmail[];
	outreachStats: {
		queued: number;
		processing: number;
		sent: number;
		failed: number;
		cancelled: number;
		total: number;
	};
}

export const load: PageServerLoad = async ({ locals }): Promise<InboxData> => {
	const uid = locals.user?.uid;

	if (!uid) {
		return {
			outreachEmails: [],
			outreachStats: {
				queued: 0,
				processing: 0,
				sent: 0,
				failed: 0,
				cancelled: 0,
				total: 0
			}
		};
	}

	try {
		// Fetch all emails (up to 200) sorted by most recent
		const outreachEmails = await getUserEmailQueue(uid, {
			limit: 200
		});

		// Get queue statistics
		const outreachStats = await getQueueStats(uid);

		return {
			outreachEmails,
			outreachStats
		};
	} catch (error) {
		console.error('Failed to load inbox outreach data:', error);
		return {
			outreachEmails: [],
			outreachStats: {
				queued: 0,
				processing: 0,
				sent: 0,
				failed: 0,
				cancelled: 0,
				total: 0
			}
		};
	}
};
