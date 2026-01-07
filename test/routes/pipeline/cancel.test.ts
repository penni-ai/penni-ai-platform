import { describe, expect, it, vi } from 'vitest';

import { createFirebaseAdminMock, FakeFirestore } from '../../helpers/fake-firebase';

function makeEvent(options: { pipelineId?: string; uid: string; origin?: string }) {
	const pipelineId = options.pipelineId ?? '';
	const url = new URL(`http://localhost/api/pipeline/${pipelineId}/cancel`);
	const headers = new Headers();
	headers.set('origin', options.origin ?? url.origin);
	return {
		params: { pipelineId: options.pipelineId },
		locals: { user: { uid: options.uid } as any, requestId: 'req_local' },
		request: new Request(url.toString(), { method: 'POST', headers }),
		url
	} as any;
}

describe('routes/api/pipeline/[pipelineId]/cancel POST', () => {
	it('returns 400 when pipelineId is missing', async () => {
		vi.resetModules();
		const firestore = new FakeFirestore();
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const { POST } = await import('../../../src/routes/api/pipeline/[pipelineId]/cancel/+server');
		const res = await POST(makeEvent({ uid: 'u1', pipelineId: undefined }));
		expect(res.status).toBe(400);
	});

	it('returns 404 when pipeline does not exist', async () => {
		vi.resetModules();
		const firestore = new FakeFirestore();
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const { POST } = await import('../../../src/routes/api/pipeline/[pipelineId]/cancel/+server');
		const res = await POST(makeEvent({ uid: 'u1', pipelineId: 'missing' }));
		expect(res.status).toBe(404);
	});

	it('returns 404 when pipeline belongs to another user', async () => {
		vi.resetModules();
		const firestore = new FakeFirestore({
			'pipeline_jobs/job1': { job_id: 'job1', uid: 'other', status: 'running' }
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const { POST } = await import('../../../src/routes/api/pipeline/[pipelineId]/cancel/+server');
		const res = await POST(makeEvent({ uid: 'u1', pipelineId: 'job1' }));
		expect(res.status).toBe(404);
	});

	it('returns 404 when pipeline uid is missing', async () => {
		vi.resetModules();
		const firestore = new FakeFirestore({
			'pipeline_jobs/job_missing_uid': { job_id: 'job_missing_uid', uid: null, status: 'running' }
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const { POST } = await import('../../../src/routes/api/pipeline/[pipelineId]/cancel/+server');
		const res = await POST(makeEvent({ uid: 'u1', pipelineId: 'job_missing_uid' }));
		expect(res.status).toBe(404);
	});

	it('returns ok without updating when pipeline is already terminal', async () => {
		vi.resetModules();
		const firestore = new FakeFirestore({
			'pipeline_jobs/job2': { job_id: 'job2', uid: 'u1', status: 'completed' }
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const { POST } = await import('../../../src/routes/api/pipeline/[pipelineId]/cancel/+server');
		const res = await POST(makeEvent({ uid: 'u1', pipelineId: 'job2' }));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.status).toBe('completed');
		expect(body.cancel_requested).toBe(true);
	});

	it('marks running pipelines as cancelled', async () => {
		vi.resetModules();
		const firestore = new FakeFirestore({
			'pipeline_jobs/job3': { job_id: 'job3', uid: 'u1', status: 'running' }
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const { POST } = await import('../../../src/routes/api/pipeline/[pipelineId]/cancel/+server');
		const res = await POST(makeEvent({ uid: 'u1', pipelineId: 'job3' }));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.status).toBe('cancelled');

		const snap = await adminDb.collection('pipeline_jobs').doc('job3').get();
		expect(snap.get('status')).toBe('cancelled');
		expect(snap.get('cancel_requested')).toBe(true);
	});
});
