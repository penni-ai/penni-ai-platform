import express from 'express';

import { handlePipelineStart } from './handlers/orchestrator.js';
import { handlePipelineExecution } from './handlers/worker.js';
import { processEmailQueueBatch } from './handlers/email-queue-cron.js';

export type StartupHealthCheck = { summary: any; timestamp: Date } | null;

export function createApp(options?: {
	getStartupHealthCheck?: () => StartupHealthCheck;
	registerRoutes?: (app: express.Express) => void;
}) {
	const app = express();
	const getStartupHealthCheck = options?.getStartupHealthCheck ?? (() => null);
	const registerRoutes = options?.registerRoutes;

	// JSON body parser middleware
	app.use(express.json());
	app.use(express.urlencoded({ extended: true }));

	// Basic request logging middleware
	app.use((req, _res, next) => {
		console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`, {
			headers: {
				'content-type': req.headers['content-type'],
				'user-agent': req.headers['user-agent']
			}
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
		try {
			await handlePipelineStart(req, res);
		} catch (error) {
			console.error('[App] Error in /pipeline/start handler:', error);
			if (!res.headersSent) {
				res.status(500).json({
					error: 'INTERNAL_ERROR',
					message: 'Failed to process pipeline start request',
					request_id: req.body?.request_id || 'unknown'
				});
			}
		}
	});

	// Pub/Sub worker endpoint: POST /pubsub/pipeline-start
	app.post('/pubsub/pipeline-start', async (req, res) => {
		try {
			// Parse Pub/Sub message format
			// Pub/Sub sends messages in format: { message: { data: base64_encoded_json, attributes: {...} } }
			const pubsubMessage = req.body?.message;

			if (!pubsubMessage || !pubsubMessage.data) {
				console.error('[App] Invalid Pub/Sub message format:', req.body);
				res.status(400).json({
					error: 'INVALID_MESSAGE_FORMAT',
					message: 'Invalid Pub/Sub message format'
				});
				return;
			}

			// Decode base64 message data
			let messageData: any;
			try {
				const decodedData = Buffer.from(pubsubMessage.data, 'base64').toString('utf-8');
				messageData = JSON.parse(decodedData);
			} catch (error) {
				console.error('[App] Failed to decode Pub/Sub message:', error);
				res.status(400).json({
					error: 'INVALID_MESSAGE_DATA',
					message: 'Failed to decode Pub/Sub message data'
				});
				return;
			}

			console.log(`[App] Pub/Sub message: ${messageData.job_id}`);

			// Execute pipeline asynchronously (don't await - Pub/Sub expects quick ack)
			handlePipelineExecution(messageData).catch((error) => {
				console.error('[App] Pipeline execution failed:', {
					job_id: messageData.job_id,
					error: error instanceof Error ? error.message : String(error)
				});
			});

			// Return 204 No Content immediately (Pub/Sub expects quick acknowledgment)
			res.status(204).send();
		} catch (error) {
			console.error('[App] Error in /pubsub/pipeline-start handler:', error);
			// Return 204 even on error to avoid Pub/Sub retries for permanent failures
			// Errors are logged and job status is updated in Firestore
			res.status(204).send();
		}
	});

	// Cron endpoint for processing email queue: POST /cron/process-email-queue
	// Called by Cloud Scheduler every 15 minutes
	app.post('/cron/process-email-queue', async (_req, res) => {
		try {
			console.log('[App] Email queue cron job triggered');

			// Process the email queue batch
			const result = await processEmailQueueBatch();

			console.log('[App] Email queue cron job completed:', {
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
			console.error('[App] Error in /cron/process-email-queue handler:', error);
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
		console.error('[App] Unhandled error:', err);
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
