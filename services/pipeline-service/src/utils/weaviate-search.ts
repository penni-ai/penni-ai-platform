/**
 * Shared Weaviate search utilities
 * Used by both HTTP functions and pipeline functions
 */

import weaviate, { type WeaviateClient } from 'weaviate-client';
import type { MultiTargetVectorJoin } from 'weaviate-client';
import type { WeaviateHybridSearchResponse } from '../types/weaviate-search.js';

let cachedWeaviateClient: WeaviateClient | null = null;
let clientInitPromise: Promise<WeaviateClient> | null = null;

const MAX_CONCURRENT_SEARCHES = Number(process.env.MAX_CONCURRENT_WEAVIATE_SEARCHES || 24);
const DEFAULT_WEAVIATE_TIMEOUT_MS = 120_000;

/**
 * Get Weaviate URL from environment variables
 */
function getWeaviateURL(): string {
  const url = process.env.WEAVIATE_URL;
  if (!url) {
    throw new Error('WEAVIATE_URL environment variable is required');
  }
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
 * Get or create a singleton Weaviate client instance with mutex protection.
 */
export async function getWeaviateClientInstance(): Promise<WeaviateClient> {
  // If client exists and is ready, return it immediately
  if (cachedWeaviateClient) {
    const isReady = await cachedWeaviateClient.isReady();
    if (isReady) {
      return cachedWeaviateClient;
    }
    // Client not ready, reset it
    cachedWeaviateClient = null;
    clientInitPromise = null;
  }

  // If initialization is already in progress, wait for it
  if (clientInitPromise) {
    return clientInitPromise;
  }

  // Start new initialization (with mutex protection)
  clientInitPromise = (async () => {
    try {
      const timeoutMs = Number(process.env.WEAVIATE_REQUEST_TIMEOUT_MS || DEFAULT_WEAVIATE_TIMEOUT_MS);

      const client = await weaviate.connectToWeaviateCloud(getWeaviateURL(), {
        authCredentials: new weaviate.ApiKey(getWeaviateApiKey()),
        timeout: {
          init: timeoutMs,
          insert: timeoutMs,
          query: timeoutMs,
        },
      });

      const ready = await client.isReady();
      if (!ready) {
        throw new Error('Failed to establish connection to Weaviate');
      }

      cachedWeaviateClient = client;
      return client;
    } finally {
      // Clear the promise once initialization completes (success or failure)
      clientInitPromise = null;
    }
  })();

  return clientInitPromise;
}

/**
 * Generate embedding for a query using DeepInfra HTTP API
 */
export async function generateQueryEmbedding(query: string): Promise<number[]> {
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
 * Generate embeddings for multiple queries in a single batch request using DeepInfra HTTP API
 * This is much more efficient than generating embeddings one at a time
 */
export async function generateQueryEmbeddingsBatch(queries: string[]): Promise<Map<string, number[]>> {
  if (queries.length === 0) {
    return new Map();
  }
  
  const apiKey = getDeepInfraApiKey();
  const model = getDeepInfraModel();
  
  const response = await fetch('https://api.deepinfra.com/v1/openai/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: queries, // Array of strings
      model: model,
      encoding_format: 'float',
    }),
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DeepInfra API error: ${response.status} ${response.statusText} - ${errorText}`);
  }
  
  const data = await response.json();
  
  if (!data.data || !Array.isArray(data.data) || data.data.length !== queries.length) {
    throw new Error(`Failed to generate embeddings from DeepInfra: expected ${queries.length} embeddings, got ${data.data?.length || 0}`);
  }
  
  // Create a map of query -> embedding
  const embeddingMap = new Map<string, number[]>();
  for (let i = 0; i < queries.length; i++) {
    const query = queries[i];
    const embeddingData = data.data[i];
    if (query && embeddingData && embeddingData.embedding) {
      embeddingMap.set(query, embeddingData.embedding);
    }
  }
  
  return embeddingMap;
}

/**
 * Target vector configuration (50% profile, 30% hashtag, 20% post)
 */
export const HYBRID_TARGET_VECTOR: MultiTargetVectorJoin<any> = {
  combination: 'relative-score',
  targetVectors: ['profile', 'hashtag', 'post'] as any,
  weights: {
    profile: 2.5,
    hashtag: 1.5,
    post: 1.0,
  } as any,
};

/**
 * Perform a single hybrid search on Weaviate
 * @param embeddingMap Optional map of query -> embedding for batch optimization
 * @param excludeProfileUrls Optional array of profile URLs to exclude from results
 */
export async function performSingleHybridSearch(
  query: string,
  alpha: number,
  limit: number,
  minFollowers?: number | null,
  maxFollowers?: number | null,
  platform?: string | null,
  embeddingMap?: Map<string, number[]>,
  excludeProfileUrls?: string[] | null
): Promise<WeaviateHybridSearchResponse> {
  const client = await getWeaviateClientInstance();
  const collectionName = getWeaviateCollectionName();
  
  // Use cached embedding if available, otherwise generate it
  let embedding: number[];
  if (embeddingMap && embeddingMap.has(query)) {
    embedding = embeddingMap.get(query)!;
  } else {
    embedding = await generateQueryEmbedding(query);
  }
  
  // Get the collection
  const collection = client.collections.get(collectionName);
  
  // Build where filter for follower count, platform, and exclusions
  let whereFilter: any = undefined;
  const conditions: any[] = [];
  
  if (minFollowers !== undefined && minFollowers !== null) {
    conditions.push({
      path: ['followers'],
      operator: 'GreaterThanEqual',
      valueNumber: minFollowers,
    });
  }
  if (maxFollowers !== undefined && maxFollowers !== null) {
    conditions.push({
      path: ['followers'],
      operator: 'LessThanEqual',
      valueNumber: maxFollowers,
    });
  }
  if (platform && platform.trim()) {
    conditions.push({
      path: ['platform'],
      operator: 'Equal',
      valueString: platform.toLowerCase(),
    });
  }
  
  // Exclude previously found profiles by profile_url
  // Weaviate supports ContainsAny for arrays but for text fields we need to use multiple NotEqual conditions
  // However, for large exclusion lists, we'll filter post-query to avoid performance issues
  // Weaviate v4 supports "NotEqual" with ContainsAny for text fields via a workaround
  // For now, we increase the limit and filter client-side for better reliability
  const hasExclusions = excludeProfileUrls && excludeProfileUrls.length > 0;
  const adjustedLimit = hasExclusions ? limit + excludeProfileUrls.length : limit;
  
  // Combine conditions with AND if multiple conditions exist
  if (conditions.length === 1) {
    whereFilter = conditions[0];
  } else if (conditions.length > 1) {
    whereFilter = {
      operator: 'And',
      operands: conditions,
    };
  }
  
  // Perform hybrid search
  // Return fields needed for BrightData collection and preliminary display
  // Include display_name, biography, and followers for preliminary candidate preview
  const hybridQueryOptions: any = {
    vector: { vector: embedding },
    alpha: alpha,
    limit: adjustedLimit, // Use adjusted limit to account for exclusions
    targetVector: HYBRID_TARGET_VECTOR,
    queryProperties: ['biography', 'profile_text', 'post_text', 'hashtag_text'],
    returnMetadata: ['score', 'distance'],
    return: ['profile_url', 'platform', 'display_name', 'biography', 'followers'], // Include fields for preliminary preview
  };
  
  if (whereFilter) {
    hybridQueryOptions.where = whereFilter;
  }
  
  const result = await collection.query.hybrid(query, hybridQueryOptions);
  let objects = result.objects || [];
  
  // Filter out excluded profile URLs client-side
  // This is more reliable than complex Weaviate filters for large exclusion lists
  if (hasExclusions) {
    const excludeSet = new Set(excludeProfileUrls!.map(url => url.toLowerCase()));
    objects = objects.filter((item: any) => {
      const profileUrl = item.properties?.profile_url;
      return !profileUrl || !excludeSet.has(profileUrl.toLowerCase());
    });
    // Trim to original limit after filtering
    objects = objects.slice(0, limit);
  }
  
  return {
    query,
    collection: collectionName,
    limit,
    alpha,
    embedding_model: getDeepInfraModel(),
    embedding_dimensions: embedding.length,
    count: objects.length,
    results: objects.map((item: any) => ({
      id: item.uuid,
      score: item.metadata?.score,
      distance: item.metadata?.distance,
      data: {
        profile_url: item.properties?.profile_url,
        platform: item.properties?.platform,
        display_name: item.properties?.display_name,
        biography: item.properties?.biography,
        followers: item.properties?.followers,
      },
    })),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Deduplicate search results by profile URL, keeping the highest score for each profile
 */
export function deduplicateResults(results: any[]): any[] {
  const profileMap = new Map<string, any>();

  for (const result of results) {
    const profileUrl = result.data?.profile_url || result.profile_url || result.url;
    if (!profileUrl) continue;

    const score = result.score || result.metadata?.score || 0;
    const existing = profileMap.get(profileUrl);

    // Keep the result with the highest score
    if (!existing || score > (existing.score || existing.metadata?.score || 0)) {
      profileMap.set(profileUrl, result);
    }
  }

  // Convert map to array and sort by score (descending)
  const deduplicated = Array.from(profileMap.values());
  deduplicated.sort((a, b) => {
    const scoreA = a.score || a.metadata?.score || 0;
    const scoreB = b.score || b.metadata?.score || 0;
    return scoreB - scoreA; // Descending order (highest first)
  });

  return deduplicated;
}

/**
 * Sleep utility for batching delays
 */
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Perform parallel hybrid searches with batching
 * @param excludeProfileUrls Optional array of profile URLs to exclude from results (for "find more" functionality)
 */
export async function performParallelHybridSearches(
  keywords: string[],
  alphas: number[],
  limit: number,
  minFollowers?: number | null,
  maxFollowers?: number | null,
  platform?: string | null,
  timingTracker?: import('./timing-tracker.js').PipelineTimingTracker,
  onProgressUpdate?: (stage: 'embedding_generation' | 'searches_complete') => Promise<void>,
  excludeProfileUrls?: string[] | null
): Promise<{
  allSearchResults: WeaviateHybridSearchResponse[];
  deduplicatedResults: any[];
  queriesExecuted: number;
  batchTimings: Array<{ batchNumber: number; durationMs: number; searchesInBatch: number }>;
  totalRuntimeMs: number;
}> {
  const startTime = Date.now();
  
  // Initialize Weaviate client once upfront
  await getWeaviateClientInstance();
  
  // Build search configurations: cartesian product of keywords and alphas
  const searchConfigs: Array<{ keyword: string; alpha: number }> = [];
  for (const keyword of keywords) {
    for (const alpha of alphas) {
      searchConfigs.push({ keyword, alpha });
    }
  }
  
  // Generate all unique embeddings upfront in a single batch request
  const uniqueKeywords = [...new Set(keywords)];
  const embeddingStartTime = Date.now();
  
  if (timingTracker) {
    const embeddingStartRelative = (Date.now() / 1000) - timingTracker.getPipelineStartTime();
    timingTracker.startSubStage('weaviate_search', 'embedding_generation');
  }
  
  const embeddingMap = await generateQueryEmbeddingsBatch(uniqueKeywords);
  const embeddingDurationMs = Date.now() - embeddingStartTime;
  
  if (timingTracker) {
    timingTracker.endSubStage('weaviate_search', 'embedding_generation');
  }
  
  // Update progress after embedding generation completes (20%)
  if (onProgressUpdate) {
    try {
      await onProgressUpdate('embedding_generation');
    } catch (error) {
      console.error('[Weaviate] Failed to update progress after embedding generation:', error);
    }
  }
  
  console.log(`[Weaviate] ${searchConfigs.length} searches, ${embeddingMap.size} embeddings (${embeddingDurationMs}ms)`);

  const allSearchResults: WeaviateHybridSearchResponse[] = [];
  const errors: Array<{ keyword: string; alpha: number; error: string }> = [];
  const batchTimings: Array<{ batchNumber: number; durationMs: number; searchesInBatch: number }> = [];

  // Start timing for parallel searches
  if (timingTracker) {
    timingTracker.startSubStage('weaviate_search', 'parallel_searches');
  }

  // Process searches in batches to limit concurrent connections
  for (let i = 0; i < searchConfigs.length; i += MAX_CONCURRENT_SEARCHES) {
    const batchStartTime = Date.now();
    const batchNumber = Math.floor(i / MAX_CONCURRENT_SEARCHES) + 1;
    const batch = searchConfigs.slice(i, i + MAX_CONCURRENT_SEARCHES);
    
    // Create search promises for this batch
    const batchPromises = batch.map(({ keyword, alpha }) => {
      return performSingleHybridSearch(keyword, alpha, limit, minFollowers, maxFollowers, platform, embeddingMap, excludeProfileUrls)
        .then((result) => {
          return { success: true, keyword, alpha, result };
        })
        .catch((error) => {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          console.error(`[ParallelHybridSearch] Search failed for keyword "${keyword}" with alpha=${alpha}:`, errorMsg);
          return { success: false, keyword, alpha, error: errorMsg };
        });
    });
    
    // Wait for batch to complete
    const batchResults = await Promise.allSettled(batchPromises);
    
    // Collect results
    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        const data = result.value;
        if (data.success && 'result' in data) {
          allSearchResults.push(data.result);
        } else if (!data.success && 'error' in data) {
          errors.push({ keyword: data.keyword, alpha: data.alpha, error: data.error });
        }
      } else {
        console.error('[ParallelHybridSearch] Batch promise rejected:', result.reason);
      }
    }
    
    // Record batch timing
    const batchDurationMs = Date.now() - batchStartTime;
    batchTimings.push({
      batchNumber,
      durationMs: batchDurationMs,
      searchesInBatch: batch.length,
    });
    
    // No delay between batches for maximum speed
    // if (i + MAX_CONCURRENT_SEARCHES < searchConfigs.length) {
    //   await sleep(100);
    // }
  }
  
  if (timingTracker) {
    timingTracker.endSubStage('weaviate_search', 'parallel_searches');
  }
  
  // Aggregate all results from all searches
  const allAggregatedResults: any[] = [];
  for (const searchResult of allSearchResults) {
    if (searchResult.results && Array.isArray(searchResult.results)) {
      allAggregatedResults.push(...searchResult.results);
    }
  }
  
  // Deduplicate results by profile URL, keeping highest score
  if (timingTracker) {
    timingTracker.startSubStage('weaviate_search', 'deduplication');
  }
  
  const deduplicatedResults = deduplicateResults(allAggregatedResults);
  
  if (timingTracker) {
    timingTracker.endSubStage('weaviate_search', 'deduplication');
  }
  
  // Update progress after all searches complete (50%)
  if (onProgressUpdate) {
    try {
      await onProgressUpdate('searches_complete');
    } catch (error) {
      console.error('[Weaviate] Failed to update progress after searches complete:', error);
    }
  }
  
  const totalRuntimeMs = Date.now() - startTime;
  console.log(`[Weaviate] ${allSearchResults.length} searches → ${deduplicatedResults.length} unique profiles (${totalRuntimeMs}ms)`);
  
  return {
    allSearchResults,
    deduplicatedResults,
    queriesExecuted: allSearchResults.length,
    batchTimings,
    totalRuntimeMs,
  };
}

