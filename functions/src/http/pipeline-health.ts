import { onRequest } from 'firebase-functions/v2/https';

/**
 * HTTP Cloud Function to keep the pipeline warm
 * This is a lightweight endpoint that can be pinged periodically
 * 
 * GET /pipeline-health
 * 
 * Returns:
 * - 200: Pipeline service is ready
 */
export const pipelineHealth = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 10,
    memory: '256MiB',
    minInstances: 1, // Keep this endpoint warm too
    invoker: 'private',
  },
  async (request, response) => {
    response.status(200).json({
      status: 'healthy',
      message: 'Pipeline service is ready',
      timestamp: new Date().toISOString(),
    });
  }
);

