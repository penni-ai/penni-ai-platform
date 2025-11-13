import { onRequest } from 'firebase-functions/v2/https';
import type {
  BrightDataInstagramProfile,
  BrightDataTikTokProfile,
  BrightDataProfile,
  BrightDataUnifiedProfile,
  BrightDataTriggerRequest,
  BrightDataTriggerResponse,
  BrightDataProgressResponse,
  BrightDataSnapshotResponse,
  BrightDataPlatform,
} from '../../types/brightdata.js';
import { normalizeProfiles } from '../../utils/profile-normalizer.js';

/**
 * Get BrightData API key from environment variables
 */
function getBrightDataApiKey(): string {
  const apiKey = process.env.BRIGHTDATA_API_KEY;
  if (!apiKey) {
    throw new Error('BRIGHTDATA_API_KEY environment variable is required');
  }
  return apiKey.trim();
}

/**
 * Get BrightData Instagram dataset ID from environment variables
 */
function getBrightDataInstagramDatasetId(): string {
  const datasetId = process.env.BRIGHTDATA_INSTAGRAM_DATASET_ID || 'gd_l1vikfch901nx3by4';
  return datasetId;
}

/**
 * Get BrightData TikTok dataset ID from environment variables
 */
function getBrightDataTikTokDatasetId(): string {
  const datasetId = process.env.BRIGHTDATA_TIKTOK_DATASET_ID || 'gd_l1villgoiiidt09ci';
  return datasetId;
}

/**
 * Detect platform from URL
 */
function detectPlatform(url: string): 'instagram' | 'tiktok' | null {
  if (url.includes('instagram.com')) {
    return 'instagram';
  }
  if (url.includes('tiktok.com')) {
    return 'tiktok';
  }
  return null;
}

/**
 * Get dataset ID for platform
 */
function getDatasetIdForPlatform(platform: 'instagram' | 'tiktok'): string {
  if (platform === 'instagram') {
    return getBrightDataInstagramDatasetId();
  }
  return getBrightDataTikTokDatasetId();
}

/**
 * Get BrightData base URL from environment variables
 */
function getBrightDataBaseUrl(): string {
  return process.env.BRIGHTDATA_BASE_URL || 'https://api.brightdata.com/datasets/v3';
}

/**
 * Get polling interval from environment variables (in seconds)
 */
function getPollingInterval(): number {
  const interval = process.env.BRIGHTDATA_POLL_INTERVAL;
  return interval ? parseInt(interval, 10) : 10; // Default 10 seconds
}

/**
 * Get maximum wait time from environment variables (in seconds)
 */
function getMaxWaitTime(): number {
  return 3600; // Default 1 hour max wait
}

/**
 * Trigger BrightData collection
 * Supports both Instagram and TikTok URLs, grouping by platform
 */
