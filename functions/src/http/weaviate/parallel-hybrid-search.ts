import { onRequest } from 'firebase-functions/v2/https';
import type { WeaviateSearchErrorResponse } from '../../types/weaviate-search.js';
import { performParallelHybridSearches } from '../../utils/weaviate-search.js';

/**
 * HTTP Cloud Function to perform parallel hybrid searches
 * 
 * POST /weaviate-parallel-hybrid-search
 * 
 * Request body (JSON):
 * {
 *   "keywords": ["lifestyle", "fitness", "travel"],  // Required: array of search terms
 *   "alphas": [0.2, 0.5, 0.8],  // Required: array of alpha values (or single number applied to all)
 *   "top_n": 10,  // Optional: top N results after aggregation and deduplication (default: 10)
 *   "min_followers": 10000,  // Optional: minimum follower count filter
 *   "max_followers": 1000000,  // Optional: maximum follower count filter
 *   "platform": "instagram"  // Optional: platform filter ("instagram" or "tiktok", case-insensitive)
 * }
 * 
 * Note: Each individual search uses a limit of 300 results. All results are aggregated,
 * deduplicated by profile_url (keeping highest score), sorted by score, and top_n results are returned.
 * 
 * Returns:
 * - 200: Aggregated search results
 * - 400: Invalid request
 * - 500: Search failed
 */
export const weaviateParallelHybridSearch = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 300, // 5 minutes for parallel searches
    memory: '1GiB',
    invoker: 'private',
  },
  async (request, response) => {
    try {
      // Only accept POST requests
      if (request.method !== 'POST') {
        response.status(405).json({
          status: 'error',
          message: 'Method not allowed. Use POST.',
          timestamp: new Date().toISOString(),
        });
        return;
      }
      
      const body = request.body;
      
      // Validate required fields
      if (!body.keywords || !Array.isArray(body.keywords) || body.keywords.length === 0) {
        response.status(400).json({
          status: 'error',
          message: 'keywords array is required and must not be empty',
          timestamp: new Date().toISOString(),
        });
        return;
      }
      
      if (!body.alphas || (!Array.isArray(body.alphas) && typeof body.alphas !== 'number')) {
        response.status(400).json({
          status: 'error',
          message: 'alphas must be an array of numbers or a single number',
          timestamp: new Date().toISOString(),
        });
        return;
      }
      
      const keywords: string[] = body.keywords;
      const alphasInput = body.alphas;
      const topN = parseInt(String(body.top_n || '10'), 10); // Top N results after aggregation
      const searchLimit = 300; // Fixed limit per individual search
      const minFollowers = body.min_followers !== undefined ? parseInt(String(body.min_followers), 10) : undefined;
      const maxFollowers = body.max_followers !== undefined ? parseInt(String(body.max_followers), 10) : undefined;
      const platformInput = body.platform as string | undefined;
      
      // Validate and normalize platform filter
      let platform: string | undefined = undefined;
      if (platformInput) {
        const normalizedPlatform = platformInput.toLowerCase().trim();
        if (normalizedPlatform === 'tiktok' || normalizedPlatform === 'instagram') {
          platform = normalizedPlatform;
        } else {
          response.status(400).json({
            status: 'error',
            message: 'platform must be either "tiktok" or "instagram"',
            timestamp: new Date().toISOString(),
          });
          return;
        }
      }
      
      // Normalize alphas: if single number, apply to all keywords; if array, use as-is
      const alphas: number[] = Array.isArray(alphasInput)
        ? alphasInput.map(a => parseFloat(String(a)))
        : keywords.map(() => parseFloat(String(alphasInput)));
      
      // Validate alphas are all valid numbers
      if (alphas.some(a => isNaN(a) || a < 0 || a > 1)) {
        response.status(400).json({
          status: 'error',
          message: 'All alpha values must be numbers between 0 and 1',
          timestamp: new Date().toISOString(),
        });
        return;
      }
      
      console.log(`[ParallelHybridSearch] Starting searches for ${keywords.length} keywords × ${alphas.length} alphas...`);
      
      // Use shared parallel hybrid search function
      const searchResults = await performParallelHybridSearches(
        keywords,
        alphas,
        searchLimit,
        minFollowers,
        maxFollowers,
        platform
      );
      
      // Take top N results (already sorted by score descending)
      const topNResults = searchResults.deduplicatedResults.slice(0, topN);
      
      const totalResults = searchResults.allSearchResults.reduce((sum, result) => sum + result.count, 0);
      
      console.log(`[ParallelHybridSearch] Completed ${searchResults.queriesExecuted} successful searches, ${totalResults} total results, ${searchResults.deduplicatedResults.length} unique profiles, returning top ${topN}`);
      console.log(`[ParallelHybridSearch] Total runtime: ${searchResults.totalRuntimeMs}ms`);
      
      response.status(200).json({
        keywords,
        alphas,
        top_n: topN,
        search_limit: searchLimit,
        platform: platform || null,
        total_searches: keywords.length * alphas.length,
        successful_searches: searchResults.queriesExecuted,
        failed_searches: 0,
        total_results: totalResults,
        unique_profiles: searchResults.deduplicatedResults.length,
        results: topNResults,
        searches: searchResults.allSearchResults,
        batch_timings: searchResults.batchTimings,
        total_runtime_ms: searchResults.totalRuntimeMs,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('[ParallelHybridSearch] Error:', error);
      response.status(500).json({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      } as WeaviateSearchErrorResponse);
    }
  }
);

