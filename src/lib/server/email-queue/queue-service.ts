/**
 * Email Queue Service
 *
 * Manages the email queue for deferred sending when daily limits are exceeded.
 * Emails are queued and automatically processed when the daily limit resets.
 */

import { randomUUID } from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import {
	firestore,
	emailQueueCollectionRef,
	emailQueueDocRef,
	contactsCollectionRef,
	type QueuedEmail,
	type EmailQueueStatus
} from '../core/firestore';
import { sendEmailViaGmail, type SendEmailOptions } from '../gmail/gmail-sender';
import { incrementDailyInboxUsage } from '../usage/daily-inbox-usage';
import { incrementOutreachUsage } from '../usage/outreach-usage';

/**
 * Default priority for queued emails (lower = higher priority)
 */
const DEFAULT_PRIORITY = 100;

/**
 * Default max retry attempts for failed emails
 */
const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Backoff delays for retries (in milliseconds)
 */
const RETRY_BACKOFF_MS = [60_000, 300_000, 900_000]; // 1min, 5min, 15min

export interface QueueEmailInput {
	to: string;
	subject: string;
	htmlBody: string;
	senderConnectionId: string;
	senderEmail: string;
	campaignId?: string | null;
	influencerId?: string | null;
	influencerName?: string | null;
	priority?: number;
}

/**
 * Add emails to the queue for later processing
 *
 * @param uid - User ID
 * @param emails - Array of emails to queue
 * @param scheduledFor - Timestamp when emails become eligible for sending (typically next midnight UTC)
 * @returns Array of created queue item IDs
 */
export async function addToEmailQueue(
	uid: string,
	emails: QueueEmailInput[],
	scheduledFor: number
): Promise<string[]> {
	if (emails.length === 0) return [];

	const now = Date.now();
	const queueIds: string[] = [];
	const queueRef = emailQueueCollectionRef(uid);

	// Use batch write for efficiency
	const batch = firestore.batch();

	for (const email of emails) {
		const queueId = randomUUID();
		const docRef = queueRef.doc(queueId);

		const queuedEmail: QueuedEmail = {
			id: queueId,
			campaignId: email.campaignId ?? null,
			influencerId: email.influencerId ?? null,
			influencerName: email.influencerName ?? null,
			to: email.to,
			subject: email.subject,
			htmlBody: email.htmlBody,
			senderConnectionId: email.senderConnectionId,
			senderEmail: email.senderEmail,
			status: 'queued',
			priority: email.priority ?? DEFAULT_PRIORITY,
			createdAt: now,
			scheduledFor,
			processedAt: null,
			sentAt: null,
			attempts: 0,
			maxAttempts: DEFAULT_MAX_ATTEMPTS,
			lastError: null,
			lastAttemptAt: null,
			updatedAt: now
		};

		batch.set(docRef, queuedEmail);
		queueIds.push(queueId);

		// Also update the campaign contact status to 'queued' if applicable
		if (email.campaignId && email.influencerId) {
			const contactRef = contactsCollectionRef(uid, email.campaignId).doc(email.influencerId);
			batch.set(
				contactRef,
				{
					sendStatus: 'pending', // Keep as pending since it's queued, not sent
					queuedAt: now,
					updatedAt: now
				},
				{ merge: true }
			);
		}
	}

	await batch.commit();
	return queueIds;
}

/**
 * Get user's email queue with optional filters
 */
export async function getUserEmailQueue(
	uid: string,
	filters?: {
		status?: EmailQueueStatus | EmailQueueStatus[];
		connectionId?: string;
		campaignId?: string;
		limit?: number;
	}
): Promise<QueuedEmail[]> {
	let query = emailQueueCollectionRef(uid).orderBy('createdAt', 'desc');

	if (filters?.status) {
		if (Array.isArray(filters.status)) {
			query = query.where('status', 'in', filters.status);
		} else {
			query = query.where('status', '==', filters.status);
		}
	}

	if (filters?.connectionId) {
		query = query.where('senderConnectionId', '==', filters.connectionId);
	}

	if (filters?.campaignId) {
		query = query.where('campaignId', '==', filters.campaignId);
	}

	if (filters?.limit) {
		query = query.limit(filters.limit);
	} else {
		query = query.limit(100); // Default limit
	}

	const snapshot = await query.get();
	return snapshot.docs.map((doc) => doc.data() as QueuedEmail);
}

/**
 * Get queued emails ready for processing (scheduledFor <= now)
 */
export async function getReadyQueuedEmails(
	uid: string,
	connectionId: string,
	limit: number
): Promise<QueuedEmail[]> {
	const now = Date.now();

	const snapshot = await emailQueueCollectionRef(uid)
		.where('senderConnectionId', '==', connectionId)
		.where('status', '==', 'queued')
		.where('scheduledFor', '<=', now)
		.orderBy('scheduledFor')
		.orderBy('priority')
		.limit(limit)
		.get();

	return snapshot.docs.map((doc) => doc.data() as QueuedEmail);
}

