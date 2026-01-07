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
import { createLogger } from '../utils/logger.js';

const logger = createLogger({ component: 'email-queue-cron' });

// Constants
const DAILY_INBOX_LIMIT = 50;
const PROCESSING_DELAY_MS = 200;
const MAX_EMAILS_PER_INBOX_PER_RUN = 50;
const DEFAULT_QUEUE_RETENTION_DAYS = 30;
const GMAIL_TOKEN_ENCRYPTION_KEY_B64 = process.env.GMAIL_TOKEN_ENCRYPTION_KEY || '';
const GMAIL_TOKEN_ENCRYPTION_KEY_PREVIOUS_B64 = process.env.GMAIL_TOKEN_ENCRYPTION_KEY_PREVIOUS || '';
const GMAIL_OAUTH_CLIENT_ID = process.env.GMAIL_OAUTH_CLIENT_ID || '';
const GMAIL_OAUTH_CLIENT_SECRET = process.env.GMAIL_OAUTH_CLIENT_SECRET || '';

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
	access_token?: string; // Legacy plaintext storage
	access_token_encrypted?: string;
	access_token_iv?: string;
	access_token_tag?: string;
	refresh_token_encrypted?: string;
	refresh_token_iv?: string;
	refresh_token_tag?: string;
	expires_at: number;
	connected_at: number;
	primary: boolean;
	last_refreshed_at?: number;
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

function stripCrlf(value: string): string {
	return value.replace(/[\r\n]+/g, ' ').trim();
}

function requireSingleEmailAddress(value: string, field: string): string {
	const normalized = stripCrlf(value);
	if (!normalized) {
		throw new Error(`${field} is required.`);
	}

	// Disallow common header/address separators and unsafe characters to avoid multi-recipient injection.
	if (/[<>,;]/.test(normalized)) {
		throw new Error(`${field} must be a single email address.`);
	}

	// Very conservative check: single token containing "@", no whitespace.
	if (/\s/.test(normalized) || !normalized.includes('@')) {
		throw new Error(`${field} must be a valid email address.`);
	}

	return normalized;
}

function sanitizeSubject(value: string): string {
	const normalized = stripCrlf(value);
	if (!normalized) {
		throw new Error('Subject is required.');
	}
	return normalized.slice(0, 255);
}

/**
 * Decrypt refresh token using AES-256-GCM
 * Note: Tokens are stored in base64 format by the main app (gmail-auth.ts)
 */
function getEncryptionKeyCandidates(): Buffer[] {
	if (!GMAIL_TOKEN_ENCRYPTION_KEY_B64) {
		throw new Error('GMAIL_TOKEN_ENCRYPTION_KEY not configured');
	}

	const keys: Buffer[] = [Buffer.from(GMAIL_TOKEN_ENCRYPTION_KEY_B64, 'base64')];
	if (GMAIL_TOKEN_ENCRYPTION_KEY_PREVIOUS_B64) {
		keys.push(Buffer.from(GMAIL_TOKEN_ENCRYPTION_KEY_PREVIOUS_B64, 'base64'));
	}

	if (keys[0].length !== 32) {
		throw new Error('GMAIL_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
	}

	if (keys[1] && keys[1].length !== 32) {
		throw new Error('GMAIL_TOKEN_ENCRYPTION_KEY_PREVIOUS must be a base64-encoded 32-byte key');
	}

	return keys;
}

function decryptToken(encrypted: string, iv: string, tag: string): string {
	const keys = getEncryptionKeyCandidates();
	const ivBytes = Buffer.from(iv, 'base64');
	const tagBytes = Buffer.from(tag, 'base64');
	const encryptedBytes = Buffer.from(encrypted, 'base64');

	for (const key of keys) {
		try {
			const decipher = crypto.createDecipheriv('aes-256-gcm', key, ivBytes);
			decipher.setAuthTag(tagBytes);
			const decrypted = Buffer.concat([decipher.update(encryptedBytes), decipher.final()]);
			return decrypted.toString('utf8');
		} catch {
			// Try the next candidate key (supports key rotation).
		}
	}

	throw new Error('Failed to decrypt token. Key rotation may be required.');
}

function encryptToken(value: string) {
	const [encryptionKey] = getEncryptionKeyCandidates();

	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
	const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return {
		ciphertext: encrypted.toString('base64'),
		iv: iv.toString('base64'),
		tag: tag.toString('base64')
	};
}

function decryptRefreshToken(encrypted: string, iv: string, tag: string): string {
	return decryptToken(encrypted, iv, tag);
}

function extractAccessToken(conn: GmailConnection): string | null {
	if (conn.access_token) {
		return conn.access_token;
	}
	if (conn.access_token_encrypted && conn.access_token_iv && conn.access_token_tag) {
		return decryptToken(conn.access_token_encrypted, conn.access_token_iv, conn.access_token_tag);
	}
	return null;
}

function getQueueRetentionDays(): number {
	const raw = process.env.EMAIL_QUEUE_RETENTION_DAYS;
	if (!raw) return DEFAULT_QUEUE_RETENTION_DAYS;
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_QUEUE_RETENTION_DAYS;
	return Math.min(365, parsed);
}

async function cleanupOldQueueItemsGlobal(
	db: FirebaseFirestore.Firestore,
	olderThanDays: number
): Promise<number> {
	const cutoffTime = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;

	const snapshot = await db
		.collectionGroup('emailQueue')
		.where('status', 'in', ['sent', 'failed', 'cancelled'])
		.where('updatedAt', '<', cutoffTime)
		.limit(500)
		.get();

	if (snapshot.empty) {
		return 0;
	}

	const batch = db.batch();
	snapshot.docs.forEach((doc) => batch.delete(doc.ref));
	await batch.commit();
	return snapshot.size;
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
): Promise<GmailConnection & { refresh_token: string; access_token: string }> {
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
	const accessToken = extractAccessToken(conn) ?? '';

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
		refresh_token,
		access_token: accessToken
	};
}

