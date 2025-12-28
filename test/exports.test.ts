import { describe, expect, it, vi } from 'vitest';

describe('barrel exports', () => {
	it('imports server-side barrel modules', async () => {
		await import('../src/lib/server/core');
		await import('../src/lib/server/chat');
		await import('../src/lib/server/billing');
		await import('../src/lib/server/firebase');
		await import('../src/lib/server/gmail');
		await import('../src/lib/server/usage');
		await import('../src/lib/server/email-queue');
	});

	it('imports billing component barrel with mocked svelte components', async () => {
		vi.resetModules();
		vi.doMock('../src/lib/components/billing/PlanCard.svelte', () => ({ default: {} }));
		vi.doMock('../src/lib/components/billing/UpgradeModal.svelte', () => ({ default: {} }));

		const mod = await import('../src/lib/components/billing');
		expect(mod.PlanCard).toBeDefined();
		expect(mod.UpgradeModal).toBeDefined();
	});
});

