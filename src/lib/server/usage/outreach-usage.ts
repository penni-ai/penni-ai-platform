import { firestore, userDocRef, type UserUsage } from '../core';
import { PLAN_LIMITS, type EventCredits } from '$lib/billing/plans';

/**
 * Get the monthly outreach limit for a user based on their subscription plan
 * Note: This is the base subscription limit only. Event credits are separate.
 */
export function getSubscriptionOutreachLimit(planKey: string | null | undefined): number {
	if (planKey === 'starter') return PLAN_LIMITS.starter.outreachEmails;
	if (planKey === 'growth') return PLAN_LIMITS.growth.outreachEmails;
	// Free plan (or no plan) - 'event' is not a subscription, it's a credit boost
	return PLAN_LIMITS.free.outreachEmails;
}

/**
 * Get current month key in format "YYYY-MM"
 */
function getCurrentMonthKey(): string {
	const now = new Date();
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, '0');
	return `${year}-${month}`;
}

/**
 * Get the reset date (first day of next month) as a timestamp
 */
function getResetDate(): number {
	const now = new Date();
	const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
	return nextMonth.getTime();
}

export interface OutreachUsageResult {
	count: number;
	subscriptionLimit: number;
	subscriptionRemaining: number;
	eventCreditsRemaining: number;
	totalRemaining: number;
	resetDate: number;
	hasEventCredits: boolean;
	// Backwards compatibility
	limit: number;
	remaining: number;
}

/**
 * Get user's current outreach usage for this month including event credits
 */
export async function getOutreachUsage(uid: string): Promise<OutreachUsageResult> {
	const userDoc = await userDocRef(uid).get();
	const userData = userDoc.data();
	const usage = userData?.usage as UserUsage | undefined;
	const currentMonth = getCurrentMonthKey();

	// If no usage record or different month, reset to 0
	const count = usage?.outreachSent?.month === currentMonth ? (usage.outreachSent.count ?? 0) : 0;

	// Get user's subscription plan limit (fallback to feature_capabilities)
	const planKey =
		(userData?.currentPlan as { planKey?: string | null } | undefined)?.planKey ??
		(userData?.feature_capabilities as { planKey?: string | null } | undefined)?.planKey ??
		null;
	const subscriptionLimit = getSubscriptionOutreachLimit(planKey);
	const subscriptionRemaining = Math.max(0, subscriptionLimit - count);

	// Get event credits (one-time boost, doesn't reset)
	const eventCredits = userData?.eventCredits as EventCredits | undefined;
	const eventCreditsRemaining = eventCredits?.outreachRemaining ?? 0;

	// Total remaining is subscription remaining + event credits
	const totalRemaining = subscriptionRemaining + eventCreditsRemaining;
	const resetDate = getResetDate();

	return {
		count,
		subscriptionLimit,
		subscriptionRemaining,
		eventCreditsRemaining,
		totalRemaining,
		resetDate,
		hasEventCredits: eventCreditsRemaining > 0,
		// Backwards compatibility
		limit: subscriptionLimit + eventCreditsRemaining,
		remaining: totalRemaining
	};
}

export interface IncrementOutreachResult {
	success: boolean;
	usedFromSubscription: number;
	usedFromEventCredits: number;
	subscriptionRemaining: number;
	eventCreditsRemaining: number;
}

/**
 * Increment user's outreach usage count for current month.
 * Uses subscription limit first, then consumes event credits if available.
 * Returns details about where the usage was deducted from.
 */
export async function incrementOutreachUsage(uid: string, amount: number = 1): Promise<IncrementOutreachResult> {
	const userRef = userDocRef(uid);
	const currentMonth = getCurrentMonthKey();
	const now = Date.now();

	return await firestore.runTransaction(async (tx) => {
		const userDoc = await tx.get(userRef);
		const userData = userDoc.data();

		// Get user's subscription plan limit (fallback to feature_capabilities)
		const planKey =
			(userData?.currentPlan as { planKey?: string | null } | undefined)?.planKey ??
			(userData?.feature_capabilities as { planKey?: string | null } | undefined)?.planKey ??
			null;
		const subscriptionLimit = getSubscriptionOutreachLimit(planKey);

		// Get existing usage or initialize with defaults
		let usage = userData?.usage as UserUsage | undefined;
		if (!usage) {
			usage = {
				outreachSent: { month: currentMonth, count: 0, updatedAt: now },
				influencersFound: { month: currentMonth, count: 0, updatedAt: now }
			};
		}

		// Ensure influencersFound usage exists (preserve it)
		if (!usage.influencersFound) {
			usage.influencersFound = { month: currentMonth, count: 0, updatedAt: now };
		}

		// If different month, reset subscription usage to 0
		if (usage.outreachSent.month !== currentMonth) {
			usage.outreachSent = { month: currentMonth, count: 0, updatedAt: now };
		}

		const currentSubscriptionUsage = usage.outreachSent.count ?? 0;
		const subscriptionRemaining = Math.max(0, subscriptionLimit - currentSubscriptionUsage);

		// Get event credits
		let eventCredits = userData?.eventCredits as EventCredits | undefined;
		let eventCreditsRemaining = eventCredits?.outreachRemaining ?? 0;

		// Calculate how much to deduct from each source
		let usedFromSubscription = Math.min(amount, subscriptionRemaining);
		let usedFromEventCredits = 0;

		// If we need more than subscription allows, use event credits
		const remainingToUse = amount - usedFromSubscription;
		if (remainingToUse > 0 && eventCreditsRemaining > 0) {
			usedFromEventCredits = Math.min(remainingToUse, eventCreditsRemaining);
		}

		// Check if we have enough credits for the request
		const totalAvailable = subscriptionRemaining + eventCreditsRemaining;
		if (amount > totalAvailable) {
			return {
				success: false,
				usedFromSubscription: 0,
				usedFromEventCredits: 0,
				subscriptionRemaining,
				eventCreditsRemaining
			};
		}

		// Update subscription usage
		usage.outreachSent.count = currentSubscriptionUsage + usedFromSubscription;
		usage.outreachSent.updatedAt = now;

		// Build update object
		const updateData: Record<string, unknown> = { usage, updatedAt: now };

		// Update event credits if used
		if (usedFromEventCredits > 0 && eventCredits) {
			eventCredits.outreachRemaining = eventCreditsRemaining - usedFromEventCredits;
			updateData.eventCredits = eventCredits;
		}

		if (userDoc.exists) {
			tx.update(userRef, updateData);
		} else {
			tx.set(userRef, updateData, { merge: true });
		}

		return {
			success: true,
			usedFromSubscription,
			usedFromEventCredits,
			subscriptionRemaining: subscriptionRemaining - usedFromSubscription,
			eventCreditsRemaining: eventCreditsRemaining - usedFromEventCredits
		};
	});
}
