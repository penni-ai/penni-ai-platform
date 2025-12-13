/**
 * Daily Inbox Usage Service
 *
 * Tracks and enforces daily email sending limits per Gmail inbox.
 * Each connected Gmail account has a limit of 50 emails per day (UTC).
 */

import { FieldValue } from 'firebase-admin/firestore';
import {
	firestore,
	gmailConnectionDailyUsageRef,
	type DailyInboxUsage
} from '../core/firestore';

/**
 * Daily sending limit per Gmail inbox
 */
export const DAILY_INBOX_LIMIT = 50;

/**
 * Get current date key in UTC (YYYY-MM-DD format)
 */
export function getCurrentDateKey(): string {
	const now = new Date();
	return now.toISOString().split('T')[0]; // "2025-01-15"
}

/**
 * Get timestamp for next midnight UTC
 */
export function getNextMidnightUTC(): number {
	const now = new Date();
	const tomorrow = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0)
	);
	return tomorrow.getTime();
}

/**
 * Get daily usage for a specific Gmail inbox
 */
export async function getDailyInboxUsage(
	uid: string,
	connectionId: string
): Promise<{
	date: string;
	sendCount: number;
	remaining: number;
	resetAt: number;
}> {
	const dateKey = getCurrentDateKey();
	const usageRef = gmailConnectionDailyUsageRef(uid, connectionId, dateKey);
	const usageDoc = await usageRef.get();

	if (!usageDoc.exists) {
		return {
			date: dateKey,
			sendCount: 0,
			remaining: DAILY_INBOX_LIMIT,
			resetAt: getNextMidnightUTC()
		};
	}

	const data = usageDoc.data() as DailyInboxUsage;
	const sendCount = data.sendCount || 0;

	return {
		date: dateKey,
		sendCount,
		remaining: Math.max(0, DAILY_INBOX_LIMIT - sendCount),
		resetAt: data.resetAt || getNextMidnightUTC()
	};
}

/**
 * Check daily capacity and reserve slots atomically.
 * Returns how many emails can be sent now vs need to be queued.
 *
 * This function uses a Firestore transaction to:
 * 1. Read current daily usage
 * 2. Calculate available capacity
 * 3. Reserve capacity by incrementing the count
 *
 * @param uid - User ID
 * @param connectionId - Gmail connection ID
 * @param requested - Number of emails requested to send
 * @returns Object with canSend (immediate) and toQueue counts
 */
export async function checkAndReserveDailyCapacity(
	uid: string,
	connectionId: string,
	requested: number
): Promise<{
	canSend: number;
	toQueue: number;
	currentUsed: number;
	resetAt: number;
}> {
	const dateKey = getCurrentDateKey();
	const usageRef = gmailConnectionDailyUsageRef(uid, connectionId, dateKey);
	const resetAt = getNextMidnightUTC();

	const result = await firestore.runTransaction(async (tx) => {
		const usageDoc = await tx.get(usageRef);
		const currentCount = usageDoc.exists ? (usageDoc.data() as DailyInboxUsage).sendCount || 0 : 0;

		const remaining = Math.max(0, DAILY_INBOX_LIMIT - currentCount);
		const canSend = Math.min(requested, remaining);
		const toQueue = requested - canSend;

		// Reserve capacity by incrementing the count
		if (canSend > 0) {
			const now = Date.now();
			if (usageDoc.exists) {
				tx.update(usageRef, {
					sendCount: FieldValue.increment(canSend),
					lastSentAt: now,
					updatedAt: now
				});
			} else {
				tx.set(usageRef, {
					date: dateKey,
					sendCount: canSend,
					lastSentAt: now,
					resetAt,
					updatedAt: now
				} satisfies DailyInboxUsage);
			}
		}

		return {
			canSend,
			toQueue,
			currentUsed: currentCount + canSend,
			resetAt
		};
	});

	return result;
}

/**
 * Increment daily inbox usage (used by queue processor after sending queued emails)
 */
export async function incrementDailyInboxUsage(
	uid: string,
	connectionId: string,
	amount: number = 1
): Promise<void> {
	const dateKey = getCurrentDateKey();
	const usageRef = gmailConnectionDailyUsageRef(uid, connectionId, dateKey);
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
 * Release reserved capacity if emails fail to send.
 * This should be called when emails that were reserved fail to send,
 * allowing other emails to use that capacity.
 */
export async function releaseReservedCapacity(
	uid: string,
	connectionId: string,
	amount: number
): Promise<void> {
	if (amount <= 0) return;

	const dateKey = getCurrentDateKey();
	const usageRef = gmailConnectionDailyUsageRef(uid, connectionId, dateKey);
	const now = Date.now();

	await firestore.runTransaction(async (tx) => {
		const usageDoc = await tx.get(usageRef);
		if (!usageDoc.exists) return;

		const currentCount = (usageDoc.data() as DailyInboxUsage).sendCount || 0;
		const newCount = Math.max(0, currentCount - amount);

		tx.update(usageRef, {
			sendCount: newCount,
			updatedAt: now
		});
	});
}

/**
 * Get daily usage for all Gmail connections of a user
 */
export async function getAllInboxesDailyUsage(
	uid: string,
	connectionIds: string[]
): Promise<Record<string, { sendCount: number; remaining: number; resetAt: number }>> {
	const result: Record<string, { sendCount: number; remaining: number; resetAt: number }> = {};

	await Promise.all(
		connectionIds.map(async (connectionId) => {
			const usage = await getDailyInboxUsage(uid, connectionId);
			result[connectionId] = {
				sendCount: usage.sendCount,
				remaining: usage.remaining,
				resetAt: usage.resetAt
			};
		})
	);

	return result;
}