/**
 * Refresh Gmail access token if needed
 */
async function refreshAccessTokenIfNeeded(
	db: FirebaseFirestore.Firestore,
	uid: string,
	connection: GmailConnection & { refresh_token: string; access_token: string }
): Promise<string> {
	const now = Date.now();
	const buffer = 5 * 60 * 1000; // 5 minutes

	if (connection.access_token && now < connection.expires_at - buffer) {
		return connection.access_token;
	}

	// Refresh the token
	if (!GMAIL_OAUTH_CLIENT_ID || !GMAIL_OAUTH_CLIENT_SECRET) {
		throw new Error('Missing Gmail OAuth client credentials (GMAIL_OAUTH_CLIENT_ID/GMAIL_OAUTH_CLIENT_SECRET).');
	}

	const oauth2Client = new google.auth.OAuth2(GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET);

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

	const encryptedAccess = encryptToken(credentials.access_token);
	await connRef.update({
		access_token_encrypted: encryptedAccess.ciphertext,
		access_token_iv: encryptedAccess.iv,
		access_token_tag: encryptedAccess.tag,
		access_token: FieldValue.delete(),
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

	const toEmail = requireSingleEmailAddress(email.to, 'To');
	const fromEmail = requireSingleEmailAddress(email.from, 'From');
	const subject = sanitizeSubject(email.subject);

	// Create MIME message
	const message = [
		`To: ${toEmail}`,
		`From: ${fromEmail}`,
		`Subject: ${subject}`,
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
		logger.info('email_queue_users_found', { users: userIds.length });

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
				logger.error('email_queue_user_failed', { uid, error });
			}
		}
	} catch (error) {
		logger.error('email_queue_batch_failed', { error });
	}

	try {
		const retentionDays = getQueueRetentionDays();
		const deleted = await cleanupOldQueueItemsGlobal(db, retentionDays);
		if (deleted > 0) {
			logger.info('email_queue_cleanup_deleted', { deleted, retention_days: retentionDays });
		}
	} catch (error) {
		logger.warn('email_queue_cleanup_failed', { error_message: error instanceof Error ? error.message : String(error) });
	}

	const duration = Date.now() - startTime;

	logger.info('email_queue_batch_complete', {
		processed: totalProcessed,
		succeeded: totalSucceeded,
		failed: totalFailed,
		duration_ms: duration,
	});

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
	getQueueRetentionDays,
	cleanupOldQueueItemsGlobal,
	isRetryableError
};
