import { describe, expect, it, vi } from 'vitest';

import { FakeFirestore } from '../../helpers/fake-firebase';

function makeCookies() {
	return {
		set: vi.fn(),
		delete: vi.fn()
	};
}

function makeEvent(options: { method: string; url: string; uid?: string; origin?: string; body?: unknown }) {
	const url = new URL(options.url);
	const headers = new Headers();
	if (options.origin) headers.set('origin', options.origin);
	if (options.body !== undefined) headers.set('content-type', 'application/json');
	return {
		locals: { user: options.uid ? ({ uid: options.uid } as any) : null, requestId: 'req_local' },
		params: {},
		request: new Request(url.toString(), {
			method: options.method,
			headers,
			body: options.body !== undefined ? JSON.stringify(options.body) : undefined
		}),
		url,
		cookies: makeCookies()
	} as any;
}

describe('routes/api/session + public/session', () => {
	it('GET /api/session/token returns a custom token', async () => {
		vi.resetModules();

		const adminDb: any = Object.assign(new FakeFirestore(), { app: { options: { projectId: 'p', storageBucket: 'b' } } });
		const adminAuth = { createCustomToken: vi.fn(async () => 'custom') };
		vi.doMock('$lib/firebase/admin', () => ({ adminDb, adminAuth }));

		const { GET } = await import('../../../src/routes/api/session/token/+server');
		const res = await GET(makeEvent({ method: 'GET', url: 'http://localhost/api/session/token', uid: 'u1' }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ token: 'custom', uid: 'u1' });
	});

	it('GET /api/session/token returns 401 when unauthenticated and 500 on mint failure', async () => {
		vi.resetModules();

		const adminDb: any = Object.assign(new FakeFirestore(), { app: { options: { projectId: 'p', storageBucket: 'b' } } });
		const adminAuth = { createCustomToken: vi.fn(async () => { throw new Error('boom'); }) };
		vi.doMock('$lib/firebase/admin', () => ({ adminDb, adminAuth }));

		const { GET } = await import('../../../src/routes/api/session/token/+server');

		const unauth = await GET(makeEvent({ method: 'GET', url: 'http://localhost/api/session/token' }));
		expect(unauth.status).toBe(401);

		const res = await GET(makeEvent({ method: 'GET', url: 'http://localhost/api/session/token', uid: 'u1' }));
		expect(res.status).toBe(500);
		expect((await res.json()).error.code).toBe('CUSTOM_TOKEN_FAILED');
	});

	it('DELETE /api/session clears cookie and revokes refresh tokens', async () => {
		vi.resetModules();

		const adminDb: any = Object.assign(new FakeFirestore(), { app: { options: { projectId: 'p', storageBucket: 'b' } } });
		const adminAuth = { revokeRefreshTokens: vi.fn(async () => {}) };
		vi.doMock('$lib/firebase/admin', () => ({ adminDb, adminAuth }));

		const { DELETE } = await import('../../../src/routes/api/session/+server');
		const event = makeEvent({
			method: 'DELETE',
			url: 'http://localhost/api/session',
			origin: 'http://localhost',
			uid: 'u1'
		});
		const res = await DELETE(event);
		expect(res.status).toBe(200);
		expect(adminAuth.revokeRefreshTokens).toHaveBeenCalledWith('u1');
		expect(event.cookies.delete).toHaveBeenCalled();
	});

	it('DELETE /api/session rejects missing Origin and tolerates revoke failures', async () => {
		vi.resetModules();

		const adminDb: any = Object.assign(new FakeFirestore(), { app: { options: { projectId: 'p', storageBucket: 'b' } } });
		const adminAuth = { revokeRefreshTokens: vi.fn(async () => { throw new Error('nope'); }) };
		vi.doMock('$lib/firebase/admin', () => ({ adminDb, adminAuth }));

		const { DELETE } = await import('../../../src/routes/api/session/+server');

		const badOrigin = await DELETE(makeEvent({ method: 'DELETE', url: 'http://localhost/api/session', uid: 'u1' }));
		expect(badOrigin.status).toBe(403);

		const ok = await DELETE(makeEvent({ method: 'DELETE', url: 'http://localhost/api/session', origin: 'http://localhost', uid: 'u1' }));
		expect(ok.status).toBe(200);
		expect(adminAuth.revokeRefreshTokens).toHaveBeenCalled();
	});

	it('POST /api/public/session validates JSON and requires verified email', async () => {
		vi.resetModules();

		const adminDb: any = Object.assign(new FakeFirestore(), { app: { options: { projectId: 'p', storageBucket: 'b' } } });
		const adminAuth = {
			verifyIdToken: vi.fn(async () => ({ uid: 'u1', email_verified: false })),
			createSessionCookie: vi.fn(async () => 'cookie')
		};
		vi.doMock('$lib/firebase/admin', () => ({ adminDb, adminAuth }));
		vi.doMock('$lib/server/billing', () => ({ ensureFeatureCapabilities: vi.fn(async () => {}) }));

		const { POST } = await import('../../../src/routes/api/public/session/+server');
		const res = await POST(
			makeEvent({
				method: 'POST',
				url: 'http://localhost/api/public/session',
				origin: 'http://localhost',
				body: { idToken: 'id' }
			})
		);
		expect(res.status).toBe(403);
		const body = await res.json();
		expect(body.error.code).toBe('EMAIL_NOT_VERIFIED');
	});

	it('POST /api/public/session rejects missing/invalid tokens and maps auth errors', async () => {
		vi.resetModules();

		const adminDb: any = Object.assign(new FakeFirestore(), { app: { options: { projectId: 'p', storageBucket: 'b' } } });
		const adminAuth = {
			verifyIdToken: vi.fn(async () => {
				throw new Error('bad token');
			}),
			createSessionCookie: vi.fn(async () => 'cookie')
		};
		vi.doMock('$lib/firebase/admin', () => ({ adminDb, adminAuth }));
		vi.doMock('$lib/server/billing', () => ({ ensureFeatureCapabilities: vi.fn(async () => {}) }));

		const { POST } = await import('../../../src/routes/api/public/session/+server');

		const invalidJson = await POST(
			makeEvent({ method: 'POST', url: 'http://localhost/api/public/session', origin: 'http://localhost', body: undefined as any })
		);
		// No body means Request.json() fails and we return INVALID_JSON.
		expect(invalidJson.status).toBe(400);

		const missingToken = await POST(
			makeEvent({ method: 'POST', url: 'http://localhost/api/public/session', origin: 'http://localhost', body: { idToken: '   ' } })
		);
		expect(missingToken.status).toBe(400);
		expect((await missingToken.json()).error.code).toBe('MISSING_ID_TOKEN');

		const badToken = await POST(
			makeEvent({ method: 'POST', url: 'http://localhost/api/public/session', origin: 'http://localhost', body: { idToken: 'id' } })
		);
		expect(badToken.status).toBe(401);
		expect((await badToken.json()).error.code).toBe('ID_TOKEN_INVALID');
	});

	it('POST /api/public/session sets session cookie and initializes capabilities', async () => {
		vi.resetModules();

		const adminDb: any = Object.assign(new FakeFirestore(), { app: { options: { projectId: 'p', storageBucket: 'b' } } });
		const adminAuth = {
			verifyIdToken: vi.fn(async () => ({ uid: 'u1', email_verified: true, email: 'a@b.com' })),
			createSessionCookie: vi.fn(async () => 'cookie')
		};
		const ensureFeatureCapabilities = vi.fn(async () => {
			throw new Error('non-critical');
		});
		vi.doMock('$lib/firebase/admin', () => ({ adminDb, adminAuth }));
		vi.doMock('$lib/server/billing', () => ({ ensureFeatureCapabilities }));

		const { POST } = await import('../../../src/routes/api/public/session/+server');
		const event = makeEvent({
			method: 'POST',
			url: 'http://localhost/api/public/session',
			origin: 'http://localhost',
			body: { idToken: 'id', remember: true }
		});
		const res = await POST(event);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.uid).toBe('u1');
		expect(event.cookies.set).toHaveBeenCalled();
	});
});
