import crypto from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeFirestore } from './helpers/fake-firebase';

let db: FakeFirestore;

function parseStructuredLogCall(call: unknown[]): Record<string, any> | null {
	const first = call[0];
	if (typeof first !== 'string') return null;
	try {
		const parsed = JSON.parse(first);
		return parsed && typeof parsed === 'object' ? (parsed as Record<string, any>) : null;
	} catch {
		return null;
	}
}

function expectStructuredLogMessage(spy: ReturnType<typeof vi.spyOn>, message: string) {
	const matched = spy.mock.calls.some((call) => parseStructuredLogCall(call as unknown[])?.message === message);
	expect(matched).toBe(true);
}

function expectStructuredLogField(spy: ReturnType<typeof vi.spyOn>, message: string, key: string, value: unknown) {
	const matched = spy.mock.calls.some((call) => {
		const parsed = parseStructuredLogCall(call as unknown[]);
		return parsed?.message === message && parsed?.[key] === value;
	});
	expect(matched).toBe(true);
}

const gmailSend = vi.fn(async () => ({}));
const refreshAccessToken = vi.fn(async () => ({
	credentials: { access_token: 'access_refreshed', expiry_date: Date.now() + 3600 * 1000 }
}));

vi.mock('../dist/utils/firebase-admin.js', () => ({
	getFirestoreInstance: () => db
}));

vi.mock('googleapis', () => {
	class OAuth2 {
		setCredentials(_creds: any) {}
		async refreshAccessToken() {
			return refreshAccessToken();
		}
	}

	return {
		google: {
			auth: { OAuth2 },
			gmail: (_opts: any) => ({
				users: { messages: { send: (...args: any[]) => gmailSend(...args) } }
			})
		}
	};
});

function encryptRefreshToken(plaintext: string, base64Key: string) {
	const key = Buffer.from(base64Key, 'base64');
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
	const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return {
		refresh_token_encrypted: encrypted.toString('base64'),
		refresh_token_iv: iv.toString('base64'),
		refresh_token_tag: tag.toString('base64')
	};
}

