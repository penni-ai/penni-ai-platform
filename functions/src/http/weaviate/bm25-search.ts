import { onRequest } from 'firebase-functions/v2/https';
import weaviate, { WeaviateClient } from 'weaviate-client';
import type { WeaviateBm25SearchResponse, WeaviateSearchErrorResponse } from '../../types/weaviate-search.js';

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
 * Get Weaviate collection name from environment variables
 */
function getWeaviateCollectionName(): string {
  const collectionName = process.env.WEAVIATE_COLLECTION_NAME || 'influencer_profiles';
  return collectionName;
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
 * HTTP Cloud Function to perform BM25 keyword search for "lifestyle"
 * 
 * GET /weaviate-bm25-search?query=lifestyle&limit=10
 * 
 * Query parameters:
 * - query: Search term (default: "lifestyle")
 * - limit: Number of results to return (default: 10)
 * 
 * Returns:
 * - 200: Search results
 * - 500: Search failed
 */
export const test_weaviateBm25Search = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 30,
    memory: '512MiB',
    invoker: 'private',
  },
  async (request, response) => {
    try {
      const client = await getWeaviateClient();
      const collectionName = getWeaviateCollectionName();
      
      // Get query parameters
      const searchQuery = (request.query.query as string) || 'lifestyle';
      const limit = parseInt((request.query.limit as string) || '10', 10);

      console.log(`Performing BM25 search for "${searchQuery}" in collection "${collectionName}"`);

      // Get the collection
      const collection = client.collections.get(collectionName);

      // Perform BM25 search
      const result = await collection.query.bm25(searchQuery, {
        limit: limit,
      });

      // Format response
      const searchResults = result.objects || [];
      
      response.status(200).json({
        query: searchQuery,
        collection: collectionName,
        limit,
        count: searchResults.length,
        results: searchResults.map((item: any) => ({
          id: item.uuid,
          score: item.metadata?.score,
          distance: item.metadata?.distance,
          data: item.properties,
        })),
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('BM25 search error:', error);
      response.status(500).json({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

