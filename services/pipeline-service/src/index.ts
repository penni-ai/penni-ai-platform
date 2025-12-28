import { createApp, type StartupHealthCheck } from './app.js';
import { getOrInitAdminApp, resolvedFirebaseProjectId, resolvedStorageBucketName } from './utils/firebase-admin.js';
import { runHealthChecks } from './utils/health-check.js';

// Initialize Firebase Admin (required for Firestore operations)
getOrInitAdminApp();

// Run health checks once on startup
let startupHealthCheck: StartupHealthCheck = null;
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

const app = createApp({ getStartupHealthCheck: () => startupHealthCheck });

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
