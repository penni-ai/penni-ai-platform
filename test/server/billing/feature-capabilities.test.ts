import { describe, expect, it, vi } from 'vitest';

import { PLAN_LIMITS } from '../../../src/lib/billing/plans';
import { createFirebaseAdminMock, FakeFirestore } from '../../helpers/fake-firebase';

describe('server/billing/feature-capabilities', () => {
	it('getUserFeatureCapabilities returns null when user doc missing and normalizes free caps', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore();
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const mod = await import('../../../src/lib/server/billing/feature-capabilities');
		expect(await mod.getUserFeatureCapabilities('u1')).toBeNull();

		await adminDb.collection('users').doc('u1').set({
			feature_capabilities: {
				outreach: true,
				search: true,
				csvExport: false,
				connectedInboxes: 0,
				influencerSearchResults: 0,
				monthlyOutreachEmails: 0,
				planKey: 'free',
				updatedAt: 1
			}
		});

		const caps = await mod.getUserFeatureCapabilities('u1');
		expect(caps?.planKey).toBe('free');
		expect(caps?.connectedInboxes).toBeGreaterThanOrEqual(PLAN_LIMITS.free.connectedInboxes);
		expect(caps?.influencerSearchResults).toBe(PLAN_LIMITS.free.influencerProfiles);
		expect(caps?.monthlyOutreachEmails).toBe(PLAN_LIMITS.free.outreachEmails);
	});

	it('falls back to building capabilities from currentPlan when missing and updates via updateUserFeatureCapabilities', async () => {
		vi.resetModules();
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-01-15T00:00:00Z'));

		const firestore = new FakeFirestore({
			'users/u1': { currentPlan: { planKey: 'starter', status: 'active', refreshDate: 0 } }
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const mod = await import('../../../src/lib/server/billing/feature-capabilities');
		const caps = await mod.getUserFeatureCapabilities('u1');
		expect(caps?.planKey).toBe('starter');

		await mod.updateUserFeatureCapabilities('u1', 'free');
		const snap = await adminDb.collection('users').doc('u1').get();
		expect(snap.get('feature_capabilities.planKey')).toBe('free');
		expect(typeof snap.get('updatedAt')).toBe('number');

		vi.useRealTimers();
	});

	it('ensureFeatureCapabilities initializes missing fields and no-ops when already present', async () => {
		vi.resetModules();
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-02-03T00:00:00Z'));

		const firestore = new FakeFirestore();
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const mod = await import('../../../src/lib/server/billing/feature-capabilities');

		await mod.ensureFeatureCapabilities('u1');
		const user1 = await adminDb.collection('users').doc('u1').get();
		expect(user1.get('currentPlan.planKey')).toBe('free');
		expect(user1.get('feature_capabilities.planKey')).toBe('free');
		expect(user1.get('usage.outreachSent.count')).toBe(0);

		// Missing only capabilities + usage.
		await adminDb.collection('users').doc('u2').set({ currentPlan: { planKey: 'starter', status: 'active', refreshDate: 0 } });
		await mod.ensureFeatureCapabilities('u2');
		const user2 = await adminDb.collection('users').doc('u2').get();
		expect(user2.get('currentPlan.planKey')).toBe('starter');
		expect(user2.get('feature_capabilities.planKey')).toBe('starter');
		expect(user2.get('usage.influencersFound.count')).toBe(0);

		// No-op when everything exists.
		const before = user2.data();
		await mod.ensureFeatureCapabilities('u2');
		const after = (await adminDb.collection('users').doc('u2').get()).data();
		expect(after).toEqual(before);

		vi.useRealTimers();
	});

	it('checks feature booleans/numerics and exposes limits', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({
			'users/u1': {
				feature_capabilities: {
					outreach: true,
					search: true,
					csvExport: false,
					connectedInboxes: 1,
					influencerSearchResults: 10,
					monthlyOutreachEmails: 20,
					planKey: 'starter',
					updatedAt: 1
				}
			}
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const mod = await import('../../../src/lib/server/billing/feature-capabilities');
		expect(await mod.hasFeatureCapability('u1', 'csvExport')).toBe(false);
		expect(await mod.hasFeatureCapability('u1', 'connectedInboxes')).toBe(true);
		expect(await mod.canUseOutreach('u1')).toBe(true);
		expect(await mod.canExportCSV('u1')).toBe(false);

		expect(await mod.hasFeatureCapability('missing', 'outreach')).toBe(false);

		const limits = await mod.getFeatureLimits('u1');
		expect(limits).toEqual({ influencerSearchResults: 10, monthlyOutreachEmails: 20, connectedInboxes: 1 });

		const freeLimits = await mod.getFeatureLimits('missing');
		expect(freeLimits).toEqual({
			influencerSearchResults: PLAN_LIMITS.free.influencerProfiles,
			monthlyOutreachEmails: PLAN_LIMITS.free.outreachEmails,
			connectedInboxes: PLAN_LIMITS.free.connectedInboxes
		});
	});
});

