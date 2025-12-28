import { describe, expect, it, vi } from 'vitest';

import { createFirebaseAdminMock, FakeFirestore } from '../../helpers/fake-firebase';

describe('server/outreach/clear-selections', () => {
	it('clearSelectionsForContacted is a no-op when state is missing', async () => {
		vi.resetModules();
		const firestore = new FakeFirestore();
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const { clearSelectionsForContacted } = await import('../../../src/lib/server/outreach/clear-selections');
		await clearSelectionsForContacted('u1', 'c1', [], []);
		const stateDoc = await adminDb
			.collection('users')
			.doc('u1')
			.collection('campaigns')
			.doc('c1')
			.collection('outreach_state')
			.doc('current')
			.get();
		expect(stateDoc.exists).toBe(false);
	});

	it('clearSelectionsForContacted removes contacted influencers and methods', async () => {
		vi.resetModules();
		const firestore = new FakeFirestore({
			'users/u1/campaigns/c1/outreach_state/current': {
				selectedInfluencerIds: ['i1', 'i2'],
				selectedMethods: { i1: ['instagram', 'email'], i2: ['tiktok'] }
			},
			'users/u1/campaigns/c1/outreach_contacts/a': {
				influencerId: 'i1',
				sendStatus: 'pending',
				platform: 'instagram',
				contactMethods: ['email']
			},
			'users/u1/campaigns/c1/outreach_contacts/b': {
				influencerId: 'i2',
				sendStatus: 'failed',
				platform: 'tiktok'
			}
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const { clearSelectionsForContacted } = await import('../../../src/lib/server/outreach/clear-selections');
		await clearSelectionsForContacted('u1', 'c1', ['i1', 'i2'], ['instagram', 'email']);

		const stateDoc = await adminDb
			.collection('users')
			.doc('u1')
			.collection('campaigns')
			.doc('c1')
			.collection('outreach_state')
			.doc('current')
			.get();
		expect(stateDoc.get('selectedInfluencerIds')).toEqual(['i2']);
		expect(stateDoc.get('selectedMethods')).toEqual({ i2: ['tiktok'] });
	});

	it('clearSelectionsAfterSend removes influencer ids and specified methods', async () => {
		vi.resetModules();
		const firestore = new FakeFirestore({
			'users/u1/campaigns/c1/outreach_state/current': {
				selectedInfluencerIds: ['i1', 'i2'],
				selectedMethods: { i1: ['instagram', 'email'], i2: ['tiktok', 'email'] }
			}
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const { clearSelectionsAfterSend } = await import('../../../src/lib/server/outreach/clear-selections');
		await clearSelectionsAfterSend('u1', 'c1', ['i1'], { i2: ['email'] });

		const stateDoc = await adminDb
			.collection('users')
			.doc('u1')
			.collection('campaigns')
			.doc('c1')
			.collection('outreach_state')
			.doc('current')
			.get();
		expect(stateDoc.get('selectedInfluencerIds')).toEqual(['i2']);
		expect(stateDoc.get('selectedMethods')).toEqual({ i2: ['tiktok'] });
	});

	it('clearSelectionsForContacted updates when only selectedMethods change', async () => {
		vi.resetModules();
		const firestore = new FakeFirestore({
			'users/u1/campaigns/c1/outreach_state/current': {
				selectedInfluencerIds: [],
				selectedMethods: { i1: ['email'] }
			},
			'users/u1/campaigns/c1/outreach_contacts/a': {
				influencerId: 'i1',
				sendStatus: 'sent',
				platform: 'email'
			}
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const { clearSelectionsForContacted } = await import('../../../src/lib/server/outreach/clear-selections');
		await clearSelectionsForContacted('u1', 'c1', [], []);

		const stateDoc = await adminDb
			.collection('users')
			.doc('u1')
			.collection('campaigns')
			.doc('c1')
			.collection('outreach_state')
			.doc('current')
			.get();
		expect(stateDoc.get('selectedInfluencerIds')).toEqual([]);
		expect(stateDoc.get('selectedMethods')).toEqual({});
	});

	it('clearSelectionsAfterSend is a no-op when state is missing', async () => {
		vi.resetModules();
		const firestore = new FakeFirestore();
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const { clearSelectionsAfterSend } = await import('../../../src/lib/server/outreach/clear-selections');
		await clearSelectionsAfterSend('u1', 'c1', ['i1'], { i1: ['email'] });

		const stateDoc = await adminDb
			.collection('users')
			.doc('u1')
			.collection('campaigns')
			.doc('c1')
			.collection('outreach_state')
			.doc('current')
			.get();
		expect(stateDoc.exists).toBe(false);
	});
});
