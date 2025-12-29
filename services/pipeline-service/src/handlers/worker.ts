/**
 * Pub/Sub worker handler for pipeline execution
 * Executes the full pipeline asynchronously when triggered by Pub/Sub message
 */

import { generateSearchQueriesFromDescription } from '../utils/search-query-generator.js';
import { performParallelHybridSearches } from '../utils/weaviate-search.js';
import { normalizeProfiles } from '../utils/profile-normalizer.js';
import { analyzeProfileFitBatch } from '../utils/llm-analysis.js';
import {
  updatePipelineJobStatus,
  updatePipelineStage,
  completeStage,
  updateQueryExpansionStage,
  updateWeaviateSearchStage,
  updateBrightDataStage,
  updateLLMAnalysisStage,
  storePipelineResults,
  storeRemainingProfiles,
  appendBatchResults,
  mergeBatchResults,
  updateBatchCounters,
  isJobCancelled,
  finalizePipelineProgress,
  saveWeaviateCandidates,
  updateProgress,
  updateProgressiveTopN,
  finalizeProgressiveResults,
} from '../utils/firestore-tracker.js';
import { isFixtureMode } from '../utils/test-mode.js';
import {
  getCachedProfilesBatch,
  setCachedProfilesBatch,
  detectPlatformFromUrl,
  extractProfileUrl,
} from '../utils/brightdata-cache.js';
import {
  getBrightDataApiKey,
  getBrightDataBaseUrl,
  triggerCollection,
  checkProgress,
  downloadResults,
} from '../utils/brightdata-internal.js';
import { PipelineTimingTracker } from '../utils/timing-tracker.js';
import type { BrightDataProfile, BrightDataPlatform, BrightDataUnifiedProfile } from '../types/brightdata.js';

function getGoodFitThreshold(): number {
  // 9/10 or 10/10 on the underlying 1-10 scale → fit_score >= 90 on our 0-100 scale
  return 90;
}

function isGoodFit(profile: { fit_score?: number }): boolean {
  return (profile.fit_score ?? 0) >= getGoodFitThreshold();
}

function getMaxConcurrentLLMRequests(): number {
  const raw = Number(process.env.MAX_CONCURRENT_LLM_REQUESTS || process.env.MAX_CONCURRENT_LLM_ANALYSES || '100');
  const configured = Number.isFinite(raw) ? Math.floor(raw) : 100;
  return Math.min(100, Math.max(1, configured));
}

