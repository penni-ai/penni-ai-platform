import express from 'express';
import { handlePipelineStart } from './handlers/orchestrator.js';
import { handlePipelineExecution } from './handlers/worker.js';
import { getOrInitAdminApp, resolvedFirebaseProjectId, resolvedStorageBucketName } from './utils/firebase-admin.js';
import { runHealthChecks } from './utils/health-check.js';

// Initialize Firebase Admin (required for Firestore operations)
getOrInitAdminApp();

// Run health checks once on startup
let startupHealthCheck: { summary: any; timestamp: Date } | null = null;
(async () => {
  try {
    // Log GCP/Firebase configuration
    const projectId = resolvedFirebaseProjectId || process.env.GOOGLE_CLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'not configured';
    const storageBucket = resolvedStorageBucketName || process.env.STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET || 'not configured';
    const pubsubTopic = process.env.PUBSUB_TOPIC_NAME || 'pipeline.start';
    const weaviateUrl = process.env.WEAVIATE_URL || 'not configured';
    const brightdataBaseUrl = process.env.BRIGHTDATA_BASE_URL || 'not configured';
    
    console.log('[Startup] GCP/Firebase Configuration:');
    console.log(`  Project ID: ${projectId}`);
    console.log(`  Storage Bucket: ${storageBucket}`);
    console.log(`  Pub/Sub Topic: ${pubsubTopic}`);
    console.log('');
    
    console.log('[Startup] External Services:');
    console.log(`  Weaviate URL: ${weaviateUrl}`);
    console.log(`  BrightData Base URL: ${brightdataBaseUrl}`);
    console.log('');
    
    // Log model configuration
    const openaiModel = process.env.OPENAI_MODEL || 'gpt-5-nano';
    const deepinfraModel = process.env.DEEPINFRA_EMBEDDING_MODEL || 'Qwen/Qwen3-Embedding-8B';
    console.log('[Startup] Model Configuration:');
    console.log(`  OpenAI Model: ${openaiModel}`);
    console.log(`  DeepInfra Embedding Model: ${deepinfraModel}`);
    console.log(`  Max Concurrent Weaviate Searches: ${process.env.MAX_CONCURRENT_WEAVIATE_SEARCHES || '12'}`);
    console.log(`  Max Concurrent LLM Requests: ${process.env.MAX_CONCURRENT_LLM_REQUESTS || '20'}`);
    console.log('');
    
    console.log('[Startup] Running initial health checks...');
    const summary = await runHealthChecks();
    startupHealthCheck = {
      summary,
      timestamp: new Date(),
    };
    if (summary.allHealthy) {
      console.log('[Startup] ✅ All health checks passed - service ready');
    } else {
      console.warn('[Startup] ⚠️  Some health checks failed, but service will continue');
      summary.errors.forEach((error: any) => {
        console.warn(`  ❌ ${error.service}: ${error.message}`);
      });
    }
  } catch (error) {
    console.error('[Startup] ❌ Health check failed during startup:', error);
    startupHealthCheck = {
      summary: {
        allHealthy: false,
        checks: [],
        errors: [{ service: 'Startup', message: error instanceof Error ? error.message : String(error) }],
      },
      timestamp: new Date(),
    };
  }
})();

const app = express();

// JSON body parser middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Basic request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`, {
    headers: {
      'content-type': req.headers['content-type'],
      'user-agent': req.headers['user-agent'],
    },
  });
  next();
});

// Health check endpoint (returns cached startup health check results)
app.get('/health', async (req, res) => {
  try {
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
              message: c.message,
            })),
          },
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
              message: c.message,
            })),
            errors: summary.errors.map((e: any) => ({
              service: e.service,
              message: e.message,
            })),
          },
        });
      }
    } else {
      // Health checks still running
      res.status(503).json({
        status: 'initializing',
        timestamp: new Date().toISOString(),
        service: 'pipeline-service',
        message: 'Health checks are still running during startup',
      });
    }
  } catch (error) {
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      service: 'pipeline-service',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// HTTP orchestrator endpoint: POST /pipeline/start
app.post('/pipeline/start', async (req, res) => {
  try {
    await handlePipelineStart(req, res);
  } catch (error) {
    console.error('[Index] Error in /pipeline/start handler:', error);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'Failed to process pipeline start request',
        request_id: req.body?.request_id || 'unknown',
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
      console.error('[Index] Invalid Pub/Sub message format:', req.body);
      res.status(400).json({
        error: 'INVALID_MESSAGE_FORMAT',
        message: 'Invalid Pub/Sub message format',
      });
      return;
    }

    // Decode base64 message data
    let messageData: any;
    try {
      const decodedData = Buffer.from(pubsubMessage.data, 'base64').toString('utf-8');
      messageData = JSON.parse(decodedData);
    } catch (error) {
      console.error('[Index] Failed to decode Pub/Sub message:', error);
      res.status(400).json({
        error: 'INVALID_MESSAGE_DATA',
        message: 'Failed to decode Pub/Sub message data',
      });
      return;
    }

    console.log(`[Index] Pub/Sub message: ${messageData.job_id}`);

    // Execute pipeline asynchronously (don't await - Pub/Sub expects quick ack)
    handlePipelineExecution(messageData).catch((error) => {
      console.error('[Index] Pipeline execution failed:', {
        job_id: messageData.job_id,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    // Return 204 No Content immediately (Pub/Sub expects quick acknowledgment)
    res.status(204).send();
  } catch (error) {
    console.error('[Index] Error in /pubsub/pipeline-start handler:', error);
    // Return 204 even on error to avoid Pub/Sub retries for permanent failures
    // Errors are logged and job status is updated in Firestore
    res.status(204).send();
  }
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[Index] Unhandled error:', err);
  if (!res.headersSent) {
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      request_id: req.body?.request_id || 'unknown',
    });
  }
});

// Get port from environment (Cloud Run provides this) or default to 8080
const port = process.env.PORT || 8080;

const server = app.listen(port, () => {
  console.log(`Pipeline service listening on port ${port}`);
});

// Graceful shutdown handler for SIGTERM (Cloud Run sends this on shutdown)
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
