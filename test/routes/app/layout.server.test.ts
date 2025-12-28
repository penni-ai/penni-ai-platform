import { describe, expect, it, vi } from 'vitest';

function makeLogger() {
	return {
		warn: vi.fn(),
		child: vi.fn(function child() {
			return makeLogger();
		})
	};
}

describe('routes/(app)/+layout.server load', () => {
	it('redirects to sign-in when user missing', async () => {
		vi.resetModules();

		const { load } = await import('../../../src/routes/(app)/+layout.server');
		await expect(load({ locals: { user: null } } as any)).rejects.toMatchObject({
			status: 303,
			location: '/sign-in'
		});
	});

	it('returns sorted sidebar campaigns and plan/capabilities when available', async () => {
		vi.resetModules();

		const docs = [
			{ id: 'c_old', data: () => ({ updatedAt: 1 }) },
			{ id: 'c_new', data: () => ({ updatedAt: 2 }) }
		];

		const campaignsGet = vi.fn(async () => ({ docs }));
		const userGet = vi.fn(async () => ({
			data: () => ({
				currentPlan: { planKey: 'starter' },
				onboarding: { tutorialCompleted: true }
			})
		}));

		const userDocRef = vi.fn(() => ({
			collection: vi.fn(() => ({ limit: vi.fn(() => ({ get: campaignsGet })) })),
			get: userGet
		}));

		const serializeCampaignSnapshot = vi.fn(async (doc: any) => ({
			id: doc.id,
			updatedAt: doc.data().updatedAt
		}));

		const getUserFeatureCapabilities = vi.fn(async () => ({ outreach: true }));

		vi.doMock('$lib/server/core', () => ({ userDocRef }));
		vi.doMock('$lib/server/campaigns', () => ({ serializeCampaignSnapshot }));
		vi.doMock('$lib/server/billing/feature-capabilities', () => ({ getUserFeatureCapabilities }));

		const { load } = await import('../../../src/routes/(app)/+layout.server');

		const result = await load({
			locals: { user: { uid: 'u1', email: 'u1@example.com' }, logger: makeLogger() }
		} as any);

		expect(serializeCampaignSnapshot).toHaveBeenCalledTimes(2);
		expect(result.campaigns.map((c) => c.id)).toEqual(['c_new', 'c_old']);
		expect(result.user).toEqual({
			uid: 'u1',
			email: 'u1@example.com',
			currentPlan: { planKey: 'starter' },
			capabilities: { outreach: true }
		});
		expect(result.onboardingCompleted).toBe(true);
	});

	it('falls back when campaign list times out and logs non-fatal errors', async () => {
		vi.resetModules();
		vi.useFakeTimers();

		const campaignsGet = vi.fn(() => new Promise(() => {}));
		const userGet = vi.fn(async () => ({ data: () => ({ onboarding: { tutorialSkipped: true } }) }));
		const userDocRef = vi.fn(() => ({
			collection: vi.fn(() => ({ limit: vi.fn(() => ({ get: campaignsGet })) })),
			get: userGet
		}));

		const serializeCampaignSnapshot = vi.fn();
		const getUserFeatureCapabilities = vi.fn(() => {
			throw new Error('capabilities unavailable');
		});

		const logger = makeLogger();
		vi.doMock('$lib/server/core', () => ({ userDocRef }));
		vi.doMock('$lib/server/campaigns', () => ({ serializeCampaignSnapshot }));
		vi.doMock('$lib/server/billing/feature-capabilities', () => ({ getUserFeatureCapabilities }));

		const { load } = await import('../../../src/routes/(app)/+layout.server');

		const pending = load({
			locals: { user: { uid: 'u1', email: null }, logger }
		} as any);

		await vi.advanceTimersByTimeAsync(5000);
		const result = await pending;

		expect(result.campaigns).toEqual([]);
		expect(serializeCampaignSnapshot).not.toHaveBeenCalled();
		expect(result.user.email).toBeNull();
		expect(result.user.capabilities).toBeNull();
		expect(result.onboardingCompleted).toBe(true);
		expect(logger.warn).toHaveBeenCalled();
		vi.useRealTimers();
	});

	it('handles rejected sidebar campaign queries (withTimeout catch path)', async () => {
		vi.resetModules();

		const campaignsGet = vi.fn(async () => {
			throw new Error('campaigns boom');
		});
		const userGet = vi.fn(async () => ({ data: () => ({}) }));
		const userDocRef = vi.fn(() => ({
			collection: vi.fn(() => ({ limit: vi.fn(() => ({ get: campaignsGet })) })),
			get: userGet
		}));

		vi.doMock('$lib/server/core', () => ({ userDocRef }));
		vi.doMock('$lib/server/campaigns', () => ({ serializeCampaignSnapshot: vi.fn() }));
		vi.doMock('$lib/server/billing/feature-capabilities', () => ({ getUserFeatureCapabilities: vi.fn(async () => null) }));

		const logger = makeLogger();
		const { load } = await import('../../../src/routes/(app)/+layout.server');
		const result = await load({ locals: { user: { uid: 'u1', email: null }, logger } } as any);
		expect(result.campaigns).toEqual([]);
		expect(logger.warn).toHaveBeenCalledWith('Failed to load sidebar campaigns', expect.any(Object));
	});
});
