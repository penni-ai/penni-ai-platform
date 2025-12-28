import { describe, expect, it, vi } from 'vitest';

import { createFirebaseAdminMock, FakeFirestore } from '../../helpers/fake-firebase';

function makeEvent(options: { url: string; uid?: string; method: 'GET' | 'PUT'; body?: unknown; rawBody?: string }) {
	const url = new URL(options.url);
	return {
		locals: { user: options.uid ? ({ uid: options.uid, email: 'u@test.com' } as any) : null, requestId: 'req_test' },
		params: {},
		request: new Request(url.toString(), {
			method: options.method,
			headers: { origin: url.origin, 'content-type': 'application/json' },
			body: options.rawBody ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined)
		}),
		url
	} as any;
}

describe('routes/api/settings/email', () => {
	it('GET returns defaults when emailSettings are missing', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({ 'users/u1': {} });
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const route = await import('../../../src/routes/api/settings/email/+server');
		const res = await route.GET(makeEvent({ url: 'http://localhost/api/settings/email', uid: 'u1', method: 'GET' }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			footer: { enabled: false, html: '' },
			branding: {},
			directSend: false
		});
	});

	it('GET returns stored settings and maps Firestore errors to 500', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({
			'users/u1': {
				emailSettings: { footer: { enabled: true, html: '<p>hi</p>' }, branding: { companyName: 'Acme' }, directSend: true }
			}
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const route = await import('../../../src/routes/api/settings/email/+server');
		const ok = await route.GET(makeEvent({ url: 'http://localhost/api/settings/email', uid: 'u1', method: 'GET' }));
		expect(ok.status).toBe(200);
		expect(await ok.json()).toEqual({
			footer: { enabled: true, html: '<p>hi</p>' },
			branding: { companyName: 'Acme' },
			directSend: true
		});

		const originalGet = (firestore as any)._get.bind(firestore);
		(firestore as any)._get = (path: string) => {
			if (path === 'users/u1') throw new Error('boom');
			return originalGet(path);
		};

		const failed = await route.GET(makeEvent({ url: 'http://localhost/api/settings/email', uid: 'u1', method: 'GET' }));
		expect(failed.status).toBe(500);
		expect((await failed.json()).error.code).toBe('SETTINGS_FETCH_FAILED');
	});

	it('PUT rejects invalid JSON, updates settings, and maps update errors to 500', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({ 'users/u1': {} });
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const route = await import('../../../src/routes/api/settings/email/+server');

		const invalidJson = await route.PUT(
			makeEvent({ url: 'http://localhost/api/settings/email', uid: 'u1', method: 'PUT', rawBody: '{' })
		);
		expect(invalidJson.status).toBe(400);
		expect((await invalidJson.json()).error.code).toBe('INVALID_JSON');

		const ok = await route.PUT(
			makeEvent({
				url: 'http://localhost/api/settings/email',
				uid: 'u1',
				method: 'PUT',
				body: { footer: { enabled: true, html: '<p>f</p>' }, branding: { companyName: 'Acme' }, directSend: true }
			})
		);
		expect(ok.status).toBe(200);
		expect(await ok.json()).toEqual({ success: true });

		const snap = await adminDb.collection('users').doc('u1').get();
		expect(snap.get('emailSettings.footer.enabled')).toBe(true);
		expect(snap.get('emailSettings.directSend')).toBe(true);

		const failed = await route.PUT(
			makeEvent({
				url: 'http://localhost/api/settings/email',
				uid: 'u2',
				method: 'PUT',
				body: { directSend: false }
			})
		);
		expect(failed.status).toBe(500);
		expect((await failed.json()).error.code).toBe('SETTINGS_UPDATE_FAILED');
	});
});
