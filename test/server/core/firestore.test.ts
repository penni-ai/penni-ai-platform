import { describe, expect, it, vi } from 'vitest';

import { createFirebaseAdminMock, FakeFirestore } from '../../helpers/fake-firebase';

describe('server/core/firestore', () => {
	it('builds consistent document/collection references', async () => {
		vi.resetModules();

		const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
		const firestore = new FakeFirestore();
		const { adminDb } = createFirebaseAdminMock({ firestore, projectId: 'p1' });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const mod = await import('../../../src/lib/server/core/firestore');

		expect((mod.userDocRef('u1') as any).path).toBe('users/u1');
		expect((mod.subscriptionDocRef('u1', 's1') as any).path).toBe('users/u1/subscriptions/s1');
		expect((mod.outreachStateDocRef('u1', 'c1') as any).path).toBe('users/u1/campaigns/c1/outreach_state/current');
		expect((mod.addonDocRef('u1', 'a1') as any).path).toBe('users/u1/addons/a1');
		expect((mod.checkoutSessionDocRef('cs1') as any).path).toBe('checkoutSessions/cs1');
		expect((mod.webhookEventDocRef('evt1') as any).path).toBe('webhookEvents/evt1');
		expect((mod.stripeCustomerDocRef('cus1') as any).path).toBe('stripeCustomers/cus1');
		expect((mod.siteDocRef('u1', 'example.com') as any).path).toBe('users/u1/sites/example.com');
		expect((mod.campaignDocRef('u1', 'c1') as any).path).toBe('users/u1/campaigns/c1');
		expect((mod.pipelinesCollectionRef('u1', 'c1') as any).path).toBe('users/u1/campaigns/c1/pipelines');
		expect((mod.pipelineDocRef('u1', 'c1', 'p1') as any).path).toBe('users/u1/campaigns/c1/pipelines/p1');
		expect((mod.pipelineProfileRefsCollectionRef('u1', 'c1', 'p1') as any).path).toBe(
			'users/u1/campaigns/c1/pipelines/p1/profile_refs'
		);
		expect((mod.campaignProfilesCollectionRef('u1', 'c1') as any).path).toBe('users/u1/campaigns/c1/profiles');
		expect((mod.gmailConnectionsCollectionRef('u1') as any).path).toBe('users/u1/gmailConnections');
		expect((mod.gmailConnectionDocRef('u1', 'conn1') as any).path).toBe('users/u1/gmailConnections/conn1');
		expect((mod.gmailConnectionDailyUsageRef('u1', 'conn1', '2025-01-01') as any).path).toBe(
			'users/u1/gmailConnections/conn1/dailyUsage/2025-01-01'
		);
		expect((mod.emailQueueCollectionRef('u1') as any).path).toBe('users/u1/emailQueue');
		expect((mod.emailQueueDocRef('u1', 'q1') as any).path).toBe('users/u1/emailQueue/q1');
		expect((mod.campaignCollectedDocRef('u1', 'c1') as any).path).toBe('users/u1/campaigns/c1/collected/data');
		expect((mod.outreachCollectionRef('u1', 'c1') as any).path).toBe('users/u1/campaigns/c1/outreach');
		expect((mod.searchCollectionRef('u1', 'c1') as any).path).toBe('users/u1/campaigns/c1/search');
		expect((mod.outreachContactsCollectionRef('u1', 'c1') as any).path).toBe('users/u1/campaigns/c1/outreach_contacts');
		expect((mod.contactsCollectionRef('u1', 'c1') as any).path).toBe('users/u1/campaigns/c1/contacts');

		expect(mod.serverTimestamp()).toBeTruthy();

		expect(infoSpy).toHaveBeenCalledWith(
			'[Firestore] Initialized Firestore client',
			expect.objectContaining({ projectId: 'p1' })
		);
		infoSpy.mockRestore();
	});

	it('logs emulator mode when FIRESTORE_EMULATOR_HOST is set', async () => {
		vi.resetModules();

		process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
		const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

		const firestore = new FakeFirestore();
		const { adminDb } = createFirebaseAdminMock({ firestore, projectId: 'p2' });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		await import('../../../src/lib/server/core/firestore');
		expect(infoSpy).toHaveBeenCalledWith(
			'[Firestore] Initialized Firestore client',
			expect.objectContaining({ emulatorHost: '127.0.0.1:8080', isEmulator: true })
		);

		delete process.env.FIRESTORE_EMULATOR_HOST;
		infoSpy.mockRestore();
	});
});
