import { describe, expect, it, vi } from 'vitest';

import { createFirebaseAdminMock, FakeFirestore } from '../../helpers/fake-firebase';

function makeEvent(options: { uid?: string; body?: unknown; rawBody?: string }) {
	const url = new URL('http://localhost/api/billing/upgrade');
	return {
		locals: { user: options.uid ? ({ uid: options.uid, email: 'u@test.com' } as any) : null, requestId: 'req_test' },
		params: {},
		request: new Request(url.toString(), {
			method: 'POST',
			headers: { origin: url.origin, 'content-type': 'application/json' },
			body: options.rawBody ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined)
		}),
		url
	} as any;
}

describe('routes/api/billing/upgrade POST', () => {
	it('validates JSON and plan', async () => {
		vi.resetModules();
		vi.doMock('$lib/server/billing', () => ({
			getPlanConfig: vi.fn(() => null),
			getStripeClient: vi.fn()
		}));

		const { POST } = await import('../../../src/routes/api/billing/upgrade/+server');
		const invalid = await POST(makeEvent({ uid: 'u1', rawBody: '{' }));
		expect(invalid.status).toBe(400);

		const invalidPlan = await POST(makeEvent({ uid: 'u1', body: { plan: 'nope' } }));
		expect(invalidPlan.status).toBe(400);
		expect((await invalidPlan.json()).error.code).toBe('INVALID_PLAN');
	});

	it('returns 400 when there is no active subscription and when subscription has no items', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({
			'users/u1': { currentPlan: { planKey: 'starter', status: 'active', refreshDate: 0 } }
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const stripe = {
			subscriptions: { retrieve: vi.fn(async () => ({ id: 'sub_1', customer: 'cus_1', items: { data: [] } })) },
			invoices: {}
		};

		vi.doMock('$lib/server/billing', () => ({
			getPlanConfig: vi.fn((plan: string | null) => (plan === 'growth' ? { plan: 'growth', mode: 'subscription', priceId: 'price_g' } : null)),
			getStripeClient: vi.fn(() => stripe)
		}));

		const { POST } = await import('../../../src/routes/api/billing/upgrade/+server');

		const noSub = await POST(makeEvent({ uid: 'u1', body: { plan: 'growth', confirm: true } }));
		expect(noSub.status).toBe(400);
		expect((await noSub.json()).error.code).toBe('NO_ACTIVE_SUBSCRIPTION');

		// Now add subscription doc, but return empty items.
		await adminDb.collection('users').doc('u1').collection('subscriptions').doc('sub_doc').set({ stripeSubscriptionId: 'sub_1', updatedAt: 1 });
		const missingItem = await POST(makeEvent({ uid: 'u1', body: { plan: 'growth', confirm: true } }));
		expect(missingItem.status).toBe(400);
		expect((await missingItem.json()).error.code).toBe('MISSING_SUBSCRIPTION_ITEM');
	});

	it('returns previewUnavailable when retrieveUpcoming is missing', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({
			'users/u1': { currentPlan: { planKey: 'starter', status: 'active', refreshDate: 0 } },
			'users/u1/subscriptions/sub_doc': { stripeSubscriptionId: 'sub_1', updatedAt: 1 }
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const stripe = {
			subscriptions: { retrieve: vi.fn(async () => ({ id: 'sub_1', customer: 'cus_1', items: { data: [{ id: 'item_1', quantity: 1 }] } })) },
			invoices: {}
		};
		vi.doMock('$lib/server/billing', () => ({
			getPlanConfig: vi.fn((plan: string | null) => (plan === 'growth' ? { plan: 'growth', mode: 'subscription', priceId: 'price_g' } : null)),
			getStripeClient: vi.fn(() => stripe)
		}));

		const { POST } = await import('../../../src/routes/api/billing/upgrade/+server');
		const res = await POST(makeEvent({ uid: 'u1', body: { plan: 'growth' } }));
		expect(res.status).toBe(200);
		expect((await res.json()).previewUnavailable).toBe(true);
	});

	it('sets changeType=upgrade when user has no current plan', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({
			'users/u1': {},
			'users/u1/subscriptions/sub_doc': { stripeSubscriptionId: 'sub_1', updatedAt: 1 }
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const stripe = {
			subscriptions: { retrieve: vi.fn(async () => ({ id: 'sub_1', customer: 'cus_1', items: { data: [{ id: 'item_1', quantity: 1 }] } })) },
			invoices: {}
		};
		vi.doMock('$lib/server/billing', () => ({
			getPlanConfig: vi.fn((plan: string | null) => (plan === 'starter' ? { plan: 'starter', mode: 'subscription', priceId: 'price_s' } : null)),
			getStripeClient: vi.fn(() => stripe)
		}));

		const { POST } = await import('../../../src/routes/api/billing/upgrade/+server');
		const res = await POST(makeEvent({ uid: 'u1', body: { plan: 'starter' } }));
		expect(res.status).toBe(200);
		expect((await res.json()).changeType).toBe('upgrade');
	});

	it('sets changeType=switch when requesting the current plan', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({
			'users/u1': { currentPlan: { planKey: 'starter', status: 'active', refreshDate: 0 } },
			'users/u1/subscriptions/sub_doc': { stripeSubscriptionId: 'sub_1', updatedAt: 1 }
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const stripe = {
			subscriptions: { retrieve: vi.fn(async () => ({ id: 'sub_1', customer: 'cus_1', items: { data: [{ id: 'item_1', quantity: 1 }] } })) },
			invoices: {}
		};
		vi.doMock('$lib/server/billing', () => ({
			getPlanConfig: vi.fn((plan: string | null) => (plan === 'starter' ? { plan: 'starter', mode: 'subscription', priceId: 'price_s' } : null)),
			getStripeClient: vi.fn(() => stripe)
		}));

		const { POST } = await import('../../../src/routes/api/billing/upgrade/+server');
		const res = await POST(makeEvent({ uid: 'u1', body: { plan: 'starter' } }));
		expect(res.status).toBe(200);
		expect((await res.json()).changeType).toBe('switch');
	});

	it('confirms upgrades immediately and returns invoice summary', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({
			'users/u1': { currentPlan: { planKey: 'starter', status: 'active', refreshDate: 0 } },
			'users/u1/subscriptions/sub_doc': { stripeSubscriptionId: 'sub_1', updatedAt: 1 }
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const stripe = {
			subscriptions: {
				retrieve: vi.fn(async () => ({
					id: 'sub_1',
					customer: 'cus_1',
					items: { data: [{ id: 'item_1', quantity: 1, price: { id: 'price_old' } }] }
				})),
				update: vi.fn(async () => ({ id: 'sub_1', latest_invoice: 'in_1' }))
			},
			invoices: {
				retrieve: vi.fn(async () => ({
					amount_due: 100,
					amount_remaining: null,
					currency: 'usd',
					total: 100,
					subtotal: 100,
					invoice_pdf: null,
					lines: { data: [{ description: 'Charge', amount: 100, proration: false }] }
				}))
			}
		};

		vi.doMock('$lib/server/billing', () => ({
			getPlanConfig: vi.fn((plan: string | null) => (plan === 'growth' ? { plan: 'growth', mode: 'subscription', priceId: 'price_g' } : null)),
			getStripeClient: vi.fn(() => stripe)
		}));

		const { POST } = await import('../../../src/routes/api/billing/upgrade/+server');
		const res = await POST(makeEvent({ uid: 'u1', body: { plan: 'growth', confirm: true, idempotencyKey: 'idem' } }));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.status).toBe('updated');
		expect(body.invoice.amount_due).toBe(100);

		expect(stripe.subscriptions.update).toHaveBeenCalledWith(
			'sub_1',
			expect.objectContaining({ proration_behavior: 'create_prorations' }),
			expect.objectContaining({ idempotencyKey: 'idem' })
		);
	});

	it('supports immediate downgrades via confirm+immediate', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({
			'users/u1': { currentPlan: { planKey: 'growth', status: 'active', refreshDate: 0 } },
			'users/u1/subscriptions/sub_doc': { stripeSubscriptionId: 'sub_1', updatedAt: 1 }
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const stripe = {
			subscriptions: {
				retrieve: vi.fn(async () => ({
					id: 'sub_1',
					customer: 'cus_1',
					items: { data: [{ id: 'item_1', quantity: 2, price: { id: 'price_old' } }] }
				})),
				update: vi.fn(async () => ({ id: 'sub_1', latest_invoice: null }))
			},
			invoices: { retrieveUpcoming: vi.fn() }
		};

		vi.doMock('$lib/server/billing', () => ({
			getPlanConfig: vi.fn((plan: string | null) => {
				if (plan === 'starter') return { plan: 'starter', mode: 'subscription', priceId: 'price_s' };
				if (plan === 'growth') return { plan: 'growth', mode: 'subscription', priceId: 'price_g' };
				return null;
			}),
			getStripeClient: vi.fn(() => stripe)
		}));

		const { POST } = await import('../../../src/routes/api/billing/upgrade/+server');
		const res = await POST(makeEvent({ uid: 'u1', body: { plan: 'starter', confirm: true, immediate: true } }));
		expect(res.status).toBe(200);
		expect((await res.json()).status).toBe('updated');

		expect(stripe.subscriptions.update).toHaveBeenCalledWith(
			'sub_1',
			expect.objectContaining({ proration_behavior: 'none', billing_cycle_anchor: 'unchanged' }),
			expect.any(Object)
		);
	});

	it('generates preview when retrieveUpcoming exists and can schedule downgrades', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({
			'users/u1': { currentPlan: { planKey: 'growth', status: 'active', refreshDate: 0 } },
			'users/u1/subscriptions/sub_doc': { stripeSubscriptionId: 'sub_1', updatedAt: 1 },
			'users/u1/subscriptions/sub_1': { status: 'active', updatedAt: 1 }
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const retrieveUpcoming = vi.fn(async () => ({
			amount_due: 100,
			currency: 'usd',
			total: 100,
			subtotal: 100,
			invoice_pdf: null,
			lines: { data: [{ description: 'Proration', amount: 100, proration: true }] }
		}));

		const stripe = {
			subscriptions: {
				retrieve: vi.fn(async () => ({
					id: 'sub_1',
					customer: 'cus_1',
					current_period_end: 1700000000,
					items: { data: [{ id: 'item_1', quantity: 2 }] }
				})),
				update: vi.fn(async () => ({ id: 'sub_1', latest_invoice: null }))
			},
			invoices: { retrieveUpcoming }
		};

		vi.doMock('$lib/server/billing', () => ({
			getPlanConfig: vi.fn((plan: string | null) => {
				if (plan === 'starter') return { plan: 'starter', mode: 'subscription', priceId: 'price_s' };
				if (plan === 'growth') return { plan: 'growth', mode: 'subscription', priceId: 'price_g' };
				return null;
			}),
			getStripeClient: vi.fn(() => stripe)
		}));

		const { POST } = await import('../../../src/routes/api/billing/upgrade/+server');

		const preview = await POST(makeEvent({ uid: 'u1', body: { plan: 'starter' } }));
		expect(preview.status).toBe(200);
		expect((await preview.json()).status).toBe('preview');
		expect(retrieveUpcoming).toHaveBeenCalled();

		const scheduled = await POST(makeEvent({ uid: 'u1', body: { plan: 'starter', confirm: true } }));
		expect(scheduled.status).toBe(200);
		const scheduledBody = await scheduled.json();
		expect(scheduledBody.status).toBe('scheduled');
		expect((await adminDb.collection('users').doc('u1').get()).get('currentPlan.scheduledPlanChange')).toBe('starter');
	});
});
