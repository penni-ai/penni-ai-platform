import { describe, expect, it, vi } from 'vitest';

describe('routes/(app)/my-account/billing load', () => {
	it('returns checkoutSuccess false when no session_id', async () => {
		vi.resetModules();

		vi.doMock('$app/environment', () => ({ browser: false }));
		vi.doMock('$app/navigation', () => ({ invalidateAll: vi.fn() }));

		const { load } = await import('../../../src/routes/(app)/my-account/billing/+page');

		const depends = vi.fn();
		const url = new URL('http://localhost/my-account/billing');
		const result = await load({ url, depends } as any);

		expect(depends).toHaveBeenCalledWith('app:billing');
		expect(result).toEqual({ checkoutSuccess: false });
	});

	it('cleans URL and invalidates when returning from checkout (browser)', async () => {
		vi.resetModules();
		vi.useFakeTimers();

		const invalidateAll = vi.fn();
		vi.doMock('$app/environment', () => ({ browser: true }));
		vi.doMock('$app/navigation', () => ({ invalidateAll }));

		(globalThis as any).history = { replaceState: vi.fn() };

		const { load } = await import('../../../src/routes/(app)/my-account/billing/+page');

		const depends = vi.fn();
		const url = new URL('http://localhost/my-account/billing?session_id=sess_123');
		const result = await load({ url, depends } as any);

		expect(result.checkoutSuccess).toBe(true);
		expect((globalThis as any).history.replaceState).toHaveBeenCalledWith(null, '', '/my-account/billing');

		await vi.advanceTimersByTimeAsync(1500);
		expect(invalidateAll).toHaveBeenCalled();
		vi.useRealTimers();
	});
});

