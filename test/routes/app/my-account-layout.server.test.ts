import { describe, expect, it, vi } from 'vitest';

describe('routes/(app)/my-account/+layout.server load', () => {
	it('returns nulls when user missing', async () => {
		vi.resetModules();

		vi.doMock('$lib/server/core', () => ({ userDocRef: vi.fn() }));

		const { load } = await import('../../../src/routes/(app)/my-account/+layout.server');
		const result = await load({ locals: { user: null } } as any);
		expect(result.profile).toBeNull();
		expect(result.subscription).toBeNull();
		expect(result.userEmail).toBeNull();
	});

	it('loads subscription, credits, and usage rows (with fallback)', async () => {
		vi.resetModules();

		const userGet = vi.fn(async () => ({
			data: () => ({
				profile: { fullName: 'Maik', locale: 'en' },
				eventCredits: { influencersRemaining: 1 },
				currentPlan: { cancelAt: 123, scheduledPlanChange: 'growth', changeAt: 999, downgradeTo: 'starter' }
			})
		}));
		const subscriptionsGet = vi.fn(async () => ({
			docs: [
				{
					data: () => ({
						planKey: 'starter',
						status: 'active',
						currentPeriodEnd: 1700000000, // seconds
						trialEnd: 1700000000000, // ms
						cancelAtPeriodEnd: false,
						cancelAt: null
					})
				}
			]
		}));
		const usageGet = vi.fn(async () => ({
			docs: [
				{ id: 'm1', data: () => ({ metric: 'Emails sent', quantity: 3, recordedAt: 1700000000 }) },
				{ id: 'm2', data: () => ({ quantity: 'nope', recordedAt: '2025-01-01T00:00:00Z' }) },
				{ id: 'm3', data: () => ({ metric: 'Bad', quantity: 1 }) }
			]
		}));

		const userDocRef = vi.fn(() => ({
			get: userGet,
			collection: vi.fn((name: string) => {
				if (name === 'subscriptions') {
					return { orderBy: vi.fn(() => ({ limit: vi.fn(() => ({ get: subscriptionsGet })) })) };
				}
				if (name === 'usageMetrics') {
					return { orderBy: vi.fn(() => ({ limit: vi.fn(() => ({ get: usageGet })) })) };
				}
				throw new Error(`unexpected collection ${name}`);
			})
		}));
		vi.doMock('$lib/server/core', () => ({ userDocRef }));

		const { load } = await import('../../../src/routes/(app)/my-account/+layout.server');
		const result = await load({ locals: { user: { uid: 'u1', email: 'u1@example.com' } } } as any);

		expect(result.profile).toEqual({ full_name: 'Maik', locale: 'en' });
		expect(result.subscription?.planKey).toBe('starter');
		expect(result.subscription?.currentPeriodEnd).toMatch(/^20/);
		expect(result.subscription?.trialEnd).toMatch(/^20/);
		expect(result.eventCredits).toEqual({ influencersRemaining: 1 });
		expect(result.usage.length).toBe(2);
		expect(result.userEmail).toBe('u1@example.com');
	});

	it('falls back to mock usage when usage query fails', async () => {
		vi.resetModules();

		const usageGet = vi.fn(async () => {
			throw new Error('usage down');
		});

		const userDocRef = vi.fn(() => ({
			get: vi.fn(async () => ({ data: () => ({}) })),
			collection: vi.fn((name: string) => {
				if (name === 'subscriptions') {
					return { orderBy: vi.fn(() => ({ limit: vi.fn(() => ({ get: vi.fn(async () => ({ docs: [] })) })) })) };
				}
				if (name === 'usageMetrics') {
					return { orderBy: vi.fn(() => ({ limit: vi.fn(() => ({ get: usageGet })) })) };
				}
				throw new Error(`unexpected collection ${name}`);
			})
		}));
		vi.doMock('$lib/server/core', () => ({ userDocRef }));

		const { load } = await import('../../../src/routes/(app)/my-account/+layout.server');
		const result = await load({ locals: { user: { uid: 'u1', email: null } } } as any);

		expect(result.usage).toHaveLength(2);
		expect(result.usage[0].metric).toBeTruthy();
	});
});

