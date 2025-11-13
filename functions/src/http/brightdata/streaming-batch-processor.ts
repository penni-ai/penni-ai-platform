/**
 * Streaming batch processor for BrightData collections
 * Processes batches independently as they complete, enabling incremental results
 */

import axios, { AxiosInstance } from 'axios';
import type {
  BrightDataProfile,
  BrightDataProgressResponse,
  BrightDataPlatform,
} from '../../types/brightdata.js';
import {
  getBrightDataApiKey,
  getBrightDataBaseUrl,
  triggerCollection,
} from './collect-internal.js';

/**
 * Download results from a single snapshot
 */
async function downloadSnapshot(
  snapshotId: string,
  apiKey: string,
  baseUrl: string
): Promise<BrightDataProfile[]> {
  const client = createBrightDataClient(baseUrl, apiKey);
  
  try {
    const response = await client.get(`/snapshot/${snapshotId}`, {
      params: { format: 'json' },
      timeout: 600000, // 10 minutes
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });
    
    const data = response.data;
    
    if (Array.isArray(data)) {
      return data as BrightDataProfile[];
    }
    if (data.data && Array.isArray(data.data)) {
      return data.data as BrightDataProfile[];
    }
    if (data.results && Array.isArray(data.results)) {
      return data.results as BrightDataProfile[];
    }
    
    return data as BrightDataProfile[];
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const errorMessage = error.response?.data 
        ? JSON.stringify(error.response.data)
        : error.message;
      throw new Error(`BrightData download error: ${error.response?.status || 'Unknown'} - ${errorMessage}`);
    }
    throw error;
  }
}

/**
 * Batch processing configuration
 */
export interface StreamingBatchConfig {
  batchSize?: number;
  maxConcurrentBatches?: number;
  pollingInterval?: number;
  maxWaitTime?: number;
}

/**
 * Batch processing callback
 * Called when a batch is completed and processed
 */
export type BatchCompleteCallback = (result: {
  batchIndex: number;
  platform: BrightDataPlatform;
  snapshotId: string;
  profiles: BrightDataProfile[];
  normalizedProfiles: any[];
  analyzedProfiles: any[];
}) => Promise<void>;

/**
 * Create axios client for BrightData API
 */
function createBrightDataClient(baseUrl: string, apiKey: string): AxiosInstance {
  return axios.create({
    baseURL: baseUrl,
    timeout: 600000,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });
}

/**
 * Detect platform from URL
 */
function detectPlatform(url: string): 'instagram' | 'tiktok' | null {
  if (url.includes('instagram.com')) return 'instagram';
  if (url.includes('tiktok.com')) return 'tiktok';
  return null;
}

/**
 * Split URLs into batches
 */
function createBatches(urls: string[], batchSize: number): string[][] {
  const batches: string[][] = [];
  for (let i = 0; i < urls.length; i += batchSize) {
    batches.push(urls.slice(i, i + batchSize));
  }
  return batches;
}

/**
 * Check progress for a single snapshot
 */
