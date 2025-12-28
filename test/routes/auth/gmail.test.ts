import { describe, expect, it, vi } from 'vitest';

function makeCookies(initial?: Record<string, string>) {
	const jar = new Map<string, string>(Object.entries(initial ?? {}));
	return {
		get: (name: string) => jar.get(name),
		set: (name: string, value: string) => void jar.set(name, value),
		delete: (name: string) => void jar.delete(name),
		_dump: () => Object.fromEntries(jar.entries())
	};
}

function makeEvent(options: {
	url: string;
	uid?: string;
	method?: string;
	body?: unknown;
	rawBody?: string;
	cookies?: any;
}) {
	const url = new URL(options.url);
	const method = options.method ?? 'GET';
	const headers: Record<string, string> = { origin: url.origin };
	if (method !== 'GET') headers['content-type'] = 'application/json';

	return {
		locals: { user: options.uid ? ({ uid: options.uid, email: 'u@test.com' } as any) : null, requestId: 'req_test' },
		request: new Request(url.toString(), {
			method,
			headers,
			body:
				method === 'GET'
					? undefined
					: options.rawBody ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined)
		}),
		url,
		cookies: options.cookies ?? makeCookies()
	} as any;
}

describe('routes/api/auth/gmail', () => {
	it('GET /connect stores state cookie and redirects', async () => {
		vi.resetModules();

		vi.doMock('crypto', async (importOriginal) => {
			const mod = (await importOriginal()) as any;
			return { ...mod, randomBytes: () => Buffer.alloc(32, 1) };
		});

		const getAuthUrl = vi.fn(() => 'http://oauth');
		vi.doMock('$lib/server/gmail', () => ({ getAuthUrl }));

		const cookies = makeCookies();
		const { GET } = await import('../../../src/routes/api/auth/gmail/connect/+server');
		await expect(
			GET(
				makeEvent({
					url: 'http://localhost/api/auth/gmail/connect?connectionId=conn1&makePrimary=1&accountType=draft&returnCampaignId=c1',
					uid: 'u1',
					cookies
				})
			)
		).rejects.toMatchObject({ status: 302, location: 'http://oauth' });

		const stored = cookies.get('gmail_oauth_state');
		expect(stored).toBeTruthy();
		const parsed = JSON.parse(stored!);
		expect(parsed.connectionId).toBe('conn1');
		expect(parsed.makePrimary).toBe(true);
		expect(parsed.accountType).toBe('draft');
		expect(getAuthUrl).toHaveBeenCalledWith(parsed.csrf, 'draft');
	});

	it('GET /callback redirects on oauth error, missing code, and invalid state', async () => {
		vi.resetModules();
		vi.doMock('$lib/server/gmail', () => ({
			exchangeCodeForTokens: vi.fn(),
			storeGmailTokens: vi.fn()
		}));

		const { GET } = await import('../../../src/routes/api/auth/gmail/callback/+server');

		await expect(GET(makeEvent({ url: 'http://localhost/api/auth/gmail/callback?error=access_denied', uid: 'u1' }))).rejects.toMatchObject({
			status: 302,
			location: expect.stringContaining('/my-account/gmail?gmail_error=')
		});

		await expect(GET(makeEvent({ url: 'http://localhost/api/auth/gmail/callback', uid: 'u1' }))).rejects.toMatchObject({
			status: 302,
			location: expect.stringContaining('missing_code')
		});

		const cookies = makeCookies({ gmail_oauth_state: JSON.stringify({ csrf: 'a' }) });
		await expect(
			GET(makeEvent({ url: 'http://localhost/api/auth/gmail/callback?code=x&state=b', uid: 'u1', cookies }))
		).rejects.toMatchObject({
			status: 302,
			location: expect.stringContaining('invalid_state')
		});

		const badCookies = makeCookies({ gmail_oauth_state: '{' });
		await expect(
			GET(makeEvent({ url: 'http://localhost/api/auth/gmail/callback?code=x&state=a', uid: 'u1', cookies: badCookies }))
		).rejects.toMatchObject({
			status: 302,
			location: expect.stringContaining('invalid_state')
		});
	});

	it('GET /callback stores tokens and redirects to campaign when requested', async () => {
		vi.resetModules();
		const exchangeCodeForTokens = vi.fn(async () => ({ access_token: 'at', refresh_token: 'rt', expiry_date: 1, token_type: 'Bearer', scope: 's' }));
		const storeGmailTokens = vi.fn(async () => ({}));
		vi.doMock('$lib/server/gmail', () => ({ exchangeCodeForTokens, storeGmailTokens }));

		const cookies = makeCookies({
			gmail_oauth_state: JSON.stringify({ csrf: 'state123', connectionId: 'conn1', makePrimary: true, accountType: 'send', returnCampaignId: 'c1' })
		});

		const { GET } = await import('../../../src/routes/api/auth/gmail/callback/+server');
		await expect(
			GET(makeEvent({ url: 'http://localhost/api/auth/gmail/callback?code=abc&state=state123', uid: 'u1', cookies }))
		).rejects.toMatchObject({ status: 302, location: '/campaign/c1?gmail_connected=1' });

		expect(exchangeCodeForTokens).toHaveBeenCalledWith('abc');
		expect(storeGmailTokens).toHaveBeenCalledWith('u1', expect.any(Object), expect.objectContaining({ connectionId: 'conn1', makePrimary: true }));
		expect(cookies.get('gmail_oauth_state')).toBeUndefined();
	});

	it('GET /callback redirects to settings when no returnCampaignId is provided', async () => {
		vi.resetModules();

		const exchangeCodeForTokens = vi.fn(async () => ({
			access_token: 'at',
			refresh_token: 'rt',
			expiry_date: 1,
			token_type: 'Bearer',
			scope: 's'
		}));
		const storeGmailTokens = vi.fn(async () => ({}));
		vi.doMock('$lib/server/gmail', () => ({ exchangeCodeForTokens, storeGmailTokens }));

		const cookies = makeCookies({
			gmail_oauth_state: JSON.stringify({ csrf: 'state123', connectionId: 'conn1', makePrimary: true, accountType: 'send' })
		});

		const { GET } = await import('../../../src/routes/api/auth/gmail/callback/+server');
		await expect(
			GET(makeEvent({ url: 'http://localhost/api/auth/gmail/callback?code=abc&state=state123', uid: 'u1', cookies }))
		).rejects.toMatchObject({ status: 302, location: '/my-account/gmail?gmail_connected=1' });
	});

	it('GET /callback redirects on token exchange errors', async () => {
		vi.resetModules();
		vi.doMock('$lib/server/gmail', () => ({
			exchangeCodeForTokens: vi.fn(async () => {
				throw new Error('bad');
			}),
			storeGmailTokens: vi.fn()
		}));

		const cookies = makeCookies({ gmail_oauth_state: JSON.stringify({ csrf: 's' }) });
		const { GET } = await import('../../../src/routes/api/auth/gmail/callback/+server');
		await expect(
			GET(makeEvent({ url: 'http://localhost/api/auth/gmail/callback?code=abc&state=s', uid: 'u1', cookies }))
		).rejects.toMatchObject({ status: 302, location: expect.stringContaining('token_exchange') });
	});

	it('GET /status returns connection info and swallows getGmailConnection errors', async () => {
		vi.resetModules();
		const listGmailConnections = vi.fn(async () => [{ id: 'c1', email: 'a@test.com' }]);
		const getGmailConnection = vi.fn(async () => {
			throw new Error('none');
		});
		vi.doMock('$lib/server/gmail', () => ({ listGmailConnections, getGmailConnection }));

		const { GET } = await import('../../../src/routes/api/auth/gmail/status/+server');
		const res = await GET(makeEvent({ url: 'http://localhost/api/auth/gmail/status', uid: 'u1' }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			connected: true,
			email: null,
			connectedAt: null,
			lastRefreshedAt: null,
			connections: [{ id: 'c1', email: 'a@test.com' }]
		});
	});

	it('POST /disconnect validates connectionId', async () => {
		vi.resetModules();
		const revokeGmailTokens = vi.fn(async () => {});
		vi.doMock('$lib/server/gmail', () => ({ revokeGmailTokens }));

		const { POST } = await import('../../../src/routes/api/auth/gmail/disconnect/+server');
		const res = await POST(makeEvent({ url: 'http://localhost/api/auth/gmail/disconnect', uid: 'u1', method: 'POST', rawBody: '{' }));
		expect(res.status).toBe(400);
		expect((await res.json()).error.code).toBe('MISSING_CONNECTION_ID');

		const res2 = await POST(makeEvent({ url: 'http://localhost/api/auth/gmail/disconnect', uid: 'u1', method: 'POST', body: { connectionId: 'c1' } }));
		expect(res2.status).toBe(200);
		expect(await res2.json()).toEqual({ success: true, connectionId: 'c1' });
		expect(revokeGmailTokens).toHaveBeenCalledWith('u1', 'c1');
	});

	it('POST /primary validates connectionId', async () => {
		vi.resetModules();
		const setPrimaryGmailConnection = vi.fn(async () => {});
		vi.doMock('$lib/server/gmail', () => ({ setPrimaryGmailConnection }));

		const { POST } = await import('../../../src/routes/api/auth/gmail/primary/+server');
		const invalidJson = await POST(makeEvent({ url: 'http://localhost/api/auth/gmail/primary', uid: 'u1', method: 'POST', rawBody: '{' }));
		expect(invalidJson.status).toBe(400);
		expect((await invalidJson.json()).error.code).toBe('MISSING_CONNECTION_ID');

		const res = await POST(makeEvent({ url: 'http://localhost/api/auth/gmail/primary', uid: 'u1', method: 'POST', body: {} }));
		expect(res.status).toBe(400);

		const res2 = await POST(makeEvent({ url: 'http://localhost/api/auth/gmail/primary', uid: 'u1', method: 'POST', body: { connectionId: 'c1' } }));
		expect(res2.status).toBe(200);
		expect(setPrimaryGmailConnection).toHaveBeenCalledWith('u1', 'c1');
	});
});
