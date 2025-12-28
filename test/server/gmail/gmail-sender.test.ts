import { describe, expect, it, vi } from 'vitest';

describe('server/gmail/gmail-sender', () => {
	it('sendEmailViaGmail sends encoded message and defaults fromEmail', async () => {
		vi.resetModules();

		vi.doMock('../../../src/lib/server/gmail/gmail-auth', () => ({
			getValidGmailTokens: vi.fn(async () => ({
				email: 'me@test.com',
				access_token: 'at',
				refresh_token: 'rt'
			})),
			createOAuth2Client: vi.fn(() => ({ setCredentials: vi.fn() }))
		}));

		const send = vi.fn(async (req: any) => {
			const raw = req.requestBody.raw as string;
			const decoded = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
			expect(decoded).toContain('To: to@test.com');
			expect(decoded).toContain('From: me@test.com');
			expect(decoded).toContain('Subject: Hello');
			expect(decoded).toContain('<p>Hi</p>');
		});

		vi.doMock('googleapis', () => ({
			google: {
				gmail: () => ({
					users: { messages: { send }, drafts: { create: vi.fn() } }
				})
			}
		}));

		const { sendEmailViaGmail } = await import('../../../src/lib/server/gmail/gmail-sender');
		await sendEmailViaGmail('u1', { to: 'to@test.com', subject: 'Hello', htmlBody: '<p>Hi</p>' }, 'conn1');
		expect(send).toHaveBeenCalled();
	});

	it('sendEmailViaGmail maps common Gmail API errors', async () => {
		vi.resetModules();

		vi.doMock('../../../src/lib/server/gmail/gmail-auth', () => ({
			getValidGmailTokens: vi.fn(async () => ({ email: 'me@test.com', access_token: 'at', refresh_token: 'rt' })),
			createOAuth2Client: vi.fn(() => ({ setCredentials: vi.fn() }))
		}));

		const send = vi
			.fn()
			.mockImplementationOnce(async () => {
				throw { response: { status: 429 }, message: 'rate' };
			})
			.mockImplementationOnce(async () => {
				throw { response: { status: 403 }, message: 'denied' };
			})
			.mockImplementationOnce(async () => {
				throw { response: { status: 400 }, message: 'bad' };
			})
			.mockImplementationOnce(async () => {
				throw new Error('boom');
			});

		vi.doMock('googleapis', () => ({
			google: {
				gmail: () => ({
					users: { messages: { send }, drafts: { create: vi.fn() } }
				})
			}
		}));

		const { sendEmailViaGmail } = await import('../../../src/lib/server/gmail/gmail-sender');
		await expect(sendEmailViaGmail('u1', { to: 'to@test.com', subject: 'Hello', htmlBody: '<p>Hi</p>' })).rejects.toThrow(/rate limit/i);
		await expect(sendEmailViaGmail('u1', { to: 'to@test.com', subject: 'Hello', htmlBody: '<p>Hi</p>' })).rejects.toThrow(/access denied/i);
		await expect(sendEmailViaGmail('u1', { to: 'to@test.com', subject: 'Hello', htmlBody: '<p>Hi</p>' })).rejects.toThrow(/invalid email/i);
		await expect(sendEmailViaGmail('u1', { to: 'to@test.com', subject: 'Hello', htmlBody: '<p>Hi</p>' })).rejects.toThrow(
			/Failed to send email via Gmail: boom/
		);
	});

	it('createDraftViaGmail returns draft id and validates missing id', async () => {
		vi.resetModules();

		vi.doMock('../../../src/lib/server/gmail/gmail-auth', () => ({
			getValidGmailTokens: vi.fn(async () => ({ email: 'me@test.com', access_token: 'at', refresh_token: 'rt' })),
			createOAuth2Client: vi.fn(() => ({ setCredentials: vi.fn() }))
		}));

		const create = vi.fn(async () => ({ data: { id: 'draft_1' } }));
		vi.doMock('googleapis', () => ({
			google: {
				gmail: () => ({
					users: { messages: { send: vi.fn() }, drafts: { create } }
				})
			}
		}));

		const { createDraftViaGmail } = await import('../../../src/lib/server/gmail/gmail-sender');
		expect(await createDraftViaGmail('u1', { to: 'to@test.com', subject: 'Hello', htmlBody: '<p>Hi</p>' })).toBe('draft_1');

		create.mockResolvedValueOnce({ data: {} });
		await expect(createDraftViaGmail('u1', { to: 'to@test.com', subject: 'Hello', htmlBody: '<p>Hi</p>' })).rejects.toThrow(
			/draft without id/i
		);
	});

	it('createDraftViaGmail maps common Gmail draft errors', async () => {
		vi.resetModules();

		vi.doMock('../../../src/lib/server/gmail/gmail-auth', () => ({
			getValidGmailTokens: vi.fn(async () => ({ email: 'me@test.com', access_token: 'at', refresh_token: 'rt' })),
			createOAuth2Client: vi.fn(() => ({ setCredentials: vi.fn() }))
		}));

		const create = vi
			.fn()
			.mockImplementationOnce(async () => {
				throw { response: { status: 429 }, message: 'rate' };
			})
			.mockImplementationOnce(async () => {
				throw { response: { status: 403 }, message: 'denied' };
			});

		vi.doMock('googleapis', () => ({
			google: {
				gmail: () => ({
					users: { messages: { send: vi.fn() }, drafts: { create } }
				})
			}
		}));

		const { createDraftViaGmail } = await import('../../../src/lib/server/gmail/gmail-sender');
		await expect(createDraftViaGmail('u1', { to: 'a@test.com', subject: 'A', htmlBody: 'A' })).rejects.toThrow(/rate limit/i);
		await expect(createDraftViaGmail('u1', { to: 'b@test.com', subject: 'B', htmlBody: 'B' })).rejects.toThrow(/access denied/i);
	});

	it('createDraftsViaGmail aggregates created/failed with delay', async () => {
		vi.resetModules();
		vi.useFakeTimers();

		vi.doMock('../../../src/lib/server/gmail/gmail-auth', () => ({
			getValidGmailTokens: vi.fn(async () => ({ email: 'me@test.com', access_token: 'at', refresh_token: 'rt' })),
			createOAuth2Client: vi.fn(() => ({ setCredentials: vi.fn() }))
		}));

		const create = vi
			.fn()
			.mockResolvedValueOnce({ data: { id: 'd1' } })
			.mockResolvedValueOnce({ data: { id: ' ' } })
			.mockRejectedValueOnce({ response: { status: 400, data: { error: { message: 'bad' } } }, message: 'bad' });

		vi.doMock('googleapis', () => ({
			google: {
				gmail: () => ({
					users: { messages: { send: vi.fn() }, drafts: { create } }
				})
			}
		}));

		const { createDraftsViaGmail } = await import('../../../src/lib/server/gmail/gmail-sender');
		const p = createDraftsViaGmail(
			'u1',
			[
				{ to: 'a@test.com', subject: 'A', htmlBody: 'A' },
				{ to: 'b@test.com', subject: 'B', htmlBody: 'B' },
				{ to: 'c@test.com', subject: 'C', htmlBody: 'C' }
			],
			'conn1'
		);
		await vi.advanceTimersByTimeAsync(500);
		const res = await p;
		expect(res.created).toBe(1);
		expect(res.failed).toBe(2);
		expect(res.draftIds).toEqual(['d1']);
		expect(res.errors.length).toBe(2);

		vi.useRealTimers();
	});

	it('sendEmailsViaGmail aggregates sent/failed', async () => {
		vi.resetModules();
		vi.useFakeTimers();

		vi.doMock('../../../src/lib/server/gmail/gmail-auth', () => ({
			getValidGmailTokens: vi.fn(async () => ({ email: 'me@test.com', access_token: 'at', refresh_token: 'rt' })),
			createOAuth2Client: vi.fn(() => ({ setCredentials: vi.fn() }))
		}));

		const send = vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce({ response: { status: 403 }, message: 'denied' });
		vi.doMock('googleapis', () => ({
			google: {
				gmail: () => ({
					users: { messages: { send }, drafts: { create: vi.fn() } }
				})
			}
		}));

		const { sendEmailsViaGmail } = await import('../../../src/lib/server/gmail/gmail-sender');
		const p = sendEmailsViaGmail('u1', [
			{ to: 'a@test.com', subject: 'A', htmlBody: 'A' },
			{ to: 'b@test.com', subject: 'B', htmlBody: 'B' }
		]);
		await vi.advanceTimersByTimeAsync(500);
		const res = await p;
		expect(res.sent).toBe(1);
		expect(res.failed).toBe(1);
		expect(res.errors[0]).toContain('b@test.com');

		vi.useRealTimers();
	});
});