async function checkSnapshotProgress(
  snapshotId: string,
  apiKey: string,
  baseUrl: string
): Promise<BrightDataProgressResponse> {
  const client = createBrightDataClient(baseUrl, apiKey);
  
  try {
    const response = await client.get(`/progress/${snapshotId}`, {
      timeout: 300000, // 5 minutes
    });
    
    return response.data as BrightDataProgressResponse;
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
 * Process a single batch end-to-end when it becomes ready
 */
async function processBatchAsReady(
  snapshot: { snapshot_id: string; platform: BrightDataPlatform; batch_index: number },
  apiKey: string,
  baseUrl: string,
  onBatchComplete: BatchCompleteCallback
): Promise<void> {
  const { snapshot_id, platform, batch_index } = snapshot;
  
  try {
    console.log(`[Streaming] Batch ${batch_index + 1} (${platform}) ready, downloading...`);
    
    // Download batch
    const profiles = await downloadSnapshot(snapshot_id, apiKey, baseUrl);
    console.log(`[Streaming] Batch ${batch_index + 1} downloaded ${profiles.length} profiles`);
    
    // Call callback with raw profiles (normalization and LLM will happen in callback)
    await onBatchComplete({
      batchIndex: batch_index,
      platform,
      snapshotId: snapshot_id,
      profiles,
      normalizedProfiles: [], // Will be populated by callback
      analyzedProfiles: [], // Will be populated by callback
    });
    
    console.log(`[Streaming] Batch ${batch_index + 1} processing complete`);
  } catch (error) {
    console.error(`[Streaming] Error processing batch ${batch_index + 1}:`, error);
    throw error;
  }
}

/**
 * Stream batch processing - processes batches as they become ready
 * 
 * @param urls Array of profile URLs
 * @param config Batch processing configuration
 * @param onBatchComplete Callback called when each batch is ready and processed
 * @returns Processing statistics
 */
export async function processBatchedCollectionStreaming(
  urls: string[],
  config: StreamingBatchConfig,
  onBatchComplete: BatchCompleteCallback
): Promise<{
  totalBatches: number;
  completedBatches: number;
  failedBatches: number;
  totalProfiles: number;
}> {
  const batchSize = config.batchSize || 20;
  const maxConcurrentBatches = config.maxConcurrentBatches || 10;
  const pollingInterval = config.pollingInterval || 10;
  const maxWaitTime = config.maxWaitTime || 3600;
  
  const apiKey = getBrightDataApiKey();
  const baseUrl = getBrightDataBaseUrl();
  
  console.log(`[Streaming] Starting streaming batch processing: ${urls.length} profiles, batch size: ${batchSize}`);
  
  // Step 1: Group URLs by platform and create batches
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
  
  const instagramBatches = createBatches(instagramUrls, batchSize);
  const tiktokBatches = createBatches(tiktokUrls, batchSize);
  
  const allBatches: Array<{ urls: string[]; platform: BrightDataPlatform; batchIndex: number }> = [];
  
  instagramBatches.forEach((batch) => {
    allBatches.push({ urls: batch, platform: 'instagram', batchIndex: allBatches.length });
  });
  
  tiktokBatches.forEach((batch) => {
    allBatches.push({ urls: batch, platform: 'tiktok', batchIndex: allBatches.length });
  });
  
  console.log(`[Streaming] Created ${allBatches.length} batches (${instagramBatches.length} Instagram, ${tiktokBatches.length} TikTok)`);
  
  // Step 2: Trigger all batches with concurrency control (max 10 at once)
  const snapshots: Array<{ snapshot_id: string; platform: BrightDataPlatform; batch_index: number }> = [];
  const maxTriggerConcurrency = Math.min(maxConcurrentBatches, 10); // Cap at 10 concurrent batches
  
  // Trigger batches with concurrency control
  for (let i = 0; i < allBatches.length; i += maxTriggerConcurrency) {
    const batchChunk = allBatches.slice(i, i + maxTriggerConcurrency);
    
    console.log(`[Streaming] Triggering batches ${i + 1}-${Math.min(i + maxTriggerConcurrency, allBatches.length)} of ${allBatches.length} (max ${maxTriggerConcurrency} concurrent)`);
    
    const chunkResults = await Promise.allSettled(
      batchChunk.map(async (batch) => {
        const snapshotResults = await triggerCollection(batch.urls, apiKey, baseUrl);
        // Find the snapshot for this batch's platform
        const snapshot = snapshotResults.find(s => s.platform === batch.platform);
        if (!snapshot) {
          throw new Error(`No snapshot returned for ${batch.platform} batch`);
        }
        return { snapshot_id: snapshot.snapshot_id, platform: batch.platform, batch_index: batch.batchIndex };
      })
    );
    
    for (const result of chunkResults) {
      if (result.status === 'fulfilled') {
        snapshots.push(result.value);
      } else {
        console.error(`[Streaming] Failed to trigger batch: ${result.reason}`);
      }
    }
    
    // Wait a bit before triggering next chunk if there are more batches
    if (i + maxTriggerConcurrency < allBatches.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  if (snapshots.length === 0) {
    throw new Error('Failed to trigger any batches');
  }
  
  console.log(`[Streaming] Successfully triggered ${snapshots.length}/${allBatches.length} batches`);
  
  // Step 3: Poll and process batches as they become ready
  const startTime = Date.now();
  const maxWaitMs = maxWaitTime * 1000;
  const processedSnapshots = new Set<string>();
  const processingPromises: Promise<void>[] = [];
  let completedBatches = 0;
  let failedBatches = 0;
  let totalProfiles = 0;
  
  while (processedSnapshots.size < snapshots.length) {
    const elapsed = Date.now() - startTime;
    if (elapsed >= maxWaitMs) {
      const remaining = snapshots.filter(s => !processedSnapshots.has(s.snapshot_id));
      console.error(`[Streaming] Timeout: ${remaining.length} batches still processing`);
      failedBatches += remaining.length;
      break;
    }
    
    // Check all unprocessed snapshots in parallel
    const checkPromises = snapshots
      .filter(s => !processedSnapshots.has(s.snapshot_id))
      .map(async (snapshot) => {
        try {
          const progress = await checkSnapshotProgress(snapshot.snapshot_id, apiKey, baseUrl);
          
          if (progress.status === 'ready' || progress.status === 'completed') {
            processedSnapshots.add(snapshot.snapshot_id);
            
            // Process this batch immediately
            const processPromise = processBatchAsReady(snapshot, apiKey, baseUrl, async (result) => {
              totalProfiles += result.profiles.length;
              completedBatches++;
              await onBatchComplete(result);
            }).catch((error) => {
              console.error(`[Streaming] Failed to process batch ${snapshot.batch_index + 1}:`, error);
              failedBatches++;
            });
            
            processingPromises.push(processPromise);
          } else if (progress.status === 'failed') {
            processedSnapshots.add(snapshot.snapshot_id);
            failedBatches++;
            console.error(`[Streaming] Batch ${snapshot.batch_index + 1} failed`);
          }
        } catch (error) {
          console.error(`[Streaming] Error checking snapshot ${snapshot.snapshot_id}:`, error);
        }
      });
    
    await Promise.all(checkPromises);
    
    // Wait for any in-flight processing to complete
    await Promise.allSettled(processingPromises);
    
    // If not all processed, wait before next poll
    if (processedSnapshots.size < snapshots.length) {
      const ready = snapshots.filter(s => processedSnapshots.has(s.snapshot_id)).length;
      console.log(`[Streaming] Progress: ${ready}/${snapshots.length} batches ready, waiting ${pollingInterval}s...`);
      await new Promise(resolve => setTimeout(resolve, pollingInterval * 1000));
    }
  }
  
  // Wait for all processing to complete
  await Promise.allSettled(processingPromises);
  
  const totalTime = Math.floor((Date.now() - startTime) / 1000);
  console.log(`[Streaming] Completed! Processed ${completedBatches} batches, ${failedBatches} failed, ${totalProfiles} profiles in ${totalTime}s`);
  
  return {
    totalBatches: snapshots.length,
    completedBatches,
    failedBatches,
    totalProfiles,
  };
}

