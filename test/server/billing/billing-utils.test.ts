import { describe, expect, it, vi } from 'vitest';

describe('server/billing/billing-utils', () => {
	it('getRefreshDate returns first day of next month', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-01-15T12:00:00Z'));
		const { getRefreshDate } = await import('../../../src/lib/server/billing/billing-utils');

		const ts = getRefreshDate();
		expect(ts).toBe(new Date(2025, 1, 1).getTime());

		vi.useRealTimers();
	});

	it('buildFeatureCapabilities defaults to free plan limits', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
		const { buildFeatureCapabilities } = await import('../../../src/lib/server/billing/billing-utils');

		const caps = buildFeatureCapabilities(null);
		expect(caps.planKey).toBe('free');
		expect(caps.outreach).toBe(true);
		expect(caps.search).toBe(true);
		expect(caps.updatedAt).toBe(Date.now());

		vi.useRealTimers();
	});

	it('buildEntitlements returns undefined when missing or unknown plan', async () => {
		const { buildEntitlements } = await import('../../../src/lib/server/billing/billing-utils');
		expect(buildEntitlements(undefined)).toBeUndefined();
		expect(buildEntitlements('not-a-plan' as any)).toBeUndefined();
	});

	it('buildEntitlements returns plan limits', async () => {
		const { buildEntitlements } = await import('../../../src/lib/server/billing/billing-utils');
		const ent = buildEntitlements('starter');
		expect(ent?.connectedInboxes).toBeGreaterThan(0);
		expect(ent?.maxProfiles).toBeGreaterThan(0);
	});
});
