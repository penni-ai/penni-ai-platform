import { describe, expect, it, vi } from 'vitest';

import { createFirebaseAdminMock, FakeFirestore } from '../helpers/fake-firebase';

describe('core/firestore', () => {
	it('builds expected document paths', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore();
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const mod = await import('../../src/lib/server/core/firestore');

		expect(mod.userDocRef('u1').path).toBe('users/u1');
		expect(mod.campaignDocRef('u1', 'c1').path).toBe('users/u1/campaigns/c1');
		expect(mod.pipelineDocRef('u1', 'c1', 'p1').path).toBe('users/u1/campaigns/c1/pipelines/p1');
		expect(mod.pipelineProfileRefsCollectionRef('u1', 'c1', 'p1').path).toBe(
			'users/u1/campaigns/c1/pipelines/p1/profile_refs'
		);
		expect(mod.gmailConnectionDocRef('u1', 'g1').path).toBe('users/u1/gmailConnections/g1');
	});
});
