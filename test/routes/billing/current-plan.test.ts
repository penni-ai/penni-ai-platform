import { describe, expect, it, vi } from 'vitest';

import { createFirebaseAdminMock, FakeFirestore } from '../../helpers/fake-firebase';

function makeEvent(options: { uid?: string }) {
	const url = new URL('http://localhost/api/billing/current-plan');
	return {
		locals: { user: options.uid ? ({ uid: options.uid, email: 'u@test.com' } as any) : null, requestId: 'req_test' },
		params: {},
		request: new Request(url.toString(), { method: 'GET' }),
		url
	} as any;
}

describe('routes/api/billing/current-plan GET', () => {
	it('requires auth', async () => {
		vi.resetModules();
		const { GET } = await import('../../../src/routes/api/billing/current-plan/+server');
		const res = await GET(makeEvent({}));
		expect(res.status).toBe(401);
	});

	it('returns planKey (or null)', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({
			'users/u1': { currentPlan: { planKey: 'starter' } },
			'users/u2': {}
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const { GET } = await import('../../../src/routes/api/billing/current-plan/+server');

		const res1 = await GET(makeEvent({ uid: 'u1' }));
		expect(res1.status).toBe(200);
		expect(await res1.json()).toEqual({ planKey: 'starter' });

		const res2 = await GET(makeEvent({ uid: 'u2' }));
		expect(res2.status).toBe(200);
		expect(await res2.json()).toEqual({ planKey: null });
	});
});

