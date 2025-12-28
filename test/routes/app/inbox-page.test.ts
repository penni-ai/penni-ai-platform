import { describe, expect, it, vi } from 'vitest';

describe('routes/(app)/inbox loads', () => {
	it('server load returns empty when signed out', async () => {
		vi.resetModules();

		vi.doMock('$lib/server/email-queue/queue-service', () => ({
			getUserEmailQueue: vi.fn(),
			getQueueStats: vi.fn()
		}));

		const { load } = await import('../../../src/routes/(app)/inbox/+page.server');
		const result = await load({ locals: { user: null } } as any);
		expect(result.outreachEmails).toEqual([]);
		expect(result.outreachStats.total).toBe(0);
	});

	it('server load returns queue data and stats', async () => {
		vi.resetModules();

		const getUserEmailQueue = vi.fn(async () => [{ id: 'q1' }]);
		const getQueueStats = vi.fn(async () => ({
			queued: 1,
			processing: 0,
			sent: 0,
			failed: 0,
			cancelled: 0,
			total: 1
		}));

		vi.doMock('$lib/server/email-queue/queue-service', () => ({
			getUserEmailQueue,
			getQueueStats
		}));

		const { load } = await import('../../../src/routes/(app)/inbox/+page.server');
		const result = await load({ locals: { user: { uid: 'u1' } } } as any);

		expect(getUserEmailQueue).toHaveBeenCalledWith('u1', { limit: 200 });
		expect(result.outreachEmails).toEqual([{ id: 'q1' }]);
		expect(result.outreachStats.total).toBe(1);
	});

	it('server load handles failures gracefully', async () => {
		vi.resetModules();

		vi.doMock('$lib/server/email-queue/queue-service', () => ({
			getUserEmailQueue: vi.fn(async () => {
				throw new Error('boom');
			}),
			getQueueStats: vi.fn()
		}));

		const { load } = await import('../../../src/routes/(app)/inbox/+page.server');
		const result = await load({ locals: { user: { uid: 'u1' } } } as any);
		expect(result.outreachEmails).toEqual([]);
		expect(result.outreachStats.total).toBe(0);
	});

	it('client load merges server data into view model', async () => {
		vi.resetModules();

		const { load } = await import('../../../src/routes/(app)/inbox/+page');
		const result = await load({
			data: {
				outreachEmails: [{ id: 'q1' }],
				outreachStats: { queued: 1, processing: 0, sent: 0, failed: 0, cancelled: 0, total: 1 }
			}
		} as any);

		expect(result.threads).toHaveLength(2);
		expect(result.outreachEmails).toEqual([{ id: 'q1' }]);
		expect(result.outreachStats.total).toBe(1);
	});
});