async function triggerCollection(
  urls: string[],
  apiKey: string,
  baseUrl: string
): Promise<{ snapshot_id: string; platform: BrightDataPlatform }[]> {
  // Group URLs by platform
  const instagramUrls: string[] = [];
  const tiktokUrls: string[] = [];

  for (const url of urls) {
    const platform = detectPlatform(url);
    if (platform === 'instagram') {
      instagramUrls.push(url);
    } else if (platform === 'tiktok') {
      tiktokUrls.push(url);
    }
  }

  const snapshots: { snapshot_id: string; platform: BrightDataPlatform }[] = [];

  // Trigger Instagram collection if there are Instagram URLs
  if (instagramUrls.length > 0) {
    const instagramDatasetId = getBrightDataInstagramDatasetId();
    const instagramPayload: BrightDataTriggerRequest[] = instagramUrls.map((url) => ({ url }));

    const triggerUrl = `${baseUrl}/trigger?dataset_id=${instagramDatasetId}&include_errors=true`;
    const triggerResponse = await fetch(triggerUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(instagramPayload),
    });

    if (!triggerResponse.ok) {
      const errorText = await triggerResponse.text();
      throw new Error(`BrightData Instagram trigger error: ${triggerResponse.status} ${triggerResponse.statusText} - ${errorText}`);
    }

    const triggerData = await triggerResponse.json();
    const snapshotId = extractSnapshotId(triggerData);
    snapshots.push({ snapshot_id: snapshotId, platform: 'instagram' });
  }

  // Trigger TikTok collection if there are TikTok URLs
  if (tiktokUrls.length > 0) {
    const tiktokDatasetId = getBrightDataTikTokDatasetId();
    // TikTok requires country field (empty string if not specified)
    const tiktokPayload: BrightDataTriggerRequest[] = tiktokUrls.map((url) => ({
      url,
      country: '',
    }));

    const triggerUrl = `${baseUrl}/trigger?dataset_id=${tiktokDatasetId}&include_errors=true`;
    const triggerResponse = await fetch(triggerUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(tiktokPayload),
    });

    if (!triggerResponse.ok) {
      const errorText = await triggerResponse.text();
      throw new Error(`BrightData TikTok trigger error: ${triggerResponse.status} ${triggerResponse.statusText} - ${errorText}`);
    }

    const triggerData = await triggerResponse.json();
    const snapshotId = extractSnapshotId(triggerData);
    snapshots.push({ snapshot_id: snapshotId, platform: 'tiktok' });
  }

  return snapshots;
}

/**
 * Extract snapshot ID from BrightData response
 */
function extractSnapshotId(triggerData: any): string {
  if (typeof triggerData === 'string') {
    return triggerData;
  }
  if (triggerData.snapshot_id) {
    return triggerData.snapshot_id;
  }
  if (triggerData.snapshot) {
    return triggerData.snapshot;
  }
  // Try to find snapshot_id in the response
  const responseStr = JSON.stringify(triggerData);
  throw new Error(`Could not extract snapshot_id from response: ${responseStr}`);
}

/**
 * Check BrightData collection progress
 */
async function checkProgress(
  snapshotId: string,
  apiKey: string,
  baseUrl: string
): Promise<BrightDataProgressResponse> {
  const progressUrl = `${baseUrl}/progress/${snapshotId}`;
  const progressResponse = await fetch(progressUrl, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!progressResponse.ok) {
    const errorText = await progressResponse.text();
    throw new Error(`BrightData progress error: ${progressResponse.status} ${progressResponse.statusText} - ${errorText}`);
  }

  const progressData = await progressResponse.json();

  return {
    snapshot_id: snapshotId,
    status: progressData.status || 'unknown',
    progress: progressData.progress,
    total: progressData.total,
    completed: progressData.completed,
    failed: progressData.failed,
    message: progressData.message,
  };
}

/**
 * Download BrightData collection results
 */
async function downloadResults(
  snapshotId: string,
  apiKey: string,
  baseUrl: string,
  format: string = 'json'
): Promise<BrightDataInstagramProfile[]> {
  const downloadUrl = `${baseUrl}/snapshot/${snapshotId}?format=${format}`;
  const downloadResponse = await fetch(downloadUrl, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!downloadResponse.ok) {
    const errorText = await downloadResponse.text();
    throw new Error(`BrightData download error: ${downloadResponse.status} ${downloadResponse.statusText} - ${errorText}`);
  }

  const snapshotData = await downloadResponse.json();

  // Parse snapshot data
  let profiles: BrightDataInstagramProfile[] = [];

  if (Array.isArray(snapshotData)) {
    profiles = snapshotData;
  } else if (snapshotData.data && Array.isArray(snapshotData.data)) {
    profiles = snapshotData.data;
  } else if (snapshotData.results && Array.isArray(snapshotData.results)) {
    profiles = snapshotData.results;
  } else if (snapshotData.records && Array.isArray(snapshotData.records)) {
    profiles = snapshotData.records;
  } else {
    // Try to find array in response
    const keys = Object.keys(snapshotData);
    for (const key of keys) {
      if (Array.isArray(snapshotData[key])) {
        profiles = snapshotData[key];
        break;
      }
    }
  }

  return profiles;
}

