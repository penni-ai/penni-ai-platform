/**
 * Internal functions for BrightData collection
 * These can be imported and called directly without HTTP overhead
 * Uses axios for better timeout handling and batch processing
 */

import axios, { AxiosInstance } from 'axios';
import type {
  BrightDataProfile,
  BrightDataTriggerRequest,
  BrightDataProgressResponse,
  BrightDataPlatform,
} from '../../types/brightdata.js';

/**
 * Create a configured axios instance for BrightData API
 * with extended timeouts for long-running operations
 */
function createBrightDataClient(baseUrl: string, apiKey: string): AxiosInstance {
  return axios.create({
    baseURL: baseUrl,
    timeout: 600000, // 10 minutes default timeout
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    // Increase max content length for large responses
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });
}

/**
 * Get BrightData API key from environment variables
 */
export function getBrightDataApiKey(): string {
  const apiKey = process.env.BRIGHTDATA_API_KEY;
  if (!apiKey) {
    throw new Error('BRIGHTDATA_API_KEY environment variable is required');
  }
  return apiKey.trim();
}

/**
 * Get BrightData Instagram dataset ID from environment variables
 */
export function getBrightDataInstagramDatasetId(): string {
  const datasetId = process.env.BRIGHTDATA_INSTAGRAM_DATASET_ID || 'gd_l1vikfch901nx3by4';
  return datasetId;
}

/**
 * Get BrightData TikTok dataset ID from environment variables
 */
export function getBrightDataTikTokDatasetId(): string {
  const datasetId = process.env.BRIGHTDATA_TIKTOK_DATASET_ID || 'gd_l1villgoiiidt09ci';
  return datasetId;
}

/**
 * Detect platform from URL
 */
export function detectPlatform(url: string): 'instagram' | 'tiktok' | null {
  if (url.includes('instagram.com')) {
    return 'instagram';
  }
  if (url.includes('tiktok.com')) {
    return 'tiktok';
  }
  return null;
}

/**
 * Get BrightData base URL from environment variables
 */
export function getBrightDataBaseUrl(): string {
  return process.env.BRIGHTDATA_BASE_URL || 'https://api.brightdata.com/datasets/v3';
}

/**
 * Get polling interval from environment variables (in seconds)
 */
export function getPollingInterval(): number {
  const interval = process.env.BRIGHTDATA_POLL_INTERVAL;
  return interval ? parseInt(interval, 10) : 10; // Default 10 seconds
}

/**
 * Get maximum wait time from environment variables (in seconds)
 */
export function getMaxWaitTime(): number {
  return 3600; // Default 1 hour max wait
}

/**
 * Trigger BrightData collection
 * Supports both Instagram and TikTok URLs, grouping by platform
 * Uses axios for better timeout handling
 */
export async function triggerCollection(
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
  const client = createBrightDataClient(baseUrl, apiKey);

  // Trigger Instagram collection if there are Instagram URLs
  if (instagramUrls.length > 0) {
    const instagramDatasetId = getBrightDataInstagramDatasetId();
    const instagramPayload: BrightDataTriggerRequest[] = instagramUrls.map((url) => ({ url }));

    try {
      const triggerResponse = await client.post(
        `/trigger?dataset_id=${instagramDatasetId}&include_errors=true`,
        instagramPayload,
        {
          timeout: 120000, // 2 minutes for trigger
        }
      );

      const snapshotId = extractSnapshotId(triggerResponse.data);
      snapshots.push({ snapshot_id: snapshotId, platform: 'instagram' });
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const errorMessage = error.response?.data 
          ? JSON.stringify(error.response.data)
          : error.message;
        throw new Error(`BrightData Instagram trigger error: ${error.response?.status || 'Unknown'} - ${errorMessage}`);
      }
      throw error;
    }
  }

  // Trigger TikTok collection if there are TikTok URLs
  if (tiktokUrls.length > 0) {
    const tiktokDatasetId = getBrightDataTikTokDatasetId();
    // TikTok requires country field (empty string if not specified)
    const tiktokPayload: BrightDataTriggerRequest[] = tiktokUrls.map((url) => ({
      url,
      country: '',
    }));

    try {
      const triggerResponse = await client.post(
        `/trigger?dataset_id=${tiktokDatasetId}&include_errors=true`,
        tiktokPayload,
        {
          timeout: 120000, // 2 minutes for trigger
        }
      );

      const snapshotId = extractSnapshotId(triggerResponse.data);
      snapshots.push({ snapshot_id: snapshotId, platform: 'tiktok' });
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const errorMessage = error.response?.data 
          ? JSON.stringify(error.response.data)
          : error.message;
        throw new Error(`BrightData TikTok trigger error: ${error.response?.status || 'Unknown'} - ${errorMessage}`);
      }
      throw error;
    }
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
 * Uses axios for better timeout handling
 * API returns: { snapshot_id, dataset_id, status: "running" | "ready" | "failed" }
 */
