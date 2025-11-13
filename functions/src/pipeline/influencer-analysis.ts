/**
 * Complete influencer analysis pipeline:
 * 1. Query expansion (generate 12 search queries)
 * 2. Multi-alpha Weaviate search (0.2, 0.5, 0.8 alpha, 500 results each)
 * 3. Aggregate and deduplicate results
 * 4. Top 5 profiles → BrightData collection
 * 5. LLM analysis with fit scoring
 */

import { randomUUID } from 'crypto';
import { onRequest } from 'firebase-functions/v2/https';
import OpenAI from 'openai';
import type { BrightDataUnifiedProfile } from '../types/brightdata.js';
import { normalizeProfiles } from '../utils/profile-normalizer.js';
import {
  createPipelineJob,
  updatePipelineJobStatus,
  updatePipelineStage,
  completeStage,
  updateQueryExpansionStage,
  updateWeaviateSearchStage,
  updateBrightDataStage,
  updateLLMAnalysisStage,
  storePipelineResults,
  appendBatchResults,
  updateBatchCounters,
  isJobCancelled,
  cancelPipelineJob,
  finalizePipelineProgress,
} from '../utils/firestore-tracker.js';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuthInstance, getFirestoreInstance } from '../utils/firebase-admin.js';

const db = getFirestoreInstance();
const auth = getAuthInstance();
const CAMPAIGN_BIND_RETRY_DELAYS_MS = [0, 100, 500, 1000];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type OptionalIntParseResult = {
  provided: boolean;
  value: number | null;
  isValid: boolean;
};

function parseOptionalInteger(raw: unknown): OptionalIntParseResult {
  if (raw === undefined || raw === null || raw === '') {
    return { provided: false, value: null, isValid: true };
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return { provided: true, value: null, isValid: false };
  }
  return { provided: true, value: parsed, isValid: true };
}

