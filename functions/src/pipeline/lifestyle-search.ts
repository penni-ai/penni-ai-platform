/**
 * Pipeline script to:
 * 1. Perform hybrid search on Weaviate for "lifestyle" query
 * 2. Extract top 20 profiles
 * 3. Fetch live data from BrightData
 * 4. Output unified profiles with top 8 posts and aggregated hashtags
 */

import { onRequest } from 'firebase-functions/v2/https';
import type { BrightDataUnifiedProfile, BrightDataProfile } from '../types/brightdata.js';
import { normalizeProfiles } from '../utils/profile-normalizer.js';

// Import BrightData collection functions directly to avoid HTTP timeout
import {
  getBrightDataApiKey,
  getBrightDataBaseUrl,
  triggerCollection,
  waitForCompletion,
  downloadResults,
} from '../http/brightdata/collect-internal.js';

/**
 * Get Weaviate hybrid search base URL
 */
function getWeaviateHybridSearchUrl(): string {
  // In production, this would be the deployed function URL
  // For local testing, use the emulator URL
  const baseUrl = process.env.FUNCTIONS_EMULATOR
    ? 'http://127.0.0.1:6200/penni-ai-platform/us-central1'
    : process.env.FUNCTIONS_URL || 'https://us-central1-penni-ai-platform.cloudfunctions.net';
  
  return `${baseUrl}/weaviateHybridSearch`;
}


/**
 * Perform hybrid search on Weaviate
 */
