import { describe, expect, it, vi } from 'vitest';

import { createFirebaseAdminMock, FakeFirestore } from '../../helpers/fake-firebase';

function makeEvent(options: { url: string; uid?: string; method: string; params?: Record<string, string>; body?: unknown; rawBody?: string }) {
	const url = new URL(options.url);
	return {
		locals: { user: options.uid ? ({ uid: options.uid, email: 'u@test.com' } as any) : null, requestId: 'req_test' },
		params: options.params ?? {},
		request: new Request(url.toString(), {
			method: options.method,
			headers: { origin: url.origin, 'content-type': 'application/json' },
			body: options.rawBody ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined)
		}),
		url
	} as any;
}

describe('routes/api/outreach/contacts/[campaignId]', () => {
	it('returns unique contacted influencerIds for pending/sent', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({
			'users/u1/campaigns/c1/outreach_contacts/a': { sendStatus: 'pending', influencerId: 'inf1' },
			'users/u1/campaigns/c1/outreach_contacts/b': { sendStatus: 'sent', influencerId: 'inf1' },
			'users/u1/campaigns/c1/outreach_contacts/c': { sendStatus: 'failed', influencerId: 'inf2' },
			'users/u1/campaigns/c1/outreach_contacts/d': { sendStatus: 'sent', influencerId: 'inf3' }
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const { GET } = await import('../../../src/routes/api/outreach/contacts/[campaignId]/+server');
		const res = await GET(
			makeEvent({ url: 'http://localhost/api/outreach/contacts/c1', uid: 'u1', method: 'GET', params: { campaignId: 'c1' } })
		);
		expect(res.status).toBe(200);
		expect((await res.json()).contactedInfluencerIds.sort()).toEqual(['inf1', 'inf3']);
	});

	it('validates campaignId and returns 500 when fetch fails', async () => {
		vi.resetModules();

		const adminDb = new FakeFirestore() as any;
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
		vi.doMock('$lib/server/core/firestore', () => ({
			outreachContactsCollectionRef: () => ({ get: async () => { throw new Error('boom'); } })
		}));

		const { GET } = await import('../../../src/routes/api/outreach/contacts/[campaignId]/+server');

		const missingId = await GET(
			makeEvent({ url: 'http://localhost/api/outreach/contacts', uid: 'u1', method: 'GET', params: {} })
		);
		expect(missingId.status).toBe(400);

		const res = await GET(
			makeEvent({ url: 'http://localhost/api/outreach/contacts/c1', uid: 'u1', method: 'GET', params: { campaignId: 'c1' } })
		);
		expect(res.status).toBe(500);
		expect((await res.json()).error.code).toBe('CONTACTS_FETCH_FAILED');
	});
});

describe('routes/api/outreach/contacts/[campaignId]/sync-selections', () => {
	it('passes through influencerIds and contactMethods (body optional)', async () => {
		vi.resetModules();

		const clearSelectionsForContacted = vi.fn(async () => {});
		vi.doMock('$lib/server/outreach/clear-selections', () => ({ clearSelectionsForContacted }));

		const { POST } = await import('../../../src/routes/api/outreach/contacts/[campaignId]/sync-selections/+server');

		const resBody = await POST(
			makeEvent({
				url: 'http://localhost/api/outreach/contacts/c1/sync-selections',
				uid: 'u1',
				method: 'POST',
				params: { campaignId: 'c1' },
				body: { influencerIds: ['a'], contactMethods: ['email'] }
			})
		);
		expect(resBody.status).toBe(200);
		expect(clearSelectionsForContacted).toHaveBeenCalledWith('u1', 'c1', ['a'], ['email']);

		const resNoBody = await POST(
			makeEvent({
				url: 'http://localhost/api/outreach/contacts/c1/sync-selections',
				uid: 'u1',
				method: 'POST',
				params: { campaignId: 'c1' },
				rawBody: '{'
			})
		);
		expect(resNoBody.status).toBe(200);
		expect(clearSelectionsForContacted).toHaveBeenCalledWith('u1', 'c1', [], []);
	});

	it('validates campaignId and maps sync failures', async () => {
		vi.resetModules();

		const clearSelectionsForContacted = vi.fn(async () => {
			throw new Error('boom');
		});
		vi.doMock('$lib/server/outreach/clear-selections', () => ({ clearSelectionsForContacted }));

		const { POST } = await import('../../../src/routes/api/outreach/contacts/[campaignId]/sync-selections/+server');

		const missingId = await POST(
			makeEvent({
				url: 'http://localhost/api/outreach/contacts/c1/sync-selections',
				uid: 'u1',
				method: 'POST',
				params: {},
				body: { influencerIds: [] }
			})
		);
		expect(missingId.status).toBe(400);

		const res = await POST(
			makeEvent({
				url: 'http://localhost/api/outreach/contacts/c1/sync-selections',
				uid: 'u1',
				method: 'POST',
				params: { campaignId: 'c1' },
				body: { influencerIds: ['a'], contactMethods: ['email'] }
			})
		);
		expect(res.status).toBe(500);
		expect((await res.json()).error.code).toBe('SYNC_FAILED');
	});
});
