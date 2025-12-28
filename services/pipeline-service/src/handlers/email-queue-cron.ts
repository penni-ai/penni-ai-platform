/**
 * Email Queue Cron Handler
 *
 * Processes queued emails when triggered by Cloud Scheduler.
 * This handler runs every 15 minutes to send emails that were
 * queued due to daily inbox limits.
 */

import { getFirestoreInstance } from '../utils/firebase-admin.js';
import { google } from 'googleapis';
import * as crypto from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';

// Constants
const DAILY_INBOX_LIMIT = 50;
const PROCESSING_DELAY_MS = 200;
const MAX_EMAILS_PER_INBOX_PER_RUN = 50;
// Support both env var names for backwards compatibility
const GMAIL_ENCRYPTION_KEY = process.env.GMAIL_TOKEN_ENCRYPTION_KEY || process.env.GMAIL_ENCRYPTION_KEY || '';

// Types
interface QueuedEmail {
	id: string;
	campaignId: string | null;
	influencerId: string | null;
	influencerName: string | null;
	to: string;
	subject: string;
	htmlBody: string;
	senderConnectionId: string;
	senderEmail: string;
	status: 'queued' | 'processing' | 'sent' | 'failed' | 'cancelled';
	priority: number;
	createdAt: number;
	scheduledFor: number;
	processedAt: number | null;
	sentAt: number | null;
	attempts: number;
	maxAttempts: number;
	lastError: string | null;
	lastAttemptAt: number | null;
	updatedAt: number;
}

interface GmailConnection {
	id: string;
	email: string;
	access_token: string;
	refresh_token_encrypted?: string;
	refresh_token_iv?: string;
	refresh_token_tag?: string;
	expires_at: number;
	connected_at: number;
	primary: boolean;
}

interface ProcessingResult {
	userId: string;
	connectionId: string;
	processed: number;
	succeeded: number;
	failed: number;
	errors: string[];
}

interface BatchProcessingResult {
	totalProcessed: number;
	totalSucceeded: number;
	totalFailed: number;
	results: ProcessingResult[];
	duration: number;
}

// Utility functions
function getCurrentDateKey(): string {
	const now = new Date();
	return now.toISOString().split('T')[0];
}

function getNextMidnightUTC(): number {
	const now = new Date();
	const tomorrow = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0)
	);
	return tomorrow.getTime();
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Decrypt refresh token using AES-256-GCM
 * Note: Tokens are stored in base64 format by the main app (gmail-auth.ts)
 */
