import { describe, expect, it, vi } from 'vitest';

import { createFirebaseAdminMock, FakeFirestore } from '../../helpers/fake-firebase';

function makeEvent(options: { uid?: string; body?: unknown; rawBody?: string }) {
	const url = new URL('http://localhost/api/outreach/send');
	return {
		locals: { user: options.uid ? ({ uid: options.uid, email: 'u@test.com' } as any) : null, requestId: 'req_test' },
		params: {},
		request: new Request(url.toString(), {
			method: 'POST',
			headers: { origin: url.origin, 'content-type': 'application/json' },
			body: options.rawBody ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined)
		}),
		url
	} as any;
}

describe('routes/api/outreach/send POST', () => {
	it('validates request payload and platform support', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore();
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const { POST } = await import('../../../src/routes/api/outreach/send/+server');

		const invalidJson = await POST(makeEvent({ uid: 'u1', rawBody: '{' }));
		expect(invalidJson.status).toBe(400);
		expect((await invalidJson.json()).error.code).toBe('INVALID_JSON');

		const invalidRecipients = await POST(makeEvent({ uid: 'u1', body: { emailContent: 'hi' } }));
		expect(invalidRecipients.status).toBe(400);
		expect((await invalidRecipients.json()).error.code).toBe('INVALID_RECIPIENTS');

		const invalidEmailContent = await POST(
			makeEvent({
				uid: 'u1',
				body: { recipients: [{ influencerId: 'i1', email: 'a@example.com' }], emailContent: 123 }
			})
		);
		expect(invalidEmailContent.status).toBe(400);
		expect((await invalidEmailContent.json()).error.code).toBe('INVALID_EMAIL_CONTENT');

		const notImplemented = await POST(
			makeEvent({
				uid: 'u1',
				body: {
					campaignId: 'c1',
					platform: 'instagram',
					recipients: [{ influencerId: 'i1', email: 'a@example.com' }],
					emailContent: 'Hello'
				}
			})
		);
		expect(notImplemented.status).toBe(501);
	});

	it('returns 403 when Gmail is not connected', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore();
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		vi.doMock('$lib/server/gmail', () => ({
			getGmailConnection: vi.fn(async () => {
				throw new Error('not connected');
			}),
			createDraftsViaGmail: vi.fn(),
			sendEmailsViaGmail: vi.fn()
		}));

		const { POST } = await import('../../../src/routes/api/outreach/send/+server');
		const res = await POST(
			makeEvent({
				uid: 'u1',
				body: { platform: 'gmail', recipients: [{ influencerId: 'i1', email: 'a@example.com' }], emailContent: 'Hello' }
			})
		);
		expect(res.status).toBe(403);
		expect((await res.json()).error.code).toBe('GMAIL_NOT_CONNECTED');
	});

	it('enforces outreach credits when directSend is enabled', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({
			'users/u1': { emailSettings: { directSend: true } }
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		vi.doMock('$lib/server/gmail', () => ({
			getGmailConnection: vi.fn(async () => ({ id: 'conn1', email: 'sender@example.com' })),
			createDraftsViaGmail: vi.fn(),
			sendEmailsViaGmail: vi.fn()
		}));
		vi.doMock('$lib/server/usage', () => ({
			getOutreachUsage: vi.fn(async () => ({ remaining: 0 })),
			incrementOutreachUsage: vi.fn()
		}));
		vi.doMock('$lib/server/outreach/email-footer', () => ({ generateEmailFooter: vi.fn(() => '') }));
		vi.doMock('$lib/server/outreach/email-templates', () => ({ replaceTemplateVariables: vi.fn((t: string) => t) }));
		vi.doMock('$lib/server/usage/daily-inbox-usage', () => ({
			checkAndReserveDailyCapacity: vi.fn(async () => ({ canSend: 1, toQueue: 0, currentUsed: 0, resetAt: 0 })),
			getNextMidnightUTC: vi.fn(() => 0),
			releaseReservedCapacity: vi.fn(),
			DAILY_INBOX_LIMIT: 10
		}));

		const { POST } = await import('../../../src/routes/api/outreach/send/+server');
		const res = await POST(
			makeEvent({
				uid: 'u1',
				body: {
					platform: 'gmail',
					recipients: [{ influencerId: 'i1', email: 'a@example.com' }],
					emailContent: 'Hello'
				}
			})
		);
		expect(res.status).toBe(403);
		expect((await res.json()).error.code).toBe('OUTREACH_LIMIT_EXCEEDED');
	});

	it('rejects deprecated influencerIds format', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore();
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		vi.doMock('$lib/server/gmail', () => ({
			getGmailConnection: vi.fn(async () => ({ id: 'conn1', email: 'sender@example.com' })),
			createDraftsViaGmail: vi.fn(),
			sendEmailsViaGmail: vi.fn()
		}));

		vi.doMock('$lib/server/outreach/email-footer', () => ({ generateEmailFooter: vi.fn(() => '') }));
		vi.doMock('$lib/server/outreach/email-templates', () => ({ replaceTemplateVariables: vi.fn((t: string) => t) }));
		vi.doMock('$lib/server/usage/daily-inbox-usage', () => ({
			checkAndReserveDailyCapacity: vi.fn(async () => ({ canSend: 1, toQueue: 0, currentUsed: 0, resetAt: 0 })),
			getNextMidnightUTC: vi.fn(() => 0),
			releaseReservedCapacity: vi.fn(),
			DAILY_INBOX_LIMIT: 10
		}));

		const { POST } = await import('../../../src/routes/api/outreach/send/+server');
		const res = await POST(
			makeEvent({
				uid: 'u1',
				body: {
					platform: 'gmail',
					influencerIds: ['inf1'],
					emailContent: 'Hello'
				}
			})
		);
		expect(res.status).toBe(400);
		expect((await res.json()).error.code).toBe('LEGACY_FORMAT_DEPRECATED');
	});

	it('direct-sends, queues overflow, and tracks contacts', async () => {
		vi.resetModules();
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-01-15T12:00:00Z'));

		const firestore = new FakeFirestore({
			'users/u1': { emailSettings: { directSend: true } },
			'users/u1/campaigns/c1': { title: 'T' }
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		vi.doMock('$lib/server/campaigns', () => ({
			serializeCampaignRecord: vi.fn(async () => ({ business_name: 'Acme' }))
		}));

		const sendEmailsViaGmail = vi.fn(async (_uid: string, emails: any[]) => ({
			sent: 1,
			failed: 1,
			errors: [`${emails[1]?.to}: failed`]
		}));
		vi.doMock('$lib/server/gmail', () => ({
			getGmailConnection: vi.fn(async () => ({ id: 'conn1', email: 'sender@example.com' })),
			createDraftsViaGmail: vi.fn(),
			sendEmailsViaGmail
		}));

		const incrementOutreachUsage = vi.fn(async () => {});
		vi.doMock('$lib/server/usage', () => ({
			getOutreachUsage: vi.fn(async () => ({ remaining: 99 })),
			incrementOutreachUsage
		}));

		vi.doMock('$lib/server/outreach/email-footer', () => ({ generateEmailFooter: vi.fn(() => '<footer />') }));
		vi.doMock('$lib/server/outreach/email-templates', () => ({
			replaceTemplateVariables: vi.fn((t: string, vars: any) => `${t}::${vars.influencer_name}`)
		}));

		const releaseReservedCapacity = vi.fn(async () => {
			throw new Error('release failed');
		});
		vi.doMock('$lib/server/usage/daily-inbox-usage', () => ({
			checkAndReserveDailyCapacity: vi.fn(async () => ({ canSend: 2, toQueue: 1, currentUsed: 5, resetAt: 123 })),
			getNextMidnightUTC: vi.fn(() => 999),
			releaseReservedCapacity,
			DAILY_INBOX_LIMIT: 10
		}));

		const addToEmailQueue = vi.fn(async () => ['q1']);
		vi.doMock('$lib/server/email-queue/queue-service', () => ({ addToEmailQueue }));

		const clearSelectionsAfterSend = vi.fn(async () => {
			throw new Error('clear failed');
		});
		vi.doMock('$lib/server/outreach/clear-selections', () => ({ clearSelectionsAfterSend }));

		const { POST } = await import('../../../src/routes/api/outreach/send/+server');
		const res = await POST(
			makeEvent({
				uid: 'u1',
				body: {
					campaignId: 'c1',
					platform: 'gmail',
					recipients: [
						{ influencerId: 'inf1', email: 'a@example.com', name: 'A' },
						{ influencerId: 'inf2', email: 'b@example.com', name: 'B' },
						{ influencerId: 'inf3', email: 'c@example.com', name: 'C' },
						{ influencerId: 'inf4', email: '', name: 'NoEmail' }
					],
					emailContent: 'Hello {{influencer_name}}'
				}
			})
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.sent).toBe(1);
		expect(body.failed).toBeGreaterThan(0);
		expect(body.queued).toBe(1);
		expect(body.dailyUsage).toEqual({ used: 5, remaining: 5, resetAt: 123 });

		expect(sendEmailsViaGmail).toHaveBeenCalled();
		expect(incrementOutreachUsage).toHaveBeenCalledWith('u1', 1);
		expect(releaseReservedCapacity).toHaveBeenCalledWith('u1', 'conn1', 1);
		expect(addToEmailQueue).toHaveBeenCalled();

		// Contact tracking writes to contacts collection and profile contact_status.
		const contacts = await adminDb.collection('users').doc('u1').collection('campaigns').doc('c1').collection('contacts').get();
		expect(contacts.size).toBeGreaterThan(0);

		const profile = await adminDb.collection('users').doc('u1').collection('campaigns').doc('c1').collection('profiles').doc('inf1').get();
		expect(profile.exists).toBe(true);
		expect(profile.get('contact_status.email.status')).toBe('sent');

		vi.useRealTimers();
	});

	it('creates drafts, queues overflow failures, and swallows contact tracking errors', async () => {
		vi.resetModules();
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-01-15T12:00:00Z'));

		const firestore = new FakeFirestore({ 'users/u1/campaigns/c1': { title: 'T' } });
		const originalGet = (firestore as any)._get.bind(firestore);
		(firestore as any)._get = (path: string) => {
			if (path === 'users/u1' || path === 'users/u1/campaigns/c1') {
				throw new Error('boom');
			}
			return originalGet(path);
		};
		const originalSet = (firestore as any)._set.bind(firestore);
		(firestore as any)._set = (path: string, data: any, options: any) => {
			if (path.includes('/contacts/')) {
				throw new Error('boom');
			}
			return originalSet(path, data, options);
		};

		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const createDraftsViaGmail = vi.fn(async () => ({
			created: 1,
			failed: 1,
			errors: ['b@example.com: failed'],
			draftIds: ['d1']
		}));
		vi.doMock('$lib/server/gmail', () => ({
			getGmailConnection: vi.fn(async () => ({ id: 'conn1', email: 'sender@example.com' })),
			createDraftsViaGmail,
			sendEmailsViaGmail: vi.fn()
		}));

		const incrementOutreachUsage = vi.fn(async () => {});
		vi.doMock('$lib/server/usage', () => ({
			getOutreachUsage: vi.fn(async () => ({ remaining: 99 })),
			incrementOutreachUsage
		}));

		vi.doMock('$lib/server/outreach/email-footer', () => ({ generateEmailFooter: vi.fn(() => '') }));
		vi.doMock('$lib/server/outreach/email-templates', () => ({ replaceTemplateVariables: vi.fn((t: string) => t) }));

		const releaseReservedCapacity = vi.fn(async () => {
			throw new Error('release failed');
		});
		vi.doMock('$lib/server/usage/daily-inbox-usage', () => ({
			checkAndReserveDailyCapacity: vi.fn(async () => ({ canSend: 1, toQueue: 1, currentUsed: 1, resetAt: 123 })),
			getNextMidnightUTC: vi.fn(() => 999),
			releaseReservedCapacity,
			DAILY_INBOX_LIMIT: 10
		}));

		vi.doMock('$lib/server/email-queue/queue-service', () => ({
			addToEmailQueue: vi.fn(async () => {
				throw new Error('queue down');
			})
		}));
		vi.doMock('$lib/server/outreach/clear-selections', () => ({ clearSelectionsAfterSend: vi.fn() }));

		const { POST } = await import('../../../src/routes/api/outreach/send/+server');
		const res = await POST(
			makeEvent({
				uid: 'u1',
				body: {
					campaignId: 'c1',
					platform: 'gmail',
					recipients: [
						{ influencerId: '', email: 'a@example.com', name: 'A' },
						{ influencerId: 'inf2', email: 'b@example.com', name: 'B' }
					],
					emailContent: 'Hello {{influencer_name}}'
				}
			})
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.created).toBe(1);
		expect(body.failed).toBeGreaterThan(0);
		expect(body.draftIds).toEqual(['d1']);
		expect(body.errors?.some((e: string) => e.includes('Failed to queue 1 emails'))).toBe(true);

		expect(incrementOutreachUsage).toHaveBeenCalledWith('u1', 1);
		expect(releaseReservedCapacity).toHaveBeenCalledWith('u1', 'conn1', 1);

		vi.useRealTimers();
	});

	it('omits dailyUsage when daily capacity is not available', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore();
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		vi.doMock('$lib/server/gmail', () => ({
			getGmailConnection: vi.fn(async () => ({ id: null, email: 'sender@example.com' })),
			createDraftsViaGmail: vi.fn(async () => ({ created: 1, failed: 0, errors: [], draftIds: ['d1'] })),
			sendEmailsViaGmail: vi.fn()
		}));

		vi.doMock('$lib/server/usage', () => ({
			getOutreachUsage: vi.fn(async () => ({ remaining: 99 })),
			incrementOutreachUsage: vi.fn(async () => {})
		}));

		vi.doMock('$lib/server/outreach/email-footer', () => ({ generateEmailFooter: vi.fn(() => '') }));
		vi.doMock('$lib/server/outreach/email-templates', () => ({ replaceTemplateVariables: vi.fn((t: string) => t) }));
		vi.doMock('$lib/server/usage/daily-inbox-usage', () => ({
			checkAndReserveDailyCapacity: vi.fn(async () => {
				throw new Error('should not be called');
			}),
			getNextMidnightUTC: vi.fn(() => 0),
			releaseReservedCapacity: vi.fn(),
			DAILY_INBOX_LIMIT: 10
		}));

		const { POST } = await import('../../../src/routes/api/outreach/send/+server');
		const res = await POST(
			makeEvent({
				uid: 'u1',
				body: {
					platform: 'gmail',
					recipients: [{ influencerId: 'i1', email: 'a@example.com' }],
					emailContent: 'Hello'
				}
			})
		);

		expect(res.status).toBe(200);
		expect('dailyUsage' in (await res.json())).toBe(false);
	});
});
