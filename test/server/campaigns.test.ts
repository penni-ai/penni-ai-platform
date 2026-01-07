import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFirebaseAdminMock, FakeFirestore } from '../helpers/fake-firebase';

describe('server/campaigns', () => {
	afterEach(() => {
		vi.doUnmock('../../src/lib/server/core');
		vi.doUnmock('crypto');
	});

	it('serializeCampaignRecord prefers collected data when available', async () => {
		vi.resetModules();

		const uid = 'u1';
		const campaignId = 'c1';
		const firestore = new FakeFirestore({
			[`users/${uid}/campaigns/${campaignId}/collected/data`]: {
				website: 'https://example.com',
				business_name: 'Acme',
				business_about: 'About us',
				influencer_location: 'NYC',
				platform: 'instagram',
				type_of_influencer: 'food',
				min_followers: 10,
				max_followers: 20,
				fieldStatus: { website: 'confirmed' },
				updatedAt: Date.now()
			}
		});

		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const { serializeCampaignRecord } = await import('../../src/lib/server/campaigns');

		const serialized = await serializeCampaignRecord(
			{
				title: 'Campaign',
				website: 'should be overridden',
				platform: 'tiktok'
			},
			campaignId,
			uid
		);

		expect(serialized.id).toBe(campaignId);
		expect(serialized.website).toBe('https://example.com');
		expect(serialized.platform).toBe('instagram');
		expect(serialized.business_name).toBe('Acme');
		expect(serialized.fieldStatus?.website).toBe('confirmed');
	});

	it('serializeCampaignRecord handles timestamp coercion fallbacks', async () => {
		vi.resetModules();

		const { serializeCampaignRecord } = await import('../../src/lib/server/campaigns');

		const out1 = await serializeCampaignRecord(
			{
				createdAt: { toMillis: () => 123 },
				updatedAt: { toMillis: () => 'nope' as any },
				updatedAtMs: 456
			},
			'c1'
		);
		expect(out1.createdAt).toBe(123);
		expect(out1.updatedAt).toBe(456);

		const out2 = await serializeCampaignRecord(
			{
				createdAt: { toMillis: () => { throw new Error('boom'); } },
				createdAtMs: 999,
				updatedAt: 321
			},
			'c2'
		);
		expect(out2.createdAt).toBe(999);
		expect(out2.updatedAt).toBe(321);
	});

	it('serializeCampaignRecord tolerates collected doc read failures', async () => {
		vi.resetModules();

		vi.doMock('../../src/lib/server/core', () => ({
			campaignDocRef: vi.fn(() => ({ set: vi.fn(async () => {}) })),
			campaignCollectedDocRef: vi.fn(() => ({
				get: vi.fn(async () => {
					throw new Error('read failed');
				})
			}))
		}));

		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const { serializeCampaignRecord } = await import('../../src/lib/server/campaigns');
		const serialized = await serializeCampaignRecord(
			{
				title: 'Campaign',
				search: { status: 123, lastError: 55, completedAt: 77, results: { ok: true } }
			},
			'c1',
			'u1'
		);

		expect(serialized.title).toBe('Campaign');
		expect(serialized.search?.status).toBe('idle');
		expect(serialized.search?.lastError).toBeNull();
		expect(serialized.search?.completedAt).toBeNull();
		expect(serialized.search?.results).toEqual({ ok: true });
		expect(warn).toHaveBeenCalled();
	});

	it('serializeCampaignSnapshot delegates to record serializer', async () => {
		vi.resetModules();
		const { serializeCampaignSnapshot } = await import('../../src/lib/server/campaigns');

		const out = await serializeCampaignSnapshot({ id: 'c1', data: () => ({ title: 'T' }) } as any);
		expect(out.id).toBe('c1');
		expect(out.title).toBe('T');
	});

	it('createCampaign writes campaign + collected docs', async () => {
		vi.resetModules();
		vi.doMock('crypto', () => ({ randomUUID: () => 'new_campaign' }));

		const firestore = new FakeFirestore();
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const { createCampaign } = await import('../../src/lib/server/campaigns');

		const logger = { info: vi.fn() } as any;
		const id = await createCampaign('u2', logger);

		expect(id).toBe('new_campaign');
		expect(logger.info).toHaveBeenCalled();

		const campaignSnap = await adminDb.collection('users').doc('u2').collection('campaigns').doc(id).get();
		expect(campaignSnap.exists).toBe(true);
		expect(campaignSnap.get('status')).toBe('collecting');

		const collectedSnap = await adminDb
			.collection('users')
			.doc('u2')
			.collection('campaigns')
			.doc(id)
			.collection('collected')
			.doc('data')
			.get();
		expect(collectedSnap.exists).toBe(true);
		expect(collectedSnap.get('website')).toBeNull();
	});
});
