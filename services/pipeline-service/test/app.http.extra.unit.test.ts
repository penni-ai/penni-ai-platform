import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

const handlePipelineStart = vi.fn(async (_req: any, res: any) => {
	res.status(202).json({ ok: true });
});
const handlePipelineExecution = vi.fn(async () => {});
const processEmailQueueBatch = vi.fn(async () => ({
	totalProcessed: 0,
	totalSucceeded: 0,
	totalFailed: 0,
	results: [],
	duration: 1
}));

vi.mock('../dist/handlers/orchestrator.js', () => ({
	handlePipelineStart: (...args: any[]) => handlePipelineStart(...args)
}));

vi.mock('../dist/handlers/worker.js', () => ({
	handlePipelineExecution: (...args: any[]) => handlePipelineExecution(...args)
}));

vi.mock('../dist/handlers/email-queue-cron.js', () => ({
	processEmailQueueBatch: (...args: any[]) => processEmailQueueBatch(...args)
}));

describe('pipeline-service HTTP app (extra)', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
	});

	it('GET /health returns initializing when no startup health check yet', async () => {
		const { createApp } = await import('../dist/app.js');
		const app = createApp({ getStartupHealthCheck: () => null });

		const res = await request(app).get('/health');
		expect(res.status).toBe(503);
		expect(res.body?.status).toBe('initializing');
	});

	it('GET /health returns ok when startup health check is healthy', async () => {
		const { createApp } = await import('../dist/app.js');
		const app = createApp({
			getStartupHealthCheck: () => ({
				summary: {
					allHealthy: true,
					checks: [{ service: 'firestore', status: 'ok', message: 'ready' }],
					errors: []
				},
				timestamp: new Date('2025-01-01T00:00:00.000Z')
			})
		});

		const res = await request(app).get('/health');
		expect(res.status).toBe(200);
		expect(res.body?.status).toBe('ok');
		expect(res.body?.health?.allHealthy).toBe(true);
	});

	it('GET /health returns degraded when startup health check reports errors', async () => {
		const { createApp } = await import('../dist/app.js');
		const app = createApp({
			getStartupHealthCheck: () => ({
				summary: {
					allHealthy: false,
					checks: [{ service: 'firestore', status: 'error', message: 'down' }],
					errors: [{ service: 'firestore', message: 'down' }]
				},
				timestamp: new Date('2025-01-01T00:00:00.000Z')
			})
		});

		const res = await request(app).get('/health');
		expect(res.status).toBe(503);
		expect(res.body?.status).toBe('degraded');
		expect(res.body?.health?.allHealthy).toBe(false);
	});

	it('GET /health returns 500 when startup health check throws', async () => {
		const { createApp } = await import('../dist/app.js');
		const app = createApp({
			getStartupHealthCheck: () => {
				throw new Error('boom');
			}
		});

		const res = await request(app).get('/health');
		expect(res.status).toBe(500);
		expect(res.body?.status).toBe('error');
		expect(String(res.body?.error)).toContain('boom');
	});

	it('POST /cron/process-email-queue returns ok with result', async () => {
		processEmailQueueBatch.mockResolvedValueOnce({
			totalProcessed: 2,
			totalSucceeded: 2,
			totalFailed: 0,
			results: [],
			duration: 10
		});

		const { createApp } = await import('../dist/app.js');
		const app = createApp();

		const res = await request(app).post('/cron/process-email-queue').send({});
		expect(res.status).toBe(200);
		expect(res.body?.status).toBe('ok');
		expect(res.body?.result?.totalProcessed).toBe(2);
	});

	it('POST /cron/process-email-queue returns 500 on handler error', async () => {
		processEmailQueueBatch.mockRejectedValueOnce(new Error('boom'));

		const { createApp } = await import('../dist/app.js');
		const app = createApp();

		const res = await request(app).post('/cron/process-email-queue').send({});
		expect(res.status).toBe(500);
		expect(res.body?.status).toBe('error');
	});

	it('POST /pipeline/start returns 500 when orchestrator throws', async () => {
		handlePipelineStart.mockImplementationOnce(async () => {
			throw new Error('orchestrator failed');
		});

		const { createApp } = await import('../dist/app.js');
		const app = createApp();

		const res = await request(app).post('/pipeline/start').send({ request_id: 'r1' });
		expect(res.status).toBe(500);
		expect(res.body?.error).toBe('INTERNAL_ERROR');
	});

	it('error middleware returns 500 for unhandled errors', async () => {
		const { createApp } = await import('../dist/app.js');
		const app = createApp({
			registerRoutes: (app) => {
				app.get('/boom', (_req, _res, next) => next(new Error('boom')));
			}
		});
		const res = await request(app).get('/boom');
		expect(res.status).toBe(500);
		expect(res.body?.error).toBe('INTERNAL_ERROR');
	});
});
