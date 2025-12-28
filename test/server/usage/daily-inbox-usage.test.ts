import { describe, expect, it, vi } from 'vitest';

import { createFirebaseAdminMock, FakeFirestore } from '../../helpers/fake-firebase';

describe('server/usage/daily-inbox-usage', () => {
	it('getDailyInboxUsage returns defaults when missing', async () => {
		vi.resetModules();
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-01-15T12:00:00Z'));

		const firestore = new FakeFirestore();
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const { getDailyInboxUsage, DAILY_INBOX_LIMIT } = await import('../../../src/lib/server/usage/daily-inbox-usage');
		const usage = await getDailyInboxUsage('u1', 'conn1');
		expect(usage.sendCount).toBe(0);
		expect(usage.remaining).toBe(DAILY_INBOX_LIMIT);

		vi.useRealTimers();
	});

	it('checkAndReserveDailyCapacity creates doc and reserves up to limit', async () => {
		vi.resetModules();
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-01-15T12:00:00Z'));

		const firestore = new FakeFirestore();
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const { checkAndReserveDailyCapacity } = await import('../../../src/lib/server/usage/daily-inbox-usage');
		const res = await checkAndReserveDailyCapacity('u1', 'conn1', 60);
		expect(res.canSend).toBe(50);
		expect(res.toQueue).toBe(10);
		expect(res.currentUsed).toBe(50);

		const dateKey = new Date().toISOString().split('T')[0];
		const snap = await adminDb
			.collection('users')
			.doc('u1')
			.collection('gmailConnections')
			.doc('conn1')
			.collection('dailyUsage')
			.doc(dateKey)
			.get();
		expect(snap.get('sendCount')).toBe(50);

		vi.useRealTimers();
	});

	it('checkAndReserveDailyCapacity increments existing count', async () => {
		vi.resetModules();
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-01-15T12:00:00Z'));
		const dateKey = new Date().toISOString().split('T')[0];

		const firestore = new FakeFirestore({
			[`users/u1/gmailConnections/conn1/dailyUsage/${dateKey}`]: { sendCount: 40, resetAt: 123 }
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const { checkAndReserveDailyCapacity } = await import('../../../src/lib/server/usage/daily-inbox-usage');
		const res = await checkAndReserveDailyCapacity('u1', 'conn1', 5);
		expect(res.canSend).toBe(5);
		expect(res.toQueue).toBe(0);

		const snap = await adminDb
			.collection('users')
			.doc('u1')
			.collection('gmailConnections')
			.doc('conn1')
			.collection('dailyUsage')
			.doc(dateKey)
			.get();
		expect(snap.get('sendCount')).toBe(45);

		vi.useRealTimers();
	});

	it('releaseReservedCapacity no-ops for <=0 and clamps to 0', async () => {
		vi.resetModules();
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-01-15T12:00:00Z'));
		const dateKey = new Date().toISOString().split('T')[0];

		const firestore = new FakeFirestore({
			[`users/u1/gmailConnections/conn1/dailyUsage/${dateKey}`]: { sendCount: 2 }
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const { releaseReservedCapacity } = await import('../../../src/lib/server/usage/daily-inbox-usage');
		await releaseReservedCapacity('u1', 'conn1', 0);
		await releaseReservedCapacity('u1', 'conn1', 5);

		const snap = await adminDb
			.collection('users')
			.doc('u1')
			.collection('gmailConnections')
			.doc('conn1')
			.collection('dailyUsage')
			.doc(dateKey)
			.get();
		expect(snap.get('sendCount')).toBe(0);

		vi.useRealTimers();
	});

	it('getAllInboxesDailyUsage returns keyed results', async () => {
		vi.resetModules();
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-01-15T12:00:00Z'));
		const dateKey = new Date().toISOString().split('T')[0];

		const firestore = new FakeFirestore({
			[`users/u1/gmailConnections/a/dailyUsage/${dateKey}`]: { sendCount: 10, resetAt: 1 },
			[`users/u1/gmailConnections/b/dailyUsage/${dateKey}`]: { sendCount: 50, resetAt: 2 }
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const { getAllInboxesDailyUsage } = await import('../../../src/lib/server/usage/daily-inbox-usage');
		const result = await getAllInboxesDailyUsage('u1', ['a', 'b']);
		expect(Object.keys(result)).toEqual(['a', 'b']);
		expect(result.a.sendCount).toBe(10);
		expect(result.b.remaining).toBe(0);

		vi.useRealTimers();
	});

	it('incrementDailyInboxUsage merges and increments send count', async () => {
		vi.resetModules();
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-01-15T12:00:00Z'));
		const dateKey = new Date().toISOString().split('T')[0];

		const firestore = new FakeFirestore();
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const { incrementDailyInboxUsage } = await import('../../../src/lib/server/usage/daily-inbox-usage');
		await incrementDailyInboxUsage('u1', 'conn1', 2);
		await incrementDailyInboxUsage('u1', 'conn1');

		const snap = await adminDb
			.collection('users')
			.doc('u1')
			.collection('gmailConnections')
			.doc('conn1')
			.collection('dailyUsage')
			.doc(dateKey)
			.get();
		expect(snap.get('sendCount')).toBe(3);

		vi.useRealTimers();
	});
});
