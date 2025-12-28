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

describe('routes/api/campaigns', () => {
	it('GET lists campaigns using serializer', async () => {
		vi.resetModules();
		const firestore = new FakeFirestore({
			'users/u1/campaigns/c1': { updatedAt: 2 },
			'users/u1/campaigns/c2': { updatedAt: 1 }
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const serializeCampaignSnapshot = vi.fn(async (doc: any) => ({ id: doc.id }));
		vi.doMock('$lib/server/campaigns', () => ({
			createCampaign: vi.fn(),
			serializeCampaignSnapshot,
			serializeCampaignRecord: vi.fn()
		}));

		const { GET } = await import('../../../src/routes/api/campaigns/+server');
		const res = await GET(makeEvent({ url: 'http://localhost/api/campaigns?limit=1', uid: 'u1', method: 'GET' }));
		expect(res.status).toBe(200);
		expect((await res.json()).campaigns).toEqual([{ id: 'c1' }]);
	});

	it('GET applies default limit when missing/invalid', async () => {
		vi.resetModules();
		const firestore = new FakeFirestore({
			'users/u1/campaigns/c1': { updatedAt: 2 },
			'users/u1/campaigns/c2': { updatedAt: 1 }
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const serializeCampaignSnapshot = vi.fn(async (doc: any) => ({ id: doc.id }));
		vi.doMock('$lib/server/campaigns', () => ({
			createCampaign: vi.fn(),
			serializeCampaignSnapshot,
			serializeCampaignRecord: vi.fn()
		}));

		const { GET } = await import('../../../src/routes/api/campaigns/+server');
		const res = await GET(makeEvent({ url: 'http://localhost/api/campaigns?limit=0', uid: 'u1', method: 'GET' }));
		expect(res.status).toBe(200);
		expect((await res.json()).campaigns).toHaveLength(2);
	});

	it('POST creates campaign and seeds default platforms', async () => {
		vi.resetModules();
		const firestore = new FakeFirestore({ 'users/u1': {} });
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const createCampaign = vi.fn(async () => 'c_new');
		vi.doMock('$lib/server/campaigns', () => ({
			createCampaign,
			serializeCampaignSnapshot: vi.fn(),
			serializeCampaignRecord: vi.fn()
		}));

		const { POST } = await import('../../../src/routes/api/campaigns/+server');
		const res = await POST(makeEvent({ url: 'http://localhost/api/campaigns', uid: 'u1', method: 'POST', body: {} }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ campaignId: 'c_new' });

		const campaign = await adminDb.collection('users').doc('u1').collection('campaigns').doc('c_new').get();
		expect(campaign.get('platform')).toEqual(['instagram', 'tiktok']);
		const collected = await adminDb.collection('users').doc('u1').collection('campaigns').doc('c_new').collection('collected').doc('data').get();
		expect(collected.get('platform')).toEqual(['instagram', 'tiktok']);
	});

	it('POST returns 500 when createCampaign throws and rejects missing Origin', async () => {
		vi.resetModules();
		const firestore = new FakeFirestore({ 'users/u1': {} });
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const createCampaign = vi.fn(async () => {
			throw new Error('boom');
		});
		vi.doMock('$lib/server/campaigns', () => ({
			createCampaign,
			serializeCampaignSnapshot: vi.fn(),
			serializeCampaignRecord: vi.fn()
		}));

		const { POST } = await import('../../../src/routes/api/campaigns/+server');

		const res = await POST(makeEvent({ url: 'http://localhost/api/campaigns', uid: 'u1', method: 'POST', body: {} }));
		expect(res.status).toBe(500);
		expect((await res.json()).error.code).toBe('CAMPAIGN_CREATE_FAILED');

		const url = new URL('http://localhost/api/campaigns');
		const noOrigin = await POST({
			locals: { user: ({ uid: 'u1', email: 'u@test.com' } as any), requestId: 'req_test' },
			params: {},
			request: new Request(url.toString(), {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({})
			}),
			url
		} as any);
		expect(noOrigin.status).toBe(403);
	});

	it('GET /campaigns/:id returns serialized campaign when found', async () => {
		vi.resetModules();
		const firestore = new FakeFirestore({ 'users/u1/campaigns/c1': { title: 'T' } });
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const serializeCampaignRecord = vi.fn(async (data: any, id: string) => ({ id, title: data.title }));
		vi.doMock('$lib/server/campaigns', () => ({ serializeCampaignRecord }));

		const route = await import('../../../src/routes/api/campaigns/[id]/+server');
		const res = await route.GET(
			makeEvent({ url: 'http://localhost/api/campaigns/c1', uid: 'u1', method: 'GET', params: { id: 'c1' } })
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ id: 'c1', title: 'T' });
		expect(serializeCampaignRecord).toHaveBeenCalledWith({ title: 'T' }, 'c1', 'u1');
	});

	it('GET/PUT/DELETE for campaign id validates and handles missing docs', async () => {
		vi.resetModules();
		const firestore = new FakeFirestore();
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		vi.doMock('$lib/server/campaigns', () => ({
			serializeCampaignRecord: vi.fn(async () => ({ id: 'c1' }))
		}));

		const route = await import('../../../src/routes/api/campaigns/[id]/+server');
		const resMissing = await route.GET(makeEvent({ url: 'http://localhost/api/campaigns/c1', uid: 'u1', method: 'GET', params: {} }));
		expect(resMissing.status).toBe(400);

		const res404 = await route.GET(makeEvent({ url: 'http://localhost/api/campaigns/c1', uid: 'u1', method: 'GET', params: { id: 'c1' } }));
		expect(res404.status).toBe(404);

		const resPut404 = await route.PUT(makeEvent({ url: 'http://localhost/api/campaigns/c1', uid: 'u1', method: 'PUT', params: { id: 'c1' }, body: {} }));
		expect(resPut404.status).toBe(404);

		const resDel404 = await route.DELETE(makeEvent({ url: 'http://localhost/api/campaigns/c1', uid: 'u1', method: 'DELETE', params: { id: 'c1' } }));
		expect(resDel404.status).toBe(404);
	});

	it('PUT validates campaign id and rejects invalid JSON bodies', async () => {
		vi.resetModules();
		const firestore = new FakeFirestore({ 'users/u1/campaigns/c1': { title: 'Old', updatedAt: 1 } });
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		vi.doMock('$lib/server/campaigns', () => ({ serializeCampaignRecord: vi.fn(async () => ({ id: 'c1' })) }));
		const route = await import('../../../src/routes/api/campaigns/[id]/+server');

		const resMissingId = await route.PUT(makeEvent({ url: 'http://localhost/api/campaigns/c1', uid: 'u1', method: 'PUT', params: {}, body: {} }));
		expect(resMissingId.status).toBe(400);

		const resInvalidJson = await route.PUT(
			makeEvent({
				url: 'http://localhost/api/campaigns/c1',
				uid: 'u1',
				method: 'PUT',
				params: { id: 'c1' },
				rawBody: '{'
			})
		);
		expect(resInvalidJson.status).toBe(400);
		expect((await resInvalidJson.json()).error.code).toBe('INVALID_JSON');
	});

	it('PUT updates campaign and collected mapping when collected exists', async () => {
		vi.resetModules();
		const firestore = new FakeFirestore({
			'users/u1/campaigns/c1': { title: 'Old', updatedAt: 1 },
			'users/u1/campaigns/c1/collected/data': { website: 'x', updatedAt: 1 }
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const serializeCampaignRecord = vi.fn(async (data: any) => ({ title: data.title, website: data.website }));
		vi.doMock('$lib/server/campaigns', () => ({ serializeCampaignRecord }));

		const { PUT } = await import('../../../src/routes/api/campaigns/[id]/+server');
		const res = await PUT(
			makeEvent({
				url: 'http://localhost/api/campaigns/c1',
				uid: 'u1',
				method: 'PUT',
				params: { id: 'c1' },
				body: { title: 'New', website: 'https://acme.test', businessSummary: 'About', followersMin: 1, followersMax: 2 }
			})
		);
		expect(res.status).toBe(200);

		const collected = await adminDb.collection('users').doc('u1').collection('campaigns').doc('c1').collection('collected').doc('data').get();
		expect(collected.get('website')).toBe('https://acme.test');
		expect(collected.get('business_about')).toBe('About');
		expect(collected.get('min_followers')).toBe(1);
		expect(collected.get('max_followers')).toBe(2);
	});

	it('DELETE removes campaign document', async () => {
		vi.resetModules();
		const firestore = new FakeFirestore({ 'users/u1/campaigns/c1': { title: 'Old' } });
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const { DELETE } = await import('../../../src/routes/api/campaigns/[id]/+server');
		const res = await DELETE(makeEvent({ url: 'http://localhost/api/campaigns/c1', uid: 'u1', method: 'DELETE', params: { id: 'c1' } }));
		expect(res.status).toBe(200);
		const snap = await adminDb.collection('users').doc('u1').collection('campaigns').doc('c1').get();
		expect(snap.exists).toBe(false);
	});

	it('DELETE validates campaign id', async () => {
		vi.resetModules();
		const firestore = new FakeFirestore();
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const { DELETE } = await import('../../../src/routes/api/campaigns/[id]/+server');
		const res = await DELETE(makeEvent({ url: 'http://localhost/api/campaigns/c1', uid: 'u1', method: 'DELETE', params: {} }));
		expect(res.status).toBe(400);
		expect((await res.json()).error.code).toBe('CAMPAIGN_ID_REQUIRED');
	});
});
