import { describe, expect, it, vi } from 'vitest';

import { createFirebaseAdminMock, FakeFirestore } from '../../helpers/fake-firebase';

function makeEvent(options: { uid?: string; url: string; params?: Record<string, string> }) {
	const url = new URL(options.url);
	return {
		locals: { user: options.uid ? ({ uid: options.uid, email: 'u@test.com' } as any) : null, requestId: 'req_test' },
		params: options.params ?? {},
		request: new Request(url.toString(), { method: 'GET' }),
		url
	} as any;
}

describe('routes/api/outreach/inbox-usage', () => {
	it('returns empty when user has no Gmail connections', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore();
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		vi.doMock('$lib/server/usage/daily-inbox-usage', () => ({
			getAllInboxesDailyUsage: vi.fn(),
			getDailyInboxUsage: vi.fn(),
			DAILY_INBOX_LIMIT: 25
		}));

		const { GET } = await import('../../../src/routes/api/outreach/inbox-usage/+server');
		const res = await GET(makeEvent({ url: 'http://localhost/api/outreach/inbox-usage', uid: 'u1' }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			connections: {},
			dailyLimit: 25,
			message: 'No Gmail connections found'
		});
	});

	it('returns per-connection usage for all inboxes', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({
			'users/u1/gmailConnections/conn1': { email: 'a@example.com' },
			'users/u1/gmailConnections/conn2': { email: 'b@example.com' }
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const getAllInboxesDailyUsage = vi.fn(async () => ({
			conn1: { sendCount: 2, remaining: 23, resetAt: 111, date: '2025-01-01' }
		}));
		vi.doMock('$lib/server/usage/daily-inbox-usage', () => ({
			getAllInboxesDailyUsage,
			getDailyInboxUsage: vi.fn(),
			DAILY_INBOX_LIMIT: 25
		}));

		const { GET } = await import('../../../src/routes/api/outreach/inbox-usage/+server');
		const res = await GET(makeEvent({ url: 'http://localhost/api/outreach/inbox-usage', uid: 'u1' }));
		expect(res.status).toBe(200);
		const body = await res.json();

		expect(getAllInboxesDailyUsage).toHaveBeenCalledWith('u1', ['conn1', 'conn2']);
		expect(body.dailyLimit).toBe(25);
		expect(body.connections.conn1).toEqual({ email: 'a@example.com', sendCount: 2, remaining: 23, resetAt: 111 });
		expect(body.connections.conn2).toEqual({ email: 'b@example.com', sendCount: 0, remaining: 25, resetAt: 0 });
	});
});

describe('routes/api/outreach/inbox-usage/[connectionId]', () => {
	it('validates params and connection existence', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore();
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		vi.doMock('$lib/server/usage/daily-inbox-usage', () => ({
			getDailyInboxUsage: vi.fn(async () => ({ date: 'd', sendCount: 0, remaining: 1, resetAt: 2 })),
			getAllInboxesDailyUsage: vi.fn(),
			DAILY_INBOX_LIMIT: 10
		}));

		const { GET } = await import('../../../src/routes/api/outreach/inbox-usage/[connectionId]/+server');
		const missing = await GET(makeEvent({ url: 'http://localhost/api/outreach/inbox-usage/', uid: 'u1', params: {} }));
		expect(missing.status).toBe(400);

		const notFound = await GET(
			makeEvent({ url: 'http://localhost/api/outreach/inbox-usage/conn1', uid: 'u1', params: { connectionId: 'conn1' } })
		);
		expect(notFound.status).toBe(404);
	});

	it('returns usage for existing connection', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({
			'users/u1/gmailConnections/conn1': { email: 'a@example.com' }
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const getDailyInboxUsage = vi.fn(async () => ({ date: '2025-01-01', sendCount: 2, remaining: 8, resetAt: 123 }));
		vi.doMock('$lib/server/usage/daily-inbox-usage', () => ({
			getDailyInboxUsage,
			getAllInboxesDailyUsage: vi.fn(),
			DAILY_INBOX_LIMIT: 10
		}));

		const { GET } = await import('../../../src/routes/api/outreach/inbox-usage/[connectionId]/+server');
		const res = await GET(
			makeEvent({ url: 'http://localhost/api/outreach/inbox-usage/conn1', uid: 'u1', params: { connectionId: 'conn1' } })
		);
		expect(res.status).toBe(200);
		expect(getDailyInboxUsage).toHaveBeenCalledWith('u1', 'conn1');
		expect(await res.json()).toEqual({
			connectionId: 'conn1',
			email: 'a@example.com',
			date: '2025-01-01',
			sendCount: 2,
			remaining: 8,
			resetAt: 123,
			dailyLimit: 10
		});
	});
});

