import { describe, expect, it, vi } from 'vitest';

import { createFirebaseAdminMock, FakeFirestore } from '../../helpers/fake-firebase';

function makeEvent(options: { uid?: string; body?: unknown; rawBody?: string }) {
	const url = new URL('http://localhost/api/billing/checkout');
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

describe('routes/api/billing/checkout POST', () => {
	it('validates JSON and plan', async () => {
		vi.resetModules();
		vi.doMock('$lib/server/billing', () => ({
			getPlanConfig: vi.fn(() => null),
			getOrCreateStripeCustomer: vi.fn(),
			getStripeClient: vi.fn()
		}));

		const { POST } = await import('../../../src/routes/api/billing/checkout/+server');

		const invalidJson = await POST(makeEvent({ uid: 'u1', rawBody: '{' }));
		expect(invalidJson.status).toBe(400);
		expect((await invalidJson.json()).error.code).toBe('INVALID_JSON');

		const missingPlan = await POST(makeEvent({ uid: 'u1', body: { plan: 'nope' } }));
		expect(missingPlan.status).toBe(400);
		expect((await missingPlan.json()).error.code).toBe('PLAN_NOT_FOUND');
	});

	it('creates checkout session and stores session record', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore();
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const sessionsCreate = vi.fn(async () => ({ id: 'cs_1', url: 'https://stripe.test/checkout' }));
		const stripe = { checkout: { sessions: { create: sessionsCreate } }, subscriptions: { retrieve: vi.fn(), update: vi.fn() }, invoices: {} };
		vi.doMock('$lib/server/billing', () => ({
			getPlanConfig: vi.fn((plan: string | null) => (plan === 'starter' ? { plan: 'starter', mode: 'subscription', priceId: 'price_s' } : null)),
			getOrCreateStripeCustomer: vi.fn(async () => ({ id: 'cus_1' })),
			getStripeClient: vi.fn(() => stripe)
		}));

		const { POST } = await import('../../../src/routes/api/billing/checkout/+server');
		const res = await POST(makeEvent({ uid: 'u1', body: { plan: 'starter', returnUrl: '/my-account/billing' } }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ url: 'https://stripe.test/checkout' });

		expect(sessionsCreate).toHaveBeenCalled();
		const sessionDoc = await adminDb.collection('checkoutSessions').doc('cs_1').get();
		expect(sessionDoc.exists).toBe(true);
		expect(sessionDoc.get('firebaseUid')).toBe('u1');
	});

	it('returns 502 when Stripe does not return a session URL', async () => {
		vi.resetModules();
		const firestore = new FakeFirestore();
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const stripe = { checkout: { sessions: { create: vi.fn(async () => ({ id: 'cs_1', url: null })) } }, invoices: {}, subscriptions: {} };
		vi.doMock('$lib/server/billing', () => ({
			getPlanConfig: vi.fn(() => ({ plan: 'starter', mode: 'subscription', priceId: 'price_s' })),
			getOrCreateStripeCustomer: vi.fn(async () => ({ id: 'cus_1' })),
			getStripeClient: vi.fn(() => stripe)
		}));

		const { POST } = await import('../../../src/routes/api/billing/checkout/+server');
		const res = await POST(makeEvent({ uid: 'u1', body: { plan: 'starter' } }));
		expect(res.status).toBe(502);
		expect((await res.json()).error.code).toBe('STRIPE_SESSION_URL_MISSING');
	});

	it('upgrades an existing subscription without checkout when possible', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({
			'users/u1': { currentPlan: { planKey: 'starter' } },
			'users/u1/subscriptions/snap': { stripeSubscriptionId: 'sub_1', updatedAt: 10 }
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const retrieve = vi.fn(async () => ({
			id: 'sub_1',
			customer: 'cus_1',
			items: { data: [{ id: 'item_1', quantity: 1, price: { id: 'price_old' } }] }
		}));
		const update = vi.fn(async () => ({ id: 'sub_1' }));
		const retrieveUpcoming = vi.fn(async () => ({
			amount_due: 123,
			currency: 'usd',
			amount_remaining: 50,
			total: 150,
			invoice_pdf: 'https://stripe.test/invoice.pdf'
		}));
		const sessionsCreate = vi.fn();
		const stripe = {
			subscriptions: { retrieve, update },
			invoices: { retrieveUpcoming },
			checkout: { sessions: { create: sessionsCreate } }
		};

		vi.doMock('$lib/server/billing', () => ({
			getPlanConfig: vi.fn((plan: string | null) =>
				plan === 'growth' ? { plan: 'growth', mode: 'subscription', priceId: 'price_new' } : null
			),
			getOrCreateStripeCustomer: vi.fn(async () => ({ id: 'cus_1' })),
			getStripeClient: vi.fn(() => stripe)
		}));

		const { POST } = await import('../../../src/routes/api/billing/checkout/+server');
		const res = await POST(
			makeEvent({ uid: 'u1', body: { plan: 'growth', idempotencyKey: 'k', returnUrl: 'https://example.com/return' } })
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.status).toBe('updated');
		expect(body.currentPlan).toBe('growth');
		expect(body.upcomingInvoice.amount_due).toBe(123);

		expect(retrieve).toHaveBeenCalledWith('sub_1', { expand: ['items.data.price'] });
		expect(update).toHaveBeenCalledWith(
			'sub_1',
			expect.any(Object),
			expect.objectContaining({ idempotencyKey: 'k::subscription-update' })
		);
		expect(sessionsCreate).not.toHaveBeenCalled();
	});

	it('upgrades an existing subscription without explicit idempotencyKey (hash-derived key)', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({
			'users/u1': { currentPlan: { planKey: 'starter' } },
			'users/u1/subscriptions/snap': { stripeSubscriptionId: 'sub_1', updatedAt: 10 }
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const retrieve = vi.fn(async () => ({
			id: 'sub_1',
			customer: 'cus_1',
			items: { data: [{ id: 'item_1', quantity: 1, price: { id: 'price_old' } }] }
		}));
		const update = vi.fn(async () => ({ id: 'sub_1' }));
		const stripe = {
			subscriptions: { retrieve, update },
			invoices: {},
			checkout: { sessions: { create: vi.fn() } }
		};

		vi.doMock('$lib/server/billing', () => ({
			getPlanConfig: vi.fn((plan: string | null) =>
				plan === 'growth' ? { plan: 'growth', mode: 'subscription', priceId: 'price_new' } : null
			),
			getOrCreateStripeCustomer: vi.fn(async () => ({ id: 'cus_1' })),
			getStripeClient: vi.fn(() => stripe)
		}));

		const { POST } = await import('../../../src/routes/api/billing/checkout/+server');
		const res = await POST(makeEvent({ uid: 'u1', body: { plan: 'growth', returnUrl: 'https://example.com/return' } }));
		expect(res.status).toBe(200);
		expect((await res.json()).status).toBe('updated');

		const updateArgs = (stripe.subscriptions.update as any).mock.calls[0];
		expect(updateArgs?.[2]?.idempotencyKey).toMatch(/^[a-f0-9]{64}$/);
	});

	it('falls back to checkout when Stripe subscription has no items', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({
			'users/u1': { currentPlan: { planKey: 'starter' } },
			'users/u1/subscriptions/snap': { stripeSubscriptionId: 'sub_1', updatedAt: 10 }
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const sessionsCreate = vi.fn(async () => ({ id: 'cs_fallback', url: 'https://stripe.test/checkout' }));
		const stripe = {
			subscriptions: {
				retrieve: vi.fn(async () => ({ id: 'sub_1', customer: 'cus_1', items: { data: [] } })),
				update: vi.fn()
			},
			invoices: {},
			checkout: { sessions: { create: sessionsCreate } }
		};

		vi.doMock('$lib/server/billing', () => ({
			getPlanConfig: vi.fn((plan: string | null) =>
				plan === 'growth' ? { plan: 'growth', mode: 'subscription', priceId: 'price_new' } : null
			),
			getOrCreateStripeCustomer: vi.fn(async () => ({ id: 'cus_1' })),
			getStripeClient: vi.fn(() => stripe)
		}));

		const { POST } = await import('../../../src/routes/api/billing/checkout/+server');
		const res = await POST(makeEvent({ uid: 'u1', body: { plan: 'growth', idempotencyKey: 'k' } }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ url: 'https://stripe.test/checkout' });
		expect(sessionsCreate).toHaveBeenCalled();
	});

	it('continues upgrade when retrieveUpcoming invoice throws', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({
			'users/u1': { currentPlan: { planKey: 'starter' } },
			'users/u1/subscriptions/snap': { stripeSubscriptionId: 'sub_1', updatedAt: 10 }
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
				update: vi.fn(async () => ({ id: 'sub_1' }))
			},
			invoices: {
				retrieveUpcoming: vi.fn(async () => {
					throw new Error('down');
				})
			},
			checkout: { sessions: { create: vi.fn() } }
		};

		vi.doMock('$lib/server/billing', () => ({
			getPlanConfig: vi.fn((plan: string | null) =>
				plan === 'growth' ? { plan: 'growth', mode: 'subscription', priceId: 'price_new' } : null
			),
			getOrCreateStripeCustomer: vi.fn(async () => ({ id: 'cus_1' })),
			getStripeClient: vi.fn(() => stripe)
		}));

		const { POST } = await import('../../../src/routes/api/billing/checkout/+server');
		const res = await POST(makeEvent({ uid: 'u1', body: { plan: 'growth', idempotencyKey: 'k' } }));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.status).toBe('updated');
		expect(body.upcomingInvoice).toBeNull();
	});

	it('falls back to checkout when subscription upgrade fails and includes upgrade messaging', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({
			'users/u1': { currentPlan: { planKey: 'starter' } },
			'users/u1/subscriptions/snap': { stripeSubscriptionId: 'sub_1', updatedAt: 10 }
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
				update: vi.fn(async () => {
					throw new Error('upgrade failed');
				})
			},
			invoices: {},
			checkout: {
				sessions: {
					create: vi.fn(async (_params: any) => ({ id: 'cs_2', url: 'https://stripe.test/checkout' }))
				}
			}
		};

		vi.doMock('$lib/server/billing', () => ({
			getPlanConfig: vi.fn((plan: string | null) =>
				plan === 'growth' ? { plan: 'growth', mode: 'subscription', priceId: 'price_new' } : null
			),
			getOrCreateStripeCustomer: vi.fn(async () => ({ id: 'cus_1' })),
			getStripeClient: vi.fn(() => stripe)
		}));

		const { POST } = await import('../../../src/routes/api/billing/checkout/+server');
		const res = await POST(makeEvent({ uid: 'u1', body: { plan: 'growth', idempotencyKey: 'k', returnUrl: '/my-account/billing' } }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ url: 'https://stripe.test/checkout' });

		const createArgs = (stripe.checkout.sessions.create as any).mock.calls[0];
		expect(createArgs?.[0]?.custom_text?.submit?.message).toContain("You're upgrading from Starter to Growth");
		expect(createArgs?.[0]?.subscription_data?.description).toContain('Upgrade from Starter to Growth');
		expect(createArgs?.[1]?.idempotencyKey).toMatch(/^k::checkout-session::/);

		const sessionDoc = await adminDb.collection('checkoutSessions').doc('cs_2').get();
		expect(sessionDoc.get('mode')).toBe('subscription');
	});

	it('supports payment-mode plans and maps Stripe failures', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({ 'users/u1': { currentPlan: { planKey: 'free' } } });
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const sessionsCreate = vi.fn(async () => {
			throw new Error('stripe down');
		});
		const stripe = { checkout: { sessions: { create: sessionsCreate } }, subscriptions: {}, invoices: {} };
		vi.doMock('$lib/server/billing', () => ({
			getPlanConfig: vi.fn((plan: string | null) =>
				plan === 'event' ? { plan: 'event', mode: 'payment', priceId: 'price_event' } : null
			),
			getOrCreateStripeCustomer: vi.fn(async () => ({ id: 'cus_1' })),
			getStripeClient: vi.fn(() => stripe)
		}));

		const { POST } = await import('../../../src/routes/api/billing/checkout/+server');
		const res = await POST(makeEvent({ uid: 'u1', body: { plan: 'event' } }));
		expect(res.status).toBe(502);
		expect((await res.json()).error.code).toBe('CHECKOUT_START_FAILED');
	});
});
