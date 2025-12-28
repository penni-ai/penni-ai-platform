import { describe, expect, it, vi } from 'vitest';

import { createFirebaseAdminMock, FakeFirestore } from '../../helpers/fake-firebase';

function makeEvent(options: { uid?: string; body?: unknown }) {
	const url = new URL('http://localhost/api/billing/set-free-plan');
	return {
		locals: { user: options.uid ? ({ uid: options.uid, email: 'u@test.com' } as any) : null, requestId: 'req_test' },
		params: {},
		request: new Request(url.toString(), {
			method: 'POST',
			headers: { origin: url.origin, 'content-type': 'application/json' },
			body: options.body !== undefined ? JSON.stringify(options.body) : undefined
		}),
		url
	} as any;
}

describe('routes/api/billing/set-free-plan POST', () => {
	it('returns already_free when user is on free plan', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({ 'users/u1': { currentPlan: { planKey: 'free', status: 'active', refreshDate: 0 } } });
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		vi.doMock('$lib/server/billing', () => ({
			getRefreshDate: vi.fn(() => 123),
			updateUserFeatureCapabilities: vi.fn(),
			getOrCreateStripeCustomer: vi.fn(),
			getStripeClient: vi.fn(() => ({ subscriptions: { list: vi.fn() } }))
		}));

		const { POST } = await import('../../../src/routes/api/billing/set-free-plan/+server');
		const res = await POST(makeEvent({ uid: 'u1' }));
		expect(res.status).toBe(200);
		expect((await res.json()).status).toBe('already_free');
	});

	it('updates locally when no Stripe subscription found (or fetch fails)', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({ 'users/u1': { currentPlan: { planKey: 'starter', status: 'active', refreshDate: 0 } } });
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const updateUserFeatureCapabilities = vi.fn(async () => {});
		const stripe = { subscriptions: { list: vi.fn(async () => { throw new Error('stripe down'); }) } };
		vi.doMock('$lib/server/billing', () => ({
			getRefreshDate: vi.fn(() => 456),
			updateUserFeatureCapabilities,
			getOrCreateStripeCustomer: vi.fn(async () => ({ id: 'cus_1' })),
			getStripeClient: vi.fn(() => stripe)
		}));

		const { POST } = await import('../../../src/routes/api/billing/set-free-plan/+server');
		const res = await POST(makeEvent({ uid: 'u1' }));
		expect(res.status).toBe(200);
		expect((await res.json()).plan).toBe('free');
		expect(updateUserFeatureCapabilities).toHaveBeenCalledWith('u1', 'free');
	});

	it('supports immediate and scheduled downgrade when Stripe subscription exists', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({
			'users/u1': { currentPlan: { planKey: 'starter', status: 'active', refreshDate: 0 } },
			'users/u1/subscriptions/sub_1': { status: 'active', updatedAt: 1, cancelAtPeriodEnd: false, cancelAt: null }
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const updateUserFeatureCapabilities = vi.fn(async () => {});
		const stripe = {
			subscriptions: {
				list: vi.fn(async () => ({ data: [{ id: 'sub_1', current_period_end: 1700000000 }] })),
				cancel: vi.fn(async () => ({ id: 'sub_1' })),
				update: vi.fn(async () => ({ id: 'sub_1' }))
			}
		};
		vi.doMock('$lib/server/billing', () => ({
			getRefreshDate: vi.fn(() => 999),
			updateUserFeatureCapabilities,
			getOrCreateStripeCustomer: vi.fn(async () => ({ id: 'cus_1' })),
			getStripeClient: vi.fn(() => stripe)
		}));

		const { POST } = await import('../../../src/routes/api/billing/set-free-plan/+server');

		const immediate = await POST(makeEvent({ uid: 'u1', body: { immediate: true } }));
		expect(immediate.status).toBe(200);
		expect((await immediate.json()).status).toBe('updated');
		expect(updateUserFeatureCapabilities).toHaveBeenCalledWith('u1', 'free');

		// Reset state for scheduled
		await adminDb.collection('users').doc('u1').set({ currentPlan: { planKey: 'starter', status: 'active', refreshDate: 0 } });
		await adminDb.collection('users').doc('u1').collection('subscriptions').doc('sub_1').set({ status: 'active', updatedAt: 1 });

		const scheduled = await POST(makeEvent({ uid: 'u1', body: {} }));
		expect(scheduled.status).toBe(200);
		const body = await scheduled.json();
		expect(body.status).toBe('scheduled');
		expect(body.cancelAt).toBe(1700000000 * 1000);
	});

	it('returns 500 when downgrade flow throws unexpectedly', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({ 'users/u1': { currentPlan: { planKey: 'starter', status: 'active', refreshDate: 0 } } });
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		vi.doMock('$lib/server/billing', () => ({
			getRefreshDate: vi.fn(() => 456),
			updateUserFeatureCapabilities: vi.fn(async () => {
				throw new Error('boom');
			}),
			getOrCreateStripeCustomer: vi.fn(async () => ({ id: 'cus_1' })),
			getStripeClient: vi.fn(() => ({ subscriptions: { list: vi.fn(async () => ({ data: [] })) } }))
		}));

		const { POST } = await import('../../../src/routes/api/billing/set-free-plan/+server');
		const res = await POST(makeEvent({ uid: 'u1' }));
		expect(res.status).toBe(500);
		expect((await res.json()).error.code).toBe('DOWNGRADE_FAILED');
	});

	it('rethrows ApiProblem instances from downstream helpers', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({ 'users/u1': { currentPlan: { planKey: 'starter', status: 'active', refreshDate: 0 } } });
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const { ApiProblem } = await import('../../../src/lib/server/core/api');

		vi.doMock('$lib/server/billing', () => ({
			getRefreshDate: vi.fn(() => 456),
			updateUserFeatureCapabilities: vi.fn(async () => {
				throw new ApiProblem({ status: 400, code: 'NOPE', message: 'bad' });
			}),
			getOrCreateStripeCustomer: vi.fn(async () => ({ id: 'cus_1' })),
			getStripeClient: vi.fn(() => ({ subscriptions: { list: vi.fn(async () => ({ data: [] })) } }))
		}));

		const { POST } = await import('../../../src/routes/api/billing/set-free-plan/+server');
		const res = await POST(makeEvent({ uid: 'u1' }));
		expect(res.status).toBe(400);
		expect((await res.json()).error.code).toBe('NOPE');
	});
});
