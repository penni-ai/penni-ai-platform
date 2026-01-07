/**
 * Email Queue Item API
 *
 * DELETE /api/outreach/queue/[queueId] - Cancel a queued email
 * POST /api/outreach/queue/[queueId]/retry - Retry a failed email
 */

import { ApiProblem, apiOk, assertSameOrigin, handleApiRoute, requireUser } from '$lib/server/core';
import { cancelQueuedEmail, retryFailedEmail } from '$lib/server/email-queue/queue-service';

export const DELETE = handleApiRoute(
	async (event) => {
		const user = requireUser(event);
		assertSameOrigin(event);
		const queueId = event.params.queueId;

		if (!queueId) {
			throw new ApiProblem({
				status: 400,
				code: 'INVALID_QUEUE_ID',
				message: 'Queue ID is required.'
			});
		}

		try {
			await cancelQueuedEmail(user.uid, queueId);
			return apiOk({ success: true });
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Failed to cancel queued email';

			if (message.includes('not found')) {
				throw new ApiProblem({
					status: 404,
					code: 'QUEUE_ITEM_NOT_FOUND',
					message: 'Queue item not found.'
				});
			}

			if (message.includes('Cannot cancel')) {
				throw new ApiProblem({
					status: 400,
					code: 'CANNOT_CANCEL',
					message
				});
			}

			throw new ApiProblem({
				status: 500,
				code: 'CANCEL_FAILED',
				message
			});
		}
	},
	{ component: 'outreach-queue-item' }
);

export const POST = handleApiRoute(
	async (event) => {
		const user = requireUser(event);
		assertSameOrigin(event);
		const queueId = event.params.queueId;

		if (!queueId) {
			throw new ApiProblem({
				status: 400,
				code: 'INVALID_QUEUE_ID',
				message: 'Queue ID is required.'
			});
		}

		// Check if this is a retry action
		const url = event.url;
		const action = url.searchParams.get('action');

		if (action === 'retry') {
			try {
				await retryFailedEmail(user.uid, queueId);
				return apiOk({ success: true });
			} catch (error) {
				const message = error instanceof Error ? error.message : 'Failed to retry email';

				if (message.includes('not found')) {
					throw new ApiProblem({
						status: 404,
						code: 'QUEUE_ITEM_NOT_FOUND',
						message: 'Queue item not found.'
					});
				}

				if (message.includes('Cannot retry')) {
					throw new ApiProblem({
						status: 400,
						code: 'CANNOT_RETRY',
						message
					});
				}

				throw new ApiProblem({
					status: 500,
					code: 'RETRY_FAILED',
					message
				});
			}
		}

		throw new ApiProblem({
			status: 400,
			code: 'INVALID_ACTION',
			message: 'Invalid action. Use ?action=retry to retry a failed email.'
		});
	},
	{ component: 'outreach-queue-item' }
);
