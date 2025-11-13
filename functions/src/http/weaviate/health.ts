import { onRequest } from 'firebase-functions/v2/https';
import weaviate, { WeaviateClient } from 'weaviate-client';

let client: WeaviateClient | null = null;

/**
 * Get Weaviate URL from environment variables
 */
function getWeaviateURL(): string {
  const url = process.env.WEAVIATE_URL;
  if (!url) {
    throw new Error('WEAVIATE_URL environment variable is required');
  }
  // Ensure URL has protocol
  return url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`;
}

/**
 * Get Weaviate API key from environment variables
 */
function getWeaviateApiKey(): string {
  const apiKey = process.env.WEAVIATE_API_KEY;
  if (!apiKey) {
    throw new Error('WEAVIATE_API_KEY environment variable is required');
  }
  return apiKey;
}

/**
 * Get or create a singleton Weaviate client instance.
 * This ensures we reuse the connection across function invocations.
 */
async function getWeaviateClient(): Promise<WeaviateClient> {
  if (client) {
    // Check if client is still ready
    const isReady = await client.isReady();
    if (isReady) {
      return client;
    }
    // If not ready, reset and reconnect
    client = null;
  }

  // Get environment variables lazily
  const weaviateURL = getWeaviateURL();
  const weaviateApiKey = getWeaviateApiKey();

  // Create new client connection
  client = await weaviate.connectToWeaviateCloud(weaviateURL, {
    authCredentials: new weaviate.ApiKey(weaviateApiKey),
  });

  // Verify connection
  const isReady = await client.isReady();
  if (!isReady) {
    throw new Error('Failed to establish connection to Weaviate');
  }

  return client;
}

/**
 * Check if Weaviate client is ready
 */
async function isWeaviateReady(): Promise<boolean> {
  try {
    const client = await getWeaviateClient();
    return await client.isReady();
  } catch (error) {
    console.error('Weaviate readiness check failed:', error);
    return false;
  }
}

/**
 * HTTP Cloud Function to check Weaviate connection health
 * 
 * GET /weaviate-health
 * 
 * Returns:
 * - 200: Connection is healthy
 * - 500: Connection failed
 */
export const test_weaviateHealth = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 10,
    memory: '256MiB',
    invoker: 'private',
  },
  async (request, response) => {
    try {
      const isReady = await isWeaviateReady();
      
      if (isReady) {
        const client = await getWeaviateClient();
        response.status(200).json({
          status: 'healthy',
          message: 'Weaviate client is ready',
          timestamp: new Date().toISOString(),
        });
      } else {
        response.status(500).json({
          status: 'unhealthy',
          message: 'Weaviate client is not ready',
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      console.error('Weaviate health check error:', error);
      response.status(500).json({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      });
    }
  }
);