function decryptRefreshToken(encrypted: string, iv: string, tag: string): string {
	if (!GMAIL_ENCRYPTION_KEY) {
		throw new Error('GMAIL_ENCRYPTION_KEY not configured');
	}

	// The encryption key should be base64-encoded (matching gmail-auth.ts)
	const encryptionKey = Buffer.from(GMAIL_ENCRYPTION_KEY, 'base64');
	if (encryptionKey.length !== 32) {
		throw new Error('GMAIL_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
	}

	const decipher = crypto.createDecipheriv(
		'aes-256-gcm',
		encryptionKey,
		Buffer.from(iv, 'base64')
	);
	decipher.setAuthTag(Buffer.from(tag, 'base64'));

	let decrypted = decipher.update(Buffer.from(encrypted, 'base64'));
	decrypted = Buffer.concat([decrypted, decipher.final()]);

	return decrypted.toString('utf8');
}

/**
 * Get daily usage for a Gmail inbox
 */
async function getDailyInboxUsage(
	db: FirebaseFirestore.Firestore,
	uid: string,
	connectionId: string
): Promise<{ sendCount: number; remaining: number }> {
	const dateKey = getCurrentDateKey();
	const usageRef = db
		.collection('users')
		.doc(uid)
		.collection('gmailConnections')
		.doc(connectionId)
		.collection('dailyUsage')
		.doc(dateKey);

	const usageDoc = await usageRef.get();

	if (!usageDoc.exists) {
		return { sendCount: 0, remaining: DAILY_INBOX_LIMIT };
	}

	const data = usageDoc.data();
	const sendCount = data?.sendCount || 0;

	return {
		sendCount,
		remaining: Math.max(0, DAILY_INBOX_LIMIT - sendCount)
	};
}

/**
 * Increment daily inbox usage
 */
async function incrementDailyUsage(
	db: FirebaseFirestore.Firestore,
	uid: string,
	connectionId: string,
	amount: number
): Promise<void> {
	const dateKey = getCurrentDateKey();
	const usageRef = db
		.collection('users')
		.doc(uid)
		.collection('gmailConnections')
		.doc(connectionId)
		.collection('dailyUsage')
		.doc(dateKey);

	const now = Date.now();

	await usageRef.set(
		{
			date: dateKey,
			sendCount: FieldValue.increment(amount),
			lastSentAt: now,
			resetAt: getNextMidnightUTC(),
			updatedAt: now
		},
		{ merge: true }
	);
}

/**
 * Increment monthly outreach usage
 */
async function incrementMonthlyUsage(
	db: FirebaseFirestore.Firestore,
	uid: string,
	amount: number
): Promise<void> {
	const now = new Date();
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, '0');
	const currentMonth = `${year}-${month}`;

	const userRef = db.collection('users').doc(uid);

	await db.runTransaction(async (tx) => {
		const userDoc = await tx.get(userRef);
		const userData = userDoc.data();
		let usage = userData?.usage;

		if (!usage) {
			usage = {
				outreachSent: { month: currentMonth, count: 0, updatedAt: Date.now() },
				influencersFound: { month: currentMonth, count: 0, updatedAt: Date.now() }
			};
		}

		if (usage.outreachSent.month !== currentMonth) {
			usage.outreachSent = { month: currentMonth, count: amount, updatedAt: Date.now() };
		} else {
			usage.outreachSent.count = (usage.outreachSent.count || 0) + amount;
			usage.outreachSent.updatedAt = Date.now();
		}

		tx.update(userRef, { usage, updatedAt: Date.now() });
	});
}

/**
 * Get Gmail connection with decrypted refresh token
 */
async function getGmailConnection(
	db: FirebaseFirestore.Firestore,
	uid: string,
	connectionId: string
): Promise<GmailConnection & { refresh_token: string }> {
	const connRef = db
		.collection('users')
		.doc(uid)
		.collection('gmailConnections')
		.doc(connectionId);

	const connDoc = await connRef.get();

	if (!connDoc.exists) {
		throw new Error(`Gmail connection ${connectionId} not found`);
	}

	const conn = connDoc.data() as GmailConnection;

	// Decrypt refresh token
	if (!conn.refresh_token_encrypted || !conn.refresh_token_iv || !conn.refresh_token_tag) {
		throw new Error('Gmail connection missing encrypted refresh token');
	}

	const refresh_token = decryptRefreshToken(
		conn.refresh_token_encrypted,
		conn.refresh_token_iv,
		conn.refresh_token_tag
	);

	return {
		...conn,
		id: connDoc.id,
		refresh_token
	};
}

/**
 * Refresh Gmail access token if needed
 */
async function refreshAccessTokenIfNeeded(
	db: FirebaseFirestore.Firestore,
	uid: string,
	connection: GmailConnection & { refresh_token: string }
): Promise<string> {
	const now = Date.now();
	const buffer = 5 * 60 * 1000; // 5 minutes

	if (now < connection.expires_at - buffer) {
		return connection.access_token;
	}

	// Refresh the token
	const oauth2Client = new google.auth.OAuth2(
		process.env.GOOGLE_CLIENT_ID,
		process.env.GOOGLE_CLIENT_SECRET
	);

	oauth2Client.setCredentials({
		refresh_token: connection.refresh_token
	});

	const { credentials } = await oauth2Client.refreshAccessToken();

	if (!credentials.access_token) {
		throw new Error('Failed to refresh access token');
	}

	// Update in Firestore
	const connRef = db
		.collection('users')
		.doc(uid)
		.collection('gmailConnections')
		.doc(connection.id);

	await connRef.update({
		access_token: credentials.access_token,
		expires_at: credentials.expiry_date || now + 3600 * 1000,
		last_refreshed_at: now
	});

	return credentials.access_token;
}