/**
 * Wait for collection to complete with polling (supports multiple snapshots)
 */
async function waitForCompletion(
  snapshots: { snapshot_id: string; platform: BrightDataPlatform }[],
  apiKey: string,
  baseUrl: string,
  pollingInterval: number,
  maxWaitTime: number
): Promise<BrightDataProgressResponse[]> {
  const startTime = Date.now();
  const maxWaitMs = maxWaitTime * 1000;
  const progressMap = new Map<string, BrightDataProgressResponse>();

  while (true) {
    // Check progress for all snapshots
    const allCompleted = await Promise.all(
      snapshots.map(async (snapshot) => {
        if (progressMap.has(snapshot.snapshot_id)) {
          const existing = progressMap.get(snapshot.snapshot_id)!;
          if (existing.status === 'completed' || existing.status === 'failed') {
            return existing;
          }
        }

        const progress = await checkProgress(snapshot.snapshot_id, apiKey, baseUrl);
        progressMap.set(snapshot.snapshot_id, progress);
        return progress;
      })
    );

    // Check if all completed or any failed
    const completed = allCompleted.filter((p) => p.status === 'completed');
    const failed = allCompleted.filter((p) => p.status === 'failed');

    if (failed.length > 0) {
      throw new Error(
        `BrightData collection failed for ${failed.length} snapshot(s): ${failed.map((f) => f.message || 'Unknown error').join(', ')}`
      );
    }

    if (completed.length === snapshots.length) {
      return allCompleted;
    }

    // Check timeout
    const elapsed = Date.now() - startTime;
    if (elapsed >= maxWaitMs) {
      const statuses = allCompleted.map((p) => `${p.snapshot_id}: ${p.status}`).join(', ');
      throw new Error(`Timeout waiting for collection to complete. Statuses: ${statuses}`);
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, pollingInterval * 1000));
  }
}

/**
 * HTTP Cloud Function to collect BrightData profiles from Instagram and TikTok URLs
 * 
 * POST /brightdata-collect
 * Body: { 
 *   "urls": [
 *     "https://www.instagram.com/username1/",
 *     "https://www.tiktok.com/@username2",
 *     ...
 *   ],
 *   "wait_for_completion": true,  // Optional: wait for results (default: true)
 *   "max_wait_seconds": 300,      // Optional: max wait time (default: 300)
 *   "polling_interval_seconds": 10 // Optional: polling interval (default: 10)
 * }
 * 
 * Or pass hybrid search results:
 * Body: { 
 *   "results": [{"data": {"profile_url": "https://..."}}, ...],
 *   "wait_for_completion": true
 * }
 * 
 * Returns:
 * - 200: BrightData profiles (if wait_for_completion=true) or snapshot_ids (if false)
 * - 500: Collection failed
 */
