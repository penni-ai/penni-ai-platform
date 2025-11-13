/**
 * HTTP Cloud Function to cancel a running pipeline job
 * 
 * POST /cancelPipelineJob
 * Body: {
 *   "job_id": "job_1234567890_abc123"
 * }
 * 
 * Returns:
 * - 200: Job cancelled successfully
 * - 404: Job not found
 * - 400: Invalid request
 */

import { onRequest } from 'firebase-functions/v2/https';
import { cancelPipelineJob, getPipelineJob } from '../utils/firestore-tracker.js';

export const cancelPipelineJobFunction = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 30,
    memory: '256MiB',
    invoker: 'private',
  },
  async (request, response) => {
    try {
      const jobId = request.body?.job_id || request.query?.job_id;

      if (!jobId) {
        response.status(400).json({
          status: 'error',
          message: 'job_id is required',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Check if job exists
      const job = await getPipelineJob(jobId);
      if (!job) {
        response.status(404).json({
          status: 'error',
          message: `Pipeline job ${jobId} not found`,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Check if job is already completed or cancelled
      if (job.status === 'completed' || job.status === 'cancelled' || job.status === 'error') {
        response.status(200).json({
          status: 'success',
          message: `Job is already ${job.status}`,
          job_id: jobId,
          current_status: job.status,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Cancel the job
      await cancelPipelineJob(jobId);

      response.status(200).json({
        status: 'success',
        message: 'Pipeline job cancelled successfully',
        job_id: jobId,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('[Cancel Job] Error:', error);
      response.status(500).json({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

