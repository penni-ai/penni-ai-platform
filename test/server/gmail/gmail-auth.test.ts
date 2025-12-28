import { describe, expect, it, vi } from 'vitest';

import { createFirebaseAdminMock, FakeFirestore } from '../../helpers/fake-firebase';

function gmailEnv(overrides?: Partial<Record<string, string>>) {
	const key = Buffer.alloc(32, 7).toString('base64');
	return {
		GMAIL_OAUTH_CLIENT_ID: 'cid',
		GMAIL_OAUTH_CLIENT_SECRET: 'secret',
		GMAIL_OAUTH_REDIRECT_URI: 'http://localhost/callback',
		GMAIL_TOKEN_ENCRYPTION_KEY: key,
		...overrides
	};
}

describe('server/gmail/gmail-auth', () => {
	it('throws when Gmail OAuth config is missing', async () => {
		vi.resetModules();
		vi.doMock('$env/dynamic/private', () => ({ env: {} }));
		vi.doMock('google-auth-library', () => ({ OAuth2Client: class OAuth2ClientMock {} }));

		const { createOAuth2Client } = await import('../../../src/lib/server/gmail/gmail-auth');
		expect(() => createOAuth2Client()).toThrow(/Missing Gmail OAuth configuration/);
	});

	it('throws when encryption key is missing or invalid length', async () => {
		vi.resetModules();
		vi.doMock('$env/dynamic/private', () => ({ env: gmailEnv({ GMAIL_TOKEN_ENCRYPTION_KEY: '' }) }));
		vi.doMock('google-auth-library', () => ({ OAuth2Client: class OAuth2ClientMock {} }));

		const { createOAuth2Client } = await import('../../../src/lib/server/gmail/gmail-auth');
		expect(() => createOAuth2Client()).toThrow(/Missing Gmail token encryption key/);

		vi.resetModules();
		const badKey = Buffer.alloc(31, 1).toString('base64');
		vi.doMock('$env/dynamic/private', () => ({ env: gmailEnv({ GMAIL_TOKEN_ENCRYPTION_KEY: badKey }) }));
		vi.doMock('google-auth-library', () => ({ OAuth2Client: class OAuth2ClientMock {} }));
		const { createOAuth2Client: createBad } = await import('../../../src/lib/server/gmail/gmail-auth');
		expect(() => createBad()).toThrow(/32-byte key/);
	});

	it('getAuthUrl includes send scope only for send accounts', async () => {
		vi.resetModules();
		vi.doMock('$env/dynamic/private', () => ({ env: gmailEnv() }));

		let lastScopes: string[] = [];
		vi.doMock('google-auth-library', () => ({
			OAuth2Client: class OAuth2ClientMock {
				generateAuthUrl(opts: any) {
					lastScopes = opts.scope;
					return 'http://auth';
				}
			}
		}));

		const { getAuthUrl } = await import('../../../src/lib/server/gmail/gmail-auth');
		expect(getAuthUrl('state1', 'send')).toBe('http://auth');
		expect(lastScopes).toContain('https://www.googleapis.com/auth/gmail.send');

		expect(getAuthUrl('state2', 'draft')).toBe('http://auth');
		expect(lastScopes).not.toContain('https://www.googleapis.com/auth/gmail.send');
	});

	it('exchangeCodeForTokens validates Google token payload', async () => {
		vi.resetModules();
		vi.doMock('$env/dynamic/private', () => ({ env: gmailEnv() }));

		let tokens: any = { access_token: null, refresh_token: 'rt' };
		vi.doMock('google-auth-library', () => ({
			OAuth2Client: class OAuth2ClientMock {
				async getToken() {
					return { tokens };
				}
			}
		}));

		const { exchangeCodeForTokens } = await import('../../../src/lib/server/gmail/gmail-auth');
		await expect(exchangeCodeForTokens('code')).rejects.toThrow(/access token/i);

		tokens = { access_token: 'at', refresh_token: null };
		await expect(exchangeCodeForTokens('code')).rejects.toThrow(/offline access/i);

		tokens = { access_token: 'at', refresh_token: 'rt', expiry_date: 123, token_type: 'Bearer', scope: 's' };
		await expect(exchangeCodeForTokens('code')).resolves.toEqual({
			access_token: 'at',
			refresh_token: 'rt',
			expiry_date: 123,
			token_type: 'Bearer',
			scope: 's'
		});
	});

	it('storeGmailTokens persists encrypted refresh token and sets primary when first connection', async () => {
		vi.resetModules();
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));

		const firestore = new FakeFirestore();
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		vi.doMock('$env/dynamic/private', () => ({ env: gmailEnv() }));
		vi.doMock('google-auth-library', () => ({
			OAuth2Client: class OAuth2ClientMock {
				setCredentials() {}
				generateAuthUrl() {
					return 'http://auth';
				}
				async getToken() {
					return { tokens: {} };
				}
				async refreshAccessToken() {
					return { credentials: {} };
				}
				async revokeToken() {}
			}
		}));

		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ email: 'me@test.com' }), { status: 200 }))
		);

		const { storeGmailTokens, listGmailConnections } = await import('../../../src/lib/server/gmail/gmail-auth');
		const conn = await storeGmailTokens(
			'u1',
			{
				access_token: 'at',
				refresh_token: 'rt',
				expiry_date: Date.now() + 3600_000,
				token_type: 'Bearer',
				scope: 's'
			},
			{ connectionId: 'conn1', makePrimary: true, accountType: 'send' }
		);
		expect(conn).toEqual(
			expect.objectContaining({
				id: 'conn1',
				email: 'me@test.com',
				primary: true,
				accountType: 'send'
			})
		);

		const stored = await adminDb.collection('users').doc('u1').collection('gmailConnections').doc('conn1').get();
		expect(stored.get('refresh_token')).toBeUndefined();
		expect(stored.get('refresh_token_encrypted')).toBeTruthy();

		const listed = await listGmailConnections('u1');
		expect(listed).toHaveLength(1);
		expect(listed[0].primary).toBe(true);

		vi.useRealTimers();
	});

	it('refreshGmailToken updates access token and handles invalid_grant by deleting and re-primarying', async () => {
		vi.resetModules();
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));

		const key = gmailEnv().GMAIL_TOKEN_ENCRYPTION_KEY;
		const firestore = new FakeFirestore({
			'users/u1/gmailConnections/conn1': {
				email: 'a@test.com',
				access_token: 'old',
				expires_at: Date.now() - 1,
				connected_at: 1,
				last_refreshed_at: 1,
				primary: true,
				accountType: 'send',
				refresh_token_encrypted: 'AA==',
				refresh_token_iv: Buffer.alloc(12).toString('base64'),
				refresh_token_tag: Buffer.alloc(16).toString('base64'),
				refresh_token: 'legacy_should_be_deleted'
			},
			'users/u1/gmailConnections/conn2': {
				email: 'b@test.com',
				access_token: 'tok',
				expires_at: Date.now() + 9999,
				connected_at: 2,
				last_refreshed_at: 2,
				primary: false,
				accountType: 'send',
				refresh_token: 'rt2'
			}
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		vi.doMock('$env/dynamic/private', () => ({ env: gmailEnv({ GMAIL_TOKEN_ENCRYPTION_KEY: key }) }));

		let refreshMode: 'ok' | 'invalid_grant' = 'ok';
		vi.doMock('google-auth-library', () => ({
			OAuth2Client: class OAuth2ClientMock {
				setCredentials() {}
				async refreshAccessToken() {
					if (refreshMode === 'invalid_grant') {
						throw { response: { data: { error: 'invalid_grant' } } };
					}
					return {
						credentials: { access_token: 'new_access', expiry_date: Date.now() + 3600_000, refresh_token: 'new_refresh' }
					};
				}
				async revokeToken() {}
			}
		}));

		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ email: 'me@test.com' }), { status: 200 }))
		);

		const { refreshGmailToken } = await import('../../../src/lib/server/gmail/gmail-auth');
		const refreshed = await refreshGmailToken('u1', 'conn1');
		expect(refreshed.access_token).toBe('new_access');

		refreshMode = 'invalid_grant';
		await expect(refreshGmailToken('u1', 'conn1')).rejects.toThrow(/reconnect/i);

		const conn1 = await adminDb.collection('users').doc('u1').collection('gmailConnections').doc('conn1').get();
		expect(conn1.exists).toBe(false);

		const conn2 = await adminDb.collection('users').doc('u1').collection('gmailConnections').doc('conn2').get();
		expect(conn2.get('primary')).toBe(true);

		vi.useRealTimers();
	});

	it('getUserEmail throws when Google userinfo request fails', async () => {
		vi.resetModules();
		vi.doMock('$env/dynamic/private', () => ({ env: gmailEnv() }));
		vi.doMock('google-auth-library', () => ({
			OAuth2Client: class OAuth2ClientMock {
				setCredentials() {}
			}
		}));

		vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })) as any);

		const { getUserEmail } = await import('../../../src/lib/server/gmail/gmail-auth');
		await expect(getUserEmail('at')).rejects.toThrow(/Failed to fetch user email/);
	});

	it('throws when refresh token is missing from stored connection', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({
			'users/u1/gmailConnections/conn1': {
				email: 'a@test.com',
				access_token: 'tok',
				expires_at: Date.now() + 9999,
				connected_at: 1,
				primary: true
			}
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		vi.doMock('$env/dynamic/private', () => ({ env: gmailEnv() }));
		vi.doMock('google-auth-library', () => ({
			OAuth2Client: class OAuth2ClientMock {
				setCredentials() {}
			}
		}));

		const { getGmailConnection } = await import('../../../src/lib/server/gmail/gmail-auth');
		await expect(getGmailConnection('u1', 'conn1')).rejects.toThrow(/refresh token is missing/i);
	});

	it('storeGmailTokens derives a unique connection ID when there is a collision', async () => {
		vi.resetModules();
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));

		const firestore = new FakeFirestore({
			'users/u1/gmailConnections/me-test-com': {
				email: 'existing@test.com',
				access_token: 'tok',
				expires_at: Date.now() + 9999,
				connected_at: 1,
				last_refreshed_at: 1,
				primary: true,
				accountType: 'send',
				refresh_token: 'rt_old'
			}
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		vi.doMock('$env/dynamic/private', () => ({ env: gmailEnv() }));
		vi.doMock('google-auth-library', () => ({
			OAuth2Client: class OAuth2ClientMock {
				setCredentials() {}
				async revokeToken() {}
			}
		}));

		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ email: 'me@test.com' }), { status: 200 }))
		);

		const { storeGmailTokens } = await import('../../../src/lib/server/gmail/gmail-auth');
		const conn = await storeGmailTokens('u1', {
			access_token: 'at',
			refresh_token: 'rt',
			expiry_date: Date.now() + 3600_000,
			token_type: 'Bearer',
			scope: 's'
		});

		expect(conn.id).toBe('me-test-com-1');
		expect(conn.primary).toBe(false);

		const stored = await adminDb.collection('users').doc('u1').collection('gmailConnections').doc('me-test-com-1').get();
		expect(stored.exists).toBe(true);

		vi.useRealTimers();
	});

	it('revokeGmailTokens continues when revokeToken fails and ensures a primary remains', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({
			'users/u1/gmailConnections/conn1': {
				email: 'a@test.com',
				access_token: 'tok1',
				expires_at: Date.now() + 9999,
				connected_at: 1,
				last_refreshed_at: 1,
				primary: true,
				accountType: 'send',
				refresh_token: 'rt1'
			},
			'users/u1/gmailConnections/conn2': {
				email: 'b@test.com',
				access_token: 'tok2',
				expires_at: Date.now() + 9999,
				connected_at: 2,
				last_refreshed_at: 2,
				primary: false,
				accountType: 'send',
				refresh_token: 'rt2'
			}
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		vi.doMock('$env/dynamic/private', () => ({ env: gmailEnv() }));
		vi.doMock('google-auth-library', () => ({
			OAuth2Client: class OAuth2ClientMock {
				setCredentials() {}
				async revokeToken() {
					throw new Error('revocation failed');
				}
			}
		}));

		const { revokeGmailTokens } = await import('../../../src/lib/server/gmail/gmail-auth');
		await revokeGmailTokens('u1', 'conn1');

		const removed = await adminDb.collection('users').doc('u1').collection('gmailConnections').doc('conn1').get();
		expect(removed.exists).toBe(false);
		const remaining = await adminDb.collection('users').doc('u1').collection('gmailConnections').doc('conn2').get();
		expect(remaining.get('primary')).toBe(true);
	});

	it('revokeGmailTokens no-ops when connection is missing and preserves primary when disconnecting a non-primary account', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({
			'users/u1/gmailConnections/primary': {
				email: 'a@test.com',
				access_token: 'tok1',
				expires_at: Date.now() + 9999,
				connected_at: 1,
				last_refreshed_at: 1,
				primary: true,
				accountType: 'send',
				refresh_token: 'rt1'
			},
			'users/u1/gmailConnections/secondary': {
				email: 'b@test.com',
				access_token: 'tok2',
				expires_at: Date.now() + 9999,
				connected_at: 2,
				last_refreshed_at: 2,
				primary: false,
				accountType: 'send',
				refresh_token: 'rt2'
			}
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		vi.doMock('$env/dynamic/private', () => ({ env: gmailEnv() }));
		vi.doMock('google-auth-library', () => ({
			OAuth2Client: class OAuth2ClientMock {
				setCredentials() {}
				async revokeToken() {}
			}
		}));

		const { revokeGmailTokens } = await import('../../../src/lib/server/gmail/gmail-auth');
		await expect(revokeGmailTokens('u1', 'missing')).resolves.toBeUndefined();

		await revokeGmailTokens('u1', 'secondary');
		const remainingPrimary = await adminDb.collection('users').doc('u1').collection('gmailConnections').doc('primary').get();
		expect(remainingPrimary.get('primary')).toBe(true);
	});

	it('revokeGmailTokens returns cleanly when disconnecting the last connection', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({
			'users/u1/gmailConnections/conn1': {
				email: 'a@test.com',
				access_token: 'tok1',
				expires_at: Date.now() + 9999,
				connected_at: 1,
				last_refreshed_at: 1,
				primary: true,
				accountType: 'send',
				refresh_token: 'rt1'
			}
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		vi.doMock('$env/dynamic/private', () => ({ env: gmailEnv() }));
		vi.doMock('google-auth-library', () => ({
			OAuth2Client: class OAuth2ClientMock {
				setCredentials() {}
				async revokeToken() {}
			}
		}));

		const { revokeGmailTokens } = await import('../../../src/lib/server/gmail/gmail-auth');
		await revokeGmailTokens('u1', 'conn1');

		const removed = await adminDb.collection('users').doc('u1').collection('gmailConnections').doc('conn1').get();
		expect(removed.exists).toBe(false);
	});

	it('getValidGmailTokens returns cached tokens when valid and refreshes when expiring', async () => {
		vi.resetModules();
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));

		const now = Date.now();
		const firestore = new FakeFirestore({
			'users/u1/gmailConnections/conn1': {
				email: 'a@test.com',
				access_token: 'tok1',
				expires_at: now + 10 * 60_000,
				connected_at: 1,
				last_refreshed_at: 1,
				primary: true,
				accountType: 'send',
				refresh_token: 'rt1'
			}
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		vi.doMock('$env/dynamic/private', () => ({ env: gmailEnv() }));
		vi.doMock('google-auth-library', () => ({
			OAuth2Client: class OAuth2ClientMock {
				setCredentials() {}
				async refreshAccessToken() {
					return { credentials: { access_token: 'new_access', expiry_date: now + 3600_000, refresh_token: 'rt2' } };
				}
				async revokeToken() {}
			}
		}));

		const { getValidGmailTokens } = await import('../../../src/lib/server/gmail/gmail-auth');
		const cached = await getValidGmailTokens('u1', 'conn1');
		expect(cached.access_token).toBe('tok1');

		await adminDb.collection('users').doc('u1').collection('gmailConnections').doc('conn1').set({ expires_at: now + 1 }, { merge: true });
		const refreshed = await getValidGmailTokens('u1', 'conn1');
		expect(refreshed.access_token).toBe('new_access');

		vi.useRealTimers();
	});

	it('getGmailConnection returns primary/fallback connection when connectionId is omitted', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({
			'users/u1/gmailConnections/a': {
				email: 'a@test.com',
				access_token: 'tok1',
				expires_at: Date.now() + 9999,
				connected_at: 1,
				last_refreshed_at: 1,
				primary: true,
				accountType: 'send',
				refresh_token: 'rt1'
			},
			'users/u1/gmailConnections/b': {
				email: 'b@test.com',
				access_token: 'tok2',
				expires_at: Date.now() + 9999,
				connected_at: 2,
				last_refreshed_at: 2,
				primary: false,
				accountType: 'send',
				refresh_token: 'rt2'
			}
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
		vi.doMock('$env/dynamic/private', () => ({ env: gmailEnv() }));
		vi.doMock('google-auth-library', () => ({
			OAuth2Client: class OAuth2ClientMock {
				setCredentials() {}
			}
		}));

		const { getGmailConnection } = await import('../../../src/lib/server/gmail/gmail-auth');
		const primary = await getGmailConnection('u1');
		expect(primary.id).toBe('a');

		await adminDb.collection('users').doc('u1').collection('gmailConnections').doc('a').set({ primary: false }, { merge: true });
		const fallback = await getGmailConnection('u1');
		expect(fallback.id).toBe('a');
	});

	it('storeGmailTokens throws when it cannot load the stored connection', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore();
		const originalSet = (firestore as any)._set.bind(firestore);
		(firestore as any)._set = (path: string, data: any, opts: any) => {
			if (path.includes('/gmailConnections/')) return;
			return originalSet(path, data, opts);
		};

		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		vi.doMock('$env/dynamic/private', () => ({ env: gmailEnv() }));
		vi.doMock('google-auth-library', () => ({
			OAuth2Client: class OAuth2ClientMock {
				setCredentials() {}
				async revokeToken() {}
			}
		}));
		vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ email: 'me@test.com' }), { status: 200 })) as any);

		const { storeGmailTokens } = await import('../../../src/lib/server/gmail/gmail-auth');
		await expect(
			storeGmailTokens('u1', {
				access_token: 'at',
				refresh_token: 'rt',
				expiry_date: Date.now() + 3600_000,
				token_type: 'Bearer',
				scope: 's'
			})
		).rejects.toThrow(/Failed to load Gmail connection/);
	});

	it('refreshGmailToken rejects when refreshed credentials are missing fields', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({
			'users/u1/gmailConnections/conn1': {
				email: 'a@test.com',
				access_token: 'old',
				expires_at: Date.now() - 1,
				connected_at: 1,
				last_refreshed_at: 1,
				primary: true,
				accountType: 'send',
				refresh_token: 'rt1'
			}
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		vi.doMock('$env/dynamic/private', () => ({ env: gmailEnv() }));
		vi.doMock('google-auth-library', () => ({
			OAuth2Client: class OAuth2ClientMock {
				setCredentials() {}
				async refreshAccessToken() {
					return { credentials: {} };
				}
				async revokeToken() {}
			}
		}));

		const { refreshGmailToken } = await import('../../../src/lib/server/gmail/gmail-auth');
		await expect(refreshGmailToken('u1', 'conn1')).rejects.toThrow(/Failed to refresh access token/);
	});

	it('setPrimaryGmailConnection sets primary flag', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({
			'users/u1/gmailConnections/a': {
				email: 'a@test.com',
				access_token: 'tok1',
				expires_at: Date.now() + 9999,
				connected_at: 1,
				last_refreshed_at: 1,
				primary: true,
				accountType: 'send',
				refresh_token: 'rt1'
			},
			'users/u1/gmailConnections/b': {
				email: 'b@test.com',
				access_token: 'tok2',
				expires_at: Date.now() + 9999,
				connected_at: 2,
				last_refreshed_at: 2,
				primary: false,
				accountType: 'send',
				refresh_token: 'rt2'
			}
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
		vi.doMock('$env/dynamic/private', () => ({ env: gmailEnv() }));
		vi.doMock('google-auth-library', () => ({
			OAuth2Client: class OAuth2ClientMock {}
		}));

		const { setPrimaryGmailConnection } = await import('../../../src/lib/server/gmail/gmail-auth');
		await setPrimaryGmailConnection('u1', 'b');
		const a = await adminDb.collection('users').doc('u1').collection('gmailConnections').doc('a').get();
		const b = await adminDb.collection('users').doc('u1').collection('gmailConnections').doc('b').get();
		expect(a.get('primary')).toBe(false);
		expect(b.get('primary')).toBe(true);
	});

	it('getGmailConnection throws when there are no connections', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore();
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
		vi.doMock('$env/dynamic/private', () => ({ env: gmailEnv() }));
		vi.doMock('google-auth-library', () => ({
			OAuth2Client: class OAuth2ClientMock {
				setCredentials() {}
			}
		}));

		const { getGmailConnection } = await import('../../../src/lib/server/gmail/gmail-auth');
		await expect(getGmailConnection('u1')).rejects.toThrow(/No Gmail connection found/);
	});
});