async function performHybridSearch(query: string, limit: number): Promise<any> {
  const url = getWeaviateHybridSearchUrl();
  const searchUrl = `${url}?query=${encodeURIComponent(query)}&limit=${limit}`;
  
  console.log(`Performing hybrid search: ${searchUrl}`);
  
  const response = await fetch(searchUrl, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Hybrid search failed: ${response.status} ${response.statusText} - ${errorText}`);
  }
  
  return await response.json();
}

/**
 * Extract profile URLs from hybrid search results, filtering to 10 Instagram and 10 TikTok
 */
function extractProfileUrls(searchResults: any): { instagram: string[]; tiktok: string[] } {
  const instagramUrls: string[] = [];
  const tiktokUrls: string[] = [];
  
  if (searchResults.results && Array.isArray(searchResults.results)) {
    for (const result of searchResults.results) {
      if (result.data?.profile_url) {
        const url = result.data.profile_url;
        const platform = result.data?.platform?.toLowerCase();
        
        // Check platform from data or infer from URL
        if (platform === 'instagram' || url.includes('instagram.com')) {
          if (instagramUrls.length < 10) {
            instagramUrls.push(url);
          }
        } else if (platform === 'tiktok' || url.includes('tiktok.com')) {
          if (tiktokUrls.length < 10) {
            tiktokUrls.push(url);
          }
        }
        
        // Stop if we have enough of both
        if (instagramUrls.length >= 10 && tiktokUrls.length >= 10) {
          break;
        }
      }
    }
  }
  
  return { instagram: instagramUrls, tiktok: tiktokUrls };
}

/**
 * Fetch live data from BrightData (calls internal functions directly to avoid HTTP timeout)
 */
async function fetchBrightDataProfiles(profileUrls: string[]): Promise<BrightDataUnifiedProfile[]> {
  if (profileUrls.length === 0) {
    return [];
  }
  
  console.log(`Fetching ${profileUrls.length} profiles from BrightData...`);
  
  const apiKey = getBrightDataApiKey();
  const baseUrl = getBrightDataBaseUrl();
      const pollingInterval = 10; // 10 seconds
  const maxWaitSeconds = 3600; // 1 hour
  
  // Step 1: Trigger collection
  console.log('Triggering BrightData collection...');
  const snapshots = await triggerCollection(profileUrls, apiKey, baseUrl);
  console.log(`Collection triggered. Snapshots: ${snapshots.map((s: any) => `${s.platform}:${s.snapshot_id}`).join(', ')}`);
  
  // Step 2: Wait for completion
  console.log(`Waiting for collection to complete (max ${maxWaitSeconds}s, polling every ${pollingInterval}s)...`);
  const finalProgresses = await waitForCompletion(
    snapshots,
    apiKey,
    baseUrl,
    pollingInterval,
    maxWaitSeconds
  );
  
  console.log(
    `Collection completed. Statuses: ${finalProgresses.map((p: any) => `${p.snapshot_id}: ${p.status} (${p.completed}/${p.total})`).join(', ')}`
  );
  
  // Step 3: Download results from all snapshots
  console.log('Downloading results from all snapshots...');
  const allProfiles: BrightDataProfile[] = [];
  
  for (const snapshot of snapshots) {
    const profiles = await downloadResults(snapshot.snapshot_id, apiKey, baseUrl);
    allProfiles.push(...profiles);
    console.log(`Downloaded ${profiles.length} ${snapshot.platform} profiles from snapshot ${snapshot.snapshot_id}`);
  }
  
  console.log(`Downloaded ${allProfiles.length} total profiles`);
  
      // Step 4: Normalize profiles to unified format
      console.log(`[Pipeline] Normalizing ${allProfiles.length} profiles to unified format...`);
      const normalizedProfiles = normalizeProfiles(allProfiles);
      
      // Log sample normalized profile structure
      if (normalizedProfiles.length > 0) {
        const sampleProfile = normalizedProfiles[0];
        if (sampleProfile) {
          console.log(`[Pipeline] Sample normalized profile: platform=${sampleProfile.platform}, account_id=${sampleProfile.account_id}, display_name=${sampleProfile.display_name}`);
          console.log(`[Pipeline] Normalized profile has ${sampleProfile.posts_data?.length || 0} posts, email=${sampleProfile.email_address || 'none'}, hashtags=${sampleProfile.hashtags?.length || 0}`);
        }
      }
      
      return normalizedProfiles;
}

/**
 * HTTP Cloud Function to run the lifestyle search pipeline
 * 
 * GET /pipeline-lifestyle-search
 * 
 * Returns:
 * - 200: Unified profiles with top 8 posts and aggregated hashtags
 * - 500: Pipeline failed
 */
export const test_pipelineLifestyleSearch = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 3600, // 1 hour max
    memory: '512MiB',
    invoker: 'private',
  },
  async (request, response) => {
    try {
      const query = 'lifestyle';
      const searchLimit = 1000; // Search 1000 profiles
      const instagramLimit = 10; // Take 10 Instagram
      const tiktokLimit = 10; // Take 10 TikTok
      
      console.log(`Starting pipeline: Hybrid search for "${query}" with limit ${searchLimit}`);
      console.log(`Will filter to ${instagramLimit} Instagram and ${tiktokLimit} TikTok profiles`);
      
      // Step 1: Perform hybrid search
      const searchResults = await performHybridSearch(query, searchLimit);
      console.log(`Hybrid search completed. Found ${searchResults.count || 0} results`);
      
      // Step 2: Extract profile URLs (10 Instagram + 10 TikTok)
      const { instagram: instagramUrls, tiktok: tiktokUrls } = extractProfileUrls(searchResults);
      const allProfileUrls = [...instagramUrls, ...tiktokUrls];
      
      console.log(`Extracted ${instagramUrls.length} Instagram URLs and ${tiktokUrls.length} TikTok URLs`);
      console.log(`Total profile URLs to fetch: ${allProfileUrls.length}`);
      
      if (allProfileUrls.length === 0) {
        response.status(200).json({
          status: 'success',
          message: 'No profile URLs found in search results',
          query: query,
          search_limit: searchLimit,
          instagram_limit: instagramLimit,
          tiktok_limit: tiktokLimit,
          profiles: [],
          timestamp: new Date().toISOString(),
        });
        return;
      }
      
      // Step 3: Fetch live data from BrightData
      const unifiedProfiles = await fetchBrightDataProfiles(allProfileUrls);
      console.log(`Fetched ${unifiedProfiles.length} unified profiles from BrightData`);
      
      // Separate profiles by platform
      const instagramProfiles = unifiedProfiles.filter(p => p.platform === 'instagram');
      const tiktokProfiles = unifiedProfiles.filter(p => p.platform === 'tiktok');
      
      // Step 4: Output results
      const result = {
        status: 'success',
        query: query,
        search_limit: searchLimit,
        instagram_limit: instagramLimit,
        tiktok_limit: tiktokLimit,
        profiles_found: unifiedProfiles.length,
        instagram_profiles_found: instagramProfiles.length,
        tiktok_profiles_found: tiktokProfiles.length,
        profiles: unifiedProfiles,
        search_results_summary: {
          total_results: searchResults.count || 0,
          instagram_urls_extracted: instagramUrls.length,
          tiktok_urls_extracted: tiktokUrls.length,
          total_urls_extracted: allProfileUrls.length,
        },
        timestamp: new Date().toISOString(),
      };
      
      response.status(200).json(result);
    } catch (error) {
      console.error('Pipeline error:', error);
      response.status(500).json({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

