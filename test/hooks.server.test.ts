import { describe, expect, it, vi } from 'vitest';

function makeCookies(initial?: Record<string, string>) {
	const store = new Map(Object.entries(initial ?? {}));
	return {
		get: (name: string) => store.get(name),
		delete: vi.fn((name: string) => {
			store.delete(name);
		})
	};
}

describe('hooks.server', () => {
	it('returns 401 for private API requests without user', async () => {
		vi.resetModules();

		vi.doMock('crypto', () => ({ randomUUID: () => 'req-1' }));
		vi.doMock('$lib/firebase/admin', () => ({ adminAuth: { verifySessionCookie: vi.fn() } }));
		const apiError = vi.fn(() => new Response(JSON.stringify({ error: { code: 'AUTH_REQUIRED' } }), { status: 401 }));
		const baseLogger = { warn: vi.fn(), child: vi.fn(() => ({ warn: vi.fn(), child: vi.fn(() => ({})) })) };
		vi.doMock('$lib/server/core', () => ({
			apiError,
			createLogger: () => baseLogger
		}));

		const { handle } = await import('../src/hooks.server');

		const cookies = makeCookies();
		const resolve = vi.fn(async () => new Response('ok'));
		const event: any = {
			url: new URL('http://localhost/api/secure'),
			request: new Request('http://localhost/api/secure', { method: 'GET' }),
			cookies,
			locals: {}
		};

		const res = await handle({ event, resolve } as any);
		expect(res.status).toBe(401);
		expect(resolve).not.toHaveBeenCalled();
		expect(apiError).toHaveBeenCalledTimes(1);
	});

	it('allows public API requests without user and sets X-Request-Id', async () => {
		vi.resetModules();

		vi.doMock('crypto', () => ({ randomUUID: () => 'req-2' }));
		vi.doMock('$lib/firebase/admin', () => ({ adminAuth: { verifySessionCookie: vi.fn() } }));
		const baseLogger = { warn: vi.fn(), child: vi.fn(() => ({ warn: vi.fn(), child: vi.fn(() => ({})) })) };
		vi.doMock('$lib/server/core', () => ({
			apiError: vi.fn(),
			createLogger: () => baseLogger
		}));

		const { handle } = await import('../src/hooks.server');

		const resolve = vi.fn(async () => new Response('ok'));
		const event: any = {
			url: new URL('http://localhost/api/public/session'),
			request: new Request('http://localhost/api/public/session', { method: 'GET' }),
			cookies: makeCookies(),
			locals: {}
		};

		const res = await handle({ event, resolve } as any);
		expect(res.status).toBe(200);
		expect(res.headers.get('X-Request-Id')).toBe('req-2');
	});

	it('deletes invalid session cookies when verification fails', async () => {
		vi.resetModules();

		const verifySessionCookie = vi.fn(async () => {
			throw new Error('bad cookie');
		});

		vi.doMock('crypto', () => ({ randomUUID: () => 'req-3' }));
		vi.doMock('$lib/firebase/admin', () => ({ adminAuth: { verifySessionCookie } }));
		const warn = vi.fn();
		const baseLogger = { warn, child: vi.fn(() => ({ warn, child: vi.fn(() => ({})) })) };
		vi.doMock('$lib/server/core', () => ({
			apiError: vi.fn(),
			createLogger: () => baseLogger
		}));

		const { handle } = await import('../src/hooks.server');

		const cookies = makeCookies({ __session: 'cookie' });
		const resolve = vi.fn(async () => new Response('ok'));
		const event: any = {
			url: new URL('http://localhost/api/public/session'),
			request: new Request('http://localhost/api/public/session', { method: 'GET' }),
			cookies,
			locals: {}
		};

		const res = await handle({ event, resolve } as any);
		expect(res.status).toBe(200);
		expect(verifySessionCookie).toHaveBeenCalledTimes(1);
		expect(cookies.delete).toHaveBeenCalledTimes(1);
		expect(warn).toHaveBeenCalledTimes(1);
	});

	it('adds security headers in production', async () => {
		vi.resetModules();

		const prev = process.env.NODE_ENV;
		process.env.NODE_ENV = 'production';

		vi.doMock('crypto', () => ({ randomUUID: () => 'req-4' }));
		vi.doMock('$lib/firebase/admin', () => ({ adminAuth: { verifySessionCookie: vi.fn() } }));
		const baseLogger = { warn: vi.fn(), child: vi.fn(() => ({ warn: vi.fn(), child: vi.fn(() => ({})) })) };
		vi.doMock('$lib/server/core', () => ({
			apiError: vi.fn(),
			createLogger: () => baseLogger
		}));

		const { handle } = await import('../src/hooks.server');

		const resolve = vi.fn(async () => new Response('ok'));
		const event: any = {
			url: new URL('http://localhost/api/public/session'),
			request: new Request('http://localhost/api/public/session', { method: 'GET' }),
			cookies: makeCookies(),
			locals: {}
		};

		const res = await handle({ event, resolve } as any);
		expect(res.headers.get('X-Frame-Options')).toBe('DENY');
		expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');

		process.env.NODE_ENV = prev;
	});

	it('sets user-scoped logger when session cookie verifies', async () => {
		vi.resetModules();

		const verifySessionCookie = vi.fn(async () => ({ uid: 'u1' }));
		vi.doMock('crypto', () => ({ randomUUID: () => 'req-5' }));
		vi.doMock('$lib/firebase/admin', () => ({ adminAuth: { verifySessionCookie } }));

		const childLogger = { warn: vi.fn(), child: vi.fn(() => ({})) };
		const baseLogger = { warn: vi.fn(), child: vi.fn(() => childLogger) };
		vi.doMock('$lib/server/core', () => ({
			apiError: vi.fn(),
			createLogger: () => baseLogger
		}));

		const { handle } = await import('../src/hooks.server');

		const resolve = vi.fn(async () => new Response('ok'));
		const event: any = {
			url: new URL('http://localhost/api/public/session'),
			request: new Request('http://localhost/api/public/session', { method: 'GET' }),
			cookies: makeCookies({ __session: 'cookie' }),
			locals: {}
		};

		const res = await handle({ event, resolve } as any);
		expect(res.status).toBe(200);
		expect(verifySessionCookie).toHaveBeenCalledWith('cookie', true);
		expect(baseLogger.child).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1' }));
	});
});
