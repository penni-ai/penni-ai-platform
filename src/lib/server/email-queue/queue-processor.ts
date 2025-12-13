/**
 * Email Queue Processor
 *
 * Background processing logic for sending queued emails.
 * This module is designed to be called by a Cloud Scheduler or cron job.
 */

import { firestore, emailQueueCollectionRef, gmailConnectionsCollectionRef } from '../core/firestore';
import { getDailyInboxUsage, DAILY_INBOX_LIMIT } from '../usage/daily-inbox-usage';
import { getReadyQueuedEmails, processQueuedEmail } from './queue-service';

/**
 * Rate limit between processing emails (ms)
 */
const PROCESSING_DELAY_MS = 200;

/**
 * Max emails to process per inbox per run
 */
const MAX_EMAILS_PER_INBOX_PER_RUN = 50;

export interface ProcessingResult {
	userId: string;
	connectionId: string;
	processed: number;
	succeeded: number;
	failed: number;
	errors: string[];
}

export interface BatchProcessingResult {
	totalProcessed: number;
	totalSucceeded: number;
	totalFailed: number;
	results: ProcessingResult[];
	duration: number;
}

/**
 * Process queued emails for a single user's Gmail connection
 */
export async function processUserInboxQueue(
	uid: string,
	connectionId: string
): Promise<ProcessingResult> {
	const result: ProcessingResult = {
		userId: uid,
		connectionId,
		processed: 0,
		succeeded: 0,
		failed: 0,
		errors: []
	};

	try {
		// Check daily usage for this inbox
		const usage = await getDailyInboxUsage(uid, connectionId);
		const availableCapacity = usage.remaining;

		if (availableCapacity <= 0) {
			// No capacity available, skip this inbox
			return result;
		}

		// Get queued emails ready for processing
		const limit = Math.min(availableCapacity, MAX_EMAILS_PER_INBOX_PER_RUN);
		const queuedEmails = await getReadyQueuedEmails(uid, connectionId, limit);

		if (queuedEmails.length === 0) {
			return result;
		}

		// Process each email sequentially with rate limiting
		for (const email of queuedEmails) {
			try {
				const sendResult = await processQueuedEmail(uid, email.id);
				result.processed++;

				if (sendResult.success) {
					result.succeeded++;
				} else {
					result.failed++;
					if (sendResult.error) {
						result.errors.push(`${email.to}: ${sendResult.error}`);
					}
				}

				// Rate limit between emails
				if (result.processed < queuedEmails.length) {
					await delay(PROCESSING_DELAY_MS);
				}
			} catch (error) {
				result.processed++;
				result.failed++;
				const errorMsg = error instanceof Error ? error.message : 'Unknown error';
				result.errors.push(`${email.to}: ${errorMsg}`);
			}
		}
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : 'Unknown error';
		result.errors.push(`Processing error: ${errorMsg}`);
	}

	return result;
}

/**
 * Process all queued emails for a user (all their Gmail connections)
 */
export async function processUserQueue(uid: string): Promise<ProcessingResult[]> {
	const results: ProcessingResult[] = [];

	// Get all Gmail connections for this user
	const connectionsSnap = await gmailConnectionsCollectionRef(uid).get();

	if (connectionsSnap.empty) {
		return results;
	}

	// Process each connection
	for (const doc of connectionsSnap.docs) {
		const connectionId = doc.id;
		const result = await processUserInboxQueue(uid, connectionId);
		results.push(result);
	}

	return results;
}

/**
 * Find all users with queued emails ready for processing
 */
export async function findUsersWithQueuedEmails(): Promise<string[]> {
	const now = Date.now();
	const userIds = new Set<string>();

	// Query across all users' emailQueue collections
	// Note: This requires a collection group query
	const snapshot = await firestore
		.collectionGroup('emailQueue')
		.where('status', '==', 'queued')
		.where('scheduledFor', '<=', now)
		.limit(1000) // Safety limit
		.get();

	// Extract unique user IDs from document paths
	// Path format: users/{uid}/emailQueue/{queueId}
	for (const doc of snapshot.docs) {
		const pathParts = doc.ref.path.split('/');
		if (pathParts.length >= 2 && pathParts[0] === 'users') {
			userIds.add(pathParts[1]);
		}
	}

	return Array.from(userIds);
}

/**
 * Main entry point for batch processing all queued emails
 * Called by Cloud Scheduler or cron job
 */
export async function processBatchQueue(): Promise<BatchProcessingResult> {
	const startTime = Date.now();
	const allResults: ProcessingResult[] = [];
	let totalProcessed = 0;
	let totalSucceeded = 0;
	let totalFailed = 0;

	try {
		// Find all users with queued emails
		const userIds = await findUsersWithQueuedEmails();

		console.log(`[EmailQueue] Found ${userIds.length} users with queued emails`);

		// Process each user's queue
		for (const uid of userIds) {
			try {
				const userResults = await processUserQueue(uid);
				allResults.push(...userResults);

				// Aggregate totals
				for (const result of userResults) {
					totalProcessed += result.processed;
					totalSucceeded += result.succeeded;
					totalFailed += result.failed;
				}
			} catch (error) {
				console.error(`[EmailQueue] Error processing user ${uid}:`, error);
			}
		}
	} catch (error) {
		console.error('[EmailQueue] Batch processing error:', error);
	}

	const duration = Date.now() - startTime;

	console.log(
		`[EmailQueue] Batch complete: ${totalProcessed} processed, ${totalSucceeded} succeeded, ${totalFailed} failed in ${duration}ms`
	);

	return {
		totalProcessed,
		totalSucceeded,
		totalFailed,
		results: allResults,
		duration
	};
}

/**
 * Get pending queue count across all users (for monitoring)
 */
export async function getPendingQueueCount(): Promise<number> {
	const now = Date.now();

	const snapshot = await firestore
		.collectionGroup('emailQueue')
		.where('status', '==', 'queued')
		.where('scheduledFor', '<=', now)
		.count()
		.get();

	return snapshot.data().count;
}

/**
 * Get total queue count across all users by status
 */
export async function getGlobalQueueStats(): Promise<{
	queued: number;
	processing: number;
	readyToProcess: number;
}> {
	const now = Date.now();

	const [queuedSnap, processingSnap, readySnap] = await Promise.all([
		firestore.collectionGroup('emailQueue').where('status', '==', 'queued').count().get(),
		firestore.collectionGroup('emailQueue').where('status', '==', 'processing').count().get(),
		firestore
			.collectionGroup('emailQueue')
			.where('status', '==', 'queued')
			.where('scheduledFor', '<=', now)
			.count()
			.get()
	]);

	return {
		queued: queuedSnap.data().count,
		processing: processingSnap.data().count,
		readyToProcess: readySnap.data().count
	};
}

/**
 * Helper to add delay between operations
 */
function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
