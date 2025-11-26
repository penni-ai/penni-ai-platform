/**
 * Pub/Sub worker handler for pipeline execution
 * Executes the full pipeline asynchronously when triggered by Pub/Sub message
 */

import { generateSearchQueriesFromDescription } from '../utils/search-query-generator.js';
import { performParallelHybridSearches } from '../utils/weaviate-search.js';
import { normalizeProfiles } from '../utils/profile-normalizer.js';
import { processBatchedCollectionStreaming, type StreamingBatchConfig } from '../utils/streaming-batch-processor.js';
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
} from '../utils/firestore-tracker.js';
import { PipelineTimingTracker } from '../utils/timing-tracker.js';
import type { BrightDataUnifiedProfile } from '../types/brightdata.js';

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
function extractTopProfiles(results: any[], topN: number, platform?: string | null): string[] {
  const candidates = extractTopCandidates(results, topN, platform);
  return candidates.map(c => c.profile_url);
}

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
  } = messageData;

  // Initialize timing tracker
  const timingTracker = new PipelineTimingTracker(jobId);

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
        const businessLocation = collectedData?.business_location || campaignData?.business_location || null;
        const website = collectedData?.website || campaignData?.website || null;
        
        if (businessName) {
          campaignDetails.push(`Business Name: ${businessName}`);
        }
        if (businessAbout) {
          campaignDetails.push(`Business Description: ${businessAbout}`);
        }
        if (businessLocation) {
          campaignDetails.push(`Business Location: ${businessLocation}`);
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
              businessLocation: !!businessLocation,
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
    const queryExpansionStartTime = Date.now();
    const MIN_QUERY_EXPANSION_DURATION_MS = 3000; // Minimum 3 seconds to show progress
    
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

      // Calculate elapsed time
      const elapsedTime = Date.now() - queryExpansionStartTime;
      const remainingTime = Math.max(0, MIN_QUERY_EXPANSION_DURATION_MS - elapsedTime);
      
      // If query expansion finished too quickly, wait the remaining time
      // This ensures the UI shows progress for a minimum duration
      if (remainingTime > 0) {
        console.log(`[Worker] Query expansion completed in ${elapsedTime}ms, waiting ${remainingTime}ms to meet minimum duration`);
        
        // Wait in smaller chunks to respect cancellation checks
        const checkInterval = 500; // Check every 500ms
        let waited = 0;
        while (waited < remainingTime) {
          // Check for cancellation during wait
          if (await isJobCancelled(jobId)) {
            throw new Error('Pipeline job was cancelled');
          }
          
          const waitTime = Math.min(checkInterval, remainingTime - waited);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          waited += waitTime;
        }
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
    let deduplicatedResults: any[] = [];
    let queriesExecuted = 0;
    let totalResultsFromSearch = 0;

    try {
      // Check for cancellation before starting searches
      if (await isJobCancelled(jobId)) {
        throw new Error('Pipeline job was cancelled');
      }

      // Perform parallel hybrid searches directly (no HTTP call needed)
      // Request 300 results per search to ensure we have enough after deduplication
      const searchResult = await performParallelHybridSearches(
        queries,
        alphaValues,
        500, // Hardcoded: 300 results per search
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
        }
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

    // Stage 4: BrightData Collection (Streaming) + Stage 5: LLM Analysis (Concurrent)
    await updateProgress(jobId, 'brightdata_collection'); // 50% - starting batch processing
    timingTracker.startStage('brightdata_collection');
    await updateBrightDataStage(jobId, 'running', topProfileUrls.length);
    timingTracker.startStage('llm_analysis');
    await updateLLMAnalysisStage(jobId, 'running');
    await timingTracker.saveToFirestore();

    console.log(`[Worker] Step 4-5: Collecting & analyzing ${topProfileUrls.length} profiles...`);

    const streamingConfig: StreamingBatchConfig = {
      batchSize: 20,
      maxConcurrentBatches: 10,
      pollingInterval: 10,
      maxWaitTime: 3600,
    };

    // Track all processed profiles
    const allAnalyzedProfiles: Array<BrightDataUnifiedProfile & { fit_score: number; fit_rationale: string; fit_summary: string }> = [];
    let batchesCompleted = 0;
    let batchesFailed = 0;

    // Calculate total batches
    const batchSize = streamingConfig.batchSize || 20;
    const totalBatches = Math.ceil(topProfileUrls.length / batchSize);

    try {
      // Use streaming processor - processes batches as they become ready
      await processBatchedCollectionStreaming(
        topProfileUrls,
        streamingConfig,
        timingTracker,
        async (batchResult) => {
          // This callback is called for each batch as it completes
          const batchRelativeStart = Date.now() / 1000 - timingTracker.getPipelineStartTime();
          
          try {
            // Check for cancellation before processing batch
            if (await isJobCancelled(jobId)) {
              throw new Error('Pipeline job was cancelled');
            }

            // Validate profiles array
            if (!batchResult.profiles || !Array.isArray(batchResult.profiles)) {
              throw new Error(`Batch ${batchResult.batchIndex + 1} profiles is not an array: ${typeof batchResult.profiles}`);
            }
            
            console.log(`[Worker] Batch ${batchResult.batchIndex + 1}/${totalBatches}: ${batchResult.profiles.length} ${batchResult.platform} profiles`);

            // Track BrightData batch start
            timingTracker.addBatchTiming('brightdata_collection', batchResult.batchIndex, batchRelativeStart);

            // Normalize profiles
            const normalizationStart = Date.now() / 1000 - timingTracker.getPipelineStartTime();
            timingTracker.startSubStage('brightdata_collection', 'profile_normalization');
            const normalizedProfiles = normalizeProfiles(batchResult.profiles);
            timingTracker.endSubStage('brightdata_collection', 'profile_normalization');

            // Check for cancellation before LLM analysis
            if (await isJobCancelled(jobId)) {
              throw new Error('Pipeline job was cancelled');
            }

            // Track LLM batch start
            const llmBatchStart = Date.now() / 1000 - timingTracker.getPipelineStartTime();
            timingTracker.addBatchTiming('llm_analysis', batchResult.batchIndex, llmBatchStart);

            // LLM analysis (concurrent batch processing)
            const analysisResults = await analyzeProfileFitBatch(
              normalizedProfiles,
              fullCampaignDescription,
              20 // maxConcurrent
            );

            // Track LLM batch end
            const llmBatchEnd = Date.now() / 1000 - timingTracker.getPipelineStartTime();
            timingTracker.addBatchTiming('llm_analysis', batchResult.batchIndex, llmBatchStart, llmBatchEnd);

            // Combine profiles with analysis results
            const analyzedProfiles: Array<BrightDataUnifiedProfile & { fit_score: number; fit_rationale: string; fit_summary: string }> = normalizedProfiles.map((profile, index) => ({
              ...profile,
              fit_score: analysisResults[index]?.fit_score || 0,
              fit_rationale: analysisResults[index]?.fit_rationale || 'Analysis failed',
              fit_summary: analysisResults[index]?.fit_summary || 'Unable to analyze',
            }));


            // Sort by fit score
            analyzedProfiles.sort((a, b) => b.fit_score - a.fit_score);

            // Store batch results incrementally using separate batch files (prevents race conditions)
            await appendBatchResults(jobId, batchResult.batchIndex, analyzedProfiles);

            // Track for final aggregation
            allAnalyzedProfiles.push(...analyzedProfiles);

            batchesCompleted++;
            const batchesProcessing = totalBatches - batchesCompleted - batchesFailed;
            await updateBatchCounters(jobId, batchesCompleted, batchesProcessing, batchesFailed, totalBatches);
            
            // Update progress after each batch completes (incremental from 50%)
            await updateProgress(jobId, 'brightdata_collection', undefined, {
              completed: batchesCompleted,
              total: totalBatches,
            });

            // Track BrightData batch end
            const batchRelativeEnd = Date.now() / 1000 - timingTracker.getPipelineStartTime();
            timingTracker.addBatchTiming('brightdata_collection', batchResult.batchIndex, batchRelativeStart, batchRelativeEnd);

            console.log(`[Worker] Batch ${batchResult.batchIndex + 1}/${totalBatches} complete: ${analyzedProfiles.length} analyzed`);

          } catch (error) {
            // Handle cancellation separately
            if (error instanceof Error && error.message === 'Pipeline job was cancelled') {
              throw error; // Re-throw to stop processing
            }
            console.error(`[Worker] Error processing batch ${batchResult.batchIndex + 1}:`, error);
            batchesFailed++;
            const batchesProcessing = totalBatches - batchesCompleted - batchesFailed;
            await updateBatchCounters(jobId, batchesCompleted, batchesProcessing, batchesFailed, totalBatches);
          }
        }
      );

      // Check for cancellation after streaming completes
      if (await isJobCancelled(jobId)) {
        await updatePipelineJobStatus(jobId, 'cancelled');
        return;
      }

      console.log(`[Worker] Collection complete: ${batchesCompleted} batches, ${batchesFailed} failed`);

      // Merge all batch files into final profiles.json
      const mergedProfiles = await mergeBatchResults(jobId, totalBatches);
      
      // Sort all analyzed profiles by fit score (descending - highest fit_score first)
      mergedProfiles.sort((a, b) => (b.fit_score || 0) - (a.fit_score || 0));
      
      // Take top llm_top_n profiles based on fit_score (final results)
      // All weaviate_top_n profiles were analyzed, now we select the best llm_top_n by fit_score
      const finalProfiles = mergedProfiles.slice(0, llmTopN);
      const remainingProfiles = mergedProfiles.slice(llmTopN);
      console.log(`[Worker] Selected top ${finalProfiles.length} profiles (from ${mergedProfiles.length} analyzed)`);
      console.log(`[Worker] Storing ${remainingProfiles.length} remaining profiles separately`);

      timingTracker.endStage('brightdata_collection');
      timingTracker.endStage('llm_analysis');
      await updateBrightDataStage(
        jobId,
        'completed',
        topProfileUrls.length,
        mergedProfiles.length
      );
      await completeStage(jobId, 'brightdata_collection');
      await updateLLMAnalysisStage(
        jobId,
        'completed',
        mergedProfiles.length
      );
      await completeStage(jobId, 'llm_analysis');
      await timingTracker.saveToFirestore();

      // Store remaining profiles (non-top-n) in a separate file
      if (remainingProfiles.length > 0) {
        try {
          await storeRemainingProfiles(jobId, remainingProfiles);
        } catch (error) {
          console.error(`[Worker] Failed to store remaining profiles:`, error);
          // Don't fail the pipeline if remaining profiles storage fails
        }
      }

      // Finalize: Store results and update status
      const pipelineStats = {
        queries_generated: queries.length,
        total_search_results: totalResultsFromSearch,
        deduplicated_results: deduplicatedResults.length,
        profiles_collected: finalProfiles.length, // Final profiles after fit_score sorting
        profiles_analyzed: mergedProfiles.length, // All profiles analyzed
      };

      // Store final top llm_top_n results sorted by fit_score
      await storePipelineResults(jobId, finalProfiles, pipelineStats);
      timingTracker.endPipeline();
      await timingTracker.saveToFirestore();
      await updatePipelineJobStatus(jobId, 'completed');
      // Update progress to 100% (finalization)
      await updateProgress(jobId, null);
      await finalizePipelineProgress(jobId);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      timingTracker.endStage('brightdata_collection');
      timingTracker.endStage('llm_analysis');
      await updateBrightDataStage(
        jobId,
        'error',
        topProfileUrls.length,
        undefined,
        errorMsg
      );
      await updateLLMAnalysisStage(
        jobId,
        'error',
        undefined,
        errorMsg
      );
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


