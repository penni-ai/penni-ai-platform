import { describe, expect, it, vi } from 'vitest';

function makeEvent(options: { uid?: string; email?: string | null; origin?: string }) {
	const url = new URL('http://localhost/api/billing/portal');
	const email = options.email !== undefined ? options.email : 'u@test.com';
	return {
		locals: {
			user: options.uid ? ({ uid: options.uid, email } as any) : null,
			requestId: 'req_test'
		},
		params: {},
		request: new Request(url.toString(), {
			method: 'POST',
			headers: { origin: options.origin ?? url.origin, 'content-type': 'application/json' },
			body: JSON.stringify({})
		}),
		url
	} as any;
}

describe('routes/api/billing/portal POST', () => {
	it('requires verified email', async () => {
		vi.resetModules();
		vi.doMock('$lib/server/billing', () => ({
			getOrCreateStripeCustomer: vi.fn(),
			getStripeClient: vi.fn()
		}));

		const { POST } = await import('../../../src/routes/api/billing/portal/+server');
		const res = await POST(makeEvent({ uid: 'u1', email: null }));
		expect(res.status).toBe(400);
		expect((await res.json()).error.code).toBe('USER_EMAIL_REQUIRED');
	});

	it('creates a portal session and returns URL', async () => {
		vi.resetModules();

		const sessionsCreate = vi.fn(async () => ({ url: 'https://stripe.test/portal' }));
		vi.doMock('$lib/server/billing', () => ({
			getOrCreateStripeCustomer: vi.fn(async () => ({ id: 'cus_1' })),
			getStripeClient: vi.fn(() => ({ billingPortal: { sessions: { create: sessionsCreate } } }))
		}));

		const { POST } = await import('../../../src/routes/api/billing/portal/+server');
		const res = await POST(makeEvent({ uid: 'u1', email: 'u1@example.com' }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ url: 'https://stripe.test/portal' });
		expect(sessionsCreate).toHaveBeenCalledWith({ customer: 'cus_1', return_url: 'http://localhost/my-account/billing' });
	});

	it('falls back to request origin when PUBLIC_SITE_URL is blank', async () => {
		vi.resetModules();

		const prev = process.env.PUBLIC_SITE_URL;
		process.env.PUBLIC_SITE_URL = '';

		const sessionsCreate = vi.fn(async () => ({ url: 'https://stripe.test/portal' }));
		vi.doMock('$lib/server/billing', () => ({
			getOrCreateStripeCustomer: vi.fn(async () => ({ id: 'cus_1' })),
			getStripeClient: vi.fn(() => ({ billingPortal: { sessions: { create: sessionsCreate } } }))
		}));

		const { POST } = await import('../../../src/routes/api/billing/portal/+server');
		await POST(makeEvent({ uid: 'u1', email: 'u1@example.com' }));
		expect(sessionsCreate).toHaveBeenCalledWith({ customer: 'cus_1', return_url: 'http://localhost/my-account/billing' });

		process.env.PUBLIC_SITE_URL = prev;
	});

	it('returns 502 when Stripe portal URL missing or Stripe errors', async () => {
		vi.resetModules();

		vi.doMock('$lib/server/billing', () => ({
			getOrCreateStripeCustomer: vi.fn(async () => ({ id: 'cus_1' })),
			getStripeClient: vi.fn(() => ({ billingPortal: { sessions: { create: vi.fn(async () => ({ url: null })) } } }))
		}));

		const { POST } = await import('../../../src/routes/api/billing/portal/+server');
		const missingUrl = await POST(makeEvent({ uid: 'u1', email: 'u1@example.com' }));
		expect(missingUrl.status).toBe(502);
		expect((await missingUrl.json()).error.code).toBe('STRIPE_PORTAL_URL_MISSING');

		vi.resetModules();
		vi.doMock('$lib/server/billing', () => ({
			getOrCreateStripeCustomer: vi.fn(async () => ({ id: 'cus_1' })),
			getStripeClient: vi.fn(() => {
				throw new Error('stripe down');
			})
		}));
		const { POST: POST2 } = await import('../../../src/routes/api/billing/portal/+server');
		const failure = await POST2(makeEvent({ uid: 'u1', email: 'u1@example.com' }));
		expect(failure.status).toBe(502);
		expect((await failure.json()).error.code).toBe('STRIPE_PORTAL_FAILED');
	});
});