export async function checkProgress(snapshotId: string, apiKey: string, baseUrl: string): Promise<BrightDataProgressResponse> {
  const client = createBrightDataClient(baseUrl, apiKey);
  
  try {
    const progressResponse = await client.get(`/progress/${snapshotId}`, {
      timeout: 300000, // 5 minutes for progress checks
    });

    const progressData = progressResponse.data;
    
    // Log the raw response for debugging
    console.log(`[BrightData Progress] Snapshot ${snapshotId}: status="${progressData.status}", dataset_id="${progressData.dataset_id || 'N/A'}"`);
    
    // Return progress response with proper structure
    // API returns: { snapshot_id, dataset_id, status: "running" | "ready" | "failed" }
    return {
      snapshot_id: progressData.snapshot_id || snapshotId,
      dataset_id: progressData.dataset_id,
      status: progressData.status || 'unknown',
      progress: progressData.progress,
      total: progressData.total,
      completed: progressData.completed,
      failed: progressData.failed,
      message: progressData.message,
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const errorMessage = error.response?.data 
        ? JSON.stringify(error.response.data)
        : error.message;
      throw new Error(`BrightData progress check error: ${error.response?.status || 'Unknown'} - ${errorMessage}`);
    }
    throw error;
  }
}

/**
 * Download BrightData collection results
 * Uses axios for better timeout handling and large response support
 * API endpoint: GET /datasets/v3/snapshot/{snapshot_id}?format=json
 */