export const brightdataCollect = onRequest(
      {
        region: 'us-central1',
        timeoutSeconds: 3600, // 1 hour max
        memory: '512MiB',
        invoker: 'private',
      },
  async (request, response) => {
    try {
      // Extract URLs from request
      let urls: string[] = [];
      const shouldWaitForCompletion = request.body?.wait_for_completion !== false; // Default true
      const maxWaitSeconds = request.body?.max_wait_seconds || getMaxWaitTime();
      const pollingIntervalSeconds = request.body?.polling_interval_seconds || getPollingInterval();

      // Extract URLs from different possible request formats
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
      } else if (request.query.urls) {
        // Comma-separated URLs in query string
        urls = (request.query.urls as string).split(',').map((url) => url.trim());
      } else {
        response.status(400).json({
          status: 'error',
          message: 'Provide "urls", "profile_urls" array, or "results" array from hybrid search in request body',
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

      // Group URLs by platform for reporting
      const instagramUrls = validUrls.filter((url) => url.includes('instagram.com'));
      const tiktokUrls = validUrls.filter((url) => url.includes('tiktok.com'));

      console.log(
        `Starting BrightData collection for ${validUrls.length} profiles (Instagram: ${instagramUrls.length}, TikTok: ${tiktokUrls.length}, wait_for_completion: ${shouldWaitForCompletion})`
      );

      const apiKey = getBrightDataApiKey();
      const baseUrl = getBrightDataBaseUrl();

      // Step 1: Trigger collection (handles both platforms)
      console.log('Triggering BrightData collection...');
      const snapshots = await triggerCollection(validUrls, apiKey, baseUrl);
      console.log(`Collection triggered. Snapshots: ${snapshots.map((s) => `${s.platform}:${s.snapshot_id}`).join(', ')}`);

      // If not waiting for completion, return snapshot_ids immediately
      if (!shouldWaitForCompletion) {
        response.status(200).json({
          status: 'triggered',
          snapshots: snapshots.map((s) => ({
            snapshot_id: s.snapshot_id,
            platform: s.platform,
          })),
          urls_count: validUrls.length,
          instagram_urls_count: instagramUrls.length,
          tiktok_urls_count: tiktokUrls.length,
          urls: validUrls,
          message: 'Collection started. Use brightdataProgress and brightdataDownload endpoints to check status and download results.',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Step 2: Wait for completion (all snapshots)
      console.log(`Waiting for collection to complete (max ${maxWaitSeconds}s, polling every ${pollingIntervalSeconds}s)...`);
      const finalProgresses = await waitForCompletion(
        snapshots,
        apiKey,
        baseUrl,
        pollingIntervalSeconds,
        maxWaitSeconds
      );

      console.log(
        `Collection completed. Statuses: ${finalProgresses.map((p) => `${p.snapshot_id}: ${p.status} (${p.completed}/${p.total})`).join(', ')}`
      );

      // Step 3: Download results from all snapshots
      console.log('Downloading results from all snapshots...');
      const allProfiles: BrightDataProfile[] = [];
      const profilesByPlatform: Record<string, BrightDataProfile[]> = {};

      for (const snapshot of snapshots) {
        const profiles = await downloadResults(snapshot.snapshot_id, apiKey, baseUrl);
        allProfiles.push(...profiles);
        profilesByPlatform[snapshot.platform] = profiles;
        console.log(`Downloaded ${profiles.length} ${snapshot.platform} profiles from snapshot ${snapshot.snapshot_id}`);
      }

      console.log(`Downloaded ${allProfiles.length} total profiles`);

      // Normalize profiles to unified format
      const normalizedProfiles = normalizeProfiles(allProfiles);

      // Return complete results
      const result = {
        status: 'success',
        snapshots: snapshots.map((s) => ({
          snapshot_id: s.snapshot_id,
          platform: s.platform,
        })),
        urls_count: validUrls.length,
        instagram_urls_count: instagramUrls.length,
        tiktok_urls_count: tiktokUrls.length,
        profiles_count: allProfiles.length,
        instagram_profiles_count: profilesByPlatform.instagram?.length || 0,
        tiktok_profiles_count: profilesByPlatform.tiktok?.length || 0,
        urls: validUrls,
        // Original platform-specific profiles
        data: allProfiles, // Use 'data' to match BrightDataSnapshotResponse
        profiles: allProfiles, // Also include 'profiles' for convenience
        profiles_by_platform: {
          instagram: profilesByPlatform.instagram || [],
          tiktok: profilesByPlatform.tiktok || [],
        },
        // Normalized unified profiles
        unified_profiles: normalizedProfiles,
        progress: finalProgresses,
        total_records: allProfiles.length,
        timestamp: new Date().toISOString(),
      };

      response.status(200).json(result);
    } catch (error) {
      console.error('BrightData collection error:', error);
      response.status(500).json({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

