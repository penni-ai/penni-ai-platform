import { describe, expect, it, vi } from 'vitest';

import { createFirebaseAdminMock, FakeFirestore } from '../../helpers/fake-firebase';

function makeEvent(options: {
	url: string;
	uid?: string;
	method: 'GET' | 'PUT' | 'DELETE';
	params?: Record<string, string>;
	body?: unknown;
	rawBody?: string;
}) {
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

describe('routes/api/outreach/state/[campaignId]', () => {
	it('GET validates campaignId and returns null when missing/mismatched', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({
			'users/u1/campaigns/c1/outreach_state/current': { campaignId: 'other', currentStage: 'x' }
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const route = await import('../../../src/routes/api/outreach/state/[campaignId]/+server');
		const missing = await route.GET(makeEvent({ url: 'http://localhost/api/outreach/state', uid: 'u1', method: 'GET', params: {} }));
		expect(missing.status).toBe(400);
		expect((await missing.json()).error.code).toBe('CAMPAIGN_ID_REQUIRED');

		const noDoc = await route.GET(
			makeEvent({ url: 'http://localhost/api/outreach/state/c2', uid: 'u1', method: 'GET', params: { campaignId: 'c2' } })
		);
		expect(noDoc.status).toBe(200);
		expect(await noDoc.json()).toEqual({ state: null });

		const mismatch = await route.GET(
			makeEvent({ url: 'http://localhost/api/outreach/state/c1', uid: 'u1', method: 'GET', params: { campaignId: 'c1' } })
		);
		expect(mismatch.status).toBe(200);
		expect(await mismatch.json()).toEqual({ state: null });
	});

	it('GET returns state and maps Firestore errors to 500', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({
			'users/u1/campaigns/c1/outreach_state/current': { campaignId: 'c1', currentStage: 'select-methods' }
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const route = await import('../../../src/routes/api/outreach/state/[campaignId]/+server');
		const ok = await route.GET(
			makeEvent({ url: 'http://localhost/api/outreach/state/c1', uid: 'u1', method: 'GET', params: { campaignId: 'c1' } })
		);
		expect(ok.status).toBe(200);
		expect((await ok.json()).state.currentStage).toBe('select-methods');

		const originalGet = (firestore as any)._get.bind(firestore);
		(firestore as any)._get = (path: string) => {
			if (path.includes('/outreach_state/current')) throw new Error('boom');
			return originalGet(path);
		};

		const failed = await route.GET(
			makeEvent({ url: 'http://localhost/api/outreach/state/c1', uid: 'u1', method: 'GET', params: { campaignId: 'c1' } })
		);
		expect(failed.status).toBe(500);
		expect((await failed.json()).error.code).toBe('STATE_FETCH_FAILED');
	});

	it('PUT supports partial updates, validates full updates, and maps failures to 500', async () => {
		vi.resetModules();
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));

		const firestore = new FakeFirestore({
			'users/u1/campaigns/c1/outreach_state/current': {
				campaignId: 'c1',
				currentStage: 'select-methods',
				editingPlatform: null,
				selectedInfluencerIds: ['a'],
				selectedMethods: { email: true },
				messageContents: { email: 'e', instagram: 'i', tiktok: 't' },
				selectedGmailConnectionId: 'conn1',
				updatedAt: 1,
				createdAt: 1,
				version: 1
			}
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const route = await import('../../../src/routes/api/outreach/state/[campaignId]/+server');

		const missingId = await route.PUT(makeEvent({ url: 'http://localhost/api/outreach/state', uid: 'u1', method: 'PUT', params: {}, body: {} }));
		expect(missingId.status).toBe(400);

		const invalidJson = await route.PUT(
			makeEvent({
				url: 'http://localhost/api/outreach/state/c1',
				uid: 'u1',
				method: 'PUT',
				params: { campaignId: 'c1' },
				rawBody: '{'
			})
		);
		expect(invalidJson.status).toBe(400);
		expect((await invalidJson.json()).error.code).toBe('INVALID_JSON');

		const invalidFull = await route.PUT(
			makeEvent({
				url: 'http://localhost/api/outreach/state/c1',
				uid: 'u1',
				method: 'PUT',
				params: { campaignId: 'c1' },
				body: { selectedInfluencerIds: undefined, currentStage: 'x' }
			})
		);
		expect(invalidFull.status).toBe(400);
		expect((await invalidFull.json()).error.code).toBe('INVALID_STATE');

		const partial = await route.PUT(
			makeEvent({
				url: 'http://localhost/api/outreach/state/c1',
				uid: 'u1',
				method: 'PUT',
				params: { campaignId: 'c1' },
				body: { selectedInfluencerIds: ['b', 'c'] }
			})
		);
		expect(partial.status).toBe(200);
		expect((await partial.json()).success).toBe(true);

		const snap = await adminDb.collection('users').doc('u1').collection('campaigns').doc('c1').collection('outreach_state').doc('current').get();
		expect(snap.get('selectedInfluencerIds')).toEqual(['b', 'c']);
		expect(snap.get('selectedMethods.email')).toBe(true);
		expect(snap.get('createdAt')).toBe(1);

		// Partial update when no existing doc should use defaults and allow explicit nulls.
		const partialNew = await route.PUT(
			makeEvent({
				url: 'http://localhost/api/outreach/state/c2',
				uid: 'u1',
				method: 'PUT',
				params: { campaignId: 'c2' },
				body: { selectedInfluencerIds: [], selectedGmailConnectionId: null }
			})
		);
		expect(partialNew.status).toBe(200);
		const newSnap = await adminDb.collection('users').doc('u1').collection('campaigns').doc('c2').collection('outreach_state').doc('current').get();
		expect(newSnap.get('messageContents.email')).toBe('');
		expect(newSnap.get('selectedGmailConnectionId')).toBe(null);

		const originalSet = (firestore as any)._set.bind(firestore);
		(firestore as any)._set = (path: string, data: any, opts: any) => {
			if (path.includes('/outreach_state/current')) throw new Error('write fail');
			return originalSet(path, data, opts);
		};

		const failed = await route.PUT(
			makeEvent({
				url: 'http://localhost/api/outreach/state/c1',
				uid: 'u1',
				method: 'PUT',
				params: { campaignId: 'c1' },
				body: { selectedInfluencerIds: ['x'], currentStage: 'select-methods', selectedMethods: {}, messageContents: {} }
			})
		);
		expect(failed.status).toBe(500);
		expect((await failed.json()).error.code).toBe('STATE_SAVE_FAILED');

		vi.useRealTimers();
	});

	it('DELETE removes state and maps failures to 500', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({
			'users/u1/campaigns/c1/outreach_state/current': { campaignId: 'c1' }
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const route = await import('../../../src/routes/api/outreach/state/[campaignId]/+server');
		const missing = await route.DELETE(makeEvent({ url: 'http://localhost/api/outreach/state', uid: 'u1', method: 'DELETE', params: {} }));
		expect(missing.status).toBe(400);

		const ok = await route.DELETE(
			makeEvent({ url: 'http://localhost/api/outreach/state/c1', uid: 'u1', method: 'DELETE', params: { campaignId: 'c1' } })
		);
		expect(ok.status).toBe(200);

		const deleted = await adminDb.collection('users').doc('u1').collection('campaigns').doc('c1').collection('outreach_state').doc('current').get();
		expect(deleted.exists).toBe(false);

		const originalDelete = (firestore as any)._delete.bind(firestore);
		(firestore as any)._delete = (path: string) => {
			if (path.includes('/outreach_state/current')) throw new Error('delete fail');
			return originalDelete(path);
		};

		await adminDb.collection('users').doc('u1').collection('campaigns').doc('c1').collection('outreach_state').doc('current').set({ campaignId: 'c1' });
		const failed = await route.DELETE(
			makeEvent({ url: 'http://localhost/api/outreach/state/c1', uid: 'u1', method: 'DELETE', params: { campaignId: 'c1' } })
		);
		expect(failed.status).toBe(500);
		expect((await failed.json()).error.code).toBe('STATE_DELETE_FAILED');
	});
});
