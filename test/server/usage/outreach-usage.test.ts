import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFirebaseAdminMock, FakeFirestore } from '../../helpers/fake-firebase';

describe('server/usage/outreach-usage', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('getOutreachUsage resets month when usage is stale and includes event credits', async () => {
		vi.resetModules();
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-06-15T12:00:00Z'));

		const firestore = new FakeFirestore({
			'users/u1': {
				currentPlan: { planKey: 'starter' },
				usage: { outreachSent: { month: '2025-05', count: 99 }, influencersFound: { month: '2025-06', count: 0 } },
				eventCredits: { outreachRemaining: 3 }
			}
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const { getOutreachUsage } = await import('../../../src/lib/server/usage/outreach-usage');
		const usage = await getOutreachUsage('u1');
		expect(usage.count).toBe(0);
		expect(usage.eventCreditsRemaining).toBe(3);
		expect(usage.totalRemaining).toBe(usage.subscriptionRemaining + 3);
	});

	it('incrementOutreachUsage consumes subscription first then event credits', async () => {
		vi.resetModules();
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-06-15T12:00:00Z'));

		const firestore = new FakeFirestore({
			'users/u1': {
				currentPlan: { planKey: 'free' },
				usage: { outreachSent: { month: '2025-06', count: 9 }, influencersFound: { month: '2025-06', count: 0 } },
				eventCredits: { outreachRemaining: 2 }
			}
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const { incrementOutreachUsage } = await import('../../../src/lib/server/usage/outreach-usage');
		const res = await incrementOutreachUsage('u1', 2);
		expect(res.success).toBe(true);
		expect(res.usedFromSubscription).toBe(1);
		expect(res.usedFromEventCredits).toBe(1);

		const snap = await adminDb.collection('users').doc('u1').get();
		expect(snap.get('usage.outreachSent.count')).toBe(10);
		expect(snap.get('eventCredits.outreachRemaining')).toBe(1);
	});

	it('incrementOutreachUsage returns success=false when credits are insufficient', async () => {
		vi.resetModules();
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-06-15T12:00:00Z'));

		const firestore = new FakeFirestore({
			'users/u1': {
				currentPlan: { planKey: 'free' },
				usage: { outreachSent: { month: '2025-06', count: 10 }, influencersFound: { month: '2025-06', count: 0 } },
				eventCredits: { outreachRemaining: 0 }
			}
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const { incrementOutreachUsage } = await import('../../../src/lib/server/usage/outreach-usage');
		const res = await incrementOutreachUsage('u1', 1);
		expect(res.success).toBe(false);
		expect(res.usedFromSubscription).toBe(0);
		expect(res.usedFromEventCredits).toBe(0);
	});

	it('incrementOutreachUsage initializes usage when user doc missing', async () => {
		vi.resetModules();
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-06-15T12:00:00Z'));

		const firestore = new FakeFirestore();
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const { incrementOutreachUsage } = await import('../../../src/lib/server/usage/outreach-usage');
		const res = await incrementOutreachUsage('u_new', 1);
		expect(res.success).toBe(true);

		const snap = await adminDb.collection('users').doc('u_new').get();
		expect(snap.get('usage.outreachSent.month')).toBe('2025-06');
		expect(snap.get('usage.outreachSent.count')).toBe(1);
	});

	it('incrementOutreachUsage initializes influencersFound and resets outreachSent when month differs', async () => {
		vi.resetModules();
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-06-15T12:00:00Z'));

		const firestore = new FakeFirestore({
			'users/u1': {
				currentPlan: { planKey: 'starter' },
				usage: { outreachSent: { month: '2025-05', count: 1, updatedAt: 0 } },
				eventCredits: { outreachRemaining: 0 }
			}
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const { incrementOutreachUsage } = await import('../../../src/lib/server/usage/outreach-usage');
		const res = await incrementOutreachUsage('u1', 1);
		expect(res.success).toBe(true);

		const snap = await adminDb.collection('users').doc('u1').get();
		expect(snap.get('usage.influencersFound.month')).toBe('2025-06');
		expect(snap.get('usage.outreachSent.month')).toBe('2025-06');
	});
});
