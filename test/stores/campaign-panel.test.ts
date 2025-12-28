import { describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

describe('stores/campaign-panel', () => {
	it('requestCreate sets isCreating and opens on success', async () => {
		vi.resetModules();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ campaignId: 'c1' }), { status: 200 }))
		);

		const { campaignPanel } = await import('../../src/lib/stores/campaign-panel');
		expect(get(campaignPanel as any).isOpen).toBe(false);

		const promise = campaignPanel.requestCreate();
		expect(get(campaignPanel as any).isCreating).toBe(true);

		const id = await promise;
		expect(id).toBe('c1');
		expect(get(campaignPanel as any)).toEqual({ isOpen: true, campaignId: 'c1', isCreating: false });
	});

	it('requestCreate resets isCreating on failure', async () => {
		vi.resetModules();
		vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({}), { status: 500 })));

		const { campaignPanel } = await import('../../src/lib/stores/campaign-panel');
		await expect(campaignPanel.requestCreate()).rejects.toThrow(/Failed to create campaign/);
		expect(get(campaignPanel as any).isCreating).toBe(false);
	});

	it('requestCreate throws when response is missing campaignId', async () => {
		vi.resetModules();
		vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));

		const { campaignPanel } = await import('../../src/lib/stores/campaign-panel');
		await expect(campaignPanel.requestCreate()).rejects.toThrow(/No campaign ID returned/);
		expect(get(campaignPanel as any).isCreating).toBe(false);
	});

	it('open/close update state and get returns snapshot', async () => {
		vi.resetModules();
		vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ campaignId: 'c1' }), { status: 200 })));

		const { campaignPanel } = await import('../../src/lib/stores/campaign-panel');

		campaignPanel.open('c2');
		expect(get(campaignPanel as any)).toEqual({ isOpen: true, campaignId: 'c2', isCreating: false });
		expect(campaignPanel.get()).toEqual({ isOpen: true, campaignId: 'c2', isCreating: false });

		campaignPanel.close();
		expect(get(campaignPanel as any)).toEqual({ isOpen: false, campaignId: null, isCreating: false });
	});
});
