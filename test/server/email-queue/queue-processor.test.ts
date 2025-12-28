import { describe, expect, it, vi } from 'vitest';

import { FakeFirestore } from '../../helpers/fake-firebase';

function seedCoreFirestore(firestore: FakeFirestore, options?: { throwConnectionsForUid?: string }) {
	vi.doMock('../../../src/lib/server/core/firestore', () => ({
		firestore,
		emailQueueCollectionRef: (uid: string) => firestore.collection('users').doc(uid).collection('emailQueue'),
		gmailConnectionsCollectionRef: (uid: string) => {
			if (options?.throwConnectionsForUid && uid === options.throwConnectionsForUid) {
				return { get: async () => { throw new Error('connections failed'); } } as any;
			}
			return firestore.collection('users').doc(uid).collection('gmailConnections');
		}
	}));
}

describe('server/email-queue/queue-processor', () => {
	it('processUserInboxQueue skips when no capacity and returns early on empty queue', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore();
		seedCoreFirestore(firestore);

		const getDailyInboxUsage = vi.fn(async () => ({ remaining: 0 }));
		const getReadyQueuedEmails = vi.fn(async () => [{ id: 'q1', to: 'a@test.com' }]);
		const processQueuedEmail = vi.fn(async () => ({ success: true }));

		vi.doMock('../../../src/lib/server/usage/daily-inbox-usage', () => ({
			getDailyInboxUsage,
			DAILY_INBOX_LIMIT: 100
		}));
		vi.doMock('../../../src/lib/server/email-queue/queue-service', () => ({
			getReadyQueuedEmails,
			processQueuedEmail
		}));

		const mod = await import('../../../src/lib/server/email-queue/queue-processor');
		const res = await mod.processUserInboxQueue('u1', 'c1');
		expect(res.processed).toBe(0);
		expect(getReadyQueuedEmails).not.toHaveBeenCalled();

		getDailyInboxUsage.mockResolvedValueOnce({ remaining: 5 });
		getReadyQueuedEmails.mockResolvedValueOnce([]);
		const empty = await mod.processUserInboxQueue('u1', 'c1');
		expect(empty.processed).toBe(0);
	});

	it('processUserInboxQueue processes sequentially, rate limits, and aggregates failures', async () => {
		vi.resetModules();
		vi.useFakeTimers();

		const firestore = new FakeFirestore();
		seedCoreFirestore(firestore);

		vi.doMock('../../../src/lib/server/usage/daily-inbox-usage', () => ({
			getDailyInboxUsage: vi.fn(async () => ({ remaining: 10 })),
			DAILY_INBOX_LIMIT: 100
		}));
		vi.doMock('../../../src/lib/server/email-queue/queue-service', () => ({
			getReadyQueuedEmails: vi.fn(async () => [
				{ id: 'q1', to: 'a@test.com' },
				{ id: 'q2', to: 'b@test.com' }
			]),
			processQueuedEmail: vi
				.fn()
				.mockResolvedValueOnce({ success: true })
				.mockResolvedValueOnce({ success: false, error: 'smtp' })
		}));

		const mod = await import('../../../src/lib/server/email-queue/queue-processor');
		const promise = mod.processUserInboxQueue('u1', 'c1');
		await vi.runAllTimersAsync();
		const res = await promise;

		expect(res.processed).toBe(2);
		expect(res.succeeded).toBe(1);
		expect(res.failed).toBe(1);
		expect(res.errors).toEqual(['b@test.com: smtp']);

		vi.useRealTimers();
	});

	it('processUserInboxQueue records thrown processing errors per email', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore();
		seedCoreFirestore(firestore);

		vi.doMock('../../../src/lib/server/usage/daily-inbox-usage', () => ({
			getDailyInboxUsage: vi.fn(async () => ({ remaining: 1 })),
			DAILY_INBOX_LIMIT: 100
		}));
		vi.doMock('../../../src/lib/server/email-queue/queue-service', () => ({
			getReadyQueuedEmails: vi.fn(async () => [{ id: 'q1', to: 'x@test.com' }]),
			processQueuedEmail: vi.fn(async () => {
				throw new Error('boom');
			})
		}));

		const mod = await import('../../../src/lib/server/email-queue/queue-processor');
		const res = await mod.processUserInboxQueue('u1', 'c1');
		expect(res.processed).toBe(1);
		expect(res.failed).toBe(1);
		expect(res.errors[0]).toContain('x@test.com: boom');
	});

	it('processUserInboxQueue captures top-level processing errors', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore();
		seedCoreFirestore(firestore);

		vi.doMock('../../../src/lib/server/usage/daily-inbox-usage', () => ({
			getDailyInboxUsage: vi.fn(async () => {
				throw new Error('usage down');
			}),
			DAILY_INBOX_LIMIT: 100
		}));
		vi.doMock('../../../src/lib/server/email-queue/queue-service', () => ({
			getReadyQueuedEmails: vi.fn(),
			processQueuedEmail: vi.fn()
		}));

		const mod = await import('../../../src/lib/server/email-queue/queue-processor');
		const res = await mod.processUserInboxQueue('u1', 'c1');
		expect(res.errors).toEqual(['Processing error: usage down']);
	});

	it('processUserQueue returns per-connection results', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({
			'users/u1/gmailConnections/c1': {},
			'users/u1/gmailConnections/c2': {}
		});
		seedCoreFirestore(firestore);

		vi.doMock('../../../src/lib/server/usage/daily-inbox-usage', () => ({
			getDailyInboxUsage: vi.fn(async () => ({ remaining: 0 })),
			DAILY_INBOX_LIMIT: 100
		}));
		vi.doMock('../../../src/lib/server/email-queue/queue-service', () => ({
			getReadyQueuedEmails: vi.fn(async () => []),
			processQueuedEmail: vi.fn()
		}));

		const mod = await import('../../../src/lib/server/email-queue/queue-processor');
		const results = await mod.processUserQueue('u1');
		expect(results.map((r) => r.connectionId).sort()).toEqual(['c1', 'c2']);
	});

	it('processUserQueue returns [] when user has no connections', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore();
		seedCoreFirestore(firestore);

		vi.doMock('../../../src/lib/server/usage/daily-inbox-usage', () => ({
			getDailyInboxUsage: vi.fn(async () => ({ remaining: 0 })),
			DAILY_INBOX_LIMIT: 100
		}));
		vi.doMock('../../../src/lib/server/email-queue/queue-service', () => ({
			getReadyQueuedEmails: vi.fn(async () => []),
			processQueuedEmail: vi.fn()
		}));

		const mod = await import('../../../src/lib/server/email-queue/queue-processor');
		expect(await mod.processUserQueue('u1')).toEqual([]);
	});

	it('findUsersWithQueuedEmails returns unique user IDs from collection group', async () => {
		vi.resetModules();

		const now = Date.now();
		const firestore = new FakeFirestore({
			'users/u1/emailQueue/q1': { status: 'queued', scheduledFor: now - 1 },
			'users/u1/emailQueue/q2': { status: 'queued', scheduledFor: now - 1 },
			'users/u2/emailQueue/q3': { status: 'queued', scheduledFor: now - 1 },
			'users/u3/emailQueue/q4': { status: 'queued', scheduledFor: now + 60_000 },
			'users/u4/emailQueue/q5': { status: 'processing', scheduledFor: now - 1 }
		});
		seedCoreFirestore(firestore);

		vi.doMock('../../../src/lib/server/usage/daily-inbox-usage', () => ({
			getDailyInboxUsage: vi.fn(async () => ({ remaining: 0 })),
			DAILY_INBOX_LIMIT: 100
		}));
		vi.doMock('../../../src/lib/server/email-queue/queue-service', () => ({
			getReadyQueuedEmails: vi.fn(async () => []),
			processQueuedEmail: vi.fn()
		}));

		const mod = await import('../../../src/lib/server/email-queue/queue-processor');
		const uids = await mod.findUsersWithQueuedEmails();
		expect(uids.sort()).toEqual(['u1', 'u2']);
	});

	it('processBatchQueue aggregates totals and continues on per-user errors', async () => {
		vi.resetModules();
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});

		const now = Date.now();
		const firestore = new FakeFirestore({
			'users/u1/emailQueue/q1': { status: 'queued', scheduledFor: now - 1 },
			'users/u1/gmailConnections/c1': {},
			'users/bad/emailQueue/q2': { status: 'queued', scheduledFor: now - 1 }
		});
		seedCoreFirestore(firestore, { throwConnectionsForUid: 'bad' });

		vi.doMock('../../../src/lib/server/usage/daily-inbox-usage', () => ({
			getDailyInboxUsage: vi.fn(async () => ({ remaining: 1 })),
			DAILY_INBOX_LIMIT: 100
		}));
		vi.doMock('../../../src/lib/server/email-queue/queue-service', () => ({
			getReadyQueuedEmails: vi.fn(async () => [{ id: 'q1', to: 'a@test.com' }]),
			processQueuedEmail: vi.fn(async () => ({ success: true }))
		}));

		const mod = await import('../../../src/lib/server/email-queue/queue-processor');
		const result = await mod.processBatchQueue();
		expect(result.totalProcessed).toBe(1);
		expect(result.totalSucceeded).toBe(1);
		expect(result.totalFailed).toBe(0);
		expect(result.results).toHaveLength(1);
	});

	it('processBatchQueue logs batch errors when queued user discovery fails', async () => {
		vi.resetModules();

		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

		const firestore = new FakeFirestore();
		(firestore as any).collectionGroup = () => {
			throw new Error('collectionGroup down');
		};
		seedCoreFirestore(firestore);

		vi.doMock('../../../src/lib/server/usage/daily-inbox-usage', () => ({
			getDailyInboxUsage: vi.fn(async () => ({ remaining: 0 })),
			DAILY_INBOX_LIMIT: 100
		}));
		vi.doMock('../../../src/lib/server/email-queue/queue-service', () => ({
			getReadyQueuedEmails: vi.fn(async () => []),
			processQueuedEmail: vi.fn()
		}));

		const mod = await import('../../../src/lib/server/email-queue/queue-processor');
		const result = await mod.processBatchQueue();
		expect(result.totalProcessed).toBe(0);
		expect(errorSpy).toHaveBeenCalledWith('[EmailQueue] Batch processing error:', expect.anything());

		errorSpy.mockRestore();
		logSpy.mockRestore();
	});

	it('getPendingQueueCount and getGlobalQueueStats reflect queued state', async () => {
		vi.resetModules();

		const now = Date.now();
		const firestore = new FakeFirestore({
			'users/u1/emailQueue/q1': { status: 'queued', scheduledFor: now - 1 },
			'users/u1/emailQueue/q2': { status: 'queued', scheduledFor: now + 60_000 },
			'users/u2/emailQueue/q3': { status: 'processing', scheduledFor: now - 1 }
		});
		seedCoreFirestore(firestore);

		vi.doMock('../../../src/lib/server/usage/daily-inbox-usage', () => ({
			getDailyInboxUsage: vi.fn(async () => ({ remaining: 0 })),
			DAILY_INBOX_LIMIT: 100
		}));
		vi.doMock('../../../src/lib/server/email-queue/queue-service', () => ({
			getReadyQueuedEmails: vi.fn(async () => []),
			processQueuedEmail: vi.fn()
		}));

		const mod = await import('../../../src/lib/server/email-queue/queue-processor');
		expect(await mod.getPendingQueueCount()).toBe(1);
		expect(await mod.getGlobalQueueStats()).toEqual({ queued: 2, processing: 1, readyToProcess: 1 });
	});
});
