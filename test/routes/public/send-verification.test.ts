import { describe, expect, it, vi } from 'vitest';

import { createFirebaseAdminMock, FakeFirestore } from '../../helpers/fake-firebase';

function makeEvent(body: unknown, origin = 'http://localhost') {
	const url = new URL('http://localhost/api/public/auth/send-verification');
	return {
		locals: { user: null, requestId: 'req_test' },
		request: new Request(url.toString(), {
			method: 'POST',
			headers: { origin, 'content-type': 'application/json' },
			body: JSON.stringify(body)
		}),
		url
	} as any;
}

describe('routes/api/public/auth/send-verification', () => {
	it('rejects invalid JSON and missing email', async () => {
		vi.resetModules();
		const firestore = new FakeFirestore();
		const { adminDb, adminAuth } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb, adminAuth }));
		vi.doMock('$env/dynamic/public', () => ({ env: { PUBLIC_SITE_URL: 'http://localhost' } }));

		const { POST } = await import('../../../src/routes/api/public/auth/send-verification/+server');

		const badJsonEvent = {
			...makeEvent({}),
			request: new Request('http://localhost/api/public/auth/send-verification', {
				method: 'POST',
				headers: { origin: 'http://localhost', 'content-type': 'application/json' },
				body: '{'
			})
		} as any;
		const res1 = await POST(badJsonEvent);
		expect(res1.status).toBe(400);
		expect((await res1.json()).error.code).toBe('INVALID_JSON');

		const res2 = await POST(makeEvent({}));
		expect(res2.status).toBe(400);
		expect((await res2.json()).error.code).toBe('EMAIL_REQUIRED');
	});

	it('sends link and rate limits repeated requests', async () => {
		vi.resetModules();
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-01-01T12:00:00Z'));

		const firestore = new FakeFirestore();
		const adminAuth = { generateEmailVerificationLink: vi.fn(async () => 'http://link') };
		const { adminDb } = createFirebaseAdminMock({ firestore, verifySessionCookie: async () => ({ uid: 'u1' }) });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb, adminAuth }));
		vi.doMock('$env/dynamic/public', () => ({ env: { PUBLIC_SITE_URL: 'http://localhost' } }));

		const { POST } = await import('../../../src/routes/api/public/auth/send-verification/+server');

		const res = await POST(makeEvent({ email: 'User@Test.com' }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ status: 'sent', link: 'http://link' });

		const res2 = await POST(makeEvent({ email: 'user@test.com' }));
		expect(res2.status).toBe(429);
		expect((await res2.json()).error.code).toBe('TOO_MANY_REQUESTS');

		vi.useRealTimers();
	});

	it('omits link in production and returns 500 on auth failures', async () => {
		vi.resetModules();
		const prev = process.env.NODE_ENV;
		process.env.NODE_ENV = 'production';

		const firestore = new FakeFirestore();
		const adminAuth = { generateEmailVerificationLink: vi.fn(async () => { throw new Error('down'); }) };
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb, adminAuth }));
		vi.doMock('$env/dynamic/public', () => ({ env: { PUBLIC_SITE_URL: 'http://localhost' } }));

		const { POST } = await import('../../../src/routes/api/public/auth/send-verification/+server');
		const res = await POST(makeEvent({ email: 'user@test.com' }));
		expect(res.status).toBe(500);
		expect((await res.json()).error.code).toBe('VERIFICATION_SEND_FAILED');

		process.env.NODE_ENV = prev;
	});

	it('rethrows ApiProblem instances from downstream auth helpers', async () => {
		vi.resetModules();
		const firestore = new FakeFirestore();
		const { adminDb } = createFirebaseAdminMock({ firestore });
		const { ApiProblem } = await import('../../../src/lib/server/core/api');
		const adminAuth = {
			generateEmailVerificationLink: vi.fn(async () => {
				throw new ApiProblem({ status: 400, code: 'BAD_EMAIL', message: 'nope' });
			})
		};
		vi.doMock('$lib/firebase/admin', () => ({ adminDb, adminAuth }));
		vi.doMock('$env/dynamic/public', () => ({ env: { PUBLIC_SITE_URL: 'http://localhost' } }));

		const { POST } = await import('../../../src/routes/api/public/auth/send-verification/+server');
		const res = await POST(makeEvent({ email: 'user@test.com' }));
		expect(res.status).toBe(400);
		expect((await res.json()).error.code).toBe('BAD_EMAIL');
	});
});
