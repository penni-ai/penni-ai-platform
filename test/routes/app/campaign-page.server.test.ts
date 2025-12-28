import { describe, expect, it, vi } from 'vitest';

describe('routes/(app)/campaign/[id] load', () => {
	it('validates required params and auth', async () => {
		vi.resetModules();

		const { load } = await import('../../../src/routes/(app)/campaign/[id]/+page.server');

		await expect(load({ params: { id: '' }, locals: { user: { uid: 'u1' } } } as any)).rejects.toMatchObject({
			status: 400
		});

		await expect(load({ params: { id: 'c1' }, locals: { user: null } } as any)).rejects.toMatchObject({
			status: 401
		});
	});

	it('redirects to dashboard when campaign does not exist', async () => {
		vi.resetModules();

		const campaignDocRef = vi.fn(() => ({ get: vi.fn(async () => ({ exists: false })) }));
		vi.doMock('$lib/server/core', () => ({ campaignDocRef }));
		vi.doMock('$lib/server/campaigns', () => ({ serializeCampaignRecord: vi.fn() }));

		const { load } = await import('../../../src/routes/(app)/campaign/[id]/+page.server');

		await expect(load({ params: { id: 'c_missing' }, locals: { user: { uid: 'u1' } } } as any)).rejects.toMatchObject({
			status: 302,
			location: '/dashboard'
		});
	});

	it('loads campaign record', async () => {
		vi.resetModules();

		const campaignDocRef = vi.fn(() => ({
			get: vi.fn(async () => ({ exists: true, id: 'c1', data: () => ({ title: 'T' }) }))
		}));
		const serializeCampaignRecord = vi.fn(async (data: any, id: string) => ({ id, title: data.title }));
		vi.doMock('$lib/server/core', () => ({ campaignDocRef }));
		vi.doMock('$lib/server/campaigns', () => ({ serializeCampaignRecord }));

		const { load } = await import('../../../src/routes/(app)/campaign/[id]/+page.server');
		const result = await load({ params: { id: 'c1' }, locals: { user: { uid: 'u1' } } } as any);

		expect(result).toEqual({ campaign: { id: 'c1', title: 'T' } });
	});

	it('returns 500 when load times out', async () => {
		vi.resetModules();
		vi.useFakeTimers();

		const campaignDocRef = vi.fn(() => ({ get: vi.fn(() => new Promise(() => {})) }));
		vi.doMock('$lib/server/core', () => ({ campaignDocRef }));
		vi.doMock('$lib/server/campaigns', () => ({ serializeCampaignRecord: vi.fn() }));

		const { load } = await import('../../../src/routes/(app)/campaign/[id]/+page.server');

		const pending = load({ params: { id: 'c1' }, locals: { user: { uid: 'u1' } } } as any);
		const rejected = expect(pending).rejects.toMatchObject({ status: 500 });
		await vi.advanceTimersByTimeAsync(8000);
		await rejected;
		vi.useRealTimers();
	});
});
