import express from 'express';

import { handlePipelineStart } from './handlers/orchestrator.js';
import { processEmailQueueBatch } from './handlers/email-queue-cron.js';
import { handlePipelineBatchTask, handlePipelinePollTask, handlePipelineStageTask } from './handlers/tasks.js';
import { buildRequestContext, createLogger } from './utils/logger.js';

export type StartupHealthCheck = { summary: any; timestamp: Date } | null;

export function createApp(options?: {
	getStartupHealthCheck?: () => StartupHealthCheck;
	registerRoutes?: (app: express.Express) => void;
}) {
	const app = express();
	const getStartupHealthCheck = options?.getStartupHealthCheck ?? (() => null);
	const registerRoutes = options?.registerRoutes;
	const appLogger = createLogger({ component: 'app' });

	// JSON body parser middleware
	app.use(express.json());
	app.use(express.urlencoded({ extended: true }));

	// Basic request logging middleware
	app.use((req, res, next) => {
		const context = buildRequestContext(req);
		const logger = appLogger.child({ component: 'http', ...context });
		req.logger = logger;
		req.requestId = typeof context.request_id === 'string' ? context.request_id : undefined;
		const start = process.hrtime.bigint();

		res.on('finish', () => {
			const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
			logger.info('request_complete', {
				status: res.statusCode,
				duration_ms: Math.round(durationMs),
				httpRequest: {
					requestMethod: req.method,
					requestUrl: req.originalUrl,
					status: res.statusCode,
					userAgent: req.headers['user-agent'],
					latency: `${durationMs.toFixed(1)}ms`
				}
			});
		});

		next();
	});

	// Health check endpoint (returns cached startup health check results)
	app.get('/health', async (_req, res) => {
		try {
			const startupHealthCheck = getStartupHealthCheck();

			// Return cached startup health check results
			if (startupHealthCheck) {
				const { summary, timestamp } = startupHealthCheck;
				if (summary.allHealthy) {
					res.json({
						status: 'ok',
						timestamp: new Date().toISOString(),
						service: 'pipeline-service',
						healthCheckTimestamp: timestamp.toISOString(),
						health: {
							allHealthy: true,
							checks: summary.checks.map((c: any) => ({
								service: c.service,
								status: c.status,
								message: c.message
							}))
						}
					});
				} else {
					res.status(503).json({
						status: 'degraded',
						timestamp: new Date().toISOString(),
						service: 'pipeline-service',
						healthCheckTimestamp: timestamp.toISOString(),
						health: {
							allHealthy: false,
							checks: summary.checks.map((c: any) => ({
								service: c.service,
								status: c.status,
								message: c.message
							})),
							errors: summary.errors.map((e: any) => ({
								service: e.service,
								message: e.message
							}))
						}
					});
				}
			} else {
				// Health checks still running
				res.status(503).json({
					status: 'initializing',
					timestamp: new Date().toISOString(),
					service: 'pipeline-service',
					message: 'Health checks are still running during startup'
				});
			}
		} catch (error) {
			res.status(500).json({
				status: 'error',
				timestamp: new Date().toISOString(),
				service: 'pipeline-service',
				error: error instanceof Error ? error.message : 'Unknown error'
			});
		}
	});

	// HTTP orchestrator endpoint: POST /pipeline/start
	app.post('/pipeline/start', async (req, res) => {
		const logger = req.logger?.child({ component: 'orchestrator', action: 'pipeline_start' }) ?? appLogger;
		try {
			await handlePipelineStart(req, res);
		} catch (error) {
			logger.error('pipeline_start_handler_failed', { error });
			if (!res.headersSent) {
				res.status(500).json({
					error: 'INTERNAL_ERROR',
					message: 'Failed to process pipeline start request',
					request_id: req.body?.request_id || 'unknown'
				});
			}
		}
	});

	// Cloud Tasks handlers (run-to-completion pipeline tasks)
	app.post('/tasks/pipeline-stage', async (req, res) => {
		const logger = req.logger?.child({ component: 'tasks', action: 'pipeline_stage' }) ?? appLogger;
		try {
			await handlePipelineStageTask(req, res);
		} catch (error) {
			logger.error('pipeline_stage_handler_failed', { error });
			if (!res.headersSent) {
				res.status(500).json({
					error: 'INTERNAL_ERROR',
					message: 'Failed to process pipeline stage task',
				});
			}
		}
	});

	app.post('/tasks/pipeline-batch', async (req, res) => {
		const logger = req.logger?.child({ component: 'tasks', action: 'pipeline_batch' }) ?? appLogger;
		try {
			await handlePipelineBatchTask(req, res);
		} catch (error) {
			logger.error('pipeline_batch_handler_failed', { error });
			if (!res.headersSent) {
				res.status(500).json({
					error: 'INTERNAL_ERROR',
					message: 'Failed to process pipeline batch task',
				});
			}
		}
	});

	app.post('/tasks/pipeline-poll', async (req, res) => {
		const logger = req.logger?.child({ component: 'tasks', action: 'pipeline_poll' }) ?? appLogger;
		try {
			await handlePipelinePollTask(req, res);
		} catch (error) {
			logger.error('pipeline_poll_handler_failed', { error });
			if (!res.headersSent) {
				res.status(500).json({
					error: 'INTERNAL_ERROR',
					message: 'Failed to process pipeline poll task',
				});
			}
		}
	});

	// Cron endpoint for processing email queue: POST /cron/process-email-queue
	// Called by Cloud Scheduler every 15 minutes
	app.post('/cron/process-email-queue', async (_req, res) => {
		const logger = appLogger.child({ component: 'email_queue', action: 'process_email_queue' });
		try {
			logger.info('email_queue_cron_triggered');

			// Process the email queue batch
			const result = await processEmailQueueBatch();

			logger.info('email_queue_cron_completed', {
				totalProcessed: result.totalProcessed,
				totalSucceeded: result.totalSucceeded,
				totalFailed: result.totalFailed,
				duration: result.duration
			});

			res.json({
				status: 'ok',
				timestamp: new Date().toISOString(),
				result
			});
		} catch (error) {
			logger.error('email_queue_cron_failed', { error });
			res.status(500).json({
				status: 'error',
				timestamp: new Date().toISOString(),
				error: error instanceof Error ? error.message : 'Unknown error'
			});
		}
	});

	// Allow tests (or advanced callers) to register additional routes before error handling middleware
	if (registerRoutes) {
		registerRoutes(app);
	}

	// Error handling middleware
	app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
		const logger = req.logger?.child({ component: 'app', action: 'error_middleware' }) ?? appLogger;
		logger.error('unhandled_error', { error: err });
		if (!res.headersSent) {
			res.status(500).json({
				error: 'INTERNAL_ERROR',
				message: 'An unexpected error occurred',
				request_id: req.body?.request_id || 'unknown'
			});
		}
	});

	return app;
}
