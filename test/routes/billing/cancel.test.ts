import { describe, expect, it, vi } from 'vitest';

import { createFirebaseAdminMock, FakeFirestore } from '../../helpers/fake-firebase';

function makeEvent(options: { uid?: string; method: 'POST' | 'DELETE'; body?: unknown }) {
	const url = new URL('http://localhost/api/billing/cancel');
	return {
		locals: { user: options.uid ? ({ uid: options.uid, email: 'u@test.com' } as any) : null, requestId: 'req_test' },
		params: {},
		request: new Request(url.toString(), {
			method: options.method,
			headers: { origin: url.origin, 'content-type': 'application/json' },
			body: options.body !== undefined ? JSON.stringify(options.body) : undefined
		}),
		url
	} as any;
}

describe('routes/api/billing/cancel', () => {
	it('POST returns 400 when no active subscription', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({
			'users/u1': { currentPlan: { planKey: 'free', status: 'active', refreshDate: 0 } }
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		vi.doMock('$lib/server/billing', () => ({
			getStripeClient: vi.fn(),
			getOrCreateStripeCustomer: vi.fn()
		}));

		const { POST } = await import('../../../src/routes/api/billing/cancel/+server');
		const res = await POST(makeEvent({ uid: 'u1', method: 'POST' }));
		expect(res.status).toBe(400);
		expect((await res.json()).error.code).toBe('NO_ACTIVE_SUBSCRIPTION');
	});

	it('POST cancels locally when no Stripe subscription found', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({
			'users/u1': { currentPlan: { planKey: 'starter', status: 'active', refreshDate: 0 } }
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const stripe = { subscriptions: { list: vi.fn(async () => ({ data: [] })) } };
		vi.doMock('$lib/server/billing', () => ({
			getStripeClient: vi.fn(() => stripe),
			getOrCreateStripeCustomer: vi.fn(async () => ({ id: 'cus_1' }))
		}));

		const { POST } = await import('../../../src/routes/api/billing/cancel/+server');
		const res = await POST(makeEvent({ uid: 'u1', method: 'POST' }));
		expect(res.status).toBe(200);
		expect((await res.json()).status).toBe('canceled');

		const snap = await adminDb.collection('users').doc('u1').get();
		expect(snap.get('currentPlan.status')).toBe('canceled');
	});

	it('POST supports immediate and scheduled cancellation', async () => {
		vi.resetModules();
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-01-15T12:00:00Z'));

		const firestore = new FakeFirestore({
			'users/u1': { currentPlan: { planKey: 'starter', status: 'active', refreshDate: 0 } },
			'users/u1/subscriptions/sub_1': { status: 'active', updatedAt: 1 }
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const stripe = {
			subscriptions: {
				list: vi.fn(async () => ({ data: [{ id: 'sub_1' }] })),
				cancel: vi.fn(async () => ({ id: 'sub_1' })),
				update: vi.fn(async () => ({ id: 'sub_1', current_period_end: 1700000000 }))
			}
		};
		vi.doMock('$lib/server/billing', () => ({
			getStripeClient: vi.fn(() => stripe),
			getOrCreateStripeCustomer: vi.fn(async () => ({ id: 'cus_1' }))
		}));

		const { POST } = await import('../../../src/routes/api/billing/cancel/+server');

		const immediate = await POST(makeEvent({ uid: 'u1', method: 'POST', body: { immediate: true } }));
		expect(immediate.status).toBe(200);
		expect((await immediate.json()).status).toBe('canceled');
		expect((await adminDb.collection('users').doc('u1').get()).get('currentPlan.planKey')).toBe('free');

		// Reset state for scheduled cancellation
		await adminDb.collection('users').doc('u1').set({ currentPlan: { planKey: 'starter', status: 'active', refreshDate: 0 } });
		await adminDb.collection('users').doc('u1').collection('subscriptions').doc('sub_1').set({ status: 'active', updatedAt: 1 });

		const scheduled = await POST(makeEvent({ uid: 'u1', method: 'POST', body: {} }));
		expect(scheduled.status).toBe(200);
		const scheduledBody = await scheduled.json();
		expect(scheduledBody.status).toBe('scheduled');
		expect(scheduledBody.cancelAt).toBe(1700000000 * 1000);

		vi.useRealTimers();
	});

	it('DELETE reactivates scheduled cancellation', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({
			'users/u1': { currentPlan: { planKey: 'starter', status: 'active', refreshDate: 0, cancelAtPeriodEnd: true, cancelAt: 1 } },
			'users/u1/subscriptions/sub_1': { status: 'active', cancelAtPeriodEnd: true, cancelAt: 1, updatedAt: 1 }
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const stripe = {
			subscriptions: {
				list: vi.fn(async () => ({ data: [{ id: 'sub_1' }] })),
				update: vi.fn(async () => ({ id: 'sub_1' }))
			}
		};
		vi.doMock('$lib/server/billing', () => ({
			getStripeClient: vi.fn(() => stripe),
			getOrCreateStripeCustomer: vi.fn(async () => ({ id: 'cus_1' }))
		}));

		const route = await import('../../../src/routes/api/billing/cancel/+server');

		const ok = await route.DELETE(makeEvent({ uid: 'u1', method: 'DELETE' }));
		expect(ok.status).toBe(200);
		expect((await ok.json()).status).toBe('reactivated');
		expect((await adminDb.collection('users').doc('u1').get()).get('currentPlan.cancelAtPeriodEnd')).toBe(false);

		// Not scheduled
		await adminDb.collection('users').doc('u1').set({ currentPlan: { planKey: 'starter', status: 'active', refreshDate: 0 } });
		const notScheduled = await route.DELETE(makeEvent({ uid: 'u1', method: 'DELETE' }));
		expect(notScheduled.status).toBe(400);
	});

	it('POST and DELETE map unexpected errors to 500', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({
			'users/u1': { currentPlan: { planKey: 'starter', status: 'active', refreshDate: 0, cancelAtPeriodEnd: true } }
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		vi.doMock('$lib/server/billing', () => ({
			getStripeClient: vi.fn(() => {
				throw new Error('stripe init failed');
			}),
			getOrCreateStripeCustomer: vi.fn()
		}));

		const route = await import('../../../src/routes/api/billing/cancel/+server');
		const res = await route.POST(makeEvent({ uid: 'u1', method: 'POST', body: {} }));
		expect(res.status).toBe(500);
		expect((await res.json()).error.code).toBe('CANCEL_FAILED');

		// DELETE: no subscription found + failure while reactivating.
		vi.resetModules();
		const firestore2 = new FakeFirestore({
			'users/u1': { currentPlan: { planKey: 'starter', status: 'active', refreshDate: 0, cancelAtPeriodEnd: true } }
		});
		const { adminDb: adminDb2 } = createFirebaseAdminMock({ firestore: firestore2 });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb: adminDb2 }));

		const stripe = { subscriptions: { list: vi.fn(async () => ({ data: [] })), update: vi.fn() } };
		vi.doMock('$lib/server/billing', () => ({
			getStripeClient: vi.fn(() => stripe),
			getOrCreateStripeCustomer: vi.fn(async () => ({ id: 'cus_1' }))
		}));

		const route2 = await import('../../../src/routes/api/billing/cancel/+server');
		const notFound = await route2.DELETE(makeEvent({ uid: 'u1', method: 'DELETE' }));
		expect(notFound.status).toBe(400);
		expect((await notFound.json()).error.code).toBe('NO_SUBSCRIPTION_FOUND');

		stripe.subscriptions.list.mockResolvedValueOnce({ data: [{ id: 'sub_1' }] });
		stripe.subscriptions.update.mockRejectedValueOnce(new Error('update failed'));
		await adminDb2.collection('users').doc('u1').collection('subscriptions').doc('sub_1').set({ status: 'active', cancelAtPeriodEnd: true });

		const failed = await route2.DELETE(makeEvent({ uid: 'u1', method: 'DELETE' }));
		expect(failed.status).toBe(500);
		expect((await failed.json()).error.code).toBe('REACTIVATE_FAILED');
	});
});