/**
 * Send email via Gmail API
 */
async function sendEmailViaGmail(
	accessToken: string,
	email: { to: string; subject: string; htmlBody: string; from: string }
): Promise<void> {
	const oauth2Client = new google.auth.OAuth2();
	oauth2Client.setCredentials({ access_token: accessToken });

	const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

	// Create MIME message
	const message = [
		`To: ${email.to}`,
		`From: ${email.from}`,
		`Subject: ${email.subject}`,
		'Content-Type: text/html; charset=utf-8',
		'',
		email.htmlBody
	].join('\n');

	// Encode in base64url
	const encodedMessage = Buffer.from(message)
		.toString('base64')
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');

	await gmail.users.messages.send({
		userId: 'me',
		requestBody: { raw: encodedMessage }
	});
}

/**
 * Process a single queued email
 *
 * Uses a transaction to atomically claim the email (prevent race conditions
 * where multiple processes try to send the same email).
 */
async function processQueuedEmail(
	db: FirebaseFirestore.Firestore,
	uid: string,
	queueDoc: FirebaseFirestore.QueryDocumentSnapshot
): Promise<{ success: boolean; error?: string }> {
	const queueRef = queueDoc.ref;
	const now = Date.now();

	// Use a transaction to atomically claim the email
	// This prevents race conditions where two processes pick up the same email
	let email: QueuedEmail;
	let currentAttempts: number;

	try {
		const claimResult = await db.runTransaction(async (tx) => {
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
				status: 'processing',
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
		// Get Gmail connection
		const connection = await getGmailConnection(db, uid, email.senderConnectionId);

		// Refresh access token if needed
		const accessToken = await refreshAccessTokenIfNeeded(db, uid, connection);

		// Send email
		await sendEmailViaGmail(accessToken, {
			to: email.to,
			subject: email.subject,
			htmlBody: email.htmlBody,
			from: connection.email
		});

		// Success - update queue item and contact status
		await db.runTransaction(async (tx) => {
			tx.update(queueRef, {
				status: 'sent',
				sentAt: Date.now(),
				updatedAt: Date.now()
			});

			// Update campaign contact if applicable
			if (email.campaignId && email.influencerId) {
				const contactRef = db
					.collection('users')
					.doc(uid)
					.collection('campaigns')
					.doc(email.campaignId)
					.collection('contacts')
					.doc(email.influencerId);

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
		// Note: Daily inbox usage is already counted when emails are queued
		// Only increment monthly outreach usage here
		await incrementMonthlyUsage(db, uid, 1);

		return { success: true };
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		const shouldRetry = currentAttempts < email.maxAttempts && isRetryableError(error);

		if (shouldRetry) {
			// Schedule for retry with backoff
			const backoffDelays = [60_000, 300_000, 900_000];
			const backoffDelay = backoffDelays[Math.min(currentAttempts - 1, backoffDelays.length - 1)];

			await queueRef.update({
				status: 'queued',
				lastError: errorMessage,
				scheduledFor: now + backoffDelay,
				updatedAt: now
			});
		} else {
			// Mark as failed
			await queueRef.update({
				status: 'failed',
				lastError: errorMessage,
				updatedAt: now
			});

			// Update campaign contact
			if (email.campaignId && email.influencerId) {
				const contactRef = db
					.collection('users')
					.doc(uid)
					.collection('campaigns')
					.doc(email.campaignId)
					.collection('contacts')
					.doc(email.influencerId);

				await contactRef.set(
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
 * Find all users with queued emails ready for processing
 */
async function findUsersWithQueuedEmails(
	db: FirebaseFirestore.Firestore
): Promise<string[]> {
	const now = Date.now();
	const userIds = new Set<string>();

	const snapshot = await db
		.collectionGroup('emailQueue')
		.where('status', '==', 'queued')
		.where('scheduledFor', '<=', now)
		.limit(1000)
		.get();

	for (const doc of snapshot.docs) {
		// Path: users/{uid}/emailQueue/{queueId}
		const pathParts = doc.ref.path.split('/');
		if (pathParts.length >= 2 && pathParts[0] === 'users') {
			userIds.add(pathParts[1]);
		}
	}

	return Array.from(userIds);
}

/**
 * Process queued emails for a user's Gmail connection
 */
async function processUserInboxQueue(
	db: FirebaseFirestore.Firestore,
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
		// Check daily usage
		const usage = await getDailyInboxUsage(db, uid, connectionId);

		if (usage.remaining <= 0) {
			return result;
		}

		// Get queued emails for this connection
		const now = Date.now();
		const limit = Math.min(usage.remaining, MAX_EMAILS_PER_INBOX_PER_RUN);

		const snapshot = await db
			.collection('users')
			.doc(uid)
			.collection('emailQueue')
			.where('senderConnectionId', '==', connectionId)
			.where('status', '==', 'queued')
			.where('scheduledFor', '<=', now)
			.orderBy('scheduledFor')
			.orderBy('priority')
			.limit(limit)
			.get();

		if (snapshot.empty) {
			return result;
		}

		// Process each email
		for (const doc of snapshot.docs) {
			try {
				const sendResult = await processQueuedEmail(db, uid, doc);
				result.processed++;

				if (sendResult.success) {
					result.succeeded++;
				} else {
					result.failed++;
					if (sendResult.error) {
						result.errors.push(`${(doc.data() as QueuedEmail).to}: ${sendResult.error}`);
					}
				}

				// Rate limit
				if (result.processed < snapshot.size) {
					await delay(PROCESSING_DELAY_MS);
				}
			} catch (error) {
				result.processed++;
				result.failed++;
				result.errors.push(
					`${(doc.data() as QueuedEmail).to}: ${error instanceof Error ? error.message : 'Unknown'}`
				);
			}
		}
	} catch (error) {
		result.errors.push(`Processing error: ${error instanceof Error ? error.message : 'Unknown'}`);
	}

	return result;
}

/**
 * Process all queued emails for a user
 */
async function processUserQueue(
	db: FirebaseFirestore.Firestore,
	uid: string
): Promise<ProcessingResult[]> {
	const results: ProcessingResult[] = [];

	// Get all Gmail connections
	const connectionsSnap = await db
		.collection('users')
		.doc(uid)
		.collection('gmailConnections')
		.get();

	if (connectionsSnap.empty) {
		return results;
	}

	for (const doc of connectionsSnap.docs) {
		const result = await processUserInboxQueue(db, uid, doc.id);
		results.push(result);
	}

	return results;
}

/**
 * Main batch processing function - called by cron endpoint
 */
export async function processEmailQueueBatch(): Promise<BatchProcessingResult> {
	const startTime = Date.now();
	const db = getFirestoreInstance();
	const allResults: ProcessingResult[] = [];
	let totalProcessed = 0;
	let totalSucceeded = 0;
	let totalFailed = 0;

	try {
		// Find users with queued emails
		const userIds = await findUsersWithQueuedEmails(db);
		console.log(`[EmailQueue] Found ${userIds.length} users with queued emails`);

		// Process each user
		for (const uid of userIds) {
			try {
				const userResults = await processUserQueue(db, uid);
				allResults.push(...userResults);

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
		`[EmailQueue] Batch complete: ${totalProcessed} processed, ` +
			`${totalSucceeded} succeeded, ${totalFailed} failed in ${duration}ms`
	);

	return {
		totalProcessed,
		totalSucceeded,
		totalFailed,
		results: allResults,
		duration
	};
}

export const __test__ = {
	decryptRefreshToken,
	getCurrentDateKey,
	getNextMidnightUTC,
	getDailyInboxUsage,
	incrementDailyUsage,
	incrementMonthlyUsage,
	isRetryableError
};
