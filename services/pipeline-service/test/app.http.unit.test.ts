import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

const createPipelineJob = vi.fn(async () => 'job_http_1');
vi.mock('../dist/utils/firestore-tracker.js', () => ({
	createPipelineJob: (...args: any[]) => createPipelineJob(...args)
}));

vi.mock('../dist/utils/firebase-admin.js', () => ({
	getFirestoreInstance: () => ({
		collection: () => ({
			doc: () => ({
				get: async () => ({ exists: false })
			})
		})
	})
}));

describe('pipeline-service HTTP app', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
		process.env.PORT = '8081';
		vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true } as any)));
	});

	it('POST /pipeline/start returns 400 on validation errors', async () => {
		const { createApp } = await import('../dist/app.js');
		const app = createApp();

		const res = await request(app).post('/pipeline/start').send({ business_description: '' });
		expect(res.status).toBe(400);
		expect(res.body?.error).toBe('VALIDATION_ERROR');
	});

	it('POST /pipeline/start computes weaviate_top_n as max(top_n*4, 500) and enqueues tasks (emulator mode)', async () => {
		createPipelineJob.mockResolvedValueOnce('job_http_2');

		const { createApp } = await import('../dist/app.js');
		const app = createApp();

		const res = await request(app).post('/pipeline/start').send({
			uid: 'user_1234567890',
			request_id: '00000000-0000-4000-8000-000000000001',
			business_description: 'coffee brand',
			top_n: 200
		});

		expect(res.status).toBe(202);
		expect(res.body?.job_id).toBe('job_http_2');
		expect(res.body?.request_id).toBe('00000000-0000-4000-8000-000000000001');

		expect(createPipelineJob).toHaveBeenCalledTimes(1);
		const [businessDescription, llmTopN, metadata] = createPipelineJob.mock.calls[0] as any[];
		expect(businessDescription).toBe('coffee brand');
		expect(llmTopN).toBe(200);
		expect(metadata?.weaviateTopN).toBe(800);

		const fetchSpy = vi.mocked(globalThis.fetch as any);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		const [fetchUrl, fetchOptions] = fetchSpy.mock.calls[0] as [string, RequestInit];
		expect(fetchUrl).toContain('/tasks/pipeline-stage');
		const payload = JSON.parse(fetchOptions?.body as string);
		expect(payload.job_id).toBe('job_http_2');
		expect(payload.top_n).toBe(200);
		expect(payload.llm_top_n).toBe(200);
		expect(payload.weaviate_top_n).toBe(800);
	});

	it('POST /pipeline/start applies minimum weaviate_top_n=500 when top_n*4 is smaller', async () => {
		createPipelineJob.mockResolvedValueOnce('job_http_3');

		const { createApp } = await import('../dist/app.js');
		const app = createApp();

		const res = await request(app).post('/pipeline/start').send({
			uid: 'user_1234567890',
			request_id: '00000000-0000-4000-8000-000000000002',
			business_description: 'desc',
			top_n: 10
		});
		expect(res.status).toBe(202);

		const fetchSpy = vi.mocked(globalThis.fetch as any);
		const fetchBody = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
		expect(fetchBody.top_n).toBe(10);
		expect(fetchBody.weaviate_top_n).toBe(500);
	});
});
