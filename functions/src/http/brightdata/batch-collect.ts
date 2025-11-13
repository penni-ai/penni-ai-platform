/**
 * HTTP Cloud Function for scalable batch BrightData collection
 * Handles 1000+ profiles by automatically batching and processing concurrently
 */

import { onRequest } from 'firebase-functions/v2/https';
import { processBatchedCollection, type BatchProcessingConfig } from './batch-processor.js';
import { normalizeProfiles } from '../../utils/profile-normalizer.js';
import type { BrightDataUnifiedProfile } from '../../types/brightdata.js';

/**
 * HTTP Cloud Function for batched BrightData collection
 * 
 * POST /brightdata-batch-collect
 * Body: {
 *   "urls": ["https://instagram.com/user1", ...],  // Up to 1000+ URLs
 *   "batch_size": 20,                                // Optional: profiles per batch (default: 20)
 *   "max_concurrent_batches": 10,                    // Optional: concurrent batches (default: 10)
 *   "polling_interval_seconds": 10,                  // Optional: polling interval (default: 10)
 *   "max_wait_seconds": 3600                         // Optional: max wait time (default: 3600)
 * }
 * 
 * Returns:
 * - 200: All collected profiles with statistics
 * - 500: Collection failed
 */
export const brightdataBatchCollect = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 3600, // 1 hour max
    memory: '1GiB', // Increased memory for large batches
    invoker: 'private',
  },
  async (request, response) => {
    try {
      // Extract URLs from request
      let urls: string[] = [];
      
      if (request.body?.urls && Array.isArray(request.body.urls)) {
        urls = request.body.urls;
      } else if (request.body?.profile_urls && Array.isArray(request.body.profile_urls)) {
        urls = request.body.profile_urls;
      } else if (request.body?.results && Array.isArray(request.body.results)) {
        // Extract from hybrid search results format
        urls = request.body.results
          .map((result: any) => {
            if (result.data?.profile_url) {
              return result.data.profile_url;
            } else if (result.profile_url) {
              return result.profile_url;
            } else if (result.url) {
              return result.url;
            }
            return null;
          })
          .filter((url: string | null): url is string => url !== null && (url.includes('instagram.com') || url.includes('tiktok.com')));
      } else {
        response.status(400).json({
          status: 'error',
          message: 'Provide "urls", "profile_urls" array, or "results" array in request body',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Filter to valid Instagram and TikTok URLs
      const validUrls = urls.filter((url) => url.includes('instagram.com') || url.includes('tiktok.com'));

      if (validUrls.length === 0) {
        response.status(400).json({
          status: 'error',
          message: 'No valid Instagram or TikTok URLs found',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      console.log(`[Batch Collect] Starting batch collection for ${validUrls.length} profiles`);

      // Configure batch processing
      const config: BatchProcessingConfig = {
        batchSize: request.body?.batch_size || 20,
        maxConcurrentBatches: request.body?.max_concurrent_batches || 10,
        pollingInterval: request.body?.polling_interval_seconds || 10,
        maxWaitTime: request.body?.max_wait_seconds || 3600,
      };

      console.log(`[Batch Collect] Configuration: batch_size=${config.batchSize}, max_concurrent=${config.maxConcurrentBatches}, polling=${config.pollingInterval}s`);

      // Process all batches
      const result = await processBatchedCollection(validUrls, config);

      // Normalize profiles to unified format
      console.log(`[Batch Collect] Normalizing ${result.profiles.length} profiles...`);
      const normalizedProfiles = normalizeProfiles(result.profiles);

      // Separate by platform for reporting
      const instagramProfiles = normalizedProfiles.filter(p => p.platform === 'instagram');
      const tiktokProfiles = normalizedProfiles.filter(p => p.platform === 'tiktok');

      // Return comprehensive results
      response.status(200).json({
        status: 'success',
        stats: {
          ...result.stats,
          normalized_profiles: normalizedProfiles.length,
          instagram_profiles: instagramProfiles.length,
          tiktok_profiles: tiktokProfiles.length,
        },
        snapshots: result.snapshots,
        profiles: normalizedProfiles,
        profiles_by_platform: {
          instagram: instagramProfiles,
          tiktok: tiktokProfiles,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('[Batch Collect] Error:', error);
      response.status(500).json({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