function extractBearerToken(headerValue?: string | string[]): string | null {
  if (!headerValue) return null;
  const headerRaw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const header = headerRaw ?? '';
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

async function bindPipelineToCampaignWithRetries(options: {
  uid: string;
  campaignId: string;
  pipelineId: string;
  startedAtMs: number;
  requestId?: string;
}): Promise<{
  status: 'updated' | 'noop_same' | 'noop_other' | 'missing_campaign' | 'failed';
  attempts: number;
  campaign_binding_ms: number;
  existingPipelineId?: string;
  error?: string;
}> {
  const { uid, campaignId, pipelineId, startedAtMs, requestId } = options;
  const campaignRef = db.collection('users').doc(uid).collection('campaigns').doc(campaignId);
  const begin = startedAtMs;
  for (let attempt = 1; attempt <= CAMPAIGN_BIND_RETRY_DELAYS_MS.length; attempt++) {
    const delay = CAMPAIGN_BIND_RETRY_DELAYS_MS[attempt - 1] ?? 0;
    if (delay > 0) {
      await sleep(delay);
    }
    try {
      const txnResult = await db.runTransaction(async (tx) => {
        const snapshot = await tx.get(campaignRef);
        if (!snapshot.exists) {
          return { status: 'missing_campaign' as const };
        }
        const existingPipelineId = snapshot.get('pipeline_id');
        if (typeof existingPipelineId === 'string' && existingPipelineId.trim()) {
          if (existingPipelineId === pipelineId) {
            return { status: 'noop_same' as const };
          }
          return { status: 'noop_other' as const, existingPipelineId };
        }
        tx.set(
          campaignRef,
          { pipeline_id: pipelineId, updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        );
        return { status: 'updated' as const };
      });
      const elapsed = Date.now() - begin;
      console.log('[Pipeline] Campaign binding result', {
        request_id: requestId,
        uid,
        campaignId,
        pipelineId,
        attempt,
        status: txnResult.status,
        existingPipelineId: txnResult.existingPipelineId,
        campaign_binding_ms: elapsed,
      });
      return {
        status: txnResult.status,
        attempts: attempt,
        campaign_binding_ms: elapsed,
        ...(txnResult.existingPipelineId
          ? { existingPipelineId: txnResult.existingPipelineId }
          : {}),
      };
    } catch (error) {
      console.error('[Pipeline] Campaign binding attempt failed', {
        request_id: requestId,
        uid,
        campaignId,
        pipelineId,
        attempt,
        error: error instanceof Error ? error.message : String(error),
      });
      if (attempt === CAMPAIGN_BIND_RETRY_DELAYS_MS.length) {
        const elapsed = Date.now() - begin;
        console.error('[Pipeline] Campaign binding failed after retries', {
          request_id: requestId,
          uid,
          campaignId,
          pipelineId,
          campaign_binding_ms: elapsed,
        });
        return {
          status: 'failed',
          attempts: attempt,
          campaign_binding_ms: elapsed,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }
  const elapsed = Date.now() - begin;
  return {
    status: 'failed',
    attempts: CAMPAIGN_BIND_RETRY_DELAYS_MS.length,
    campaign_binding_ms: elapsed,
  };
}

async function performLastChanceCampaignBind(options: {
  uid: string;
  campaignId: string;
  pipelineId: string;
  requestId?: string;
}) {
  const { uid, campaignId, pipelineId, requestId } = options;
  const campaignRef = db.collection('users').doc(uid).collection('campaigns').doc(campaignId);
  try {
    const snapshot = await campaignRef.get();
    if (!snapshot.exists) {
      console.warn('[Pipeline] Last-chance campaign binding skipped (missing campaign)', {
        request_id: requestId,
        uid,
        campaignId,
        pipelineId,
      });
      return 'missing_campaign' as const;
    }
    await campaignRef.set(
      { pipeline_id: pipelineId, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    console.info('[Pipeline] Last-chance campaign binding succeeded', {
      request_id: requestId,
      uid,
      campaignId,
      pipelineId,
    });
    return 'updated' as const;
  } catch (error) {
    console.error('[Pipeline] Last-chance campaign binding failed', {
      request_id: requestId,
      uid,
      campaignId,
      pipelineId,
      error: error instanceof Error ? error.message : String(error),
    });
    return 'failed' as const;
  }
}
import { processBatchedCollectionStreaming, type StreamingBatchConfig } from '../http/brightdata/streaming-batch-processor.js';

/**
 * Get OpenAI API key
 */
function getOpenAIApiKey(): string {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required');
  }
  return apiKey.trim();
}

/**
 * Get OpenAI model (default: gpt-5-nano)
 */
function getOpenAIModel(): string {
  return process.env.OPENAI_MODEL || 'gpt-5-nano';
}

/**
 * Get Weaviate hybrid search base URL
 */
function getWeaviateHybridSearchUrl(): string {
  const baseUrl = process.env.FUNCTIONS_EMULATOR
    ? 'http://127.0.0.1:6200/penni-ai-platform/us-central1'
    : process.env.FUNCTIONS_URL || 'https://us-central1-penni-ai-platform.cloudfunctions.net';
  return `${baseUrl}/weaviateHybridSearch`;
}

/**
 * Get query generation base URL
 */
function getQueryGenerationUrl(): string {
  const baseUrl = process.env.FUNCTIONS_EMULATOR
    ? 'http://127.0.0.1:6200/penni-ai-platform/us-central1'
    : process.env.FUNCTIONS_URL || 'https://us-central1-penni-ai-platform.cloudfunctions.net';
  return `${baseUrl}/generateSearchQueries`;
}

/**
 * Generate search queries from business description
 */
async function generateSearchQueries(businessDescription: string): Promise<string[]> {
  const url = getQueryGenerationUrl();
  const response = await fetch(`${url}?description=${encodeURIComponent(businessDescription)}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Query generation failed: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();
  return data.queries || [];
}

/**
 * Perform hybrid search on Weaviate with specific alpha and optional filters
 */
async function performHybridSearch(
  query: string,
  alpha: number,
  limit: number,
  minFollowers?: number | null,
  maxFollowers?: number | null,
  platform?: string | null
): Promise<any> {
  const url = getWeaviateHybridSearchUrl();
  const params = new URLSearchParams({
    query: query,
    alpha: alpha.toString(),
    limit: limit.toString(),
  });
  
  if (minFollowers !== undefined && minFollowers !== null) {
    params.append('min_followers', minFollowers.toString());
  }
  if (maxFollowers !== undefined && maxFollowers !== null) {
    params.append('max_followers', maxFollowers.toString());
  }
  if (platform !== undefined && platform !== null && platform.trim() !== '') {
    params.append('platform', platform.trim());
  }
  
  const searchUrl = `${url}?${params.toString()}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000); // 1 minute timeout

  try {
    const response = await fetch(searchUrl, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Hybrid search failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Hybrid search timed out after 1 minute');
    }
    throw error;
  }
}

/**
 * Deduplicate search results by profile URL, keeping the highest score for each profile
 * When a profile appears multiple times (from different queries/alphas), keep the result with the highest score
 */
function deduplicateResults(results: any[]): any[] {
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
 * Extract top N profiles from search results (already sorted by score)
 */
function extractTopProfiles(results: any[], topN: number): string[] {
  const profileUrls: string[] = [];

  for (const result of results) {
    if (profileUrls.length >= topN) break;

    const profileUrl = result.data?.profile_url || result.profile_url || result.url;
    if (profileUrl && (profileUrl.includes('instagram.com') || profileUrl.includes('tiktok.com'))) {
      profileUrls.push(profileUrl);
    }
  }

  return profileUrls;
}

/**
 * Format profile for LLM analysis
 * Matches the exact format specified by the user
 */
function formatProfileForLLM(profile: BrightDataUnifiedProfile): string {
  const posts = profile.posts_data?.slice(0, 8) || [];
  const postsText = posts.map((post) => {
    const caption = post.caption || '';
    const mediaType = post.post_type || 'unknown';
    const mediaUrl = post.content_url || 'N/A';
    const isVideo = mediaType === 'video' || mediaType === 'reel' || post.is_video;
    
    // Format: caption content_type: Type image/video: URL
    return `${caption} content_type: ${mediaType} ${isVideo ? 'video' : 'image'}: ${mediaUrl}`;
  }).join('\n\n');

  return `Name: ${profile.display_name || 'N/A'}

URL: ${profile.profile_url}

Followers: ${profile.followers || 0}

Category:

Verified: ${profile.platform === 'instagram' ? 'Instagram' : 'TikTok'}

Bio: ${profile.biography || 'N/A'}

Recent posts (caption and media):

${postsText || 'No posts available'}`;
}

/**
 * Analyze profile with OpenAI for fit score
 */
async function analyzeProfileFit(
  businessDescription: string,
  profile: BrightDataUnifiedProfile,
  openaiClient: OpenAI
): Promise<{ score: number; rationale: string }> {
  const profileText = formatProfileForLLM(profile);
  const model = getOpenAIModel();

  const prompt = `${businessDescription}

Influencer profile:
${profileText}

Evaluate this influencer's fit for the business need described above. Be critical, direct, and concise.

Give your honest business assessment:
- Score >7 (very strong): List 1-2 pros only. Short sentences.
- Score ≤7: List 1 pro and 1 con. Short sentences.
- Maximum 1-2 sentences total. Be critical and to the point.

Return ONLY a strict JSON object with the following schema, no extra text:

{"score": <integer 1-10>, "rationale": <string>}`;

  try {
    const response = await openaiClient.responses.create({
      model: model,
      input: [
        {
          type: 'message',
          role: 'user',
          content: prompt,
        },
      ],
      text: {
        format: {
          type: 'text',
        },
        verbosity: 'medium',
      },
      reasoning: {
        effort: 'medium',
      },
      tools: [],
      store: true,
      include: [
        'reasoning.encrypted_content',
        'web_search_call.action.sources',
      ],
    });

    // Extract text content from Responses API format
    // The Responses API returns output_text directly
    let content = '';
    
    // Try output_text property first (most direct)
    if ((response as any).output_text) {
      content = (response as any).output_text;
    }
    // Try output array structure
    else if (response.output && Array.isArray(response.output)) {
      for (const outputItem of response.output) {
        if (outputItem.type === 'message' && outputItem.content) {
          if (Array.isArray(outputItem.content)) {
            for (const contentItem of outputItem.content) {
              // Check if it's ResponseOutputText type
              if (contentItem.type === 'output_text' && 'text' in contentItem) {
                content = (contentItem as any).text;
                break;
              }
            }
          } else if (typeof outputItem.content === 'string') {
            content = outputItem.content;
          }
        }
        if (content) break;
      }
    }

    if (!content) {
      console.error('[LLM Analysis] Response structure:', JSON.stringify(response, null, 2));
      throw new Error('No text content in OpenAI response. Check response structure above.');
    }

    // Parse JSON from content
    const parsed = JSON.parse(content);
    
    // Validate and normalize score
    let score = parseInt(parsed.score, 10);
    if (isNaN(score) || score < 1) score = 1;
    if (score > 10) score = 10;

    return {
      score,
      rationale: parsed.rationale || 'No rationale provided',
    };
  } catch (error) {
    console.error(`[LLM Analysis] Error analyzing profile ${profile.account_id}:`, error);
    // Return default score on error
    return {
      score: 5,
      rationale: `Analysis error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Analyze multiple profiles with OpenAI (with concurrency control)
 */
async function analyzeProfilesFit(
  businessDescription: string,
  profiles: BrightDataUnifiedProfile[],
  maxConcurrent: number = 5
): Promise<Array<BrightDataUnifiedProfile & { fit_score: number; fit_rationale: string }>> {
  const apiKey = getOpenAIApiKey();
  const openaiClient = new OpenAI({ apiKey });

  const analyzedProfiles: Array<BrightDataUnifiedProfile & { fit_score: number; fit_rationale: string }> = [];

  // Process profiles in batches with concurrency control
  for (let i = 0; i < profiles.length; i += maxConcurrent) {
    const batch = profiles.slice(i, i + maxConcurrent);
    
    console.log(`[LLM Analysis] Analyzing profiles ${i + 1}-${Math.min(i + maxConcurrent, profiles.length)} of ${profiles.length}`);

    const batchResults = await Promise.allSettled(
      batch.map(async (profile) => {
        const analysis = await analyzeProfileFit(businessDescription, profile, openaiClient);
        return {
          ...profile,
          fit_score: analysis.score,
          fit_rationale: analysis.rationale,
        };
      })
    );

    // Collect successful analyses
    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        analyzedProfiles.push(result.value);
      } else {
        console.error(`[LLM Analysis] Failed to analyze profile: ${result.reason}`);
        // Add profile with default score on failure
        const failedProfile = batch[batchResults.indexOf(result)];
        if (failedProfile) {
          analyzedProfiles.push({
            ...failedProfile,
            fit_score: 5,
            fit_rationale: `Analysis failed: ${result.reason}`,
          });
        }
      }
    }

    // Small delay between batches to avoid rate limiting
    if (i + maxConcurrent < profiles.length) {
      await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
    }
  }

  return analyzedProfiles;
}

/**
 * HTTP Cloud Function for complete influencer analysis pipeline
 * 
 * POST /pipeline-influencer-analysis
 * Body: {
 *   "business_description": "coffee shop looking for local influencers",  // Optional: defaults to "restaurant in san francisco looking for local influencers"
 *   "top_n": 5,  // Optional: number of top profiles to analyze (default: 5)
 *   "min_followers": 10000,  // Optional: minimum follower count filter for Weaviate search
 *   "max_followers": 1000000,  // Optional: maximum follower count filter for Weaviate search
 *   "platform": "instagram"  // Optional: platform filter - "instagram" or "tiktok" (no filter by default)
 * }
 * 
 * Query parameters (alternative to body):
 * - business_description: Same as body
 * - top_n: Same as body
 * - min_followers: Same as body
 * - max_followers: Same as body
 * - platform: Same as body
 * 
 * Returns:
 * - 200: Analyzed profiles with fit_score and fit_rationale
 * - 500: Pipeline failed
 */
export const pipelineInfluencerAnalysis = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 3600, // 1 hour max
    memory: '1GiB',
    invoker: 'private',
  },
  async (request, response) => {
    let jobId: string | null = null;
    let requestId = randomUUID();
    
    try {
      const authHeader =
        request.headers?.authorization ?? (request.headers as Record<string, unknown>)?.Authorization;
      const rawRequestIdInput =
        (typeof request.body?.request_id === 'string' && request.body.request_id) ||
        (typeof request.query?.request_id === 'string' && (request.query.request_id as string)) ||
        null;
      requestId = rawRequestIdInput?.trim() || requestId;

      const idToken = extractBearerToken(authHeader as string | string[] | undefined);
      if (!idToken) {
        response.status(401).json({
          error: 'UNAUTHENTICATED',
          message: 'Missing Authorization bearer token.',
          request_id: requestId,
        });
        return;
      }

      let verifiedUid: string;
      try {
        const decoded = await auth.verifyIdToken(idToken);
        verifiedUid = decoded.uid;
      } catch (error) {
        response.status(401).json({
          error: 'UNAUTHENTICATED',
          message: 'Invalid or expired ID token.',
          details: error instanceof Error ? error.message : String(error),
          request_id: requestId,
        });
        return;
      }

      if (!verifiedUid || typeof verifiedUid !== 'string') {
        response.status(401).json({
          error: 'UNAUTHENTICATED',
          message: 'Unable to resolve caller identity.',
          request_id: requestId,
        });
        return;
      }

      const requestedUid = typeof request.body?.uid === 'string' ? request.body.uid.trim() : null;
      if (requestedUid && requestedUid !== verifiedUid) {
        response.status(403).json({
          error: 'UID_MISMATCH',
          message: 'Authenticated user does not match uid in request body.',
          request_id: requestId,
        });
        return;
      }

      const rawCampaignId = request.body?.campaign_id ?? request.query?.campaign_id;
      let campaignId: string | null = null;
      if (rawCampaignId !== undefined && rawCampaignId !== null) {
        if (typeof rawCampaignId !== 'string') {
          response.status(400).json({
            error: 'INVALID_CAMPAIGN_ID',
            message: 'campaign_id must be a string when provided.',
            request_id: requestId,
          });
          return;
        }
        campaignId = rawCampaignId.trim();
        if (!campaignId) {
          response.status(400).json({
            error: 'INVALID_CAMPAIGN_ID',
            message: 'campaign_id must be a non-empty string when provided.',
            request_id: requestId,
          });
          return;
        }
      }

      const rawBusinessDescription =
        request.body?.business_description ?? request.query?.business_description;
      const businessDescription =
        typeof rawBusinessDescription === 'string' ? rawBusinessDescription.trim() : '';
      if (!businessDescription) {
        response.status(400).json({
          error: 'INVALID_BUSINESS_DESCRIPTION',
          message: 'business_description is required and must be a non-empty string.',
          request_id: requestId,
        });
        return;
      }

      const rawTopN = request.body?.top_n ?? request.query?.top_n;
      const topN =
        rawTopN === undefined || rawTopN === null || rawTopN === '' ? 30 : Number(rawTopN);
      if (!Number.isFinite(topN) || !Number.isInteger(topN) || topN < 30 || topN > 100) {
        response.status(400).json({
          error: 'INVALID_TOP_N',
          message: 'top_n must be an integer between 30 and 100.',
          request_id: requestId,
        });
        return;
      }

      const minFollowersResult = parseOptionalInteger(
        request.body?.min_followers ?? request.query?.min_followers
      );
      if (!minFollowersResult.isValid) {
        response.status(400).json({
          error: 'INVALID_FOLLOWER_BOUNDS',
          message: 'min_followers must be a whole number.',
          request_id: requestId,
        });
        return;
      }
      if (minFollowersResult.value !== null && minFollowersResult.value < 0) {
        response.status(400).json({
          error: 'INVALID_FOLLOWER_BOUNDS',
          message: 'min_followers must be a non-negative number.',
          request_id: requestId,
        });
        return;
      }

      const maxFollowersResult = parseOptionalInteger(
        request.body?.max_followers ?? request.query?.max_followers
      );
      if (!maxFollowersResult.isValid) {
        response.status(400).json({
          error: 'INVALID_FOLLOWER_BOUNDS',
          message: 'max_followers must be a whole number.',
          request_id: requestId,
        });
        return;
      }
      if (maxFollowersResult.value !== null && maxFollowersResult.value < 0) {
        response.status(400).json({
          error: 'INVALID_FOLLOWER_BOUNDS',
          message: 'max_followers must be a non-negative number.',
          request_id: requestId,
        });
        return;
      }

      if (
        minFollowersResult.value !== null &&
        maxFollowersResult.value !== null &&
        minFollowersResult.value > maxFollowersResult.value
      ) {
        response.status(400).json({
          error: 'INVALID_FOLLOWER_BOUNDS',
          message: 'min_followers cannot be greater than max_followers.',
          request_id: requestId,
        });
        return;
      }

      const minFollowers = minFollowersResult.value;
      const maxFollowers = maxFollowersResult.value;
      const rawPlatform = request.body?.platform ?? request.query?.platform;
      const platform =
        typeof rawPlatform === 'string' && rawPlatform.trim() ? rawPlatform.trim() : null;

      if (campaignId) {
        const campaignSnapshot = await db
          .collection('users')
          .doc(verifiedUid)
          .collection('campaigns')
          .doc(campaignId)
          .get();
        if (!campaignSnapshot.exists) {
          response.status(400).json({
            error: 'INVALID_CAMPAIGN_ID',
            message: 'Campaign does not exist for this user.',
            request_id: requestId,
          });
          return;
        }
      }
      console.log('[Pipeline] Starting influencer analysis pipeline', {
        request_id: requestId,
        uid: verifiedUid,
        top_n: topN,
        campaign_id: campaignId,
        min_followers: minFollowers,
        max_followers: maxFollowers,
        platform,
      });

      const jobMetadata: { uid?: string; campaignId?: string } = { uid: verifiedUid };
      if (campaignId) {
        jobMetadata.campaignId = campaignId;
      }

      // Create pipeline job in Firestore
      jobId = await createPipelineJob(businessDescription, topN, jobMetadata);
      const jobCreatedAtMs = Date.now();
      await updatePipelineJobStatus(jobId, 'running');
      await updatePipelineStage(jobId, 'query_expansion', 5);
      await updateQueryExpansionStage(jobId, 'running');

      let bindingSummary: {
        status: string;
        attempts?: number;
        campaign_binding_ms?: number;
        existingPipelineId?: string;
      } | null = null;
      if (campaignId) {
        const bindingResult = await bindPipelineToCampaignWithRetries({
          uid: verifiedUid,
          campaignId,
          pipelineId: jobId,
          startedAtMs: jobCreatedAtMs,
          requestId,
        });
        bindingSummary = bindingResult;

        if (bindingResult.status === 'missing_campaign') {
          await cancelPipelineJob(jobId);
          response.status(400).json({
            error: 'INVALID_CAMPAIGN_ID',
            message: 'Campaign was removed before the pipeline could be linked.',
            request_id: requestId,
          });
          return;
        }

        if (bindingResult.status === 'failed') {
          const lastChanceStatus = await performLastChanceCampaignBind({
            uid: verifiedUid,
            campaignId,
            pipelineId: jobId,
            requestId,
          });

          if (lastChanceStatus === 'updated') {
            bindingSummary = {
              status: 'last_chance_updated',
              attempts: bindingResult.attempts,
              campaign_binding_ms: bindingResult.campaign_binding_ms,
            };
          } else if (lastChanceStatus === 'missing_campaign') {
            await cancelPipelineJob(jobId);
            response.status(400).json({
              error: 'INVALID_CAMPAIGN_ID',
              message: 'Campaign no longer exists for this user.',
              request_id: requestId,
            });
            return;
          } else {
            bindingSummary = {
              ...bindingResult,
              status: 'failed_last_chance',
            };
          }
        }
      }

      console.log('[Pipeline] Pipeline job accepted', {
        request_id: requestId,
        uid: verifiedUid,
        job_id: jobId,
        campaign_id: campaignId,
        binding_status: bindingSummary?.status ?? (campaignId ? 'skipped' : 'not_requested'),
        binding_attempts: bindingSummary?.attempts ?? 0,
        campaign_binding_ms: bindingSummary?.campaign_binding_ms ?? 0,
        existing_pipeline_id: bindingSummary?.existingPipelineId,
      });
      
      // Return job_id immediately so frontend can start polling
      // The pipeline will continue processing in the background
      response.status(202).json({
        status: 'accepted',
        job_id: jobId,
        message: 'Pipeline job started',
        timestamp: new Date().toISOString(),
        request_id: requestId,
      });
      
      // Continue processing asynchronously (don't await - let it run in background)
      // Use setImmediate to ensure response is sent first
      setImmediate(async () => {
        if (!jobId) return; // Safety check
        
        try {
          // Step 1: Generate search queries
          console.log('[Pipeline] Step 1: Generating search queries...', {
            request_id: requestId,
            job_id: jobId,
          });
          let queries: string[] = [];
          try {
            // Check for cancellation
            if (await isJobCancelled(jobId)) {
              throw new Error('Pipeline job was cancelled');
            }
            
            queries = await generateSearchQueries(businessDescription);
            console.log(`[Pipeline] Generated ${queries.length} search queries: ${queries.slice(0, 3).join(', ')}...`);
            
            // Check for cancellation again
            if (await isJobCancelled(jobId)) {
              throw new Error('Pipeline job was cancelled');
            }
            
            await updateQueryExpansionStage(jobId, 'completed', queries);
            await completeStage(jobId, 'query_expansion');
          } catch (error) {
            if (error instanceof Error && error.message === 'Pipeline job was cancelled') {
              await updatePipelineJobStatus(jobId, 'cancelled');
              return; // Don't send response - already sent 202
            }
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            await updateQueryExpansionStage(jobId, 'error', undefined, errorMsg);
            throw error;
          }

          // Step 2: Perform multi-alpha searches
          await updatePipelineStage(jobId, 'weaviate_search', 25);
          await updateWeaviateSearchStage(jobId, 'running');
          
          console.log('[Pipeline] Step 2: Performing multi-alpha Weaviate searches...', {
            request_id: requestId,
            job_id: jobId,
          });
          const alphaValues = [0.2, 0.5, 0.8];
          const searchLimit = 500;
          const allSearchResults: any[] = [];
          let queriesExecuted = 0;
          let deduplicatedResults: any[] = [];

          try {
            for (const query of queries) {
              // Check for cancellation before each query
              if (await isJobCancelled(jobId)) {
                throw new Error('Pipeline job was cancelled');
              }
              
              for (const alpha of alphaValues) {
                console.log(`[Pipeline] Searching: "${query}" with alpha=${alpha} (limit=${searchLimit})${minFollowers !== null && minFollowers !== undefined ? `, min_followers=${minFollowers}` : ''}${maxFollowers !== null && maxFollowers !== undefined ? `, max_followers=${maxFollowers}` : ''}${platform ? `, platform=${platform}` : ''}`);
                try {
                  const searchResults = await performHybridSearch(query, alpha, searchLimit, minFollowers, maxFollowers, platform);
                  if (searchResults.results && Array.isArray(searchResults.results)) {
                    allSearchResults.push(...searchResults.results);
                  }
                  queriesExecuted++;
                } catch (error) {
                  console.error(`[Pipeline] Search failed for query "${query}" with alpha=${alpha}:`, error);
                }
              }
            }
            
            // Check for cancellation after searches
            if (await isJobCancelled(jobId)) {
              throw new Error('Pipeline job was cancelled');
            }

            console.log(`[Pipeline] Collected ${allSearchResults.length} total search results`);

            // Step 3: Deduplicate results
            console.log('[Pipeline] Step 3: Deduplicating results...', {
              request_id: requestId,
              job_id: jobId,
            });
            deduplicatedResults = deduplicateResults(allSearchResults);
            console.log(`[Pipeline] After deduplication: ${deduplicatedResults.length} unique profiles`);

            await updateWeaviateSearchStage(
              jobId,
              'completed',
              allSearchResults.length,
              deduplicatedResults.length,
              queriesExecuted
            );
            await completeStage(jobId, 'weaviate_search');
          } catch (error) {
            if (error instanceof Error && error.message === 'Pipeline job was cancelled') {
              await updatePipelineJobStatus(jobId, 'cancelled');
              return; // Don't send response - already sent 202
            }
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            await updateWeaviateSearchStage(jobId, 'error', undefined, undefined, queriesExecuted, errorMsg);
            throw error;
          }

          // Step 4: Extract top N profiles
          console.log(`[Pipeline] Step 4: Extracting top ${topN} profiles...`, {
            request_id: requestId,
            job_id: jobId,
          });
          const topProfileUrls = extractTopProfiles(deduplicatedResults, topN);
          console.log(`[Pipeline] Extracted ${topProfileUrls.length} profile URLs: ${topProfileUrls.join(', ')}`);

          if (topProfileUrls.length === 0) {
            await updatePipelineJobStatus(jobId, 'completed');
            await storePipelineResults(jobId, [], {
              queries_generated: queries.length,
              total_search_results: allSearchResults.length,
              deduplicated_results: deduplicatedResults.length,
              profiles_collected: 0,
              profiles_analyzed: 0,
            });
            // Don't send response - already sent 202, status updated in Firestore
            return;
          }

          // Step 5: Collect profiles from BrightData (STREAMING - process batches as they complete)
          await updatePipelineStage(jobId, 'brightdata_collection', 50);
          await updateBrightDataStage(jobId, 'running', topProfileUrls.length);
          await updatePipelineStage(jobId, 'llm_analysis', 60); // Start LLM stage early
          await updateLLMAnalysisStage(jobId, 'running');
          
          console.log(`[Pipeline] Step 5: Streaming collection of ${topProfileUrls.length} profiles from BrightData...`, {
            request_id: requestId,
            job_id: jobId,
          });
          const streamingConfig: StreamingBatchConfig = {
            batchSize: 20,
            maxConcurrentBatches: 10,
            pollingInterval: 10,
            maxWaitTime: 3600,
          };

          // Track all processed profiles
          const allAnalyzedProfiles: Array<BrightDataUnifiedProfile & { fit_score: number; fit_rationale: string }> = [];
          let batchesCompleted = 0;
          let batchesFailed = 0;
          
          // Calculate total batches beforehand (can't access streamingResult in callback)
          const batchSize = streamingConfig.batchSize || 20;
          const totalBatches = Math.ceil(topProfileUrls.length / batchSize);

          try {
            // Use streaming processor - processes batches as they become ready
            const streamingResult = await processBatchedCollectionStreaming(
              topProfileUrls,
              streamingConfig,
              async (batchResult) => {
                // This callback is called for each batch as it completes
                try {
                  // Check for cancellation before processing batch
                  if (jobId && await isJobCancelled(jobId)) {
                    throw new Error('Pipeline job was cancelled');
                  }
                  
                  console.log(`[Pipeline] Processing batch ${batchResult.batchIndex + 1} (${batchResult.platform}): ${batchResult.profiles.length} profiles`);
                  
                  // Normalize profiles
                  const normalizedProfiles = normalizeProfiles(batchResult.profiles);
                  console.log(`[Pipeline] Batch ${batchResult.batchIndex + 1}: Normalized ${normalizedProfiles.length} profiles`);
                  
                  // Check for cancellation before LLM analysis
                  if (jobId && await isJobCancelled(jobId)) {
                    throw new Error('Pipeline job was cancelled');
                  }
                  
                  // LLM analysis
                  const analyzedProfiles = await analyzeProfilesFit(businessDescription, normalizedProfiles, 5);
                  console.log(`[Pipeline] Batch ${batchResult.batchIndex + 1}: Analyzed ${analyzedProfiles.length} profiles`);
                  
                  // Sort by fit score
                  analyzedProfiles.sort((a, b) => b.fit_score - a.fit_score);
                  
                  // Store batch results incrementally in Firestore
                  if (jobId) {
                    await appendBatchResults(jobId, analyzedProfiles);
                  }
                  
                  // Track for final aggregation
                  allAnalyzedProfiles.push(...analyzedProfiles);
                  
                  batchesCompleted++;
                  if (jobId) {
                    const batchesProcessing = totalBatches - batchesCompleted - batchesFailed;
                    await updateBatchCounters(jobId, batchesCompleted, batchesProcessing, batchesFailed, totalBatches);
                  }
                  
                  console.log(`[Pipeline] Batch ${batchResult.batchIndex + 1} complete! Total batches: ${batchesCompleted}/${totalBatches}`);
                } catch (error) {
                  // Handle cancellation separately
                  if (error instanceof Error && error.message === 'Pipeline job was cancelled') {
                    console.log(`[Pipeline] Batch ${batchResult.batchIndex + 1} cancelled`);
                    throw error; // Re-throw to stop processing
                  }
                  console.error(`[Pipeline] Error processing batch ${batchResult.batchIndex + 1}:`, error);
                  batchesFailed++;
                  if (jobId) {
                    const batchesProcessing = totalBatches - batchesCompleted - batchesFailed;
                    await updateBatchCounters(jobId, batchesCompleted, batchesProcessing, batchesFailed, totalBatches);
                  }
                }
              }
            );
            
            // Check for cancellation after streaming completes
            if (jobId && await isJobCancelled(jobId)) {
              await updatePipelineJobStatus(jobId, 'cancelled');
              return; // Don't send response - already sent 202
            }
            
            console.log(`[Pipeline] Streaming collection complete: ${batchesCompleted} batches, ${batchesFailed} failed`);
            
            // Sort all profiles by fit score
            allAnalyzedProfiles.sort((a, b) => b.fit_score - a.fit_score);
            
            await updateBrightDataStage(jobId, 'completed', topProfileUrls.length, allAnalyzedProfiles.length);
            await completeStage(jobId, 'brightdata_collection');
            await updateLLMAnalysisStage(jobId, 'completed', allAnalyzedProfiles.length);
            await completeStage(jobId, 'llm_analysis');
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            await updateBrightDataStage(jobId, 'error', topProfileUrls.length, undefined, errorMsg);
            await updateLLMAnalysisStage(jobId, 'error', undefined, errorMsg);
            throw error;
          }

          // Store final aggregated results
          const pipelineStats = {
            queries_generated: queries.length,
            total_search_results: allSearchResults.length,
            deduplicated_results: deduplicatedResults.length,
            profiles_collected: allAnalyzedProfiles.length,
            profiles_analyzed: allAnalyzedProfiles.length,
          };
          
          await storePipelineResults(jobId, allAnalyzedProfiles, pipelineStats);
          await updatePipelineJobStatus(jobId, 'completed');
          await finalizePipelineProgress(jobId);
          
          // Pipeline completed - status is already updated in Firestore
          // Frontend will poll to get the final results
          console.log(`[Pipeline] Background processing completed successfully: ${jobId}`, {
            request_id: requestId,
            job_id: jobId,
          });
        } catch (backgroundError) {
          console.error('[Pipeline] Background processing error:', {
            request_id: requestId,
            job_id: jobId,
            error: backgroundError,
          });
          const errorMessage = backgroundError instanceof Error ? backgroundError.message : 'Unknown error';
          if (jobId) {
            try {
              await updatePipelineJobStatus(jobId, 'error', errorMessage);
            } catch (firestoreError) {
              console.error('[Pipeline] Failed to update Firestore with error:', firestoreError);
            }
          }
        }
      });
      
      // Early return - don't continue with the rest of the function
      return;
    } catch (error) {
      console.error('[Pipeline] Error before job creation:', {
        request_id: requestId,
        job_id: jobId,
        error,
      });
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Only send error response if we haven't already sent the 202 response
      // If jobId exists, we already sent 202, so error will be handled in background
      if (!jobId) {
        response.status(500).json({
          status: 'error',
          job_id: jobId || null,
          message: errorMessage,
          timestamp: new Date().toISOString(),
          request_id: requestId,
        });
      } else {
        // Job was created, error will be handled in background processing
        // Update Firestore with error status
        try {
          await updatePipelineJobStatus(jobId, 'error', errorMessage);
        } catch (firestoreError) {
          console.error('[Pipeline] Failed to update Firestore with error:', firestoreError);
        }
      }
    }
  }
);
