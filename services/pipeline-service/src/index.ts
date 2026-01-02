import { createApp, type StartupHealthCheck } from './app.js';
import { getOrInitAdminApp, resolvedFirebaseProjectId, resolvedStorageBucketName } from './utils/firebase-admin.js';
import { runHealthChecks } from './utils/health-check.js';
import { createLogger } from './utils/logger.js';

// Initialize Firebase Admin (required for Firestore operations)
getOrInitAdminApp();

// Run health checks once on startup
let startupHealthCheck: StartupHealthCheck = null;
(async () => {
  const logger = createLogger({ component: 'startup' });
  try {
    // Log GCP/Firebase configuration
    const projectId = resolvedFirebaseProjectId || process.env.GOOGLE_CLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'not configured';
    const storageBucket = resolvedStorageBucketName || process.env.STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET || 'not configured';
    const weaviateUrl = process.env.WEAVIATE_URL || 'not configured';
    const brightdataBaseUrl = process.env.BRIGHTDATA_BASE_URL || 'not configured';
    
    const openaiModel = process.env.OPENAI_MODEL || 'gpt-5-nano';
    const deepinfraModel = process.env.DEEPINFRA_EMBEDDING_MODEL || 'Qwen/Qwen3-Embedding-8B';

    logger.info('startup_configuration', {
      project_id: projectId,
      storage_bucket: storageBucket,
      weaviate_url: weaviateUrl,
      brightdata_base_url: brightdataBaseUrl,
      openai_model: openaiModel,
      deepinfra_embedding_model: deepinfraModel,
      max_concurrent_weaviate_searches: process.env.MAX_CONCURRENT_WEAVIATE_SEARCHES || '12',
      max_concurrent_llm_requests: process.env.MAX_CONCURRENT_LLM_REQUESTS || '20',
    });

    logger.info('startup_health_checks_begin');
    const summary = await runHealthChecks();
    startupHealthCheck = {
      summary,
      timestamp: new Date(),
    };
    if (summary.allHealthy) {
      logger.info('startup_health_checks_ok');
    } else {
      logger.warn('startup_health_checks_degraded', {
        errors: summary.errors,
      });
    }
  } catch (error) {
    logger.error('startup_health_checks_failed', { error });
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

const app = createApp({ getStartupHealthCheck: () => startupHealthCheck });

// Get port from environment (Cloud Run provides this) or default to 8080
const port = process.env.PORT || 8080;

const server = app.listen(port, () => {
  createLogger({ component: 'startup' }).info('server_listening', { port });
});

// Graceful shutdown handler for SIGTERM (Cloud Run sends this on shutdown)
process.on('SIGTERM', () => {
  const logger = createLogger({ component: 'startup' });
  logger.info('shutdown_signal_received', { signal: 'SIGTERM' });
  server.close(() => {
    logger.info('server_closed');
    process.exit(0);
  });
});