function getFixtureDelayMs(): number {
  const raw = Number(process.env.PIPELINE_MOCK_DELAY_MS || '0');
  return Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Extract top N candidates (full data) from search results
 */
function extractTopCandidates(results: any[], topN: number, platform?: string | null): Array<{
  id: string;
  score?: number;
  distance?: number;
  profile_url: string;
  platform?: string;
  display_name?: string;
  biography?: string;
  followers?: number;
}> {
  const candidates: Array<{
    id: string;
    score?: number;
    distance?: number;
    profile_url: string;
    platform?: string;
    display_name?: string;
    biography?: string;
    followers?: number;
  }> = [];

  for (const result of results) {
    if (candidates.length >= topN) break;

    const profileUrl = result.data?.profile_url || result.profile_url || result.url;
    const profilePlatform = result.data?.platform || result.platform;
    
    // Filter by platform if specified
    if (platform && profilePlatform && profilePlatform.toLowerCase() !== platform.toLowerCase()) {
      continue;
    }
    
    if (profileUrl && (profileUrl.includes('instagram.com') || profileUrl.includes('tiktok.com'))) {
      candidates.push({
        id: result.id || result.uuid || '',
        score: result.score || result.metadata?.score,
        distance: result.distance || result.metadata?.distance,
        profile_url: profileUrl,
        platform: profilePlatform,
        display_name: result.data?.display_name,
        biography: result.data?.biography,
        followers: typeof result.data?.followers === 'number' ? result.data.followers : undefined,
      });
    }
  }

  return candidates;
}

/**
 * Extract top N profile URLs from search results
 */
/**
 * Handle Pub/Sub message for pipeline execution
 */
export async function handlePipelineExecution(messageData: {
  job_id: string;
  uid: string;
  campaign_id?: string;
  business_description: string;
  top_n?: number;
  weaviate_top_n: number;
  llm_top_n: number;
  min_followers?: number | null;
  max_followers?: number | null;
  platform?: string | null;
  request_id?: string;
  exclude_profile_urls?: string[] | null; // Profile URLs to exclude (for "find more" functionality)
  strict_location_matching?: boolean; // Enable strict location matching in LLM scoring
}): Promise<void> {
  const {
    job_id: jobId,
    uid,
    campaign_id,
    business_description: businessDescription,
    top_n: topN,
    weaviate_top_n: weaviateTopN,
    llm_top_n: llmTopN,
    min_followers: minFollowers,
    max_followers: maxFollowers,
    platform,
    request_id: requestId = `req_${Date.now()}`,
    exclude_profile_urls: excludeProfileUrls,
    strict_location_matching: strictLocationMatching = false,
  } = messageData;

  // Initialize timing tracker
  const timingTracker = new PipelineTimingTracker(jobId);

  if (isFixtureMode()) {
    const delayMs = getFixtureDelayMs();
    if (delayMs > 0) {
      await delay(delayMs);
      if (await isJobCancelled(jobId)) {
        await updatePipelineJobStatus(jobId, 'cancelled');
        return;
      }
    }
  }

  // Fetch full campaign details if campaign_id is provided
  let fullCampaignDescription = businessDescription;
  if (campaign_id) {
    try {
      const { getFirestoreInstance } = await import('../utils/firebase-admin.js');
      const db = getFirestoreInstance();
      
      // Fetch campaign document
      const campaignDoc = await db
        .collection('users')
        .doc(uid)
        .collection('campaigns')
        .doc(campaign_id)
        .get();
      
      if (campaignDoc.exists) {
        const campaignData = campaignDoc.data();
        
        // Fetch collected data from separate subcollection document
        // Structure: campaigns/{campaignId}/collected/data
        const collectedDoc = await db
          .collection('users')
          .doc(uid)
          .collection('campaigns')
          .doc(campaign_id)
          .collection('collected')
          .doc('data')
          .get();
        
        const collectedData = collectedDoc.exists ? collectedDoc.data() : null;
        
        // Build comprehensive campaign description from all collected fields
        const campaignDetails: string[] = [];
        
        // Business information (from collected data, fallback to campaign document)
        const businessName = collectedData?.business_name || campaignData?.business_name || null;
        const businessAbout = collectedData?.business_about || campaignData?.business_about || campaignData?.businessSummary || null;
        const website = collectedData?.website || campaignData?.website || null;
        
        if (businessName) {
          campaignDetails.push(`Business Name: ${businessName}`);
        }
        if (businessAbout) {
          campaignDetails.push(`Business Description: ${businessAbout}`);
        }
        if (website && website !== 'N/A') {
          campaignDetails.push(`Website: ${website}`);
        }
        
        // Influencer requirements
        const requirements: string[] = [];
        
        // Influencer location - check collected data first, then campaign document
        const influencerLocation = collectedData?.influencer_location || campaignData?.influencer_location || campaignData?.locations || null;
        if (influencerLocation) {
          requirements.push(`Influencer Location: ${influencerLocation}`);
        }
        
        // Type of influencer - check collected data first, then campaign document
        const typeOfInfluencer = collectedData?.type_of_influencer || campaignData?.type_of_influencer || campaignData?.influencerTypes || null;
        if (typeOfInfluencer) {
          requirements.push(`Type of Influencer: ${typeOfInfluencer}`);
        }
        
        // Platform - check collected data first, then campaign document
        const platformValue = collectedData?.platform || campaignData?.platform || platform || null;
        if (platformValue) {
          const platforms = Array.isArray(platformValue) 
            ? platformValue.join(' and ') 
            : typeof platformValue === 'string' 
              ? platformValue 
              : String(platformValue);
          requirements.push(`Platform: ${platforms}`);
        }
        
        // Follower range - check multiple sources: collected data, followerRange object, campaign document, and request params
        let followerMin: number | null = null;
        let followerMax: number | null = null;
        
        // Check collected data first (preferred source)
        if (collectedData?.min_followers !== undefined && collectedData?.min_followers !== null) {
          followerMin = typeof collectedData.min_followers === 'string' 
            ? parseInt(collectedData.min_followers, 10) 
            : typeof collectedData.min_followers === 'number' 
              ? collectedData.min_followers 
              : null;
        }
        if (collectedData?.max_followers !== undefined && collectedData?.max_followers !== null) {
          followerMax = typeof collectedData.max_followers === 'string' 
            ? parseInt(collectedData.max_followers, 10) 
            : typeof collectedData.max_followers === 'number' 
              ? collectedData.max_followers 
              : null;
        }
        
        // Check followerRange object in campaign document
        if (followerMin === null && campaignData?.followerRange?.min !== undefined && campaignData?.followerRange?.min !== null) {
          followerMin = campaignData.followerRange.min;
        }
        if (followerMax === null && campaignData?.followerRange?.max !== undefined && campaignData?.followerRange?.max !== null) {
          followerMax = campaignData.followerRange.max;
        }
        
        // Check top-level fields in campaign document
        if (followerMin === null && campaignData?.followersMin !== undefined && campaignData?.followersMin !== null) {
          followerMin = campaignData.followersMin;
        }
        if (followerMax === null && campaignData?.followersMax !== undefined && campaignData?.followersMax !== null) {
          followerMax = campaignData.followersMax;
        }
        
        // Fall back to request params if campaign doesn't have them
        if (followerMin === null && minFollowers !== undefined && minFollowers !== null) {
          followerMin = minFollowers;
        }
        if (followerMax === null && maxFollowers !== undefined && maxFollowers !== null) {
          followerMax = maxFollowers;
        }
        
        // Format follower range
        if (followerMin !== null || followerMax !== null) {
          const minStr = followerMin !== null ? followerMin.toLocaleString() : '0';
          const maxStr = followerMax !== null ? followerMax.toLocaleString() : 'unlimited';
          requirements.push(`Followers: ${minStr}-${maxStr}`);
        }
        
        // Combine all campaign details
        if (requirements.length > 0) {
          campaignDetails.push(...requirements);
        }
        
        // If we have any campaign details, use them (even if only followers)
        // Otherwise, fall back to business_description parameter
        if (campaignDetails.length > 0) {
          fullCampaignDescription = campaignDetails.join('\n');
          
          // If we also have a business_description parameter, prepend it for additional context
          if (businessDescription && businessDescription.trim().length > 0 && businessDescription !== fullCampaignDescription) {
            fullCampaignDescription = `${businessDescription}\n\n${fullCampaignDescription}`;
          }
          
          console.log(`[Worker] Using full campaign description from campaign ${campaign_id}`, {
            campaign_id,
            description_length: fullCampaignDescription.length,
            description_preview: fullCampaignDescription.substring(0, 200) + (fullCampaignDescription.length > 200 ? '...' : ''),
            sources: {
              businessName: !!businessName,
              businessAbout: !!businessAbout,
              website: !!website,
              influencerLocation: !!influencerLocation,
              typeOfInfluencer: !!typeOfInfluencer,
              platform: !!platformValue,
              followerMin,
              followerMax,
              hasCollectedData: collectedDoc.exists,
              collectedDataKeys: collectedData ? Object.keys(collectedData) : [],
              campaignDataKeys: Object.keys(campaignData || {})
            }
          });
        } else {
          console.log(`[Worker] Campaign ${campaign_id} exists but has no collected data, using business_description`, {
            campaign_id,
            campaignDataKeys: Object.keys(campaignData || {}),
            hasCollectedDoc: collectedDoc.exists,
            collectedDataKeys: collectedData ? Object.keys(collectedData) : [],
            collectedDataValues: collectedData ? Object.entries(collectedData).map(([k, v]) => ({ key: k, value: v, type: typeof v })) : []
          });
        }
      } else {
        console.log(`[Worker] Campaign ${campaign_id} not found in Firestore, using business_description`);
      }
    } catch (error) {
      console.warn(`[Worker] Failed to fetch campaign details for ${campaign_id}, using business_description:`, error);
      // Continue with business_description if campaign fetch fails
    }
  }

  try {
    // Log all pipeline parameters
    console.log(`[Worker] Pipeline starting: ${jobId}`, {
      job_id: jobId,
      request_id: requestId,
      uid: uid,
      campaign_id: campaign_id || null,
      business_description: businessDescription.substring(0, 100) + (businessDescription.length > 100 ? '...' : ''),
      full_campaign_description_length: fullCampaignDescription.length,
      top_n: topN,
      weaviate_top_n: weaviateTopN,
      llm_top_n: llmTopN,
      min_followers: minFollowers || null,
      max_followers: maxFollowers || null,
      platform: platform || null,
      strict_location_matching: strictLocationMatching,
    });

    // Update job status to running
    await updatePipelineJobStatus(jobId, 'running');
    await timingTracker.saveToFirestore(); // Save initial timing

    // Stage 1: Query Expansion
    console.log(`[Worker] Step 1: Generating search queries (job: ${jobId})...`);
    
    await updatePipelineStage(jobId, 'query_expansion', 0);
    timingTracker.startStage('query_expansion');
    await updateQueryExpansionStage(jobId, 'running');
    await timingTracker.saveToFirestore();

    let queries: string[] = [];
    
    try {
      // Check for cancellation
      if (await isJobCancelled(jobId)) {
        throw new Error('Pipeline job was cancelled');
      }

      const queryResult = await generateSearchQueriesFromDescription(fullCampaignDescription);
      queries = queryResult.queries;
      const prompt = queryResult.prompt;
      console.log(`[Worker] Generated ${queries.length} queries`);

      // Check for cancellation again
      if (await isJobCancelled(jobId)) {
        throw new Error('Pipeline job was cancelled');
      }

      timingTracker.endStage('query_expansion');
      await updateQueryExpansionStage(jobId, 'completed', queries, undefined, prompt);
      await completeStage(jobId, 'query_expansion');
      // Update progress after query expansion completes (10%)
      await updateProgress(jobId, 'query_expansion');
      await timingTracker.saveToFirestore();
    } catch (error) {
      if (error instanceof Error && error.message === 'Pipeline job was cancelled') {
        timingTracker.endStage('query_expansion');
        await timingTracker.saveToFirestore();
        await updatePipelineJobStatus(jobId, 'cancelled');
        return;
      }
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[Worker] Query expansion failed for job ${jobId}:`, error);
      timingTracker.endStage('query_expansion');
      await updateQueryExpansionStage(jobId, 'error', undefined, errorMsg);
      await timingTracker.saveToFirestore();
      await updatePipelineJobStatus(jobId, 'error', errorMsg);
      throw error;
    }

    // Stage 2: Parallel Hybrid Search
    await updatePipelineStage(jobId, 'weaviate_search', 10);
    timingTracker.startStage('weaviate_search');
    await updateWeaviateSearchStage(jobId, 'running');
    await timingTracker.saveToFirestore();

    console.log(`[Worker] Step 2: Performing parallel hybrid searches (job: ${jobId})...`);

    const alphaValues = [0.2, 0.8];
    // NOTE: We run multiple alphas per query, but alpha variants often overlap heavily.
    // Size the per-search limit based primarily on the number of unique queries so we can still reach weaviate_top_n.
    const perSearchLimit = Math.max(500, Math.ceil((weaviateTopN * 1.25) / Math.max(1, queries.length)));
    let deduplicatedResults: any[] = [];
    let queriesExecuted = 0;
    let totalResultsFromSearch = 0;

    try {
      // Check for cancellation before starting searches
      if (await isJobCancelled(jobId)) {
        throw new Error('Pipeline job was cancelled');
      }

      // Perform parallel hybrid searches directly (no HTTP call needed)
      // Request enough results per search to reliably reach weaviate_top_n after deduplication/filtering.
      // Pass excludeProfileUrls to filter out already-found profiles (for "find more" functionality)
      const searchResult = await performParallelHybridSearches(
        queries,
        alphaValues,
        perSearchLimit,
        minFollowers ?? undefined,
        maxFollowers ?? undefined,
        platform ?? undefined,
        timingTracker,
        async (stage) => {
          // Update progress after embedding generation (20%) or searches complete (50%)
          if (stage === 'embedding_generation') {
            await updateProgress(jobId, 'weaviate_search', 'embedding_generation');
          } else if (stage === 'searches_complete') {
            await updateProgress(jobId, 'weaviate_search', 'searches_complete');
          }
        },
        excludeProfileUrls // Exclude previously found profiles
      );

      deduplicatedResults = searchResult.deduplicatedResults;
      queriesExecuted = searchResult.queriesExecuted;
      totalResultsFromSearch = deduplicatedResults.length;

      console.log(`[Worker] Weaviate search: ${queriesExecuted} searches → ${totalResultsFromSearch} unique profiles`);

      // Check for cancellation after searches
      if (await isJobCancelled(jobId)) {
        throw new Error('Pipeline job was cancelled');
      }

      timingTracker.endStage('weaviate_search');
      await updateWeaviateSearchStage(
        jobId,
        'completed',
        totalResultsFromSearch,
        deduplicatedResults.length,
        queriesExecuted
      );
      await completeStage(jobId, 'weaviate_search');
      // Update progress after all Weaviate searches complete (50%)
      await updateProgress(jobId, 'weaviate_search', 'searches_complete');
      await timingTracker.saveToFirestore();
    } catch (error) {
      if (error instanceof Error && error.message === 'Pipeline job was cancelled') {
        timingTracker.endStage('weaviate_search');
        await timingTracker.saveToFirestore();
        await updatePipelineJobStatus(jobId, 'cancelled');
        return;
      }
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      timingTracker.endStage('weaviate_search');
      await updateWeaviateSearchStage(
        jobId,
        'error',
        undefined,
        undefined,
        queriesExecuted,
        errorMsg
      );
      await timingTracker.saveToFirestore();
      await updatePipelineJobStatus(jobId, 'error', errorMsg);
      throw error;
    }

    // Stage 3: Extract Top N Profiles
    const topCandidates = extractTopCandidates(deduplicatedResults, weaviateTopN, platform);
    console.log(`[Worker] Step 3: Extracted ${topCandidates.length} candidates (weaviate_top_n=${weaviateTopN}, llm_top_n=${llmTopN})`);

    // Save all Weaviate candidates to Storage for frontend preview
    if (topCandidates.length > 0) {
      try {
        await saveWeaviateCandidates(jobId, topCandidates);
      } catch (error) {
        console.error(`[Worker] Failed to save candidates:`, error);
        // Don't fail the pipeline if candidate saving fails
      }
    }

    // Extract all weaviate_top_n profile URLs for BrightData collection and LLM analysis
    const topProfileUrls = topCandidates.map(c => c.profile_url);

    if (topProfileUrls.length === 0) {
      await updatePipelineJobStatus(jobId, 'completed');
      await storePipelineResults(jobId, [], {
        queries_generated: queries.length,
        total_search_results: totalResultsFromSearch,
        deduplicated_results: deduplicatedResults.length,
        profiles_collected: 0,
        profiles_analyzed: 0,
      });
      await finalizePipelineProgress(jobId);
      return;
    }

    // Stage 4: BrightData Collection (Cache-first) + Stage 5: LLM Analysis (Adaptive Stop)
    await updateProgress(jobId, 'brightdata_collection'); // 50% - starting batch processing
    timingTracker.startStage('brightdata_collection');
    await updateBrightDataStage(jobId, 'running', topProfileUrls.length);
    timingTracker.startStage('llm_analysis');
    await updateLLMAnalysisStage(jobId, 'running');
    await timingTracker.saveToFirestore();

    console.log(`[Worker] Step 4-5: Cache-first analyze + BrightData as-needed (${topProfileUrls.length} candidates, target=${llmTopN} good fits, threshold=${getGoodFitThreshold()})`);

    const goodFitThreshold = getGoodFitThreshold();
    const targetGoodCount = llmTopN;
    const maxConcurrentLLM = getMaxConcurrentLLMRequests();

    // BrightData constraints: 20 urls per batch, keep 5 batches in flight when possible (≈100 profiles)
    const batchSize = 20;
    const maxInFlightBatches = 5;
    const pollingIntervalSec = 10;
    const maxWaitTimeSec = 3600;
    const BATCH_TIMEOUT_MS = 5 * 60 * 1000;

    // Track cache + cost stats
    let cacheHits = 0;
    let apiCalls = 0; // Count profiles fetched from BrightData (approx cost driver)

    // Track stopping condition
    let goodFound = 0;

    // Track stage stats locally (mirrored into Firestore via updateBatchCounters)
    let batchesCompleted = 0;
    let batchesFailed = 0;

    // Track batch indices to avoid collisions between cache + BrightData batches
    let nextBatchIndex = 0;

    // Helper: normalize + analyze + store a batch, update progressive results and counters.
    const processAndStoreBatch = async (options: {
      batchIndex: number;
      platform: BrightDataPlatform;
      snapshotId: string;
      profiles: BrightDataProfile[];
    }): Promise<void> => {
      const { batchIndex, platform, snapshotId, profiles } = options;
      const isCached = snapshotId === 'cached';
      const batchRelativeStart = Date.now() / 1000 - timingTracker.getPipelineStartTime();

      // Cancellation check before any work
      if (await isJobCancelled(jobId)) {
        throw new Error('Pipeline job was cancelled');
      }

      if (!profiles || !Array.isArray(profiles)) {
        throw new Error(`Batch ${batchIndex + 1} profiles is not an array: ${typeof profiles}`);
      }

      console.log(
        `[Worker] Batch ${batchIndex + 1}${isCached ? ' (cached)' : ''}: ${profiles.length} ${platform} profiles`
      );

      // Track BrightData batch timing (cache batches still count as "collection" work)
      timingTracker.addBatchTiming('brightdata_collection', batchIndex, batchRelativeStart);

      // Normalize profiles
      timingTracker.startSubStage('brightdata_collection', 'profile_normalization');
      const normalizedProfiles = normalizeProfiles(profiles as any);
      timingTracker.endSubStage('brightdata_collection', 'profile_normalization');

      if (await isJobCancelled(jobId)) {
        throw new Error('Pipeline job was cancelled');
      }

      // Track LLM timing
      const llmBatchStart = Date.now() / 1000 - timingTracker.getPipelineStartTime();
      timingTracker.addBatchTiming('llm_analysis', batchIndex, llmBatchStart);

      const analysisResults = await analyzeProfileFitBatch(
        normalizedProfiles,
        fullCampaignDescription,
        maxConcurrentLLM,
        strictLocationMatching
      );

      const llmBatchEnd = Date.now() / 1000 - timingTracker.getPipelineStartTime();
      timingTracker.addBatchTiming('llm_analysis', batchIndex, llmBatchStart, llmBatchEnd);

      const analyzedProfiles: Array<
        BrightDataUnifiedProfile & { fit_score: number; fit_rationale: string; fit_summary: string }
      > = normalizedProfiles.map((profile, index) => ({
        ...profile,
        fit_score: analysisResults[index]?.fit_score || 0,
        fit_rationale: analysisResults[index]?.fit_rationale || 'Analysis failed',
        fit_summary: analysisResults[index]?.fit_summary || 'Unable to analyze',
      }));

      // Update good-fit counter (9/10+)
      const goodInBatch = analyzedProfiles.filter(isGoodFit).length;
      goodFound += goodInBatch;

      // Store batch results incrementally (prevents race conditions)
      analyzedProfiles.sort((a, b) => b.fit_score - a.fit_score);
      await appendBatchResults(jobId, batchIndex, analyzedProfiles);

      batchesCompleted++;
      await updateBatchCounters(jobId, batchesCompleted, 0, batchesFailed, totalPlannedBatches);

      try {
        await updateProgressiveTopN(jobId, batchesCompleted, llmTopN);
      } catch (progressiveError) {
        console.warn(`[Worker] Failed to update progressive top-N for batch ${batchIndex + 1}:`, progressiveError);
      }

      const batchRelativeEnd = Date.now() / 1000 - timingTracker.getPipelineStartTime();
      timingTracker.addBatchTiming('brightdata_collection', batchIndex, batchRelativeStart, batchRelativeEnd);

      console.log(
        `[Worker] Batch ${batchIndex + 1} complete: ${analyzedProfiles.length} analyzed (${goodInBatch} >= ${goodFitThreshold}) (good_found=${goodFound}/${targetGoodCount})`
      );
    };

    // Build cache + BrightData plans up-front so Firestore can show total_batches.
    // Cache lookup for the entire candidate pool.
    console.log(`[Worker] Checking BrightData cache for ${topProfileUrls.length} profiles...`);
    const cachedProfilesMap = await getCachedProfilesBatch(topProfileUrls);
    cacheHits = cachedProfilesMap.size;
    const cachedUrls = new Set(cachedProfilesMap.keys());
    const uncachedUrls = topProfileUrls.filter((url) => !cachedUrls.has(url));
    console.log(`[Worker] BrightData cache: ${cacheHits} hits, ${uncachedUrls.length} misses`);

    // Cache batches (chunked) - process fully before any BrightData triggers.
    const cachedInstagramProfiles: BrightDataProfile[] = [];
    const cachedTikTokProfiles: BrightDataProfile[] = [];

    for (const url of topProfileUrls) {
      const cachedProfile = cachedProfilesMap.get(url);
      if (!cachedProfile) continue;
      const p = detectPlatformFromUrl(url);
      if (p === 'instagram') {
        cachedInstagramProfiles.push(cachedProfile);
      } else {
        cachedTikTokProfiles.push(cachedProfile);
      }
    }

    const cachedInstagramBatches = chunkArray(cachedInstagramProfiles, batchSize);
    const cachedTikTokBatches = chunkArray(cachedTikTokProfiles, batchSize);

    // BrightData batches (uncached URLs) - only triggered if needed.
    const uncachedInstagramUrls: string[] = [];
    const uncachedTikTokUrls: string[] = [];
    for (const url of uncachedUrls) {
      const p = detectPlatformFromUrl(url);
      if (p === 'instagram') {
        uncachedInstagramUrls.push(url);
      } else {
        uncachedTikTokUrls.push(url);
      }
    }

    const uncachedInstagramBatches = chunkArray(uncachedInstagramUrls, batchSize);
    const uncachedTikTokBatches = chunkArray(uncachedTikTokUrls, batchSize);

    const totalPlannedBatches =
      cachedInstagramBatches.length +
      cachedTikTokBatches.length +
      uncachedInstagramBatches.length +
      uncachedTikTokBatches.length;

    // Initialize batch counters with a stable total_batches so progress is meaningful.
    await updateBatchCounters(jobId, 0, 0, 0, totalPlannedBatches);

    try {
      // Phase A: Cached profiles first
      for (const batchProfiles of cachedInstagramBatches) {
        if (await isJobCancelled(jobId)) throw new Error('Pipeline job was cancelled');
        if (goodFound >= targetGoodCount) break;
        await processAndStoreBatch({
          batchIndex: nextBatchIndex++,
          platform: 'instagram',
          snapshotId: 'cached',
          profiles: batchProfiles,
        });
      }

      for (const batchProfiles of cachedTikTokBatches) {
        if (await isJobCancelled(jobId)) throw new Error('Pipeline job was cancelled');
        if (goodFound >= targetGoodCount) break;
        await processAndStoreBatch({
          batchIndex: nextBatchIndex++,
          platform: 'tiktok',
          snapshotId: 'cached',
          profiles: batchProfiles,
        });
      }

      const hitTargetFromCache = goodFound >= targetGoodCount;
      if (hitTargetFromCache) {
        console.log(`[Worker] Target reached from cache only (good_found=${goodFound}/${targetGoodCount}), skipping BrightData`);
      }

      // Phase B: BrightData, only if needed
      if (!hitTargetFromCache && (uncachedInstagramUrls.length > 0 || uncachedTikTokUrls.length > 0)) {
        const apiKey = getBrightDataApiKey();
        const baseUrl = getBrightDataBaseUrl();

        const pendingBatches: Array<{ platform: BrightDataPlatform; urls: string[]; batchIndex: number }> = [];
        for (const urls of uncachedInstagramBatches) {
          pendingBatches.push({ platform: 'instagram', urls, batchIndex: nextBatchIndex++ });
        }
        for (const urls of uncachedTikTokBatches) {
          pendingBatches.push({ platform: 'tiktok', urls, batchIndex: nextBatchIndex++ });
        }

        type InFlightSnapshot = {
          snapshotId: string;
          platform: BrightDataPlatform;
          batchIndex: number;
          triggeredAt: number;
          urlCount: number;
        };

        const inFlight = new Map<string, InFlightSnapshot>();
        let nextToTrigger = 0;
        const brightdataStart = Date.now();
        const maxWaitMs = maxWaitTimeSec * 1000;

        const topUpInFlight = async (): Promise<void> => {
          while (inFlight.size < maxInFlightBatches && nextToTrigger < pendingBatches.length && goodFound < targetGoodCount) {
            if (await isJobCancelled(jobId)) throw new Error('Pipeline job was cancelled');
            const batch = pendingBatches[nextToTrigger++];
            try {
              const snapshotResults = await triggerCollection(batch.urls, apiKey, baseUrl);
              const snapshot = snapshotResults.find((s) => s.platform === batch.platform);
              if (!snapshot) {
                throw new Error(`No snapshot returned for ${batch.platform} batch`);
              }

              inFlight.set(snapshot.snapshot_id, {
                snapshotId: snapshot.snapshot_id,
                platform: batch.platform,
                batchIndex: batch.batchIndex,
                triggeredAt: Date.now(),
                urlCount: batch.urls.length,
              });

              console.log(
                `[Worker] Triggered BrightData batch ${batch.batchIndex + 1} (${batch.platform}) snapshot ${snapshot.snapshot_id} (${batch.urls.length} urls) (in_flight=${inFlight.size}/${maxInFlightBatches})`
              );
            } catch (error) {
              batchesFailed++;
              await updateBatchCounters(jobId, batchesCompleted, 0, batchesFailed, totalPlannedBatches);
              console.error(
                `[Worker] Failed to trigger BrightData batch ${batch.batchIndex + 1} (${batch.platform}):`,
                error
              );
            }
          }
        };

        // Initial fill
        await topUpInFlight();

        while ((inFlight.size > 0 || nextToTrigger < pendingBatches.length) && goodFound < targetGoodCount) {
          if (await isJobCancelled(jobId)) throw new Error('Pipeline job was cancelled');

          const elapsed = Date.now() - brightdataStart;
          if (elapsed >= maxWaitMs) {
            console.error(
              `[Worker] BrightData timeout after ${Math.round(elapsed / 1000)}s: ${inFlight.size} batches still in-flight, ${pendingBatches.length - nextToTrigger} not triggered`
            );
            batchesFailed += inFlight.size + (pendingBatches.length - nextToTrigger);
            break;
          }

          const inFlightSnapshots = Array.from(inFlight.values());
          const progressResults = await Promise.allSettled(
            inFlightSnapshots.map((snapshot) => checkProgress(snapshot.snapshotId, apiKey, baseUrl))
          );

          const ready: InFlightSnapshot[] = [];

          for (let i = 0; i < progressResults.length; i++) {
            const snapshot = inFlightSnapshots[i];
            const progressResult = progressResults[i];

            // Safety: snapshot may have been removed if duplicates (shouldn't happen)
            if (!snapshot || !inFlight.has(snapshot.snapshotId)) continue;

            const ageMs = Date.now() - snapshot.triggeredAt;
            if (ageMs >= BATCH_TIMEOUT_MS) {
              inFlight.delete(snapshot.snapshotId);
              batchesFailed++;
              console.error(
                `[Worker] BrightData batch ${snapshot.batchIndex + 1} timed out after ${Math.round(ageMs / 1000)}s (snapshot=${snapshot.snapshotId})`
              );
              continue;
            }

            if (progressResult.status !== 'fulfilled') {
              console.warn(`[Worker] BrightData progress check failed for snapshot ${snapshot.snapshotId}:`, progressResult.reason);
              continue;
            }

            const progress = progressResult.value;
            if (progress.status === 'ready' || progress.status === 'completed') {
              inFlight.delete(snapshot.snapshotId);
              ready.push(snapshot);
            } else if (progress.status === 'failed') {
              inFlight.delete(snapshot.snapshotId);
              batchesFailed++;
              console.error(`[Worker] BrightData batch ${snapshot.batchIndex + 1} failed (snapshot=${snapshot.snapshotId})`);
            }
          }

          // Top up as soon as we free slots, before doing any heavy downloads/LLM.
          await topUpInFlight();

          // Process ready batches sequentially to ensure we never exceed the global LLM concurrency cap.
          for (const snapshot of ready) {
            if (await isJobCancelled(jobId)) throw new Error('Pipeline job was cancelled');
            if (goodFound >= targetGoodCount) break;

            console.log(`[Worker] Downloading BrightData snapshot ${snapshot.snapshotId} (batch ${snapshot.batchIndex + 1})...`);
            const profiles = await downloadResults(snapshot.snapshotId, apiKey, baseUrl);
            apiCalls += profiles.length;

            // Cache downloaded profiles asynchronously (best-effort)
            if (profiles.length > 0) {
              const profilesToCache = profiles.map((profile) => ({
                url: extractProfileUrl(profile, snapshot.platform),
                platform: snapshot.platform,
                data: profile,
              }));
              setCachedProfilesBatch(profilesToCache).catch((err) => {
                console.warn(`[Worker] Failed to cache profiles for batch ${snapshot.batchIndex + 1}:`, err);
              });
            }

            await processAndStoreBatch({
              batchIndex: snapshot.batchIndex,
              platform: snapshot.platform,
              snapshotId: snapshot.snapshotId,
              profiles,
            });
          }

          if (goodFound >= targetGoodCount) {
            console.log(`[Worker] Target reached during BrightData processing (good_found=${goodFound}/${targetGoodCount}), stopping early`);
            break;
          }

          if (ready.length === 0) {
            // Sleep between polls, but keep cancellation responsive.
            const waitMs = pollingIntervalSec * 1000;
            const checkIntervalMs = 500;
            let waited = 0;
            while (waited < waitMs) {
              if (await isJobCancelled(jobId)) throw new Error('Pipeline job was cancelled');
              const sleepFor = Math.min(checkIntervalMs, waitMs - waited);
              await new Promise((resolve) => setTimeout(resolve, sleepFor));
              waited += sleepFor;
            }
          }
        }
      }

      // If no more work can be done, we finalize with whatever we have.
      console.log(`[Worker] Collection/analyze complete: ${batchesCompleted} batches, ${batchesFailed} failed (good_found=${goodFound}/${targetGoodCount})`);

      // Ensure Firestore reflects the final counters even if the last events were failures/timeouts.
      await updateBatchCounters(jobId, batchesCompleted, 0, batchesFailed, totalPlannedBatches);

      // Merge all completed batch files into final profiles.json
      const mergedProfiles = await mergeBatchResults(jobId);

      try {
        await finalizeProgressiveResults(jobId);
      } catch (progressiveError) {
        console.warn(`[Worker] Failed to finalize progressive results:`, progressiveError);
      }

      mergedProfiles.sort((a, b) => (b.fit_score || 0) - (a.fit_score || 0));
      const finalProfiles = mergedProfiles.slice(0, llmTopN);
      const remainingProfiles = mergedProfiles.slice(llmTopN);

      console.log(`[Worker] Selected top ${finalProfiles.length} profiles (from ${mergedProfiles.length} analyzed)`);
      console.log(`[Worker] Storing ${remainingProfiles.length} remaining profiles separately`);

      timingTracker.endStage('brightdata_collection');
      timingTracker.endStage('llm_analysis');
      await updateBrightDataStage(jobId, 'completed', topProfileUrls.length, mergedProfiles.length, null, cacheHits, apiCalls);
      await completeStage(jobId, 'brightdata_collection');
      await updateLLMAnalysisStage(jobId, 'completed', mergedProfiles.length);
      await completeStage(jobId, 'llm_analysis');
      await timingTracker.saveToFirestore();

      if (remainingProfiles.length > 0) {
        try {
          await storeRemainingProfiles(jobId, remainingProfiles);
        } catch (error) {
          console.error(`[Worker] Failed to store remaining profiles:`, error);
        }
      }

      const brightdataCost = apiCalls * 0.0015;
      const openaiCost = mergedProfiles.length * 0.0015;
      const totalCost = brightdataCost + openaiCost;

      const pipelineStats = {
        queries_generated: queries.length,
        total_search_results: totalResultsFromSearch,
        deduplicated_results: deduplicatedResults.length,
        profiles_collected: finalProfiles.length,
        profiles_analyzed: mergedProfiles.length,
        cache_hits: cacheHits,
        api_calls: apiCalls,
        brightdata_cost: brightdataCost,
        openai_cost: openaiCost,
        total_cost: totalCost,
      };

      console.log(`[Worker] Pipeline costs: BrightData $${brightdataCost.toFixed(4)}, OpenAI $${openaiCost.toFixed(4)}, Total $${totalCost.toFixed(4)}`);

      await storePipelineResults(jobId, finalProfiles, pipelineStats);
      timingTracker.endPipeline();
      await timingTracker.saveToFirestore();
      await updatePipelineJobStatus(jobId, 'completed');
      await updateProgress(jobId, null);
      await finalizePipelineProgress(jobId);
    } catch (error) {
      if (error instanceof Error && error.message === 'Pipeline job was cancelled') {
        timingTracker.endStage('brightdata_collection');
        timingTracker.endStage('llm_analysis');
        await timingTracker.saveToFirestore();
        await updatePipelineJobStatus(jobId, 'cancelled');
        return;
      }

      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      timingTracker.endStage('brightdata_collection');
      timingTracker.endStage('llm_analysis');
      await updateBrightDataStage(jobId, 'error', topProfileUrls.length, undefined, errorMsg);
      await updateLLMAnalysisStage(jobId, 'error', undefined, errorMsg);
      await timingTracker.saveToFirestore();
      await updatePipelineJobStatus(jobId, 'error', errorMsg);
      throw error;
    }

    console.log(`[Worker] Pipeline completed: ${jobId}`);
  } catch (error) {
    console.error('[Worker] Pipeline execution error:', {
      request_id: requestId,
      job_id: jobId,
      uid: uid,
      campaign_id: campaign_id || null,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    try {
      timingTracker.endPipeline();
      await timingTracker.saveToFirestore();
      await updatePipelineJobStatus(jobId, 'error', errorMessage);
    } catch (firestoreError) {
      console.error('[Worker] Failed to update Firestore with error:', firestoreError);
    }
    throw error;
  }
}
