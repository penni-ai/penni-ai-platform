import { describe, expect, it, vi } from 'vitest';

import { createFirebaseAdminMock, FakeFirestore } from '../../helpers/fake-firebase';

function makeEmail(overrides?: Partial<any>) {
	return {
		to: 'to@test.com',
		subject: 'Hello',
		htmlBody: '<p>Hi</p>',
		senderConnectionId: 'conn1',
		senderEmail: 'me@test.com',
		campaignId: 'c1',
		influencerId: 'i1',
		influencerName: 'Influencer',
		...overrides
	};
}

describe('server/email-queue/queue-service', () => {
	it('addToEmailQueue returns [] for empty input', async () => {
		vi.resetModules();
		const firestore = new FakeFirestore();
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		vi.doMock('../../../src/lib/server/gmail/gmail-sender', () => ({ sendEmailViaGmail: vi.fn() }));
		vi.doMock('../../../src/lib/server/usage/outreach-usage', () => ({ incrementOutreachUsage: vi.fn() }));

		const { addToEmailQueue } = await import('../../../src/lib/server/email-queue/queue-service');
		expect(await addToEmailQueue('u1', [], Date.now())).toEqual([]);
	});

	it('addToEmailQueue writes queue docs and marks contacts pending', async () => {
		vi.resetModules();
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));

		const firestore = new FakeFirestore();
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const ids = ['q1'];
		vi.doMock('crypto', () => ({
			randomUUID: () => ids.shift() ?? 'q_other'
		}));

		vi.doMock('../../../src/lib/server/gmail/gmail-sender', () => ({ sendEmailViaGmail: vi.fn() }));
		vi.doMock('../../../src/lib/server/usage/outreach-usage', () => ({ incrementOutreachUsage: vi.fn() }));

		const { addToEmailQueue } = await import('../../../src/lib/server/email-queue/queue-service');
		const scheduledFor = Date.now() + 1_000;
		const result = await addToEmailQueue('u1', [makeEmail()], scheduledFor);
		expect(result).toEqual(['q1']);

		const queued = await adminDb.collection('users').doc('u1').collection('emailQueue').doc('q1').get();
		expect(queued.get('status')).toBe('queued');
		expect(queued.get('scheduledFor')).toBe(scheduledFor);
		expect(queued.get('attempts')).toBe(0);

		const contact = await adminDb
			.collection('users')
			.doc('u1')
			.collection('campaigns')
			.doc('c1')
			.collection('contacts')
			.doc('i1')
			.get();
		expect(contact.get('sendStatus')).toBe('pending');
		expect(contact.get('queuedAt')).toBe(Date.now());

		vi.useRealTimers();
	});

	it('addToEmailQueue skips contact updates when campaign/influencer are missing', async () => {
		vi.resetModules();
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));

		const firestore = new FakeFirestore({ 'users/u1': {} });
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		vi.doMock('crypto', () => ({ randomUUID: () => 'q1' }));
		vi.doMock('../../../src/lib/server/gmail/gmail-sender', () => ({ sendEmailViaGmail: vi.fn() }));
		vi.doMock('../../../src/lib/server/usage/outreach-usage', () => ({ incrementOutreachUsage: vi.fn() }));

		const { addToEmailQueue } = await import('../../../src/lib/server/email-queue/queue-service');
		await addToEmailQueue(
			'u1',
			[
				makeEmail({
					campaignId: null,
					influencerId: null
				})
			],
			Date.now() + 1
		);

		const contact = await adminDb
			.collection('users')
			.doc('u1')
			.collection('campaigns')
			.doc('c1')
			.collection('contacts')
			.doc('i1')
			.get();
		expect(contact.exists).toBe(false);

		vi.useRealTimers();
	});

	it('getUserEmailQueue supports status filters', async () => {
		vi.resetModules();
		const firestore = new FakeFirestore({
			'users/u1/emailQueue/a': { id: 'a', status: 'queued', createdAt: 1, senderConnectionId: 'c', campaignId: 'x' },
			'users/u1/emailQueue/b': { id: 'b', status: 'sent', createdAt: 2, senderConnectionId: 'c', campaignId: 'x' },
			'users/u1/emailQueue/c': { id: 'c', status: 'failed', createdAt: 3, senderConnectionId: 'd', campaignId: 'y' }
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		vi.doMock('../../../src/lib/server/gmail/gmail-sender', () => ({ sendEmailViaGmail: vi.fn() }));
		vi.doMock('../../../src/lib/server/usage/outreach-usage', () => ({ incrementOutreachUsage: vi.fn() }));

		const { getUserEmailQueue } = await import('../../../src/lib/server/email-queue/queue-service');
		const all = await getUserEmailQueue('u1', { status: ['queued', 'sent'], connectionId: 'c', campaignId: 'x' });
		expect(all.map((d) => d.id)).toEqual(['b', 'a']); // createdAt desc
	});

	it('getUserEmailQueue supports single status and defaults', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({
			'users/u1/emailQueue/a': { id: 'a', status: 'failed', createdAt: 1 },
			'users/u1/emailQueue/b': { id: 'b', status: 'failed', createdAt: 2 },
			'users/u1/emailQueue/c': { id: 'c', status: 'sent', createdAt: 3 }
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		vi.doMock('../../../src/lib/server/gmail/gmail-sender', () => ({ sendEmailViaGmail: vi.fn() }));
		vi.doMock('../../../src/lib/server/usage/outreach-usage', () => ({ incrementOutreachUsage: vi.fn() }));

		const { getUserEmailQueue } = await import('../../../src/lib/server/email-queue/queue-service');
		const onlyFailed = await getUserEmailQueue('u1', { status: 'failed' });
		expect(onlyFailed.map((d) => d.id)).toEqual(['b', 'a']);

		const limited = await getUserEmailQueue('u1', { limit: 1 });
		expect(limited).toHaveLength(1);

		const noFilters = await getUserEmailQueue('u1');
		expect(noFilters.map((d) => d.id)).toEqual(['c', 'b', 'a']);
	});

	it('getReadyQueuedEmails returns eligible queued emails ordered by scheduledFor/priority', async () => {
		vi.resetModules();
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));

		const now = Date.now();
		const firestore = new FakeFirestore({
			'users/u1/emailQueue/a': {
				id: 'a',
				status: 'queued',
				senderConnectionId: 'conn1',
				scheduledFor: now - 10,
				priority: 200
			},
			'users/u1/emailQueue/b': {
				id: 'b',
				status: 'queued',
				senderConnectionId: 'conn1',
				scheduledFor: now - 10,
				priority: 10
			},
			'users/u1/emailQueue/c': {
				id: 'c',
				status: 'queued',
				senderConnectionId: 'conn1',
				scheduledFor: now + 1000,
				priority: 1
			}
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		vi.doMock('../../../src/lib/server/gmail/gmail-sender', () => ({ sendEmailViaGmail: vi.fn() }));
		vi.doMock('../../../src/lib/server/usage/outreach-usage', () => ({ incrementOutreachUsage: vi.fn() }));

		const { getReadyQueuedEmails } = await import('../../../src/lib/server/email-queue/queue-service');
		const emails = await getReadyQueuedEmails('u1', 'conn1', 10);
		expect(emails.map((e) => e.id)).toEqual(['b', 'a']);

		vi.useRealTimers();
	});

	it('cancelQueuedEmail enforces existence and status', async () => {
		vi.resetModules();
		const firestore = new FakeFirestore({
			'users/u1/emailQueue/a': { id: 'a', status: 'sent' }
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		vi.doMock('../../../src/lib/server/gmail/gmail-sender', () => ({ sendEmailViaGmail: vi.fn() }));
		vi.doMock('../../../src/lib/server/usage/outreach-usage', () => ({ incrementOutreachUsage: vi.fn() }));

		const { cancelQueuedEmail } = await import('../../../src/lib/server/email-queue/queue-service');
		await expect(cancelQueuedEmail('u1', 'missing')).rejects.toThrow(/not found/i);
		await expect(cancelQueuedEmail('u1', 'a')).rejects.toThrow(/Cannot cancel/);
	});

	it('cancelQueuedEmail cancels queued items', async () => {
		vi.resetModules();
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));

		const firestore = new FakeFirestore({
			'users/u1/emailQueue/a': { id: 'a', status: 'queued', updatedAt: 1 }
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		vi.doMock('../../../src/lib/server/gmail/gmail-sender', () => ({ sendEmailViaGmail: vi.fn() }));
		vi.doMock('../../../src/lib/server/usage/outreach-usage', () => ({ incrementOutreachUsage: vi.fn() }));

		const { cancelQueuedEmail } = await import('../../../src/lib/server/email-queue/queue-service');
		await cancelQueuedEmail('u1', 'a');
		const snap = await adminDb.collection('users').doc('u1').collection('emailQueue').doc('a').get();
		expect(snap.get('status')).toBe('cancelled');

		vi.useRealTimers();
	});

	it('processQueuedEmail returns failure when not claimable', async () => {
		vi.resetModules();
		const firestore = new FakeFirestore({
			'users/u1/emailQueue/a': { id: 'a', status: 'processing' }
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		vi.doMock('../../../src/lib/server/gmail/gmail-sender', () => ({ sendEmailViaGmail: vi.fn() }));
		vi.doMock('../../../src/lib/server/usage/outreach-usage', () => ({ incrementOutreachUsage: vi.fn() }));

		const { processQueuedEmail } = await import('../../../src/lib/server/email-queue/queue-service');
		expect(await processQueuedEmail('u1', 'missing')).toEqual({ success: false, error: 'Queue item not found' });
		expect(await processQueuedEmail('u1', 'a')).toEqual({
			success: false,
			error: 'Invalid status for processing: processing'
		});
	});

	it('processQueuedEmail returns claim error on transaction failures', async () => {
		vi.resetModules();
		const firestore = new FakeFirestore();
		(firestore as any).runTransaction = async () => {
			throw new Error('contention');
		};
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		vi.doMock('../../../src/lib/server/gmail/gmail-sender', () => ({ sendEmailViaGmail: vi.fn() }));
		vi.doMock('../../../src/lib/server/usage/outreach-usage', () => ({ incrementOutreachUsage: vi.fn() }));

		const { processQueuedEmail } = await import('../../../src/lib/server/email-queue/queue-service');
		expect(await processQueuedEmail('u1', 'any')).toEqual({
			success: false,
			error: 'Failed to claim email: contention'
		});
	});

	it('processQueuedEmail marks sent and increments usage on success', async () => {
		vi.resetModules();
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));

		const firestore = new FakeFirestore({
			'users/u1/emailQueue/q1': {
				id: 'q1',
				status: 'queued',
				to: 'to@test.com',
				subject: 'Hello',
				htmlBody: '<p>Hi</p>',
				senderConnectionId: 'conn1',
				senderEmail: 'me@test.com',
				campaignId: 'c1',
				influencerId: 'i1',
				influencerName: 'Influencer',
				createdAt: 1,
				scheduledFor: Date.now(),
				processedAt: null,
				sentAt: null,
				attempts: 0,
				maxAttempts: 3,
				lastError: null,
				lastAttemptAt: null,
				updatedAt: 1
			}
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const sendEmailViaGmail = vi.fn(async () => {});
		const incrementOutreachUsage = vi.fn(async () => {});
		vi.doMock('../../../src/lib/server/gmail/gmail-sender', () => ({ sendEmailViaGmail }));
		vi.doMock('../../../src/lib/server/usage/outreach-usage', () => ({ incrementOutreachUsage }));

		const { processQueuedEmail } = await import('../../../src/lib/server/email-queue/queue-service');
		expect(await processQueuedEmail('u1', 'q1')).toEqual({ success: true });

		const queued = await adminDb.collection('users').doc('u1').collection('emailQueue').doc('q1').get();
		expect(queued.get('status')).toBe('sent');
		expect(incrementOutreachUsage).toHaveBeenCalledWith('u1', 1);
		expect(sendEmailViaGmail).toHaveBeenCalled();

		vi.useRealTimers();
	});

	it('processQueuedEmail schedules retry on retryable errors', async () => {
		vi.resetModules();
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
		const now = Date.now();

		const firestore = new FakeFirestore({
			'users/u1/emailQueue/q1': {
				id: 'q1',
				status: 'queued',
				to: 'to@test.com',
				subject: 'Hello',
				htmlBody: '<p>Hi</p>',
				senderConnectionId: 'conn1',
				senderEmail: 'me@test.com',
				campaignId: null,
				influencerId: null,
				influencerName: null,
				createdAt: 1,
				scheduledFor: now,
				processedAt: null,
				sentAt: null,
				attempts: 0,
				maxAttempts: 3,
				lastError: null,
				lastAttemptAt: null,
				updatedAt: 1
			}
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		vi.doMock('../../../src/lib/server/gmail/gmail-sender', () => ({
			sendEmailViaGmail: vi.fn(async () => {
				throw new Error('timeout');
			})
		}));
		vi.doMock('../../../src/lib/server/usage/outreach-usage', () => ({ incrementOutreachUsage: vi.fn() }));

		const { processQueuedEmail } = await import('../../../src/lib/server/email-queue/queue-service');
		const res = await processQueuedEmail('u1', 'q1');
		expect(res.success).toBe(false);

		const queued = await adminDb.collection('users').doc('u1').collection('emailQueue').doc('q1').get();
		expect(queued.get('status')).toBe('queued');
		expect(queued.get('lastError')).toBe('timeout');
		expect(queued.get('scheduledFor')).toBe(now + 60_000);

		vi.useRealTimers();
	});

	it('processQueuedEmail covers retryable/non-retryable classifications and backoff tiers', async () => {
		vi.resetModules();
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));

		const now = Date.now();
		const firestore = new FakeFirestore({
			'users/u1/emailQueue/q1': {
				id: 'q1',
				status: 'queued',
				to: 'to@test.com',
				subject: 'Hello',
				htmlBody: '<p>Hi</p>',
				senderConnectionId: 'conn1',
				senderEmail: 'me@test.com',
				campaignId: null,
				influencerId: null,
				influencerName: null,
				createdAt: 1,
				scheduledFor: now,
				processedAt: null,
				sentAt: null,
				attempts: 0,
				maxAttempts: 10,
				lastError: null,
				lastAttemptAt: null,
				updatedAt: 1
			},
			'users/u1/emailQueue/q2': {
				id: 'q2',
				status: 'queued',
				to: 'to@test.com',
				subject: 'Hello',
				htmlBody: '<p>Hi</p>',
				senderConnectionId: 'conn1',
				senderEmail: 'me@test.com',
				campaignId: null,
				influencerId: null,
				influencerName: null,
				createdAt: 1,
				scheduledFor: now,
				processedAt: null,
				sentAt: null,
				attempts: 1,
				maxAttempts: 10,
				lastError: null,
				lastAttemptAt: null,
				updatedAt: 1
			},
			'users/u1/emailQueue/q3': {
				id: 'q3',
				status: 'queued',
				to: 'to@test.com',
				subject: 'Hello',
				htmlBody: '<p>Hi</p>',
				senderConnectionId: 'conn1',
				senderEmail: 'me@test.com',
				campaignId: null,
				influencerId: null,
				influencerName: null,
				createdAt: 1,
				scheduledFor: now,
				processedAt: null,
				sentAt: null,
				attempts: 3,
				maxAttempts: 10,
				lastError: null,
				lastAttemptAt: null,
				updatedAt: 1
			},
			'users/u1/emailQueue/q4': {
				id: 'q4',
				status: 'queued',
				to: 'to@test.com',
				subject: 'Hello',
				htmlBody: '<p>Hi</p>',
				senderConnectionId: 'conn1',
				senderEmail: 'me@test.com',
				campaignId: null,
				influencerId: null,
				influencerName: null,
				createdAt: 1,
				scheduledFor: now,
				processedAt: null,
				sentAt: null,
				attempts: 0,
				maxAttempts: 10,
				lastError: null,
				lastAttemptAt: null,
				updatedAt: 1
			},
			'users/u1/emailQueue/q5': {
				id: 'q5',
				status: 'queued',
				to: 'to@test.com',
				subject: 'Hello',
				htmlBody: '<p>Hi</p>',
				senderConnectionId: 'conn1',
				senderEmail: 'me@test.com',
				campaignId: null,
				influencerId: null,
				influencerName: null,
				createdAt: 1,
				scheduledFor: now,
				processedAt: null,
				sentAt: null,
				attempts: 0,
				maxAttempts: 10,
				lastError: null,
				lastAttemptAt: null,
				updatedAt: 1
			},
			'users/u1/emailQueue/q6': {
				id: 'q6',
				status: 'queued',
				to: 'to@test.com',
				subject: 'Hello',
				htmlBody: '<p>Hi</p>',
				senderConnectionId: 'conn1',
				senderEmail: 'me@test.com',
				campaignId: null,
				influencerId: null,
				influencerName: null,
				createdAt: 1,
				scheduledFor: now,
				processedAt: null,
				sentAt: null,
				attempts: 0,
				maxAttempts: 10,
				lastError: null,
				lastAttemptAt: null,
				updatedAt: 1
			},
			'users/u1/emailQueue/q7': {
				id: 'q7',
				status: 'queued',
				to: 'to@test.com',
				subject: 'Hello',
				htmlBody: '<p>Hi</p>',
				senderConnectionId: 'conn1',
				senderEmail: 'me@test.com',
				campaignId: null,
				influencerId: null,
				influencerName: null,
				createdAt: 1,
				scheduledFor: now,
				processedAt: null,
				sentAt: null,
				attempts: 0,
				maxAttempts: 10,
				lastError: null,
				lastAttemptAt: null,
				updatedAt: 1
			},
			'users/u1/emailQueue/q8': {
				id: 'q8',
				status: 'queued',
				to: 'to@test.com',
				subject: 'Hello',
				htmlBody: '<p>Hi</p>',
				senderConnectionId: 'conn1',
				senderEmail: 'me@test.com',
				campaignId: null,
				influencerId: null,
				influencerName: null,
				createdAt: 1,
				scheduledFor: now,
				processedAt: null,
				sentAt: null,
				attempts: 0,
				maxAttempts: 10,
				lastError: null,
				lastAttemptAt: null,
				updatedAt: 1
			},
			'users/u1/emailQueue/q9': {
				id: 'q9',
				status: 'queued',
				to: 'to@test.com',
				subject: 'Hello',
				htmlBody: '<p>Hi</p>',
				senderConnectionId: 'conn1',
				senderEmail: 'me@test.com',
				campaignId: null,
				influencerId: null,
				influencerName: null,
				createdAt: 1,
				scheduledFor: now,
				processedAt: null,
				sentAt: null,
				attempts: 0,
				maxAttempts: 10,
				lastError: null,
				lastAttemptAt: null,
				updatedAt: 1
			},
			'users/u1/emailQueue/q10': {
				id: 'q10',
				status: 'queued',
				to: 'to@test.com',
				subject: 'Hello',
				htmlBody: '<p>Hi</p>',
				senderConnectionId: 'conn1',
				senderEmail: 'me@test.com',
				campaignId: null,
				influencerId: null,
				influencerName: null,
				createdAt: 1,
				scheduledFor: now,
				processedAt: null,
				sentAt: null,
				attempts: 0,
				maxAttempts: 10,
				lastError: null,
				lastAttemptAt: null,
				updatedAt: 1
			},
			'users/u1/emailQueue/q11': {
				id: 'q11',
				status: 'queued',
				to: 'to@test.com',
				subject: 'Hello',
				htmlBody: '<p>Hi</p>',
				senderConnectionId: 'conn1',
				senderEmail: 'me@test.com',
				campaignId: null,
				influencerId: null,
				influencerName: null,
				createdAt: 1,
				scheduledFor: now,
				processedAt: null,
				sentAt: null,
				attempts: 0,
				maxAttempts: 10,
				lastError: null,
				lastAttemptAt: null,
				updatedAt: 1
			}
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const sendEmailViaGmail = vi
			.fn()
			.mockRejectedValueOnce(new Error('rate limit'))
			.mockRejectedValueOnce(new Error('500 server error'))
			.mockRejectedValueOnce(new Error('timeout'))
			.mockRejectedValueOnce(new Error('invalid request 400'))
			.mockRejectedValueOnce('not-an-error')
			.mockRejectedValueOnce(new Error('timed out'))
			.mockRejectedValueOnce(new Error('ECONNRESET'))
			.mockRejectedValueOnce(new Error('ECONNREFUSED'))
			.mockRejectedValueOnce(new Error('network'))
			.mockRejectedValueOnce(new Error('socket'))
			.mockRejectedValueOnce(new Error('boom'));

		vi.doMock('../../../src/lib/server/gmail/gmail-sender', () => ({ sendEmailViaGmail }));
		vi.doMock('../../../src/lib/server/usage/outreach-usage', () => ({ incrementOutreachUsage: vi.fn() }));

		const { processQueuedEmail } = await import('../../../src/lib/server/email-queue/queue-service');

		await processQueuedEmail('u1', 'q1');
		await processQueuedEmail('u1', 'q2');
		await processQueuedEmail('u1', 'q3');
		await processQueuedEmail('u1', 'q4');
		await processQueuedEmail('u1', 'q5');
		await processQueuedEmail('u1', 'q6');
		await processQueuedEmail('u1', 'q7');
		await processQueuedEmail('u1', 'q8');
		await processQueuedEmail('u1', 'q9');
		await processQueuedEmail('u1', 'q10');
		await processQueuedEmail('u1', 'q11');

		const q1 = await adminDb.collection('users').doc('u1').collection('emailQueue').doc('q1').get();
		expect(q1.get('status')).toBe('queued');
		expect(q1.get('scheduledFor')).toBe(now + 60_000);

		const q2 = await adminDb.collection('users').doc('u1').collection('emailQueue').doc('q2').get();
		expect(q2.get('scheduledFor')).toBe(now + 300_000);

		const q3 = await adminDb.collection('users').doc('u1').collection('emailQueue').doc('q3').get();
		expect(q3.get('scheduledFor')).toBe(now + 900_000);

		const q4 = await adminDb.collection('users').doc('u1').collection('emailQueue').doc('q4').get();
		expect(q4.get('status')).toBe('failed');
		expect(q4.get('lastError')).toBe('invalid request 400');

		const q5 = await adminDb.collection('users').doc('u1').collection('emailQueue').doc('q5').get();
		expect(q5.get('status')).toBe('failed');
		expect(q5.get('lastError')).toBe('Unknown error');

		const q11 = await adminDb.collection('users').doc('u1').collection('emailQueue').doc('q11').get();
		expect(q11.get('status')).toBe('failed');
		expect(q11.get('lastError')).toBe('boom');

		vi.useRealTimers();
	});

	it('processQueuedEmail marks failed permanently for non-retryable errors', async () => {
		vi.resetModules();
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));

		const firestore = new FakeFirestore({
			'users/u1/emailQueue/q1': {
				id: 'q1',
				status: 'queued',
				to: 'to@test.com',
				subject: 'Hello',
				htmlBody: '<p>Hi</p>',
				senderConnectionId: 'conn1',
				senderEmail: 'me@test.com',
				campaignId: 'c1',
				influencerId: 'i1',
				influencerName: 'Influencer',
				createdAt: 1,
				scheduledFor: Date.now(),
				processedAt: null,
				sentAt: null,
				attempts: 0,
				maxAttempts: 2,
				lastError: null,
				lastAttemptAt: null,
				updatedAt: 1
			}
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		vi.doMock('../../../src/lib/server/gmail/gmail-sender', () => ({
			sendEmailViaGmail: vi.fn(async () => {
				throw new Error('access denied');
			})
		}));
		vi.doMock('../../../src/lib/server/usage/outreach-usage', () => ({ incrementOutreachUsage: vi.fn() }));

		const { processQueuedEmail } = await import('../../../src/lib/server/email-queue/queue-service');
		const res = await processQueuedEmail('u1', 'q1');
		expect(res.success).toBe(false);

		const queued = await adminDb.collection('users').doc('u1').collection('emailQueue').doc('q1').get();
		expect(queued.get('status')).toBe('failed');

		const contact = await adminDb
			.collection('users')
			.doc('u1')
			.collection('campaigns')
			.doc('c1')
			.collection('contacts')
			.doc('i1')
			.get();
		expect(contact.get('sendStatus')).toBe('failed');

		vi.useRealTimers();
	});

	it('getQueueStats counts statuses', async () => {
		vi.resetModules();
		const firestore = new FakeFirestore({
			'users/u1/emailQueue/a': { id: 'a', status: 'queued' },
			'users/u1/emailQueue/b': { id: 'b', status: 'sent' },
			'users/u1/emailQueue/c': { id: 'c', status: 'sent' },
			'users/u1/emailQueue/d': { id: 'd', status: 'failed' }
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		vi.doMock('../../../src/lib/server/gmail/gmail-sender', () => ({ sendEmailViaGmail: vi.fn() }));
		vi.doMock('../../../src/lib/server/usage/outreach-usage', () => ({ incrementOutreachUsage: vi.fn() }));

		const { getQueueStats } = await import('../../../src/lib/server/email-queue/queue-service');
		expect(await getQueueStats('u1')).toEqual({
			queued: 1,
			processing: 0,
			sent: 2,
			failed: 1,
			cancelled: 0,
			total: 4
		});
	});

	it('retryFailedEmail resets failed items to queued', async () => {
		vi.resetModules();
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));

		const firestore = new FakeFirestore({
			'users/u1/emailQueue/a': { id: 'a', status: 'failed', attempts: 2, maxAttempts: 2, lastError: 'x' }
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		vi.doMock('../../../src/lib/server/gmail/gmail-sender', () => ({ sendEmailViaGmail: vi.fn() }));
		vi.doMock('../../../src/lib/server/usage/outreach-usage', () => ({ incrementOutreachUsage: vi.fn() }));

		const { retryFailedEmail } = await import('../../../src/lib/server/email-queue/queue-service');
		await retryFailedEmail('u1', 'a');
		const snap = await adminDb.collection('users').doc('u1').collection('emailQueue').doc('a').get();
		expect(snap.get('status')).toBe('queued');
		expect(snap.get('attempts')).toBe(0);

		vi.useRealTimers();
	});

	it('retryFailedEmail enforces existence and status', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({
			'users/u1/emailQueue/a': { id: 'a', status: 'sent', attempts: 1 }
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		vi.doMock('../../../src/lib/server/gmail/gmail-sender', () => ({ sendEmailViaGmail: vi.fn() }));
		vi.doMock('../../../src/lib/server/usage/outreach-usage', () => ({ incrementOutreachUsage: vi.fn() }));

		const { retryFailedEmail } = await import('../../../src/lib/server/email-queue/queue-service');
		await expect(retryFailedEmail('u1', 'missing')).rejects.toThrow(/not found/i);
		await expect(retryFailedEmail('u1', 'a')).rejects.toThrow(/Cannot retry/);
	});

	it('cleanupOldQueueItems returns 0 when no matches, else deletes', async () => {
		vi.resetModules();
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));

		const now = Date.now();
		const firestore = new FakeFirestore({
			'users/u1/emailQueue/a': { id: 'a', status: 'queued', updatedAt: now },
			'users/u1/emailQueue/b': { id: 'b', status: 'sent', updatedAt: now - 60_000 }
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		vi.doMock('../../../src/lib/server/gmail/gmail-sender', () => ({ sendEmailViaGmail: vi.fn() }));
		vi.doMock('../../../src/lib/server/usage/outreach-usage', () => ({ incrementOutreachUsage: vi.fn() }));

		const { cleanupOldQueueItems } = await import('../../../src/lib/server/email-queue/queue-service');
		expect(await cleanupOldQueueItems('u1', 30)).toBe(0);

		// Make item old enough by using 0 days cutoff.
		expect(await cleanupOldQueueItems('u1', 0)).toBe(1);
		const b = await adminDb.collection('users').doc('u1').collection('emailQueue').doc('b').get();
		expect(b.exists).toBe(false);

		vi.useRealTimers();
	});
});
