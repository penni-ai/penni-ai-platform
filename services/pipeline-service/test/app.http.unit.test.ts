import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

const createPipelineJob = vi.fn(async () => 'job_http_1');
const handlePipelineExecution = vi.fn(async () => {});

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

vi.mock('../dist/handlers/worker.js', () => ({
	handlePipelineExecution: (...args: any[]) => handlePipelineExecution(...args)
}));

function decodePubSubData(data: string): any {
	const decoded = Buffer.from(data, 'base64').toString('utf-8');
	return JSON.parse(decoded);
}

describe('pipeline-service HTTP app', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
		process.env.PORT = '8081';
		vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true } as any)));
	});

	it('POST /pubsub/pipeline-start returns 400 on missing message.data', async () => {
		const { createApp } = await import('../dist/app.js');
		const app = createApp();

		const res = await request(app).post('/pubsub/pipeline-start').send({});
		expect(res.status).toBe(400);
		expect(res.body?.error).toBe('INVALID_MESSAGE_FORMAT');
	});

	it('POST /pubsub/pipeline-start returns 400 on invalid base64/json', async () => {
		const { createApp } = await import('../dist/app.js');
		const app = createApp();

		const res = await request(app)
			.post('/pubsub/pipeline-start')
			.send({ message: { data: Buffer.from('not json', 'utf8').toString('base64') } });

		expect(res.status).toBe(400);
		expect(res.body?.error).toBe('INVALID_MESSAGE_DATA');
	});

	it('POST /pubsub/pipeline-start returns 204 and triggers worker on valid message', async () => {
		const { createApp } = await import('../dist/app.js');
		const app = createApp();

		const payload = { job_id: 'job_1', uid: 'user_1', business_description: 'desc', weaviate_top_n: 500, llm_top_n: 10 };
		const data = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');

		const res = await request(app).post('/pubsub/pipeline-start').send({ message: { data } });
		expect(res.status).toBe(204);

		expect(handlePipelineExecution).toHaveBeenCalledTimes(1);
		expect(handlePipelineExecution).toHaveBeenCalledWith(payload);
	});

	it('POST /pubsub/pipeline-start logs when pipeline execution rejects', async () => {
		handlePipelineExecution.mockRejectedValueOnce(new Error('boom'));
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		const { createApp } = await import('../dist/app.js');
		const app = createApp();

		const payload = { job_id: 'job_reject', uid: 'user_1', business_description: 'desc', weaviate_top_n: 500, llm_top_n: 10 };
		const data = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');

		const res = await request(app).post('/pubsub/pipeline-start').send({ message: { data } });
		expect(res.status).toBe(204);

		// Allow the async .catch() handler to run.
		await new Promise((resolve) => setImmediate(resolve));

		expect(errorSpy).toHaveBeenCalledWith('[App] Pipeline execution failed:', {
			job_id: 'job_reject',
			error: 'boom'
		});

		errorSpy.mockRestore();
	});

	it('POST /pubsub/pipeline-start returns 204 even when worker throws synchronously', async () => {
		handlePipelineExecution.mockImplementationOnce(() => {
			throw new Error('sync boom');
		});
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		const { createApp } = await import('../dist/app.js');
		const app = createApp();

		const payload = { job_id: 'job_sync', uid: 'user_1', business_description: 'desc', weaviate_top_n: 500, llm_top_n: 10 };
		const data = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');

		const res = await request(app).post('/pubsub/pipeline-start').send({ message: { data } });
		expect(res.status).toBe(204);

		expect(errorSpy).toHaveBeenCalled();
		errorSpy.mockRestore();
	});

	it('POST /pipeline/start returns 400 on validation errors', async () => {
		const { createApp } = await import('../dist/app.js');
		const app = createApp();

		const res = await request(app).post('/pipeline/start').send({ business_description: '' });
		expect(res.status).toBe(400);
		expect(res.body?.error).toBe('VALIDATION_ERROR');
	});

	it('POST /pipeline/start computes weaviate_top_n as max(top_n*4, 500) and enqueues worker (emulator mode)', async () => {
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
		const fetchBody = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
		const pubsubMessage = fetchBody?.message;
		expect(typeof pubsubMessage?.data).toBe('string');

		const decoded = decodePubSubData(pubsubMessage.data);
		expect(decoded.job_id).toBe('job_http_2');
		expect(decoded.top_n).toBe(200);
		expect(decoded.llm_top_n).toBe(200);
		expect(decoded.weaviate_top_n).toBe(800);
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
		const decoded = decodePubSubData(fetchBody.message.data);
		expect(decoded.top_n).toBe(10);
		expect(decoded.weaviate_top_n).toBe(500);
	});
});
