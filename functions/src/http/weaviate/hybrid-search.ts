import { onRequest } from 'firebase-functions/v2/https';
import weaviate, { WeaviateClient } from 'weaviate-client';
import type { MultiTargetVectorJoin } from 'weaviate-client';
import type { WeaviateHybridSearchResponse, WeaviateSearchErrorResponse } from '../../types/weaviate-search.js';

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
 * Get DeepInfra API key from environment variables
 */
function getDeepInfraApiKey(): string {
  const apiKey = process.env.DEEPINFRA_API_KEY;
  if (!apiKey) {
    throw new Error('DEEPINFRA_API_KEY environment variable is required');
  }
  return apiKey;
}

/**
 * Get DeepInfra embedding model from environment variables
 */
function getDeepInfraModel(): string {
  return process.env.DEEPINFRA_EMBEDDING_MODEL || 'Qwen/Qwen3-Embedding-8B';
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
 * Generate embedding for a query using DeepInfra HTTP API
 */
async function generateEmbedding(query: string): Promise<number[]> {
  const apiKey = getDeepInfraApiKey();
  const model = getDeepInfraModel();
  
  const response = await fetch('https://api.deepinfra.com/v1/openai/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: query,
      model: model,
      encoding_format: 'float',
    }),
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DeepInfra API error: ${response.status} ${response.statusText} - ${errorText}`);
  }
  
  const data = await response.json();
  
  if (!data.data || !Array.isArray(data.data) || !data.data[0] || !data.data[0].embedding) {
    throw new Error('Failed to generate embedding from DeepInfra: invalid response format');
  }
  
  return data.data[0].embedding;
}

/**
 * HTTP Cloud Function to perform hybrid search (BM25 + vector) on Weaviate
 * 
 * GET /weaviate-hybrid-search?query=lifestyle&limit=10&alpha=0.5&min_followers=10000&max_followers=1000000&platform=instagram
 * 
 * Query parameters:
 * - query: Search term (default: "lifestyle")
 * - limit: Number of results to return (default: 10)
 * - alpha: Weight between BM25 and vector search (0=pure BM25, 1=pure vector, default: 0.5)
 * - min_followers: Minimum follower count filter (optional)
 * - max_followers: Maximum follower count filter (optional)
 * - platform: Platform filter - "instagram" or "tiktok" (optional, no filter by default)
 * 
 * Returns:
 * - 200: Search results
 * - 500: Search failed
 */
export const weaviateHybridSearch = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 60,
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
      const alpha = parseFloat((request.query.alpha as string) || '0.5');
      const minFollowersParam = request.query.min_followers as string | undefined;
      const maxFollowersParam = request.query.max_followers as string | undefined;
      const minFollowers = minFollowersParam ? parseInt(minFollowersParam, 10) : undefined;
      const maxFollowers = maxFollowersParam ? parseInt(maxFollowersParam, 10) : undefined;
      const platform = request.query.platform as string | undefined;

      console.log(`Performing hybrid search for "${searchQuery}" in collection "${collectionName}" with alpha=${alpha}${minFollowers !== undefined ? `, min_followers=${minFollowers}` : ''}${maxFollowers !== undefined ? `, max_followers=${maxFollowers}` : ''}${platform ? `, platform=${platform}` : ''}`);

      // Generate embedding for the query using DeepInfra
      console.log('Generating embedding with DeepInfra...');
      const embedding = await generateEmbedding(searchQuery);
      console.log(`Generated embedding with ${embedding.length} dimensions`);

      // Get the collection
      const collection = client.collections.get(collectionName);

      // Build target vector configuration (matching Python code: 50% profile, 30% hashtag, 20% post)
      // Using relative-score combination with weights: profile=2.5 (50%), hashtag=1.5 (30%), post=1.0 (20%)
      // Total = 5.0, so profile=50%, hashtag=30%, post=20%
      const targetVector: MultiTargetVectorJoin<any> = {
        combination: 'relative-score',
        targetVectors: ['profile', 'hashtag', 'post'] as any,
        weights: {
          profile: 2.5,
          hashtag: 1.5,
          post: 1.0,
        } as any,
      };

      // Build where filter for follower count and platform if provided
      let whereFilter: any = undefined;
      const conditions: any[] = [];
      
      // Add follower count filters
      if (minFollowers !== undefined) {
        conditions.push({
          path: ['followers'],
          operator: 'GreaterThanEqual',
          valueNumber: minFollowers,
        });
      }
      if (maxFollowers !== undefined) {
        conditions.push({
          path: ['followers'],
          operator: 'LessThanEqual',
          valueNumber: maxFollowers,
        });
      }
      
      // Add platform filter if provided
      if (platform) {
        conditions.push({
          path: ['platform'],
          operator: 'Equal',
          valueString: platform.toLowerCase(),
        });
      }
      
      // Combine conditions with AND if multiple conditions exist
      if (conditions.length === 1) {
        whereFilter = conditions[0];
      } else if (conditions.length > 1) {
        whereFilter = {
          operator: 'And',
          operands: conditions,
        };
      }

      // Perform hybrid search combining BM25 keyword search and vector search
      // For hybrid search with custom vector, use HybridNearVectorSubSearch format: { vector: embedding }
      const hybridQueryOptions: any = {
        vector: { vector: embedding }, // HybridNearVectorSubSearch format
        alpha: alpha, // 0 = pure BM25, 1 = pure vector, 0.5 = balanced
        limit: limit,
        targetVector: targetVector, // Required for collections with multiple named vectors
        queryProperties: ['biography', 'profile_text', 'post_text', 'hashtag_text'],
        returnMetadata: ['score'],
      };
      
      // Add where filter if provided
      if (whereFilter) {
        hybridQueryOptions.where = whereFilter;
      }
      
      const result = await collection.query.hybrid(searchQuery, hybridQueryOptions);

      // Format response
      const searchResults = result.objects || [];
      
      response.status(200).json({
        query: searchQuery,
        collection: collectionName,
        limit,
        alpha,
        embedding_model: getDeepInfraModel(),
        embedding_dimensions: embedding.length,
        count: searchResults.length,
        results: searchResults.map((item: any) => ({
          id: item.uuid,
          score: item.metadata?.score,
          distance: item.metadata?.distance,
          data: item.properties,
        })),
        timestamp: new Date().toISOString(),
      } as WeaviateHybridSearchResponse);
    } catch (error) {
      console.error('Hybrid search error:', error);
      response.status(500).json({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

