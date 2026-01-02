import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeFirestore } from './helpers/fake-firebase';

let db: FakeFirestore;
const createPipelineJob = vi.fn(async () => 'job_orch_1');
const enqueueTask = vi.fn(async () => {});

vi.mock('../dist/utils/firebase-admin.js', () => ({
	getFirestoreInstance: () => db
}));

vi.mock('../dist/utils/firestore-tracker.js', () => ({
	createPipelineJob: (...args: any[]) => createPipelineJob(...args)
}));

vi.mock('../dist/utils/cloud-tasks.js', () => ({
	enqueueTask: (...args: any[]) => enqueueTask(...args)
}));

function makeRes() {
	const res: any = {
		statusCode: 200,
		body: undefined,
		headersSent: false,
		status(code: number) {
			this.statusCode = code;
			return this;
		},
		json(payload: any) {
			this.body = payload;
			return this;
		}
	};
	return res;
}

describe('orchestrator (unit)', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		db = new FakeFirestore();
		delete process.env.FIRESTORE_EMULATOR_HOST;
		delete process.env.FIREBASE_STORAGE_EMULATOR_HOST;
		delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
		process.env.GOOGLE_CLOUD_PROJECT = 'proj_1';
	});

	it('returns 400 for invalid follower bounds', async () => {
		const { handlePipelineStart } = await import('../dist/handlers/orchestrator.js');
		const req: any = {
			body: {
				uid: 'user_1234567890',
				business_description: 'desc',
				min_followers: 100,
				max_followers: 10
			}
		};
		const res = makeRes();
		await handlePipelineStart(req, res);
		expect(res.statusCode).toBe(400);
		expect(res.body?.error).toBe('INVALID_FOLLOWER_BOUNDS');
	});

	it('validates campaign existence in production and returns 400 when missing', async () => {
		const { handlePipelineStart } = await import('../dist/handlers/orchestrator.js');

		const req: any = {
			body: {
				uid: 'user_1234567890',
				business_description: 'desc',
				campaign_id: 'camp_missing',
				top_n: 10
			}
		};
		const res = makeRes();
		await handlePipelineStart(req, res);

		expect(res.statusCode).toBe(400);
		expect(res.body?.error).toBe('INVALID_CAMPAIGN_ID');
		expect(createPipelineJob).not.toHaveBeenCalled();
	});

	it('enqueues a stage task in production mode', async () => {
		// Seed campaign to pass validation.
		await db
			.collection('users')
			.doc('user_1234567890')
			.collection('campaigns')
			.doc('camp_1')
			.set({ ok: true });

		const { handlePipelineStart } = await import('../dist/handlers/orchestrator.js');

		const req: any = {
			body: {
				uid: 'user_1234567890',
				request_id: '00000000-0000-4000-8000-000000000001',
				business_description: 'desc',
				campaign_id: 'camp_1',
				top_n: 200,
				exclude_profile_urls: ['https://instagram.com/already/'],
				strict_location_matching: true
			}
		};
		const res = makeRes();
		await handlePipelineStart(req, res);

		expect(res.statusCode).toBe(202);
		expect(res.body?.job_id).toBe('job_orch_1');

		expect(createPipelineJob).toHaveBeenCalledTimes(1);
		expect(enqueueTask).toHaveBeenCalledTimes(1);
		const enqueued = enqueueTask.mock.calls[0]?.[0];
		expect(enqueued?.kind).toBe('stage');
		expect(enqueued?.path).toBe('/tasks/pipeline-stage');
		expect(enqueued?.payload?.job_id).toBe('job_orch_1');
		expect(enqueued?.payload?.weaviate_top_n).toBe(800);
		expect(enqueued?.payload?.exclude_profile_urls).toEqual(['https://instagram.com/already/']);
		expect(enqueued?.payload?.strict_location_matching).toBe(true);
	});

	it('skips campaign validation in emulator mode and enqueues tasks', async () => {
		process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

		const { handlePipelineStart } = await import('../dist/handlers/orchestrator.js');

		const req: any = {
			body: {
				uid: 'user_1234567890',
				request_id: '00000000-0000-4000-8000-000000000010',
				business_description: 'desc',
				campaign_id: 'camp_missing',
				top_n: 10
			}
		};
		const res = makeRes();
		await handlePipelineStart(req, res);

		expect(res.statusCode).toBe(202);
		expect(createPipelineJob).toHaveBeenCalledTimes(1);
		expect(enqueueTask).toHaveBeenCalledTimes(1);
	});

	it('returns 500 when job creation fails', async () => {
		createPipelineJob.mockRejectedValueOnce(new Error('db down'));

		const { handlePipelineStart } = await import('../dist/handlers/orchestrator.js');

		const req: any = {
			body: {
				uid: 'user_1234567890',
				business_description: 'desc',
				top_n: 10
			}
		};
		const res = makeRes();
		await handlePipelineStart(req, res);

		expect(res.statusCode).toBe(500);
		expect(res.body?.error).toBe('INTERNAL_ERROR');
	});
});
