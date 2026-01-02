/**
 * HTTP orchestrator handler for POST /pipeline/start
 * Validates request, creates Firestore job, enqueues Cloud Tasks, returns 202 Accepted
 */

import { z } from 'zod';
import { createPipelineJob } from '../utils/firestore-tracker.js';
import { getFirestoreInstance } from '../utils/firebase-admin.js';
import { enqueueTask } from '../utils/cloud-tasks.js';
import { createLogger } from '../utils/logger.js';

const db = getFirestoreInstance();

// Request validation schema
const pipelineStartSchema = z.object({
  business_description: z.string().min(1, 'business_description is required and must be non-empty'),
  top_n: z.number().int().min(10).max(1000).optional().default(30),
  min_followers: z.number().int().min(0).optional(),
  max_followers: z.number().int().min(0).optional(),
  platform: z.enum(['instagram', 'tiktok']).optional(),
  campaign_id: z.string().optional(),
  uid: z.string().min(10).max(128, 'uid must be between 10 and 128 characters'),
  request_id: z.string().uuid().optional(),
  // Profile URLs to exclude from search results (for "find more influencers" functionality)
  exclude_profile_urls: z.array(z.string()).optional(),
  // Enable strict location matching - requires exact location match, penalizes unknown/different locations heavily
  strict_location_matching: z.boolean().optional().default(false),
});

type PipelineStartRequest = z.infer<typeof pipelineStartSchema>;

/**
 * Get GCP project ID from environment
 */
function getProjectId(): string {
  return process.env.GOOGLE_CLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'penni-ai-platform';
}

/**
 * Handle HTTP POST /pipeline/start request
 */
export async function handlePipelineStart(req: any, res: any): Promise<void> {
  const requestId = req.body?.request_id || `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const logger = req.logger?.child({ component: 'orchestrator', request_id: requestId }) ?? createLogger({ component: 'orchestrator', request_id: requestId });
  
  try {
    // Validate request body
    const validationResult = pipelineStartSchema.safeParse(req.body);
    
    if (!validationResult.success) {
      const errors = validationResult.error.issues.map((e: any) => `${e.path.join('.')}: ${e.message}`);
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: errors,
        request_id: requestId,
      });
      return;
    }

    const data = validationResult.data;

    // Validate campaign exists if provided
    // In emulator mode, skip strict validation (campaigns may not exist yet)
    const isEmulator = Boolean(
      process.env.FIRESTORE_EMULATOR_HOST ||
      process.env.FIREBASE_STORAGE_EMULATOR_HOST ||
      process.env.FIREBASE_AUTH_EMULATOR_HOST
    );
    
    if (data.campaign_id && !isEmulator) {
      // Only validate in production - in emulator, allow campaigns to be created on-the-fly
      const campaignPath = `users/${data.uid}/campaigns/${data.campaign_id}`;
      logger.debug('campaign_check_start', {
        uid: data.uid,
        campaign_id: data.campaign_id,
      });
      
      const campaignSnapshot = await db
        .collection('users')
        .doc(data.uid)
        .collection('campaigns')
        .doc(data.campaign_id)
        .get();
      
      if (!campaignSnapshot.exists) {
        logger.warn('campaign_not_found', {
          uid: data.uid,
          campaign_id: data.campaign_id,
        });
        
        res.status(400).json({
          error: 'INVALID_CAMPAIGN_ID',
          message: `Campaign does not exist for this user. Path: ${campaignPath}`,
          details: {
            uid: data.uid,
            campaign_id: data.campaign_id,
            path: campaignPath,
          },
          request_id: requestId,
        });
        return;
      }
      
      logger.debug('campaign_found', {
        uid: data.uid,
        campaign_id: data.campaign_id,
      });
    } else if (data.campaign_id && isEmulator) {
      // In emulator mode, log but don't fail - campaigns may be created dynamically
      const campaignPath = `users/${data.uid}/campaigns/${data.campaign_id}`;
      logger.debug('campaign_validation_skipped_emulator', {
        uid: data.uid,
        campaign_id: data.campaign_id,
      });
    }

    // Validate follower bounds
    if (data.min_followers !== undefined && data.max_followers !== undefined) {
      if (data.min_followers > data.max_followers) {
        res.status(400).json({
          error: 'INVALID_FOLLOWER_BOUNDS',
          message: 'min_followers cannot be greater than max_followers.',
          request_id: requestId,
        });
        return;
      }
    }

    // Derive weaviate_top_n and llm_top_n from top_n
    const topN = data.top_n;
    const weaviateTopN = Math.max(topN * 4, 500); // 4x top_n for Weaviate candidates, minimum 500
    const llmTopN = topN; // Same as top_n for final LLM results

    logger.info('pipeline_start_request', {
      request_id: requestId,
      uid: data.uid,
      campaign_id: data.campaign_id || null,
      business_description: data.business_description.substring(0, 100) + (data.business_description.length > 100 ? '...' : ''),
      top_n: topN,
      weaviate_top_n: weaviateTopN,
      llm_top_n: llmTopN,
      min_followers: data.min_followers || null,
      max_followers: data.max_followers || null,
      platform: data.platform || null,
      projectId: getProjectId(),
    });

    // Create Firestore pipeline job
    const jobId = await createPipelineJob(
      data.business_description,
      llmTopN, // Final result count
      {
        uid: data.uid,
        campaignId: data.campaign_id,
        weaviateTopN: weaviateTopN,
      }
    );

    logger.info('pipeline_job_created', {
      request_id: requestId,
      uid: data.uid,
      campaign_id: data.campaign_id || null,
      job_id: jobId,
    });

    const messageData = {
      job_id: jobId,
      uid: data.uid,
      campaign_id: data.campaign_id,
      business_description: data.business_description,
      top_n: topN,
      weaviate_top_n: weaviateTopN,
      llm_top_n: llmTopN,
      min_followers: data.min_followers,
      max_followers: data.max_followers,
      platform: data.platform,
      request_id: requestId,
      exclude_profile_urls: data.exclude_profile_urls, // Pass through for "find more" functionality
      strict_location_matching: data.strict_location_matching, // Pass through for strict location matching
    };

    logger.info('tasks_mode_enqueue', { job_id: jobId, emulator: isEmulator });
    await enqueueTask({
      kind: 'stage',
      path: '/tasks/pipeline-stage',
      payload: messageData,
    });

    // Return 202 Accepted immediately
    res.status(202).json({
      job_id: jobId,
      status: 'accepted',
      message: 'Pipeline job accepted and processing in background',
      request_id: requestId,
    });
  } catch (error) {
    logger.error('pipeline_start_failed', {
      request_id: requestId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Failed to start pipeline job',
      request_id: requestId,
    });
  }
}
