import { describe, expect, it, vi } from 'vitest';

function makeEvent(options: { url: string; uid?: string; method: string; params?: Record<string, string> }) {
	const url = new URL(options.url);
	return {
		locals: { user: options.uid ? ({ uid: options.uid, email: 'u@test.com' } as any) : null, requestId: 'req_test' },
		params: options.params ?? {},
		request: new Request(url.toString(), { method: options.method }),
		url
	} as any;
}

describe('routes/api/outreach/queue', () => {
	it('lists queue items and optionally includes stats', async () => {
		vi.resetModules();

		const getUserEmailQueue = vi.fn(async (_uid: string, opts: any) => [{ id: 'q1', opts }]);
		const getQueueStats = vi.fn(async () => ({ total: 1 }));
		vi.doMock('$lib/server/email-queue/queue-service', () => ({
			getUserEmailQueue,
			getQueueStats,
			cancelQueuedEmail: vi.fn(),
			retryFailedEmail: vi.fn()
		}));

		const { GET } = await import('../../../src/routes/api/outreach/queue/+server');
		const res = await GET(
			makeEvent({
				url: 'http://localhost/api/outreach/queue?status=failed,queued&connectionId=c1&campaignId=cmp&limit=10&includeStats=true',
				uid: 'u1',
				method: 'GET'
			})
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.count).toBe(1);
		expect(body.stats).toEqual({ total: 1 });
		expect(getUserEmailQueue).toHaveBeenCalledWith('u1', {
			status: ['failed', 'queued'],
			connectionId: 'c1',
			campaignId: 'cmp',
			limit: 10
		});
	});
});

describe('routes/api/outreach/queue/[queueId]', () => {
	it('cancels queue items with mapped errors', async () => {
		vi.resetModules();

		const cancelQueuedEmail = vi.fn(async () => {});
		const retryFailedEmail = vi.fn(async () => {});
		vi.doMock('$lib/server/email-queue/queue-service', () => ({
			getUserEmailQueue: vi.fn(),
			getQueueStats: vi.fn(),
			cancelQueuedEmail,
			retryFailedEmail
		}));

		const route = await import('../../../src/routes/api/outreach/queue/[queueId]/+server');

		const missing = await route.DELETE(
			makeEvent({ url: 'http://localhost/api/outreach/queue', uid: 'u1', method: 'DELETE', params: {} })
		);
		expect(missing.status).toBe(400);

		const ok = await route.DELETE(
			makeEvent({ url: 'http://localhost/api/outreach/queue/q1', uid: 'u1', method: 'DELETE', params: { queueId: 'q1' } })
		);
		expect(ok.status).toBe(200);
		expect(cancelQueuedEmail).toHaveBeenCalledWith('u1', 'q1');

		cancelQueuedEmail.mockRejectedValueOnce(new Error('not found'));
		const missingItem = await route.DELETE(
			makeEvent({ url: 'http://localhost/api/outreach/queue/q2', uid: 'u1', method: 'DELETE', params: { queueId: 'q2' } })
		);
		expect(missingItem.status).toBe(404);

		cancelQueuedEmail.mockRejectedValueOnce(new Error('Cannot cancel because already sent'));
		const badCancel = await route.DELETE(
			makeEvent({ url: 'http://localhost/api/outreach/queue/q3', uid: 'u1', method: 'DELETE', params: { queueId: 'q3' } })
		);
		expect(badCancel.status).toBe(400);

		cancelQueuedEmail.mockRejectedValueOnce(new Error('oops'));
		const failed = await route.DELETE(
			makeEvent({ url: 'http://localhost/api/outreach/queue/q4', uid: 'u1', method: 'DELETE', params: { queueId: 'q4' } })
		);
		expect(failed.status).toBe(500);

		const unauth = await route.DELETE(
			makeEvent({ url: 'http://localhost/api/outreach/queue/q5', method: 'DELETE', params: { queueId: 'q5' } })
		);
		expect(unauth.status).toBe(401);
	});

	it('retries failed emails and validates action', async () => {
		vi.resetModules();

		const retryFailedEmail = vi.fn(async () => {});
		vi.doMock('$lib/server/email-queue/queue-service', () => ({
			getUserEmailQueue: vi.fn(),
			getQueueStats: vi.fn(),
			cancelQueuedEmail: vi.fn(),
			retryFailedEmail
		}));

		const { POST } = await import('../../../src/routes/api/outreach/queue/[queueId]/+server');

		const missingId = await POST(makeEvent({ url: 'http://localhost/api/outreach/queue', uid: 'u1', method: 'POST', params: {} }));
		expect(missingId.status).toBe(400);

		const invalid = await POST(
			makeEvent({ url: 'http://localhost/api/outreach/queue/q1', uid: 'u1', method: 'POST', params: { queueId: 'q1' } })
		);
		expect(invalid.status).toBe(400);

		const ok = await POST(
			makeEvent({ url: 'http://localhost/api/outreach/queue/q1?action=retry', uid: 'u1', method: 'POST', params: { queueId: 'q1' } })
		);
		expect(ok.status).toBe(200);
		expect(retryFailedEmail).toHaveBeenCalledWith('u1', 'q1');

		retryFailedEmail.mockRejectedValueOnce(new Error('Cannot retry'));
		const bad = await POST(
			makeEvent({ url: 'http://localhost/api/outreach/queue/q2?action=retry', uid: 'u1', method: 'POST', params: { queueId: 'q2' } })
		);
		expect(bad.status).toBe(400);

		retryFailedEmail.mockRejectedValueOnce(new Error('not found'));
		const missingItem = await POST(
			makeEvent({ url: 'http://localhost/api/outreach/queue/q3?action=retry', uid: 'u1', method: 'POST', params: { queueId: 'q3' } })
		);
		expect(missingItem.status).toBe(404);

		retryFailedEmail.mockRejectedValueOnce(new Error('boom'));
		const failed = await POST(
			makeEvent({ url: 'http://localhost/api/outreach/queue/q4?action=retry', uid: 'u1', method: 'POST', params: { queueId: 'q4' } })
		);
		expect(failed.status).toBe(500);

		const unauth = await POST(
			makeEvent({ url: 'http://localhost/api/outreach/queue/q5?action=retry', method: 'POST', params: { queueId: 'q5' } })
		);
		expect(unauth.status).toBe(401);
	});
});
