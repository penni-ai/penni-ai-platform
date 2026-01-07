import { describe, expect, it, vi } from 'vitest';

import { createFirebaseAdminMock, FakeFirestore } from '../../helpers/fake-firebase';

function makeEvent(options: { uid?: string; body?: unknown; rawBody?: string }) {
	const url = new URL('http://localhost/api/user/delete');
	return {
		locals: { user: options.uid ? ({ uid: options.uid, email: 'u@test.com' } as any) : null, requestId: 'req_test' },
		request: new Request(url.toString(), {
			method: 'POST',
			headers: { origin: url.origin, 'content-type': 'application/json' },
			body: options.rawBody ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined)
		}),
		url
	} as any;
}

describe('routes/api/user/delete', () => {
	it('rejects invalid JSON', async () => {
		vi.resetModules();
		const firestore = new FakeFirestore({ 'users/u1': {} });
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
		vi.doMock('$lib/server/gmail', () => ({ revokeGmailTokens: vi.fn(async () => {}) }));

		const { POST } = await import('../../../src/routes/api/user/delete/+server');
		const res = await POST(makeEvent({ uid: 'u1', rawBody: '{' }));
		expect(res.status).toBe(400);
		expect((await res.json()).error.code).toBe('INVALID_JSON');
	});

	it('requires explicit confirmation', async () => {
		vi.resetModules();
		const firestore = new FakeFirestore({ 'users/u1': {} });
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
		vi.doMock('$lib/server/gmail', () => ({ revokeGmailTokens: vi.fn(async () => {}) }));

		const { POST } = await import('../../../src/routes/api/user/delete/+server');

		const res1 = await POST(makeEvent({ uid: 'u1', body: {} }));
		expect(res1.status).toBe(400);
		expect((await res1.json()).error.code).toBe('CONFIRMATION_REQUIRED');

		const res2 = await POST(makeEvent({ uid: 'u1', body: { confirm: 'nope' } }));
		expect(res2.status).toBe(400);
		expect((await res2.json()).error.code).toBe('CONFIRMATION_REQUIRED');
	});

	it('creates a deletion request record', async () => {
		const originalEmulator = process.env.FIRESTORE_EMULATOR_HOST;
		delete process.env.FIRESTORE_EMULATOR_HOST;

		vi.resetModules();
		const firestore = new FakeFirestore({ 'users/u1': {} });
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
		vi.doMock('$lib/server/gmail', () => ({ revokeGmailTokens: vi.fn(async () => {}) }));

		const { POST } = await import('../../../src/routes/api/user/delete/+server');
		const res = await POST(makeEvent({ uid: 'u1', body: { confirm: 'DELETE', reason: 'test' } }));
		expect(res.status).toBe(200);
		const payload = await res.json();
		expect(payload.success).toBe(true);
		expect(payload.status).toBe('requested');

		const requestSnap = await adminDb.collection('deletionRequests').doc('u1').get();
		expect(requestSnap.exists).toBe(true);
		expect(requestSnap.get('uid')).toBe('u1');
		expect(requestSnap.get('status')).toBe('requested');
		expect(requestSnap.get('email_domain')).toBe('test.com');

		const userSnap = await adminDb.collection('users').doc('u1').get();
		expect(userSnap.get('deletion.status')).toBe('requested');
		expect(userSnap.get('deletion.requestedAt')).toBeTypeOf('number');

		if (originalEmulator === undefined) {
			delete process.env.FIRESTORE_EMULATOR_HOST;
		} else {
			process.env.FIRESTORE_EMULATOR_HOST = originalEmulator;
		}
	});
});
