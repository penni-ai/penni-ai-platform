import { describe, expect, it, vi } from 'vitest';

import { createFirebaseAdminMock, FakeFirestore } from '../../helpers/fake-firebase';

function makeEvent(options: { uid?: string; params?: Record<string, string> }) {
	const url = new URL('http://localhost/api/outreach/c1');
	return {
		locals: { user: options.uid ? ({ uid: options.uid, email: 'u@test.com' } as any) : null, requestId: 'req_test' },
		params: options.params ?? {},
		request: new Request(url.toString(), { method: 'GET' }),
		url
	} as any;
}

describe('routes/api/outreach/[campaignId] GET', () => {
	it('validates campaign id and missing docs', async () => {
		vi.resetModules();
		const firestore = new FakeFirestore();
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const { GET } = await import('../../../src/routes/api/outreach/[campaignId]/+server');

		const missing = await GET(makeEvent({ uid: 'u1', params: {} }));
		expect(missing.status).toBe(400);

		const notFound = await GET(makeEvent({ uid: 'u1', params: { campaignId: 'c1' } }));
		expect(notFound.status).toBe(404);
	});

	it('returns pipelineId for existing campaign', async () => {
		vi.resetModules();
		const firestore = new FakeFirestore({
			'users/u1/campaigns/c1': { pipeline_id: 'p1' }
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const { GET } = await import('../../../src/routes/api/outreach/[campaignId]/+server');
		const res = await GET(makeEvent({ uid: 'u1', params: { campaignId: 'c1' } }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ campaignId: 'c1', pipelineId: 'p1' });
	});

	it('wraps unexpected errors', async () => {
		vi.resetModules();

		const campaignDocRef = vi.fn(() => ({
			get: vi.fn(async () => {
				throw new Error('boom');
			})
		}));
		vi.doMock('$lib/server/core/firestore', () => ({ campaignDocRef }));

		const { GET } = await import('../../../src/routes/api/outreach/[campaignId]/+server');
		const res = await GET(makeEvent({ uid: 'u1', params: { campaignId: 'c1' } }));
		expect(res.status).toBe(500);
		expect((await res.json()).error.code).toBe('OUTREACH_DATA_FETCH_FAILED');
	});
});