export async function downloadResults(snapshotId: string, apiKey: string, baseUrl: string): Promise<BrightDataProfile[]> {
  const client = createBrightDataClient(baseUrl, apiKey);
  
  try {
    // Correct API format: snapshot_id is a path parameter, not query parameter
    // GET /datasets/v3/snapshot/{snapshot_id}?format=json
    console.log(`[BrightData Download] Downloading snapshot ${snapshotId}...`);
    
    const downloadResponse = await client.get(`/snapshot/${snapshotId}`, {
      params: {
        format: 'json', // Query parameter: json, ndjson, jsonl, or csv
      },
      timeout: 600000, // 10 minutes for downloads
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    const data = downloadResponse.data;
    
    console.log(`[BrightData Download] Received response for snapshot ${snapshotId}, data type: ${Array.isArray(data) ? 'array' : typeof data}`);
    
    // Log sample of raw response structure for debugging
    if (Array.isArray(data) && data.length > 0) {
      const firstProfile = data[0];
      const profileKeys = Object.keys(firstProfile);
      const hasPlatform = 'platform' in firstProfile || 'account' in firstProfile || 'account_id' in firstProfile;
      console.log(`[BrightData Download] Sample profile keys (${profileKeys.length}): ${profileKeys.slice(0, 10).join(', ')}${profileKeys.length > 10 ? '...' : ''}`);
      console.log(`[BrightData Download] Platform detection: has 'platform'=${'platform' in firstProfile}, has 'account'=${'account' in firstProfile}, has 'account_id'=${'account_id' in firstProfile}`);
      
      // Detect platform from raw response
      if ('account' in firstProfile && 'fbid' in firstProfile) {
        console.log(`[BrightData Download] Detected Instagram profile structure`);
      } else if ('account_id' in firstProfile && 'nickname' in firstProfile) {
        console.log(`[BrightData Download] Detected TikTok profile structure`);
      } else if ('platform' in firstProfile) {
        console.log(`[BrightData Download] Profile already has platform field: ${(firstProfile as any).platform}`);
      }
    }
    
    // Handle different response formats
    // API returns the data directly (could be array or single object)
    if (Array.isArray(data)) {
      console.log(`[BrightData Download] Returning ${data.length} profiles from array`);
      return data as BrightDataProfile[];
    }
    
    // If it's a single object (shouldn't happen for Instagram/TikTok, but handle it)
    if (data && typeof data === 'object') {
      // Check if it's wrapped in a data property
      if (data.data && Array.isArray(data.data)) {
        console.log(`[BrightData Download] Returning ${data.data.length} profiles from data.data array`);
        return data.data as BrightDataProfile[];
      }
      // Check if it's wrapped in results property
      if (data.results && Array.isArray(data.results)) {
        console.log(`[BrightData Download] Returning ${data.results.length} profiles from data.results array`);
        return data.results as BrightDataProfile[];
      }
      // Single object - wrap in array
      console.log(`[BrightData Download] Single object returned, wrapping in array`);
      return [data] as BrightDataProfile[];
    }
    
    // Fallback: return as-is (should be array)
    console.log(`[BrightData Download] Returning data as-is`);
    return data as BrightDataProfile[];
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const errorMessage = error.response?.data 
        ? JSON.stringify(error.response.data)
        : error.message;
      console.error(`[BrightData Download] Error downloading snapshot ${snapshotId}: ${error.response?.status || 'Unknown'} - ${errorMessage}`);
      throw new Error(`BrightData download error: ${error.response?.status || 'Unknown'} - ${errorMessage}`);
    }
    throw error;
  }
}

/**
 * Wait for collection to complete with polling (supports multiple snapshots)
 * API status values: "running" | "ready" | "failed"
 */
export async function waitForCompletion(
  snapshots: { snapshot_id: string; platform: BrightDataPlatform }[],
  apiKey: string,
  baseUrl: string,
  pollingInterval: number,
  maxWaitTime: number
): Promise<BrightDataProgressResponse[]> {
  const startTime = Date.now();
  const maxWaitMs = maxWaitTime * 1000;
  const progressMap = new Map<string, BrightDataProgressResponse>();
  let pollCount = 0;

  console.log(`[BrightData] Starting to poll ${snapshots.length} snapshot(s) every ${pollingInterval}s (max wait: ${maxWaitTime}s)`);

  while (true) {
    pollCount++;
    const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
    
    // Check progress for all snapshots
    const allProgress = await Promise.all(
      snapshots.map(async (snapshot) => {
        if (progressMap.has(snapshot.snapshot_id)) {
          const existing = progressMap.get(snapshot.snapshot_id)!;
          // API returns "ready" when done, not "completed"
          if (existing.status === 'ready' || existing.status === 'completed' || existing.status === 'failed') {
            return existing;
          }
        }

        const progress = await checkProgress(snapshot.snapshot_id, apiKey, baseUrl);
        progressMap.set(snapshot.snapshot_id, progress);
        return progress;
      })
    );

    // Log status for each snapshot
    const statusSummary = allProgress.map((p) => `${p.snapshot_id?.substring(0, 8)}...=${p.status}`).join(', ');
    console.log(`[BrightData Poll #${pollCount}] [${elapsedSeconds}s elapsed] Status: ${statusSummary}`);

    // Check if all ready/completed or any failed
    // API returns "ready" when collection is complete and ready for download
    const ready = allProgress.filter((p) => p.status === 'ready' || p.status === 'completed');
    const failed = allProgress.filter((p) => p.status === 'failed');

    if (failed.length > 0) {
      console.error(`[BrightData] Collection failed for ${failed.length} snapshot(s)`);
      throw new Error(
        `BrightData collection failed for ${failed.length} snapshot(s): ${failed.map((f) => f.message || f.snapshot_id || 'Unknown error').join(', ')}`
      );
    }

    if (ready.length === snapshots.length) {
      console.log(`[BrightData] All ${snapshots.length} snapshot(s) are ready! Total time: ${elapsedSeconds}s`);
      return allProgress;
    }

    // Check timeout
    const elapsed = Date.now() - startTime;
    if (elapsed >= maxWaitMs) {
      const statuses = allProgress.map((p) => `${p.snapshot_id?.substring(0, 8)}...=${p.status}`).join(', ');
      throw new Error(`Timeout waiting for collection to complete after ${maxWaitTime}s. Statuses: ${statuses}`);
    }

    // Wait before next poll
    console.log(`[BrightData] Waiting ${pollingInterval}s before next poll...`);
    await new Promise((resolve) => setTimeout(resolve, pollingInterval * 1000));
  }
}

