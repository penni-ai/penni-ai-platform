import { describe, expect, it, vi } from 'vitest';

import { FakeFirestore } from '../../helpers/fake-firebase';

function makeEvent(options: { signature?: string | null; body?: string }) {
	const url = new URL('http://localhost/api/public/billing/webhook');
	const headers = new Headers();
	if (options.signature !== null && options.signature !== undefined) {
		headers.set('stripe-signature', options.signature);
	}
	const request = new Request(url.toString(), { method: 'POST', headers, body: options.body ?? '{}' });
	return {
		request,
		url,
		locals: { requestId: 'req_local' },
		params: {}
	} as any;
}

describe('routes/api/public/billing/webhook', () => {
	it('requires stripe-signature header', async () => {
		vi.resetModules();

		const adminDb: any = Object.assign(new FakeFirestore(), { app: { options: { projectId: 'p', storageBucket: 'b' } } });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
		vi.doMock('$env/dynamic/private', () => ({ env: { STRIPE_WEBHOOK_SECRET: 'whsec' } }));
		vi.doMock('$lib/server/billing', () => ({
			getStripeClient: () => ({ webhooks: { constructEvent: vi.fn() } }),
			getPlanKeyByPrice: vi.fn(() => null),
			buildFeatureCapabilities: vi.fn(() => ({})),
			getRefreshDate: vi.fn(() => 0),
			updateUserFeatureCapabilities: vi.fn(async () => {})
		}));

		const { POST } = await import('../../../src/routes/api/public/billing/webhook/+server');
		const res = await POST(makeEvent({ signature: null }));
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe('STRIPE_SIGNATURE_MISSING');
	});

	it('returns 500 when STRIPE_WEBHOOK_SECRET is missing', async () => {
		vi.resetModules();

		const adminDb: any = Object.assign(new FakeFirestore(), { app: { options: { projectId: 'p', storageBucket: 'b' } } });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
		vi.doMock('$env/dynamic/private', () => ({ env: { STRIPE_WEBHOOK_SECRET: undefined } }));
		vi.doMock('$lib/server/billing', () => ({
			getStripeClient: () => ({ webhooks: { constructEvent: vi.fn() } }),
			getPlanKeyByPrice: vi.fn(() => null),
			buildFeatureCapabilities: vi.fn(() => ({})),
			getRefreshDate: vi.fn(() => 0),
			updateUserFeatureCapabilities: vi.fn(async () => {})
		}));

		const { POST } = await import('../../../src/routes/api/public/billing/webhook/+server');
		const res = await POST(makeEvent({ signature: 'sig' }));
		expect(res.status).toBe(500);
		const body = await res.json();
		expect(body.error.code).toBe('STRIPE_WEBHOOK_SECRET_MISSING');
	});

	it('rejects invalid signatures', async () => {
		vi.resetModules();

		const adminDb: any = Object.assign(new FakeFirestore(), { app: { options: { projectId: 'p', storageBucket: 'b' } } });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
		vi.doMock('$env/dynamic/private', () => ({ env: { STRIPE_WEBHOOK_SECRET: 'whsec' } }));
		vi.doMock('$lib/server/billing', () => ({
			getStripeClient: () => ({
				webhooks: {
					constructEvent: () => {
						throw new Error('bad sig');
					}
				}
			}),
			getPlanKeyByPrice: vi.fn(() => null),
			buildFeatureCapabilities: vi.fn(() => ({})),
			getRefreshDate: vi.fn(() => 0),
			updateUserFeatureCapabilities: vi.fn(async () => {})
		}));

		const { POST } = await import('../../../src/routes/api/public/billing/webhook/+server');
		const res = await POST(makeEvent({ signature: 'sig' }));
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe('STRIPE_SIGNATURE_INVALID');
	});

	it('short-circuits duplicate events', async () => {
		vi.resetModules();

		const db = new FakeFirestore({ 'webhookEvents/evt_1': { type: 'x', receivedAt: 1 } });
		const adminDb: any = Object.assign(db, { app: { options: { projectId: 'p', storageBucket: 'b' } } });

		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
		vi.doMock('$env/dynamic/private', () => ({ env: { STRIPE_WEBHOOK_SECRET: 'whsec' } }));
		vi.doMock('$lib/server/billing', () => ({
			getStripeClient: () => ({
				webhooks: {
					constructEvent: () => ({ id: 'evt_1', type: 'billing_portal.session.created', data: { object: {} } })
				}
			}),
			getPlanKeyByPrice: vi.fn(() => null),
			buildFeatureCapabilities: vi.fn(() => ({})),
			getRefreshDate: vi.fn(() => 0),
			updateUserFeatureCapabilities: vi.fn(async () => {})
		}));

		const { POST } = await import('../../../src/routes/api/public/billing/webhook/+server');
		const res = await POST(makeEvent({ signature: 'sig' }));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.duplicate).toBe(true);
	});

	it('handles payment_intent.succeeded for event credits', async () => {
		vi.resetModules();

		const db = new FakeFirestore({
			'users/u1': {
				eventCredits: { influencersRemaining: 100, outreachRemaining: 10, additionalInboxes: 1, purchasedAt: 0, paymentIntentId: 'pi_old' }
			}
		});
		const adminDb: any = Object.assign(db, { app: { options: { projectId: 'p', storageBucket: 'b' } } });

		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
		vi.doMock('$env/dynamic/private', () => ({ env: { STRIPE_WEBHOOK_SECRET: 'whsec' } }));
		vi.doMock('$lib/server/billing', () => ({
			getStripeClient: () => ({
				webhooks: {
					constructEvent: () => ({
						id: 'evt_pi',
						type: 'payment_intent.succeeded',
						data: {
							object: {
								id: 'pi_1',
								customer: 'cus_1',
								invoice: 'inv_1',
								metadata: { firebaseUid: 'u1', plan: 'event', priceId: 'price', productId: 'prod' }
							}
						}
					})
				}
			}),
			getPlanKeyByPrice: vi.fn(() => null),
			buildFeatureCapabilities: vi.fn(() => ({})),
			getRefreshDate: vi.fn(() => 0),
			updateUserFeatureCapabilities: vi.fn(async () => {})
		}));

		const { POST } = await import('../../../src/routes/api/public/billing/webhook/+server');
		const res = await POST(makeEvent({ signature: 'sig', body: '{"hello":"world"}' }));
		expect(res.status).toBe(200);

		const userSnap = await adminDb.collection('users').doc('u1').get();
		expect(userSnap.get('addons.eventAccess')).toBe(true);
		expect(userSnap.get('eventCredits.paymentIntentId')).toBe('pi_1');
		expect(userSnap.get('eventCredits.influencersRemaining')).toBe(100 + 5000);
	});

	it('handles customer.subscription.updated events and records subscription state', async () => {
		vi.resetModules();

		const db = new FakeFirestore({ 'users/u1': {} });
		const adminDb: any = Object.assign(db, { app: { options: { projectId: 'p', storageBucket: 'b' } } });

		const stripe = {
			webhooks: {
				constructEvent: () => ({
					id: 'evt_sub_updated',
					type: 'customer.subscription.updated',
					data: {
						object: {
							id: 'sub_1',
							status: 'active',
							customer: 'cus_1',
							current_period_start: 1700000000,
							current_period_end: 1700003600,
							trial_start: null,
							trial_end: null,
							cancel_at: null,
							canceled_at: null,
							cancel_at_period_end: false,
							customer_email: 'u1@example.com',
							latest_invoice: 'inv_1',
							default_payment_method: 'pm_1',
							items: { data: [{ id: 'item_1', quantity: 1, price: { id: 'price_s', product: 'prod_s' } }] },
							metadata: { firebaseUid: 'u1', plan: 'starter' }
						}
					}
				})
			}
		};

		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
		vi.doMock('$env/dynamic/private', () => ({ env: { STRIPE_WEBHOOK_SECRET: 'whsec' } }));
		vi.doMock('$lib/server/billing', () => ({
			getStripeClient: () => stripe,
			getPlanKeyByPrice: vi.fn(() => null),
			buildFeatureCapabilities: vi.fn((plan: string) => ({ plan })),
			getRefreshDate: vi.fn(() => 0),
			updateUserFeatureCapabilities: vi.fn(async () => {})
		}));

		const { POST } = await import('../../../src/routes/api/public/billing/webhook/+server');
		const res = await POST(makeEvent({ signature: 'sig', body: '{"ok":true}' }));
		expect(res.status).toBe(200);

		const subSnap = await adminDb.collection('users').doc('u1').collection('subscriptions').doc('sub_1').get();
		expect(subSnap.get('planKey')).toBe('starter');
	});

	it('handles subscription deletion webhooks without Firebase UID metadata', async () => {
		vi.resetModules();

		const db = new FakeFirestore();
		const adminDb: any = Object.assign(db, { app: { options: { projectId: 'p', storageBucket: 'b' } } });

		const stripe = {
			webhooks: {
				constructEvent: () => ({
					id: 'evt_deleted_missing_uid',
					type: 'customer.subscription.deleted',
					data: { object: { id: 'sub_del', customer: 'cus_missing', status: 'canceled', metadata: {} } }
				})
			}
		};

		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
		vi.doMock('$env/dynamic/private', () => ({ env: { STRIPE_WEBHOOK_SECRET: 'whsec' } }));
		vi.doMock('$lib/server/billing', () => ({
			getStripeClient: () => stripe,
			getPlanKeyByPrice: vi.fn(() => null),
			buildFeatureCapabilities: vi.fn(() => ({})),
			getRefreshDate: vi.fn(() => 0),
			updateUserFeatureCapabilities: vi.fn(async () => {})
		}));

		const warn = vi.fn();
		const logger: any = { child: () => logger, warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() };

		const { POST } = await import('../../../src/routes/api/public/billing/webhook/+server');
		const event = makeEvent({ signature: 'sig', body: '{"ok":true}' });
		event.locals.logger = logger;
		const res = await POST(event);
		expect(res.status).toBe(200);
		expect(warn.mock.calls.some(([msg]) => String(msg).includes('Subscription deletion webhook without Firebase UID'))).toBe(true);
	});

	it('no-ops invoice and payment intent events when uid cannot be resolved', async () => {
		vi.resetModules();

		const db = new FakeFirestore();
		const adminDb: any = Object.assign(db, { app: { options: { projectId: 'p', storageBucket: 'b' } } });

		const constructEvent = vi.fn()
			.mockReturnValueOnce({
				id: 'evt_inv_no_uid',
				type: 'invoice.paid',
				data: { object: { id: 'inv_no_uid', subscription: 'sub_1', status: 'paid', amount_due: 0, amount_paid: 0, metadata: {} } }
			})
			.mockReturnValueOnce({
				id: 'evt_pi_no_uid',
				type: 'payment_intent.succeeded',
				data: { object: { id: 'pi_no_uid', customer: 'cus_1', metadata: {} } }
			});

		const stripe = { webhooks: { constructEvent } };

		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
		vi.doMock('$env/dynamic/private', () => ({ env: { STRIPE_WEBHOOK_SECRET: 'whsec' } }));
		vi.doMock('$lib/server/billing', () => ({
			getStripeClient: () => stripe,
			getPlanKeyByPrice: vi.fn(() => null),
			buildFeatureCapabilities: vi.fn(() => ({})),
			getRefreshDate: vi.fn(() => 0),
			updateUserFeatureCapabilities: vi.fn(async () => {})
		}));

		const route = await import('../../../src/routes/api/public/billing/webhook/+server');

		const invoiceRes = await route.POST(makeEvent({ signature: 'sig', body: '{"ok":true}' }));
		expect(invoiceRes.status).toBe(200);

		const intentRes = await route.POST(makeEvent({ signature: 'sig', body: '{"ok":true}' }));
		expect(intentRes.status).toBe(200);
	});

	it('handles checkout.session.completed (payment) when payment_intent is an object without id', async () => {
		vi.resetModules();

		const db = new FakeFirestore({ 'users/u1': {} });
		const adminDb: any = Object.assign(db, { app: { options: { projectId: 'p', storageBucket: 'b' } } });

		const stripe = {
			webhooks: {
				constructEvent: () => ({
					id: 'evt_pay_obj_missing_id',
					type: 'checkout.session.completed',
					data: {
						object: {
							id: 'cs_pay_obj',
							mode: 'payment',
							customer: 'cus_1',
							invoice: 'inv_2',
							payment_intent: {}, // final-else branch => null
							metadata: { firebaseUid: 'u1' }
						}
					}
				})
			},
			subscriptions: { retrieve: vi.fn() },
				checkout: {
					sessions: {
						listLineItems: vi.fn(async () => ({ data: [{ price: { id: 'price_event', product: { id: 'prod_event' } } }] }))
					}
				}
			};

		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
		vi.doMock('$env/dynamic/private', () => ({ env: { STRIPE_WEBHOOK_SECRET: 'whsec' } }));
		vi.doMock('$lib/server/billing', () => ({
			getStripeClient: () => stripe,
			getPlanKeyByPrice: vi.fn(() => null),
			buildFeatureCapabilities: vi.fn(() => ({})),
			getRefreshDate: vi.fn(() => 0),
			updateUserFeatureCapabilities: vi.fn(async () => {})
		}));

		const { POST } = await import('../../../src/routes/api/public/billing/webhook/+server');
		const res = await POST(makeEvent({ signature: 'sig', body: '{"ok":true}' }));
		expect(res.status).toBe(200);
		});

		it('logs a warning when subscription event has no UID and no stripeCustomers mapping', async () => {
			vi.resetModules();

			const adminDb: any = Object.assign(new FakeFirestore(), { app: { options: { projectId: 'p', storageBucket: 'b' } } });
			vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
			vi.doMock('$env/dynamic/private', () => ({ env: { STRIPE_WEBHOOK_SECRET: 'whsec' } }));

			const stripe = {
				webhooks: {
					constructEvent: () => ({
						id: 'evt_sub_missing_uid',
						type: 'customer.subscription.updated',
						data: {
							object: {
								id: 'sub_1',
								customer: 'cus_1',
								items: { data: [{ id: 'item_1', quantity: 1, price: { id: 'price_s', product: 'prod_s' } }] },
								metadata: {}
							}
						}
					})
				}
			};

			const warn = vi.fn();
			const logger: any = { child: () => logger, warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() };

			vi.doMock('$lib/server/billing', () => ({
				getStripeClient: () => stripe,
				getPlanKeyByPrice: vi.fn(() => null),
				buildFeatureCapabilities: vi.fn(() => ({})),
				getRefreshDate: vi.fn(() => 0),
				updateUserFeatureCapabilities: vi.fn(async () => {})
			}));

			const { POST } = await import('../../../src/routes/api/public/billing/webhook/+server');
			const event = makeEvent({ signature: 'sig', body: '{"ok":true}' });
			event.locals.logger = logger;
			const res = await POST(event);

			expect(res.status).toBe(200);
			expect(warn.mock.calls.some(([msg]) => String(msg).includes('Subscription event missing Firebase UID'))).toBe(true);
		});

		it('logs a warning when subscription plan key cannot be resolved', async () => {
			vi.resetModules();

			const adminDb: any = Object.assign(new FakeFirestore(), { app: { options: { projectId: 'p', storageBucket: 'b' } } });
			vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
			vi.doMock('$env/dynamic/private', () => ({ env: { STRIPE_WEBHOOK_SECRET: 'whsec' } }));

			const stripe = {
				webhooks: {
					constructEvent: () => ({
						id: 'evt_sub_plan_unresolved',
						type: 'customer.subscription.updated',
						data: {
							object: {
								id: 'sub_1',
								customer: 'cus_1',
								items: { data: [{ id: 'item_1', quantity: 1, price: { id: 'price_unknown', product: 'prod_s' } }] },
								metadata: { firebaseUid: 'u1' }
							}
						}
					})
				}
			};

			const warn = vi.fn();
			const logger: any = { child: () => logger, warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() };

			vi.doMock('$lib/server/billing', () => ({
				getStripeClient: () => stripe,
				getPlanKeyByPrice: vi.fn(() => null),
				buildFeatureCapabilities: vi.fn(() => ({})),
				getRefreshDate: vi.fn(() => 0),
				updateUserFeatureCapabilities: vi.fn(async () => {})
			}));

			const { POST } = await import('../../../src/routes/api/public/billing/webhook/+server');
			const event = makeEvent({ signature: 'sig', body: '{"ok":true}' });
			event.locals.logger = logger;
			const res = await POST(event);

			expect(res.status).toBe(200);
			expect(warn.mock.calls.some(([msg]) => String(msg).includes('Unable to resolve plan key for subscription'))).toBe(true);
		});

		it('marks subscription past_due on invoice.payment_failed', async () => {
			vi.resetModules();

			const db = new FakeFirestore({ 'users/u1': {} });
		const adminDb: any = Object.assign(db, { app: { options: { projectId: 'p', storageBucket: 'b' } } });

		const stripe = {
			webhooks: {
				constructEvent: () => ({
					id: 'evt_inv_failed',
					type: 'invoice.payment_failed',
					data: {
						object: {
							id: 'in_failed',
							subscription: 'sub_1',
							customer: 'cus_1',
							status: 'open',
							amount_due: 10,
							amount_paid: 0,
							hosted_invoice_url: null,
							metadata: { firebaseUid: 'u1' }
						}
					}
				})
			}
		};

		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
		vi.doMock('$env/dynamic/private', () => ({ env: { STRIPE_WEBHOOK_SECRET: 'whsec' } }));
		vi.doMock('$lib/server/billing', () => ({
			getStripeClient: () => stripe,
			getPlanKeyByPrice: vi.fn(() => null),
			buildFeatureCapabilities: vi.fn(() => ({})),
			getRefreshDate: vi.fn(() => 0),
			updateUserFeatureCapabilities: vi.fn(async () => {})
		}));

		const { POST } = await import('../../../src/routes/api/public/billing/webhook/+server');
		const res = await POST(makeEvent({ signature: 'sig', body: '{"ok":true}' }));
		expect(res.status).toBe(200);

		const subSnap = await adminDb.collection('users').doc('u1').collection('subscriptions').doc('sub_1').get();
		expect(subSnap.get('status')).toBe('past_due');
	});

		it('logs a warning when resolving uid from stripeCustomers throws', async () => {
			vi.resetModules();

			const adminDb: any = Object.assign(new FakeFirestore(), { app: { options: { projectId: 'p', storageBucket: 'b' } } });
			const originalGet = adminDb._get.bind(adminDb);
			adminDb._get = (path: string) => {
				if (String(path).includes('stripeCustomers/cus_1')) {
					throw new Error('boom');
				}
				return originalGet(path);
			};
			vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
			vi.doMock('$env/dynamic/private', () => ({ env: { STRIPE_WEBHOOK_SECRET: 'whsec' } }));

			const stripe = {
				webhooks: {
					constructEvent: () => ({
					id: 'evt_uid_lookup_throw',
					type: 'checkout.session.completed',
					data: {
						object: {
							id: 'cs_throw',
							mode: 'subscription',
							customer: 'cus_1',
							subscription: 'sub_1',
							metadata: {} // forces lookup by customer id
						}
					}
				})
			},
			subscriptions: { retrieve: vi.fn() },
			checkout: { sessions: { listLineItems: vi.fn(async () => ({ data: [] })) } }
		};

		const warn = vi.fn();
		const logger: any = { child: () => logger, warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() };

		vi.doMock('$lib/server/billing', () => ({
			getStripeClient: () => stripe,
			getPlanKeyByPrice: vi.fn(() => null),
			buildFeatureCapabilities: vi.fn(() => ({})),
			getRefreshDate: vi.fn(() => 0),
			updateUserFeatureCapabilities: vi.fn(async () => {})
		}));

		const { POST } = await import('../../../src/routes/api/public/billing/webhook/+server');
		const event = makeEvent({ signature: 'sig', body: '{"ok":true}' });
		event.locals.logger = logger;

		const res = await POST(event);
		expect(res.status).toBe(200);
		expect(warn.mock.calls.some(([msg]) => String(msg).includes('Failed to resolve Firebase UID for Stripe customer'))).toBe(true);
	});

	it('handles checkout.session.completed (subscription) and records subscription state', async () => {
		vi.resetModules();

		const db = new FakeFirestore({ 'users/u1': {} });
		const adminDb: any = Object.assign(db, { app: { options: { projectId: 'p', storageBucket: 'b' } } });

		const stripe = {
			webhooks: {
				constructEvent: () => ({
					id: 'evt_cs',
					type: 'checkout.session.completed',
					data: {
						object: {
							id: 'cs_1',
							mode: 'subscription',
							customer: 'cus_1',
							subscription: 'sub_1',
							metadata: { firebaseUid: 'u1', plan: 'starter' }
						}
					}
				})
			},
			subscriptions: {
				retrieve: vi.fn(async () => ({
					id: 'sub_1',
					status: 'active',
					customer: 'cus_1',
					current_period_start: 1700000000,
					current_period_end: 1700003600,
					trial_start: null,
					trial_end: null,
					cancel_at: null,
					canceled_at: null,
					cancel_at_period_end: false,
					customer_email: 'u1@example.com',
					latest_invoice: 'inv_1',
					default_payment_method: 'pm_1',
					items: {
						data: [
							{
								id: 'item_1',
								quantity: 1,
								price: { id: 'price_s', product: 'prod_s', nickname: 'Starter' },
								plan: { nickname: 'Starter' }
							}
						]
					},
					metadata: { firebaseUid: 'u1', plan: 'starter' }
				}))
			},
			checkout: {
				sessions: {
					listLineItems: vi.fn(async () => ({ data: [] }))
				}
			}
		};

		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
		vi.doMock('$env/dynamic/private', () => ({ env: { STRIPE_WEBHOOK_SECRET: 'whsec' } }));
		vi.doMock('$lib/server/billing', () => ({
			getStripeClient: () => stripe,
			getPlanKeyByPrice: vi.fn(() => null),
			buildFeatureCapabilities: vi.fn((plan: string) => ({ plan })),
			getRefreshDate: vi.fn(() => 123),
			updateUserFeatureCapabilities: vi.fn(async () => {})
		}));

		const { POST } = await import('../../../src/routes/api/public/billing/webhook/+server');
		const res = await POST(makeEvent({ signature: 'sig', body: '{"ok":true}' }));
		expect(res.status).toBe(200);

		const sessionSnap = await adminDb.collection('checkoutSessions').doc('cs_1').get();
		expect(sessionSnap.get('status')).toBe('completed');
		expect(sessionSnap.get('subscriptionId')).toBe('sub_1');

		const subSnap = await adminDb.collection('users').doc('u1').collection('subscriptions').doc('sub_1').get();
		expect(subSnap.get('planKey')).toBe('starter');
		expect(subSnap.get('priceId')).toBe('price_s');

		const userSnap = await adminDb.collection('users').doc('u1').get();
		expect(userSnap.get('currentPlan.planKey')).toBe('starter');
		expect(userSnap.get('feature_capabilities.plan')).toBe('starter');
	});

	it('supports resolving uid from stripeCustomers and planKey via price map', async () => {
		vi.resetModules();

		const db = new FakeFirestore({
			'users/u1': {},
			'stripeCustomers/cus_1': { uid: 'u1' }
		});
		const adminDb: any = Object.assign(db, { app: { options: { projectId: 'p', storageBucket: 'b' } } });

		const stripe = {
			webhooks: {
				constructEvent: () => ({
					id: 'evt_cs_map',
					type: 'checkout.session.completed',
					data: {
						object: {
							id: 'cs_map',
							mode: 'subscription',
							customer: 'cus_1',
							subscription: 'sub_1',
							payment_intent: { id: 'pi_obj' },
							metadata: { plan: 'unknown' } // forces getPlanKeyByPrice fallback
						}
					}
				})
			},
			subscriptions: {
				retrieve: vi.fn(async () => ({
					id: 'sub_1',
					status: 'active',
					customer: 'cus_1',
					current_period_start: 1700000000,
					current_period_end: 1700003600,
					trial_start: null,
					trial_end: null,
					cancel_at: null,
					canceled_at: null,
					cancel_at_period_end: false,
					customer_email: 'u1@example.com',
					items: { data: [{ id: 'item_1', quantity: 1, price: { id: 'price_s', product: 'prod_s' } }] },
					metadata: {}
				}))
			},
			checkout: { sessions: { listLineItems: vi.fn(async () => ({ data: [] })) } }
		};

		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
		vi.doMock('$env/dynamic/private', () => ({ env: { STRIPE_WEBHOOK_SECRET: 'whsec' } }));
		vi.doMock('$lib/server/billing', () => ({
			getStripeClient: () => stripe,
			getPlanKeyByPrice: vi.fn(() => 'starter'),
			buildFeatureCapabilities: vi.fn((plan: string) => ({ plan })),
			getRefreshDate: vi.fn(() => 123),
			updateUserFeatureCapabilities: vi.fn(async () => {})
		}));

		const { POST } = await import('../../../src/routes/api/public/billing/webhook/+server');
		const res = await POST(makeEvent({ signature: 'sig', body: '{"ok":true}' }));
		expect(res.status).toBe(200);

		const sessionSnap = await adminDb.collection('checkoutSessions').doc('cs_map').get();
		expect(sessionSnap.get('paymentIntentId')).toBe('pi_obj');

		const userSnap = await adminDb.collection('users').doc('u1').get();
		expect(userSnap.get('currentPlan.planKey')).toBe('starter');
	});

	it('handles checkout.session.completed (payment) and records addon purchase', async () => {
		vi.resetModules();

		const db = new FakeFirestore({ 'users/u1': {} });
		const adminDb: any = Object.assign(db, { app: { options: { projectId: 'p', storageBucket: 'b' } } });

		const stripe = {
			webhooks: {
				constructEvent: () => ({
					id: 'evt_pay',
					type: 'checkout.session.completed',
					data: {
						object: {
							id: 'cs_pay',
							mode: 'payment',
							customer: 'cus_1',
							subscription: null,
							invoice: 'inv_2',
							payment_intent: 'pi_2',
							metadata: { firebaseUid: 'u1' }
						}
					}
				})
			},
			subscriptions: { retrieve: vi.fn() },
			checkout: {
				sessions: {
					listLineItems: vi.fn(async () => ({
						data: [{ price: { id: 'price_event', product: 'prod_event' } }]
					}))
				}
			}
		};

		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
		vi.doMock('$env/dynamic/private', () => ({ env: { STRIPE_WEBHOOK_SECRET: 'whsec' } }));
		vi.doMock('$lib/server/billing', () => ({
			getStripeClient: () => stripe,
			getPlanKeyByPrice: vi.fn(() => null),
			buildFeatureCapabilities: vi.fn(() => ({})),
			getRefreshDate: vi.fn(() => 0),
			updateUserFeatureCapabilities: vi.fn(async () => {})
		}));

		const { POST } = await import('../../../src/routes/api/public/billing/webhook/+server');
		const res = await POST(makeEvent({ signature: 'sig', body: '{"ok":true}' }));
		expect(res.status).toBe(200);

		const userSnap = await adminDb.collection('users').doc('u1').get();
		expect(userSnap.get('addons.eventAccess')).toBe(true);
	});

	it('ignores checkout.session.completed when uid missing and when planKey cannot be resolved', async () => {
		vi.resetModules();

		const db = new FakeFirestore({ 'users/u1': {} });
		const adminDb: any = Object.assign(db, { app: { options: { projectId: 'p', storageBucket: 'b' } } });

		const constructEvent = vi.fn()
			.mockReturnValueOnce({
				id: 'evt_no_uid',
				type: 'checkout.session.completed',
				data: { object: { id: 'cs_no_uid', mode: 'subscription', customer: 'cus_missing', subscription: 'sub_1', metadata: {} } }
			})
			.mockReturnValueOnce({
				id: 'evt_no_plan',
				type: 'checkout.session.completed',
				data: { object: { id: 'cs_no_plan', mode: 'subscription', customer: 'cus_1', subscription: 'sub_1', metadata: { firebaseUid: 'u1' } } }
			});

		const stripe = {
			webhooks: { constructEvent },
			subscriptions: {
				retrieve: vi.fn(async () => ({
					id: 'sub_1',
					status: 'active',
					customer: 'cus_1',
					items: { data: [{ id: 'item_1', quantity: 1, price: { id: 'price_unknown', product: 'prod' } }] },
					metadata: {}
				}))
			},
			checkout: { sessions: { listLineItems: vi.fn(async () => ({ data: [] })) } }
		};

		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
		vi.doMock('$env/dynamic/private', () => ({ env: { STRIPE_WEBHOOK_SECRET: 'whsec' } }));
		vi.doMock('$lib/server/billing', () => ({
			getStripeClient: () => stripe,
			getPlanKeyByPrice: vi.fn(() => null),
			buildFeatureCapabilities: vi.fn((plan: string) => ({ plan })),
			getRefreshDate: vi.fn(() => 0),
			updateUserFeatureCapabilities: vi.fn(async () => {})
		}));

		const route = await import('../../../src/routes/api/public/billing/webhook/+server');

		const noUid = await route.POST(makeEvent({ signature: 'sig', body: '{"ok":true}' }));
		expect(noUid.status).toBe(200);
		const noUidSession = await adminDb.collection('checkoutSessions').doc('cs_no_uid').get();
		expect(noUidSession.exists).toBe(false);

		const noPlan = await route.POST(makeEvent({ signature: 'sig', body: '{"ok":true}' }));
		expect(noPlan.status).toBe(200);
		const sessionSnap = await adminDb.collection('checkoutSessions').doc('cs_no_plan').get();
		expect(sessionSnap.get('status')).toBe('completed');
		const subSnap = await adminDb.collection('users').doc('u1').collection('subscriptions').doc('sub_1').get();
		expect(subSnap.exists).toBe(false);
	});

	it('updates invoice status and marks past_due on invoice.payment_failed', async () => {
		vi.resetModules();

		const db = new FakeFirestore();
		const adminDb: any = Object.assign(db, { app: { options: { projectId: 'p', storageBucket: 'b' } } });

		const stripe = {
			webhooks: {
				constructEvent: () => ({
					id: 'evt_inv',
					type: 'invoice.payment_failed',
					data: {
						object: {
							id: 'in_1',
							customer: 'cus_1',
							subscription: 'sub_1',
							status: 'open',
							amount_due: 123,
							amount_paid: 0,
							hosted_invoice_url: 'https://stripe.test/invoice',
							metadata: { firebaseUid: 'u1' }
						}
					}
				})
			}
		};

		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
		vi.doMock('$env/dynamic/private', () => ({ env: { STRIPE_WEBHOOK_SECRET: 'whsec' } }));
		vi.doMock('$lib/server/billing', () => ({
			getStripeClient: () => stripe,
			getPlanKeyByPrice: vi.fn(() => null),
			buildFeatureCapabilities: vi.fn(() => ({})),
			getRefreshDate: vi.fn(() => 0),
			updateUserFeatureCapabilities: vi.fn(async () => {})
		}));

		const { POST } = await import('../../../src/routes/api/public/billing/webhook/+server');
		const res = await POST(makeEvent({ signature: 'sig', body: '{"ok":true}' }));
		expect(res.status).toBe(200);

		const subSnap = await adminDb.collection('users').doc('u1').collection('subscriptions').doc('sub_1').get();
		expect(subSnap.get('latestInvoiceId')).toBe('in_1');
		expect(subSnap.get('status')).toBe('past_due');
	});

	it('handles invoice.paid without subscription and marks subscription deleted', async () => {
		vi.resetModules();

		const db = new FakeFirestore({ 'users/u1': { currentPlan: { planKey: 'starter' } } });
		const adminDb: any = Object.assign(db, { app: { options: { projectId: 'p', storageBucket: 'b' } } });

		const constructEvent = vi.fn()
			.mockReturnValueOnce({
				id: 'evt_paid',
				type: 'invoice.paid',
				data: { object: { id: 'in_paid', customer: 'cus_1', subscription: null, status: 'paid', amount_due: 0, amount_paid: 0, metadata: { firebaseUid: 'u1' } } }
			})
			.mockReturnValueOnce({
				id: 'evt_deleted',
				type: 'customer.subscription.deleted',
				data: { object: { id: 'sub_del', customer: 'cus_1', status: 'canceled', cancel_at_period_end: true, metadata: { firebaseUid: 'u1' } } }
			});

		const stripe = { webhooks: { constructEvent } };

		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
		vi.doMock('$env/dynamic/private', () => ({ env: { STRIPE_WEBHOOK_SECRET: 'whsec' } }));
		vi.doMock('$lib/server/billing', () => ({
			getStripeClient: () => stripe,
			getPlanKeyByPrice: vi.fn(() => null),
			buildFeatureCapabilities: vi.fn((plan: string) => ({ plan })),
			getRefreshDate: vi.fn(() => 0),
			updateUserFeatureCapabilities: vi.fn(async () => {})
		}));

		const route = await import('../../../src/routes/api/public/billing/webhook/+server');

		const paidRes = await route.POST(makeEvent({ signature: 'sig', body: '{"ok":true}' }));
		expect(paidRes.status).toBe(200);
		const userSnap = await adminDb.collection('users').doc('u1').get();
		expect(userSnap.get('lastInvoiceId')).toBe('in_paid');

		const delRes = await route.POST(makeEvent({ signature: 'sig', body: '{"ok":true}' }));
		expect(delRes.status).toBe(200);
		const userAfter = await adminDb.collection('users').doc('u1').get();
		expect(userAfter.get('currentPlan.planKey')).toBe('free');
	});

		it('marks trialEndingSoon on trial_will_end and ignores portal events', async () => {
			vi.resetModules();

		const db = new FakeFirestore();
		const adminDb: any = Object.assign(db, { app: { options: { projectId: 'p', storageBucket: 'b' } } });

		const constructEvent = vi.fn()
			.mockReturnValueOnce({
				id: 'evt_trial',
				type: 'customer.subscription.trial_will_end',
				data: { object: { id: 'sub_1', customer: 'cus_1', trial_end: 1700000000, metadata: { firebaseUid: 'u1' } } }
			})
			.mockReturnValueOnce({
				id: 'evt_portal',
				type: 'billing_portal.configuration.updated',
				data: { object: {} }
			});

		const stripe = { webhooks: { constructEvent } };

		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
		vi.doMock('$env/dynamic/private', () => ({ env: { STRIPE_WEBHOOK_SECRET: 'whsec' } }));
		vi.doMock('$lib/server/billing', () => ({
			getStripeClient: () => stripe,
			getPlanKeyByPrice: vi.fn(() => null),
			buildFeatureCapabilities: vi.fn(() => ({})),
			getRefreshDate: vi.fn(() => 0),
			updateUserFeatureCapabilities: vi.fn(async () => {})
		}));

		const route = await import('../../../src/routes/api/public/billing/webhook/+server');

		const trialRes = await route.POST(makeEvent({ signature: 'sig', body: '{"ok":true}' }));
		expect(trialRes.status).toBe(200);
		const trialSnap = await adminDb.collection('users').doc('u1').collection('subscriptions').doc('sub_1').get();
		expect(trialSnap.get('trialEndingSoon')).toBe(true);

		const portalRes = await route.POST(makeEvent({ signature: 'sig', body: '{"ok":true}' }));
			expect(portalRes.status).toBe(200);
		});

		it('logs a warning when trial-ending webhook has no UID and no stripeCustomers mapping', async () => {
			vi.resetModules();

			const adminDb: any = Object.assign(new FakeFirestore(), { app: { options: { projectId: 'p', storageBucket: 'b' } } });

			const stripe = {
				webhooks: {
					constructEvent: () => ({
						id: 'evt_trial_missing_uid',
						type: 'customer.subscription.trial_will_end',
						data: {
							object: {
								id: 'sub_1',
								customer: 'cus_1',
								trial_end: 1700000000,
								metadata: {}
							}
						}
					})
				}
			};

			const warn = vi.fn();
			const logger: any = { child: () => logger, warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() };

			vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
			vi.doMock('$env/dynamic/private', () => ({ env: { STRIPE_WEBHOOK_SECRET: 'whsec' } }));
			vi.doMock('$lib/server/billing', () => ({
				getStripeClient: () => stripe,
				getPlanKeyByPrice: vi.fn(() => null),
				buildFeatureCapabilities: vi.fn(() => ({})),
				getRefreshDate: vi.fn(() => 0),
				updateUserFeatureCapabilities: vi.fn(async () => {})
			}));

			const { POST } = await import('../../../src/routes/api/public/billing/webhook/+server');
			const event = makeEvent({ signature: 'sig', body: '{"ok":true}' });
			event.locals.logger = logger;
			const res = await POST(event);

			expect(res.status).toBe(200);
			expect(warn.mock.calls.some(([msg]) => String(msg).includes('Trial-ending webhook without Firebase UID'))).toBe(true);
		});

		it('ignores unknown event types and no-ops payment intents without event plan', async () => {
			vi.resetModules();

		const db = new FakeFirestore({ 'users/u1': {} });
		const adminDb: any = Object.assign(db, { app: { options: { projectId: 'p', storageBucket: 'b' } } });

		const constructEvent = vi.fn()
			.mockReturnValueOnce({ id: 'evt_unknown', type: 'customer.created', data: { object: {} } })
			.mockReturnValueOnce({
				id: 'evt_pi_noop',
				type: 'payment_intent.payment_failed',
				data: { object: { id: 'pi_noop', customer: 'cus_1', metadata: { firebaseUid: 'u1', plan: 'starter' } } }
			});
		const stripe = { webhooks: { constructEvent } };

		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
		vi.doMock('$env/dynamic/private', () => ({ env: { STRIPE_WEBHOOK_SECRET: 'whsec' } }));
		vi.doMock('$lib/server/billing', () => ({
			getStripeClient: () => stripe,
			getPlanKeyByPrice: vi.fn(() => null),
			buildFeatureCapabilities: vi.fn(() => ({})),
			getRefreshDate: vi.fn(() => 0),
			updateUserFeatureCapabilities: vi.fn(async () => {})
		}));

		const route = await import('../../../src/routes/api/public/billing/webhook/+server');
		const res = await route.POST(makeEvent({ signature: 'sig', body: '{"ok":true}' }));
		expect(res.status).toBe(200);
		const log = await adminDb.collection('webhookEvents').doc('evt_unknown').get();
		expect(log.get('outcome')).toBe('ignored');

		const noop = await route.POST(makeEvent({ signature: 'sig', body: '{"ok":true}' }));
		expect(noop.status).toBe(200);
		const addon = await adminDb.collection('users').doc('u1').collection('addons').doc('pi_noop').get();
		expect(addon.exists).toBe(false);
	});

	it('returns 500 and marks outcome errored when processing throws', async () => {
		vi.resetModules();

		const db = new FakeFirestore();
		const adminDb: any = Object.assign(db, { app: { options: { projectId: 'p', storageBucket: 'b' } } });

		const stripe = {
			webhooks: {
				constructEvent: () => ({
					id: 'evt_err',
					type: 'checkout.session.completed',
					data: { object: { id: 'cs_err', mode: 'subscription', subscription: 'sub_err', customer: 'cus_1', metadata: { firebaseUid: 'u1', plan: 'starter' } } }
				})
			},
			subscriptions: {
				retrieve: vi.fn(async () => {
					throw new Error('stripe retrieve failed');
				})
			}
		};

		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
		vi.doMock('$env/dynamic/private', () => ({ env: { STRIPE_WEBHOOK_SECRET: 'whsec' } }));
		vi.doMock('$lib/server/billing', () => ({
			getStripeClient: () => stripe,
			getPlanKeyByPrice: vi.fn(() => null),
			buildFeatureCapabilities: vi.fn(() => ({})),
			getRefreshDate: vi.fn(() => 0),
			updateUserFeatureCapabilities: vi.fn(async () => {})
		}));

		const { POST } = await import('../../../src/routes/api/public/billing/webhook/+server');
		const res = await POST(makeEvent({ signature: 'sig', body: '{"ok":true}' }));
		expect(res.status).toBe(500);
		expect((await res.json()).error.code).toBe('STRIPE_WEBHOOK_PROCESSING_FAILED');

		const log = await adminDb.collection('webhookEvents').doc('evt_err').get();
		expect(log.get('outcome')).toBe('errored');
	});
});