describe('email-queue-cron (unit)', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		gmailSend.mockResolvedValue({});
		refreshAccessToken.mockResolvedValue({
			credentials: { access_token: 'access_refreshed', expiry_date: Date.now() + 3600 * 1000 }
		});

		db = new FakeFirestore();

		// 32-byte base64 key.
		process.env.GMAIL_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
		delete process.env.GMAIL_TOKEN_ENCRYPTION_KEY_PREVIOUS;
		process.env.GMAIL_OAUTH_CLIENT_ID = 'cid';
		process.env.GMAIL_OAUTH_CLIENT_SECRET = 'secret';

		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-01-15T12:00:00.000Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('exposes retry classification + AES decrypt helper', async () => {
		const { __test__ } = await import('../dist/handlers/email-queue-cron.js');

		expect(__test__.isRetryableError(new Error('Rate limit 429'))).toBe(true);
		expect(__test__.isRetryableError(new Error('Server error 500'))).toBe(true);
		expect(__test__.isRetryableError(new Error('timeout'))).toBe(true);
		expect(__test__.isRetryableError(new Error('Invalid 400'))).toBe(false);
		expect(__test__.isRetryableError(new Error('Permission 403'))).toBe(false);

		const key = process.env.GMAIL_TOKEN_ENCRYPTION_KEY!;
		const enc = encryptRefreshToken('rt_123', key);
		expect(__test__.decryptRefreshToken(enc.refresh_token_encrypted, enc.refresh_token_iv, enc.refresh_token_tag)).toBe(
			'rt_123'
		);
	});

	it('supports decrypting with previous key during rotation', async () => {
		vi.resetModules();
		const newKey = Buffer.alloc(32, 1).toString('base64');
		const oldKey = Buffer.alloc(32, 2).toString('base64');
		process.env.GMAIL_TOKEN_ENCRYPTION_KEY = newKey;
		process.env.GMAIL_TOKEN_ENCRYPTION_KEY_PREVIOUS = oldKey;

		const { __test__ } = await import('../dist/handlers/email-queue-cron.js');
		const enc = encryptRefreshToken('rt_prev', oldKey);
		expect(__test__.decryptRefreshToken(enc.refresh_token_encrypted, enc.refresh_token_iv, enc.refresh_token_tag)).toBe(
			'rt_prev'
		);
	});

	it('throws on missing/invalid encryption key', async () => {
		vi.resetModules();
		process.env.GMAIL_TOKEN_ENCRYPTION_KEY = '';
		const { __test__ } = await import('../dist/handlers/email-queue-cron.js');
		expect(() => __test__.decryptRefreshToken('a', 'b', 'c')).toThrow(/not configured/);

		vi.resetModules();
		// base64-encoded but wrong length (16 bytes).
		process.env.GMAIL_TOKEN_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString('base64');
		const { __test__: __test2 } = await import('../dist/handlers/email-queue-cron.js');
		expect(() => __test2.decryptRefreshToken('a', 'b', 'c')).toThrow(/32-byte/);
	});

	it('cleans up processed queue items older than retention window', async () => {
		const { __test__ } = await import('../dist/handlers/email-queue-cron.js');

		const now = Date.now();
		const thirtyOneDaysAgo = now - 31 * 24 * 60 * 60 * 1000;

		await db.collection('users').doc('user_1').collection('emailQueue').doc('old').set({
			id: 'old',
			status: 'sent',
			updatedAt: thirtyOneDaysAgo
		});

		await db.collection('users').doc('user_1').collection('emailQueue').doc('fresh').set({
			id: 'fresh',
			status: 'sent',
			updatedAt: now
		});

		const deleted = await __test__.cleanupOldQueueItemsGlobal(db as any, 30);
		expect(deleted).toBe(1);

		const oldSnap = await db.collection('users').doc('user_1').collection('emailQueue').doc('old').get();
		expect(oldSnap.exists).toBe(false);

		const freshSnap = await db.collection('users').doc('user_1').collection('emailQueue').doc('fresh').get();
		expect(freshSnap.exists).toBe(true);
	});

	it('tracks daily usage via incrementDailyUsage + getDailyInboxUsage', async () => {
		const { __test__ } = await import('../dist/handlers/email-queue-cron.js');

		await expect(__test__.getDailyInboxUsage(db as any, 'user_1', 'conn_1')).resolves.toEqual({
			sendCount: 0,
			remaining: 50
		});

		await __test__.incrementDailyUsage(db as any, 'user_1', 'conn_1', 2);
		await __test__.incrementDailyUsage(db as any, 'user_1', 'conn_1', 3);

		const usage = await __test__.getDailyInboxUsage(db as any, 'user_1', 'conn_1');
		expect(usage.sendCount).toBe(5);
		expect(usage.remaining).toBe(45);
	});

	it('resets monthly outreach usage when month changes', async () => {
		const { __test__ } = await import('../dist/handlers/email-queue-cron.js');

		const now = Date.now();
		await db.collection('users').doc('user_1').set({
			usage: {
				outreachSent: { month: '2024-12', count: 9, updatedAt: now - 1000 },
				influencersFound: { month: '2024-12', count: 0, updatedAt: now - 1000 }
			},
			updatedAt: now - 1000
		});

		await __test__.incrementMonthlyUsage(db as any, 'user_1', 2);

		const userSnap = await db.collection('users').doc('user_1').get();
		const usage = (userSnap.data() as any).usage;
		expect(usage.outreachSent.month).toBe('2025-01');
		expect(usage.outreachSent.count).toBe(2);
	});

	it('processEmailQueueBatch sends a queued email and updates contact + monthly usage', async () => {
		const { processEmailQueueBatch } = await import('../dist/handlers/email-queue-cron.js');

		const now = Date.now();
		const key = process.env.GMAIL_TOKEN_ENCRYPTION_KEY!;
		const enc = encryptRefreshToken('refresh_tok', key);

		await db.collection('users').doc('user_1').set({ usage: null, updatedAt: now });

		await db.collection('users').doc('user_1').collection('gmailConnections').doc('conn_1').set({
			email: 'sender@example.com',
			access_token: 'access_ok',
			expires_at: now + 60 * 60 * 1000,
			connected_at: now,
			primary: true,
			...enc
		});

		await db.collection('users').doc('user_1').collection('emailQueue').doc('q1').set({
			id: 'q1',
			campaignId: 'camp_1',
			influencerId: 'inf_1',
			influencerName: 'Influencer',
			to: 'to@example.com',
			subject: 'Hello',
			htmlBody: '<p>Hi</p>',
			senderConnectionId: 'conn_1',
			senderEmail: 'sender@example.com',
			status: 'queued',
			priority: 1,
			createdAt: now,
			scheduledFor: now - 1000,
			processedAt: null,
			sentAt: null,
			attempts: 0,
			maxAttempts: 3,
			lastError: null,
			lastAttemptAt: null,
			updatedAt: now
		});

		const result = await processEmailQueueBatch();
		expect(result.totalProcessed).toBe(1);
		expect(result.totalSucceeded).toBe(1);
		expect(result.totalFailed).toBe(0);
		expect(gmailSend).toHaveBeenCalledTimes(1);

		const queueSnap = await db.collection('users').doc('user_1').collection('emailQueue').doc('q1').get();
		const queue = queueSnap.data() as any;
		expect(queue.status).toBe('sent');
		expect(queue.sentAt).toBeTypeOf('number');

		const contactSnap = await db
			.collection('users')
			.doc('user_1')
			.collection('campaigns')
			.doc('camp_1')
			.collection('contacts')
			.doc('inf_1')
			.get();
		expect(contactSnap.exists).toBe(true);
		expect((contactSnap.data() as any).sendStatus).toBe('sent');

		const userSnap = await db.collection('users').doc('user_1').get();
		const usage = (userSnap.data() as any).usage;
		expect(usage?.outreachSent?.count).toBe(1);
	});

	it('processEmailQueueBatch handles claim failures and per-doc delay', async () => {
		const { processEmailQueueBatch } = await import('../dist/handlers/email-queue-cron.js');

		const now = Date.now();
		const key = process.env.GMAIL_TOKEN_ENCRYPTION_KEY!;
		const enc = encryptRefreshToken('refresh_tok', key);

		await db.collection('users').doc('user_1').set({ usage: {}, updatedAt: now });

		await db.collection('users').doc('user_1').collection('gmailConnections').doc('conn_1').set({
			email: 'sender@example.com',
			access_token: 'access_ok',
			expires_at: now + 60 * 60 * 1000,
			connected_at: now,
			primary: true,
			...enc
		});

		// Two queued emails so the per-doc delay path is exercised.
		for (const id of ['q1', 'q2']) {
			await db.collection('users').doc('user_1').collection('emailQueue').doc(id).set({
				id,
				campaignId: null,
				influencerId: null,
				influencerName: null,
				to: `${id}@example.com`,
				subject: 'Hello',
				htmlBody: '<p>Hi</p>',
				senderConnectionId: 'conn_1',
				senderEmail: 'sender@example.com',
				status: 'queued',
				priority: 1,
				createdAt: now,
				scheduledFor: now - 1000,
				processedAt: null,
				sentAt: null,
				attempts: 0,
				maxAttempts: 3,
				lastError: null,
				lastAttemptAt: null,
				updatedAt: now
			});
		}

		// Simulate contention: another worker claimed q1 after it was listed but before the claim tx reads it.
		const originalRunTransaction = db.runTransaction.bind(db);
		db.runTransaction = async (fn: any) => {
			// Flip q1 to non-queued so claim returns "invalid status" on first call.
			(db as any)._update('users/user_1/emailQueue/q1', { status: 'processing' });
			return originalRunTransaction(fn);
		};

		const promise = processEmailQueueBatch();
		await vi.advanceTimersByTimeAsync(200);
		const result = await promise;

		expect(result.totalProcessed).toBe(2);
		expect(result.totalFailed).toBeGreaterThanOrEqual(1);
	});

	it('surfaces an unexpected per-email processing exception via the outer loop catch', async () => {
		// Make Gmail send delete the queue doc before throwing so the retry/failed update itself throws.
		gmailSend.mockImplementationOnce(async () => {
			await db.collection('users').doc('user_1').collection('emailQueue').doc('q1').delete();
			throw new Error('Rate limit 429');
		});

		const { processEmailQueueBatch } = await import('../dist/handlers/email-queue-cron.js');

		const now = Date.now();
		const key = process.env.GMAIL_TOKEN_ENCRYPTION_KEY!;
		const enc = encryptRefreshToken('refresh_tok', key);

		await db.collection('users').doc('user_1').set({ usage: {}, updatedAt: now });

		await db.collection('users').doc('user_1').collection('gmailConnections').doc('conn_1').set({
			email: 'sender@example.com',
			access_token: 'access_ok',
			expires_at: now + 60 * 60 * 1000,
			connected_at: now,
			primary: true,
			...enc
		});

		await db.collection('users').doc('user_1').collection('emailQueue').doc('q1').set({
			id: 'q1',
			campaignId: null,
			influencerId: null,
			influencerName: null,
			to: 'to@example.com',
			subject: 'Hello',
			htmlBody: '<p>Hi</p>',
			senderConnectionId: 'conn_1',
			senderEmail: 'sender@example.com',
			status: 'queued',
			priority: 1,
			createdAt: now,
			scheduledFor: now - 1000,
			processedAt: null,
			sentAt: null,
			attempts: 0,
			maxAttempts: 3,
			lastError: null,
			lastAttemptAt: null,
			updatedAt: now
		});

		const result = await processEmailQueueBatch();
		expect(result.totalProcessed).toBe(1);
		expect(result.totalFailed).toBe(1);
	});

	it('covers empty per-connection queues and top-level batch error handling', async () => {
		const { processEmailQueueBatch } = await import('../dist/handlers/email-queue-cron.js');

		const now = Date.now();
		const key = process.env.GMAIL_TOKEN_ENCRYPTION_KEY!;
		const enc = encryptRefreshToken('refresh_tok', key);

		await db.collection('users').doc('user_1').set({ usage: {}, updatedAt: now });

		// One gmail connection, but queued email references a different senderConnectionId.
		await db.collection('users').doc('user_1').collection('gmailConnections').doc('conn_1').set({
			email: 'sender@example.com',
			access_token: 'access_ok',
			expires_at: now + 60 * 60 * 1000,
			connected_at: now,
			primary: true,
			...enc
		});

		await db.collection('users').doc('user_1').collection('emailQueue').doc('q1').set({
			id: 'q1',
			campaignId: null,
			influencerId: null,
			influencerName: null,
			to: 'to@example.com',
			subject: 'Hello',
			htmlBody: '<p>Hi</p>',
			senderConnectionId: 'conn_other',
			senderEmail: 'sender@example.com',
			status: 'queued',
			priority: 1,
			createdAt: now,
			scheduledFor: now - 1000,
			processedAt: null,
			sentAt: null,
			attempts: 0,
			maxAttempts: 3,
			lastError: null,
			lastAttemptAt: null,
			updatedAt: now
		});

		// Also hit the outermost catch by forcing collectionGroup to throw for this run.
		const originalCollectionGroup = db.collectionGroup.bind(db);
		(db as any).collectionGroup = () => {
			throw new Error('collectionGroup down');
		};

		const result = await processEmailQueueBatch();
		expect(result.totalProcessed).toBe(0);
		expect(result.totalFailed).toBe(0);

		(db as any).collectionGroup = originalCollectionGroup;
	});

	it('refreshes access token when expired and persists new token', async () => {
		const { processEmailQueueBatch, __test__ } = await import('../dist/handlers/email-queue-cron.js');

		const now = Date.now();
		const key = process.env.GMAIL_TOKEN_ENCRYPTION_KEY!;
		const enc = encryptRefreshToken('refresh_tok', key);

		await db.collection('users').doc('user_1').set({ usage: {}, updatedAt: now });

		await db.collection('users').doc('user_1').collection('gmailConnections').doc('conn_1').set({
			email: 'sender@example.com',
			access_token: 'access_old',
			expires_at: now - 60 * 1000,
			connected_at: now,
			primary: true,
			...enc
		});

		await db.collection('users').doc('user_1').collection('emailQueue').doc('q1').set({
			id: 'q1',
			campaignId: null,
			influencerId: null,
			influencerName: null,
			to: 'to@example.com',
			subject: 'Hello',
			htmlBody: '<p>Hi</p>',
			senderConnectionId: 'conn_1',
			senderEmail: 'sender@example.com',
			status: 'queued',
			priority: 1,
			createdAt: now,
			scheduledFor: now - 1000,
			processedAt: null,
			sentAt: null,
			attempts: 0,
			maxAttempts: 3,
			lastError: null,
			lastAttemptAt: null,
			updatedAt: now
		});

		await processEmailQueueBatch();
		expect(refreshAccessToken).toHaveBeenCalledTimes(1);

		const connSnap = await db.collection('users').doc('user_1').collection('gmailConnections').doc('conn_1').get();
		const conn = connSnap.data() as any;
		expect(conn.access_token).toBeUndefined();
		expect(conn.access_token_encrypted).toBeTruthy();
		expect(
			__test__.decryptRefreshToken(conn.access_token_encrypted, conn.access_token_iv, conn.access_token_tag)
		).toBe('access_refreshed');
		expect(conn.expires_at).toBeTypeOf('number');
	});

	it('marks email failed when token refresh yields no access_token', async () => {
		refreshAccessToken.mockResolvedValueOnce({ credentials: { expiry_date: Date.now() + 1000 } });

		const { processEmailQueueBatch } = await import('../dist/handlers/email-queue-cron.js');

		const now = Date.now();
		const key = process.env.GMAIL_TOKEN_ENCRYPTION_KEY!;
		const enc = encryptRefreshToken('refresh_tok', key);

		await db.collection('users').doc('user_1').set({ usage: {}, updatedAt: now });

		await db.collection('users').doc('user_1').collection('gmailConnections').doc('conn_1').set({
			email: 'sender@example.com',
			access_token: 'access_old',
			expires_at: now - 60 * 1000,
			connected_at: now,
			primary: true,
			...enc
		});

		await db.collection('users').doc('user_1').collection('emailQueue').doc('q1').set({
			id: 'q1',
			campaignId: 'camp_1',
			influencerId: 'inf_1',
			influencerName: 'Influencer',
			to: 'to@example.com',
			subject: 'Hello',
			htmlBody: '<p>Hi</p>',
			senderConnectionId: 'conn_1',
			senderEmail: 'sender@example.com',
			status: 'queued',
			priority: 1,
			createdAt: now,
			scheduledFor: now - 1000,
			processedAt: null,
			sentAt: null,
			attempts: 0,
			maxAttempts: 1,
			lastError: null,
			lastAttemptAt: null,
			updatedAt: now
		});

		const result = await processEmailQueueBatch();
		expect(result.totalProcessed).toBe(1);
		expect(result.totalFailed).toBe(1);

		const queueSnap = await db.collection('users').doc('user_1').collection('emailQueue').doc('q1').get();
		expect((queueSnap.data() as any).status).toBe('failed');

		const contactSnap = await db
			.collection('users')
			.doc('user_1')
			.collection('campaigns')
			.doc('camp_1')
			.collection('contacts')
			.doc('inf_1')
			.get();
		expect((contactSnap.data() as any).sendStatus).toBe('failed');
	});

	it('handles users with queued emails but no gmail connections (empty connections snapshot)', async () => {
		const { processEmailQueueBatch } = await import('../dist/handlers/email-queue-cron.js');

		const now = Date.now();
		await db.collection('users').doc('user_1').set({ usage: {}, updatedAt: now });

		// No gmailConnections docs created.
		await db.collection('users').doc('user_1').collection('emailQueue').doc('q1').set({
			id: 'q1',
			campaignId: null,
			influencerId: null,
			influencerName: null,
			to: 'to@example.com',
			subject: 'Hello',
			htmlBody: '<p>Hi</p>',
			senderConnectionId: 'conn_missing',
			senderEmail: 'sender@example.com',
			status: 'queued',
			priority: 1,
			createdAt: now,
			scheduledFor: now - 1000,
			processedAt: null,
			sentAt: null,
			attempts: 0,
			maxAttempts: 3,
			lastError: null,
			lastAttemptAt: null,
			updatedAt: now
		});

		const result = await processEmailQueueBatch();
		expect(result.totalProcessed).toBe(0);
	});

	it('skips processing when daily inbox limit is exhausted (usage.remaining <= 0)', async () => {
		const { processEmailQueueBatch } = await import('../dist/handlers/email-queue-cron.js');

		const now = Date.now();
		const key = process.env.GMAIL_TOKEN_ENCRYPTION_KEY!;
		const enc = encryptRefreshToken('refresh_tok', key);

		await db.collection('users').doc('user_1').set({ usage: {}, updatedAt: now });
		await db.collection('users').doc('user_1').collection('gmailConnections').doc('conn_1').set({
			email: 'sender@example.com',
			access_token: 'access_ok',
			expires_at: now + 60 * 60 * 1000,
			connected_at: now,
			primary: true,
			...enc
		});

		// Exhaust daily usage for this inbox.
		await db
			.collection('users')
			.doc('user_1')
			.collection('gmailConnections')
			.doc('conn_1')
			.collection('dailyUsage')
			.doc('2025-01-15')
			.set({ sendCount: 50, date: '2025-01-15', resetAt: now + 1, updatedAt: now });

		await db.collection('users').doc('user_1').collection('emailQueue').doc('q1').set({
			id: 'q1',
			campaignId: null,
			influencerId: null,
			influencerName: null,
			to: 'to@example.com',
			subject: 'Hello',
			htmlBody: '<p>Hi</p>',
			senderConnectionId: 'conn_1',
			senderEmail: 'sender@example.com',
			status: 'queued',
			priority: 1,
			createdAt: now,
			scheduledFor: now - 1000,
			processedAt: null,
			sentAt: null,
			attempts: 0,
			maxAttempts: 3,
			lastError: null,
			lastAttemptAt: null,
			updatedAt: now
		});

		const result = await processEmailQueueBatch();
		expect(result.totalProcessed).toBe(0);
		expect(gmailSend).not.toHaveBeenCalled();
	});

	it('returns early when a connection has no queued emails (snapshot.empty)', async () => {
		const { processEmailQueueBatch } = await import('../dist/handlers/email-queue-cron.js');

		const now = Date.now();
		const key = process.env.GMAIL_TOKEN_ENCRYPTION_KEY!;
		const enc = encryptRefreshToken('refresh_tok', key);

		await db.collection('users').doc('user_1').set({ usage: {}, updatedAt: now });
		await db.collection('users').doc('user_1').collection('gmailConnections').doc('conn_1').set({
			email: 'sender@example.com',
			access_token: 'access_ok',
			expires_at: now + 60 * 60 * 1000,
			connected_at: now,
			primary: true,
			...enc
		});

		// A queued email exists (so user_1 is discovered) but targets a different senderConnectionId.
		await db.collection('users').doc('user_1').collection('emailQueue').doc('q1').set({
			id: 'q1',
			campaignId: null,
			influencerId: null,
			influencerName: null,
			to: 'to@example.com',
			subject: 'Hello',
			htmlBody: '<p>Hi</p>',
			senderConnectionId: 'conn_other',
			senderEmail: 'sender@example.com',
			status: 'queued',
			priority: 1,
			createdAt: now,
			scheduledFor: now - 1000,
			processedAt: null,
			sentAt: null,
			attempts: 0,
			maxAttempts: 3,
			lastError: null,
			lastAttemptAt: null,
			updatedAt: now
		});

		const result = await processEmailQueueBatch();
		expect(result.totalProcessed).toBe(0);
		expect(result.results).toHaveLength(1);
		expect(result.results[0]?.processed).toBe(0);
	});

	it('marks email failed when the Gmail connection is missing encrypted refresh token', async () => {
		const { processEmailQueueBatch } = await import('../dist/handlers/email-queue-cron.js');

		const now = Date.now();
		await db.collection('users').doc('user_1').set({ usage: {}, updatedAt: now });

		// Missing refresh_token_* fields triggers getGmailConnection error branch.
		await db.collection('users').doc('user_1').collection('gmailConnections').doc('conn_1').set({
			email: 'sender@example.com',
			access_token: 'access_ok',
			expires_at: now + 60 * 60 * 1000,
			connected_at: now,
			primary: true
		});

		await db.collection('users').doc('user_1').collection('emailQueue').doc('q1').set({
			id: 'q1',
			campaignId: 'camp_1',
			influencerId: 'inf_1',
			influencerName: 'Influencer',
			to: 'to@example.com',
			subject: 'Hello',
			htmlBody: '<p>Hi</p>',
			senderConnectionId: 'conn_1',
			senderEmail: 'sender@example.com',
			status: 'queued',
			priority: 1,
			createdAt: now,
			scheduledFor: now - 1000,
			processedAt: null,
			sentAt: null,
			attempts: 0,
			maxAttempts: 1,
			lastError: null,
			lastAttemptAt: null,
			updatedAt: now
		});

		const result = await processEmailQueueBatch();
		expect(result.totalProcessed).toBe(1);
		expect(result.totalFailed).toBe(1);

		const queueSnap = await db.collection('users').doc('user_1').collection('emailQueue').doc('q1').get();
		expect((queueSnap.data() as any).status).toBe('failed');
	});

	it('returns queue item not found when deleted before claim transaction reads it', async () => {
		const { processEmailQueueBatch } = await import('../dist/handlers/email-queue-cron.js');

		const now = Date.now();
		const key = process.env.GMAIL_TOKEN_ENCRYPTION_KEY!;
		const enc = encryptRefreshToken('refresh_tok', key);

		await db.collection('users').doc('user_1').set({ usage: {}, updatedAt: now });
		await db.collection('users').doc('user_1').collection('gmailConnections').doc('conn_1').set({
			email: 'sender@example.com',
			access_token: 'access_ok',
			expires_at: now + 60 * 60 * 1000,
			connected_at: now,
			primary: true,
			...enc
		});

		await db.collection('users').doc('user_1').collection('emailQueue').doc('q1').set({
			id: 'q1',
			campaignId: null,
			influencerId: null,
			influencerName: null,
			to: 'to@example.com',
			subject: 'Hello',
			htmlBody: '<p>Hi</p>',
			senderConnectionId: 'conn_1',
			senderEmail: 'sender@example.com',
			status: 'queued',
			priority: 1,
			createdAt: now,
			scheduledFor: now - 1000,
			processedAt: null,
			sentAt: null,
			attempts: 0,
			maxAttempts: 3,
			lastError: null,
			lastAttemptAt: null,
			updatedAt: now
		});

		const originalRunTransaction = db.runTransaction.bind(db);
		db.runTransaction = async (fn: any) => {
			// Delete before claim tx reads it.
			await db.collection('users').doc('user_1').collection('emailQueue').doc('q1').delete();
			db.runTransaction = originalRunTransaction;
			return originalRunTransaction(fn);
		};

		const result = await processEmailQueueBatch();
		expect(result.totalProcessed).toBe(1);
		expect(result.totalFailed).toBe(1);
		expect(result.results[0]?.errors.join(' ')).toMatch(/Queue item not found/);
	});

	it('handles claim transaction failures and surfaces a Failed to claim email error', async () => {
		const { processEmailQueueBatch } = await import('../dist/handlers/email-queue-cron.js');

		const now = Date.now();
		const key = process.env.GMAIL_TOKEN_ENCRYPTION_KEY!;
		const enc = encryptRefreshToken('refresh_tok', key);

		await db.collection('users').doc('user_1').set({ usage: {}, updatedAt: now });
		await db.collection('users').doc('user_1').collection('gmailConnections').doc('conn_1').set({
			email: 'sender@example.com',
			access_token: 'access_ok',
			expires_at: now + 60 * 60 * 1000,
			connected_at: now,
			primary: true,
			...enc
		});
		await db.collection('users').doc('user_1').collection('emailQueue').doc('q1').set({
			id: 'q1',
			campaignId: null,
			influencerId: null,
			influencerName: null,
			to: 'to@example.com',
			subject: 'Hello',
			htmlBody: '<p>Hi</p>',
			senderConnectionId: 'conn_1',
			senderEmail: 'sender@example.com',
			status: 'queued',
			priority: 1,
			createdAt: now,
			scheduledFor: now - 1000,
			processedAt: null,
			sentAt: null,
			attempts: 0,
			maxAttempts: 3,
			lastError: null,
			lastAttemptAt: null,
			updatedAt: now
		});

		const originalRunTransaction = db.runTransaction.bind(db);
		db.runTransaction = async () => {
			db.runTransaction = originalRunTransaction;
			throw new Error('tx down');
		};

		const result = await processEmailQueueBatch();
		expect(result.totalProcessed).toBe(1);
		expect(result.totalFailed).toBe(1);
		expect(result.results[0]?.errors.join(' ')).toMatch(/Failed to claim email: tx down/);
	});

	it('marks email failed when the Gmail connection is deleted after listing connections', async () => {
		const { processEmailQueueBatch } = await import('../dist/handlers/email-queue-cron.js');

		const now = Date.now();
		const key = process.env.GMAIL_TOKEN_ENCRYPTION_KEY!;
		const enc = encryptRefreshToken('refresh_tok', key);

		await db.collection('users').doc('user_1').set({ usage: {}, updatedAt: now });

		await db.collection('users').doc('user_1').collection('gmailConnections').doc('conn_1').set({
			email: 'sender@example.com',
			access_token: 'access_ok',
			expires_at: now + 60 * 60 * 1000,
			connected_at: now,
			primary: true,
			...enc
		});

		await db.collection('users').doc('user_1').collection('emailQueue').doc('q1').set({
			id: 'q1',
			campaignId: null,
			influencerId: null,
			influencerName: null,
			to: 'to@example.com',
			subject: 'Hello',
			htmlBody: '<p>Hi</p>',
			senderConnectionId: 'conn_1',
			senderEmail: 'sender@example.com',
			status: 'queued',
			priority: 1,
			createdAt: now,
			scheduledFor: now - 1000,
			processedAt: null,
			sentAt: null,
			attempts: 0,
			maxAttempts: 1,
			lastError: null,
			lastAttemptAt: null,
			updatedAt: now
		});

		// Remove the gmailConnection document after it has been listed.
		const originalList = (db as any)._listDocsInCollectionPath.bind(db);
		(db as any)._listDocsInCollectionPath = (collectionPath: string) => {
			const rows = originalList(collectionPath);
			if (collectionPath === 'users/user_1/gmailConnections') {
				(db as any)._delete('users/user_1/gmailConnections/conn_1');
			}
			return rows;
		};

		const result = await processEmailQueueBatch();
		expect(result.totalProcessed).toBe(1);
		expect(result.totalFailed).toBe(1);

		const queueSnap = await db.collection('users').doc('user_1').collection('emailQueue').doc('q1').get();
		expect((queueSnap.data() as any).status).toBe('failed');

		(db as any)._listDocsInCollectionPath = originalList;
	});

	it('captures per-inbox processing errors via the processUserInboxQueue catch block', async () => {
		const { processEmailQueueBatch } = await import('../dist/handlers/email-queue-cron.js');

		const now = Date.now();
		const key = process.env.GMAIL_TOKEN_ENCRYPTION_KEY!;
		const enc = encryptRefreshToken('refresh_tok', key);

		await db.collection('users').doc('user_1').set({ usage: {}, updatedAt: now });
		await db.collection('users').doc('user_1').collection('gmailConnections').doc('conn_1').set({
			email: 'sender@example.com',
			access_token: 'access_ok',
			expires_at: now + 60 * 60 * 1000,
			connected_at: now,
			primary: true,
			...enc
		});
		await db.collection('users').doc('user_1').collection('emailQueue').doc('q1').set({
			id: 'q1',
			campaignId: null,
			influencerId: null,
			influencerName: null,
			to: 'to@example.com',
			subject: 'Hello',
			htmlBody: '<p>Hi</p>',
			senderConnectionId: 'conn_1',
			senderEmail: 'sender@example.com',
			status: 'queued',
			priority: 1,
			createdAt: now,
			scheduledFor: now - 1000,
			processedAt: null,
			sentAt: null,
			attempts: 0,
			maxAttempts: 3,
			lastError: null,
			lastAttemptAt: null,
			updatedAt: now
		});

		const originalList = (db as any)._listDocsInCollectionPath.bind(db);
		(db as any)._listDocsInCollectionPath = (collectionPath: string) => {
			if (collectionPath === 'users/user_1/emailQueue') {
				throw new Error('emailQueue down');
			}
			return originalList(collectionPath);
		};

		const result = await processEmailQueueBatch();
		expect(result.results[0]?.errors.join(' ')).toMatch(/Processing error: emailQueue down/);

		(db as any)._listDocsInCollectionPath = originalList;
	});

	it('logs and continues when processing a user throws', async () => {
		const { processEmailQueueBatch } = await import('../dist/handlers/email-queue-cron.js');

		const now = Date.now();
		await db.collection('users').doc('user_1').set({ usage: {}, updatedAt: now });
		await db.collection('users').doc('user_1').collection('emailQueue').doc('q1').set({
			id: 'q1',
			campaignId: null,
			influencerId: null,
			influencerName: null,
			to: 'to@example.com',
			subject: 'Hello',
			htmlBody: '<p>Hi</p>',
			senderConnectionId: 'conn_1',
			senderEmail: 'sender@example.com',
			status: 'queued',
			priority: 1,
			createdAt: now,
			scheduledFor: now - 1000,
			processedAt: null,
			sentAt: null,
			attempts: 0,
			maxAttempts: 3,
			lastError: null,
			lastAttemptAt: null,
			updatedAt: now
		});

		// Force the per-user queue processor to throw by breaking the gmailConnections collection get().
		const originalList = (db as any)._listDocsInCollectionPath.bind(db);
		(db as any)._listDocsInCollectionPath = (collectionPath: string) => {
			if (collectionPath === 'users/user_1/gmailConnections') {
				throw new Error('gmailConnections down');
			}
			return originalList(collectionPath);
		};

		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		const result = await processEmailQueueBatch();
		expect(result.totalProcessed).toBe(0);
		expectStructuredLogMessage(errorSpy, 'email_queue_user_failed');
		expectStructuredLogField(errorSpy, 'email_queue_user_failed', 'uid', 'user_1');

		(db as any)._listDocsInCollectionPath = originalList;
	});

	it('re-queues on retryable errors with backoff', async () => {
		gmailSend.mockRejectedValueOnce(new Error('Rate limit 429'));

		const { processEmailQueueBatch } = await import('../dist/handlers/email-queue-cron.js');

		const now = Date.now();
		const key = process.env.GMAIL_TOKEN_ENCRYPTION_KEY!;
		const enc = encryptRefreshToken('refresh_tok', key);

		await db.collection('users').doc('user_1').set({ usage: {}, updatedAt: now });

		await db.collection('users').doc('user_1').collection('gmailConnections').doc('conn_1').set({
			email: 'sender@example.com',
			access_token: 'access_ok',
			expires_at: now + 60 * 60 * 1000,
			connected_at: now,
			primary: true,
			...enc
		});

		await db.collection('users').doc('user_1').collection('emailQueue').doc('q1').set({
			id: 'q1',
			campaignId: null,
			influencerId: null,
			influencerName: null,
			to: 'to@example.com',
			subject: 'Hello',
			htmlBody: '<p>Hi</p>',
			senderConnectionId: 'conn_1',
			senderEmail: 'sender@example.com',
			status: 'queued',
			priority: 1,
			createdAt: now,
			scheduledFor: now - 1000,
			processedAt: null,
			sentAt: null,
			attempts: 0,
			maxAttempts: 3,
			lastError: null,
			lastAttemptAt: null,
			updatedAt: now
		});

		const result = await processEmailQueueBatch();
		expect(result.totalProcessed).toBe(1);
		expect(result.totalSucceeded).toBe(0);
		expect(result.totalFailed).toBe(1);

		const snap = await db.collection('users').doc('user_1').collection('emailQueue').doc('q1').get();
		const data = snap.data() as any;
		expect(data.status).toBe('queued');
		expect(data.lastError).toContain('Rate limit');
		expect(data.scheduledFor).toBeGreaterThan(now);
	});
});
