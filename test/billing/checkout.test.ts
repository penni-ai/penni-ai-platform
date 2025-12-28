import { describe, expect, it, vi } from 'vitest';

function setWindowLocation(pathname: string) {
	(globalThis as any).window = {
		location: { pathname, href: '' }
	};
}

describe('billing/checkout startCheckout', () => {
	it('redirects to sign-in on 401', async () => {
		vi.resetModules();
		const invalidateAll = vi.fn(async () => {});
		vi.doMock('$app/navigation', () => ({ invalidateAll }));

		setWindowLocation('/pricing');
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({}), { status: 401, headers: { 'content-type': 'application/json' } }))
		);

		const { startCheckout } = await import('../../src/lib/billing/checkout');
		const result = await startCheckout({ plan: 'starter' });

		expect(result.type).toBe('error');
		expect((globalThis as any).window.location.href).toContain('/sign-in?redirectTo=');
		expect(invalidateAll).not.toHaveBeenCalled();
	});

	it('returns error payload on non-OK responses', async () => {
		vi.resetModules();
		vi.doMock('$app/navigation', () => ({ invalidateAll: vi.fn(async () => {}) }));

		const onError = vi.fn();
		setWindowLocation('/pricing');
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ error: 'bad request' }), { status: 400, headers: { 'content-type': 'application/json' } }))
		);

		const { startCheckout } = await import('../../src/lib/billing/checkout');
		const result = await startCheckout({ plan: 'starter', onError });

		expect(result).toEqual({ type: 'error', message: 'bad request' });
		expect(onError).toHaveBeenCalledWith('bad request');
	});

	it('handles updated-without-checkout flow', async () => {
		vi.resetModules();
		const invalidateAll = vi.fn(async () => {});
		vi.doMock('$app/navigation', () => ({ invalidateAll }));

		const onUpdated = vi.fn(async () => {});
		setWindowLocation('/pricing');
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ status: 'updated', plan: 'growth' }), { status: 200, headers: { 'content-type': 'application/json' } }))
		);

		const { startCheckout } = await import('../../src/lib/billing/checkout');
		const result = await startCheckout({ plan: 'growth', onUpdated });

		expect(result.type).toBe('updated');
		expect(invalidateAll).toHaveBeenCalledTimes(1);
		expect(onUpdated).toHaveBeenCalledTimes(1);
	});

	it('returns redirect when checkout url is present', async () => {
		vi.resetModules();
		vi.doMock('$app/navigation', () => ({ invalidateAll: vi.fn(async () => {}) }));

		const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ url: 'https://stripe.test/checkout' }), { status: 200, headers: { 'content-type': 'application/json' } }));
		setWindowLocation('/pricing');
		vi.stubGlobal('fetch', fetchSpy as any);

		const { startCheckout } = await import('../../src/lib/billing/checkout');
		const result = await startCheckout({ plan: 'starter', returnUrl: 'https://return.test' });

		expect(result).toEqual({ type: 'redirect', url: 'https://stripe.test/checkout' });
		expect(fetchSpy).toHaveBeenCalledWith(
			'/api/billing/checkout',
			expect.objectContaining({
				body: JSON.stringify({ plan: 'starter', returnUrl: 'https://return.test' })
			})
		);
	});

	it('handles missing url gracefully', async () => {
		vi.resetModules();
		vi.doMock('$app/navigation', () => ({ invalidateAll: vi.fn(async () => {}) }));

		const onError = vi.fn();
		setWindowLocation('/pricing');
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } }))
		);

		const { startCheckout } = await import('../../src/lib/billing/checkout');
		const result = await startCheckout({ plan: 'starter', onError });

		expect(result.type).toBe('error');
		expect(onError).toHaveBeenCalled();
	});

	it('returns error on thrown exceptions', async () => {
		vi.resetModules();
		vi.doMock('$app/navigation', () => ({ invalidateAll: vi.fn(async () => {}) }));

		const onError = vi.fn();
		setWindowLocation('/pricing');
		vi.stubGlobal('fetch', vi.fn(async () => {
			throw new Error('network');
		}));

		const { startCheckout } = await import('../../src/lib/billing/checkout');
		const result = await startCheckout({ plan: 'starter', onError });

		expect(result.type).toBe('error');
		expect(onError).toHaveBeenCalledWith('network');
	});
});
