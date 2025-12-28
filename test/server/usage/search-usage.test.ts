import { describe, expect, it, vi } from 'vitest';

import { createFirebaseAdminMock, FakeFirestore } from '../../helpers/fake-firebase';

describe('server/usage/search-usage', () => {
	it('getSubscriptionSearchLimit maps plan keys', async () => {
		vi.resetModules();
		const mod = await import('../../../src/lib/server/usage/search-usage');
		expect(mod.getSubscriptionSearchLimit('starter')).toBeGreaterThan(0);
		expect(mod.getSubscriptionSearchLimit('growth')).toBeGreaterThan(0);
		expect(mod.getSubscriptionSearchLimit(null)).toBeGreaterThanOrEqual(0);
		expect(mod.getSubscriptionSearchLimit('event' as any)).toBe(mod.getSubscriptionSearchLimit(null));
	});

	it('computes usage + remaining from subscription and event credits', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-01-15T00:00:00Z'));
		vi.resetModules();

		const uid = 'u1';
		const firestore = new FakeFirestore({
			[`users/${uid}`]: {
				currentPlan: { planKey: 'starter' },
				usage: {
					influencersFound: { month: '2025-01', count: 5, updatedAt: 0 },
					outreachSent: { month: '2025-01', count: 1, updatedAt: 0 }
				},
				eventCredits: { influencersRemaining: 2, outreachRemaining: 0, additionalInboxes: 0, purchasedAt: 0, paymentIntentId: 'pi' }
			}
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const mod = await import('../../../src/lib/server/usage/search-usage');
		const usage = await mod.getSearchUsage(uid);

		expect(usage.count).toBe(5);
		expect(usage.eventCreditsRemaining).toBe(2);
		expect(usage.totalRemaining).toBeGreaterThanOrEqual(2);
		expect(usage.hasEventCredits).toBe(true);

		vi.useRealTimers();
	});

	it('resets usage when month changes and reports no event credits', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-02-01T00:00:00'));
		vi.resetModules();

		const uid = 'u_reset';
		const firestore = new FakeFirestore({
			[`users/${uid}`]: {
				currentPlan: { planKey: 'growth' },
				usage: {
					influencersFound: { month: '2025-01', count: 99, updatedAt: 0 }
				}
			}
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const mod = await import('../../../src/lib/server/usage/search-usage');
		const usage = await mod.getSearchUsage(uid);
		expect(usage.count).toBe(0);
		expect(usage.hasEventCredits).toBe(false);

		vi.useRealTimers();
	});

	it('incrementSearchUsage consumes subscription first then event credits', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-01-15T00:00:00Z'));
		vi.resetModules();

		const uid = 'u2';
		const firestore = new FakeFirestore({
			[`users/${uid}`]: {
				currentPlan: { planKey: 'free' },
				usage: {
					influencersFound: { month: '2025-01', count: 9, updatedAt: 0 },
					outreachSent: { month: '2025-01', count: 0, updatedAt: 0 }
				},
				eventCredits: { influencersRemaining: 5, outreachRemaining: 0, additionalInboxes: 0, purchasedAt: 0, paymentIntentId: 'pi' }
			}
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const mod = await import('../../../src/lib/server/usage/search-usage');
		const result = await mod.incrementSearchUsage(uid, 3);
		expect(result.success).toBe(true);
		expect(result.usedFromSubscription).toBe(1);
		expect(result.usedFromEventCredits).toBe(2);

		const snap = await adminDb.collection('users').doc(uid).get();
		expect(snap.get('usage.influencersFound.count')).toBe(10);
		expect(snap.get('eventCredits.influencersRemaining')).toBe(3);

		vi.useRealTimers();
	});

	it('incrementSearchUsage fails when requested amount exceeds total available', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-01-15T00:00:00Z'));
		vi.resetModules();

		const uid = 'u_fail';
		const firestore = new FakeFirestore({
			[`users/${uid}`]: {
				currentPlan: { planKey: 'free' },
				usage: { influencersFound: { month: '2025-01', count: 0, updatedAt: 0 } },
				eventCredits: { influencersRemaining: 0, outreachRemaining: 0, additionalInboxes: 0, purchasedAt: 0, paymentIntentId: 'pi' }
			}
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const mod = await import('../../../src/lib/server/usage/search-usage');
		const res = await mod.incrementSearchUsage(uid, 1_000_000);
		expect(res.success).toBe(false);

		vi.useRealTimers();
	});

	it('incrementSearchUsage initializes usage on new users and preserves outreachSent', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-01-15T00:00:00Z'));
		vi.resetModules();

		const uid = 'u_new';
		const firestore = new FakeFirestore({
			[`users/${uid}`]: {
				currentPlan: { planKey: 'starter' },
				usage: { influencersFound: { month: '2025-01', count: 0, updatedAt: 0 } }
			}
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const mod = await import('../../../src/lib/server/usage/search-usage');
		const res = await mod.incrementSearchUsage(uid, 1);
		expect(res.success).toBe(true);

		const userSnap = await adminDb.collection('users').doc(uid).get();
		expect(userSnap.get('usage.outreachSent.month')).toBe('2025-01');
		expect(userSnap.get('usage.influencersFound.count')).toBe(1);

		// Also covers userDoc.exists === false branch.
		const uidMissing = 'u_missing';
		const resMissing = await mod.incrementSearchUsage(uidMissing, 1);
		expect(resMissing.success).toBe(true);
		const created = await adminDb.collection('users').doc(uidMissing).get();
		expect(created.exists).toBe(true);

		vi.useRealTimers();
	});

	it('incrementSearchUsage resets subscription usage when month differs', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-01-15T00:00:00Z'));
		vi.resetModules();

		const uid = 'u_month_reset';
		const firestore = new FakeFirestore({
			[`users/${uid}`]: {
				currentPlan: { planKey: 'starter' },
				usage: {
					influencersFound: { month: '2024-12', count: 99, updatedAt: 0 },
					outreachSent: { month: '2025-01', count: 1, updatedAt: 0 }
				}
			}
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const mod = await import('../../../src/lib/server/usage/search-usage');
		const res = await mod.incrementSearchUsage(uid, 1);
		expect(res.success).toBe(true);

		const userSnap = await adminDb.collection('users').doc(uid).get();
		expect(userSnap.get('usage.influencersFound.month')).toBe('2025-01');
		expect(userSnap.get('usage.influencersFound.count')).toBe(1);

		vi.useRealTimers();
	});
});