/**
 * Cancel a queued email
 */
export async function cancelQueuedEmail(uid: string, queueId: string): Promise<void> {
	const queueRef = emailQueueDocRef(uid, queueId);
	const doc = await queueRef.get();

	if (!doc.exists) {
		throw new Error('Queue item not found');
	}

	const data = doc.data() as QueuedEmail;
	if (data.status !== 'queued') {
		throw new Error(`Cannot cancel email with status: ${data.status}`);
	}

	await queueRef.update({
		status: 'cancelled' as EmailQueueStatus,
		updatedAt: Date.now()
	});
}

/**
 * Cancel all queued emails for a given Gmail connection.
 *
 * Used when a user disconnects a Gmail account to prevent retaining or sending queued content
 * for that inbox.
 */
export async function cancelQueuedEmailsForConnection(
	uid: string,
	connectionId: string,
	options?: { scrubContent?: boolean; reason?: string }
): Promise<number> {
	let cancelled = 0;
	const reason = options?.reason || 'Cancelled due to Gmail disconnect';
	const scrubContent = options?.scrubContent === true;

	// Cancel only items that are still queued; if something is already processing/sent, leave it as-is.
	while (true) {
		const snapshot = await emailQueueCollectionRef(uid)
			.where('senderConnectionId', '==', connectionId)
			.where('status', '==', 'queued')
			.orderBy('createdAt', 'asc')
			.limit(500)
			.get();

		if (snapshot.empty) break;

		const batch = firestore.batch();
		const now = Date.now();
		for (const doc of snapshot.docs) {
			cancelled++;
			const update: Record<string, unknown> = {
				status: 'cancelled' as EmailQueueStatus,
				updatedAt: now,
				lastError: reason,
				lastAttemptAt: now
			};

			if (scrubContent) {
				update.to = '';
				update.subject = '';
				update.htmlBody = '';
				update.senderEmail = '';
				update.contentScrubbed = true;
			}

			batch.update(doc.ref, update);
		}
		await batch.commit();

		if (snapshot.size < 500) break;
	}

	return cancelled;
}

/**
 * Process a single queued email - attempt to send it
 *
 * Uses a transaction to atomically claim the email (prevent race conditions
 * where multiple processes try to send the same email).
 *
 * @returns Object with success status and optional error
 */
export async function processQueuedEmail(
	uid: string,
	queueId: string
): Promise<{ success: boolean; error?: string }> {
	const queueRef = emailQueueDocRef(uid, queueId);
	const now = Date.now();

	// Use a transaction to atomically claim the email
	// This prevents race conditions where two processes pick up the same email
	let email: QueuedEmail;
	let currentAttempts: number;

	try {
		const claimResult = await firestore.runTransaction(async (tx) => {
			const doc = await tx.get(queueRef);

			if (!doc.exists) {
				return { claimed: false, reason: 'Queue item not found' };
			}

			const data = doc.data() as QueuedEmail;

			// Check if already claimed by another process
			if (data.status !== 'queued') {
				return { claimed: false, reason: `Invalid status for processing: ${data.status}` };
			}

			// Atomically claim the email by updating status to 'processing'
			const newAttempts = data.attempts + 1;
			tx.update(queueRef, {
				status: 'processing' as EmailQueueStatus,
				processedAt: now,
				attempts: newAttempts,
				lastAttemptAt: now,
				updatedAt: now
			});

			return { claimed: true, email: data, attempts: newAttempts };
		});

		if (!claimResult.claimed) {
			return { success: false, error: claimResult.reason };
		}

		email = claimResult.email!;
		currentAttempts = claimResult.attempts!;
	} catch (txError) {
		// Transaction failed (likely due to contention)
		const errorMsg = txError instanceof Error ? txError.message : 'Transaction failed';
		return { success: false, error: `Failed to claim email: ${errorMsg}` };
	}

	try {
		// Attempt to send via Gmail
		const sendOptions: SendEmailOptions = {
			to: email.to,
			subject: email.subject,
			htmlBody: email.htmlBody
		};

		await sendEmailViaGmail(uid, sendOptions, email.senderConnectionId);

		// Success! Update queue item and contact status
		await firestore.runTransaction(async (tx) => {
			// Update queue item
			tx.update(queueRef, {
				status: 'sent' as EmailQueueStatus,
				sentAt: Date.now(),
				updatedAt: Date.now()
			});

			// Update campaign contact if applicable
			if (email.campaignId && email.influencerId) {
				const contactRef = contactsCollectionRef(uid, email.campaignId).doc(email.influencerId);
				tx.set(
					contactRef,
					{
						sendStatus: 'sent',
						sentAt: Date.now(),
						updatedAt: Date.now()
					},
					{ merge: true }
				);
			}
		});

		// Increment usage counters (outside transaction for simplicity)
		// Note: Daily inbox usage is already counted when emails are queued via checkAndReserveDailyCapacity
		// Only increment monthly outreach usage here
		await incrementOutreachUsage(uid, 1);

		return { success: true };
	} catch (error) {
		// Handle failure
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		const shouldRetry = currentAttempts < email.maxAttempts && isRetryableError(error);

		if (shouldRetry) {
			// Schedule for retry with backoff
			const backoffDelay = getBackoffDelay(currentAttempts);
			await queueRef.update({
				status: 'queued' as EmailQueueStatus,
				lastError: errorMessage,
				scheduledFor: now + backoffDelay,
				updatedAt: now
			});
		} else {
			// Mark as failed permanently
			await queueRef.update({
				status: 'failed' as EmailQueueStatus,
				lastError: errorMessage,
				updatedAt: now
			});

			// Update campaign contact if applicable
			if (email.campaignId && email.influencerId) {
				await contactsCollectionRef(uid, email.campaignId)
					.doc(email.influencerId)
					.set(
						{
							sendStatus: 'failed',
							failedAt: now,
							errorMessage,
							updatedAt: now
						},
						{ merge: true }
					);
			}
		}

		return { success: false, error: errorMessage };
	}
}

