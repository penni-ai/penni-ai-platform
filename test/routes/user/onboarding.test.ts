import { describe, expect, it, vi } from 'vitest';

import { createFirebaseAdminMock, FakeFirestore } from '../../helpers/fake-firebase';

function makeEvent(options: { uid?: string; body?: unknown; rawBody?: string }) {
	const url = new URL('http://localhost/api/user/onboarding');
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

describe('routes/api/user/onboarding', () => {
	it('rejects invalid JSON', async () => {
		vi.resetModules();
		const firestore = new FakeFirestore({ 'users/u1': {} });
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const { POST } = await import('../../../src/routes/api/user/onboarding/+server');
		const res = await POST(makeEvent({ uid: 'u1', rawBody: '{' }));
		expect(res.status).toBe(400);
		expect((await res.json()).error.code).toBe('INVALID_JSON');
	});

	it('rejects invalid payload and action', async () => {
		vi.resetModules();
		const firestore = new FakeFirestore({ 'users/u1': {} });
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const { POST } = await import('../../../src/routes/api/user/onboarding/+server');

		const res1 = await POST(makeEvent({ uid: 'u1', body: null }));
		expect(res1.status).toBe(400);
		expect((await res1.json()).error.code).toBe('INVALID_PAYLOAD');

		const res2 = await POST(makeEvent({ uid: 'u1', body: { action: 'nope' } }));
		expect(res2.status).toBe(400);
		expect((await res2.json()).error.code).toBe('INVALID_ACTION');
	});

	it('updates onboarding on complete and skip', async () => {
		vi.resetModules();
		const firestore = new FakeFirestore({ 'users/u1': { onboarding: {} } });
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const { POST } = await import('../../../src/routes/api/user/onboarding/+server');
		const res = await POST(makeEvent({ uid: 'u1', body: { action: 'complete' } }));
		expect(res.status).toBe(200);

		const userSnap = await adminDb.collection('users').doc('u1').get();
		expect(userSnap.get('onboarding.tutorialCompleted')).toBe(true);
		expect(userSnap.get('onboarding.tutorialCompletedAt')).toBeTypeOf('number');

		const res2 = await POST(makeEvent({ uid: 'u1', body: { action: 'skip' } }));
		expect(res2.status).toBe(200);
		const userSnap2 = await adminDb.collection('users').doc('u1').get();
		expect(userSnap2.get('onboarding.tutorialSkipped')).toBe(true);
	});

	it('returns 500 when update fails', async () => {
		vi.resetModules();
		const firestore = new FakeFirestore(); // no user doc -> update throws
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const { POST } = await import('../../../src/routes/api/user/onboarding/+server');
		const res = await POST(makeEvent({ uid: 'u1', body: { action: 'complete' } }));
		expect(res.status).toBe(500);
		expect((await res.json()).error.code).toBe('UPDATE_FAILED');
	});
});