/**
 * Check if an error is retryable
 */
function isRetryableError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;

	const message = error.message.toLowerCase();

	// Auth errors are NOT retryable (check these first)
	if (
		message.includes('access denied') ||
		message.includes('401') ||
		message.includes('403') ||
		message.includes('reconnect') ||
		message.includes('permission')
	) {
		return false;
	}

	// Invalid email/request errors are NOT retryable
	if (message.includes('invalid') || message.includes('400')) {
		return false;
	}

	// Rate limit errors ARE retryable
	if (message.includes('rate limit') || message.includes('429') || message.includes('too many')) {
		return true;
	}

	// Server errors (5xx) ARE retryable - use regex to match status codes 500-599
	if (/\b5\d{2}\b/.test(message) || message.includes('server error') || message.includes('internal error')) {
		return true;
	}

	// Network/timeout errors ARE retryable
	if (
		message.includes('timeout') ||
		message.includes('timed out') ||
		message.includes('econnreset') ||
		message.includes('econnrefused') ||
		message.includes('network') ||
		message.includes('socket')
	) {
		return true;
	}

	// Default to not retrying for unknown errors
	return false;
}

/**
 * Get backoff delay for retry attempt
 */
function getBackoffDelay(attempt: number): number {
	const index = Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1);
	return RETRY_BACKOFF_MS[index];
}

/**
 * Get queue statistics for a user
 */
export async function getQueueStats(uid: string): Promise<{
	queued: number;
	processing: number;
	sent: number;
	failed: number;
	cancelled: number;
	total: number;
}> {
	const queueRef = emailQueueCollectionRef(uid);

	const [queuedSnap, processingSnap, sentSnap, failedSnap, cancelledSnap] = await Promise.all([
		queueRef.where('status', '==', 'queued').count().get(),
		queueRef.where('status', '==', 'processing').count().get(),
		queueRef.where('status', '==', 'sent').count().get(),
		queueRef.where('status', '==', 'failed').count().get(),
		queueRef.where('status', '==', 'cancelled').count().get()
	]);

	const queued = queuedSnap.data().count;
	const processing = processingSnap.data().count;
	const sent = sentSnap.data().count;
	const failed = failedSnap.data().count;
	const cancelled = cancelledSnap.data().count;

	return {
		queued,
		processing,
		sent,
		failed,
		cancelled,
		total: queued + processing + sent + failed + cancelled
	};
}

/**
 * Retry a failed email (reset status to queued)
 */
export async function retryFailedEmail(uid: string, queueId: string): Promise<void> {
	const queueRef = emailQueueDocRef(uid, queueId);
	const doc = await queueRef.get();

	if (!doc.exists) {
		throw new Error('Queue item not found');
	}

	const data = doc.data() as QueuedEmail;
	if (data.status !== 'failed') {
		throw new Error(`Cannot retry email with status: ${data.status}`);
	}

	const now = Date.now();
	await queueRef.update({
		status: 'queued' as EmailQueueStatus,
		attempts: 0,
		maxAttempts: DEFAULT_MAX_ATTEMPTS,
		lastError: null,
		scheduledFor: now, // Ready to send immediately
		updatedAt: now
	});
}

/**
 * Delete old processed emails (cleanup)
 * Removes sent/failed/cancelled emails older than specified days
 */
export async function cleanupOldQueueItems(uid: string, olderThanDays: number = 30): Promise<number> {
	const cutoffTime = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
	const queueRef = emailQueueCollectionRef(uid);

	const snapshot = await queueRef
		.where('status', 'in', ['sent', 'failed', 'cancelled'])
		.where('updatedAt', '<', cutoffTime)
		.limit(500) // Batch delete limit
		.get();

	if (snapshot.empty) {
		return 0;
	}

	const batch = firestore.batch();
	snapshot.docs.forEach((doc) => {
		batch.delete(doc.ref);
	});

	await batch.commit();
	return snapshot.size;
}
